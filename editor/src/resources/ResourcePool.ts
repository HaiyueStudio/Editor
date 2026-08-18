import { BasicMaterial, Entity, Geometry2D, Geometry3D, Material2D, Mesh2D, Mesh3D, World } from '@haiyue/engine';
import { CssMaterial, Material, type MaterialTextureSource } from '@haiyue/engine/material';
import { ScriptComponent, ScriptResource } from '@haiyue/engine/components';
import { type AssetHandle, type AssetManager } from '@haiyue/engine/assets';
import { type WorldComponentChange } from '@haiyue/engine/ecs';
import type {
  AssetId,
  ComponentResourceUsageExtension,
  ModelResourceItem,
  PrefabResourceItem,
  PrefabVariantConflict,
  PrefabVariantOverride,
  ScriptResourceItem,
  TextureResourceItem,
  TextureSource,
} from '../types';
import type { SerializedEntity } from '../export/RuntimeSceneContract';
import { getUniqueName } from '../domain/resource/resourceNames';
import {
  ResourceChangeJournal,
  resourceAssetId,
  type ResourceAssetId,
  type ResourceChangeKind,
  type ResourceChangeSet,
  type ResourceKind,
} from './ResourceChangeJournal';
import {
  applyVariantOverrides,
  clearVariantOverrideField,
  cloneSerializedEntity,
  cloneVariantOverride,
  cloneVariantOverrides,
  diffSerializedEntity,
  getPrefabAssetKey,
  getVariantOverrideFields,
  hasVariantOverridePayload,
  pathsEqual,
} from './PrefabVariant';
import {
  addAssetIdToUsage,
  createEmptyEntityResourceUsage,
  type EntityResourceUsage,
} from './ResourceUsage';
import { ResourceLookupIndex } from './ResourceLookupIndex';

export type { ResourceAssetId, ResourceChangeSet, ResourceKind } from './ResourceChangeJournal';

const EMPTY_RESOURCE_IDS = new Set<number>();
const EMPTY_ENTITY_RESOURCE_USAGE: EntityResourceUsage = {
  geometries: EMPTY_RESOURCE_IDS,
  geometries2D: EMPTY_RESOURCE_IDS,
  materials: EMPTY_RESOURCE_IDS,
  materials2D: EMPTY_RESOURCE_IDS,
  textures: EMPTY_RESOURCE_IDS,
  models: EMPTY_RESOURCE_IDS,
  prefabs: EMPTY_RESOURCE_IDS,
  scripts: EMPTY_RESOURCE_IDS,
};

export interface ResourcePoolOptions {
  getResourceName: (resource: object, fallback: string) => string;
  getPrefabId: (entity: Entity) => number | null;
  assetManager?: AssetManager;
  componentResourceExtensions?: ComponentResourceUsageExtension[];
}

export class ResourcePool {
  readonly geometries = new Map<number, { name: string; resource: Geometry3D; refs: number }>();
  readonly geometries2D = new Map<number, { name: string; resource: Geometry2D; refs: number }>();
  readonly materials = new Map<number, { name: string; resource: Material; refs: number }>();
  readonly materials2D = new Map<number, { name: string; resource: Material2D; refs: number }>();
  readonly textures = new Map<number, TextureResourceItem>();
  readonly models = new Map<number, ModelResourceItem>();
  readonly prefabs = new Map<number, PrefabResourceItem>();
  readonly scripts = new Map<number, ScriptResourceItem>();
  private readonly _lookupIndex = new ResourceLookupIndex();
  private _textureId = 0;
  private _modelId = 0;
  private _prefabId = 0;
  private readonly _entityUsage = new Map<number, EntityResourceUsage>();
  private readonly _prefabAssetUsage = new Map<number, EntityResourceUsage>();
  private _worldCursors = new WeakMap<World, { revision: number; generation: number }>();
  private readonly _worldChangeScratch: WorldComponentChange[] = [];
  private readonly _changedEntitiesScratch = new Map<number, Entity>();
  private readonly _liveEntityIdsScratch = new Set<number>();
  private _worldCursorGeneration = 1;
  private readonly _changes = new ResourceChangeJournal();
  private readonly _textureGpuHandles = new Map<number, AssetHandle<GPUTexture>>();
  private readonly _textureAssetVersions = new Map<number, number>();
  private _componentResourceExtensions: ComponentResourceUsageExtension[];
  private _assetManager: AssetManager | null;

  constructor(private readonly _options: ResourcePoolOptions) {
    this._assetManager = _options.assetManager ?? null;
    this._componentResourceExtensions = [...(_options.componentResourceExtensions ?? [])];
  }

  consumeChanges(): ResourceChangeSet {
    return this._changes.consume();
  }

  markUpdated(kind: ResourceKind, id: number): void {
    this._recordChange('updated', resourceAssetId(kind, id));
  }

  setComponentResourceExtensions(extensions: readonly ComponentResourceUsageExtension[]): void {
    this._componentResourceExtensions = [...extensions];
  }

  attachAssetManager(assetManager: AssetManager | null): void {
    if (this._assetManager && this._assetManager !== assetManager) {
      for (const item of this.textures.values()) this._deleteTextureAsset(item);
      for (const item of this.models.values()) this._assetManager.deleteAsset(item.assetKey);
      for (const item of this.prefabs.values()) this._assetManager.deleteAsset(item.assetKey);
    }
    this._assetManager = assetManager;
    if (!assetManager) return;
    for (const item of this.textures.values()) void this._syncTextureAsset(item);
    for (const item of this.models.values()) this._syncModelAsset(item);
    for (const item of this.prefabs.values()) this._syncPrefabAsset(item);
  }

  registerGeometry(resource: Geometry3D, name = this._options.getResourceName(resource, `Geometry ${resource.id}`)): void {
    if (!this.geometries.has(resource.id)) {
      this.geometries.set(resource.id, { name, resource, refs: 0 });
      this._recordChange('added', resourceAssetId('geometry3d', resource.id));
    }
  }

  registerGeometry2D(resource: Geometry2D, name = this._options.getResourceName(resource, `Geometry2D ${resource.id}`)): void {
    if (!this.geometries2D.has(resource.id)) {
      this.geometries2D.set(resource.id, { name, resource, refs: 0 });
      this._recordChange('added', resourceAssetId('geometry2d', resource.id));
    }
  }

  unregisterGeometry(resource: Geometry3D): void {
    const item = this.geometries.get(resource.id);
    if (item && item.refs === 0) {
      this.geometries.delete(resource.id);
      this._recordChange('removed', resourceAssetId('geometry3d', resource.id));
    }
  }

  unregisterGeometry2D(resource: Geometry2D): void {
    const item = this.geometries2D.get(resource.id);
    if (item && item.refs === 0) {
      this.geometries2D.delete(resource.id);
      this._recordChange('removed', resourceAssetId('geometry2d', resource.id));
    }
  }

  registerMaterial(resource: Material, name = this._options.getResourceName(resource, `${resource.constructor.name} ${resource.id}`)): void {
    if (!this.materials.has(resource.id)) {
      this.materials.set(resource.id, { name, resource, refs: 0 });
      this._recordChange('added', resourceAssetId('material3d', resource.id));
    }
  }

  registerMaterial2D(resource: Material2D, name = this._options.getResourceName(resource, `Material2D ${resource.id}`)): void {
    if (!this.materials2D.has(resource.id)) {
      this.materials2D.set(resource.id, { name, resource, refs: 0 });
      this._recordChange('added', resourceAssetId('material2d', resource.id));
    }
  }

  unregisterMaterial(resource: Material): void {
    const item = this.materials.get(resource.id);
    if (item && item.refs === 0) {
      this.materials.delete(resource.id);
      this._recordChange('removed', resourceAssetId('material3d', resource.id));
    }
  }

  registerTexture(resource: TextureSource, options: Partial<Omit<TextureResourceItem, 'id' | 'resource' | 'refs'>> = {}): TextureResourceItem {
    const existing = this.findTextureByResource(resource);
    if (existing) return existing;
    const item: TextureResourceItem = {
      id: ++this._textureId,
      name: options.name ?? `Texture ${this._textureId}`,
      resource,
      refs: 0,
      previewUrl: options.previewUrl,
      assetKey: options.assetKey ?? getTextureAssetKey(this._textureId),
      gpuAssetKey: options.gpuAssetKey,
      status: options.status ?? 'loading',
      assetError: options.assetError,
      width: options.width,
      height: options.height,
      fileType: options.fileType,
      fileSize: options.fileSize,
      ownedObjectUrl: options.ownedObjectUrl,
      compressedInfo: options.compressedInfo,
      previewError: options.previewError,
    };
    this.textures.set(item.id, item);
    this._recordChange('added', resourceAssetId('texture', item.id));
    this._lookupIndex.indexTexture(item);
    void this._syncTextureAsset(item);
    return item;
  }

  unregisterTexture(resourceOrId: TextureSource | number): boolean {
    const item = typeof resourceOrId === 'number'
      ? this.textures.get(resourceOrId) ?? null
      : this.findTextureByResource(resourceOrId);
    if (!item || item.refs > 0) return false;
    if (item.ownedObjectUrl) URL.revokeObjectURL(item.ownedObjectUrl);
    this._deleteTextureAsset(item);
    this.textures.delete(item.id);
    this._lookupIndex.unindexTexture(item);
    this._recordChange('removed', resourceAssetId('texture', item.id));
    return true;
  }

  registerModel(src: string, options: Partial<Omit<ModelResourceItem, 'id' | 'src' | 'refs'>> & { id?: number } = {}): ModelResourceItem {
    const existingById = options.id === undefined ? null : this.models.get(options.id) ?? null;
    if (existingById) {
      this._lookupIndex.unindexModel(existingById, this.models.values());
      existingById.name = options.name ?? existingById.name;
      existingById.src = src;
      existingById.fileName = options.fileName ?? existingById.fileName;
      existingById.fileType = options.fileType ?? existingById.fileType;
      existingById.fileSize = options.fileSize ?? existingById.fileSize;
      existingById.previewUrl = options.previewUrl ?? existingById.previewUrl;
      existingById.assetKey = options.assetKey ?? existingById.assetKey;
      existingById.status = options.status ?? existingById.status;
      existingById.vertexCount = options.vertexCount ?? existingById.vertexCount;
      existingById.triangleCount = options.triangleCount ?? existingById.triangleCount;
      existingById.assetStats = options.assetStats ?? existingById.assetStats;
      existingById.compatibilityReport = options.compatibilityReport ?? existingById.compatibilityReport;
      existingById.previewError = options.previewError ?? existingById.previewError;
      this._lookupIndex.indexModel(existingById);
      this._syncModelAsset(existingById);
      this._recordChange('updated', resourceAssetId('model', existingById.id));
      return existingById;
    }
    const existingBySrc = this.findModelBySrc(src);
    if (existingBySrc && options.id === undefined) return existingBySrc;
    const id = options.id ?? ++this._modelId;
    this._modelId = Math.max(this._modelId, id);
    const item: ModelResourceItem = {
      id,
      name: options.name ?? this.getUniqueModelName(`Model ${id}`),
      src,
      refs: 0,
      fileName: options.fileName,
      fileType: options.fileType,
      fileSize: options.fileSize,
      previewUrl: options.previewUrl,
      assetKey: options.assetKey ?? getModelAssetKey(id),
      status: options.status ?? 'ready',
      vertexCount: options.vertexCount,
      triangleCount: options.triangleCount,
      assetStats: options.assetStats,
      compatibilityReport: options.compatibilityReport,
      previewError: options.previewError,
    };
    this.models.set(item.id, item);
    this._recordChange('added', resourceAssetId('model', item.id));
    this._lookupIndex.indexModel(item);
    this._syncModelAsset(item);
    return item;
  }

  registerPrefab(
    root: SerializedEntity,
    name = this.getUniquePrefabName(root.name || 'Prefab'),
    id?: number,
    options: {
      sourceEntityId?: number | undefined;
      revision?: number | undefined;
      basePrefabId?: number | undefined;
      baseRevision?: number | undefined;
      variantOverrides?: PrefabVariantOverride[] | undefined;
    } = {},
  ): PrefabResourceItem {
    const prefabId = id ?? ++this._prefabId;
    const assetKey = getPrefabAssetKey(prefabId);
    this._prefabId = Math.max(this._prefabId, prefabId);
    const existing = this.prefabs.get(prefabId);
    if (existing) {
      this._untrackPrefabAsset(existing.id);
      existing.name = name;
      existing.root = root;
      existing.assetKey = existing.assetKey ?? assetKey;
      existing.status = 'ready';
      existing.sourceEntityId = options.sourceEntityId ?? existing.sourceEntityId;
      existing.revision = options.revision ?? existing.revision + 1;
      existing.basePrefabId = options.basePrefabId ?? existing.basePrefabId;
      existing.baseRevision = options.baseRevision ?? existing.baseRevision;
      existing.variantOverrides = options.variantOverrides
        ? cloneVariantOverrides(options.variantOverrides)
        : existing.variantOverrides;
      if (existing.basePrefabId !== undefined && options.variantOverrides === undefined) {
        existing.variantOverrides = this.createPrefabVariantOverrides(existing);
      }
      if (existing.basePrefabId !== undefined) existing.root = this.resolvePrefabRoot(existing);
      this._trackPrefabAsset(existing);
      this._syncPrefabAsset(existing);
      this._recordChange('updated', resourceAssetId('prefab', existing.id));
      return existing;
    }
    const item: PrefabResourceItem = {
      id: prefabId,
      name,
      root,
      refs: 0,
      assetKey,
      status: 'ready',
      sourceEntityId: options.sourceEntityId,
      revision: options.revision ?? 1,
      basePrefabId: options.basePrefabId,
      baseRevision: options.baseRevision,
      variantOverrides: options.variantOverrides ? cloneVariantOverrides(options.variantOverrides) : undefined,
    };
    if (item.basePrefabId !== undefined && item.variantOverrides === undefined) item.variantOverrides = this.createPrefabVariantOverrides(item);
    if (item.basePrefabId !== undefined) item.root = this.resolvePrefabRoot(item);
    this.prefabs.set(item.id, item);
    this._recordChange('added', resourceAssetId('prefab', item.id));
    this._trackPrefabAsset(item);
    this._syncPrefabAsset(item);
    return item;
  }

  createPrefabVariant(base: PrefabResourceItem, name = this.getUniquePrefabName(`${base.name} Variant`), id?: number): PrefabResourceItem {
    return this.registerPrefab(this.resolvePrefabRoot(base), name, id, {
      basePrefabId: base.id,
      baseRevision: base.revision,
      revision: 1,
      variantOverrides: [],
    });
  }

  resolvePrefabRoot(item: PrefabResourceItem): SerializedEntity {
    if (item.basePrefabId === undefined) return cloneSerializedEntity(item.root);
    const base = this.prefabs.get(item.basePrefabId);
    if (!base) return cloneSerializedEntity(item.root);
    return applyVariantOverrides(this.resolvePrefabRoot(base), item.variantOverrides ?? []);
  }

  createPrefabVariantOverrides(item: PrefabResourceItem): PrefabVariantOverride[] {
    if (item.basePrefabId === undefined) return [];
    const base = this.prefabs.get(item.basePrefabId);
    if (!base) return [];
    return diffSerializedEntity(this.resolvePrefabRoot(base), item.root);
  }

  rebasePrefabVariant(item: PrefabResourceItem): void {
    if (item.basePrefabId === undefined) return;
    this._untrackPrefabAsset(item.id);
    item.variantOverrides = item.variantOverrides ? cloneVariantOverrides(item.variantOverrides) : this.createPrefabVariantOverrides(item);
    item.root = this.resolvePrefabRoot(item);
    item.baseRevision = this.prefabs.get(item.basePrefabId)?.revision ?? item.baseRevision;
    item.revision++;
    this._trackPrefabAsset(item);
    this._syncPrefabAsset(item);
    this._recordChange('updated', resourceAssetId('prefab', item.id));
  }

  updatePrefabVariantRoot(item: PrefabResourceItem, root: SerializedEntity): void {
    this._untrackPrefabAsset(item.id);
    item.root = cloneSerializedEntity(root);
    if (item.basePrefabId !== undefined) {
      item.variantOverrides = this.createPrefabVariantOverrides(item);
      item.root = this.resolvePrefabRoot(item);
      item.baseRevision = this.prefabs.get(item.basePrefabId)?.revision ?? item.baseRevision;
    }
    item.revision++;
    this._trackPrefabAsset(item);
    this._syncPrefabAsset(item);
    this._recordChange('updated', resourceAssetId('prefab', item.id));
  }

  updatePrefabVariantOverride(item: PrefabResourceItem, index: number, override: PrefabVariantOverride): void {
    if (item.basePrefabId === undefined) return;
    this._untrackPrefabAsset(item.id);
    const overrides = cloneVariantOverrides(item.variantOverrides ?? []);
    overrides[index] = cloneVariantOverride(override);
    item.variantOverrides = overrides.filter(candidate => hasVariantOverridePayload(candidate));
    item.root = this.resolvePrefabRoot(item);
    item.revision++;
    this._trackPrefabAsset(item);
    this._syncPrefabAsset(item);
    this._recordChange('updated', resourceAssetId('prefab', item.id));
  }

  acceptBaseForVariantField(item: PrefabResourceItem, path: readonly number[], field: string): void {
    if (item.basePrefabId === undefined) return;
    this._untrackPrefabAsset(item.id);
    const overrides = cloneVariantOverrides(item.variantOverrides ?? []);
    const override = overrides.find(candidate => pathsEqual(candidate.path, path));
    if (override) clearVariantOverrideField(override, field);
    item.variantOverrides = overrides.filter(candidate => hasVariantOverridePayload(candidate));
    item.root = this.resolvePrefabRoot(item);
    item.baseRevision = this.prefabs.get(item.basePrefabId)?.revision ?? item.baseRevision;
    item.revision++;
    this._trackPrefabAsset(item);
    this._syncPrefabAsset(item);
    this._recordChange('updated', resourceAssetId('prefab', item.id));
  }

  keepOverrideForVariantField(item: PrefabResourceItem, path: readonly number[], field: string): void {
    if (item.basePrefabId === undefined) return;
    const override = item.variantOverrides?.find(candidate => pathsEqual(candidate.path, path));
    if (!override || !getVariantOverrideFields(override).includes(field)) return;
    this._untrackPrefabAsset(item.id);
    item.baseRevision = this.prefabs.get(item.basePrefabId)?.revision ?? item.baseRevision;
    item.revision++;
    this._trackPrefabAsset(item);
    this._syncPrefabAsset(item);
    this._recordChange('updated', resourceAssetId('prefab', item.id));
  }

  getPrefabVariantConflicts(item: PrefabResourceItem): PrefabVariantConflict[] {
    if (item.basePrefabId === undefined || !item.variantOverrides?.length) return [];
    const base = this.prefabs.get(item.basePrefabId);
    const currentBaseRevision = base?.revision;
    if (currentBaseRevision === item.baseRevision) return [];
    return item.variantOverrides.map(override => ({
      path: [...override.path],
      fields: getVariantOverrideFields(override),
      baseRevision: item.baseRevision,
      currentBaseRevision,
    }));
  }

  registerScript(resource: ScriptResource, options: { name?: string; fileName?: string; fileSize?: number } = {}): ScriptResourceItem {
    const existing = this.scripts.get(resource.id);
    if (existing) {
      existing.name = options.name ?? existing.name;
      existing.fileName = options.fileName ?? existing.fileName;
      existing.fileSize = options.fileSize ?? existing.fileSize;
      resource.name = existing.name;
      this._recordChange('updated', resourceAssetId('script', existing.id));
      return existing;
    }
    const item: ScriptResourceItem = {
      id: resource.id,
      name: options.name ?? resource.name,
      resource,
      refs: 0,
      fileName: options.fileName,
      fileSize: options.fileSize,
    };
    resource.name = item.name;
    this.scripts.set(item.id, item);
    this._recordChange('added', resourceAssetId('script', item.id));
    return item;
  }

  unregisterScript(id: number): void {
    const item = this.scripts.get(id);
    if (!item || item.refs > 0) return;
    this.scripts.delete(id);
    this._recordChange('removed', resourceAssetId('script', id));
  }

  unregisterPrefab(id: number): void {
    const item = this.prefabs.get(id);
    if (item && item.refs === 0) {
      this._untrackPrefabAsset(id);
      this.prefabs.delete(id);
      this._assetManager?.deleteAsset(item.assetKey);
      this._recordChange('removed', resourceAssetId('prefab', id));
    }
  }

  unregisterModel(id: number): void {
    const item = this.models.get(id);
    if (item && item.refs === 0) {
      this.models.delete(id);
      this._lookupIndex.unindexModel(item, this.models.values());
      this._assetManager?.deleteAsset(item.assetKey);
      this._recordChange('removed', resourceAssetId('model', id));
    }
  }

  getUniqueModelName(baseName: string): string {
    return getUniqueName(baseName, [...this.models.values()].map(item => item.name));
  }

  getUniquePrefabName(baseName: string): string {
    return getUniqueName(baseName, [...this.prefabs.values()].map(item => item.name));
  }

  findTextureByResource(resource: TextureSource | MaterialTextureSource): TextureResourceItem | null {
    return this._lookupIndex.findTexture(resource);
  }

  findModelBySrc(src: string): ModelResourceItem | null {
    return this._lookupIndex.findModel(src);
  }

  clear(): void {
    this._recordAllResourcesRemoved();
    for (const item of this.textures.values()) {
      if (item.ownedObjectUrl) URL.revokeObjectURL(item.ownedObjectUrl);
      this._deleteTextureAsset(item);
    }
    for (const item of this.models.values()) this._assetManager?.deleteAsset(item.assetKey);
    for (const item of this.prefabs.values()) this._assetManager?.deleteAsset(item.assetKey);
    this.geometries.clear();
    this.geometries2D.clear();
    this.materials.clear();
    this.materials2D.clear();
    this.textures.clear();
    this.models.clear();
    this.prefabs.clear();
    this.scripts.clear();
    this._textureId = 0;
    this._modelId = 0;
    this._prefabId = 0;
    this._lookupIndex.clear();
    this._textureGpuHandles.clear();
    this._textureAssetVersions.clear();
    this._entityUsage.clear();
    this._prefabAssetUsage.clear();
    this._changedEntitiesScratch.clear();
    this._liveEntityIdsScratch.clear();
    this._worldCursorGeneration++;
  }

  /** Incrementally consumes the World component journal; a full walk is only used for first sync or overflow recovery. */
  syncWorld(world: World): void {
    const cursor = this._worldCursors.get(world);
    if (!cursor || cursor.generation !== this._worldCursorGeneration) {
      this._fullResyncWorld(world);
      this._worldCursors.set(world, { revision: world.componentChangeRevision, generation: this._worldCursorGeneration });
      return;
    }

    const changes = this._worldChangeScratch;
    if (!world.readComponentChangesSince(cursor.revision, changes)) {
      this._fullResyncWorld(world);
      cursor.revision = world.componentChangeRevision;
      return;
    }
    if (changes.length === 0) return;
    const changedEntities = this._changedEntitiesScratch;
    changedEntities.clear();
    for (const change of changes) changedEntities.set(change.entity.id, change.entity);
    for (const [entityId, entity] of changedEntities) {
      if (world.entities.get(entityId) === entity) this.trackEntity(entity);
      else this._untrackEntityId(entityId);
    }
    changedEntities.clear();
    cursor.revision = world.componentChangeRevision;
  }

  private _fullResyncWorld(world: World): void {
    const liveEntityIds = this._liveEntityIdsScratch;
    liveEntityIds.clear();
    for (const entity of world.entities.values()) {
      liveEntityIds.add(entity.id);
      this.trackEntity(entity);
    }
    for (const [entityId, usage] of this._entityUsage) {
      if (liveEntityIds.has(entityId)) continue;
      this._applyUsageDelta(usage, -1);
      this._entityUsage.delete(entityId);
    }
    liveEntityIds.clear();
  }

  trackEntity(entity: Entity): void {
    const previous = this._entityUsage.get(entity.id) ?? null;
    const next = this._collectEntityUsage(entity);
    if (next === EMPTY_ENTITY_RESOURCE_USAGE) {
      if (previous) {
        this._applyUsageDelta(previous, -1);
        this._entityUsage.delete(entity.id);
      }
      return;
    }
    if (previous) this._applyUsageDifference(previous, next);
    else this._applyUsageDelta(next, 1);
    this._entityUsage.set(entity.id, next);
  }

  untrackEntity(entity: Entity): void {
    this._untrackEntityId(entity.id);
  }

  private _untrackEntityId(entityId: number): void {
    const previous = this._entityUsage.get(entityId);
    if (!previous) return;
    this._applyUsageDelta(previous, -1);
    this._entityUsage.delete(entityId);
  }

  private _collectEntityUsage(entity: Entity): EntityResourceUsage {
    const mesh = entity.getComponent(Mesh3D);
    const mesh2D = entity.getComponent(Mesh2D);
    const prefabId = this._options.getPrefabId(entity);
    const script = entity.getComponent(ScriptComponent);
    let hasExtensionUsage = false;
    for (const component of entity.components.values()) {
      for (const extension of this._componentResourceExtensions) {
        if (extension.supportsComponentResourceUsage?.(component) === false) continue;
        hasExtensionUsage = true;
        break;
      }
      if (hasExtensionUsage) break;
    }
    if (!mesh && !mesh2D && prefabId == null && !script?.resource && !hasExtensionUsage) {
      return EMPTY_ENTITY_RESOURCE_USAGE;
    }

    const usage = createEmptyEntityResourceUsage();
    if (mesh) {
      if (this.geometries.has(mesh.geometry.id)) usage.geometries.add(mesh.geometry.id);
      if (this.materials.has(mesh.material.id)) usage.materials.add(mesh.material.id);
      if (mesh.material instanceof BasicMaterial && !(mesh.material instanceof CssMaterial) && mesh.material.texture) {
        const texture = this.findTextureByResource(mesh.material.texture);
        if (texture) usage.textures.add(texture.id);
      }
    }

    if (mesh2D) {
      if (this.geometries2D.has(mesh2D.geometry.id)) usage.geometries2D.add(mesh2D.geometry.id);
      if (this.materials2D.has(mesh2D.material.id)) usage.materials2D.add(mesh2D.material.id);
    }

    if (prefabId != null && this.prefabs.has(prefabId)) usage.prefabs.add(prefabId);

    if (script?.resource && this.scripts.has(script.resource.id)) usage.scripts.add(script.resource.id);

    const context = this._createUsageContext(usage);
    for (const component of entity.components.values()) {
      for (const extension of this._componentResourceExtensions) {
        if (extension.supportsComponentResourceUsage?.(component) === false) continue;
        extension.collectComponentResourceUsage?.(component, context);
      }
    }

    return usage;
  }

  private _applyUsageDelta(usage: EntityResourceUsage, delta: 1 | -1): void {
    for (const id of usage.geometries) this._addRef(this.geometries, 'geometry3d', id, delta);
    for (const id of usage.geometries2D) this._addRef(this.geometries2D, 'geometry2d', id, delta);
    for (const id of usage.materials) this._addRef(this.materials, 'material3d', id, delta);
    for (const id of usage.materials2D) this._addRef(this.materials2D, 'material2d', id, delta);
    for (const id of usage.textures) this._addRef(this.textures, 'texture', id, delta);
    for (const id of usage.models) this._addRef(this.models, 'model', id, delta);
    for (const id of usage.prefabs) this._addRef(this.prefabs, 'prefab', id, delta);
    for (const id of usage.scripts) this._addRef(this.scripts, 'script', id, delta);
  }

  private _applyUsageDifference(previous: EntityResourceUsage, next: EntityResourceUsage): void {
    this._applySetDifference(this.geometries, 'geometry3d', previous.geometries, next.geometries);
    this._applySetDifference(this.geometries2D, 'geometry2d', previous.geometries2D, next.geometries2D);
    this._applySetDifference(this.materials, 'material3d', previous.materials, next.materials);
    this._applySetDifference(this.materials2D, 'material2d', previous.materials2D, next.materials2D);
    this._applySetDifference(this.textures, 'texture', previous.textures, next.textures);
    this._applySetDifference(this.models, 'model', previous.models, next.models);
    this._applySetDifference(this.prefabs, 'prefab', previous.prefabs, next.prefabs);
    this._applySetDifference(this.scripts, 'script', previous.scripts, next.scripts);
  }

  private _applySetDifference<T extends { refs: number }>(
    map: Map<number, T>,
    kind: ResourceKind,
    previous: Set<number>,
    next: Set<number>,
  ): void {
    for (const id of previous) if (!next.has(id)) this._addRef(map, kind, id, -1);
    for (const id of next) if (!previous.has(id)) this._addRef(map, kind, id, 1);
  }

  private _trackPrefabAsset(item: PrefabResourceItem): void {
    const usage = this._collectSerializedEntityUsage(item.root, item.id);
    if (item.basePrefabId !== undefined && item.basePrefabId !== item.id && this.prefabs.has(item.basePrefabId)) {
      usage.prefabs.add(item.basePrefabId);
    }
    this._prefabAssetUsage.set(item.id, usage);
    this._applyUsageDelta(usage, 1);
  }

  private _untrackPrefabAsset(prefabId: number): void {
    const usage = this._prefabAssetUsage.get(prefabId);
    if (!usage) return;
    this._applyUsageDelta(usage, -1);
    this._prefabAssetUsage.delete(prefabId);
  }

  private _collectSerializedEntityUsage(entity: SerializedEntity, owningPrefabId: number): EntityResourceUsage {
    const usage = createEmptyEntityResourceUsage();
    const visit = (node: SerializedEntity): void => {
      for (const component of node.components) {
        if (component.type === 'Mesh3D') {
          if (this.geometries.has(component.geometryId)) usage.geometries.add(component.geometryId);
          if (this.materials.has(component.materialId)) usage.materials.add(component.materialId);
        } else if (component.type === 'PrefabInstance') {
          if (component.prefabId !== owningPrefabId && this.prefabs.has(component.prefabId)) usage.prefabs.add(component.prefabId);
        } else if (component.type === 'ScriptComponent' && component.scriptId != null) {
          if (this.scripts.has(component.scriptId)) usage.scripts.add(component.scriptId);
        } else {
          const context = this._createUsageContext(usage);
          for (const extension of this._componentResourceExtensions) {
            extension.collectSerializedComponentResourceUsage?.(component, context);
          }
        }
      }
      for (const child of node.children) visit(child);
    };
    visit(entity);
    return usage;
  }

  private _createUsageContext(usage: EntityResourceUsage) {
    return {
      addModelBySrc: (src: string | null | undefined): void => {
        if (!src) return;
        const model = this.findModelBySrc(src);
        if (model) usage.models.add(model.id);
      },
      resolveModelBySrc: (src: string | null | undefined): AssetId | null => {
        if (!src) return null;
        const model = this.findModelBySrc(src);
        return model ? resourceAssetId('model', model.id) : null;
      },
      addAssetId: (assetId: AssetId): void => addAssetIdToUsage(usage, assetId),
    };
  }

  private _addRef<T extends { refs: number }>(map: Map<number, T>, kind: ResourceKind, id: number, delta: 1 | -1): void {
    const item = map.get(id);
    if (!item) return;
    const next = Math.max(0, item.refs + delta);
    if (next === item.refs) return;
    item.refs = next;
    this._recordChange('referencesChanged', resourceAssetId(kind, id));
  }

  private async _syncTextureAsset(item: TextureResourceItem): Promise<void> {
    const assetManager = this._assetManager;
    const version = (this._textureAssetVersions.get(item.id) ?? 0) + 1;
    this._textureAssetVersions.set(item.id, version);
    if (!assetManager) {
      item.status = 'ready';
      this._recordChange('updated', resourceAssetId('texture', item.id));
      return;
    }
    assetManager.setAsset(item.assetKey, {
      id: item.id,
      name: item.name,
      width: item.width,
      height: item.height,
      fileType: item.fileType,
      fileSize: item.fileSize,
      previewUrl: item.previewUrl,
    });
    this._releaseTextureGpuHandle(item);
    if (isGpuTextureSource(item.resource)) {
      item.gpuAssetKey = item.assetKey;
      item.status = 'ready';
      item.assetError = undefined;
      this._recordChange('updated', resourceAssetId('texture', item.id));
      return;
    }
    item.status = 'loading';
    item.assetError = undefined;
    try {
      const handle = await assetManager.loadTexture(item.resource);
      if (
        this._assetManager !== assetManager
        || this.textures.get(item.id) !== item
        || this._textureAssetVersions.get(item.id) !== version
      ) {
        handle.release();
        return;
      }
      this._textureGpuHandles.set(item.id, handle);
      item.gpuAssetKey = handle.key;
      item.status = assetManager.getJobState(handle.key) ?? 'ready';
      this._recordChange('updated', resourceAssetId('texture', item.id));
    } catch (error) {
      item.status = 'failed';
      item.assetError = error instanceof Error ? error.message : String(error);
      this._recordChange('updated', resourceAssetId('texture', item.id));
    }
  }

  private _releaseTextureGpuHandle(item: TextureResourceItem): void {
    const handle = this._textureGpuHandles.get(item.id);
    if (handle) {
      handle.release();
      this._textureGpuHandles.delete(item.id);
    }
    item.gpuAssetKey = undefined;
  }

  private _deleteTextureAsset(item: TextureResourceItem): void {
    this._textureAssetVersions.set(item.id, (this._textureAssetVersions.get(item.id) ?? 0) + 1);
    this._releaseTextureGpuHandle(item);
    this._assetManager?.deleteAsset(item.assetKey);
    if (item.status !== 'failed') item.status = 'released';
  }

  private _syncModelAsset(item: ModelResourceItem): void {
    item.status = item.previewError ? 'failed' : item.status === 'released' ? 'ready' : item.status;
    this._assetManager?.setAsset(item.assetKey, {
      id: item.id,
      name: item.name,
      src: item.src,
      fileName: item.fileName,
      fileType: item.fileType,
      fileSize: item.fileSize,
      previewUrl: item.previewUrl,
      vertexCount: item.vertexCount,
      triangleCount: item.triangleCount,
      assetStats: item.assetStats,
      compatibilityReport: item.compatibilityReport,
      previewError: item.previewError,
    });
  }

  private _syncPrefabAsset(item: PrefabResourceItem): void {
    item.status = 'ready';
    this._assetManager?.setAsset(item.assetKey, {
      id: item.id,
      name: item.name,
      root: this.resolvePrefabRoot(item),
      revision: item.revision,
      basePrefabId: item.basePrefabId,
      baseRevision: item.baseRevision,
      variantOverrides: item.variantOverrides ? cloneVariantOverrides(item.variantOverrides) : undefined,
    });
  }

  private _recordAllResourcesRemoved(): void {
    for (const id of this.geometries.keys()) this._recordChange('removed', resourceAssetId('geometry3d', id));
    for (const id of this.geometries2D.keys()) this._recordChange('removed', resourceAssetId('geometry2d', id));
    for (const id of this.materials.keys()) this._recordChange('removed', resourceAssetId('material3d', id));
    for (const id of this.materials2D.keys()) this._recordChange('removed', resourceAssetId('material2d', id));
    for (const id of this.textures.keys()) this._recordChange('removed', resourceAssetId('texture', id));
    for (const id of this.models.keys()) this._recordChange('removed', resourceAssetId('model', id));
    for (const id of this.prefabs.keys()) this._recordChange('removed', resourceAssetId('prefab', id));
    for (const id of this.scripts.keys()) this._recordChange('removed', resourceAssetId('script', id));
  }

  private _recordChange(
    type: ResourceChangeKind,
    assetId: ResourceAssetId,
  ): void {
    this._changes.record(type, assetId);
  }

}

function getTextureAssetKey(id: number): string {
  return `editor:texture:${id}`;
}

function getModelAssetKey(id: number): string {
  return `editor:model:${id}`;
}

function isGpuTextureSource(resource: TextureSource): resource is GPUTexture {
  return typeof resource === 'object'
    && resource !== null
    && 'createView' in resource
    && 'destroy' in resource;
}
