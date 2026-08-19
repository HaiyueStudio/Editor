import type { Voxel, VoxelPosition } from './model';
import { voxelKey } from './model';

export type SelectionApplyMode = 'replace' | 'add' | 'subtract';

export class VoxelSelection extends EventTarget {
  private readonly _keys = new Set<string>();

  get count(): number { return this._keys.size; }
  get keys(): ReadonlySet<string> { return this._keys; }

  has(position: VoxelPosition): boolean {
    return this._keys.has(voxelKey(position.x, position.y, position.z));
  }

  apply(positions: Iterable<VoxelPosition>, mode: SelectionApplyMode = 'replace'): boolean {
    const incoming = new Set<string>();
    for (const position of positions) incoming.add(voxelKey(position.x, position.y, position.z));
    const next = mode === 'replace' ? incoming : new Set(this._keys);
    if (mode === 'add') for (const key of incoming) next.add(key);
    if (mode === 'subtract') for (const key of incoming) next.delete(key);
    return this._replaceKeys(next);
  }

  selectAll(voxels: Iterable<VoxelPosition>): boolean {
    return this.apply(voxels, 'replace');
  }

  invert(voxels: Iterable<VoxelPosition>): boolean {
    const next = new Set<string>();
    for (const voxel of voxels) {
      const key = voxelKey(voxel.x, voxel.y, voxel.z);
      if (!this._keys.has(key)) next.add(key);
    }
    return this._replaceKeys(next);
  }

  retain(voxels: Iterable<VoxelPosition>): boolean {
    const available = new Set<string>();
    for (const voxel of voxels) available.add(voxelKey(voxel.x, voxel.y, voxel.z));
    const next = new Set([...this._keys].filter(key => available.has(key)));
    return this._replaceKeys(next);
  }

  retainWhere(predicate: (key: string) => boolean): boolean {
    return this._replaceKeys(new Set([...this._keys].filter(predicate)));
  }

  clear(): boolean {
    if (this._keys.size === 0) return false;
    this._keys.clear();
    this.dispatchEvent(new Event('change'));
    return true;
  }

  private _replaceKeys(next: ReadonlySet<string>): boolean {
    if (next.size === this._keys.size && [...next].every(key => this._keys.has(key))) return false;
    this._keys.clear();
    for (const key of next) this._keys.add(key);
    this.dispatchEvent(new Event('change'));
    return true;
  }
}

export function connectedVoxels(source: Iterable<Voxel>, seed: VoxelPosition): Voxel[] {
  const voxels = new Map<string, Voxel>();
  for (const voxel of source) voxels.set(voxelKey(voxel.x, voxel.y, voxel.z), voxel);
  const first = voxels.get(voxelKey(seed.x, seed.y, seed.z));
  if (!first) return [];
  const selected: Voxel[] = [];
  const visited = new Set<string>();
  const queue: VoxelPosition[] = [first];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const position = queue[cursor]!;
    const key = voxelKey(position.x, position.y, position.z);
    if (visited.has(key)) continue;
    visited.add(key);
    const voxel = voxels.get(key);
    if (!voxel || voxel.color !== first.color) continue;
    selected.push(voxel);
    queue.push(
      { x: voxel.x + 1, y: voxel.y, z: voxel.z },
      { x: voxel.x - 1, y: voxel.y, z: voxel.z },
      { x: voxel.x, y: voxel.y + 1, z: voxel.z },
      { x: voxel.x, y: voxel.y - 1, z: voxel.z },
      { x: voxel.x, y: voxel.y, z: voxel.z + 1 },
      { x: voxel.x, y: voxel.y, z: voxel.z - 1 },
    );
  }
  return selected;
}

export function voxelsWithColor(source: Iterable<Voxel>, color: string): Voxel[] {
  return Array.from(source, voxel => voxel).filter(voxel => voxel.color === color);
}

export function projectWorldPoint(
  viewProjection: ArrayLike<number>,
  world: readonly [number, number, number],
  viewport: Readonly<{ left: number; top: number; width: number; height: number }>,
): { x: number; y: number } | null {
  if (viewProjection.length < 16 || viewport.width <= 0 || viewport.height <= 0) return null;
  const [x, y, z] = world;
  const clipX = valueAt(viewProjection, 0) * x + valueAt(viewProjection, 4) * y + valueAt(viewProjection, 8) * z + valueAt(viewProjection, 12);
  const clipY = valueAt(viewProjection, 1) * x + valueAt(viewProjection, 5) * y + valueAt(viewProjection, 9) * z + valueAt(viewProjection, 13);
  const clipZ = valueAt(viewProjection, 2) * x + valueAt(viewProjection, 6) * y + valueAt(viewProjection, 10) * z + valueAt(viewProjection, 14);
  const clipW = valueAt(viewProjection, 3) * x + valueAt(viewProjection, 7) * y + valueAt(viewProjection, 11) * z + valueAt(viewProjection, 15);
  if (!Number.isFinite(clipW) || clipW <= 1e-7) return null;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  const ndcZ = clipZ / clipW;
  if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1 || ndcZ < 0 || ndcZ > 1) return null;
  return {
    x: viewport.left + (ndcX + 1) * 0.5 * viewport.width,
    y: viewport.top + (1 - ndcY) * 0.5 * viewport.height,
  };
}

function valueAt(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  return Number.isFinite(value) ? value! : 0;
}
