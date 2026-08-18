import type { AnimationParticle2DComponent } from '@haiyue/animation-spec';

export const PARTICLE_MAX_CAPACITY = 1_000_000;
export const PARTICLE_PREVIEW_SOFT_CAPACITY = 16_384;
export const PARTICLE_PREVIEW_HARD_CAPACITY = 131_072;
export const PARTICLE_INSTANCE_BYTES_2D = 8 * Float32Array.BYTES_PER_ELEMENT;

export type Particle2DDescriptor = Readonly<AnimationParticle2DComponent>;
export type ParticleScalarRange = readonly [number, number];
export type ParticleColor = readonly [number, number, number, number];

export type ParticleAuthoringDiagnosticCode =
  | 'E_PARTICLE_COMPONENT'
  | 'E_PARTICLE_CAPACITY'
  | 'E_PARTICLE_NUMBER'
  | 'E_PARTICLE_INTEGER'
  | 'E_PARTICLE_RANGE'
  | 'E_PARTICLE_COLOR'
  | 'E_PARTICLE_SHAPE'
  | 'E_PARTICLE_RESOURCE'
  | 'E_PARTICLE_RESOURCE_TYPE'
  | 'E_PARTICLE_PREVIEW_DISPOSED'
  | 'E_PARTICLE_RESOURCE_REPLACED'
  | 'E_PARTICLE_RESOURCE_DECODE';

export class ParticleAuthoringError extends Error {
  readonly name = 'ParticleAuthoringError';

  constructor(
    readonly code: ParticleAuthoringDiagnosticCode,
    readonly path: string,
    message: string,
    readonly context: Readonly<Record<string, string | number | boolean>> = Object.freeze({}),
  ) {
    super(message);
  }
}

export type ParticleProductionDiagnosticCode =
  | 'W_PARTICLE_CAPACITY_SOFT_LIMIT'
  | 'E_PARTICLE_CAPACITY_PREVIEW_LIMIT'
  | 'W_PARTICLE_CAPACITY_PRESSURE'
  | 'W_PARTICLE_UPLOAD_BUDGET'
  | 'E_PARTICLE_RESOURCE_MISSING'
  | 'E_PARTICLE_RESOURCE_NOT_IMAGE';

export interface ParticleProductionDiagnostic {
  readonly severity: 'warning' | 'error';
  readonly code: ParticleProductionDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export interface ParticleProductionBudget {
  readonly softCapacity: number;
  readonly previewHardCapacity: number;
  readonly softUploadBytes: number;
}

export const DEFAULT_PARTICLE_PRODUCTION_BUDGET: ParticleProductionBudget = Object.freeze({
  softCapacity: PARTICLE_PREVIEW_SOFT_CAPACITY,
  previewHardCapacity: PARTICLE_PREVIEW_HARD_CAPACITY,
  softUploadBytes: 512 * 1024,
});

/** Frozen HYA start/end channels are linear over normalized particle lifetime. */
export interface ParticleLifetimeProfile {
  readonly interpolation: 'linear';
  readonly size: Readonly<{ from: ParticleScalarRange; to: ParticleScalarRange }>;
  readonly color: Readonly<{ from: ParticleColor; to: ParticleColor }>;
  readonly opacity: Readonly<{ from: number; to: number }>;
  readonly rotation: Particle2DRotationProfile | Particle3DRotationProfile;
}

export interface Particle2DRotationProfile {
  readonly dimension: '2d';
  readonly mode: 'align-velocity' | 'fixed';
  readonly initialVelocityAngle: ParticleScalarRange;
}

export interface Particle3DRotationProfile {
  readonly dimension: '3d';
  readonly initial: ParticleScalarRange;
  readonly angularVelocity: ParticleScalarRange;
}

/** Matches the frozen native-3D schema and engine ParticleEmitter3D data options. */
export interface Particle3DAuthoringDescriptor {
  readonly maxParticles: number;
  readonly emissionRate: number;
  readonly burst: number;
  readonly duration: number;
  readonly loop: boolean;
  readonly seed: number;
  readonly lifetime: ParticleScalarRange;
  readonly speed: ParticleScalarRange;
  readonly direction: readonly [number, number, number];
  readonly spread: number;
  readonly gravity: readonly [number, number, number];
  readonly startSize: ParticleScalarRange;
  readonly endSize: ParticleScalarRange;
  readonly rotation: ParticleScalarRange;
  readonly angularVelocity: ParticleScalarRange;
  readonly startColor: ParticleColor;
  readonly endColor: ParticleColor;
  readonly shape: 'point' | 'box' | 'sphere';
  readonly shapeSize?: readonly [number, number, number];
  readonly shapeRadius?: number;
  readonly blendMode: 'normal' | 'additive';
  readonly textureResource?: string;
  readonly radial: boolean;
  readonly opacity: number;
  readonly depthTest: boolean;
  readonly depthWrite: boolean;
  readonly sortMode: 'none' | 'back-to-front';
}

export interface ParticlePreviewStatistics {
  readonly canonicalTime: number;
  readonly alive: number;
  readonly capacity: number;
  readonly spawned: number;
  readonly dropped: number;
  readonly drawCalls: number;
  readonly uploadedBytes: number;
  readonly renderStatistics: 'engine-projected' | 'gpu-runtime';
  readonly rebuilds: number;
  readonly reverseScrubs: number;
  readonly listenerCount: number;
  readonly liveResourceCount: number;
  readonly diagnostics: readonly ParticleProductionDiagnostic[];
}

export interface ParticleStateSnapshot {
  readonly canonicalTime: number;
  readonly alive: number;
  readonly fingerprint: string;
  readonly instanceData: Float32Array;
}
