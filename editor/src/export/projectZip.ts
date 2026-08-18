import { deflateRaw } from 'pako';
import type { RuntimeProjectExport } from './projectTemplate';

export interface RuntimeProjectZipOptions {
  rootDirectory?: string | false;
  compressionLevel?: number;
  signal?: AbortSignal;
  onProgress?: (percent: number, currentFile?: string) => void;
}

export async function createRuntimeProjectZip(
  project: RuntimeProjectExport,
  options: RuntimeProjectZipOptions = {},
): Promise<Blob> {
  const bytes = await createRuntimeProjectZipBytes(project, options);
  const buffer = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : copyToArrayBuffer(bytes);
  return new Blob([buffer], { type: 'application/zip' });
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

export async function createRuntimeProjectZipBytes(
  project: RuntimeProjectExport,
  options: RuntimeProjectZipOptions = {},
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const rootDirectory = options.rootDirectory === false
    ? ''
    : normalizeZipDirectory(options.rootDirectory ?? project.projectName);
  const entries: ZipEntry[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < project.files.length; index++) {
    const file = project.files[index]!;
    options.signal?.throwIfAborted();
    const name = encoder.encode(`${rootDirectory}${normalizeZipPath(file.path)}`);
    const source = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const compressed = deflateRaw(source, { level: clampCompressionLevel(options.compressionLevel ?? 9) });
    entries.push({ name, source, compressed, crc32: crc32(source) });
    options.onProgress?.((index + 1) * 100 / Math.max(1, project.files.length), file.path);
  }
  options.signal?.throwIfAborted();
  return encodeZip(entries);
}

interface ZipEntry {
  readonly name: Uint8Array;
  readonly source: Uint8Array;
  readonly compressed: Uint8Array;
  readonly crc32: number;
}

const LOCAL_FILE_HEADER_BYTES = 30;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DEFLATE_METHOD = 8;
const ZIP_DOS_DATE_1980_01_01 = 0x0021;

function encodeZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new RangeError('ZIP64 is required for more than 65535 export files.');
  const localSize = entries.reduce(
    (total, entry) => total + LOCAL_FILE_HEADER_BYTES + entry.name.byteLength + entry.compressed.byteLength,
    0,
  );
  const centralSize = entries.reduce(
    (total, entry) => total + CENTRAL_DIRECTORY_HEADER_BYTES + entry.name.byteLength,
    0,
  );
  assertZip32(localSize, 'local archive size');
  assertZip32(centralSize, 'central directory size');
  const output = new Uint8Array(localSize + centralSize + END_OF_CENTRAL_DIRECTORY_BYTES);
  const view = new DataView(output.buffer);
  let offset = 0;
  const localOffsets: number[] = [];

  for (const entry of entries) {
    assertZipEntry(entry);
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, ZIP_UTF8_FLAG, true);
    view.setUint16(offset + 8, ZIP_DEFLATE_METHOD, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, ZIP_DOS_DATE_1980_01_01, true);
    view.setUint32(offset + 14, entry.crc32, true);
    view.setUint32(offset + 18, entry.compressed.byteLength, true);
    view.setUint32(offset + 22, entry.source.byteLength, true);
    view.setUint16(offset + 26, entry.name.byteLength, true);
    view.setUint16(offset + 28, 0, true);
    output.set(entry.name, offset + LOCAL_FILE_HEADER_BYTES);
    output.set(entry.compressed, offset + LOCAL_FILE_HEADER_BYTES + entry.name.byteLength);
    offset += LOCAL_FILE_HEADER_BYTES + entry.name.byteLength + entry.compressed.byteLength;
  }

  const centralOffset = offset;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, ZIP_UTF8_FLAG, true);
    view.setUint16(offset + 10, ZIP_DEFLATE_METHOD, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, ZIP_DOS_DATE_1980_01_01, true);
    view.setUint32(offset + 16, entry.crc32, true);
    view.setUint32(offset + 20, entry.compressed.byteLength, true);
    view.setUint32(offset + 24, entry.source.byteLength, true);
    view.setUint16(offset + 28, entry.name.byteLength, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index]!, true);
    output.set(entry.name, offset + CENTRAL_DIRECTORY_HEADER_BYTES);
    offset += CENTRAL_DIRECTORY_HEADER_BYTES + entry.name.byteLength;
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

function assertZipEntry(entry: ZipEntry): void {
  if (entry.name.byteLength === 0 || entry.name.byteLength > 0xffff) {
    throw new RangeError('Export ZIP paths must contain between 1 and 65535 UTF-8 bytes.');
  }
  assertZip32(entry.source.byteLength, 'uncompressed file size');
  assertZip32(entry.compressed.byteLength, 'compressed file size');
}

function assertZip32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`ZIP64 is required for ${label} ${value}.`);
  }
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

function normalizeZipDirectory(path: string): string {
  const normalized = normalizeZipPath(path);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function normalizeZipPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/');
}

function clampCompressionLevel(level: number): number {
  if (!Number.isFinite(level)) return 9;
  return Math.max(1, Math.min(9, Math.trunc(level)));
}
