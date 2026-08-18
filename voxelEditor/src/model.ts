import { cloneModuleInstance, normalizeModuleScale, normalizeQuarterTurn, transformModuleVoxels } from './moduleTransform';
import {
  animationPlaybackRange,
  cloneAnimationClip,
  evaluateAnimationInstance,
  normalizeAnimationFps,
  normalizeAnimationFrame,
  normalizeAnimationFrameCount,
  normalizedAnimationKeyframe,
} from './animation';
import { composeSceneVoxels } from './sceneComposition';
import { serializeVoxelProject } from './projectSerialization';
import {
  animationKeyframeAt,
  removeAnimationKeyframeState,
  updatedAnimationClip,
  upsertAnimationKeyframe,
} from './animationState';
import { AnimationTimelineState } from './animation/AnimationTimelineState';
import { VoxelAggregateState } from './document/VoxelAggregateState';
import { dirtyFlagsForReason } from './document/VoxelDocumentDirtyPolicy';
import {
  VoxelTransactionCoordinator,
  type VoxelDocumentTransaction,
} from './document/VoxelTransaction';
import type { VoxelSceneProjectionSource } from './document/VoxelSceneProjectionSource';
import { normalizedVoxelLayerId, numericIdSuffix, replaceMap } from './document/VoxelDocumentUtilities';
import {
  cloneVoxMaterialExtension,
  isVoxelRecord as isRecord,
  normalizeVoxelAxis as normalizeAxis,
  normalizeVoxelUnit as normalizeUnit,
  parseVoxMaterialExtension,
  StringKeyVoxelMapView,
} from './document/VoxelDocumentNormalization';
import { ModuleHierarchyState } from './modules/ModuleHierarchyState';
import { PaletteMaterialState } from './palette/PaletteMaterialState';
import { migrateVoxelProject } from './persistence/VoxelProjectMigration';
import {
  DEFAULT_LAYER_ID,
  DEFAULT_PALETTE,
  DEFAULT_PBR_METALLIC,
  DEFAULT_PBR_ROUGHNESS,
  DEFAULT_SCENE_BACKGROUND_COLOR,
  DEFAULT_SCENE_SIZE,
  MAX_VOXELS,
  normalizeColor,
  packVoxelKey,
  unpackVoxelKey,
  voxelKey,
  type AnimationKeyframeSnapshot,
  type AnimationSummary,
  type BatchVoxelResult,
  type ModuleSummary,
  type PackedVoxelKey,
  type PbrPaletteMaterial,
  type RenderableVoxel,
  type SceneSize,
  type Voxel,
  type VoxelAnimationClip,
  type VoxelAnimationKeyframe,
  type VoxelDocumentChangeDetail,
  type VoxelDocumentChangeImpact,
  type VoxelDocumentChangeReason,
  type VoxelLayer,
  type VoxelModuleData,
  type VoxelModuleInstance,
  type VoxelPatchEntry,
  type VoxelPosition,
  type VoxelProject,
} from './document/VoxelDocumentContract';

export * from './document/VoxelDocumentContract';

export class VoxelDocument extends EventTarget {
  private readonly _aggregate = new VoxelAggregateState();
  private readonly _hierarchy = new ModuleHierarchyState();
  private readonly _paletteState = new PaletteMaterialState();
  private readonly _timeline = new AnimationTimelineState();
  private get _voxels(): Map<PackedVoxelKey, Voxel> { return this._aggregate.voxels; }
  private get _size(): SceneSize { return this._aggregate.size; }
  private set _size(value: SceneSize) { this._aggregate.size = value; }
  private get _backgroundColor(): string { return this._aggregate.backgroundColor; }
  private set _backgroundColor(value: string) { this._aggregate.backgroundColor = value; }
  private get _modules() { return this._hierarchy.modules; }
  private get _moduleInstances(): Map<string, VoxelModuleInstance> { return this._hierarchy.instances; }
  private get _layers(): Map<string, VoxelLayer> { return this._hierarchy.layers; }
  private get _editingModuleId(): string | null { return this._hierarchy.editingModuleId; }
  private set _editingModuleId(value: string | null) { this._hierarchy.editingModuleId = value; }
  private get _activeVoxelLayerId(): string { return this._hierarchy.activeVoxelLayerId; }
  private set _activeVoxelLayerId(value: string) { this._hierarchy.activeVoxelLayerId = value; }
  private get _nextModuleId(): number { return this._hierarchy.nextModuleId; }
  private set _nextModuleId(value: number) { this._hierarchy.nextModuleId = value; }
  private get _nextModuleRevision(): number { return this._hierarchy.nextModuleRevision; }
  private set _nextModuleRevision(value: number) { this._hierarchy.nextModuleRevision = value; }
  private get _nextModuleInstanceId(): number { return this._hierarchy.nextModuleInstanceId; }
  private set _nextModuleInstanceId(value: number) { this._hierarchy.nextModuleInstanceId = value; }
  private get _nextLayerId(): number { return this._hierarchy.nextLayerId; }
  private set _nextLayerId(value: number) { this._hierarchy.nextLayerId = value; }
  private get _palette(): Map<string, PbrPaletteMaterial> { return this._paletteState.materials; }
  private get _currentColor(): string { return this._paletteState.currentColor; }
  private set _currentColor(value: string) { this._paletteState.currentColor = value; }
  private get _currentMaterialId(): string { return this._paletteState.currentMaterialId; }
  private set _currentMaterialId(value: string) { this._paletteState.currentMaterialId = value; }
  private get _nextMaterialId(): number { return this._paletteState.nextMaterialId; }
  private set _nextMaterialId(value: number) { this._paletteState.nextMaterialId = value; }
  private get _animations(): Map<string, VoxelAnimationClip> { return this._timeline.clips; }
  private get _activeAnimationId(): string | null { return this._timeline.activeAnimationId; }
  private set _activeAnimationId(value: string | null) { this._timeline.activeAnimationId = value; }
  private get _animationFrame(): number { return this._timeline.frame; }
  private set _animationFrame(value: number) { this._timeline.frame = value; }
  private get _nextAnimationId(): number { return this._timeline.nextAnimationId; }
  private set _nextAnimationId(value: number) { this._timeline.nextAnimationId = value; }
  private _viewDirty = true;
  private _sceneDirty = true;
  private readonly _viewVoxels = new Map<PackedVoxelKey, RenderableVoxel>();
  private readonly _sceneVoxels = new Map<PackedVoxelKey, RenderableVoxel>();
  private readonly _viewVoxelsView = new StringKeyVoxelMapView(this._viewVoxels);
  private readonly _sceneVoxelsView = new StringKeyVoxelMapView(this._sceneVoxels);
  private readonly _moduleInstanceCollisions = new Map<string, Set<string>>();
  private readonly _materialUsageCounts = new Map<string, number>();
  private _materialUsageDirty = true;
  private readonly _transactions = new VoxelTransactionCoordinator();
  private readonly _dispatchDocumentChange = (detail: Readonly<VoxelDocumentChangeDetail>): void => {
    this.dispatchEvent(new CustomEvent<VoxelDocumentChangeDetail>('change', { detail }));
  };

  constructor(size: SceneSize = DEFAULT_SCENE_SIZE) {
    super();
    this._size = {
      x: normalizeAxis(size.x),
      y: normalizeAxis(size.y),
      z: normalizeAxis(size.z),
    };
    this._layers.set(DEFAULT_LAYER_ID, { id: DEFAULT_LAYER_ID, name: '默认图层', visible: true, locked: false });
    for (const material of DEFAULT_PALETTE) this._palette.set(material.id, { ...material });
  }

  get size(): Readonly<SceneSize> { return this._size; }
  get voxels(): ReadonlyMap<PackedVoxelKey, Voxel> { return this._voxels; }
  get voxelCount(): number { return this._voxels.size; }
  get activeVoxelLayerId(): string { return this._activeVoxelLayerId; }
  get editingModuleId(): string | null { return this._editingModuleId; }
  get isEditingModule(): boolean { return this._editingModuleId !== null; }
  get viewSize(): Readonly<SceneSize> { return this._getEditingModule()?.size ?? this._size; }
  get viewVoxels(): ReadonlyMap<string, RenderableVoxel> { this._ensureViewVoxels(); return this._viewVoxelsView; }
  get sceneVoxels(): ReadonlyMap<string, RenderableVoxel> { this._ensureSceneVoxels(); return this._sceneVoxelsView; }
  get sceneVoxelCount(): number { return this.sceneVoxels.size; }
  get sceneBackgroundColor(): string { return this._backgroundColor; }

  /**
   * Opens a document-domain transaction. Mutations are visible immediately,
   * while their change notification is coalesced until commit. Cancellation
   * only discards the notification; callers that preview mutations must restore
   * their state before cancelling.
   */
  beginTransaction(): VoxelDocumentTransaction {
    return this._transactions.begin(this._dispatchDocumentChange);
  }

  transact<T>(operation: () => T): T {
    return this._transactions.transact(operation, this._dispatchDocumentChange);
  }
  getSceneVoxelsAtFrame(frame: number): readonly RenderableVoxel[] {
    const clip = this._activeAnimationId ? this._animations.get(this._activeAnimationId) ?? null : null;
    return Array.from(this._composeSceneVoxels(clip, frame).values(), voxel => ({ ...voxel }));
  }
  get moduleInstances(): readonly VoxelModuleInstance[] { return Array.from(this._moduleInstances.values(), cloneModuleInstance); }
  getModuleInstanceIdsInLayer(layerId: string): readonly string[] {
    return Array.from(this._moduleInstances.values())
      .filter(instance => instance.layerId === layerId)
      .map(instance => instance.id);
  }
  getBaseVoxelCountInLayer(layerId: string): number {
    let count = 0;
    for (const voxel of this._voxels.values()) if (this.voxelLayerId(voxel) === layerId) count += 1;
    return count;
  }
  getBaseVoxelsInLayer(layerId: string): readonly Voxel[] {
    return Array.from(this._voxels.values())
      .filter(voxel => this.voxelLayerId(voxel) === layerId)
      .map(voxel => ({ ...voxel }));
  }
  get evaluatedModuleInstances(): readonly VoxelModuleInstance[] {
    const clip = this._activeAnimationId ? this._animations.get(this._activeAnimationId) ?? null : null;
    return Array.from(this._moduleInstances.values(), instance => evaluateAnimationInstance(instance, clip, this._animationFrame));
  }
  get animations(): readonly VoxelAnimationClip[] { return Array.from(this._animations.values(), cloneAnimationClip); }
  get animationSummaries(): readonly AnimationSummary[] {
    return Array.from(this._animations.values(), clip => ({
      id: clip.id, name: clip.name, fps: clip.fps, frameCount: clip.frameCount,
      loop: clip.loop, trackCount: clip.tracks.length,
    }));
  }
  get activeAnimationId(): string | null { return this._activeAnimationId; }
  get animationFrame(): number { return this._animationFrame; }
  get activeAnimation(): VoxelAnimationClip | null {
    const clip = this._activeAnimationId ? this._animations.get(this._activeAnimationId) : null;
    return clip ? cloneAnimationClip(clip) : null;
  }
  /** Read-only hot-path view. Callers must never mutate the returned clip. */
  get activeAnimationView(): VoxelAnimationClip | null {
    return this._activeAnimationId ? this._animations.get(this._activeAnimationId) ?? null : null;
  }
  getAnimation(animationId: string): VoxelAnimationClip | null {
    const clip = this._animations.get(animationId);
    return clip ? cloneAnimationClip(clip) : null;
  }
  sceneVoxelsAtFrame(frame: number): ReadonlyMap<string, RenderableVoxel> {
    const clip = this._activeAnimationId ? this._animations.get(this._activeAnimationId) ?? null : null;
    return new StringKeyVoxelMapView(
      this._composeSceneVoxels(clip, clip ? normalizeAnimationFrame(frame, clip.frameCount) : 0),
    );
  }
  getAnimationKeyframesForInstance(instanceId: string): readonly {
    animationId: string;
    keyframe: VoxelAnimationKeyframe;
  }[] {
    const result: { animationId: string; keyframe: VoxelAnimationKeyframe }[] = [];
    for (const clip of this._animations.values()) {
      const track = clip.tracks.find(candidate => candidate.instanceId === instanceId);
      if (!track) continue;
      for (const keyframe of track.keyframes) result.push({
        animationId: clip.id,
        keyframe: {
          ...keyframe,
          position: { ...keyframe.position },
          rotation: { ...keyframe.rotation },
          scale: { ...keyframe.scale },
        },
      });
    }
    return result;
  }
  getAllAnimationKeyframes(): readonly {
    animationId: string;
    instanceId: string;
    keyframe: VoxelAnimationKeyframe;
  }[] {
    const result: { animationId: string; instanceId: string; keyframe: VoxelAnimationKeyframe }[] = [];
    for (const clip of this._animations.values()) {
      for (const track of clip.tracks) {
        for (const keyframe of track.keyframes) result.push({
          animationId: clip.id,
          instanceId: track.instanceId,
          keyframe: {
            ...keyframe,
            position: { ...keyframe.position },
            rotation: { ...keyframe.rotation },
            scale: { ...keyframe.scale },
          },
        });
      }
    }
    return result;
  }
  get layers(): readonly VoxelLayer[] { return Array.from(this._layers.values(), layer => ({ ...layer })); }
  get paletteMaterials(): readonly PbrPaletteMaterial[] { return Array.from(this._palette.values(), material => ({ ...material })); }
  get modules(): readonly VoxelModuleData[] {
    return Array.from(this._modules.values(), module => ({
      id: module.id,
      name: module.name,
      size: { ...module.size },
      voxels: Array.from(module.voxels.values(), voxel => ({ ...voxel })),
    }));
  }
  get moduleSummaries(): readonly ModuleSummary[] {
    const instanceCounts = new Map<string, number>();
    for (const instance of this._moduleInstances.values()) {
      instanceCounts.set(instance.moduleId, (instanceCounts.get(instance.moduleId) ?? 0) + 1);
    }
    return Array.from(this._modules.values(), module => ({
      id: module.id,
      name: module.name,
      size: { ...module.size },
      voxelCount: module.voxels.size,
      instanceCount: instanceCounts.get(module.id) ?? 0,
      revision: module.revision,
    }));
  }

  getModuleVoxelsView(moduleId: string): Iterable<Readonly<Voxel>> {
    return this._modules.get(moduleId)?.voxels.values() ?? [];
  }
  getMaterialUsageCount(materialId: string): number {
    this._ensureMaterialUsageCounts();
    return this._materialUsageCounts.get(materialId) ?? 0;
  }
  get currentColor(): string { return this._currentColor; }
  get currentMaterialId(): string { return this._currentMaterialId; }

  setActiveVoxelLayer(layerId: string): boolean {
    if (!this._layers.has(layerId)) return false;
    if (this._activeVoxelLayerId === layerId) return true;
    this._activeVoxelLayerId = layerId;
    return true;
  }

  voxelLayerId(voxel: Readonly<Pick<Voxel, 'layerId'>>): string {
    return voxel.layerId && this._layers.has(voxel.layerId) ? voxel.layerId : DEFAULT_LAYER_ID;
  }

  isBaseVoxelEditable(voxel: Readonly<Pick<Voxel, 'layerId'>> | null = null): boolean {
    const layer = this._layers.get(voxel ? this.voxelLayerId(voxel) : this._activeVoxelLayerId);
    return Boolean(layer && layer.visible && !layer.locked);
  }

  set currentColor(value: string) {
    const color = normalizeColor(value);
    const current = this._palette.get(this._currentMaterialId);
    if (current?.color === color) return;
    const material = this._findPaletteMaterialByColor(color) ?? this._createPaletteMaterialInternal(color);
    this._currentMaterialId = material.id;
    this._currentColor = material.color;
    this._notify('color');
  }

  setSceneBackgroundColor(value: string): boolean {
    const color = normalizeColor(value);
    if (color === this._backgroundColor) return false;
    this._backgroundColor = color;
    this._notify('scene-background');
    return true;
  }

  selectPaletteMaterial(materialId: string): boolean {
    const material = this._palette.get(materialId);
    if (!material) return false;
    if (material.id === this._currentMaterialId) return false;
    this._currentMaterialId = material.id;
    this._currentColor = material.color;
    this._notify('color');
    return true;
  }

  getPaletteMaterial(materialIdOrColor: string): PbrPaletteMaterial {
    const direct = this._palette.get(materialIdOrColor);
    if (direct) return { ...direct };
    const normalized = normalizeColor(materialIdOrColor);
    const material = this._findPaletteMaterialByColor(normalized);
    return material ? { ...material } : {
      id: '',
      color: normalized,
      name: normalized.toUpperCase(),
      metallic: DEFAULT_PBR_METALLIC,
      roughness: DEFAULT_PBR_ROUGHNESS,
    };
  }

  resolveVoxelMaterial(voxel: Pick<Voxel, 'color' | 'materialId'>): PbrPaletteMaterial {
    const byId = voxel.materialId ? this._palette.get(voxel.materialId) : null;
    return byId ? { ...byId } : this.getPaletteMaterial(voxel.color);
  }

  /** Read-only renderer hot-path view. Callers must never mutate the returned material. */
  resolveVoxelMaterialView(voxel: Pick<Voxel, 'color' | 'materialId'>): Readonly<PbrPaletteMaterial> {
    return (voxel.materialId ? this._palette.get(voxel.materialId) : null)
      ?? this._findPaletteMaterialByColor(voxel.color)
      ?? { id: '', color: voxel.color, name: voxel.color.toUpperCase(), metallic: DEFAULT_PBR_METALLIC, roughness: DEFAULT_PBR_ROUGHNESS };
  }

  createPaletteMaterial(color: string, name = ''): PbrPaletteMaterial {
    const normalized = normalizeColor(color);
    const material = this._createPaletteMaterialInternal(normalized, name);
    this._notify('palette-create');
    return { ...material };
  }

  updatePaletteMaterial(
    materialId: string,
    patch: Partial<Pick<PbrPaletteMaterial, 'name' | 'metallic' | 'roughness'>>,
  ): boolean {
    const material = this._palette.get(materialId);
    if (!material) throw new Error('调色板材质不存在。');
    const next = {
      ...material,
      name: patch.name === undefined ? material.name : patch.name.trim() || material.name,
      metallic: patch.metallic === undefined
        ? material.metallic
        : normalizeUnit(patch.metallic, material.metallic),
      roughness: patch.roughness === undefined
        ? material.roughness
        : normalizeUnit(patch.roughness, material.roughness, 0.04),
    };
    if (next.name === material.name && next.metallic === material.metallic && next.roughness === material.roughness) return false;
    this._palette.set(materialId, next);
    this._notify('palette-update', { materialIds: [materialId] });
    return true;
  }

  removePaletteMaterial(materialId: string): boolean {
    const material = this._palette.get(materialId);
    if (!material) return false;
    if (this.getMaterialUsageCount(materialId) > 0) throw new Error('该材质仍被体素使用，无法删除。');
    if (this._palette.size <= 1) throw new Error('调色板至少需要保留一个材质。');
    this._palette.delete(materialId);
    if (this._currentMaterialId === materialId) {
      const next = this._palette.values().next().value as PbrPaletteMaterial | undefined;
      this._currentMaterialId = next?.id ?? 'material-5';
      this._currentColor = next?.color ?? '#69d2e7';
    }
    this._notify('palette-remove');
    return true;
  }

  restorePaletteMaterial(material: Readonly<PbrPaletteMaterial>): void {
    const color = normalizeColor(material.color);
    const restored: PbrPaletteMaterial = {
      id: String(material.id),
      color,
      name: String(material.name).trim() || color.toUpperCase(),
      metallic: normalizeUnit(material.metallic, DEFAULT_PBR_METALLIC),
      roughness: normalizeUnit(material.roughness, DEFAULT_PBR_ROUGHNESS, 0.04),
      ...(material.vox ? { vox: cloneVoxMaterialExtension(material.vox) } : {}),
    };
    const existed = this._palette.has(restored.id);
    this._palette.set(restored.id, restored);
    this._nextMaterialId = Math.max(this._nextMaterialId, numericIdSuffix(restored.id, 'material-') + 1);
    if (this._currentMaterialId === restored.id) this._currentColor = restored.color;
    this._notify(existed ? 'palette-update' : 'palette-create');
  }

  contains(x: number, y: number, z: number): boolean {
    const size = this.viewSize;
    return x >= 0 && x < size.x
      && y >= 0 && y < size.y
      && z >= 0 && z < size.z;
  }

  get(x: number, y: number, z: number): Voxel | undefined {
    return this._getEditableVoxels().get(packVoxelKey(x, y, z));
  }

  getViewVoxel(x: number, y: number, z: number): RenderableVoxel | undefined {
    this._ensureViewVoxels();
    return this._viewVoxels.get(packVoxelKey(x, y, z));
  }

  /**
   * Reads a small dirty projection without materializing the complete view.
   * The renderer uses this for voxel/material edits after it already owns a
   * complete projection. Structural hierarchy invalidations still use
   * `viewVoxels` and rebuild deterministically.
   */
  getViewVoxelsForPackedKeys(keys: Iterable<PackedVoxelKey>): ReadonlyMap<PackedVoxelKey, RenderableVoxel> {
    const result = new Map<PackedVoxelKey, RenderableVoxel>();
    if (!this._viewDirty) {
      for (const key of keys) {
        const voxel = this._viewVoxels.get(key);
        if (voxel) result.set(key, voxel);
      }
      return result;
    }
    const editingModule = this._getEditingModule();
    if (editingModule) {
      for (const key of keys) {
        const voxel = editingModule.voxels.get(key);
        if (voxel) result.set(key, { ...voxel, source: 'module-definition', moduleId: editingModule.id });
      }
      return result;
    }
    for (const key of keys) {
      // A base-voxel or material edit cannot displace an already projected
      // module instance. Reuse that stable higher-priority projection.
      const projected = this._viewVoxels.get(key);
      if (projected?.source === 'module-instance') {
        result.set(key, projected);
        continue;
      }
      const voxel = this._voxels.get(key);
      if (voxel && this._layers.get(this.voxelLayerId(voxel))?.visible !== false) {
        result.set(key, { ...voxel, source: 'base' });
      }
    }
    return result;
  }

  getSceneProjectionSource(): VoxelSceneProjectionSource {
    const animation = this._activeAnimationId ? this._animations.get(this._activeAnimationId) ?? null : null;
    return {
      size: this._size,
      baseVoxels: this._voxels,
      modules: this._modules,
      instances: this._moduleInstances,
      layers: this._layers,
      animation,
      frame: this._animationFrame,
    };
  }

  getTargetVoxel(moduleId: string | null, x: number, y: number, z: number): Voxel | undefined {
    const voxel = this._getTargetVoxels(moduleId).get(packVoxelKey(x, y, z));
    return voxel ? { ...voxel } : undefined;
  }

  applyVoxelPatch(moduleId: string | null, entries: readonly VoxelPatchEntry[]): boolean {
    if (entries.length === 0) return false;
    const target = this._getTargetVoxels(moduleId);
    const size = moduleId ? this._modules.get(moduleId)?.size : this._size;
    if (!size) throw new Error('命令引用的模块不存在。');
    const staged = new Map<PackedVoxelKey, Voxel | null>();
    for (const entry of entries) {
      const x = Math.round(entry.x);
      const y = Math.round(entry.y);
      const z = Math.round(entry.z);
      if (x < 0 || x >= size.x || y < 0 || y >= size.y || z < 0 || z >= size.z) continue;
      if (entry.color === null) {
        staged.set(packVoxelKey(x, y, z), null);
      } else {
        const material = this._resolveMaterialForWrite(entry.color, entry.materialId ?? undefined);
        const existing = target.get(packVoxelKey(x, y, z));
        const layerId = moduleId
          ? undefined
          : normalizedVoxelLayerId(entry.layerId !== undefined
            ? entry.layerId
            : existing?.layerId ?? this._activeVoxelLayerId, this._layers);
        staged.set(packVoxelKey(x, y, z), {
          x, y, z, color: material.color, materialId: material.id,
          ...(layerId !== DEFAULT_LAYER_ID ? { layerId } : {}),
        });
      }
    }
    let finalSize = target.size;
    let changed = false;
    for (const [key, voxel] of staged) {
      const existing = target.get(key);
      if (voxel === null) {
        if (existing) {
          finalSize -= 1;
          changed = true;
        }
      } else if (!existing) {
        finalSize += 1;
        changed = true;
      } else if (existing.color !== voxel.color || existing.materialId !== voxel.materialId
        || this.voxelLayerId(existing) !== this.voxelLayerId(voxel)) {
        changed = true;
      }
    }
    if (!changed) return false;
    if (finalSize > MAX_VOXELS) throw new Error(`体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
    for (const [key, voxel] of staged) {
      if (voxel === null) target.delete(key);
      else {
        target.set(key, voxel);
      }
    }
    this._touchModule(moduleId);
    this._notify('command-patch', moduleId && moduleId !== this._editingModuleId
      ? undefined
      : { voxelKeys: Array.from(staged.keys()) });
    return true;
  }

  setVoxel(x: number, y: number, z: number, color = this._currentColor): boolean {
    if (!this.contains(x, y, z)) return false;
    const key = packVoxelKey(x, y, z);
    const normalized = normalizeColor(color);
    const material = this._resolveMaterialForWrite(normalized);
    const target = this._getEditableVoxels();
    const existing = target.get(key);
    if (!this.isEditingModule && !this.isBaseVoxelEditable(existing ?? null)) throw new Error('目标体素图层已隐藏或锁定。');
    if (existing?.color === material.color && existing.materialId === material.id) return false;
    if (!existing && target.size >= MAX_VOXELS) throw new Error(`体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
    const layerId = this.isEditingModule ? undefined : this.voxelLayerId(existing ?? { layerId: this._activeVoxelLayerId });
    target.set(key, {
      x, y, z, color: material.color, materialId: material.id,
      ...(layerId !== DEFAULT_LAYER_ID ? { layerId } : {}),
    });
    this._touchModule(this._editingModuleId);
    this._notify(existing ? 'paint' : 'add', {
      voxelKeys: [packVoxelKey(x, y, z)],
      materialIds: [material.id, ...(existing?.materialId ? [existing.materialId] : [])],
    });
    return true;
  }

  setVoxels(positions: Iterable<VoxelPosition>, color = this._currentColor): BatchVoxelResult {
    const normalized = normalizeColor(color);
    const material = this._resolveMaterialForWrite(normalized);
    const target = this._getEditableVoxels();
    const staged = new Map<PackedVoxelKey, Voxel>();
    let unchanged = 0;
    let newVoxelCount = 0;
    for (const position of positions) {
      const x = Math.round(position.x);
      const y = Math.round(position.y);
      const z = Math.round(position.z);
      if (!this.contains(x, y, z)) {
        unchanged += 1;
        continue;
      }
      const key = packVoxelKey(x, y, z);
      const existing = target.get(key);
      if (!this.isEditingModule && !this.isBaseVoxelEditable(existing ?? null)) {
        throw new Error('批量操作涉及隐藏或锁定图层。');
      }
      if ((existing?.color === material.color && existing.materialId === material.id) || staged.has(key)) {
        unchanged += 1;
        continue;
      }
      if (!existing) newVoxelCount += 1;
      if (target.size + newVoxelCount > MAX_VOXELS) {
        throw new Error(`体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
      }
      const layerId = this.isEditingModule ? undefined : this.voxelLayerId(existing ?? { layerId: this._activeVoxelLayerId });
      staged.set(key, {
        x, y, z, color: material.color, materialId: material.id,
        ...(layerId !== DEFAULT_LAYER_ID ? { layerId } : {}),
      });
    }
    let added = 0;
    let painted = 0;
    for (const [key, voxel] of staged) {
      if (target.has(key)) painted += 1;
      else added += 1;
      target.set(key, voxel);
    }
    if (staged.size > 0) {
      this._touchModule(this._editingModuleId);
      this._notify('batch', {
        voxelKeys: Array.from(staged.values(), voxel => packVoxelKey(voxel.x, voxel.y, voxel.z)),
        materialIds: [material.id],
      });
    }
    return { added, painted, unchanged };
  }

  removeVoxel(x: number, y: number, z: number): boolean {
    const target = this._getEditableVoxels();
    const key = packVoxelKey(x, y, z);
    const existing = target.get(key);
    if (!existing) return false;
    if (!this.isEditingModule && !this.isBaseVoxelEditable(existing)) throw new Error('目标体素图层已隐藏或锁定。');
    target.delete(key);
    this._touchModule(this._editingModuleId);
    this._notify('remove', {
      voxelKeys: [packVoxelKey(x, y, z)],
      materialIds: existing.materialId ? [existing.materialId] : [],
    });
    return true;
  }

  setSize(size: SceneSize): number {
    const next = { x: normalizeAxis(size.x), y: normalizeAxis(size.y), z: normalizeAxis(size.z) };
    if (next.x === this._size.x && next.y === this._size.y && next.z === this._size.z) return 0;
    this._size = next;
    let removed = 0;
    for (const [key, voxel] of this._voxels) {
      if (voxel.x >= 0 && voxel.x < this._size.x && voxel.y >= 0 && voxel.y < this._size.y && voxel.z >= 0 && voxel.z < this._size.z) continue;
      this._voxels.delete(key);
      removed += 1;
    }
    this._notify('resize');
    return removed;
  }

  clear(): boolean {
    const target = this._getEditableVoxels();
    if (target.size === 0 && (this.isEditingModule || this._moduleInstances.size === 0)) return false;
    target.clear();
    this._touchModule(this._editingModuleId);
    if (!this.isEditingModule) {
      this._moduleInstances.clear();
      for (const clip of this._animations.values()) clip.tracks.length = 0;
    }
    this._notify('clear');
    return true;
  }

  toJSON(): VoxelProject {
    return serializeVoxelProject({
      size: this._size,
      backgroundColor: this._backgroundColor,
      currentColor: this._currentColor,
      currentMaterialId: this._currentMaterialId,
      activeAnimationId: this._activeAnimationId,
      animationFrame: this._animationFrame,
      voxels: this._voxels.values(),
      modules: Array.from(this._modules.values(), module => ({
        id: module.id, name: module.name, size: module.size, voxels: module.voxels.values(),
      })),
      moduleInstances: this._moduleInstances.values(),
      layers: this._layers.values(),
      palette: this._palette.values(),
      animations: this._animations.values(),
    });
  }

  createModule(name: string, size: SceneSize = { x: 16, y: 16, z: 16 }): VoxelModuleData {
    const id = `module-${this._nextModuleId++}`;
    const module = {
      id,
      name: name.trim() || `模块 ${this._nextModuleId - 1}`,
      size: { x: normalizeAxis(size.x), y: normalizeAxis(size.y), z: normalizeAxis(size.z) },
      voxels: new Map<PackedVoxelKey, Voxel>(),
      revision: this._nextModuleRevision++,
    };
    this._modules.set(id, module);
    this._editingModuleId = id;
    this._notify('module-create');
    return { id, name: module.name, size: { ...module.size }, voxels: [] };
  }

  restoreModule(module: Readonly<VoxelModuleData>): void {
    const size = {
      x: normalizeAxis(module.size.x),
      y: normalizeAxis(module.size.y),
      z: normalizeAxis(module.size.z),
    };
    const voxels = new Map<PackedVoxelKey, Voxel>();
    for (const source of module.voxels) {
      const x = Math.round(source.x), y = Math.round(source.y), z = Math.round(source.z);
      if (x < 0 || x >= size.x || y < 0 || y >= size.y || z < 0 || z >= size.z) continue;
      const material = this._resolveMaterialForWrite(source.color, source.materialId);
      voxels.set(packVoxelKey(x, y, z), { x, y, z, color: material.color, materialId: material.id });
      if (voxels.size > MAX_VOXELS) throw new Error(`单个模块的体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
    }
    const id = String(module.id);
    this._modules.set(id, {
      id, name: String(module.name), size, voxels, revision: this._nextModuleRevision++,
    });
    this._nextModuleId = Math.max(this._nextModuleId, numericIdSuffix(id, 'module-') + 1);
    this._notify('module-update');
  }

  removeModule(moduleId: string): boolean {
    if (!this._modules.has(moduleId)) return false;
    if (Array.from(this._moduleInstances.values()).some(instance => instance.moduleId === moduleId)) {
      throw new Error('模块仍有场景实例，无法删除。');
    }
    for (const clip of this._animations.values()) {
      if (clip.tracks.some(track => track.keyframes.some(keyframe => keyframe.moduleId === moduleId))) {
        throw new Error('模块仍被动画关键帧引用，无法删除。');
      }
    }
    this._modules.delete(moduleId);
    if (this._editingModuleId === moduleId) this._editingModuleId = null;
    this._notify('module-remove');
    return true;
  }

  updateModule(moduleId: string, patch: Partial<Pick<VoxelModuleData, 'name'>>): boolean {
    const module = this._modules.get(moduleId);
    if (!module) return false;
    const name = patch.name === undefined ? module.name : patch.name.trim() || module.name;
    if (name === module.name) return false;
    module.name = name;
    this._notify('module-update');
    return true;
  }

  isModuleUsed(moduleId: string): boolean {
    if (Array.from(this._moduleInstances.values()).some(instance => instance.moduleId === moduleId)) return true;
    return Array.from(this._animations.values()).some(clip =>
      clip.tracks.some(track => track.keyframes.some(keyframe => keyframe.moduleId === moduleId)));
  }

  getModuleInstanceVoxelPositions(moduleId: string): readonly VoxelPosition[] {
    const module = this._modules.get(moduleId);
    if (!module) return [];
    const positions = new Map<string, VoxelPosition>();
    for (const instance of this.evaluatedModuleInstances) {
      if (instance.moduleId !== moduleId) continue;
      for (const voxel of transformModuleVoxels(module.voxels.values(), instance, module.size)) {
        const x = instance.position.x + voxel.x;
        const y = instance.position.y + voxel.y;
        const z = instance.position.z + voxel.z;
        if (x < 0 || x >= this._size.x || y < 0 || y >= this._size.y || z < 0 || z >= this._size.z) continue;
        positions.set(voxelKey(x, y, z), { x, y, z });
      }
    }
    return Array.from(positions.values());
  }

  editScene(): void {
    if (this._editingModuleId === null) return;
    this._editingModuleId = null;
    this._notify('edit-target');
  }

  editModule(moduleId: string): boolean {
    if (!this._modules.has(moduleId)) return false;
    if (this._editingModuleId === moduleId) return true;
    this._editingModuleId = moduleId;
    this._notify('edit-target');
    return true;
  }

  addModuleInstance(moduleId: string, position: VoxelPosition, layerId = DEFAULT_LAYER_ID): VoxelModuleInstance {
    const module = this._modules.get(moduleId);
    if (!module) throw new Error('模块不存在。');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new Error('模块粘贴坐标无效。');
    if (!this._layers.has(layerId)) throw new Error('目标图层不存在。');
    const id = `module-instance-${this._nextModuleInstanceId++}`;
    const instance: VoxelModuleInstance = {
      id,
      moduleId,
      name: `${module.name} ${this._nextModuleInstanceId - 1}`,
      position: {
        x: Math.round(position.x),
        y: Math.round(position.y),
        z: Math.round(position.z),
      },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      layerId,
      visible: true,
    };
    this._moduleInstances.set(id, instance);
    this._editingModuleId = null;
    this._notify('module-instance-add', { instanceIds: [id] });
    return cloneModuleInstance(instance);
  }

  restoreModuleInstance(instance: Readonly<VoxelModuleInstance>): void {
    if (!this._modules.has(instance.moduleId)) throw new Error('模块实例引用的模块不存在。');
    if (!this._layers.has(instance.layerId)) throw new Error('模块实例引用的图层不存在。');
    const restored = cloneModuleInstance(instance);
    this._moduleInstances.set(restored.id, restored);
    this._nextModuleInstanceId = Math.max(
      this._nextModuleInstanceId,
      numericIdSuffix(restored.id, 'module-instance-') + 1,
    );
    this._notify('module-instance-add', { instanceIds: [restored.id] });
  }

  updateModuleInstance(
    instanceId: string,
    patch: Partial<Pick<VoxelModuleInstance, 'name' | 'position' | 'rotation' | 'scale' | 'layerId' | 'visible'>>,
  ): boolean {
    const instance = this._moduleInstances.get(instanceId);
    if (!instance) return false;
    const next: VoxelModuleInstance = cloneModuleInstance(instance);
    if (patch.name !== undefined) next.name = patch.name.trim() || instance.name;
    if (patch.layerId !== undefined) {
      if (!this._layers.has(patch.layerId)) throw new Error('目标图层不存在。');
      next.layerId = patch.layerId;
    }
    if (patch.visible !== undefined) next.visible = patch.visible;
    if (patch.position) {
      if (![patch.position.x, patch.position.y, patch.position.z].every(Number.isFinite)) throw new Error('模块实例坐标无效。');
      next.position = {
        x: Math.round(patch.position.x), y: Math.round(patch.position.y), z: Math.round(patch.position.z),
      };
    }
    if (patch.rotation) next.rotation = {
      x: normalizeQuarterTurn(patch.rotation.x),
      y: normalizeQuarterTurn(patch.rotation.y),
      z: normalizeQuarterTurn(patch.rotation.z),
    };
    if (patch.scale) next.scale = {
      x: normalizeModuleScale(patch.scale.x),
      y: normalizeModuleScale(patch.scale.y),
      z: normalizeModuleScale(patch.scale.z),
    };
    const module = this._modules.get(next.moduleId);
    if (module && module.voxels.size * next.scale.x * next.scale.y * next.scale.z > MAX_VOXELS) {
      throw new Error(`单个模块实例变换后的体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
    }
    if (JSON.stringify(next) === JSON.stringify(instance)) return false;
    this._moduleInstances.set(instanceId, next);
    this._notify('module-instance-transform', { instanceIds: [instanceId] });
    return true;
  }

  createAnimation(name = '', frameCount = 12, fps = 12): VoxelAnimationClip {
    let id = `animation-${this._nextAnimationId++}`;
    while (this._animations.has(id)) id = `animation-${this._nextAnimationId++}`;
    const clip: VoxelAnimationClip = {
      id,
      name: name.trim() || `动画 ${this._nextAnimationId - 1}`,
      fps: normalizeAnimationFps(fps),
      frameCount: normalizeAnimationFrameCount(frameCount),
      loop: true,
      playbackStart: 0,
      playbackEnd: normalizeAnimationFrameCount(frameCount) - 1,
      tracks: [],
    };
    this._animations.set(id, clip);
    this._activeAnimationId = id;
    this._animationFrame = 0;
    this._notify('animation-create');
    return cloneAnimationClip(clip);
  }

  duplicateAnimation(animationId: string, name = ''): VoxelAnimationClip {
    const source = this._animations.get(animationId);
    if (!source) throw new Error('动画不存在。');
    let id = `animation-${this._nextAnimationId++}`;
    while (this._animations.has(id)) id = `animation-${this._nextAnimationId++}`;
    const copy = cloneAnimationClip(source);
    copy.id = id;
    copy.name = name.trim() || `${source.name} 副本`;
    this._animations.set(id, copy);
    this._activeAnimationId = id;
    this._animationFrame = animationPlaybackRange(copy).start;
    this._notify('animation-create');
    return cloneAnimationClip(copy);
  }

  updateAnimation(
    animationId: string,
    patch: Partial<Pick<VoxelAnimationClip, 'name' | 'fps' | 'frameCount' | 'loop' | 'playbackStart' | 'playbackEnd'>>,
  ): boolean {
    const clip = this._animations.get(animationId);
    if (!clip) return false;
    const next = updatedAnimationClip(clip, patch);
    if (!next) return false;
    this._animations.set(animationId, next);
    if (this._activeAnimationId === animationId) this._animationFrame = normalizeAnimationFrame(this._animationFrame, next.frameCount);
    this._notify('animation-update');
    return true;
  }

  removeAnimation(animationId: string): boolean {
    if (!this._animations.delete(animationId)) return false;
    if (this._activeAnimationId === animationId) {
      this._activeAnimationId = this._animations.keys().next().value ?? null;
      this._animationFrame = 0;
    }
    this._notify('animation-remove');
    return true;
  }

  restoreAnimation(clip: Readonly<VoxelAnimationClip>): void {
    const restored = cloneAnimationClip(clip);
    this._animations.set(restored.id, restored);
    this._nextAnimationId = Math.max(this._nextAnimationId, numericIdSuffix(restored.id, 'animation-') + 1);
    this._notify('animation-create');
  }

  setActiveAnimation(animationId: string | null): boolean {
    const nextId = animationId && this._animations.has(animationId) ? animationId : null;
    if (nextId === this._activeAnimationId) return false;
    this._activeAnimationId = nextId;
    this._animationFrame = 0;
    this._notify('animation-select');
    return true;
  }

  setAnimationFrame(frame: number): boolean {
    const clip = this._activeAnimationId ? this._animations.get(this._activeAnimationId) : null;
    const next = clip ? normalizeAnimationFrame(frame, clip.frameCount) : 0;
    if (next === this._animationFrame) return false;
    this._animationFrame = next;
    this._notify('animation-frame', {
      instanceIds: clip?.tracks.map(track => track.instanceId) ?? [],
    });
    return true;
  }

  setAnimationKeyframe(
    animationId: string,
    instanceId: string,
    frame: number,
    state?: Readonly<Pick<VoxelModuleInstance, 'moduleId' | 'position' | 'rotation' | 'scale' | 'visible'>>,
  ): boolean {
    const clip = this._animations.get(animationId);
    const base = this._moduleInstances.get(instanceId);
    if (!clip || !base) return false;
    const result = upsertAnimationKeyframe(clip, base, frame, state);
    if (!this._modules.has(result.moduleId)) throw new Error('动画关键帧引用的模块不存在。');
    if (!result.changed) return false;
    this._notify('animation-keyframe', { instanceIds: [instanceId] });
    return true;
  }

  removeAnimationKeyframe(animationId: string, instanceId: string, frame: number): boolean {
    const clip = this._animations.get(animationId);
    if (!clip || !removeAnimationKeyframeState(clip, instanceId, frame)) return false;
    this._notify('animation-keyframe-remove', { instanceIds: [instanceId] });
    return true;
  }

  getAnimationKeyframe(animationId: string, instanceId: string, frame: number): VoxelAnimationKeyframe | null {
    return animationKeyframeAt(this._animations.get(animationId), instanceId, frame);
  }

  applyAnimationKeyframeSnapshot(
    animationId: string,
    instanceId: string,
    frame: number,
    keyframe: Readonly<VoxelAnimationKeyframe> | null,
  ): boolean {
    return keyframe
      ? this.setAnimationKeyframe(animationId, instanceId, frame, keyframe)
      : this.removeAnimationKeyframe(animationId, instanceId, frame);
  }

  applyAnimationKeyframeSnapshots(animationId: string, snapshots: Iterable<AnimationKeyframeSnapshot>): boolean {
    const current = this._animations.get(animationId);
    if (!current) return false;
    const next = cloneAnimationClip(current);
    let changed = false;
    const instanceIds = new Set<string>();
    for (const snapshot of snapshots) {
      instanceIds.add(snapshot.instanceId);
      const base = this._moduleInstances.get(snapshot.instanceId);
      if (!base) throw new Error('关键帧引用的模块实例不存在。');
      if (snapshot.keyframe) {
        if (!this._modules.has(snapshot.keyframe.moduleId)) throw new Error('动画关键帧引用的模块不存在。');
        changed = upsertAnimationKeyframe(next, base, snapshot.frame, snapshot.keyframe).changed || changed;
      } else {
        changed = removeAnimationKeyframeState(next, snapshot.instanceId, snapshot.frame) || changed;
      }
    }
    if (!changed) return false;
    this._animations.set(animationId, next);
    this._notify('animation-keyframe', { instanceIds: [...instanceIds] });
    return true;
  }

  createLayer(name: string): VoxelLayer {
    const id = `layer-${this._nextLayerId++}`;
    const layer = { id, name: name.trim() || `图层 ${this._nextLayerId - 1}`, visible: true, locked: false };
    this._layers.set(id, layer);
    this._notify('layer-create');
    return { ...layer };
  }

  restoreLayer(layer: Readonly<VoxelLayer>): void {
    const restored: VoxelLayer = {
      id: String(layer.id),
      name: String(layer.name),
      visible: layer.visible !== false,
      locked: layer.locked === true,
    };
    const existed = this._layers.has(restored.id);
    this._layers.set(restored.id, restored);
    this._nextLayerId = Math.max(this._nextLayerId, numericIdSuffix(restored.id, 'layer-') + 1);
    this._notify(existed ? 'layer-update' : 'layer-create');
  }

  updateLayer(layerId: string, patch: Partial<Pick<VoxelLayer, 'name' | 'visible' | 'locked'>>): boolean {
    const layer = this._layers.get(layerId);
    if (!layer) return false;
    const next = {
      ...layer,
      name: patch.name === undefined ? layer.name : patch.name.trim() || layer.name,
      visible: patch.visible ?? layer.visible,
      locked: patch.locked ?? layer.locked,
    };
    if (next.name === layer.name && next.visible === layer.visible && next.locked === layer.locked) return false;
    this._layers.set(layerId, next);
    this._notify('layer-update');
    return true;
  }

  removeLayer(layerId: string): boolean {
    if (layerId === DEFAULT_LAYER_ID || !this._layers.delete(layerId)) return false;
    for (const instance of this._moduleInstances.values()) {
      if (instance.layerId === layerId) instance.layerId = DEFAULT_LAYER_ID;
    }
    for (const voxel of this._voxels.values()) if (voxel.layerId === layerId) delete voxel.layerId;
    if (this._activeVoxelLayerId === layerId) this._activeVoxelLayerId = DEFAULT_LAYER_ID;
    this._notify('layer-remove');
    return true;
  }

  getLayer(layerId: string): VoxelLayer | null {
    const layer = this._layers.get(layerId);
    return layer ? { ...layer } : null;
  }

  removeModuleInstance(instanceId: string): boolean {
    if (!this._moduleInstances.delete(instanceId)) return false;
    for (const clip of this._animations.values()) {
      clip.tracks = clip.tracks.filter(track => track.instanceId !== instanceId);
    }
    this._notify('module-instance-remove', { instanceIds: [instanceId] });
    return true;
  }

  getModule(moduleId: string): VoxelModuleData | null {
    const module = this._modules.get(moduleId);
    return module ? {
      id: module.id,
      name: module.name,
      size: { ...module.size },
      voxels: Array.from(module.voxels.values(), voxel => ({ ...voxel })),
    } : null;
  }

  getModuleInstance(instanceId: string): VoxelModuleInstance | null {
    const instance = this._moduleInstances.get(instanceId);
    return instance ? cloneModuleInstance(instance) : null;
  }

  getEvaluatedModuleInstance(instanceId: string): VoxelModuleInstance | null {
    const instance = this._moduleInstances.get(instanceId);
    if (!instance) return null;
    const clip = this._activeAnimationId ? this._animations.get(this._activeAnimationId) ?? null : null;
    return evaluateAnimationInstance(instance, clip, this._animationFrame);
  }

  hasModuleInstanceCollision(instanceId: string): boolean {
    this._ensureSceneVoxels();
    return (this._moduleInstanceCollisions.get(instanceId)?.size ?? 0) > 0;
  }

  getModuleInstanceCollisions(instanceId: string): readonly VoxelPosition[] {
    this._ensureSceneVoxels();
    return Array.from(this._moduleInstanceCollisions.get(instanceId) ?? [], key => {
      const [x, y, z] = key.split(',').map(Number);
      return { x: x!, y: y!, z: z! };
    });
  }

  load(project: unknown): void {
    const staged = new VoxelDocument(this._size);
    staged._currentColor = this._currentColor;
    staged._currentMaterialId = this._currentMaterialId;
    staged._loadIntoIsolatedState(project);
    this._commitLoadedState(staged);
    this._notify('load');
  }

  private _loadIntoIsolatedState(project: unknown): void {
    const data = migrateVoxelProject(project) as Partial<VoxelProject>;
    if (!data.size || !Array.isArray(data.voxels)) {
      throw new Error('不支持的体素工程格式。');
    }
    const nextSize = {
      x: normalizeAxis(Number(data.size.x)),
      y: normalizeAxis(Number(data.size.y)),
      z: normalizeAxis(Number(data.size.z)),
    };
    const next = new Map<PackedVoxelKey, Voxel>();
    for (const item of data.voxels) {
      const x = Math.round(Number(item.x));
      const y = Math.round(Number(item.y));
      const z = Math.round(Number(item.z));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('体素坐标无效。');
      if (x < 0 || x >= nextSize.x || y < 0 || y >= nextSize.y || z < 0 || z >= nextSize.z) continue;
      const voxel = {
        x, y, z,
        color: normalizeColor(String(item.color)),
        materialId: item.materialId ? String(item.materialId) : undefined,
        layerId: item.layerId ? String(item.layerId) : undefined,
      };
      next.set(packVoxelKey(x, y, z), voxel);
      if (next.size > MAX_VOXELS) throw new Error(`体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
    }
    this._size = nextSize;
    this._backgroundColor = data.scene?.backgroundColor === undefined
      ? DEFAULT_SCENE_BACKGROUND_COLOR
      : normalizeColor(String(data.scene.backgroundColor));
    this._voxels.clear();
    for (const [key, voxel] of next) this._voxels.set(key, voxel);
    this._modules.clear();
    this._moduleInstances.clear();
    this._layers.clear();
    this._palette.clear();
    this._animations.clear();
    this._nextModuleId = 1;
    this._nextModuleInstanceId = 1;
    this._nextLayerId = 2;
    this._nextMaterialId = 1;
    this._nextAnimationId = 1;
    this._activeAnimationId = null;
    this._animationFrame = 0;
    this._layers.set(DEFAULT_LAYER_ID, { id: DEFAULT_LAYER_ID, name: '默认图层', visible: true, locked: false });
    for (const rawLayer of data.layers ?? []) {
      const id = String(rawLayer.id || `layer-${this._nextLayerId++}`);
      this._layers.set(id, {
        id,
        name: String(rawLayer.name || id),
        visible: rawLayer.visible !== false,
        locked: rawLayer.locked === true,
      });
      this._nextLayerId = Math.max(this._nextLayerId, numericIdSuffix(id, 'layer-') + 1);
    }
    if (!this._layers.has(DEFAULT_LAYER_ID)) {
      this._layers.set(DEFAULT_LAYER_ID, { id: DEFAULT_LAYER_ID, name: '默认图层', visible: true, locked: false });
    }
    for (const voxel of this._voxels.values()) {
      const layerId = normalizedVoxelLayerId(voxel.layerId, this._layers);
      if (layerId === DEFAULT_LAYER_ID) delete voxel.layerId;
      else voxel.layerId = layerId;
    }
    const rawPalette = data.palette;
    if (Array.isArray(rawPalette) && rawPalette.length > 0) {
      for (const rawMaterial of rawPalette) {
        const color = normalizeColor(String(rawMaterial.color));
        const id = String(rawMaterial.id || `material-${this._nextMaterialId++}`);
        this._palette.set(id, {
          id,
          color,
          name: String(rawMaterial.name || color.toUpperCase()),
          metallic: normalizeUnit(Number(rawMaterial.metallic), DEFAULT_PBR_METALLIC),
          roughness: normalizeUnit(Number(rawMaterial.roughness), DEFAULT_PBR_ROUGHNESS, 0.04),
          ...(isRecord(rawMaterial.vox) ? { vox: parseVoxMaterialExtension(rawMaterial.vox) } : {}),
        });
        this._nextMaterialId = Math.max(this._nextMaterialId, numericIdSuffix(id, 'material-') + 1);
      }
    } else {
      for (const material of DEFAULT_PALETTE) this._palette.set(material.id, { ...material });
      this._nextMaterialId = 13;
    }
    for (const rawModule of data.modules ?? []) {
      const moduleSize = {
        x: normalizeAxis(Number(rawModule.size?.x)),
        y: normalizeAxis(Number(rawModule.size?.y)),
        z: normalizeAxis(Number(rawModule.size?.z)),
      };
      const moduleVoxels = new Map<PackedVoxelKey, Voxel>();
      for (const item of rawModule.voxels ?? []) {
        const voxel = {
          x: Math.round(Number(item.x)), y: Math.round(Number(item.y)), z: Math.round(Number(item.z)),
          color: normalizeColor(String(item.color)),
          materialId: item.materialId ? String(item.materialId) : undefined,
        };
        if (voxel.x < 0 || voxel.x >= moduleSize.x || voxel.y < 0 || voxel.y >= moduleSize.y || voxel.z < 0 || voxel.z >= moduleSize.z) continue;
        moduleVoxels.set(packVoxelKey(voxel.x, voxel.y, voxel.z), voxel);
        if (moduleVoxels.size > MAX_VOXELS) throw new Error(`单个模块的体素数量不能超过 ${MAX_VOXELS.toLocaleString()}。`);
      }
      const id = String(rawModule.id || `module-${this._nextModuleId++}`);
      this._modules.set(id, {
        id, name: String(rawModule.name || id), size: moduleSize, voxels: moduleVoxels,
        revision: this._nextModuleRevision++,
      });
      this._nextModuleId = Math.max(this._nextModuleId, numericIdSuffix(id, 'module-') + 1);
    }
    for (const rawInstance of data.moduleInstances ?? []) {
      if (!this._modules.has(rawInstance.moduleId)) continue;
      const id = String(rawInstance.id || `module-instance-${this._nextModuleInstanceId++}`);
      this._moduleInstances.set(id, {
        id,
        moduleId: rawInstance.moduleId,
        name: String(rawInstance.name || id),
        position: {
          x: Math.round(Number(rawInstance.position?.x) || 0),
          y: Math.round(Number(rawInstance.position?.y) || 0),
          z: Math.round(Number(rawInstance.position?.z) || 0),
        },
        rotation: {
          x: normalizeQuarterTurn(Number(rawInstance.rotation?.x)),
          y: normalizeQuarterTurn(Number(rawInstance.rotation?.y)),
          z: normalizeQuarterTurn(Number(rawInstance.rotation?.z)),
        },
        scale: {
          x: normalizeModuleScale(Number(rawInstance.scale?.x)),
          y: normalizeModuleScale(Number(rawInstance.scale?.y)),
          z: normalizeModuleScale(Number(rawInstance.scale?.z)),
        },
        layerId: this._layers.has(rawInstance.layerId) ? rawInstance.layerId : DEFAULT_LAYER_ID,
        visible: rawInstance.visible !== false,
      });
      this._nextModuleInstanceId = Math.max(this._nextModuleInstanceId, numericIdSuffix(id, 'module-instance-') + 1);
    }
    for (const rawClip of data.animations ?? []) {
      const id = String(rawClip.id || `animation-${this._nextAnimationId++}`);
      const frameCount = normalizeAnimationFrameCount(Number(rawClip.frameCount));
      const tracks = (rawClip.tracks ?? []).flatMap(rawTrack => {
        const instanceId = String(rawTrack.instanceId || '');
        if (!this._moduleInstances.has(instanceId)) return [];
        const byFrame = new Map<number, VoxelAnimationKeyframe>();
        for (const rawKeyframe of rawTrack.keyframes ?? []) {
          const moduleId = String(rawKeyframe.moduleId || this._moduleInstances.get(instanceId)?.moduleId || '');
          if (!this._modules.has(moduleId)) continue;
          const keyframe = normalizedAnimationKeyframe(Number(rawKeyframe.frame), {
            moduleId,
            position: {
              x: Number(rawKeyframe.position?.x), y: Number(rawKeyframe.position?.y), z: Number(rawKeyframe.position?.z),
            },
            rotation: {
              x: Number(rawKeyframe.rotation?.x), y: Number(rawKeyframe.rotation?.y), z: Number(rawKeyframe.rotation?.z),
            },
            scale: {
              x: Number(rawKeyframe.scale?.x), y: Number(rawKeyframe.scale?.y), z: Number(rawKeyframe.scale?.z),
            },
            visible: rawKeyframe.visible !== false,
          }, frameCount);
          byFrame.set(keyframe.frame, keyframe);
        }
        const keyframes = Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame);
        return keyframes.length > 0 ? [{ instanceId, keyframes }] : [];
      });
      this._animations.set(id, {
        id,
        name: String(rawClip.name || id),
        fps: normalizeAnimationFps(Number(rawClip.fps)),
        frameCount,
        loop: rawClip.loop !== false,
        playbackStart: normalizeAnimationFrame(Number(rawClip.playbackStart ?? 0), frameCount),
        playbackEnd: normalizeAnimationFrame(Number(rawClip.playbackEnd ?? frameCount - 1), frameCount),
        tracks,
      });
      this._nextAnimationId = Math.max(this._nextAnimationId, numericIdSuffix(id, 'animation-') + 1);
    }
    const requestedAnimationId = data.editor?.activeAnimationId;
    this._activeAnimationId = requestedAnimationId && this._animations.has(requestedAnimationId)
      ? requestedAnimationId
      : this._animations.keys().next().value ?? null;
    const activeClip = this._activeAnimationId ? this._animations.get(this._activeAnimationId) : null;
    this._animationFrame = activeClip
      ? normalizeAnimationFrame(Number(data.editor?.animationFrame), activeClip.frameCount)
      : 0;
    this._editingModuleId = null;
    if (data.editor?.currentColor) this._currentColor = normalizeColor(data.editor.currentColor);
    const preferredMaterial = data.editor?.currentMaterialId
      ? this._palette.get(data.editor.currentMaterialId)
      : this._findPaletteMaterialByColor(this._currentColor);
    const currentMaterial = preferredMaterial ?? this._createPaletteMaterialInternal(this._currentColor);
    this._currentMaterialId = currentMaterial.id;
    this._currentColor = currentMaterial.color;
    for (const voxel of this._voxels.values()) {
      const material = this._resolveMaterialForWrite(voxel.color, voxel.materialId);
      voxel.color = material.color;
      voxel.materialId = material.id;
    }
    for (const module of this._modules.values()) {
      for (const voxel of module.voxels.values()) {
        const material = this._resolveMaterialForWrite(voxel.color, voxel.materialId);
        voxel.color = material.color;
        voxel.materialId = material.id;
      }
    }
  }

  private _commitLoadedState(staged: VoxelDocument): void {
    let moduleRevision = this._nextModuleRevision;
    this._size = { ...staged._size };
    this._backgroundColor = staged._backgroundColor;
    replaceMap(this._voxels, staged._voxels);
    replaceMap(this._modules, staged._modules);
    for (const module of this._modules.values()) module.revision = moduleRevision++;
    replaceMap(this._moduleInstances, staged._moduleInstances);
    replaceMap(this._layers, staged._layers);
    replaceMap(this._palette, staged._palette);
    replaceMap(this._animations, staged._animations);
    this._currentColor = staged._currentColor;
    this._currentMaterialId = staged._currentMaterialId;
    this._editingModuleId = staged._editingModuleId;
    this._nextModuleId = staged._nextModuleId;
    this._nextModuleRevision = moduleRevision;
    this._nextModuleInstanceId = staged._nextModuleInstanceId;
    this._nextLayerId = staged._nextLayerId;
    this._nextMaterialId = staged._nextMaterialId;
    this._nextAnimationId = staged._nextAnimationId;
    this._activeAnimationId = staged._activeAnimationId;
    this._animationFrame = staged._animationFrame;
    this._activeVoxelLayerId = DEFAULT_LAYER_ID;
    this._viewVoxels.clear();
    this._sceneVoxels.clear();
    this._moduleInstanceCollisions.clear();
    this._materialUsageCounts.clear();
    this._materialUsageDirty = true;
  }

  private _notify(
    reason: VoxelDocumentChangeReason,
    partialImpact: Partial<Omit<VoxelDocumentChangeImpact, 'fullRender'>> = {},
  ): void {
    const dirty = Object.freeze(dirtyFlagsForReason(reason));
    if (dirty.scene) this._sceneDirty = true;
    if (dirty.view) this._viewDirty = true;
    if (reason === 'palette-create' || reason === 'palette-update' || reason === 'palette-remove'
      || reason === 'add' || reason === 'paint' || reason === 'command-patch' || reason === 'batch'
      || reason === 'remove' || reason === 'resize' || reason === 'clear'
      || reason === 'module-create' || reason === 'module-update' || reason === 'module-remove'
      || reason === 'load') this._materialUsageDirty = true;
    const hasPreciseRenderImpact = partialImpact.voxelKeys !== undefined
      || partialImpact.instanceIds !== undefined || partialImpact.materialIds !== undefined;
    const impact = Object.freeze({
      fullRender: dirty.render && !hasPreciseRenderImpact,
      voxelKeys: Object.freeze([...(partialImpact.voxelKeys ?? [])]),
      instanceIds: Object.freeze([...(partialImpact.instanceIds ?? [])]),
      materialIds: Object.freeze([...(partialImpact.materialIds ?? [])]),
    });
    const detail: VoxelDocumentChangeDetail = { reason, dirty, impact };
    this._transactions.publish(detail, this._dispatchDocumentChange);
  }

  private _touchModule(moduleId: string | null): void {
    const module = moduleId ? this._modules.get(moduleId) : null;
    if (module) module.revision = this._nextModuleRevision++;
  }

  private _ensureMaterialUsageCounts(): void {
    if (!this._materialUsageDirty) return;
    this._materialUsageCounts.clear();
    const add = (voxel: Readonly<Voxel>): void => {
      const materialId = voxel.materialId && this._palette.has(voxel.materialId)
        ? voxel.materialId
        : this._findPaletteMaterialByColor(voxel.color)?.id;
      if (materialId) this._materialUsageCounts.set(materialId, (this._materialUsageCounts.get(materialId) ?? 0) + 1);
    };
    for (const voxel of this._voxels.values()) add(voxel);
    for (const module of this._modules.values()) for (const voxel of module.voxels.values()) add(voxel);
    this._materialUsageDirty = false;
  }

  private _findPaletteMaterialByColor(color: string): PbrPaletteMaterial | null {
    for (const material of this._palette.values()) if (material.color === color) return material;
    return null;
  }

  private _createPaletteMaterialInternal(color: string, name = ''): PbrPaletteMaterial {
    let id = `material-${this._nextMaterialId++}`;
    while (this._palette.has(id)) id = `material-${this._nextMaterialId++}`;
    const material = {
      id,
      color,
      name: name.trim() || color.toUpperCase(),
      metallic: DEFAULT_PBR_METALLIC,
      roughness: DEFAULT_PBR_ROUGHNESS,
    };
    this._palette.set(id, material);
    return material;
  }

  private _resolveMaterialForWrite(color: string, preferredId?: string): PbrPaletteMaterial {
    const preferred = preferredId ? this._palette.get(preferredId) : null;
    if (preferred) return preferred;
    const normalized = normalizeColor(color);
    const current = this._palette.get(this._currentMaterialId);
    if (current?.color === normalized) return current;
    return this._findPaletteMaterialByColor(normalized) ?? this._createPaletteMaterialInternal(normalized);
  }

  private _getEditingModule(): {
    id: string; name: string; size: SceneSize; voxels: Map<PackedVoxelKey, Voxel>; revision: number;
  } | null {
    return this._editingModuleId ? this._modules.get(this._editingModuleId) ?? null : null;
  }

  private _getEditableVoxels(): Map<PackedVoxelKey, Voxel> {
    return this._getEditingModule()?.voxels ?? this._voxels;
  }

  private _getTargetVoxels(moduleId: string | null): Map<PackedVoxelKey, Voxel> {
    if (moduleId === null) return this._voxels;
    const module = this._modules.get(moduleId);
    if (!module) throw new Error('命令引用的模块不存在。');
    return module.voxels;
  }

  private _ensureViewVoxels(): void {
    if (!this._viewDirty) return;
    this._viewVoxels.clear();
    const module = this._getEditingModule();
    if (module) {
      for (const voxel of module.voxels.values()) {
        this._viewVoxels.set(packVoxelKey(voxel.x, voxel.y, voxel.z), {
          ...voxel, source: 'module-definition', moduleId: module.id,
        });
      }
    } else {
      this._ensureSceneVoxels();
      for (const [key, voxel] of this._sceneVoxels) this._viewVoxels.set(key, voxel);
    }
    this._viewDirty = false;
  }

  private _ensureSceneVoxels(): void {
    if (!this._sceneDirty) return;
    this._sceneVoxels.clear();
    this._moduleInstanceCollisions.clear();
    const clip = this._activeAnimationId ? this._animations.get(this._activeAnimationId) ?? null : null;
    const composed = this._composeSceneVoxels(clip, this._animationFrame, this._moduleInstanceCollisions);
    for (const [key, voxel] of composed) this._sceneVoxels.set(key, voxel);
    this._sceneDirty = false;
  }

  private _composeSceneVoxels(
    clip: Readonly<VoxelAnimationClip> | null,
    frame: number,
    collisions?: Map<string, Set<string>>,
  ): Map<PackedVoxelKey, RenderableVoxel> {
    return composeSceneVoxels({
      size: this._size,
      voxels: this._voxels,
      modules: this._modules,
      instances: this._moduleInstances.values(),
      layers: this._layers,
      animation: clip,
      frame,
      ...(collisions ? { collisions } : {}),
    });
  }

}
