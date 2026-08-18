import type { AnimationEditorProject } from './AnimationEditorProject';
import {
  DEFAULT_PARTICLE_PRODUCTION_BUDGET,
  PARTICLE_INSTANCE_BYTES_2D,
  type Particle2DDescriptor,
  type ParticleProductionBudget,
  type ParticleProductionDiagnostic,
} from './ParticleAuthoringTypes';

export function diagnoseParticle2DProduction(
  descriptor: Particle2DDescriptor,
  project?: AnimationEditorProject,
  budget: ParticleProductionBudget = DEFAULT_PARTICLE_PRODUCTION_BUDGET,
): readonly ParticleProductionDiagnostic[] {
  const diagnostics: ParticleProductionDiagnostic[] = [];
  if (descriptor.maxParticles > budget.previewHardCapacity) diagnostics.push(diagnostic(
    'error', 'E_PARTICLE_CAPACITY_PREVIEW_LIMIT', '$.component.maxParticles',
    `Capacity ${descriptor.maxParticles} exceeds the interactive preview limit ${budget.previewHardCapacity}.`,
    { capacity: descriptor.maxParticles, limit: budget.previewHardCapacity },
  ));
  else if (descriptor.maxParticles > budget.softCapacity) diagnostics.push(diagnostic(
    'warning', 'W_PARTICLE_CAPACITY_SOFT_LIMIT', '$.component.maxParticles',
    `Capacity ${descriptor.maxParticles} exceeds the production soft limit ${budget.softCapacity}.`,
    { capacity: descriptor.maxParticles, limit: budget.softCapacity },
  ));

  const demand = estimatePeakParticleDemand(descriptor);
  if (demand > descriptor.maxParticles) diagnostics.push(diagnostic(
    'warning', 'W_PARTICLE_CAPACITY_PRESSURE', '$.component.maxParticles',
    'Emission demand can exceed capacity; particles will be dropped deterministically.',
    { capacity: descriptor.maxParticles, estimatedDemand: demand },
  ));
  const uploadBytes = Math.min(descriptor.maxParticles, demand) * PARTICLE_INSTANCE_BYTES_2D;
  if (uploadBytes > budget.softUploadBytes) diagnostics.push(diagnostic(
    'warning', 'W_PARTICLE_UPLOAD_BUDGET', '$.component.maxParticles',
    `Worst-case instance upload ${uploadBytes} bytes exceeds the soft per-frame upload budget.`,
    { estimatedBytes: uploadBytes, limit: budget.softUploadBytes },
  ));

  if (descriptor.resource !== undefined && project) {
    const asset = project.assets.find(candidate => candidate.id === descriptor.resource);
    if (!asset) diagnostics.push(diagnostic(
      'error', 'E_PARTICLE_RESOURCE_MISSING', '$.component.resource',
      `Particle texture resource "${descriptor.resource}" does not exist.`, { resource: descriptor.resource },
    ));
    else if (asset.type !== 'image') diagnostics.push(diagnostic(
      'error', 'E_PARTICLE_RESOURCE_NOT_IMAGE', '$.component.resource',
      'Particle texture resource must be an image.', { resource: descriptor.resource },
    ));
  }
  return Object.freeze(diagnostics);
}

export function estimatePeakParticleDemand(descriptor: Particle2DDescriptor): number {
  const maximumLifetime = descriptor.lifetime[1];
  const continuous = Math.ceil(descriptor.emissionRate * maximumLifetime);
  return Math.min(Number.MAX_SAFE_INTEGER, (descriptor.burst ?? 0) + continuous);
}

function diagnostic(
  severity: ParticleProductionDiagnostic['severity'],
  code: ParticleProductionDiagnostic['code'],
  path: string,
  message: string,
  context: Readonly<Record<string, string | number | boolean>>,
): ParticleProductionDiagnostic {
  return Object.freeze({ severity, code, path, message, context: Object.freeze({ ...context }) });
}
