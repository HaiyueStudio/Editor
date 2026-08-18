import { voxelKey, type SceneSize, type Voxel, type VoxelPosition } from './model';

export type TransformAxis = 'x' | 'y' | 'z';
export type SelectionPivotMode = 'center' | 'minimum' | 'custom';
export interface SelectionPivot { x: number; y: number; z: number }

export interface VoxelClipboard {
  origin: Readonly<{ x: number; y: number; z: number }>;
  size: Readonly<SceneSize>;
  voxels: readonly Voxel[];
}

export function translateVoxels(source: Iterable<Voxel>, offset: Readonly<{ x: number; y: number; z: number }>): Voxel[] {
  const dx = integer(offset.x), dy = integer(offset.y), dz = integer(offset.z);
  return Array.from(source, voxel => ({ ...voxel, x: voxel.x + dx, y: voxel.y + dy, z: voxel.z + dz }));
}

export function rotateVoxels90(source: Iterable<Voxel>, axis: TransformAxis): Voxel[] {
  const voxels = Array.from(source, voxel => ({ ...voxel }));
  const bounds = voxelBounds(voxels);
  if (!bounds) return [];
  return voxels.map(voxel => {
    const x = voxel.x - bounds.min.x;
    const y = voxel.y - bounds.min.y;
    const z = voxel.z - bounds.min.z;
    if (axis === 'x') return { ...voxel, y: bounds.min.y + z, z: bounds.min.z + bounds.size.y - y - 1 };
    if (axis === 'y') return { ...voxel, x: bounds.min.x + z, z: bounds.min.z + bounds.size.x - x - 1 };
    return { ...voxel, x: bounds.min.x + y, y: bounds.min.y + bounds.size.x - x - 1 };
  });
}

export function selectionPivot(
  source: Iterable<VoxelPosition>,
  mode: Exclude<SelectionPivotMode, 'custom'> = 'center',
): SelectionPivot | null {
  const bounds = voxelBounds(Array.from(source, voxel => ({ ...voxel })));
  if (!bounds) return null;
  return mode === 'minimum'
    ? { ...bounds.min }
    : {
        x: bounds.min.x + bounds.size.x / 2,
        y: bounds.min.y + bounds.size.y / 2,
        z: bounds.min.z + bounds.size.z / 2,
      };
}

export function rotateVoxels90AroundPivot(
  source: Iterable<Voxel>,
  axis: TransformAxis,
  pivot: Readonly<SelectionPivot>,
  turns = 1,
): Voxel[] {
  const normalizedTurns = ((Math.round(turns) % 4) + 4) % 4;
  const result = Array.from(source, voxel => {
    let cx = voxel.x + 0.5 - pivot.x;
    let cy = voxel.y + 0.5 - pivot.y;
    let cz = voxel.z + 0.5 - pivot.z;
    for (let turn = 0; turn < normalizedTurns; turn += 1) {
      [cx, cy, cz] = axis === 'x'
        ? [cx, -cz, cy]
        : axis === 'y'
          ? [cz, cy, -cx]
          : [-cy, cx, cz];
    }
    return {
      ...voxel,
      x: Math.round(pivot.x + cx - 0.5),
      y: Math.round(pivot.y + cy - 0.5),
      z: Math.round(pivot.z + cz - 0.5),
    };
  });
  return uniqueVoxels(result);
}

export function scaleVoxelsInteger(
  source: Iterable<Voxel>,
  scale: Readonly<{ x: number; y: number; z: number }>,
  pivot: Readonly<SelectionPivot>,
): Voxel[] {
  const sx = integerScale(scale.x), sy = integerScale(scale.y), sz = integerScale(scale.z);
  const result: Voxel[] = [];
  for (const voxel of source) {
    const centerX = pivot.x + (voxel.x + 0.5 - pivot.x) * sx;
    const centerY = pivot.y + (voxel.y + 0.5 - pivot.y) * sy;
    const centerZ = pivot.z + (voxel.z + 0.5 - pivot.z) * sz;
    const startX = Math.round(centerX - sx / 2);
    const startY = Math.round(centerY - sy / 2);
    const startZ = Math.round(centerZ - sz / 2);
    for (let z = 0; z < sz; z += 1) for (let y = 0; y < sy; y += 1) for (let x = 0; x < sx; x += 1) {
      result.push({ ...voxel, x: startX + x, y: startY + y, z: startZ + z });
    }
  }
  return uniqueVoxels(result);
}

export function resizeVoxelsAlongAxis(
  source: Iterable<Voxel>,
  axis: TransformAxis,
  targetSize: number,
  pivot: Readonly<SelectionPivot>,
): Voxel[] {
  const voxels = Array.from(source, voxel => ({ ...voxel }));
  const bounds = voxelBounds(voxels);
  if (!bounds) return [];
  const sourceSize = bounds.size[axis];
  const resizedSize = Math.max(1, Math.min(256, Math.round(targetSize)));
  if (sourceSize === resizedSize) return voxels;

  const sourceMin = bounds.min[axis];
  const targetMin = Math.round(pivot[axis] + (sourceMin - pivot[axis]) * resizedSize / sourceSize);
  const result: Voxel[] = [];
  for (let targetIndex = 0; targetIndex < resizedSize; targetIndex += 1) {
    const sourceIndex = Math.min(sourceSize - 1, Math.floor(targetIndex * sourceSize / resizedSize));
    for (const voxel of voxels) {
      if (voxel[axis] !== sourceMin + sourceIndex) continue;
      result.push({ ...voxel, [axis]: targetMin + targetIndex });
    }
  }
  return uniqueVoxels(result);
}

export function snapTransformSteps(steps: number, snap: number): number {
  const interval = snap === 5 || snap === 10 ? snap : 1;
  return Math.round(steps / interval) * interval;
}

export function flipVoxels(source: Iterable<Voxel>, axis: TransformAxis): Voxel[] {
  const voxels = Array.from(source, voxel => ({ ...voxel }));
  const bounds = voxelBounds(voxels);
  if (!bounds) return [];
  return voxels.map(voxel => ({
    ...voxel,
    x: axis === 'x' ? bounds.min.x + bounds.size.x - (voxel.x - bounds.min.x) - 1 : voxel.x,
    y: axis === 'y' ? bounds.min.y + bounds.size.y - (voxel.y - bounds.min.y) - 1 : voxel.y,
    z: axis === 'z' ? bounds.min.z + bounds.size.z - (voxel.z - bounds.min.z) - 1 : voxel.z,
  }));
}

export function createVoxelClipboard(source: Iterable<Voxel>): VoxelClipboard | null {
  const voxels = Array.from(source, voxel => ({ ...voxel }));
  const bounds = voxelBounds(voxels);
  if (!bounds) return null;
  return {
    origin: bounds.min,
    size: bounds.size,
    voxels: voxels.map(voxel => ({
      ...voxel,
      x: voxel.x - bounds.min.x,
      y: voxel.y - bounds.min.y,
      z: voxel.z - bounds.min.z,
    })),
  };
}

export function pasteVoxelClipboard(
  clipboard: VoxelClipboard,
  origin: Readonly<{ x: number; y: number; z: number }>,
): Voxel[] {
  const target = { x: integer(origin.x), y: integer(origin.y), z: integer(origin.z) };
  return clipboard.voxels.map(voxel => ({
    ...voxel,
    x: target.x + voxel.x,
    y: target.y + voxel.y,
    z: target.z + voxel.z,
  }));
}

function voxelBounds(voxels: readonly VoxelPosition[]): { min: { x: number; y: number; z: number }; size: SceneSize } | null {
  if (voxels.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const voxel of voxels) {
    minX = Math.min(minX, voxel.x); minY = Math.min(minY, voxel.y); minZ = Math.min(minZ, voxel.z);
    maxX = Math.max(maxX, voxel.x); maxY = Math.max(maxY, voxel.y); maxZ = Math.max(maxZ, voxel.z);
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    size: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 },
  };
}

function integer(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function integerScale(value: number): number {
  return Math.max(1, Math.min(16, Math.round(Number.isFinite(value) ? value : 1)));
}

function uniqueVoxels(source: Iterable<Voxel>): Voxel[] {
  const result = new Map<string, Voxel>();
  for (const voxel of source) result.set(voxelKey(voxel.x, voxel.y, voxel.z), voxel);
  return Array.from(result.values());
}
