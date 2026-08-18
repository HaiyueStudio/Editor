export interface SceneSize {
  x: number;
  y: number;
  z: number;
}

export interface Voxel {
  x: number;
  y: number;
  z: number;
  color: string;
  materialId?: string | undefined;
  /** Scene voxels use this layer; omitted means the default layer. Module-definition voxels ignore it. */
  layerId?: string | undefined;
}

export interface VoxelPosition {
  x: number;
  y: number;
  z: number;
}

export interface BatchVoxelResult {
  added: number;
  painted: number;
  unchanged: number;
}

export interface VoxelPatchEntry extends VoxelPosition {
  color: string | null;
  materialId?: string | null | undefined;
  layerId?: string | null | undefined;
}

export interface VoxelModuleData {
  id: string;
  name: string;
  size: SceneSize;
  voxels: Voxel[];
}

export interface ModuleSummary {
  id: string;
  name: string;
  size: SceneSize;
  voxelCount: number;
  instanceCount: number;
  revision: number;
}

export interface AnimationSummary {
  id: string;
  name: string;
  fps: number;
  frameCount: number;
  loop: boolean;
  trackCount: number;
}

export interface VoxelModuleInstance {
  id: string;
  moduleId: string;
  name: string;
  position: VoxelPosition;
  rotation: VoxelPosition;
  scale: VoxelPosition;
  layerId: string;
  visible: boolean;
}

export interface VoxelAnimationKeyframe {
  frame: number;
  moduleId: string;
  position: VoxelPosition;
  rotation: VoxelPosition;
  scale: VoxelPosition;
  visible: boolean;
}

export interface VoxelAnimationTrack {
  instanceId: string;
  keyframes: VoxelAnimationKeyframe[];
}

export interface AnimationKeyframeSnapshot {
  instanceId: string;
  frame: number;
  keyframe: Readonly<VoxelAnimationKeyframe> | null;
}

export interface VoxelAnimationClip {
  id: string;
  name: string;
  fps: number;
  frameCount: number;
  loop: boolean;
  /** Inclusive playback range. Missing values in legacy projects mean the complete clip. */
  playbackStart?: number;
  playbackEnd?: number;
  tracks: VoxelAnimationTrack[];
}

export interface VoxelLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface PbrPaletteMaterial {
  id: string;
  color: string;
  name: string;
  metallic: number;
  roughness: number;
  /** Original MagicaVoxel MATL data. Glass/emit/media are previewed approximately by the PBR renderer. */
  vox?: {
    type: 'diffuse' | 'metal' | 'glass' | 'emit' | 'media' | 'unknown';
    properties: Record<string, string>;
    compatibility: 'full' | 'partial';
  };
}

export interface RenderableVoxel extends Voxel {
  source: 'base' | 'module-definition' | 'module-instance';
  moduleId?: string;
  moduleInstanceId?: string;
}

export interface VoxelProject {
  format: 'haiyue-voxel';
  version: 1;
  size: SceneSize;
  scene?: {
    backgroundColor: string;
  };
  editor: {
    currentColor: string;
    currentMaterialId?: string;
    activeAnimationId?: string | null;
    animationFrame?: number;
  };
  voxels: Voxel[];
  modules?: VoxelModuleData[];
  moduleInstances?: VoxelModuleInstance[];
  layers?: VoxelLayer[];
  palette?: PbrPaletteMaterial[];
  animations?: VoxelAnimationClip[];
}

export type VoxelDocumentChangeReason =
  | 'color' | 'scene-background'
  | 'palette-create' | 'palette-update' | 'palette-remove'
  | 'add' | 'paint' | 'command-patch' | 'batch' | 'remove' | 'resize' | 'clear'
  | 'module-create' | 'module-update' | 'module-remove' | 'edit-target'
  | 'module-instance-add' | 'module-instance-transform' | 'module-instance-remove'
  | 'animation-create' | 'animation-update' | 'animation-remove' | 'animation-select'
  | 'animation-frame' | 'animation-keyframe' | 'animation-keyframe-remove'
  | 'layer-create' | 'layer-update' | 'layer-remove'
  | 'load';

export interface VoxelDocumentDirtyFlags {
  scene: boolean;
  view: boolean;
  render: boolean;
  palette: boolean;
  modules: boolean;
  animation: boolean;
  grid: boolean;
  selection: 'none' | 'retain' | 'clear';
}

export interface VoxelDocumentChangeDetail {
  reason: VoxelDocumentChangeReason;
  dirty: Readonly<VoxelDocumentDirtyFlags>;
  impact: Readonly<VoxelDocumentChangeImpact>;
}

export type PackedVoxelKey = number;

export interface VoxelDocumentChangeImpact {
  /** Structural changes still require a complete view traversal. */
  fullRender: boolean;
  /** Packed as x | y << 8 | z << 16; scene axes are capped at 256. */
  voxelKeys: readonly PackedVoxelKey[];
  instanceIds: readonly string[];
  materialIds: readonly string[];
}

export const DEFAULT_SCENE_SIZE: Readonly<SceneSize> = Object.freeze({ x: 50, y: 50, z: 50 });
export const DEFAULT_SCENE_BACKGROUND_COLOR = '#090c11';
export const MAX_SCENE_AXIS = 256;
export const MAX_VOXELS = 200_000;
export const DEFAULT_LAYER_ID = 'layer-1';
export const DEFAULT_PBR_METALLIC = 0.04;
export const DEFAULT_PBR_ROUGHNESS = 0.68;
export const DEFAULT_PALETTE: readonly Readonly<PbrPaletteMaterial>[] = Object.freeze([
  { id: 'material-1', color: '#f26b5e', name: '珊瑚红', metallic: 0.02, roughness: 0.72 },
  { id: 'material-2', color: '#f3a738', name: '琥珀橙', metallic: 0.04, roughness: 0.62 },
  { id: 'material-3', color: '#f5d547', name: '明黄', metallic: 0.08, roughness: 0.58 },
  { id: 'material-4', color: '#7ec850', name: '草绿', metallic: 0.02, roughness: 0.76 },
  { id: 'material-5', color: '#69d2e7', name: '青蓝', metallic: 0.04, roughness: 0.68 },
  { id: 'material-6', color: '#4f83e1', name: '群青', metallic: 0.08, roughness: 0.56 },
  { id: 'material-7', color: '#8d70d6', name: '紫罗兰', metallic: 0.06, roughness: 0.64 },
  { id: 'material-8', color: '#d86eb4', name: '玫红', metallic: 0.04, roughness: 0.7 },
  { id: 'material-9', color: '#f3efe7', name: '暖白', metallic: 0, roughness: 0.84 },
  { id: 'material-10', color: '#aab4c3', name: '浅银', metallic: 0.62, roughness: 0.34 },
  { id: 'material-11', color: '#566175', name: '枪灰', metallic: 0.74, roughness: 0.3 },
  { id: 'material-12', color: '#242a36', name: '深黑', metallic: 0.18, roughness: 0.48 },
]);

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function voxelKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function packVoxelKey(x: number, y: number, z: number): PackedVoxelKey {
  return (x & 0xff) | ((y & 0xff) << 8) | ((z & 0xff) << 16);
}

export function unpackVoxelKey(key: PackedVoxelKey): VoxelPosition {
  return { x: key & 0xff, y: (key >>> 8) & 0xff, z: (key >>> 16) & 0xff };
}

export function normalizeColor(value: string): string {
  const color = value.trim();
  if (!HEX_COLOR.test(color)) throw new Error(`无效颜色：${value}`);
  return color.toLowerCase();
}
