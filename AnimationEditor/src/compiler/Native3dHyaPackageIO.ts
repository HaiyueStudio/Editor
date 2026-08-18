import { type Native3dAsset, type Native3dProject } from '../domain/native3d/Native3dProject';
import { parseNative3dProject } from '../domain/native3d/Native3dProjectCodec';
import { createNative3dHyaArtifact, type Native3dHyaArtifact } from '../domain/native3d/Native3dCompiler';
import {
  HYA_PACKAGE_FORMAT,
  HYA_PACKAGE_MAX_ARCHIVE_BYTES,
  HYA_PACKAGE_MAX_ASSET_BYTES,
  HYA_PACKAGE_MIME_TYPE,
  HyaPackageError,
  comparePaths,
  encodeStoredZip,
  exactArrayBuffer,
  hyaPackageFileName,
  sha256Integrity,
  type HyaPackageFile,
} from './HyaPackageIO';

export interface Native3dHyaPackageManifest {
  readonly format: typeof HYA_PACKAGE_FORMAT;
  readonly family: '3d';
  readonly project: Readonly<{ id: string; name: string }>;
  readonly hya: Readonly<{ path: string; bytes: number; integrity: string }>;
  readonly resources: readonly Readonly<{
    id: string;
    type: Native3dAsset['type'];
    uri: string;
    delivery: 'bundled' | 'external';
    mimeType: string;
    integrity?: string;
    bytes?: number;
  }>[];
}

export interface Native3dHyaPackageArtifact {
  readonly fileName: string;
  readonly mimeType: typeof HYA_PACKAGE_MIME_TYPE;
  readonly binary: ArrayBuffer;
  readonly bytes: number;
  readonly rootDirectory: string;
  readonly files: readonly HyaPackageFile[];
  readonly manifest: Native3dHyaPackageManifest;
  readonly hya: Native3dHyaArtifact;
  readonly bundledAssetCount: number;
  readonly externalAssetCount: number;
}

/** Deterministic 3D delivery package sharing the same ZIP/integrity owner as 2D. */
export async function createNative3dHyaPackageArtifact(source: Native3dProject): Promise<Native3dHyaPackageArtifact> {
  const project = parseNative3dProject(source);
  const packaged = structuredClone(project) as unknown as Mutable<Native3dProject>;
  const assetFiles: HyaPackageFile[] = [];
  const resources: Mutable<Native3dHyaPackageManifest['resources']> = [];
  const usedNames = new Set<string>();
  let totalAssetBytes = 0;

  for (let index = 0; index < project.assets.length; index++) {
    const asset = project.assets[index]!;
    const target = packaged.assets[index]!;
    if (asset.source.kind === 'external') {
      resources.push({
        id: asset.id, type: asset.type, uri: asset.delivery.uri, delivery: 'external',
        mimeType: asset.delivery.mimeType,
        ...(asset.delivery.integrity ? { integrity: asset.delivery.integrity } : {}),
      });
      continue;
    }
    const bytes = decodeBase64(asset.source.data, index);
    if (bytes.byteLength > HYA_PACKAGE_MAX_ASSET_BYTES) {
      throw new HyaPackageError('E_PACKAGE_ASSET_TOO_LARGE', `$.assets[${index}]`, 'Embedded 3D asset exceeds the package asset budget.');
    }
    totalAssetBytes += bytes.byteLength;
    if (totalAssetBytes > HYA_PACKAGE_MAX_ARCHIVE_BYTES) {
      throw new HyaPackageError('E_PACKAGE_ARCHIVE_TOO_LARGE', '$.assets', 'Embedded 3D assets exceed the package archive budget.');
    }
    const fileName = uniqueFileName(asset, usedNames);
    const path = `assets/${fileName}`;
    const uri = `assets/${encodeURIComponent(fileName)}`;
    const integrity = await sha256Integrity(bytes);
    target.source = { kind: 'external', uri };
    target.delivery = { ...target.delivery, uri, integrity };
    assetFiles.push(Object.freeze({ path, mimeType: asset.delivery.mimeType, bytes }));
    resources.push({
      id: asset.id, type: asset.type, uri, delivery: 'bundled', mimeType: asset.delivery.mimeType,
      integrity, bytes: bytes.byteLength,
    });
  }

  const hya = createNative3dHyaArtifact(packaged as unknown as Native3dProject);
  const hyaIntegrity = await sha256Integrity(hya.bytes);
  const manifest: Native3dHyaPackageManifest = Object.freeze({
    format: HYA_PACKAGE_FORMAT,
    family: '3d',
    project: Object.freeze({ id: project.id, name: project.name }),
    hya: Object.freeze({ path: hya.fileName, bytes: hya.bytes.byteLength, integrity: hyaIntegrity }),
    resources: Object.freeze(resources.map(resource => Object.freeze(resource))),
  });
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const files: readonly HyaPackageFile[] = Object.freeze([
    Object.freeze({ path: hya.fileName, mimeType: hya.mimeType, bytes: hya.bytes }),
    ...assetFiles,
    Object.freeze({ path: 'manifest.json', mimeType: 'application/json', bytes: manifestBytes }),
  ].sort((left, right) => comparePaths(left.path, right.path)));
  const rootDirectory = safeStem(project.name);
  const zip = encodeStoredZip(files.map(file => ({ path: `${rootDirectory}/${file.path}`, bytes: file.bytes })));
  const binary = exactArrayBuffer(zip);
  const bundledAssetCount = resources.filter(resource => resource.delivery === 'bundled').length;
  return Object.freeze({
    fileName: hyaPackageFileName(project.name), mimeType: HYA_PACKAGE_MIME_TYPE, binary,
    bytes: binary.byteLength, rootDirectory, files, manifest, hya,
    bundledAssetCount, externalAssetCount: resources.length - bundledAssetCount,
  });
}

function decodeBase64(value: string, index: number): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset++) bytes[offset] = binary.charCodeAt(offset);
    return bytes;
  } catch (error) {
    throw new HyaPackageError('E_PACKAGE_ASSET_DECODE', `$.assets[${index}].source.data`, error instanceof Error ? error.message : 'Invalid base64.');
  }
}

function uniqueFileName(asset: Native3dAsset, used: Set<string>): string {
  const extension = extensionForMime(asset.delivery.mimeType);
  const stem = safeStem(asset.name).replace(/\.[a-z0-9]{1,12}$/iu, '') || asset.id;
  let candidate = `${stem}${extension}`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem}-${suffix++}${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function extensionForMime(mime: string): string {
  return ({
    'model/gltf+json': '.gltf', 'model/gltf-binary': '.glb', 'image/png': '.png',
    'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/json': '.json',
  } as Readonly<Record<string, string>>)[mime.toLowerCase()] ?? '.bin';
}

function safeStem(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').replace(/\s+/gu, '-').replace(/[. -]+$/gu, '') || 'untitled-3d-animation';
}

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
