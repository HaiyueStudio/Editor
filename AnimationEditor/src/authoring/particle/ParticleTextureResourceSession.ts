import { ParticleAuthoringError } from '../../domain/ParticleAuthoringTypes';

export interface ParticleDecodedTexture {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close?(): void;
}

export interface ParticleTextureLoader {
  load(source: unknown, signal: AbortSignal): Promise<ParticleDecodedTexture>;
}

export interface ParticleTextureResourceMetrics {
  readonly loadRequests: number;
  readonly successfulLoads: number;
  readonly abortedLoads: number;
  readonly staleLoads: number;
  readonly failedLoads: number;
  readonly disposedTextures: number;
  readonly liveTextures: number;
  readonly peakLiveTextures: number;
  readonly perFrameResources: 0;
}

type MutableMetrics = {
  -readonly [Key in Exclude<keyof ParticleTextureResourceMetrics, 'perFrameResources'>]: ParticleTextureResourceMetrics[Key];
};

/** Latest-wins decoded texture owner for the authoring canvas. */
export class ParticleTextureResourceSession {
  private _texture: ParticleDecodedTexture | null = null;
  private _controller: AbortController | null = null;
  private _generation = 0;
  private _disposed = false;
  private readonly _metrics: MutableMetrics = {
    loadRequests: 0,
    successfulLoads: 0,
    abortedLoads: 0,
    staleLoads: 0,
    failedLoads: 0,
    disposedTextures: 0,
    liveTextures: 0,
    peakLiveTextures: 0,
  };

  constructor(
    private readonly _loader: ParticleTextureLoader,
    private readonly _onChange?: () => void,
  ) {}

  get texture(): ParticleDecodedTexture | null { return this._texture; }
  get metrics(): ParticleTextureResourceMetrics {
    return Object.freeze({ ...this._metrics, perFrameResources: 0 });
  }

  async replace(source: unknown): Promise<ParticleDecodedTexture | null> {
    if (this._disposed) throw new ParticleAuthoringError(
      'E_PARTICLE_RESOURCE_REPLACED', '$.resource', 'Cannot replace a disposed particle texture session.',
    );
    const generation = ++this._generation;
    if (this._controller && !this._controller.signal.aborted) {
      this._controller.abort();
      this._metrics.abortedLoads++;
    }
    const controller = new AbortController();
    this._controller = controller;
    this._metrics.loadRequests++;
    let decoded: ParticleDecodedTexture;
    try {
      decoded = await this._loader.load(source, controller.signal);
    } catch (error) {
      if (this._controller === controller) this._controller = null;
      if (controller.signal.aborted || generation !== this._generation || this._disposed) return null;
      this._metrics.failedLoads++;
      throw new ParticleAuthoringError(
        'E_PARTICLE_RESOURCE_DECODE', '$.resource', error instanceof Error ? error.message : String(error),
      );
    }
    if (controller.signal.aborted || generation !== this._generation || this._disposed) {
      this._metrics.staleLoads++;
      closeTexture(decoded);
      this._metrics.disposedTextures++;
      return null;
    }
    if (this._controller === controller) this._controller = null;
    const previous = this._texture;
    this._texture = decoded;
    this._metrics.successfulLoads++;
    if (previous) {
      closeTexture(previous);
      this._metrics.disposedTextures++;
    } else {
      this._metrics.liveTextures = 1;
      this._metrics.peakLiveTextures = Math.max(this._metrics.peakLiveTextures, 1);
    }
    this._onChange?.();
    return decoded;
  }

  clear(): void {
    this._generation++;
    if (this._controller && !this._controller.signal.aborted) {
      this._controller.abort();
      this._metrics.abortedLoads++;
    }
    this._controller = null;
    if (!this._texture) return;
    closeTexture(this._texture);
    this._texture = null;
    this._metrics.disposedTextures++;
    this._metrics.liveTextures = 0;
    this._onChange?.();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.clear();
  }
}

export function createBrowserParticleTextureLoader(): ParticleTextureLoader {
  return Object.freeze({
    async load(source: unknown, signal: AbortSignal): Promise<ParticleDecodedTexture> {
      const blob = source instanceof Blob
        ? source
        : await fetch(String(source), { signal }).then(response => {
          if (!response.ok) throw new Error(`Particle texture request failed with HTTP ${response.status}.`);
          return response.blob();
        });
      if (signal.aborted) throw abortError();
      const bitmap = await createImageBitmap(blob);
      if (signal.aborted) {
        bitmap.close();
        throw abortError();
      }
      return Object.freeze({ source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() });
    },
  });
}

function closeTexture(texture: ParticleDecodedTexture): void {
  try { texture.close?.(); }
  catch { /* Host disposal stays idempotent. */ }
}

function abortError(): DOMException {
  return new DOMException('Particle texture load aborted.', 'AbortError');
}
