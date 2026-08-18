export * from './ParticleAuthoringTypes';
export * from './ParticleProjectAuthoring';
export * from './ParticleDiagnostics';
export * from './Particle3DAuthoring';

import type { Particle2DDescriptor, ParticleLifetimeProfile } from './ParticleAuthoringTypes';
import { validateParticle2DDescriptor } from './ParticleProjectAuthoring';

export function particle2DLifetimeProfile(descriptor: Particle2DDescriptor): ParticleLifetimeProfile {
  const value = validateParticle2DDescriptor(descriptor);
  return Object.freeze({
    interpolation: 'linear',
    size: Object.freeze({ from: value.startSize, to: value.endSize }),
    color: Object.freeze({ from: value.startColor, to: value.endColor }),
    opacity: Object.freeze({ from: value.startColor[3], to: value.endColor[3] }),
    rotation: Object.freeze({
      dimension: '2d',
      mode: value.radial === false ? 'fixed' : 'align-velocity',
      initialVelocityAngle: value.angle,
    }),
  });
}
