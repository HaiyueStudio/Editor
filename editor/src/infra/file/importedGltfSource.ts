import { EngineError, EngineErrorCode } from '@haiyue/engine';
import { ErrorDomain, ErrorRecovery } from '@haiyue/engine/core';

export interface ImportedGltfSource {
  src: string;
  name: string;
  fileName: string;
  fileType?: string;
  fileSize?: number;
}

export function getLocalFilePath(file: File): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return normalizeLocalPath(relativePath || file.name);
}

export function normalizeLocalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

export function dirname(path: string): string {
  const normalized = normalizeLocalPath(path);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

export function resolveLocalPath(baseDir: string, uri: string): string {
  const parts = normalizeLocalPath(`${baseDir}/${uri}`).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function isEmbeddedOrRemoteUri(uri: string): boolean {
  return /^(data:|blob:|https?:\/\/)/i.test(uri);
}

export function getFileDataUrl(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      reader.abort();
      cleanup();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    reader.onload = () => { cleanup(); resolve(String(reader.result ?? '')); };
    reader.onerror = () => { cleanup(); reject(reader.error ?? new Error(`Failed to read ${file.name}.`)); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    reader.readAsDataURL(file);
  });
}

export async function createImportedGltfSource(files: FileList | File[], signal?: AbortSignal): Promise<ImportedGltfSource> {
  signal?.throwIfAborted();
  const list = Array.from(files);
  if (list.length === 0) throw gltfImportError('No glTF files selected.', 'files');
  const filesByPath = new Map<string, File>();
  for (const file of list) filesByPath.set(getLocalFilePath(file), file);

  const entry = list.find(file => /\.glb$/i.test(file.name))
    ?? list.find(file => /\.gltf$/i.test(file.name));
  if (!entry) throw gltfImportError('Select a .gltf or .glb file.', 'files');

  const name = entry.name.replace(/\.(gltf|glb)$/i, '') || 'glTF Model';
  if (/\.glb$/i.test(entry.name)) {
    return { src: await getFileDataUrl(entry, signal), name, fileName: entry.name, fileType: entry.type, fileSize: entry.size };
  }

  const entryPath = getLocalFilePath(entry);
  const baseDir = dirname(entryPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await entry.text()) as unknown;
    signal?.throwIfAborted();
  } catch (error) {
    throw gltfImportError('Selected glTF file is not valid JSON.', 'gltf', { fileName: entry.name }, error);
  }
  if (!isImportedGltfDocument(parsed)) {
    throw gltfImportError('Selected glTF file has an invalid structure.', 'gltf', { fileName: entry.name });
  }
  const gltf = parsed;
  const dataUrlCache = new Map<File, Promise<string>>();
  const getCachedDataUrl = (file: File): Promise<string> => {
    let promise = dataUrlCache.get(file);
    if (!promise) {
      promise = getFileDataUrl(file, signal);
      dataUrlCache.set(file, promise);
    }
    return promise;
  };
  const rewriteUri = async (uri: unknown): Promise<unknown> => {
    if (typeof uri !== 'string' || isEmbeddedOrRemoteUri(uri)) return uri;
    const normalizedUri = normalizeLocalPath(uri);
    const match = filesByPath.get(resolveLocalPath(baseDir, normalizedUri))
      ?? filesByPath.get(normalizedUri)
      ?? list.find(file => file.name === normalizedUri.split('/').pop());
    return match ? getCachedDataUrl(match) : uri;
  };

  for (const buffer of gltf.buffers ?? []) {
    signal?.throwIfAborted();
    buffer.uri = await rewriteUri(buffer.uri);
  }
  for (const image of gltf.images ?? []) {
    signal?.throwIfAborted();
    image.uri = await rewriteUri(image.uri);
  }

  const bytes = new TextEncoder().encode(JSON.stringify(gltf));
  return {
    src: `data:model/gltf+json;base64,${bytesToBase64(bytes)}`,
    name,
    fileName: entry.name,
    fileType: entry.type,
    fileSize: list.reduce((sum, file) => sum + file.size, 0),
  };
}

interface ImportedGltfDocument {
  asset: { version: string };
  buffers?: Array<{ uri?: unknown }>;
  images?: Array<{ uri?: unknown }>;
}

function isImportedGltfDocument(value: unknown): value is ImportedGltfDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  const asset = document.asset;
  return typeof asset === 'object'
    && asset !== null
    && !Array.isArray(asset)
    && typeof (asset as Record<string, unknown>).version === 'string'
    && ((asset as Record<string, unknown>).version as string).startsWith('2')
    && isUriArray(document.buffers)
    && isUriArray(document.images);
}

function isUriArray(value: unknown): value is Array<{ uri?: unknown }> | undefined {
  return value === undefined || (Array.isArray(value) && value.every(item => typeof item === 'object' && item !== null && !Array.isArray(item)));
}

function gltfImportError(
  message: string,
  path: string,
  context: Record<string, unknown> = {},
  cause?: unknown,
): EngineError {
  return new EngineError(EngineErrorCode.EditorImportFailed, message, {
    domain: ErrorDomain.Editor,
    recovery: ErrorRecovery.Ignore,
    context: { resourceType: 'model/gltf', ...context },
    path,
    cause,
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
