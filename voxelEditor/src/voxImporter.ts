import {
  DEFAULT_LAYER_ID,
  DEFAULT_PBR_METALLIC,
  DEFAULT_PBR_ROUGHNESS,
  MAX_SCENE_AXIS,
  MAX_VOXELS,
} from './model';
import type {
  PbrPaletteMaterial,
  SceneSize,
  Voxel,
  VoxelAnimationClip,
  VoxelAnimationKeyframe,
  VoxelLayer,
  VoxelModuleData,
  VoxelModuleInstance,
  VoxelProject,
} from './model';
import {
  IDENTITY_VOX_TRANSFORM,
  decodeVoxRotation,
  matrixToEditorQuarterTurns,
  multiplyMatrixVector,
  multiplyVoxTransforms,
  parseVoxTranslation,
  subtractVectors,
  transformedGridOrigin,
  transformedGridSize,
  voxToEditorMatrix,
  voxToEditorVector,
} from './voxScene';
import type { VoxTransform } from './voxScene';
import { normalizeAnimationFps, normalizeAnimationFrame, normalizeAnimationFrameCount } from './animation';
export { editorQuarterTurnsToMatrix } from './voxScene';

interface PaletteColor { r: number; g: number; b: number; a: number }
interface IndexedVoxel { x: number; y: number; z: number; colorIndex: number }
interface RawVoxModel { size: { x: number; y: number; z: number }; voxels: IndexedVoxel[] }
interface RawTransformNode {
  id: number;
  attributes: VoxDictionary;
  childId: number;
  layerId: number;
  frames: VoxDictionary[];
}
interface RawGroupNode { id: number; attributes: VoxDictionary; childIds: number[] }
interface RawShapeNode {
  id: number;
  attributes: VoxDictionary;
  models: Array<{ modelId: number; attributes: VoxDictionary }>;
}
interface RawLayer { id: number; attributes: VoxDictionary }
interface RawSceneInstance {
  modelId: number;
  name: string;
  transform: VoxTransform;
  layerId: number;
  hidden: boolean;
  frames: RawSceneInstanceFrame[];
}
interface RawSceneInstanceFrame {
  frame: number;
  modelId: number;
  transform: VoxTransform;
  hidden: boolean;
}
type VoxDictionary = Record<string, string>;

export interface MagicaVoxelModel {
  /** Size converted from MagicaVoxel XYZ (Z-up) to editor XYZ (Y-up). */
  size: SceneSize;
  voxels: Voxel[];
}

export interface MagicaVoxelSceneInstance {
  modelIndex: number;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  layerId: string;
  visible: boolean;
  frames: Array<{
    frame: number;
    modelIndex: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    visible: boolean;
  }>;
}

export interface MagicaVoxelFile {
  version: number;
  models: MagicaVoxelModel[];
  instances: MagicaVoxelSceneInstance[];
  layers: VoxelLayer[];
  materials: PbrPaletteMaterial[];
  project: VoxelProject;
  hasSceneGraph: boolean;
  animated: boolean;
}

const textDecoder = new TextDecoder('utf-8');

export function parseMagicaVoxel(source: ArrayBuffer | Uint8Array): MagicaVoxelFile {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || readText(bytes, 0, 4) !== 'VOX ') throw new Error('不是有效的 MagicaVoxel VOX 文件。');
  const version = view.getUint32(4, true);
  if (version < 150) throw new Error(`不支持的 VOX 版本：${version}。`);
  const main = readChunkHeader(bytes, view, 8, bytes.byteLength);
  if (main.id !== 'MAIN') throw new Error('VOX 文件缺少 MAIN 数据块。');

  const models: RawVoxModel[] = [];
  const transforms = new Map<number, RawTransformNode>();
  const groups = new Map<number, RawGroupNode>();
  const shapes = new Map<number, RawShapeNode>();
  const layers = new Map<number, RawLayer>();
  const materialProperties = new Map<number, VoxDictionary>();
  let pendingSize: RawVoxModel['size'] | null = null;
  let embeddedPalette: PaletteColor[] | null = null;
  let colorNames: string[] = [];
  let declaredModelCount: number | null = null;

  const visitChunks = (start: number, end: number): void => {
    let offset = start;
    while (offset < end) {
      const chunk = readChunkHeader(bytes, view, offset, end);
      const cursor = new ChunkCursor(bytes, view, chunk.contentStart, chunk.contentEnd, chunk.id);
      if (chunk.id === 'PACK') {
        declaredModelCount = cursor.uint32();
      } else if (chunk.id === 'SIZE') {
        const size = { x: cursor.int32(), y: cursor.int32(), z: cursor.int32() };
        if (![size.x, size.y, size.z].every(axis => axis > 0 && axis <= 256)) {
          throw new Error(`VOX 模型尺寸无效：${size.x}×${size.y}×${size.z}。`);
        }
        pendingSize = size;
      } else if (chunk.id === 'XYZI') {
        if (!pendingSize) throw new Error('VOX XYZI 数据块前缺少对应的 SIZE 数据块。');
        const count = cursor.uint32();
        if (count > MAX_VOXELS) throw new Error(`VOX 体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
        const voxels: IndexedVoxel[] = [];
        for (let index = 0; index < count; index += 1) {
          const voxel = { x: cursor.uint8(), y: cursor.uint8(), z: cursor.uint8(), colorIndex: cursor.uint8() };
          if (voxel.x >= pendingSize.x || voxel.y >= pendingSize.y || voxel.z >= pendingSize.z) continue;
          if (voxel.colorIndex !== 0) voxels.push(voxel);
        }
        models.push({ size: pendingSize, voxels });
        pendingSize = null;
      } else if (chunk.id === 'RGBA') {
        const palette = createDefaultPalette();
        for (let index = 0; index < 256; index += 1) {
          const color = { r: cursor.uint8(), g: cursor.uint8(), b: cursor.uint8(), a: cursor.uint8() };
          if (index < 255) palette[index + 1] = color;
        }
        embeddedPalette = palette;
      } else if (chunk.id === 'nTRN') {
        const id = cursor.int32();
        const attributes = cursor.dictionary();
        const childId = cursor.int32();
        cursor.int32(); // reserved
        const layerId = cursor.int32();
        const frameCount = cursor.int32();
        if (frameCount < 1 || frameCount > 10_000) throw new Error(`VOX nTRN ${id} 帧数量无效。`);
        transforms.set(id, { id, attributes, childId, layerId, frames: Array.from({ length: frameCount }, () => cursor.dictionary()) });
      } else if (chunk.id === 'nGRP') {
        const id = cursor.int32();
        const attributes = cursor.dictionary();
        const childCount = cursor.int32();
        if (childCount < 0 || childCount > 100_000) throw new Error(`VOX nGRP ${id} 子节点数量无效。`);
        groups.set(id, { id, attributes, childIds: Array.from({ length: childCount }, () => cursor.int32()) });
      } else if (chunk.id === 'nSHP') {
        const id = cursor.int32();
        const attributes = cursor.dictionary();
        const modelCount = cursor.int32();
        if (modelCount < 1 || modelCount > 10_000) throw new Error(`VOX nSHP ${id} 模型引用数量无效。`);
        shapes.set(id, {
          id,
          attributes,
          models: Array.from({ length: modelCount }, () => ({ modelId: cursor.int32(), attributes: cursor.dictionary() })),
        });
      } else if (chunk.id === 'LAYR') {
        const id = cursor.int32();
        layers.set(id, { id, attributes: cursor.dictionary() });
        cursor.int32(); // reserved
      } else if (chunk.id === 'MATL') {
        materialProperties.set(cursor.int32(), cursor.dictionary());
      } else if (chunk.id === 'MATT') {
        const id = cursor.int32() & 255;
        const type = cursor.int32();
        const weight = cursor.float32();
        const propertyBits = cursor.uint32();
        const properties: VoxDictionary = {
          _type: type === 1 ? '_metal' : type === 2 ? '_glass' : type === 3 ? '_emit' : '_diffuse',
        };
        if (type === 1) properties._metal = String(weight);
        for (let bit = 0; bit <= 6; bit += 1) {
          if ((propertyBits & (1 << bit)) === 0) continue;
          const value = cursor.float32();
          if (bit === 1) properties._rough = String(value);
        }
        materialProperties.set(id, properties);
      } else if (chunk.id === 'NOTE') {
        const count = cursor.int32();
        if (count < 0 || count > 256) throw new Error('VOX NOTE 颜色名称数量无效。');
        colorNames = Array.from({ length: count }, () => cursor.string());
      }
      if (chunk.childrenSize > 0) visitChunks(chunk.contentEnd, chunk.chunkEnd);
      offset = chunk.chunkEnd;
    }
  };

  visitChunks(main.contentEnd, main.chunkEnd);
  if (models.length === 0) throw new Error('VOX 文件中没有可导入的模型。');
  if (declaredModelCount !== null && declaredModelCount !== models.length) {
    throw new Error(`VOX PACK 声明 ${declaredModelCount} 个模型，实际读取到 ${models.length} 个。`);
  }

  const palette = embeddedPalette ?? createDefaultPalette();
  const usedColorIndices = new Set(models.flatMap(model => model.voxels.map(voxel => voxel.colorIndex)));
  const materials: PbrPaletteMaterial[] = Array.from(usedColorIndices).sort((a, b) => a - b).flatMap(index => {
    const color = palette[index];
    if (!color || color.a === 0) return [];
    const properties = materialProperties.get(index) ?? {};
    return [{
      id: `vox-material-${index}`,
      color: colorToHex(color),
      name: colorNames[index - 1]?.trim() || `VOX 材质 ${index}`,
      metallic: materialMetallic(properties),
      roughness: normalizedProperty(properties._rough, DEFAULT_PBR_ROUGHNESS, 0.04),
      ...(materialProperties.has(index) ? { vox: {
        type: voxMaterialType(properties._type),
        properties: { ...properties },
        compatibility: isPartiallyCompatibleVoxMaterial(properties._type) ? 'partial' : 'full',
      } } : {}),
    }];
  });
  const materialByIndex = new Map(materials.map(material => [Number(material.id.slice('vox-material-'.length)), material]));
  const convertedModels = models.map(model => convertModel(model, palette, materialByIndex));
  const hasSceneGraph = transforms.size > 0 || groups.size > 0 || shapes.size > 0;
  const animated = Array.from(transforms.values()).some(node => node.frames.length > 1)
    || Array.from(shapes.values()).some(node => node.models.length > 1);
  const rawInstances = hasSceneGraph
    ? flattenSceneGraph(models.length, transforms, groups, shapes)
    : models.map((model, index): RawSceneInstance => ({
      modelId: index,
      name: `模型 ${index + 1}`,
      transform: {
        rotation: IDENTITY_VOX_TRANSFORM.rotation,
        translation: [Math.floor(model.size.x / 2), Math.floor(model.size.y / 2), Math.floor(model.size.z / 2)],
      },
      layerId: -1,
      hidden: false,
      frames: [{
        frame: 0,
        modelId: index,
        transform: {
          rotation: IDENTITY_VOX_TRANSFORM.rotation,
          translation: [Math.floor(model.size.x / 2), Math.floor(model.size.y / 2), Math.floor(model.size.z / 2)],
        },
        hidden: false,
      }],
    }));
  const result = buildProject(convertedModels, rawInstances, layers, materials, transforms.get(0)?.attributes ?? {});
  return { version, models: convertedModels, hasSceneGraph, animated, ...result };
}

function convertModel(
  model: RawVoxModel,
  palette: readonly PaletteColor[],
  materialByIndex: ReadonlyMap<number, PbrPaletteMaterial>,
): MagicaVoxelModel {
  const size = { x: model.size.x, y: model.size.z, z: model.size.y };
  if (size.x > MAX_SCENE_AXIS || size.y > MAX_SCENE_AXIS || size.z > MAX_SCENE_AXIS) {
    throw new Error(`VOX 模型尺寸 ${size.x}×${size.y}×${size.z} 超过编辑器上限 ${MAX_SCENE_AXIS}。`);
  }
  const voxels: Voxel[] = [];
  for (const source of model.voxels) {
    const color = palette[source.colorIndex];
    if (!color || color.a === 0) continue;
    voxels.push({
      x: source.x,
      y: source.z,
      z: source.y,
      color: colorToHex(color),
      materialId: materialByIndex.get(source.colorIndex)?.id,
    });
  }
  return { size, voxels };
}

function flattenSceneGraph(
  modelCount: number,
  transforms: ReadonlyMap<number, RawTransformNode>,
  groups: ReadonlyMap<number, RawGroupNode>,
  shapes: ReadonlyMap<number, RawShapeNode>,
): RawSceneInstance[] {
  const allIds = new Set<number>([...transforms.keys(), ...groups.keys(), ...shapes.keys()]);
  const childIds = new Set<number>();
  for (const node of transforms.values()) childIds.add(node.childId);
  for (const node of groups.values()) for (const child of node.childIds) childIds.add(child);
  const roots = Array.from(allIds).filter(id => !childIds.has(id)).sort((a, b) => a - b);
  const instances: RawSceneInstance[] = [];
  const visited = new Set<number>();
  const visit = (
    id: number,
    transformPath: readonly RawTransformNode[],
    inherited: { name: string; layerId: number; hidden: boolean },
    stack: Set<number>,
  ): void => {
    if (stack.has(id)) throw new Error(`VOX 场景图存在循环引用：节点 ${id}。`);
    stack.add(id);
    visited.add(id);
    const transformNode = transforms.get(id);
    const groupNode = groups.get(id);
    const shapeNode = shapes.get(id);
    if (transformNode) {
      visit(transformNode.childId, [...transformPath, transformNode], {
        name: transformNode.attributes._name || inherited.name,
        layerId: transformNode.layerId >= 0 ? transformNode.layerId : inherited.layerId,
        hidden: inherited.hidden || transformNode.attributes._hidden === '1',
      }, stack);
    } else if (groupNode) {
      const next = { ...inherited, hidden: inherited.hidden || groupNode.attributes._hidden === '1' };
      for (const child of groupNode.childIds) visit(child, transformPath, next, stack);
    } else if (shapeNode) {
      for (const reference of shapeNode.models) {
        if (reference.modelId < 0 || reference.modelId >= modelCount) {
          throw new Error(`VOX nSHP ${id} 引用了不存在的模型 ${reference.modelId}。`);
        }
      }
      const frameNumbers = new Set<number>([0]);
      transformPath.forEach(node => node.frames.forEach((frame, index) => frameNumbers.add(frameNumber(frame, index))));
      shapeNode.models.forEach((reference, index) => frameNumbers.add(frameNumber(reference.attributes, index)));
      const frames = Array.from(frameNumbers).sort((a, b) => a - b).map(frame => {
        let transform = IDENTITY_VOX_TRANSFORM;
        let frameHidden = inherited.hidden || shapeNode.attributes._hidden === '1';
        for (const node of transformPath) {
          const attributes = attributesAtFrame(node.frames, frame);
          transform = multiplyVoxTransforms(transform, {
            rotation: decodeVoxRotation(attributes._r),
            translation: parseVoxTranslation(attributes._t),
          });
          frameHidden ||= attributes._hidden === '1';
        }
        const reference = modelAtFrame(shapeNode.models, frame);
        return { frame, modelId: reference.modelId, transform, hidden: frameHidden };
      });
      const first = frames[0]!;
      instances.push({
        modelId: first.modelId,
        name: inherited.name || shapeNode.attributes._name || `实例 ${instances.length + 1}`,
        transform: first.transform,
        layerId: inherited.layerId,
        hidden: first.hidden,
        frames,
      });
    } else {
      throw new Error(`VOX 场景图引用了不存在的节点 ${id}。`);
    }
    stack.delete(id);
  };
  const inherited = { name: '', layerId: -1, hidden: false };
  for (const root of roots) visit(root, [], inherited, new Set());
  for (const id of allIds) if (!visited.has(id)) visit(id, [], inherited, new Set());
  if (instances.length === 0) throw new Error('VOX 场景图中没有模型实例。');
  return instances;
}

function buildProject(
  models: readonly MagicaVoxelModel[],
  rawInstances: readonly RawSceneInstance[],
  rawLayers: ReadonlyMap<number, RawLayer>,
  materials: readonly PbrPaletteMaterial[],
  animationMetadata: Readonly<VoxDictionary>,
): { instances: MagicaVoxelSceneInstance[]; layers: VoxelLayer[]; materials: PbrPaletteMaterial[]; project: VoxelProject } {
  const modules: VoxelModuleData[] = models.map((model, index) => ({
    id: `vox-model-${index + 1}`,
    name: `VOX 模型 ${index + 1}`,
    size: { ...model.size },
    voxels: model.voxels.map(voxel => ({ ...voxel })),
  }));
  const importedLayers: VoxelLayer[] = Array.from(rawLayers.values()).sort((a, b) => a.id - b.id).map(layer => ({
    id: editorLayerId(layer.id),
    name: layer.attributes._name?.trim() || `VOX 图层 ${layer.id}`,
    visible: layer.attributes._hidden !== '1',
    locked: false,
  }));
  const layerByRawId = new Map(Array.from(rawLayers.keys(), id => [id, editorLayerId(id)]));
  const converted = rawInstances.map((instance, index): MagicaVoxelSceneInstance => {
    const frames = instance.frames.map(frame => convertSceneFrame(frame, models));
    const first = frames[0];
    if (!first) throw new Error('VOX 场景实例没有有效帧。');
    return {
      modelIndex: first.modelIndex,
      name: instance.name || `实例 ${index + 1}`,
      position: { ...first.position },
      rotation: { ...first.rotation },
      layerId: layerByRawId.get(instance.layerId) ?? DEFAULT_LAYER_ID,
      visible: first.visible,
      frames,
    };
  });

  let min: [number, number, number] = [0, 0, 0];
  let max: [number, number, number] = [1, 1, 1];
  converted.forEach(instance => {
    instance.frames.forEach(frame => {
      const model = models[frame.modelIndex]!;
      const transformedSize = transformedGridSize(model.size, frame.rotation);
      min = [
        Math.min(min[0], frame.position.x),
        Math.min(min[1], frame.position.y),
        Math.min(min[2], frame.position.z),
      ];
      max = [
        Math.max(max[0], frame.position.x + transformedSize.x),
        Math.max(max[1], frame.position.y + transformedSize.y),
        Math.max(max[2], frame.position.z + transformedSize.z),
      ];
    });
  });
  const shift: [number, number, number] = [-min[0], -min[1], -min[2]];
  const size = { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
  if ([size.x, size.y, size.z].some(axis => axis > MAX_SCENE_AXIS)) {
    throw new Error(`VOX 场景包围盒 ${size.x}×${size.y}×${size.z} 超过编辑器上限 ${MAX_SCENE_AXIS}。`);
  }
  const instances: MagicaVoxelSceneInstance[] = converted.map(instance => ({
    ...instance,
    position: {
      x: instance.position.x + shift[0],
      y: instance.position.y + shift[1],
      z: instance.position.z + shift[2],
    },
    frames: instance.frames.map(frame => ({
      ...frame,
      position: {
        x: frame.position.x + shift[0],
        y: frame.position.y + shift[1],
        z: frame.position.z + shift[2],
      },
    })),
  }));
  const moduleInstances: VoxelModuleInstance[] = instances.map((instance, index) => ({
    id: `vox-instance-${index + 1}`,
    moduleId: modules[instance.modelIndex]!.id,
    name: instance.name,
    position: { ...instance.position },
    rotation: { ...instance.rotation },
    scale: { x: 1, y: 1, z: 1 },
    layerId: instance.layerId,
    visible: instance.visible,
  }));
  let maxAnimationFrame = 0;
  for (const instance of instances) {
    for (const frame of instance.frames) maxAnimationFrame = Math.max(maxAnimationFrame, frame.frame);
  }
  const hasHaiyueAnimation = animationMetadata._hv_animation === '1';
  const animationFrameCount = normalizeAnimationFrameCount(Math.max(
    maxAnimationFrame + 1,
    Number(animationMetadata._hv_frame_count ?? 1),
  ));
  const animation: VoxelAnimationClip | null = maxAnimationFrame > 0 || hasHaiyueAnimation
    ? {
      id: 'vox-animation-1',
      name: animationMetadata._hv_animation_name?.trim() || 'VOX 动画',
      fps: normalizeAnimationFps(Number(animationMetadata._hv_fps ?? 12)),
      frameCount: animationFrameCount,
      loop: animationMetadata._hv_loop !== '0',
      playbackStart: normalizeAnimationFrame(Number(animationMetadata._hv_range_start ?? 0), animationFrameCount),
      playbackEnd: normalizeAnimationFrame(
        Number(animationMetadata._hv_range_end ?? animationFrameCount - 1), animationFrameCount,
      ),
      tracks: instances.map((instance, index) => ({
        instanceId: moduleInstances[index]!.id,
        keyframes: instance.frames.map((frame): VoxelAnimationKeyframe => ({
          frame: frame.frame,
          moduleId: modules[frame.modelIndex]!.id,
          position: { ...frame.position },
          rotation: { ...frame.rotation },
          scale: { x: 1, y: 1, z: 1 },
          visible: frame.visible,
        })),
      })),
    }
    : null;
  const projectLayers = [
    importedLayers.find(layer => layer.id === DEFAULT_LAYER_ID)
      ?? { id: DEFAULT_LAYER_ID, name: '默认图层', visible: true, locked: false },
    ...importedLayers.filter(layer => layer.id !== DEFAULT_LAYER_ID),
  ];
  const currentMaterial = materials[0];
  const project: VoxelProject = {
    format: 'haiyue-voxel',
    version: 1,
    size,
    editor: currentMaterial
      ? { currentColor: currentMaterial.color, currentMaterialId: currentMaterial.id, activeAnimationId: animation?.id ?? null, animationFrame: 0 }
      : { currentColor: '#69d2e7', activeAnimationId: animation?.id ?? null, animationFrame: 0 },
    voxels: [],
    modules,
    moduleInstances,
    layers: projectLayers,
    palette: materials.map(material => ({ ...material })),
    animations: animation ? [animation] : [],
  };
  return { instances, layers: projectLayers, materials: materials.map(material => ({ ...material })), project };
}

function convertSceneFrame(
  frame: Readonly<RawSceneInstanceFrame>,
  models: readonly MagicaVoxelModel[],
): MagicaVoxelSceneInstance['frames'][number] {
  const model = models[frame.modelId];
  if (!model) throw new Error(`VOX 实例引用了不存在的模型 ${frame.modelId}。`);
  const matrix = voxToEditorMatrix(frame.transform.rotation);
  const rotation = matrixToEditorQuarterTurns(matrix);
  const pivotVox: [number, number, number] = [
    Math.floor(model.size.x / 2),
    Math.floor(model.size.z / 2),
    Math.floor(model.size.y / 2),
  ];
  const desiredOrigin = subtractVectors(
    voxToEditorVector(frame.transform.translation),
    multiplyMatrixVector(matrix, voxToEditorVector(pivotVox)),
  );
  const gridOrigin = transformedGridOrigin(model.size, rotation);
  const position = subtractVectors(desiredOrigin, gridOrigin);
  return {
    frame: frame.frame,
    modelIndex: frame.modelId,
    position: { x: position[0], y: position[1], z: position[2] },
    rotation,
    visible: !frame.hidden,
  };
}

function editorLayerId(rawLayerId: number): string {
  return rawLayerId === 0 ? DEFAULT_LAYER_ID : `vox-layer-${rawLayerId}`;
}

function attributesAtFrame(frames: readonly VoxDictionary[], target: number): VoxDictionary {
  let selected = frames[0] ?? {};
  let selectedFrame = -1;
  frames.forEach((attributes, index) => {
    const frame = frameNumber(attributes, index);
    if (frame <= target && frame >= selectedFrame) {
      selected = attributes;
      selectedFrame = frame;
    }
  });
  return selected;
}

function modelAtFrame(
  models: readonly RawShapeNode['models'][number][],
  target: number,
): RawShapeNode['models'][number] {
  let selected = models[0]!;
  let selectedFrame = -1;
  models.forEach((reference, index) => {
    const frame = frameNumber(reference.attributes, index);
    if (frame <= target && frame >= selectedFrame) {
      selected = reference;
      selectedFrame = frame;
    }
  });
  return selected;
}

function frameNumber(attributes: VoxDictionary, fallback = 0): number {
  const value = Number.parseInt(attributes._f ?? String(fallback), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function materialMetallic(properties: VoxDictionary): number {
  if (properties._metal !== undefined) return normalizedProperty(properties._metal, DEFAULT_PBR_METALLIC);
  if (properties._type === '_metal') return normalizedProperty(properties._weight, 1);
  return DEFAULT_PBR_METALLIC;
}

function voxMaterialType(value: string | undefined): NonNullable<PbrPaletteMaterial['vox']>['type'] {
  if (value === '_diffuse') return 'diffuse';
  if (value === '_metal') return 'metal';
  if (value === '_glass') return 'glass';
  if (value === '_emit') return 'emit';
  if (value === '_media') return 'media';
  return 'unknown';
}

function isPartiallyCompatibleVoxMaterial(value: string | undefined): boolean {
  return value !== '_diffuse' && value !== '_metal';
}

function normalizedProperty(value: string | undefined, fallback: number, minimum = 0): number {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(1, parsed)) : fallback;
}

interface ChunkHeader {
  id: string;
  contentSize: number;
  childrenSize: number;
  contentStart: number;
  contentEnd: number;
  chunkEnd: number;
}

function readChunkHeader(bytes: Uint8Array, view: DataView, offset: number, limit: number): ChunkHeader {
  if (offset + 12 > limit) throw new Error('VOX 数据块头已截断。');
  const id = readText(bytes, offset, 4);
  const contentSize = view.getUint32(offset + 4, true);
  const childrenSize = view.getUint32(offset + 8, true);
  const contentStart = offset + 12;
  const contentEnd = contentStart + contentSize;
  const chunkEnd = contentEnd + childrenSize;
  if (contentEnd < contentStart || chunkEnd < contentEnd || chunkEnd > limit) throw new Error(`VOX ${id} 数据块长度无效。`);
  return { id, contentSize, childrenSize, contentStart, contentEnd, chunkEnd };
}

class ChunkCursor {
  private _offset: number;
  constructor(
    private readonly _bytes: Uint8Array,
    private readonly _view: DataView,
    start: number,
    private readonly _end: number,
    private readonly _chunkId: string,
  ) { this._offset = start; }

  uint8(): number { this._require(1); return this._bytes[this._offset++]!; }
  int32(): number { this._require(4); const value = this._view.getInt32(this._offset, true); this._offset += 4; return value; }
  uint32(): number { this._require(4); const value = this._view.getUint32(this._offset, true); this._offset += 4; return value; }
  float32(): number { this._require(4); const value = this._view.getFloat32(this._offset, true); this._offset += 4; return value; }
  string(): string {
    const length = this.int32();
    if (length < 0 || length > 1_000_000) throw new Error(`VOX ${this._chunkId} 字符串长度无效。`);
    this._require(length);
    const value = readText(this._bytes, this._offset, length);
    this._offset += length;
    return value;
  }
  dictionary(): VoxDictionary {
    const count = this.int32();
    if (count < 0 || count > 10_000) throw new Error(`VOX ${this._chunkId} 字典长度无效。`);
    const result: VoxDictionary = {};
    for (let index = 0; index < count; index += 1) result[this.string()] = this.string();
    return result;
  }
  private _require(length: number): void {
    if (this._offset + length > this._end) throw new Error(`VOX ${this._chunkId} 数据块已截断。`);
  }
}

function readText(bytes: Uint8Array, offset: number, length: number): string {
  return textDecoder.decode(bytes.subarray(offset, offset + length));
}

function colorToHex(color: PaletteColor): string {
  return `#${byteHex(color.r)}${byteHex(color.g)}${byteHex(color.b)}`;
}

function byteHex(value: number): string { return value.toString(16).padStart(2, '0'); }

function createDefaultPalette(): PaletteColor[] {
  const palette = Array.from({ length: 256 }, (): PaletteColor => ({ r: 0, g: 0, b: 0, a: 0 }));
  const cubeLevels = [255, 204, 153, 102, 51, 0];
  let index = 1;
  for (const r of cubeLevels) for (const g of cubeLevels) for (const b of cubeLevels) {
    if (r !== 0 || g !== 0 || b !== 0) palette[index++] = { r, g, b, a: 255 };
  }
  const ramp = [238, 221, 187, 170, 136, 119, 85, 68, 34, 17];
  for (const r of ramp) palette[index++] = { r, g: 0, b: 0, a: 255 };
  for (const g of ramp) palette[index++] = { r: 0, g, b: 0, a: 255 };
  for (const b of ramp) palette[index++] = { r: 0, g: 0, b, a: 255 };
  for (const channel of ramp) palette[index++] = { r: channel, g: channel, b: channel, a: 255 };
  return palette;
}
