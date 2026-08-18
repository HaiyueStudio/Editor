import type { TextureSource } from '../../types';
import { isCompressedTextureSource, type CompressedTextureSourceDescriptor } from '@haiyue/engine/assets';

export function canvasSourceToDataUrl(
  source: CanvasImageSource,
  getCanvasSourceSize: (source: CanvasImageSource) => { width: number; height: number },
): string | null {
  const size = getCanvasSourceSize(source);
  const canvasElement = document.createElement('canvas');
  canvasElement.width = Math.max(1, Math.floor(size.width));
  canvasElement.height = Math.max(1, Math.floor(size.height));
  const context = canvasElement.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(source, 0, 0);
    return canvasElement.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      reader.abort();
      cleanup();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    reader.addEventListener('load', () => { cleanup(); resolve(String(reader.result)); }, { once: true });
    reader.addEventListener('error', () => { cleanup(); reject(reader.error ?? new Error('Failed to read blob.')); }, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    reader.readAsDataURL(blob);
  });
}

export async function textureSourceToSerializableUrl(
  source: TextureSource,
  options: {
    isGPUTexture: (value: unknown) => value is GPUTexture;
    getCanvasSourceSize: (source: CanvasImageSource) => { width: number; height: number };
    signal?: AbortSignal;
  },
): Promise<string | CompressedTextureSourceDescriptor | null> {
  options.signal?.throwIfAborted();
  if (isCompressedTextureSource(source)) return { ...source };
  if (options.isGPUTexture(source)) return null;
  if (source instanceof ImageBitmap || source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
    return canvasSourceToDataUrl(source, options.getCanvasSourceSize);
  }
  if (typeof source !== 'string') return null;
  try {
    const response = await fetch(source, options.signal === undefined ? undefined : { signal: options.signal });
    if (!response.ok) return source;
    return await blobToDataUrl(await response.blob(), options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return source;
  }
}
