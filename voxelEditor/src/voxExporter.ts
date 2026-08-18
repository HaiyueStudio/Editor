import type {
  PbrPaletteMaterial,
  SceneSize,
  Voxel,
  VoxelAnimationClip,
  VoxelAnimationKeyframe,
  VoxelModuleData,
  VoxelProject,
} from './model';
import { DEFAULT_LAYER_ID, DEFAULT_PBR_METALLIC, DEFAULT_PBR_ROUGHNESS, MAX_VOXELS, normalizeColor, voxelKey } from './model';
import { transformModuleVoxels } from './moduleTransform';
import {
  addVectors,
  editorQuarterTurnsToMatrix,
  editorToVoxMatrix,
  editorToVoxVector,
  encodeVoxRotation,
  multiplyMatrixVector,
  transformedGridOrigin,
} from './voxScene';

interface ColorSample {
  key: string;
  name: string;
  r: number;
  g: number;
  b: number;
  metallic: number;
  roughness: number;
  count: number;
  voxProperties?: Record<string, string>;
}

interface PaletteEntry {
  r: number;
  g: number;
  b: number;
  name: string;
  metallic: number;
  roughness: number;
  voxProperties?: Record<string, string>;
}

interface PreparedVoxel extends Voxel { paletteKey: string }
interface ExportModel { size: SceneSize; voxels: PreparedVoxel[] }
interface ExportInstance {
  modelIndex: number;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  layerId: string;
  visible: boolean;
  frames: ExportInstanceFrame[];
}
interface ExportInstanceFrame {
  frame: number;
  modelIndex: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  visible: boolean;
}

export interface VoxExportResult {
  data: Uint8Array<ArrayBuffer>;
  voxelCount: number;
  paletteSize: number;
  quantized: boolean;
  modelCount: number;
  instanceCount: number;
  layerCount: number;
  animationFrameCount: number;
  partialMaterialCount: number;
}

export type VoxExportProgress = (progress: number) => void;

/** Backward-compatible single-model export, now encoded as a complete VOX scene. */
export function exportVoxelsAsVox(size: Readonly<SceneSize>, source: Iterable<Voxel>): VoxExportResult {
  return exportVoxelProjectAsVox({
    format: 'haiyue-voxel',
    version: 1,
    size: { ...size },
    editor: { currentColor: '#ffffff' },
    voxels: Array.from(source, voxel => ({ ...voxel })),
  });
}

/** Writes modules, instances, transforms, layers, hidden state, palette and PBR MATL metadata. */
export function exportVoxelProjectAsVox(
  project: Readonly<VoxelProject>,
  onProgress?: VoxExportProgress,
): VoxExportResult {
  validateSize(project.size);
  onProgress?.(0.03);
  const paletteById = new Map((project.palette ?? []).map(material => [material.id, material]));
  const paletteByColor = new Map((project.palette ?? []).map(material => [normalizeColor(material.color), material]));
  const models: ExportModel[] = [];
  const instances: ExportInstance[] = [];
  const projectLayers = project.layers?.length
    ? project.layers
    : [{ id: DEFAULT_LAYER_ID, name: '默认图层', visible: true, locked: false }];
  const validLayerIds = new Set(projectLayers.map(layer => layer.id));

  for (const layer of projectLayers) {
    const source = project.voxels.filter(voxel => {
      const layerId = voxel.layerId && validLayerIds.has(voxel.layerId) ? voxel.layerId : DEFAULT_LAYER_ID;
      return layerId === layer.id;
    });
    const baseVoxels = prepareModelVoxels(project.size, source, paletteById, paletteByColor);
    if (baseVoxels.length === 0) continue;
    const modelIndex = models.length;
    models.push({ size: { ...project.size }, voxels: baseVoxels });
    instances.push({
      modelIndex,
      name: `场景体素 · ${layer.name}`,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      layerId: layer.id,
      visible: true,
      frames: [],
    });
  }
  onProgress?.(0.12);

  const modules = new Map((project.modules ?? []).map(module => [module.id, module]));
  const modelIndexByVariant = new Map<string, number>();
  const modelIndexFor = (moduleId: string, scaleValue: Readonly<{ x: number; y: number; z: number }>): number | null => {
    const module = modules.get(moduleId);
    if (!module) return null;
    const scale = normalizedScale(scaleValue);
    const variantKey = `${module.id}:${scale.x},${scale.y},${scale.z}`;
    const existing = modelIndexByVariant.get(variantKey);
    if (existing !== undefined) return existing;
    const variant = scaledModule(module, scale);
    const voxels = prepareModelVoxels(variant.size, variant.voxels, paletteById, paletteByColor);
    if (voxels.length === 0) return null;
    const modelIndex = models.length;
    models.push({ size: variant.size, voxels });
    modelIndexByVariant.set(variantKey, modelIndex);
    return modelIndex;
  };
  const animations = project.animations ?? [];
  const exportedAnimation = animations.find(clip => clip.id === project.editor.activeAnimationId) ?? animations[0] ?? null;
  const tracksByInstance = new Map(exportedAnimation?.tracks.map(track => [track.instanceId, track]) ?? []);
  const projectInstances = project.moduleInstances ?? [];
  for (let instanceIndex = 0; instanceIndex < projectInstances.length; instanceIndex += 1) {
    const instance = projectInstances[instanceIndex]!;
    const states = new Map<number, Readonly<Pick<VoxelAnimationKeyframe, 'moduleId' | 'position' | 'rotation' | 'scale' | 'visible'>>>([[0, instance]]);
    for (const keyframe of tracksByInstance.get(instance.id)?.keyframes ?? []) states.set(Math.max(0, Math.round(keyframe.frame)), keyframe);
    const finalFrame = Math.max(0, (exportedAnimation?.frameCount ?? 1) - 1);
    if (finalFrame > 0 && !states.has(finalFrame)) {
      const latestFrame = Array.from(states.keys()).filter(frame => frame <= finalFrame).sort((a, b) => b - a)[0] ?? 0;
      states.set(finalFrame, states.get(latestFrame)!);
    }
    const frames = Array.from(states, ([frame, state]) => {
      const modelIndex = modelIndexFor(state.moduleId, state.scale);
      return modelIndex === null ? null : {
        frame,
        modelIndex,
        position: roundedPosition(state.position),
        rotation: normalizedRotation(state.rotation),
        visible: state.visible !== false,
      } satisfies ExportInstanceFrame;
    }).filter((frame): frame is ExportInstanceFrame => frame !== null).sort((a, b) => a.frame - b.frame);
    const first = frames[0];
    if (!first) continue;
    instances.push({
      modelIndex: first.modelIndex,
      name: instance.name,
      position: { ...first.position },
      rotation: { ...first.rotation },
      layerId: instance.layerId,
      visible: first.visible,
      frames,
    });
    onProgress?.(0.12 + ((instanceIndex + 1) / Math.max(1, projectInstances.length)) * 0.3);
  }

  if (models.length === 0 || instances.length === 0) throw new Error('场景中没有可导出的体素。');
  const voxelCount = models.reduce((sum, model) => sum + model.voxels.length, 0);
  const samples = collectColorSamples(models.flatMap(model => model.voxels), paletteById, paletteByColor);
  onProgress?.(0.5);
  const { palette, colorIndices, quantized } = buildPalette(samples, 255);
  const partialMaterialCount = samples.filter(sample => {
    const type = sample.voxProperties?._type;
    return type !== undefined && type !== '_diffuse' && type !== '_metal';
  }).length;
  onProgress?.(0.62);
  const children: Uint8Array<ArrayBuffer>[] = [];
  if (models.length > 1) children.push(createChunk('PACK', int32Bytes(models.length)));
  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex]!;
    children.push(createSizeChunk(model.size));
    children.push(createXyziChunk(model, colorIndices));
    onProgress?.(0.62 + ((modelIndex + 1) / models.length) * 0.14);
  }

  const layerIndexById = new Map(projectLayers.map((layer, index) => [layer.id, index]));
  children.push(...createSceneGraphChunks(instances, models, layerIndexById, exportedAnimation));
  onProgress?.(0.84);
  children.push(createRgbaChunk(palette));
  children.push(createNoteChunk(palette));
  for (let index = 0; index < palette.length; index += 1) children.push(createMaterialChunk(index + 1, palette[index]!));
  projectLayers.forEach((layer, index) => children.push(createLayerChunk(index, layer.name, !layer.visible)));

  const main = createChunk('MAIN', new Uint8Array(0), concatenate(children));
  const data = new Uint8Array(8 + main.length);
  writeAscii(data, 0, 'VOX ');
  new DataView(data.buffer).setUint32(4, 200, true);
  data.set(main, 8);
  onProgress?.(1);
  return {
    data,
    voxelCount,
    paletteSize: palette.length,
    quantized,
    modelCount: models.length,
    instanceCount: instances.length,
    layerCount: projectLayers.length,
    animationFrameCount: exportedAnimation?.frameCount ?? 1,
    partialMaterialCount,
  };
}

function prepareModelVoxels(
  size: Readonly<SceneSize>,
  source: Iterable<Voxel>,
  paletteById: ReadonlyMap<string, PbrPaletteMaterial>,
  paletteByColor: ReadonlyMap<string, PbrPaletteMaterial>,
): PreparedVoxel[] {
  validateSize(size);
  const occupied = new Map<string, PreparedVoxel>();
  for (const sourceVoxel of source) {
    const color = normalizeColor(sourceVoxel.color);
    const voxel = {
      x: Math.round(sourceVoxel.x), y: Math.round(sourceVoxel.y), z: Math.round(sourceVoxel.z),
      color,
      materialId: sourceVoxel.materialId,
      paletteKey: paletteSampleKey(sourceVoxel.materialId, color, paletteById, paletteByColor),
    };
    if (voxel.x < 0 || voxel.x >= size.x || voxel.y < 0 || voxel.y >= size.y || voxel.z < 0 || voxel.z >= size.z) continue;
    occupied.set(voxelKey(voxel.x, voxel.y, voxel.z), voxel);
  }
  if (occupied.size > MAX_VOXELS) throw new Error(`单个 VOX 模型体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
  return Array.from(occupied.values());
}

function scaledModule(module: Readonly<VoxelModuleData>, scale: Readonly<{ x: number; y: number; z: number }>): VoxelModuleData {
  if (scale.x === 1 && scale.y === 1 && scale.z === 1) return {
    ...module,
    size: { ...module.size },
    voxels: module.voxels.map(voxel => ({ ...voxel })),
  };
  return {
    ...module,
    size: { x: module.size.x * scale.x, y: module.size.y * scale.y, z: module.size.z * scale.z },
    voxels: transformModuleVoxels(module.voxels, { rotation: { x: 0, y: 0, z: 0 }, scale }, module.size),
  };
}

function createSceneGraphChunks(
  instances: readonly ExportInstance[],
  models: readonly ExportModel[],
  layerIndexById: ReadonlyMap<string, number>,
  animation: Readonly<VoxelAnimationClip> | null,
): Uint8Array<ArrayBuffer>[] {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  chunks.push(createTransformChunk(
    0,
    1,
    '',
    -1,
    [{ frame: 0, rotation: 4, translation: [0, 0, 0], visible: true }],
    animation ? {
      _hv_animation: '1',
      _hv_animation_name: animation.name,
      _hv_fps: String(animation.fps),
      _hv_frame_count: String(animation.frameCount),
      _hv_loop: animation.loop ? '1' : '0',
      _hv_range_start: String(animation.playbackStart ?? 0),
      _hv_range_end: String(animation.playbackEnd ?? animation.frameCount - 1),
    } : {},
  ));
  const childIds = instances.map((_instance, index) => 2 + index * 2);
  const group = new ByteWriter();
  group.int32(1);
  group.dictionary({});
  group.int32(childIds.length);
  childIds.forEach(id => group.int32(id));
  chunks.push(createChunk('nGRP', group.toUint8Array()));
  instances.forEach((instance, index) => {
    const instanceFrames = instance.frames.length > 0 ? instance.frames : [{
      frame: 0,
      modelIndex: instance.modelIndex,
      position: instance.position,
      rotation: instance.rotation,
      visible: instance.visible,
    }];
    const transformFrames = instanceFrames.map(frame => {
      const model = models[frame.modelIndex]!;
      const rotationMatrix = editorQuarterTurnsToMatrix(frame.rotation);
      const gridOrigin = transformedGridOrigin(model.size, frame.rotation);
      const pivot: [number, number, number] = [
        Math.floor(model.size.x / 2),
        Math.floor(model.size.y / 2),
        Math.floor(model.size.z / 2),
      ];
      const translationEditor = addVectors(
        [frame.position.x + gridOrigin[0], frame.position.y + gridOrigin[1], frame.position.z + gridOrigin[2]],
        multiplyMatrixVector(rotationMatrix, pivot),
      );
      return {
        frame: frame.frame,
        rotation: encodeVoxRotation(editorToVoxMatrix(rotationMatrix)),
        translation: editorToVoxVector(translationEditor),
        visible: frame.visible,
      };
    });
    const nodeId = 2 + index * 2;
    const shapeId = nodeId + 1;
    chunks.push(createTransformChunk(nodeId, shapeId, instance.name,
      layerIndexById.get(instance.layerId) ?? -1, transformFrames));
    const shape = new ByteWriter();
    shape.int32(shapeId);
    shape.dictionary({});
    shape.int32(instanceFrames.length);
    instanceFrames.forEach(frame => {
      shape.int32(frame.modelIndex);
      shape.dictionary(instanceFrames.length > 1 || frame.frame > 0 ? { _f: String(frame.frame) } : {});
    });
    chunks.push(createChunk('nSHP', shape.toUint8Array()));
  });
  return chunks;
}

function createTransformChunk(
  nodeId: number,
  childId: number,
  name: string,
  layerId: number,
  frames: ReadonlyArray<{
    frame: number;
    rotation: number;
    translation: readonly [number, number, number];
    visible: boolean;
  }>,
  attributes: Readonly<Record<string, string>> = {},
): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.int32(nodeId);
  const alwaysHidden = frames.length > 0 && frames.every(frame => !frame.visible);
  writer.dictionary({ ...attributes, ...(name ? { _name: name } : {}), ...(alwaysHidden ? { _hidden: '1' } : {}) });
  writer.int32(childId);
  writer.int32(-1);
  writer.int32(layerId);
  writer.int32(frames.length);
  frames.forEach(frame => writer.dictionary({
    _r: String(frame.rotation),
    _t: frame.translation.join(' '),
    ...(frames.length > 1 || frame.frame > 0 ? { _f: String(frame.frame) } : {}),
    ...(!alwaysHidden && !frame.visible ? { _hidden: '1' } : {}),
  }));
  return createChunk('nTRN', writer.toUint8Array());
}

function createSizeChunk(size: Readonly<SceneSize>): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.int32(size.x);
  writer.int32(size.z);
  writer.int32(size.y);
  return createChunk('SIZE', writer.toUint8Array());
}

function createXyziChunk(model: Readonly<ExportModel>, colorIndices: ReadonlyMap<string, number>): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.int32(model.voxels.length);
  for (const voxel of model.voxels) {
    writer.uint8(voxel.x);
    writer.uint8(voxel.z);
    writer.uint8(voxel.y);
    writer.uint8(colorIndices.get(voxel.paletteKey) ?? 1);
  }
  return createChunk('XYZI', writer.toUint8Array());
}

function createRgbaChunk(palette: readonly PaletteEntry[]): Uint8Array<ArrayBuffer> {
  const content = new Uint8Array(1024);
  palette.forEach((color, index) => {
    const offset = index * 4;
    content[offset] = color.r;
    content[offset + 1] = color.g;
    content[offset + 2] = color.b;
    content[offset + 3] = 255;
  });
  return createChunk('RGBA', content);
}

function createNoteChunk(palette: readonly PaletteEntry[]): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.int32(palette.length);
  palette.forEach(entry => writer.string(entry.name));
  return createChunk('NOTE', writer.toUint8Array());
}

function createMaterialChunk(index: number, material: PaletteEntry): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.int32(index);
  writer.dictionary({
    ...material.voxProperties,
    _type: material.metallic >= 0.5 ? '_metal' : '_diffuse',
    _metal: formatUnit(material.metallic),
    _rough: formatUnit(material.roughness),
    ...(material.voxProperties?._type ? { _type: material.voxProperties._type } : {}),
  });
  return createChunk('MATL', writer.toUint8Array());
}

function createLayerChunk(index: number, name: string, hidden: boolean): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.int32(index);
  writer.dictionary({ ...(name ? { _name: name } : {}), ...(hidden ? { _hidden: '1' } : {}) });
  writer.int32(-1);
  return createChunk('LAYR', writer.toUint8Array());
}

function buildPalette(
  samples: readonly ColorSample[],
  limit: number,
): { palette: PaletteEntry[]; colorIndices: Map<string, number>; quantized: boolean } {
  if (samples.length <= limit) {
    const sorted = [...samples].sort((a, b) => a.key.localeCompare(b.key));
    return {
      palette: sorted.map(sample => ({
        r: sample.r, g: sample.g, b: sample.b, name: sample.name,
        metallic: sample.metallic, roughness: sample.roughness,
        ...(sample.voxProperties ? { voxProperties: { ...sample.voxProperties } } : {}),
      })),
      colorIndices: new Map(sorted.map((sample, index) => [sample.key, index + 1])),
      quantized: false,
    };
  }
  const boxes: ColorSample[][] = [[...samples]];
  while (boxes.length < limit) {
    let selectedIndex = -1;
    let selectedScore = -1;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      const score = boxScore(box);
      if (score > selectedScore) { selectedScore = score; selectedIndex = index; }
    });
    if (selectedIndex < 0) break;
    const selected = boxes[selectedIndex]!;
    const channel = widestChannel(selected);
    const sorted = [...selected].sort((a, b) => a[channel] - b[channel] || a.key.localeCompare(b.key));
    const total = sorted.reduce((sum, color) => sum + color.count, 0);
    let cumulative = 0;
    let split = sorted.length - 1;
    for (let index = 0; index < sorted.length - 1; index += 1) {
      cumulative += sorted[index]!.count;
      if (cumulative >= total / 2) { split = index + 1; break; }
    }
    boxes.splice(selectedIndex, 1, sorted.slice(0, split), sorted.slice(split));
  }
  const palette: PaletteEntry[] = [];
  const colorIndices = new Map<string, number>();
  boxes.forEach((box, boxIndex) => {
    const total = box.reduce((sum, color) => sum + color.count, 0);
    const weighted = box.reduce((sum, color) => ({
      r: sum.r + color.r * color.count,
      g: sum.g + color.g * color.count,
      b: sum.b + color.b * color.count,
      metallic: sum.metallic + color.metallic * color.count,
      roughness: sum.roughness + color.roughness * color.count,
    }), { r: 0, g: 0, b: 0, metallic: 0, roughness: 0 });
    palette.push({
      r: Math.round(weighted.r / total),
      g: Math.round(weighted.g / total),
      b: Math.round(weighted.b / total),
      name: box[0]?.name ?? `量化材质 ${boxIndex + 1}`,
      metallic: weighted.metallic / total,
      roughness: weighted.roughness / total,
    });
    for (const color of box) colorIndices.set(color.key, boxIndex + 1);
  });
  return { palette, colorIndices, quantized: true };
}

function collectColorSamples(
  voxels: readonly PreparedVoxel[],
  paletteById: ReadonlyMap<string, PbrPaletteMaterial>,
  paletteByColor: ReadonlyMap<string, PbrPaletteMaterial>,
): ColorSample[] {
  const samples = new Map<string, ColorSample>();
  for (const voxel of voxels) {
    const existing = samples.get(voxel.paletteKey);
    if (existing) { existing.count += 1; continue; }
    const material = (voxel.materialId ? paletteById.get(voxel.materialId) : null) ?? paletteByColor.get(voxel.color);
    samples.set(voxel.paletteKey, {
      key: voxel.paletteKey,
      name: material?.name ?? voxel.color.toUpperCase(),
      r: Number.parseInt(voxel.color.slice(1, 3), 16),
      g: Number.parseInt(voxel.color.slice(3, 5), 16),
      b: Number.parseInt(voxel.color.slice(5, 7), 16),
      metallic: material?.metallic ?? DEFAULT_PBR_METALLIC,
      roughness: material?.roughness ?? DEFAULT_PBR_ROUGHNESS,
      count: 1,
      ...(material?.vox ? { voxProperties: { ...material.vox.properties } } : {}),
    });
  }
  return Array.from(samples.values());
}

function paletteSampleKey(
  materialId: string | undefined,
  color: string,
  paletteById: ReadonlyMap<string, PbrPaletteMaterial>,
  paletteByColor: ReadonlyMap<string, PbrPaletteMaterial>,
): string {
  const material = (materialId ? paletteById.get(materialId) : null) ?? paletteByColor.get(color);
  return material ? `material:${material.id}:${color}` : `color:${color}`;
}

function boxScore(box: readonly ColorSample[]): number {
  return channelRange(box, widestChannel(box)) * box.reduce((sum, color) => sum + color.count, 0);
}

function widestChannel(box: readonly ColorSample[]): 'r' | 'g' | 'b' {
  const ranges = { r: channelRange(box, 'r'), g: channelRange(box, 'g'), b: channelRange(box, 'b') };
  return ranges.g > ranges.r && ranges.g >= ranges.b ? 'g' : ranges.b > ranges.r ? 'b' : 'r';
}

function channelRange(box: readonly ColorSample[], channel: 'r' | 'g' | 'b'): number {
  let min = 255;
  let max = 0;
  for (const color of box) { min = Math.min(min, color[channel]); max = Math.max(max, color[channel]); }
  return max - min;
}

function normalizedScale(scale: Readonly<{ x: number; y: number; z: number }>): { x: number; y: number; z: number } {
  return {
    x: Math.max(1, Math.min(16, Math.round(scale.x))),
    y: Math.max(1, Math.min(16, Math.round(scale.y))),
    z: Math.max(1, Math.min(16, Math.round(scale.z))),
  };
}

function normalizedRotation(rotation: Readonly<{ x: number; y: number; z: number }>): { x: number; y: number; z: number } {
  const normalize = (value: number): number => ((Math.round(value) % 4) + 4) % 4;
  return { x: normalize(rotation.x), y: normalize(rotation.y), z: normalize(rotation.z) };
}

function roundedPosition(position: Readonly<{ x: number; y: number; z: number }>): { x: number; y: number; z: number } {
  return { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) };
}

function formatUnit(value: number): string { return Math.max(0, Math.min(1, value)).toFixed(6); }

function int32Bytes(value: number): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.int32(value);
  return writer.toUint8Array();
}

function createChunk(
  id: string,
  content: Uint8Array<ArrayBuffer>,
  children: Uint8Array<ArrayBuffer> = new Uint8Array(0),
): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(12 + content.length + children.length);
  writeAscii(chunk, 0, id);
  const view = new DataView(chunk.buffer);
  view.setUint32(4, content.length, true);
  view.setUint32(8, children.length, true);
  chunk.set(content, 12);
  chunk.set(children, 12 + content.length);
  return chunk;
}

function concatenate(parts: readonly Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) target[offset + index] = value.charCodeAt(index);
}

function validateSize(size: Readonly<SceneSize>): void {
  if (![size.x, size.y, size.z].every(axis => Number.isInteger(axis) && axis >= 1 && axis <= 256)) {
    throw new Error(`VOX 场景尺寸必须在 1 到 256 之间：${size.x}×${size.y}×${size.z}。`);
  }
}

class ByteWriter {
  private readonly _bytes: number[] = [];
  uint8(value: number): void { this._bytes.push(value & 255); }
  int32(value: number): void {
    const normalized = value | 0;
    this._bytes.push(normalized & 255, (normalized >>> 8) & 255, (normalized >>> 16) & 255, (normalized >>> 24) & 255);
  }
  string(value: string): void {
    const encoded = new TextEncoder().encode(value);
    this.int32(encoded.length);
    for (const byte of encoded) this._bytes.push(byte);
  }
  dictionary(entries: Readonly<Record<string, string>>): void {
    const pairs = Object.entries(entries).filter(([, value]) => value !== '');
    this.int32(pairs.length);
    for (const [key, value] of pairs) { this.string(key); this.string(value); }
  }
  toUint8Array(): Uint8Array<ArrayBuffer> { return new Uint8Array(this._bytes); }
}
