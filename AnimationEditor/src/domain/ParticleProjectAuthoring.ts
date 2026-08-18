import type { AnimationParticle2DComponent } from '@haiyue/animation-spec';
import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorComponentRecord,
  type AnimationEditorProject,
  type DeepMutable,
} from './AnimationEditorProject';
import {
  PARTICLE_MAX_CAPACITY,
  ParticleAuthoringError,
  type Particle2DDescriptor,
  type ParticleColor,
  type ParticleScalarRange,
} from './ParticleAuthoringTypes';

export type Particle2DAuthoringEdit = Partial<Omit<AnimationParticle2DComponent, 'type'>>;

export const DEFAULT_PARTICLE_2D_DESCRIPTOR: Particle2DDescriptor = Object.freeze({
  type: 'particle2d',
  maxParticles: 1024,
  emissionRate: 60,
  burst: 12,
  duration: 2,
  loop: true,
  seed: 1,
  lifetime: Object.freeze([0.6, 1.4] as const),
  speed: Object.freeze([40, 100] as const),
  angle: Object.freeze([-Math.PI, 0] as const),
  gravity: Object.freeze([0, 80] as const),
  startSize: Object.freeze([10, 18] as const),
  endSize: Object.freeze([0, 4] as const),
  startColor: Object.freeze([1, 0.8, 0.2, 1] as const),
  endColor: Object.freeze([1, 0.15, 0.02, 0] as const),
  shape: 'point',
  shapeSize: Object.freeze([0, 0] as const),
  shapeRadius: 0,
  blendMode: 'additive',
  radial: true,
});

export function createParticle2DComponentRecord(
  id: string,
  descriptor: Particle2DDescriptor = DEFAULT_PARTICLE_2D_DESCRIPTOR,
  name = 'Particle Emitter',
): DeepMutable<AnimationEditorComponentRecord> {
  const component = validateParticle2DDescriptor(descriptor);
  return structuredClone({ id: requiredId(id, '$.component.id'), name, component }) as unknown as DeepMutable<AnimationEditorComponentRecord>;
}

export function addParticle2DComponent(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  descriptor: Particle2DDescriptor = DEFAULT_PARTICLE_2D_DESCRIPTOR,
): AnimationEditorProject {
  const nodeIndex = project.nodes.findIndex(node => node.id === nodeId);
  if (nodeIndex < 0) throw componentError(nodeId, componentId);
  if (project.nodes[nodeIndex]!.components.some(component => component.id === componentId)) {
    throw new ParticleAuthoringError('E_PARTICLE_COMPONENT', `$.nodes.${nodeId}.components.${componentId}`, 'Particle component id already exists.');
  }
  const draft = cloneAnimationEditorProject(project);
  draft.nodes[nodeIndex]!.components.push(createParticle2DComponentRecord(componentId, descriptor));
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function readParticle2DDescriptor(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
): Particle2DDescriptor {
  const record = findParticleRecord(project, nodeId, componentId);
  return validateParticle2DDescriptor(record.component as unknown as AnimationParticle2DComponent);
}

export function editParticle2DDescriptor(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  edit: Particle2DAuthoringEdit,
): AnimationEditorProject {
  const current = readParticle2DDescriptor(project, nodeId, componentId);
  const next = validateParticle2DDescriptor({ ...current, ...structuredClone(edit), type: 'particle2d' });
  if (next.resource !== undefined) requireImageAsset(project, next.resource, `$.nodes.${nodeId}.components.${componentId}.resource`);
  const draft = cloneAnimationEditorProject(project);
  const node = draft.nodes.find(candidate => candidate.id === nodeId)!;
  const record = node.components.find(candidate => candidate.id === componentId)!;
  record.component = structuredClone(next) as unknown as DeepMutable<typeof record.component>;
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function setParticle2DTextureResource(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  resourceId: string | null,
): AnimationEditorProject {
  if (resourceId !== null) requireImageAsset(project, resourceId, `$.nodes.${nodeId}.components.${componentId}.resource`);
  const current = readParticle2DDescriptor(project, nodeId, componentId);
  const next = { ...current } as AnimationParticle2DComponent;
  if (resourceId === null) delete (next as { resource?: string }).resource;
  else (next as { resource?: string }).resource = resourceId;
  const validated = validateParticle2DDescriptor(next);
  const draft = cloneAnimationEditorProject(project);
  const node = draft.nodes.find(candidate => candidate.id === nodeId)!;
  const record = node.components.find(candidate => candidate.id === componentId)!;
  record.component = structuredClone(validated) as unknown as DeepMutable<typeof record.component>;
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function validateParticle2DDescriptor(value: AnimationParticle2DComponent): Particle2DDescriptor {
  if (!value || value.type !== 'particle2d') {
    throw new ParticleAuthoringError('E_PARTICLE_COMPONENT', '$.component.type', 'Expected a particle2d component.');
  }
  const maxParticles = integer(value.maxParticles, '$.component.maxParticles', 1, PARTICLE_MAX_CAPACITY);
  const result: AnimationParticle2DComponent = {
    type: 'particle2d',
    maxParticles,
    emissionRate: finite(value.emissionRate, '$.component.emissionRate', 0),
    lifetime: range(value.lifetime, '$.component.lifetime', 1e-4),
    speed: range(value.speed, '$.component.speed', 0),
    angle: range(value.angle, '$.component.angle'),
    startSize: range(value.startSize, '$.component.startSize', 0),
    endSize: range(value.endSize, '$.component.endSize', 0),
    startColor: color(value.startColor, '$.component.startColor'),
    endColor: color(value.endColor, '$.component.endColor'),
    ...(value.burst !== undefined ? { burst: integer(value.burst, '$.component.burst', 0, maxParticles) } : {}),
    ...(value.duration !== undefined ? { duration: finite(value.duration, '$.component.duration', Number.MIN_VALUE) } : {}),
    ...(value.loop !== undefined ? { loop: value.loop === true } : {}),
    ...(value.seed !== undefined ? { seed: integer(value.seed, '$.component.seed', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) } : {}),
    ...(value.gravity !== undefined ? { gravity: vec2(value.gravity, '$.component.gravity') } : {}),
    ...(value.shape !== undefined ? { shape: shape(value.shape) } : {}),
    ...(value.shapeSize !== undefined ? { shapeSize: vec2(value.shapeSize, '$.component.shapeSize', 0) } : {}),
    ...(value.shapeRadius !== undefined ? { shapeRadius: finite(value.shapeRadius, '$.component.shapeRadius', 0) } : {}),
    ...(value.blendMode !== undefined ? { blendMode: value.blendMode === 'additive' ? 'additive' : 'normal' } : {}),
    ...(value.resource !== undefined ? { resource: requiredId(value.resource, '$.component.resource') } : {}),
    ...(value.radial !== undefined ? { radial: value.radial === true } : {}),
  };
  return deepFreeze(result);
}

function findParticleRecord(project: AnimationEditorProject, nodeId: string, componentId: string): AnimationEditorComponentRecord {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  const record = node?.components.find(candidate => candidate.id === componentId);
  if (!record || record.component.type !== 'particle2d') throw componentError(nodeId, componentId);
  return record;
}

function requireImageAsset(project: AnimationEditorProject, id: string, path: string): void {
  const asset = project.assets.find(candidate => candidate.id === id);
  if (!asset) throw new ParticleAuthoringError('E_PARTICLE_RESOURCE', path, `Unknown particle texture resource "${id}".`);
  if (asset.type !== 'image') throw new ParticleAuthoringError('E_PARTICLE_RESOURCE_TYPE', path, 'Particle texture resource must be an image.');
}

function componentError(nodeId: string, componentId: string): ParticleAuthoringError {
  return new ParticleAuthoringError(
    'E_PARTICLE_COMPONENT', `$.nodes.${nodeId}.components.${componentId}`, 'Unknown particle2d component.',
  );
}

function requiredId(value: string, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ParticleAuthoringError('E_PARTICLE_RESOURCE', path, 'Expected a non-empty identifier.');
  }
  return value;
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

function range(value: readonly [number, number], path: string, minimum = -Number.MAX_VALUE): ParticleScalarRange {
  if (!Array.isArray(value) || value.length !== 2) throw new ParticleAuthoringError('E_PARTICLE_RANGE', path, 'Expected a two-number range.');
  const a = finite(value[0], `${path}.0`, minimum);
  const b = finite(value[1], `${path}.1`, minimum);
  if (a > b) throw new ParticleAuthoringError('E_PARTICLE_RANGE', path, 'Particle range minimum must not exceed its maximum.');
  return Object.freeze([a, b]);
}

function vec2(value: readonly [number, number], path: string, minimum = -Number.MAX_VALUE): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new ParticleAuthoringError('E_PARTICLE_RANGE', path, 'Expected a two-number vector.');
  return Object.freeze([finite(value[0], `${path}.0`, minimum), finite(value[1], `${path}.1`, minimum)]);
}

function color(value: ParticleColor, path: string): ParticleColor {
  if (!Array.isArray(value) || value.length !== 4) throw new ParticleAuthoringError('E_PARTICLE_COLOR', path, 'Expected an RGBA color.');
  return Object.freeze(value.map((channel, index) => finite(channel, `${path}.${index}`, 0, 1)) as unknown as ParticleColor);
}

function shape(value: string): 'point' | 'box' | 'circle' {
  if (value !== 'point' && value !== 'box' && value !== 'circle') {
    throw new ParticleAuthoringError('E_PARTICLE_SHAPE', '$.component.shape', 'Particle shape must be point, box or circle.');
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
