import type { VoxelChange } from './commands';
import type { SceneSize, Voxel, VoxelPosition } from './model';
import { normalizeColor, voxelKey } from './model';

export interface MirrorAxes {
  x: boolean;
  y: boolean;
  z: boolean;
}

const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Expands positions across any combination of scene-centered mirror planes. */
export function mirrorVoxelPositions(
  source: Iterable<Readonly<VoxelPosition>>,
  size: Readonly<SceneSize>,
  axes: Readonly<MirrorAxes>,
): VoxelPosition[] {
  const result = new Map<string, VoxelPosition>();
  for (const position of source) {
    const xs = axes.x ? [position.x, size.x - 1 - position.x] : [position.x];
    const ys = axes.y ? [position.y, size.y - 1 - position.y] : [position.y];
    const zs = axes.z ? [position.z, size.z - 1 - position.z] : [position.z];
    for (const z of zs) for (const y of ys) for (const x of xs) {
      if (x < 0 || x >= size.x || y < 0 || y >= size.y || z < 0 || z >= size.z) continue;
      result.set(voxelKey(x, y, z), { x, y, z });
    }
  }
  return Array.from(result.values());
}

/** Returns the six-connected region sharing the seed voxel's color and PBR material. */
export function floodFillVoxels(source: Iterable<Readonly<Voxel>>, seed: Readonly<VoxelPosition>): Voxel[] {
  const voxels = voxelMap(source);
  const first = voxels.get(voxelKey(seed.x, seed.y, seed.z));
  if (!first) return [];
  const result: Voxel[] = [];
  const visited = new Set<string>();
  const queue: VoxelPosition[] = [{ x: first.x, y: first.y, z: first.z }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const position = queue[cursor]!;
    const key = voxelKey(position.x, position.y, position.z);
    if (visited.has(key)) continue;
    visited.add(key);
    const voxel = voxels.get(key);
    if (!voxel || voxel.color !== first.color || voxel.materialId !== first.materialId) continue;
    result.push({ ...voxel });
    for (const [dx, dy, dz] of NEIGHBORS) queue.push({ x: voxel.x + dx, y: voxel.y + dy, z: voxel.z + dz });
  }
  return result;
}

/** Floods one material region but keeps only voxels with at least one exposed face. */
export function surfacePaintVoxels(source: Iterable<Readonly<Voxel>>, seed: Readonly<VoxelPosition>): Voxel[] {
  const all = voxelMap(source);
  return floodFillVoxels(all.values(), seed).filter(voxel => NEIGHBORS.some(([dx, dy, dz]) =>
    !all.has(voxelKey(voxel.x + dx, voxel.y + dy, voxel.z + dz))));
}

export function replacementChanges(
  voxels: Iterable<Readonly<Voxel>>,
  sourceColor: string,
  targetColor: string,
  targetMaterialId: string,
  selection: ReadonlySet<string> | null = null,
): VoxelChange[] {
  const source = normalizeColor(sourceColor);
  const target = normalizeColor(targetColor);
  const result: VoxelChange[] = [];
  for (const voxel of voxels) {
    if (voxel.color !== source) continue;
    const key = voxelKey(voxel.x, voxel.y, voxel.z);
    if (selection && !selection.has(key)) continue;
    if (voxel.color === target && voxel.materialId === targetMaterialId) continue;
    result.push({
      x: voxel.x, y: voxel.y, z: voxel.z,
      before: voxel.color,
      after: target,
      beforeMaterialId: voxel.materialId ?? null,
      afterMaterialId: targetMaterialId,
    });
  }
  return result;
}

function voxelMap(source: Iterable<Readonly<Voxel>>): Map<string, Voxel> {
  const result = new Map<string, Voxel>();
  for (const voxel of source) result.set(voxelKey(voxel.x, voxel.y, voxel.z), { ...voxel });
  return result;
}
