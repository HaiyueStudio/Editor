import { SpriteSheetAuthoringError } from '../../domain/SpriteSheetTypes';

export interface SpriteSheetDecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close?(): void;
}

export interface SpriteSheetImageLoader {
  load(source: unknown, signal: AbortSignal): Promise<SpriteSheetDecodedImage>;
}

export interface SpriteSheetResourceMetrics {
  readonly loadRequests: number;
  readonly successfulLoads: number;
  readonly abortedLoads: number;
  readonly staleLoads: number;
  readonly disposedImages: number;
  readonly liveImages: number;
  readonly peakLiveImages: number;
  readonly perFrameResources: 0;
}

type MutableResourceMetrics = {
  -readonly [Key in Exclude<keyof SpriteSheetResourceMetrics, 'perFrameResources'>]: SpriteSheetResourceMetrics[Key];
};

/** Owns exactly one decoded atlas image and makes asynchronous replacement race-safe. */
export class SpriteSheetResourceSession {
  private readonly _loader: SpriteSheetImageLoader;
  private readonly _onChange: (() => void) | undefined;
  private _image: SpriteSheetDecodedImage | null = null;
  private _controller: AbortController | null = null;
  private _generation = 0;
  private _disposed = false;
  private readonly _metrics: MutableResourceMetrics = {
    loadRequests: 0,
    successfulLoads: 0,
    abortedLoads: 0,
    staleLoads: 0,
    disposedImages: 0,
    liveImages: 0,
    peakLiveImages: 0,
  };

  constructor(loader: SpriteSheetImageLoader, onChange?: () => void) {
    this._loader = loader;
    this._onChange = onChange;
  }

  get image(): SpriteSheetDecodedImage | null { return this._image; }
  get metrics(): SpriteSheetResourceMetrics {
    return Object.freeze({ ...this._metrics, perFrameResources: 0 });
  }

  async replace(
    source: unknown,
    validate?: (image: SpriteSheetDecodedImage) => void,
  ): Promise<SpriteSheetDecodedImage | null> {
    if (this._disposed) throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_RESOURCE_REPLACED', '$.resource', 'Cannot replace a disposed SpriteSheet resource session.',
    );
    const generation = ++this._generation;
    if (this._controller) {
      this._controller.abort();
      this._metrics.abortedLoads++;
    }
    this._controller = new AbortController();
    const controller = this._controller;
    this._metrics.loadRequests++;
    let decoded: SpriteSheetDecodedImage;
    try {
      decoded = await this._loader.load(source, controller.signal);
    } catch (error) {
      if (this._controller === controller) this._controller = null;
      if (controller.signal.aborted || generation !== this._generation || this._disposed) return null;
      throw new SpriteSheetAuthoringError(
        'E_SPRITESHEET_RESOURCE_DECODE', '$.resource', error instanceof Error ? error.message : String(error),
      );
    }
    if (controller.signal.aborted || generation !== this._generation || this._disposed) {
      this._metrics.staleLoads++;
      closeDecodedImage(decoded);
      this._metrics.disposedImages++;
      return null;
    }
    try {
      validate?.(decoded);
    } catch (error) {
      if (this._controller === controller) this._controller = null;
      closeDecodedImage(decoded);
      this._metrics.disposedImages++;
      throw error;
    }
    if (this._controller === controller) this._controller = null;
    const previous = this._image;
    this._image = decoded;
    this._metrics.successfulLoads++;
    if (previous) {
      closeDecodedImage(previous);
      this._metrics.disposedImages++;
    } else {
      this._metrics.liveImages = 1;
      this._metrics.peakLiveImages = Math.max(this._metrics.peakLiveImages, 1);
    }
    this._onChange?.();
    return decoded;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._generation++;
    if (this._controller && !this._controller.signal.aborted) {
      this._controller.abort();
      this._metrics.abortedLoads++;
    }
    this._controller = null;
    if (this._image) {
      closeDecodedImage(this._image);
      this._image = null;
      this._metrics.disposedImages++;
      this._metrics.liveImages = 0;
    }
  }
}

export function createBrowserSpriteSheetImageLoader(): SpriteSheetImageLoader {
  return Object.freeze({
    async load(source: unknown, signal: AbortSignal): Promise<SpriteSheetDecodedImage> {
      const blob = source instanceof Blob
        ? source
        : await fetch(String(source), { signal }).then(response => {
          if (!response.ok) throw new Error(`SpriteSheet image request failed with HTTP ${response.status}.`);
          return response.blob();
        });
      if (signal.aborted) throw new DOMException('SpriteSheet image load aborted.', 'AbortError');
      const bitmap = await createImageBitmap(blob);
      if (signal.aborted) {
        bitmap.close();
        throw new DOMException('SpriteSheet image decode aborted.', 'AbortError');
      }
      return Object.freeze({ source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() });
    },
  });
}

function closeDecodedImage(image: SpriteSheetDecodedImage): void {
  try { image.close?.(); }
  catch { /* Disposal remains idempotent even for host image implementations. */ }
}
