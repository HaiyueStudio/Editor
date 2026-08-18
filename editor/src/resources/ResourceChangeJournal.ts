export type ResourceKind = 'geometry3d' | 'geometry2d' | 'material3d' | 'material2d' | 'texture' | 'model' | 'prefab' | 'script';
export type ResourceAssetId = `${ResourceKind}:${number}`;
export type ResourceChangeKind = 'added' | 'updated' | 'removed' | 'referencesChanged';

export interface ResourceChangeSet {
  readonly version: number;
  readonly added: readonly ResourceAssetId[];
  readonly updated: readonly ResourceAssetId[];
  readonly removed: readonly ResourceAssetId[];
  readonly referencesChanged: readonly ResourceAssetId[];
}

/** Coalesces resource mutations between editor renders without owning resources. */
export class ResourceChangeJournal {
  private version = 0;
  private readonly added = new Set<ResourceAssetId>();
  private readonly updated = new Set<ResourceAssetId>();
  private readonly removed = new Set<ResourceAssetId>();
  private readonly referencesChanged = new Set<ResourceAssetId>();

  consume(): ResourceChangeSet {
    const changes = Object.freeze({
      version: this.version,
      added: Object.freeze([...this.added]),
      updated: Object.freeze([...this.updated]),
      removed: Object.freeze([...this.removed]),
      referencesChanged: Object.freeze([...this.referencesChanged]),
    });
    this.added.clear();
    this.updated.clear();
    this.removed.clear();
    this.referencesChanged.clear();
    return changes;
  }

  record(type: ResourceChangeKind, assetId: ResourceAssetId): void {
    this.version = this.version >= Number.MAX_SAFE_INTEGER ? 1 : this.version + 1;
    if (type === 'added') {
      if (this.removed.delete(assetId)) this.updated.add(assetId);
      else this.added.add(assetId);
      return;
    }
    if (type === 'removed') {
      if (this.added.delete(assetId)) {
        this.updated.delete(assetId);
        this.referencesChanged.delete(assetId);
        return;
      }
      this.removed.add(assetId);
      this.updated.delete(assetId);
      this.referencesChanged.delete(assetId);
      return;
    }
    if (this.added.has(assetId) || this.removed.has(assetId)) return;
    if (type === 'updated') this.updated.add(assetId);
    else this.referencesChanged.add(assetId);
  }
}

export function resourceAssetId(kind: ResourceKind, id: number): ResourceAssetId {
  return `${kind}:${id}`;
}
