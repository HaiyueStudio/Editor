/**
 * Reverse indexes the renderer's projected voxels. Invalidation lookup is
 * proportional to the affected material/instance instead of the whole model.
 */
export class VoxelRenderProjectionCache {
  private readonly _materialKeys = new Map<string, Set<string>>();
  private readonly _instanceKeys = new Map<string, Set<string>>();
  private readonly _records = new Map<string, { materialId: string; instanceId: string | null }>();

  get size(): number { return this._records.size; }

  set(key: string, materialId: string, instanceId: string | null): void {
    this.delete(key);
    this._records.set(key, { materialId, instanceId });
    addIndex(this._materialKeys, materialId, key);
    if (instanceId) addIndex(this._instanceKeys, instanceId, key);
  }

  delete(key: string): void {
    const previous = this._records.get(key);
    if (!previous) return;
    this._records.delete(key);
    deleteIndex(this._materialKeys, previous.materialId, key);
    if (previous.instanceId) deleteIndex(this._instanceKeys, previous.instanceId, key);
  }

  keysForMaterials(materialIds: Iterable<string>): Set<string> {
    return collectIndexedKeys(this._materialKeys, materialIds);
  }

  keysForInstances(instanceIds: Iterable<string>): Set<string> {
    return collectIndexedKeys(this._instanceKeys, instanceIds);
  }

  clear(): void {
    this._records.clear();
    this._materialKeys.clear();
    this._instanceKeys.clear();
  }
}

function addIndex(index: Map<string, Set<string>>, id: string, key: string): void {
  let keys = index.get(id);
  if (!keys) {
    keys = new Set();
    index.set(id, keys);
  }
  keys.add(key);
}

function deleteIndex(index: Map<string, Set<string>>, id: string, key: string): void {
  const keys = index.get(id);
  if (!keys) return;
  keys.delete(key);
  if (keys.size === 0) index.delete(id);
}

function collectIndexedKeys(index: ReadonlyMap<string, ReadonlySet<string>>, ids: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const id of ids) for (const key of index.get(id) ?? []) result.add(key);
  return result;
}
