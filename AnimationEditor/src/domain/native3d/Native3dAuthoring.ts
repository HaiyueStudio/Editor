import { validateParticle3DDescriptor } from '../Particle3DAuthoring';
import type { Particle3DAuthoringDescriptor } from '../ParticleAuthoringTypes';
import {
  IDENTITY_NATIVE_3D_TRANSFORM,
  cloneNative3dProject,
  type Native3dAsset,
  type Native3dBinding,
  type Native3dCameraProjection,
  type Native3dKeyframe,
  type Native3dMaterial,
  type Native3dNode,
  type Native3dProject,
  type Native3dTrack,
  type Native3dTransform,
  type Native3dVec3,
  type Native3dVec4,
} from './Native3dProject';
import { parseNative3dProject } from './Native3dProjectCodec';

export class Native3dAuthoringError extends Error {
  readonly name = 'Native3dAuthoringError';

  constructor(readonly path: string, message: string) {
    super(`${message} (${path})`);
  }
}

export function addNative3dAsset(project: Native3dProject, asset: Native3dAsset): Native3dProject {
  return mutate(project, draft => {
    assertUnusedId(draft.assets, asset.id, '$.assets');
    draft.assets.push(mutableClone(asset));
  });
}

export function addNative3dMaterial(project: Native3dProject, material: Native3dMaterial): Native3dProject {
  return mutate(project, draft => {
    assertUnusedId(draft.materials, material.id, '$.materials');
    draft.materials.push(mutableClone(material));
  });
}

export function addNative3dCamera(
  project: Native3dProject,
  options: Readonly<{
    nodeId: string;
    componentId: string;
    name?: string;
    parent?: string;
    transform?: Native3dTransform;
    projection?: Native3dCameraProjection;
  }>,
): Native3dProject {
  return addNode(project, {
    id: options.nodeId,
    name: options.name ?? '摄像机',
    ...(options.parent ? { parent: options.parent } : {}),
    transform: options.transform ?? IDENTITY_NATIVE_3D_TRANSFORM,
    components: [{
      id: options.componentId,
      kind: 'camera3d',
      projection: options.projection ?? { kind: 'perspective', fovYRadians: Math.PI / 4, near: 0.1, far: 100 },
    }],
  });
}

export function addNative3dPrimitive(
  project: Native3dProject,
  options: Readonly<{
    nodeId: string;
    componentId: string;
    name?: string;
    parent?: string;
    primitive: 'box' | 'sphere' | 'plane' | 'cylinder' | 'cone';
    materialId: string;
    transform?: Native3dTransform;
  }>,
): Native3dProject {
  return addNode(project, {
    id: options.nodeId,
    name: options.name ?? primitiveName(options.primitive),
    ...(options.parent ? { parent: options.parent } : {}),
    transform: options.transform ?? IDENTITY_NATIVE_3D_TRANSFORM,
    components: [{ id: options.componentId, kind: 'primitive3d', primitive: options.primitive, materialId: options.materialId }],
  });
}

export function addNative3dModel(
  project: Native3dProject,
  options: Readonly<{
    nodeId: string;
    componentId: string;
    resource: string;
    name?: string;
    parent?: string;
    transform?: Native3dTransform;
    materialOverrides?: readonly Readonly<{ slot: string; materialId: string }>[];
  }>,
): Native3dProject {
  return addNode(project, {
    id: options.nodeId,
    name: options.name ?? '模型',
    ...(options.parent ? { parent: options.parent } : {}),
    transform: options.transform ?? IDENTITY_NATIVE_3D_TRANSFORM,
    components: [{
      id: options.componentId,
      kind: 'model3d',
      resource: options.resource,
      ...(options.materialOverrides ? { materialOverrides: options.materialOverrides } : {}),
    }],
  });
}

export function addNative3dParticle(
  project: Native3dProject,
  options: Readonly<{
    nodeId: string;
    componentId: string;
    descriptor: Particle3DAuthoringDescriptor;
    name?: string;
    parent?: string;
    transform?: Native3dTransform;
  }>,
): Native3dProject {
  const descriptor = validateParticle3DDescriptor(options.descriptor);
  return addNode(project, {
    id: options.nodeId,
    name: options.name ?? '粒子',
    ...(options.parent ? { parent: options.parent } : {}),
    transform: options.transform ?? IDENTITY_NATIVE_3D_TRANSFORM,
    components: [{ id: options.componentId, kind: 'particle3d', descriptor }],
  });
}

export function setNative3dNodeTransform(
  project: Native3dProject,
  nodeId: string,
  patch: Readonly<{
    translation?: Native3dVec3;
    rotation?: Native3dVec4;
    eulerYXZ?: Native3dVec3;
    scale?: Native3dVec3;
  }>,
): Native3dProject {
  if (patch.rotation && patch.eulerYXZ) throw new Native3dAuthoringError('$.nodes.transform.rotation', 'Specify quaternion or Euler input, not both.');
  return mutate(project, draft => {
    const index = draft.nodes.findIndex(node => node.id === nodeId);
    if (index < 0) throw new Native3dAuthoringError('$.nodes', `Unknown node "${nodeId}".`);
    const current = draft.nodes[index]!.transform;
    draft.nodes[index]!.transform = {
      translation: mutableClone(patch.translation ?? current.translation),
      rotation: mutableClone(patch.rotation ? normalizeNative3dQuaternion(patch.rotation)
        : patch.eulerYXZ ? native3dEulerYXZToQuaternion(patch.eulerYXZ)
          : current.rotation),
      scale: mutableClone(patch.scale ?? current.scale),
    };
  });
}

export function setNative3dCameraProjection(
  project: Native3dProject,
  componentId: string,
  projection: Native3dCameraProjection,
): Native3dProject {
  return mutate(project, draft => {
    for (const node of draft.nodes) {
      const index = node.components.findIndex(component => component.id === componentId && component.kind === 'camera3d');
      if (index >= 0) {
        node.components[index] = { id: componentId, kind: 'camera3d', projection: mutableClone(projection) };
        return;
      }
    }
    throw new Native3dAuthoringError('$.nodes.components', `Unknown Camera3D component "${componentId}".`);
  });
}

export function updateNative3dMaterial(
  project: Native3dProject,
  materialId: string,
  patch: Partial<Omit<Native3dMaterial, 'id'>>,
): Native3dProject {
  return mutate(project, draft => {
    const index = draft.materials.findIndex(material => material.id === materialId);
    if (index < 0) throw new Native3dAuthoringError('$.materials', `Unknown material "${materialId}".`);
    draft.materials[index] = { ...draft.materials[index]!, ...mutableClone(patch), id: materialId };
  });
}

export function createNative3dClip(
  project: Native3dProject,
  options: Readonly<{ id: string; name?: string; duration?: number }>,
): Native3dProject {
  return mutate(project, draft => {
    assertUnusedId(draft.timeline.clips, options.id, '$.timeline.clips');
    draft.timeline.clips.push({
      id: options.id,
      name: options.name ?? '动画片段',
      duration: options.duration ?? draft.composition.duration,
      tracks: [],
      events: [],
    });
    draft.editor ??= {};
    draft.editor.activeClipId = options.id;
  });
}

export function createNative3dTrack(
  project: Native3dProject,
  clipId: string,
  track: Omit<Native3dTrack, 'keyframes'> & Readonly<{ keyframes?: readonly Native3dKeyframe[] }>,
): Native3dProject {
  return mutate(project, draft => {
    const clip = draft.timeline.clips.find(item => item.id === clipId);
    if (!clip) throw new Native3dAuthoringError('$.timeline.clips', `Unknown clip "${clipId}".`);
    assertUnusedId(clip.tracks, track.id, '$.timeline.clips.tracks');
    clip.tracks.push({ ...mutableClone(track), keyframes: mutableClone(track.keyframes ?? []) });
  }, false);
}

export function upsertNative3dKeyframe(
  project: Native3dProject,
  clipId: string,
  trackId: string,
  keyframe: Native3dKeyframe,
): Native3dProject {
  return mutate(project, draft => {
    const clip = draft.timeline.clips.find(item => item.id === clipId);
    const track = clip?.tracks.find(item => item.id === trackId);
    if (!track) throw new Native3dAuthoringError('$.timeline.clips.tracks', `Unknown track "${trackId}".`);
    const existing = track.keyframes.findIndex(item => item.id === keyframe.id);
    if (existing >= 0) track.keyframes[existing] = mutableClone(keyframe);
    else track.keyframes.push(mutableClone(keyframe));
    track.keyframes.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  });
}

export function removeNative3dNode(project: Native3dProject, nodeId: string): Native3dProject {
  return mutate(project, draft => {
    const removed = new Set<string>();
    const collect = (id: string): void => {
      if (removed.has(id)) return;
      removed.add(id);
      for (const node of draft.nodes) if (node.parent === id) collect(node.id);
    };
    collect(nodeId);
    if (!draft.nodes.some(node => removed.has(node.id))) throw new Native3dAuthoringError('$.nodes', `Unknown node "${nodeId}".`);
    draft.nodes = draft.nodes.filter(node => !removed.has(node.id));
    if (draft.editor?.selectedNodeIds) {
      draft.editor.selectedNodeIds = draft.editor.selectedNodeIds.filter(id => !removed.has(id));
    }
    for (const clip of draft.timeline.clips) {
      clip.tracks = clip.tracks.filter(track => {
        const target = track.binding.target;
        return target.kind === 'slot' || !removed.has(target.kind === 'node-id' ? target.nodeId : target.segments[0]!);
      });
    }
  });
}

/** UI Euler input uses the engine's documented yaw(Y) → pitch(X) → roll(Z) order. */
export function native3dEulerYXZToQuaternion(euler: Native3dVec3): Native3dVec4 {
  const [x, y, z] = euler;
  const hx = x * 0.5;
  const hy = y * 0.5;
  const hz = z * 0.5;
  const sx = Math.sin(hx), cx = Math.cos(hx);
  const sy = Math.sin(hy), cy = Math.cos(hy);
  const sz = Math.sin(hz), cz = Math.cos(hz);
  return normalizeNative3dQuaternion([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]);
}

export function normalizeNative3dQuaternion(value: Native3dVec4): Native3dVec4 {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length <= 1e-8) throw new Native3dAuthoringError('$.rotation', 'Quaternion length must be finite and non-zero.');
  return Object.freeze([value[0] / length, value[1] / length, value[2] / length, value[3] / length]);
}

function addNode(project: Native3dProject, node: Native3dNode): Native3dProject {
  return mutate(project, draft => {
    assertUnusedId(draft.nodes, node.id, '$.nodes');
    if (node.parent && !draft.nodes.some(candidate => candidate.id === node.parent)) throw new Native3dAuthoringError('$.nodes.parent', `Unknown parent "${node.parent}".`);
    const componentIds = new Set(draft.nodes.flatMap(candidate => candidate.components.map(component => component.id)));
    for (const component of node.components) if (componentIds.has(component.id)) throw new Native3dAuthoringError('$.nodes.components.id', `Component id "${component.id}" already exists.`);
    draft.nodes.push(mutableClone(node));
    draft.editor ??= {};
    draft.editor.selectedNodeIds = [node.id];
  });
}

function mutate(project: Native3dProject, operation: (draft: MutableProject) => void, validate = true): Native3dProject {
  const draft = cloneNative3dProject(project) as unknown as MutableProject;
  operation(draft);
  return validate ? parseNative3dProject(draft) : draft as unknown as Native3dProject;
}

function assertUnusedId(items: readonly Readonly<{ id: string }>[], id: string, path: string): void {
  if (!id) throw new Native3dAuthoringError(path, 'Id must not be empty.');
  if (items.some(item => item.id === id)) throw new Native3dAuthoringError(path, `Id "${id}" already exists.`);
}

function primitiveName(value: 'box' | 'sphere' | 'plane' | 'cylinder' | 'cone'): string {
  return ({ box: '立方体', sphere: '球体', plane: '平面', cylinder: '圆柱体', cone: '圆锥体' } as const)[value];
}

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

type Mutable<T> = T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
type MutableProject = Mutable<Native3dProject>;
