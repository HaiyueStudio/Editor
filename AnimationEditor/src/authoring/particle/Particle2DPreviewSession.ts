import type { ParticleEmitter2DOptions } from '@haiyue/engine/components';
import { ParticleEmitter2D } from '@haiyue/engine/components';
import { diagnoseParticle2DProduction } from '../../domain/ParticleDiagnostics';
import { validateParticle2DDescriptor } from '../../domain/ParticleProjectAuthoring';
import {
  PARTICLE_INSTANCE_BYTES_2D,
  PARTICLE_PREVIEW_HARD_CAPACITY,
  ParticleAuthoringError,
  type Particle2DDescriptor,
  type ParticlePreviewStatistics,
  type ParticleStateSnapshot,
} from '../../domain/ParticleAuthoringTypes';

class ObservableParticleEmitter2D extends ParticleEmitter2D {
  spawned = 0;
  dropped = 0;

  override emit(count: number): this {
    if (!Number.isFinite(count) || count < 0) return super.emit(count);
    const requested = Math.trunc(count);
    const before = this.activeParticles;
    super.emit(Math.min(requested, this.maxParticles));
    const added = this.activeParticles - before;
    this.spawned += added;
    this.dropped += requested - added;
    return this;
  }

  resetTelemetry(): void {
    this.spawned = 0;
    this.dropped = 0;
  }
}

export interface Particle2DPreviewSessionOptions {
  readonly duration: number;
  readonly loop: boolean;
  readonly project?: Parameters<typeof diagnoseParticle2DProduction>[1];
}

/** Rebuild-only deterministic scrub session backed by the engine emitter. */
export class Particle2DPreviewSession {
  private readonly _descriptor: Particle2DDescriptor;
  private readonly _emitter: ObservableParticleEmitter2D;
  private readonly _duration: number;
  private readonly _loop: boolean;
  private readonly _project: Parameters<typeof diagnoseParticle2DProduction>[1];
  private _canonicalTime = 0;
  private _lastRequestedTime = 0;
  private _rebuilds = 0;
  private _reverseScrubs = 0;
  private _disposed = false;

  constructor(descriptor: Particle2DDescriptor, options: Particle2DPreviewSessionOptions) {
    this._descriptor = validateParticle2DDescriptor(descriptor);
    if (this._descriptor.maxParticles > PARTICLE_PREVIEW_HARD_CAPACITY) throw new ParticleAuthoringError(
      'E_PARTICLE_CAPACITY', '$.component.maxParticles',
      `Capacity exceeds the interactive preview limit ${PARTICLE_PREVIEW_HARD_CAPACITY}.`,
      { capacity: this._descriptor.maxParticles, limit: PARTICLE_PREVIEW_HARD_CAPACITY },
    );
    if (!Number.isFinite(options.duration) || options.duration <= 0) throw new ParticleAuthoringError(
      'E_PARTICLE_NUMBER', '$.composition.duration', 'Preview duration must be positive and finite.',
    );
    this._duration = options.duration;
    this._loop = options.loop;
    this._project = options.project;
    this._emitter = new ObservableParticleEmitter2D({ ...particle2DDescriptorToEngineOptions(this._descriptor), playing: false });
  }

  get descriptor(): Particle2DDescriptor { return this._descriptor; }
  get emitter(): ParticleEmitter2D { return this._emitter; }

  scrub(requestedTime: number): ParticleStateSnapshot {
    this._assertActive();
    if (!Number.isFinite(requestedTime)) throw new ParticleAuthoringError(
      'E_PARTICLE_NUMBER', '$.preview.time', 'Scrub time must be finite.',
    );
    if (requestedTime < this._lastRequestedTime) this._reverseScrubs++;
    this._lastRequestedTime = requestedTime;
    this._canonicalTime = canonicalParticleTime(requestedTime, this._duration, this._loop);
    this._emitter.resetTelemetry();
    this._emitter.seek(this._canonicalTime);
    this._rebuilds++;
    return this.snapshot();
  }

  snapshot(): ParticleStateSnapshot {
    this._assertActive();
    const length = this._emitter.activeParticles * 8;
    const data = this._emitter.instanceData.slice(0, length);
    return Object.freeze({
      canonicalTime: this._canonicalTime,
      alive: this._emitter.activeParticles,
      fingerprint: particleStateFingerprint(data, this._emitter.activeParticles),
      instanceData: data,
    });
  }

  statistics(liveResourceCount = 0): ParticlePreviewStatistics {
    this._assertActive();
    const alive = this._emitter.activeParticles;
    return Object.freeze({
      canonicalTime: this._canonicalTime,
      alive,
      capacity: this._emitter.maxParticles,
      spawned: this._emitter.spawned,
      dropped: this._emitter.dropped,
      drawCalls: alive > 0 ? 1 : 0,
      uploadedBytes: alive * PARTICLE_INSTANCE_BYTES_2D,
      renderStatistics: 'engine-projected',
      rebuilds: this._rebuilds,
      reverseScrubs: this._reverseScrubs,
      listenerCount: 0,
      liveResourceCount,
      diagnostics: diagnoseParticle2DProduction(this._descriptor, this._project),
    });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._emitter.clear();
  }

  private _assertActive(): void {
    if (this._disposed) throw new ParticleAuthoringError(
      'E_PARTICLE_PREVIEW_DISPOSED', '$.preview', 'Particle preview session has been disposed.',
    );
  }
}

export function particle2DDescriptorToEngineOptions(descriptor: Particle2DDescriptor): ParticleEmitter2DOptions {
  const value = validateParticle2DDescriptor(descriptor);
  return Object.freeze({
    maxParticles: value.maxParticles,
    emissionRate: value.emissionRate,
    burst: value.burst ?? 0,
    duration: value.duration ?? Number.POSITIVE_INFINITY,
    loop: value.loop ?? true,
    seed: value.seed ?? 1,
    lifetime: value.lifetime,
    speed: value.speed,
    angle: [-value.angle[1], -value.angle[0]] as const,
    gravity: [value.gravity?.[0] ?? 0, -(value.gravity?.[1] ?? 20)] as const,
    startSize: value.startSize,
    endSize: value.endSize,
    startColor: value.startColor,
    endColor: value.endColor,
    shape: value.shape ?? 'point',
    shapeSize: value.shapeSize ?? ([0, 0] as const),
    shapeRadius: value.shapeRadius ?? 0,
    blendMode: value.blendMode ?? 'normal',
    radial: value.radial ?? true,
  });
}

export function canonicalParticleTime(time: number, duration: number, loop: boolean): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0;
  if (!loop) return Math.max(0, Math.min(duration, time));
  const wrapped = time % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
}

export function particleStateFingerprint(data: Float32Array, alive: number): string {
  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= alive;
  hash = Math.imul(hash, 0x01000193) >>> 0;
  return `${alive}:${hash.toString(16).padStart(8, '0')}`;
}
