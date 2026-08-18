import type { SceneSize, VoxelPosition } from './model';
import { voxelKey } from './model';

export type InteractiveBrushKind = 'voxel' | 'line' | 'box';
export type BrushKind = InteractiveBrushKind | 'flood' | 'surface';

export function generateInteractiveBrushVoxels(
  kind: InteractiveBrushKind,
  start: Readonly<VoxelPosition>,
  end: Readonly<VoxelPosition>,
  size: number,
  sceneSize: Readonly<SceneSize>,
): VoxelPosition[] {
  const brushSize = Math.max(1, Math.min(16, Math.round(size)));
  const centers = kind === 'line'
    ? lineVoxels(start, end)
    : kind === 'box'
      ? boxVoxels(start, end)
      : [{ x: end.x, y: end.y, z: end.z }];
  if (kind === 'box') return clipUnique(centers, sceneSize);
  const lower = Math.floor((brushSize - 1) / 2);
  const upper = brushSize - lower - 1;
  const expanded: VoxelPosition[] = [];
  for (const center of centers) {
    for (let z = center.z - lower; z <= center.z + upper; z += 1) {
      for (let y = center.y - lower; y <= center.y + upper; y += 1) {
        for (let x = center.x - lower; x <= center.x + upper; x += 1) expanded.push({ x, y, z });
      }
    }
  }
  return clipUnique(expanded, sceneSize);
}

function lineVoxels(start: Readonly<VoxelPosition>, end: Readonly<VoxelPosition>): VoxelPosition[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  if (steps === 0) return [{ x: start.x, y: start.y, z: start.z }];
  const result: VoxelPosition[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    result.push({
      x: Math.round(start.x + dx * ratio),
      y: Math.round(start.y + dy * ratio),
      z: Math.round(start.z + dz * ratio),
    });
  }
  return result;
}

function boxVoxels(start: Readonly<VoxelPosition>, end: Readonly<VoxelPosition>): VoxelPosition[] {
  const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
  const minZ = Math.min(start.z, end.z), maxZ = Math.max(start.z, end.z);
  const result: VoxelPosition[] = [];
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) result.push({ x, y, z });
    }
  }
  return result;
}

function clipUnique(source: Iterable<VoxelPosition>, size: Readonly<SceneSize>): VoxelPosition[] {
  const result = new Map<string, VoxelPosition>();
  for (const position of source) {
    if (position.x < 0 || position.x >= size.x || position.y < 0 || position.y >= size.y || position.z < 0 || position.z >= size.z) continue;
    result.set(voxelKey(position.x, position.y, position.z), position);
  }
  return Array.from(result.values());
}
