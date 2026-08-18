import { evaluateAnimationInstance } from './animation';
import {
  buildGltfAsset,
  encodeGltfAssetAsGlb,
} from './gltfExporter';
import type { BuiltGltfAsset, GlbExportResult, GltfExportProgress } from './gltfExporter';
import type {
  PbrPaletteMaterial,
  SceneSize,
  Voxel,
  VoxelAnimationClip,
  VoxelModuleData,
  VoxelModuleInstance,
  VoxelProject,
} from './model';
import { DEFAULT_LAYER_ID, VoxelDocument } from './model';

export type GlbSceneExportMode = 'merged' | 'instances';

export interface GlbSceneExportOptions {
  mode: GlbSceneExportMode;
  includeAnimations?: boolean;
}

export interface GlbSceneExportResult extends GlbExportResult {
  nodeCount: number;
  meshCount: number;
  animationCount: number;
  instanceCount: number;
}

interface JsonAccessor { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }
interface JsonBufferView { buffer: number; byteOffset: number; byteLength: number; target?: number }
interface JsonMesh { name?: string; primitives: Array<Record<string, unknown>> }
interface JsonNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: Record<string, unknown>;
}
interface SceneBuildState {
  chunks: Uint8Array[];
  offsets: number[];
  byteLength: number;
  accessors: JsonAccessor[];
  bufferViews: JsonBufferView[];
  materials: Array<Record<string, unknown>>;
  meshes: JsonMesh[];
  nodes: JsonNode[];
  exposedFaceCount: number;
  vertexCount: number;
  triangleCount: number;
}

export function exportVoxelProjectAsGlb(
  project: Readonly<VoxelProject>,
  options: Readonly<GlbSceneExportOptions>,
  onProgress?: GltfExportProgress,
): GlbSceneExportResult {
  if (options.mode === 'merged') {
    const document = new VoxelDocument(project.size);
    document.load(project);
    const built = buildGltfAsset(
      document.size,
      document.sceneVoxels.values(),
      document.paletteMaterials,
      onProgress,
    );
    const result = encodeGltfAssetAsGlb(built, onProgress);
    return { ...result, nodeCount: 1, meshCount: 1, animationCount: 0, instanceCount: 0 };
  }
  return exportInstancedProject(project, options.includeAnimations !== false, onProgress);
}

function exportInstancedProject(
  project: Readonly<VoxelProject>,
  includeAnimations: boolean,
  onProgress?: GltfExportProgress,
): GlbSceneExportResult {
  const palette = project.palette ?? [];
  const modules = new Map((project.modules ?? []).map(module => [module.id, module]));
  const instances = project.moduleInstances ?? [];
  const animations = includeAnimations ? project.animations ?? [] : [];
  const state: SceneBuildState = {
    chunks: [], offsets: [], byteLength: 0,
    accessors: [], bufferViews: [], materials: [], meshes: [], nodes: [],
    exposedFaceCount: 0, vertexCount: 0, triangleCount: 0,
  };
  const root: JsonNode = { name: 'Voxel Scene', children: [], extras: { haiyueExportMode: 'instances' } };
  state.nodes.push(root);
  onProgress?.(0.03);

  const layers = project.layers ?? [];
  const visibleLayerIds = new Set(layers.filter(layer => layer.visible).map(layer => layer.id));
  const layerIsVisible = (layerId: string | undefined): boolean => layers.length === 0 || visibleLayerIds.has(layerId ?? DEFAULT_LAYER_ID);
  const baseVoxels = project.voxels.filter(voxel => layerIsVisible(voxel.layerId));
  if (baseVoxels.length > 0) {
    const mesh = appendVoxelMesh(state, project.size, baseVoxels, palette, 'Scene Voxels');
    const node = state.nodes.length;
    state.nodes.push({
      name: 'Scene Voxels', mesh,
      translation: [-project.size.x / 2, 0, -project.size.z / 2],
      extras: { haiyueSource: 'base-voxels' },
    });
    root.children!.push(node);
  }

  const meshByModuleId = new Map<string, number>();
  const meshForModule = (moduleId: string): number | null => {
    const existing = meshByModuleId.get(moduleId);
    if (existing !== undefined) return existing;
    const module = modules.get(moduleId);
    if (!module || module.voxels.length === 0) return null;
    const mesh = appendVoxelMesh(state, module.size, module.voxels, palette, module.name);
    meshByModuleId.set(moduleId, mesh);
    return mesh;
  };
  const nodeByVariant = new Map<string, number>();
  const moduleIdsByInstance = new Map<string, Set<string>>();
  for (const instance of instances) moduleIdsByInstance.set(instance.id, new Set([instance.moduleId]));
  for (const clip of animations) for (const track of clip.tracks) {
    const variants = moduleIdsByInstance.get(track.instanceId);
    if (!variants) continue;
    for (const keyframe of track.keyframes) variants.add(keyframe.moduleId);
  }

  for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex += 1) {
    const instance = instances[instanceIndex]!;
    const instanceLayerVisible = layerIsVisible(instance.layerId);
    for (const moduleId of moduleIdsByInstance.get(instance.id) ?? []) {
      const module = modules.get(moduleId);
      const mesh = meshForModule(moduleId);
      if (!module || mesh === null) continue;
      const active = moduleId === instance.moduleId && instance.visible && instanceLayerVisible;
      const transform = instanceTransform(module.size, instance, project.size, active);
      const nodeIndex = state.nodes.length;
      state.nodes.push({
        name: `${instance.name} · ${module.name}`,
        mesh,
        ...transform,
        extras: {
          haiyueSource: 'module-instance',
          haiyueInstanceId: instance.id,
          haiyueModuleId: moduleId,
          haiyueLayerId: instance.layerId,
          haiyueLogicalName: instance.name,
        },
      });
      nodeByVariant.set(variantKey(instance.id, moduleId), nodeIndex);
      root.children!.push(nodeIndex);
    }
    onProgress?.(0.08 + ((instanceIndex + 1) / Math.max(1, instances.length)) * 0.42);
  }

  const gltfAnimations = animations.flatMap(clip => buildAnimation(
    state, clip, instances, modules, nodeByVariant, project.size, layerIsVisible,
  ));
  if (root.children!.length === 0) throw new Error('场景中没有可导出的体素。');
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Haiyue Voxel Editor' },
    scene: 0,
    scenes: [{ name: 'Voxel Scene', nodes: [0] }],
    nodes: state.nodes,
    meshes: state.meshes,
    materials: state.materials,
    buffers: [{ byteLength: state.byteLength }],
    bufferViews: state.bufferViews,
    accessors: state.accessors,
    ...(gltfAnimations.length > 0 ? { animations: gltfAnimations } : {}),
    extras: {
      haiyueExportMode: 'instances',
      haiyueModuleMeshCount: meshByModuleId.size,
      haiyueAnimationSemantics: 'STEP TRS; module switching and visibility use zero-scale variant nodes',
    },
  };
  const built: BuiltGltfAsset = {
    gltf,
    chunks: state.chunks,
    offsets: state.offsets,
    byteLength: state.byteLength,
    exposedFaceCount: state.exposedFaceCount,
    vertexCount: state.vertexCount,
    triangleCount: state.triangleCount,
  };
  onProgress?.(0.94);
  const result = encodeGltfAssetAsGlb(built, onProgress);
  return {
    ...result,
    nodeCount: state.nodes.length,
    meshCount: state.meshes.length,
    animationCount: gltfAnimations.length,
    instanceCount: instances.length,
  };
}

function appendVoxelMesh(
  state: SceneBuildState,
  size: Readonly<SceneSize>,
  voxels: Iterable<Voxel>,
  palette: Iterable<PbrPaletteMaterial>,
  name: string,
): number {
  const built = buildGltfAsset(size, voxels, palette, undefined, [0, 0, 0]);
  const json = built.gltf as {
    accessors: JsonAccessor[];
    bufferViews: JsonBufferView[];
    materials: Array<Record<string, unknown>>;
    meshes: JsonMesh[];
  };
  const byteBase = state.byteLength;
  const viewBase = state.bufferViews.length;
  const accessorBase = state.accessors.length;
  const materialBase = state.materials.length;
  for (let index = 0; index < built.chunks.length; index += 1) {
    state.chunks.push(built.chunks[index]!);
    state.offsets.push(byteBase + (built.offsets[index] ?? 0));
  }
  state.byteLength += built.byteLength;
  state.bufferViews.push(...json.bufferViews.map(view => ({ ...view, byteOffset: view.byteOffset + byteBase })));
  state.accessors.push(...json.accessors.map(accessor => ({ ...accessor, bufferView: accessor.bufferView + viewBase })));
  state.materials.push(...json.materials.map(material => ({ ...material })));
  const sourceMesh = json.meshes[0]!;
  const mesh: JsonMesh = {
    name,
    primitives: sourceMesh.primitives.map(primitive => {
      const attributes = primitive.attributes as Record<string, number>;
      return {
        ...primitive,
        attributes: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, value + accessorBase])),
        indices: Number(primitive.indices) + accessorBase,
        material: Number(primitive.material) + materialBase,
      };
    }),
  };
  const meshIndex = state.meshes.length;
  state.meshes.push(mesh);
  state.exposedFaceCount += built.exposedFaceCount;
  state.vertexCount += built.vertexCount;
  state.triangleCount += built.triangleCount;
  return meshIndex;
}

function buildAnimation(
  state: SceneBuildState,
  clip: Readonly<VoxelAnimationClip>,
  instances: readonly Readonly<VoxelModuleInstance>[],
  modules: ReadonlyMap<string, Readonly<VoxelModuleData>>,
  nodeByVariant: ReadonlyMap<string, number>,
  sceneSize: Readonly<SceneSize>,
  layerIsVisible: (layerId: string | undefined) => boolean,
): Array<Record<string, unknown>> {
  const samplers: Array<Record<string, unknown>> = [];
  const channels: Array<Record<string, unknown>> = [];
  for (const instance of instances) {
    const track = clip.tracks.find(item => item.instanceId === instance.id);
    if (!track || track.keyframes.length === 0) continue;
    const frames = Array.from(new Set([0, clip.frameCount - 1, ...track.keyframes.map(keyframe => keyframe.frame)]))
      .filter(frame => frame >= 0 && frame < clip.frameCount)
      .sort((a, b) => a - b);
    const times = new Float32Array(frames.map(frame => frame / clip.fps));
    const timeAccessor = appendAnimationAccessor(state, new Uint8Array(times.buffer), 5126, times.length, 'SCALAR', [times[0] ?? 0], [times.at(-1) ?? 0]);
    const variants = new Set([instance.moduleId, ...track.keyframes.map(keyframe => keyframe.moduleId)]);
    for (const moduleId of variants) {
      const module = modules.get(moduleId);
      const node = nodeByVariant.get(variantKey(instance.id, moduleId));
      if (!module || node === undefined) continue;
      const translations: number[] = [];
      const rotations: number[] = [];
      const scales: number[] = [];
      for (const frame of frames) {
        const evaluated = evaluateAnimationInstance(instance, clip, frame);
        const transform = instanceTransform(
          module.size,
          evaluated,
          sceneSize,
          evaluated.moduleId === moduleId && evaluated.visible && layerIsVisible(instance.layerId),
        );
        translations.push(...transform.translation);
        rotations.push(...transform.rotation);
        scales.push(...transform.scale);
      }
      const translationAccessor = appendFloatAccessor(state, translations, 'VEC3');
      const rotationAccessor = appendFloatAccessor(state, rotations, 'VEC4');
      const scaleAccessor = appendFloatAccessor(state, scales, 'VEC3');
      for (const [path, output] of [
        ['translation', translationAccessor],
        ['rotation', rotationAccessor],
        ['scale', scaleAccessor],
      ] as const) {
        const sampler = samplers.length;
        samplers.push({ input: timeAccessor, output, interpolation: 'STEP' });
        channels.push({ sampler, target: { node, path } });
      }
    }
  }
  if (channels.length === 0) return [];
  return [{
    name: clip.name,
    samplers,
    channels,
    extras: {
      haiyueAnimationId: clip.id,
      fps: clip.fps,
      frameCount: clip.frameCount,
      loop: clip.loop,
      playbackStart: clip.playbackStart ?? 0,
      playbackEnd: clip.playbackEnd ?? clip.frameCount - 1,
    },
  }];
}

function appendFloatAccessor(state: SceneBuildState, values: readonly number[], type: 'VEC3' | 'VEC4'): number {
  const array = new Float32Array(values);
  return appendAnimationAccessor(state, new Uint8Array(array.buffer), 5126, values.length / (type === 'VEC3' ? 3 : 4), type);
}

function appendAnimationAccessor(
  state: SceneBuildState,
  bytes: Uint8Array,
  componentType: number,
  count: number,
  type: string,
  min?: number[],
  max?: number[],
): number {
  const offset = state.byteLength;
  state.chunks.push(bytes);
  state.offsets.push(offset);
  state.byteLength += bytes.byteLength;
  const bufferView = state.bufferViews.length;
  state.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
  const accessor = state.accessors.length;
  state.accessors.push({ bufferView, componentType, count, type, ...(min ? { min } : {}), ...(max ? { max } : {}) });
  return accessor;
}

function instanceTransform(
  moduleSize: Readonly<SceneSize>,
  instance: Readonly<Pick<VoxelModuleInstance, 'position' | 'rotation' | 'scale'>>,
  sceneSize: Readonly<SceneSize>,
  visible: boolean,
): { translation: number[]; rotation: number[]; scale: number[] } {
  const scale: [number, number, number] = [instance.scale.x, instance.scale.y, instance.scale.z];
  const affineOffset = rotatedOriginOffset(moduleSize, instance.rotation, scale);
  return {
    translation: [
      instance.position.x + affineOffset[0] - sceneSize.x / 2,
      instance.position.y + affineOffset[1],
      instance.position.z + affineOffset[2] - sceneSize.z / 2,
    ],
    rotation: quarterTurnQuaternion(instance.rotation),
    scale: visible ? scale : [0, 0, 0],
  };
}

function rotatedOriginOffset(
  sourceSize: Readonly<SceneSize>,
  rotation: Readonly<{ x: number; y: number; z: number }>,
  scale: readonly [number, number, number],
): [number, number, number] {
  let origin: [number, number, number] = [0, 0, 0];
  let size: [number, number, number] = [sourceSize.x * scale[0], sourceSize.y * scale[1], sourceSize.z * scale[2]];
  for (const axis of ['x', 'y', 'z'] as const) {
    const turns = ((Math.round(rotation[axis]) % 4) + 4) % 4;
    for (let turn = 0; turn < turns; turn += 1) {
      const [x, y, z] = origin;
      const [sx, sy, sz] = size;
      if (axis === 'x') { origin = [x, z, sy - y]; size = [sx, sz, sy]; }
      else if (axis === 'y') { origin = [z, y, sx - x]; size = [sz, sy, sx]; }
      else { origin = [y, sx - x, z]; size = [sy, sx, sz]; }
    }
  }
  return origin;
}

function quarterTurnQuaternion(rotation: Readonly<{ x: number; y: number; z: number }>): number[] {
  const qx = axisQuaternion(1, 0, 0, -rotation.x * Math.PI / 2);
  const qy = axisQuaternion(0, 1, 0, rotation.y * Math.PI / 2);
  const qz = axisQuaternion(0, 0, 1, -rotation.z * Math.PI / 2);
  return normalizeQuaternion(multiplyQuaternion(qz, multiplyQuaternion(qy, qx)));
}

function axisQuaternion(x: number, y: number, z: number, angle: number): [number, number, number, number] {
  const half = angle / 2;
  const sine = Math.sin(half);
  return [x * sine, y * sine, z * sine, Math.cos(half)];
}

function multiplyQuaternion(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function normalizeQuaternion(value: readonly [number, number, number, number]): number[] {
  const length = Math.hypot(...value) || 1;
  return value.map(item => Math.abs(item / length) < 1e-10 ? 0 : item / length);
}

function variantKey(instanceId: string, moduleId: string): string {
  return `${instanceId}\u0000${moduleId}`;
}
