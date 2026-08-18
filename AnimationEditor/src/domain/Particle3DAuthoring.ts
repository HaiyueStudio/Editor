import type { ParticleEmitter3DOptions } from '@haiyue/engine/components';
import {
  PARTICLE_MAX_CAPACITY,
  ParticleAuthoringError,
  type Particle3DAuthoringDescriptor,
  type ParticleColor,
  type ParticleLifetimeProfile,
  type ParticleScalarRange,
} from './ParticleAuthoringTypes';

export const DEFAULT_PARTICLE_3D_DESCRIPTOR: Particle3DAuthoringDescriptor = Object.freeze({
  maxParticles: 2048,
  emissionRate: 60,
  burst: 12,
  duration: 2,
  loop: true,
  seed: 1,
  lifetime: Object.freeze([0.6, 1.4] as const),
  speed: Object.freeze([0.5, 2] as const),
  direction: Object.freeze([0, 1, 0] as const),
  spread: Math.PI / 4,
  gravity: Object.freeze([0, -1, 0] as const),
  startSize: Object.freeze([0.08, 0.18] as const),
  endSize: Object.freeze([0, 0.04] as const),
  rotation: Object.freeze([0, Math.PI * 2] as const),
  angularVelocity: Object.freeze([-1, 1] as const),
  startColor: Object.freeze([1, 0.8, 0.2, 1] as const),
  endColor: Object.freeze([1, 0.1, 0, 0] as const),
  shape: 'point',
  shapeSize: Object.freeze([0, 0, 0] as const),
  shapeRadius: 0,
  blendMode: 'additive',
  radial: true,
  opacity: 1,
  depthTest: true,
  depthWrite: false,
  sortMode: 'none',
});

export function particle3DDescriptorToEngineOptions(
  descriptor: Particle3DAuthoringDescriptor,
  texture?: Pick<ParticleEmitter3DOptions, 'texture' | 'textureSource'>,
): ParticleEmitter3DOptions {
  const value = validateParticle3DDescriptor(descriptor);
  return {
    maxParticles: value.maxParticles,
    emissionRate: value.emissionRate,
    burst: value.burst,
    duration: value.duration,
    loop: value.loop,
    seed: value.seed,
    lifetime: value.lifetime,
    speed: value.speed,
    direction: value.direction,
    spread: value.spread,
    gravity: value.gravity,
    startSize: value.startSize,
    endSize: value.endSize,
    rotation: value.rotation,
    angularVelocity: value.angularVelocity,
    startColor: value.startColor,
    endColor: value.endColor,
    shape: value.shape,
    ...(value.shapeSize ? { shapeSize: value.shapeSize } : {}),
    ...(value.shapeRadius !== undefined ? { shapeRadius: value.shapeRadius } : {}),
    blendMode: value.blendMode,
    radial: value.radial,
    opacity: value.opacity,
    depthTest: value.depthTest,
    depthWrite: value.depthWrite,
    sortMode: value.sortMode,
    ...texture,
  };
}

export function validateParticle3DDescriptor(value: Particle3DAuthoringDescriptor): Particle3DAuthoringDescriptor {
  const result: Particle3DAuthoringDescriptor = {
    maxParticles: integer(value.maxParticles, '$.descriptor.maxParticles', 1, PARTICLE_MAX_CAPACITY),
    emissionRate: finite(value.emissionRate, '$.descriptor.emissionRate', 0),
    burst: integer(value.burst, '$.descriptor.burst', 0, value.maxParticles),
    duration: finite(value.duration, '$.descriptor.duration', Number.MIN_VALUE),
    loop: value.loop === true,
    seed: integer(value.seed, '$.descriptor.seed', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    lifetime: range(value.lifetime, '$.descriptor.lifetime', 1e-4),
    speed: range(value.speed, '$.descriptor.speed', 0),
    direction: vec3(value.direction, '$.descriptor.direction'),
    spread: finite(value.spread, '$.descriptor.spread', 0, Math.PI),
    gravity: vec3(value.gravity, '$.descriptor.gravity'),
    startSize: range(value.startSize, '$.descriptor.startSize', 0),
    endSize: range(value.endSize, '$.descriptor.endSize', 0),
    rotation: range(value.rotation, '$.descriptor.rotation'),
    angularVelocity: range(value.angularVelocity, '$.descriptor.angularVelocity'),
    startColor: color(value.startColor, '$.descriptor.startColor'),
    endColor: color(value.endColor, '$.descriptor.endColor'),
    shape: shape(value.shape),
    ...(value.shapeSize ? { shapeSize: vec3(value.shapeSize, '$.descriptor.shapeSize', 0) } : {}),
    ...(value.shapeRadius !== undefined ? { shapeRadius: finite(value.shapeRadius, '$.descriptor.shapeRadius', 0) } : {}),
    blendMode: value.blendMode === 'additive' ? 'additive' : 'normal',
    ...(value.textureResource !== undefined ? { textureResource: required(value.textureResource, '$.descriptor.textureResource') } : {}),
    radial: value.radial === true,
    opacity: finite(value.opacity, '$.descriptor.opacity', 0, 1),
    depthTest: value.depthTest === true,
    depthWrite: value.depthWrite === true,
    sortMode: value.sortMode === 'back-to-front' ? 'back-to-front' : 'none',
  };
  return deepFreeze(result);
}

export function particle3DLifetimeProfile(descriptor: Particle3DAuthoringDescriptor): ParticleLifetimeProfile {
  const value = validateParticle3DDescriptor(descriptor);
  return Object.freeze({
    interpolation: 'linear',
    size: Object.freeze({ from: value.startSize, to: value.endSize }),
    color: Object.freeze({ from: value.startColor, to: value.endColor }),
    opacity: Object.freeze({ from: value.startColor[3], to: value.endColor[3] }),
    rotation: Object.freeze({ dimension: '3d', initial: value.rotation, angularVelocity: value.angularVelocity }),
  });
}

function finite(value: number, path: string, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ParticleAuthoringError('E_PARTICLE_NUMBER', path, `Expected a finite number in [${minimum}, ${maximum}].`);
  }
  return value;
}

function integer(value: number, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ParticleAuthoringError('E_PARTICLE_INTEGER', path, `Expected a safe integer in [${minimum}, ${maximum}].`);
  }
  return value;
}

function range(value: ParticleScalarRange, path: string, minimum = -Number.MAX_VALUE): ParticleScalarRange {
  if (!Array.isArray(value) || value.length !== 2) throw new ParticleAuthoringError('E_PARTICLE_RANGE', path, 'Expected a two-number range.');
  const result = [finite(value[0], `${path}.0`, minimum), finite(value[1], `${path}.1`, minimum)] as const;
  if (result[0] > result[1]) throw new ParticleAuthoringError('E_PARTICLE_RANGE', path, 'Particle range minimum must not exceed its maximum.');
  return Object.freeze(result);
}

function vec3(value: readonly [number, number, number], path: string, minimum = -Number.MAX_VALUE): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new ParticleAuthoringError('E_PARTICLE_RANGE', path, 'Expected a three-number vector.');
  return Object.freeze([
    finite(value[0], `${path}.0`, minimum), finite(value[1], `${path}.1`, minimum), finite(value[2], `${path}.2`, minimum),
  ]);
}

function color(value: ParticleColor, path: string): ParticleColor {
  if (!Array.isArray(value) || value.length !== 4) throw new ParticleAuthoringError('E_PARTICLE_COLOR', path, 'Expected an RGBA color.');
  return Object.freeze(value.map((channel, index) => finite(channel, `${path}.${index}`, 0, 1)) as unknown as ParticleColor);
}

function shape(value: string): 'point' | 'box' | 'sphere' {
  if (value !== 'point' && value !== 'box' && value !== 'sphere') {
    throw new ParticleAuthoringError('E_PARTICLE_SHAPE', '$.descriptor.shape', 'Particle3D shape must be point, box or sphere.');
  }
  return value;
}

function required(value: string, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ParticleAuthoringError('E_PARTICLE_RESOURCE', path, 'Expected a non-empty resource id.');
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
