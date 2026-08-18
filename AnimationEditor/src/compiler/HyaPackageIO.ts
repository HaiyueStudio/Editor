import type { AnimationEditorAsset, AnimationEditorProject } from '../domain/AnimationEditorProject';
import { cloneAnimationEditorProject } from '../domain/AnimationEditorProject';
import { parseAnimationEditorProject } from '../persistence/ProjectCodec';
import {
  createHyaFileArtifact,
  hyaFileName,
  type HyaFileArtifact,
} from './HyaFileIO';

export const HYA_PACKAGE_FORMAT = 'haiyue-animation-package@1' as const;
export const HYA_PACKAGE_MIME_TYPE = 'application/zip' as const;
export const HYA_PACKAGE_FILE_SUFFIX = '.hya-package.zip' as const;
export const HYA_PACKAGE_MAX_ASSET_BYTES = 64 * 1024 * 1024;
export const HYA_PACKAGE_MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;

export type HyaPackageErrorCode =
  | 'E_PACKAGE_ASSET_DECODE'
  | 'E_PACKAGE_ASSET_TOO_LARGE'
  | 'E_PACKAGE_ARCHIVE_TOO_LARGE'
  | 'E_PACKAGE_CRYPTO_UNAVAILABLE'
  | 'E_PACKAGE_ZIP_LIMIT';

export class HyaPackageError extends Error {
  readonly name = 'HyaPackageError';

  constructor(
    readonly code: HyaPackageErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${code}: ${message} (${path})`);
  }
}

export interface HyaPackageFile {
  /** Path relative to the package root directory. */
  readonly path: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface HyaPackageManifestResource {
  readonly id: string;
  readonly type: AnimationEditorAsset['type'];
  readonly uri: string;
  readonly delivery: 'bundled' | 'external';
  readonly mimeType?: string;
  readonly integrity?: string;
  readonly bytes?: number;
}

export interface HyaPackageManifest {
  readonly format: typeof HYA_PACKAGE_FORMAT;
  readonly project: Readonly<{ id: string; name: string }>;
  readonly hya: Readonly<{ path: string; bytes: number; integrity: string }>;
  readonly resources: readonly HyaPackageManifestResource[];
}

export interface HyaPackageArtifact {
  readonly fileName: string;
  readonly mimeType: typeof HYA_PACKAGE_MIME_TYPE;
  /** Deterministic ZIP bytes with a fixed timestamp and stable entry ordering. */
  readonly binary: ArrayBuffer;
  readonly bytes: number;
  readonly rootDirectory: string;
  readonly files: readonly HyaPackageFile[];
  readonly manifest: HyaPackageManifest;
  readonly hya: HyaFileArtifact;
  readonly bundledAssetCount: number;
  readonly externalAssetCount: number;
}

/**
 * Builds a portable delivery ZIP without changing the editable project. Embedded
 * sources and data delivery URIs become sibling files and the packaged HYA points
 * at those relative paths. Network/relative delivery URIs remain explicit external
 * dependencies in the manifest.
 */
export async function createHyaPackageArtifact(
  source: AnimationEditorProject,
): Promise<HyaPackageArtifact> {
  const project = parseAnimationEditorProject(source);
  const packagedProject = cloneAnimationEditorProject(project);
  const usedFileNames = new Set<string>();
  const assetFiles: HyaPackageFile[] = [];
  const resources: HyaPackageManifestResource[] = [];
  let bundledAssetBytes = 0;

  for (let index = 0; index < project.assets.length; index++) {
    const asset = project.assets[index]!;
    const packagedAsset = packagedProject.assets[index]!;
    const bytes = packagedAssetBytes(asset, index);
    if (!bytes) {
      resources.push(Object.freeze({
        id: asset.id,
        type: asset.type,
        uri: asset.delivery.uri,
        delivery: 'external',
        ...(asset.delivery.mimeType === undefined ? {} : { mimeType: asset.delivery.mimeType }),
        ...(asset.delivery.integrity === undefined ? {} : { integrity: asset.delivery.integrity }),
      }));
      continue;
    }
    if (bytes.byteLength > HYA_PACKAGE_MAX_ASSET_BYTES) {
      throw new HyaPackageError(
        'E_PACKAGE_ASSET_TOO_LARGE',
        `$.assets[${index}]`,
        `Resource "${asset.name}" exceeds the ${formatMiB(HYA_PACKAGE_MAX_ASSET_BYTES)} MiB package limit.`,
      );
    }
    bundledAssetBytes += bytes.byteLength;
    if (bundledAssetBytes > HYA_PACKAGE_MAX_ARCHIVE_BYTES) {
      throw new HyaPackageError(
        'E_PACKAGE_ARCHIVE_TOO_LARGE',
        '$.assets',
        `Bundled resources exceed the ${formatMiB(HYA_PACKAGE_MAX_ARCHIVE_BYTES)} MiB package limit.`,
      );
    }

    const fileName = uniqueAssetFileName(asset, usedFileNames);
    const filePath = `assets/${fileName}`;
    const uri = `assets/${encodeURIComponent(fileName)}`;
    const mimeType = asset.delivery.mimeType
      ?? (asset.source.kind === 'embedded' ? asset.source.mimeType : undefined)
      ?? 'application/octet-stream';
    const integrity = await sha256Integrity(bytes);
    packagedAsset.delivery.uri = uri;
    packagedAsset.delivery.mimeType = mimeType;
    packagedAsset.delivery.integrity = integrity;
    packagedAsset.source = { kind: 'external', uri };
    assetFiles.push(Object.freeze({ path: filePath, mimeType, bytes }));
    resources.push(Object.freeze({
      id: asset.id,
      type: asset.type,
      uri,
      delivery: 'bundled',
      mimeType,
      integrity,
      bytes: bytes.byteLength,
    }));
  }

  const hya = createHyaFileArtifact(packagedProject);
  const hyaBytes = new Uint8Array(hya.binary);
  const hyaIntegrity = await sha256Integrity(hyaBytes);
  const manifest: HyaPackageManifest = Object.freeze({
    format: HYA_PACKAGE_FORMAT,
    project: Object.freeze({ id: project.id, name: project.name }),
    hya: Object.freeze({ path: hya.fileName, bytes: hya.bytes, integrity: hyaIntegrity }),
    resources: Object.freeze(resources),
  });
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const files = Object.freeze([
    Object.freeze({ path: hya.fileName, mimeType: hya.mimeType, bytes: hyaBytes }),
    ...assetFiles,
    Object.freeze({ path: 'manifest.json', mimeType: 'application/json', bytes: manifestBytes }),
  ].sort((left, right) => comparePaths(left.path, right.path)));
  const rootDirectory = packageRootDirectory(project.name);
  const zipBytes = encodeStoredZip(files.map(file => ({
    path: `${rootDirectory}/${file.path}`,
    bytes: file.bytes,
  })));
  if (zipBytes.byteLength > HYA_PACKAGE_MAX_ARCHIVE_BYTES) {
    throw new HyaPackageError(
      'E_PACKAGE_ARCHIVE_TOO_LARGE',
      '$',
      `Package archive exceeds the ${formatMiB(HYA_PACKAGE_MAX_ARCHIVE_BYTES)} MiB limit.`,
    );
  }
  const binary = exactArrayBuffer(zipBytes);
  const bundledAssetCount = resources.filter(resource => resource.delivery === 'bundled').length;

  return Object.freeze({
    fileName: hyaPackageFileName(project.name),
    mimeType: HYA_PACKAGE_MIME_TYPE,
    binary,
    bytes: binary.byteLength,
    rootDirectory,
    files,
    manifest,
    hya,
    bundledAssetCount,
    externalAssetCount: resources.length - bundledAssetCount,
  });
}

export async function downloadHyaPackage(project: AnimationEditorProject): Promise<HyaPackageArtifact> {
  const artifact = await createHyaPackageArtifact(project);
  const blob = new Blob([artifact.binary], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return artifact;
}

export function hyaPackageFileName(name: string): string {
  const stem = hyaFileName(name).slice(0, -'.hya'.length);
  return `${stem}${HYA_PACKAGE_FILE_SUFFIX}`;
}

function packageRootDirectory(name: string): string {
  return hyaFileName(name).slice(0, -'.hya'.length);
}

function packagedAssetBytes(asset: AnimationEditorAsset, index: number): Uint8Array | null {
  try {
    if (asset.source.kind === 'embedded') return decodeBase64(asset.source.data);
    if (asset.delivery.uri.startsWith('data:')) return decodeDataUri(asset.delivery.uri);
    return null;
  } catch (error) {
    if (error instanceof HyaPackageError) throw error;
    if (error instanceof RangeError) {
      throw new HyaPackageError(
        'E_PACKAGE_ASSET_TOO_LARGE',
        `$.assets[${index}]`,
        `Resource "${asset.name}" exceeds the ${formatMiB(HYA_PACKAGE_MAX_ASSET_BYTES)} MiB package limit.`,
      );
    }
    throw new HyaPackageError(
      'E_PACKAGE_ASSET_DECODE',
      `$.assets[${index}]`,
      `Resource "${asset.name}" could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function decodeDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(',');
  if (comma < 5) throw new TypeError('Malformed data URI.');
  const metadata = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (metadata.split(';').some(token => token.toLowerCase() === 'base64')) return decodeBase64(payload);

  const encoder = new TextEncoder();
  const capacity = Math.min(HYA_PACKAGE_MAX_ASSET_BYTES + 1, payload.length * 3);
  const bytes = new Uint8Array(capacity);
  let outputOffset = 0;
  let rawStart = 0;
  const appendText = (end: number): void => {
    if (rawStart >= end) return;
    const result = encoder.encodeInto(payload.slice(rawStart, end), bytes.subarray(outputOffset));
    outputOffset += result.written;
    if (result.read !== end - rawStart) throw new RangeError('Decoded data URI exceeds the package asset limit.');
  };
  for (let index = 0; index < payload.length;) {
    if (payload[index] === '%' && /^[0-9a-f]{2}$/iu.test(payload.slice(index + 1, index + 3))) {
      appendText(index);
      if (outputOffset >= bytes.byteLength) throw new RangeError('Decoded data URI exceeds the package asset limit.');
      bytes[outputOffset++] = Number.parseInt(payload.slice(index + 1, index + 3), 16);
      index += 3;
      rawStart = index;
      continue;
    }
    const codePoint = payload.codePointAt(index)!;
    index += codePoint > 0xffff ? 2 : 1;
  }
  appendText(payload.length);
  return bytes.slice(0, outputOffset);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sha256Integrity(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new HyaPackageError(
      'E_PACKAGE_CRYPTO_UNAVAILABLE',
      '$',
      'SHA-256 is unavailable in this browser, so resource integrity cannot be generated.',
    );
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', exactArrayBuffer(bytes)));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

function uniqueAssetFileName(asset: AnimationEditorAsset, used: Set<string>): string {
  const sourceName = asset.source.kind === 'embedded'
    ? asset.source.fileName
    : fileNameFromUri(asset.delivery.uri) || asset.name;
  const sanitized = sanitizeAssetFileName(sourceName, asset.id, asset.delivery.mimeType);
  let candidate = sanitized;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const dot = sanitized.lastIndexOf('.');
    const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
    const extension = dot > 0 ? sanitized.slice(dot) : '';
    candidate = `${stem}-${suffix++}${extension}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function sanitizeAssetFileName(value: string, assetId: string, mimeType: string | undefined): string {
  const baseName = value.normalize('NFC').split(/[\\/]/u).at(-1) ?? '';
  let safe = baseName
    .replace(/[<>:"|?*\u0000-\u001f\u007f]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/gu, '');
  if (!safe) safe = assetId.replace(/[^a-z0-9._-]+/giu, '-') || 'asset';
  if (!/\.[a-z0-9]{1,12}$/iu.test(safe)) safe += extensionForMimeType(mimeType);
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(safe)) safe = `_${safe}`;
  safe = [...safe.slice(0, 360)].map(character => {
    const codePoint = character.codePointAt(0)!;
    return codePoint >= 0xd800 && codePoint <= 0xdfff ? '-' : character;
  }).slice(0, 180).join('');
  return safe.replace(/[. ]+$/gu, '') || 'asset.bin';
}

function fileNameFromUri(uri: string): string {
  if (uri.startsWith('data:')) return '';
  try {
    const path = new URL(uri, 'https://package.invalid/').pathname;
    return decodeURIComponent(path.split('/').at(-1) ?? '');
  } catch {
    return uri.split(/[\\/?#]/u).filter(Boolean).at(-1) ?? '';
  }
}

function extensionForMimeType(mimeType: string | undefined): string {
  const extensions: Readonly<Record<string, string>> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
    'image/svg+xml': '.svg', 'image/avif': '.avif', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
    'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'application/json': '.json',
  };
  return extensions[mimeType?.toLowerCase() ?? ''] ?? '.bin';
}

interface StoredZipInput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

interface StoredZipEntry extends StoredZipInput {
  readonly name: Uint8Array;
  readonly crc32: number;
}

const ZIP_LOCAL_HEADER_BYTES = 30;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const ZIP_END_BYTES = 22;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DOS_DATE_1980_01_01 = 0x0021;

export function encodeStoredZip(inputs: readonly StoredZipInput[]): Uint8Array {
  if (inputs.length > 0xffff) packageZipLimit('ZIP64 is required for more than 65535 files.');
  const encoder = new TextEncoder();
  const entries = [...inputs]
    .sort((left, right) => comparePaths(left.path, right.path))
    .map(input => ({ ...input, name: encoder.encode(input.path), crc32: crc32(input.bytes) }));
  let localSize = 0;
  let centralSize = 0;
  for (const entry of entries) {
    if (entry.name.byteLength === 0 || entry.name.byteLength > 0xffff) {
      packageZipLimit(`ZIP path "${entry.path}" is too long.`);
    }
    assertZip32(entry.bytes.byteLength, `file "${entry.path}"`);
    localSize += ZIP_LOCAL_HEADER_BYTES + entry.name.byteLength + entry.bytes.byteLength;
    centralSize += ZIP_CENTRAL_HEADER_BYTES + entry.name.byteLength;
  }
  assertZip32(localSize, 'local archive');
  assertZip32(centralSize, 'central directory');
  const outputSize = localSize + centralSize + ZIP_END_BYTES;
  if (outputSize > HYA_PACKAGE_MAX_ARCHIVE_BYTES) {
    throw new HyaPackageError(
      'E_PACKAGE_ARCHIVE_TOO_LARGE',
      '$',
      `Package archive exceeds the ${formatMiB(HYA_PACKAGE_MAX_ARCHIVE_BYTES)} MiB limit.`,
    );
  }
  const output = new Uint8Array(outputSize);
  const view = new DataView(output.buffer);
  const localOffsets: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, ZIP_UTF8_FLAG, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, ZIP_DOS_DATE_1980_01_01, true);
    view.setUint32(offset + 14, entry.crc32, true);
    view.setUint32(offset + 18, entry.bytes.byteLength, true);
    view.setUint32(offset + 22, entry.bytes.byteLength, true);
    view.setUint16(offset + 26, entry.name.byteLength, true);
    view.setUint16(offset + 28, 0, true);
    output.set(entry.name, offset + ZIP_LOCAL_HEADER_BYTES);
    output.set(entry.bytes, offset + ZIP_LOCAL_HEADER_BYTES + entry.name.byteLength);
    offset += ZIP_LOCAL_HEADER_BYTES + entry.name.byteLength + entry.bytes.byteLength;
  }

  const centralOffset = offset;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, ZIP_UTF8_FLAG, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, ZIP_DOS_DATE_1980_01_01, true);
    view.setUint32(offset + 16, entry.crc32, true);
    view.setUint32(offset + 20, entry.bytes.byteLength, true);
    view.setUint32(offset + 24, entry.bytes.byteLength, true);
    view.setUint16(offset + 28, entry.name.byteLength, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index]!, true);
    output.set(entry.name, offset + ZIP_CENTRAL_HEADER_BYTES);
    offset += ZIP_CENTRAL_HEADER_BYTES + entry.name.byteLength;
  }

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true);
  return output;
}

function assertZip32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    packageZipLimit(`ZIP32 cannot encode ${label} (${value} bytes).`);
  }
}

function packageZipLimit(message: string): never {
  throw new HyaPackageError('E_PACKAGE_ZIP_LIMIT', '$', message);
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

function formatMiB(bytes: number): number {
  return bytes / 1024 / 1024;
}

export function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
