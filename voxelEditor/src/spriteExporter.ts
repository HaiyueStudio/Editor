import type { SceneSize, Voxel } from './model';
import { voxelKey } from './model';

export type SpriteView = 'isometric' | 'front' | 'back' | 'side' | 'left' | 'top' | 'bottom';
export type SpriteDirection = Exclude<SpriteView, 'side'> | 'right';
export type SpriteSheetLayout = 'horizontal' | 'vertical' | 'grid';
export type SpriteResolutionScale = 1 | 2 | 4 | 8 | 16;

export interface SpriteExportOptions {
  width: number;
  height: number;
  view: SpriteView;
  padding: number;
  background: string | null;
}

export function scaleSpriteExportOptions(
  options: Readonly<SpriteExportOptions>,
  resolutionScaleValue: number,
): SpriteExportOptions {
  if (![1, 2, 4, 8, 16].includes(resolutionScaleValue)) {
    throw new Error('Sprite 分辨率倍率必须是 1×、2×、4×、8× 或 16×。');
  }
  const resolutionScale = resolutionScaleValue as SpriteResolutionScale;
  return {
    ...options,
    width: spriteDimension(options.width * resolutionScale, 'Sprite 输出宽度'),
    height: spriteDimension(options.height * resolutionScale, 'Sprite 输出高度'),
    padding: Math.round(options.padding * resolutionScale),
  };
}

export interface SpritePolygon {
  points: readonly [number, number][];
  color: string;
  depth: number;
}

export interface SpriteFramePlan {
  width: number;
  height: number;
  polygons: SpritePolygon[];
}

export interface SpriteProjectionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SpriteSheetPlan {
  columns: number;
  rows: number;
  width: number;
  height: number;
}

export interface SpriteAtlasFrameInput {
  name: string;
  frame: number;
  direction: SpriteDirection;
  column: number;
  row: number;
  plan: Readonly<SpriteFramePlan>;
}

export interface SpriteAtlasOptions {
  image: string;
  sheet: Readonly<SpriteSheetPlan>;
  frameWidth: number;
  frameHeight: number;
  pivot: Readonly<{ x: number; y: number }>;
  fps: number;
  loop: boolean;
  frameStart: number;
  frameEnd: number;
  directions: readonly SpriteDirection[];
}

export interface SpriteAtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  pivot: { x: number; y: number };
  collision: { x: number; y: number; w: number; h: number };
  sourceFrame: number;
  direction: SpriteDirection;
}

export interface SpriteAtlas {
  frames: Record<string, SpriteAtlasFrame>;
  meta: {
    app: 'Haiyue Voxel Editor';
    version: 1;
    image: string;
    format: 'RGBA8888';
    size: { w: number; h: number };
    scale: '1';
    fps: number;
    loop: boolean;
    frameRange: { start: number; end: number };
    directions: SpriteDirection[];
  };
}

interface FaceDefinition {
  normal: readonly [number, number, number];
  shade: number;
  corners: readonly (readonly [number, number, number])[];
}

const ISOMETRIC_FACES: readonly FaceDefinition[] = [
  { normal: [0, 1, 0], shade: 1.08, corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { normal: [1, 0, 0], shade: 0.78, corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, 0, 1], shade: 0.91, corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
];

export function createVoxelSpriteFrame(
  sceneSize: Readonly<SceneSize>,
  source: Iterable<Voxel>,
  options: Readonly<SpriteExportOptions>,
  fitBounds: Readonly<SpriteProjectionBounds> | null = null,
): SpriteFramePlan {
  const width = spriteDimension(options.width, 'Sprite 宽度');
  const height = spriteDimension(options.height, 'Sprite 高度');
  const padding = Math.max(0, Math.min(Math.floor(Math.min(width, height) / 2) - 1, Math.round(options.padding)));
  const voxels = Array.from(source, voxel => ({ ...voxel }));
  if (voxels.length === 0) return { width, height, polygons: [] };
  const occupied = new Set(voxels.map(voxel => voxelKey(voxel.x, voxel.y, voxel.z)));
  const raw: SpritePolygon[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const voxel of voxels) {
    const faces = facesForView(options.view);
    for (const face of faces) {
      const nx = voxel.x + face.normal[0];
      const ny = voxel.y + face.normal[1];
      const nz = voxel.z + face.normal[2];
      if (occupied.has(voxelKey(nx, ny, nz))) continue;
      const points = face.corners.map(corner => projectVertex(
        voxel.x + corner[0], voxel.y + corner[1], voxel.z + corner[2], options.view,
      )) as [number, number][];
      for (const point of points) {
        if (point[0] < minX) minX = point[0];
        if (point[0] > maxX) maxX = point[0];
        if (point[1] < minY) minY = point[1];
        if (point[1] > maxY) maxY = point[1];
      }
      raw.push({
        points,
        color: shadeHex(voxel.color, face.shade),
        depth: faceDepth(voxel.x, voxel.y, voxel.z, face.normal, options.view),
      });
    }
  }
  if (raw.length === 0) return { width, height, polygons: [] };
  const bounds = fitBounds ?? { minX, maxX, minY, maxY };
  const contentWidth = Math.max(1e-6, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1e-6, bounds.maxY - bounds.minY);
  const scale = Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight);
  const offsetX = (width - contentWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = (height - contentHeight * scale) / 2 - bounds.minY * scale;
  const polygons = raw.sort((a, b) => a.depth - b.depth).map(polygon => ({
    ...polygon,
    points: polygon.points.map(point => [
      Math.round(point[0] * scale + offsetX),
      Math.round(point[1] * scale + offsetY),
    ] as [number, number]),
  }));
  void sceneSize;
  return { width, height, polygons };
}

/** Projected model bounds used to keep every frame of an animation on one stable scale. */
export function voxelSpriteProjectionBounds(
  source: Iterable<Voxel>,
  view: SpriteView,
): SpriteProjectionBounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const voxel of source) {
    for (let dx = 0; dx <= 1; dx += 1) {
      for (let dy = 0; dy <= 1; dy += 1) {
        for (let dz = 0; dz <= 1; dz += 1) {
          const [x, y] = projectVertex(voxel.x + dx, voxel.y + dy, voxel.z + dz, view);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  return minX === Infinity ? null : { minX, maxX, minY, maxY };
}

export function mergeSpriteProjectionBounds(
  current: Readonly<SpriteProjectionBounds> | null,
  incoming: Readonly<SpriteProjectionBounds> | null,
): SpriteProjectionBounds | null {
  if (!incoming) return current ? { ...current } : null;
  if (!current) return { ...incoming };
  return {
    minX: Math.min(current.minX, incoming.minX),
    maxX: Math.max(current.maxX, incoming.maxX),
    minY: Math.min(current.minY, incoming.minY),
    maxY: Math.max(current.maxY, incoming.maxY),
  };
}

export function spriteSheetPlan(
  frameCountValue: number,
  frameWidth: number,
  frameHeight: number,
  layout: SpriteSheetLayout,
  requestedColumns = 0,
): SpriteSheetPlan {
  const frameCount = Math.max(1, Math.round(frameCountValue));
  const width = spriteDimension(frameWidth, 'Sprite 宽度');
  const height = spriteDimension(frameHeight, 'Sprite 高度');
  const columns = layout === 'vertical'
    ? 1
    : layout === 'horizontal'
      ? frameCount
      : Math.max(1, Math.min(frameCount, Math.round(requestedColumns) || Math.ceil(Math.sqrt(frameCount))));
  const rows = Math.ceil(frameCount / columns);
  const sheetWidth = columns * width;
  const sheetHeight = rows * height;
  if (sheetWidth > 16_384 || sheetHeight > 16_384 || sheetWidth * sheetHeight > 268_435_456) {
    throw new Error(`Sprite Sheet 尺寸 ${sheetWidth}×${sheetHeight} 超过浏览器安全上限，请减小单帧尺寸或列数。`);
  }
  return { columns, rows, width: sheetWidth, height: sheetHeight };
}

export function drawVoxelSpriteFrame(
  context: CanvasRenderingContext2D,
  plan: Readonly<SpriteFramePlan>,
  offsetX = 0,
  offsetY = 0,
  background: string | null = null,
): void {
  context.save();
  context.imageSmoothingEnabled = false;
  if (background) {
    context.fillStyle = background;
    context.fillRect(offsetX, offsetY, plan.width, plan.height);
  } else {
    context.clearRect(offsetX, offsetY, plan.width, plan.height);
  }
  context.translate(offsetX, offsetY);
  for (const polygon of plan.polygons) {
    const first = polygon.points[0];
    if (!first) continue;
    context.beginPath();
    context.moveTo(first[0], first[1]);
    for (let index = 1; index < polygon.points.length; index += 1) {
      const point = polygon.points[index]!;
      context.lineTo(point[0], point[1]);
    }
    context.closePath();
    context.fillStyle = polygon.color;
    context.fill();
  }
  context.restore();
}

/** TexturePacker-compatible atlas metadata with Haiyue frame, direction and collision extensions. */
export function createSpriteAtlas(
  inputs: readonly Readonly<SpriteAtlasFrameInput>[],
  options: Readonly<SpriteAtlasOptions>,
): SpriteAtlas {
  const pivot = {
    x: clampUnit(options.pivot.x, 0.5),
    y: clampUnit(options.pivot.y, 1),
  };
  const frames: Record<string, SpriteAtlasFrame> = {};
  for (const input of inputs) {
    const collision = spriteFrameContentBounds(input.plan);
    frames[input.name] = {
      frame: {
        x: input.column * options.frameWidth,
        y: input.row * options.frameHeight,
        w: options.frameWidth,
        h: options.frameHeight,
      },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: options.frameWidth, h: options.frameHeight },
      sourceSize: { w: options.frameWidth, h: options.frameHeight },
      pivot: { ...pivot },
      collision,
      sourceFrame: input.frame,
      direction: input.direction,
    };
  }
  return {
    frames,
    meta: {
      app: 'Haiyue Voxel Editor',
      version: 1,
      image: options.image,
      format: 'RGBA8888',
      size: { w: options.sheet.width, h: options.sheet.height },
      scale: '1',
      fps: Math.max(1, Math.round(options.fps)),
      loop: options.loop,
      frameRange: { start: options.frameStart, end: options.frameEnd },
      directions: [...options.directions],
    },
  };
}

export function spriteFrameContentBounds(plan: Readonly<SpriteFramePlan>): { x: number; y: number; w: number; h: number } {
  let minX = plan.width;
  let minY = plan.height;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (const polygon of plan.polygons) {
    for (const [x, y] of polygon.points) {
      found = true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!found) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  return {
    x,
    y,
    w: Math.max(0, Math.min(plan.width, Math.ceil(maxX)) - x),
    h: Math.max(0, Math.min(plan.height, Math.ceil(maxY)) - y),
  };
}

function facesForView(view: SpriteView): readonly FaceDefinition[] {
  if (view === 'front') return [{ normal: [0, 0, 1], shade: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }];
  if (view === 'back') return [{ normal: [0, 0, -1], shade: 0.86, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }];
  if (view === 'side') return [{ normal: [1, 0, 0], shade: 0.9, corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] }];
  if (view === 'left') return [{ normal: [-1, 0, 0], shade: 0.82, corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]] }];
  if (view === 'top') return [{ normal: [0, 1, 0], shade: 1.08, corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] }];
  if (view === 'bottom') return [{ normal: [0, -1, 0], shade: 0.72, corners: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]] }];
  return ISOMETRIC_FACES;
}

function projectVertex(x: number, y: number, z: number, view: SpriteView): [number, number] {
  if (view === 'front') return [x, -y];
  if (view === 'back') return [-x, -y];
  if (view === 'side') return [-z, -y];
  if (view === 'left') return [z, -y];
  if (view === 'top') return [x, z];
  if (view === 'bottom') return [x, -z];
  return [x - z, (x + z) * 0.5 - y];
}

function faceDepth(x: number, y: number, z: number, normal: readonly [number, number, number], view: SpriteView): number {
  if (view === 'front') return z + normal[2] * 0.5;
  if (view === 'back') return -z - normal[2] * 0.5;
  if (view === 'side') return x + normal[0] * 0.5;
  if (view === 'left') return -x - normal[0] * 0.5;
  if (view === 'top') return y + normal[1] * 0.5;
  if (view === 'bottom') return -y - normal[1] * 0.5;
  return x + z + y * 0.001 + (normal[0] + normal[2]) * 0.25 + normal[1] * 0.001;
}

function clampUnit(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function shadeHex(color: string, factor: number): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
  const channel = (offset: number): string => Math.max(0, Math.min(255,
    Math.round(Number.parseInt(normalized.slice(offset, offset + 2), 16) * factor),
  )).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function spriteDimension(value: number, label: string): number {
  const dimension = Math.round(value);
  if (!Number.isFinite(dimension) || dimension < 8 || dimension > 2048) throw new Error(`${label}必须在 8 到 2048 之间。`);
  return dimension;
}
