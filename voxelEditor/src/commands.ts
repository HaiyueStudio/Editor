import type {
  AnimationKeyframeSnapshot,
  BatchVoxelResult,
  PbrPaletteMaterial,
  SceneSize,
  Voxel,
  VoxelAnimationClip,
  VoxelAnimationKeyframe,
  VoxelLayer,
  VoxelModuleData,
  VoxelModuleInstance,
  VoxelPatchEntry,
  VoxelPosition,
  VoxelProject,
} from './model';
import { normalizeColor, voxelKey, VoxelDocument } from './model';
import { EditorHistoryService } from '@haiyue/editor-platform';
import {
  animationRefKey,
  cloneAnimation,
  cloneInstance,
  cloneKeyframe,
  cloneModule,
  normalizeSceneSize,
  sameKeyframe,
  sameSize,
  uniqueAnimationRefs,
  type AnimationKeyframeRef,
} from './commands/CommandValueSnapshots';

export type { AnimationKeyframeRef } from './commands/CommandValueSnapshots';

const ESTIMATED_VOXEL_HISTORY_BYTES = 192;

export interface EditorCommand {
  readonly label: string;
  readonly estimatedBytes?: number;
  execute(): boolean;
  undo(): void;
}

export type CommandTransactionRunner = <T>(operation: () => T) => T;

export class CommandHistory extends EventTarget {
  private readonly _byteBudget: number;
  private readonly _history: EditorHistoryService;
  private readonly _ownsHistory: boolean;
  private readonly _historySubscription: { dispose(): void };
  private _transactionRunner: CommandTransactionRunner | null = null;

  constructor(limit = 100, byteBudget = 64 * 1024 * 1024, history?: EditorHistoryService) {
    super();
    this._byteBudget = Math.max(1, Math.floor(byteBudget));
    this._ownsHistory = history === undefined;
    this._history = history ?? new EditorHistoryService({
      maxEntries: Math.max(1, Math.floor(limit)),
      byteBudget: this._byteBudget,
    });
    let previous = historySnapshotKey(this._history);
    this._historySubscription = this._history.subscribe(() => {
      const next = historySnapshotKey(this._history);
      if (next === previous) return;
      previous = next;
      this._notify();
    });
  }

  get canUndo(): boolean { return this._history.canUndo; }
  get canRedo(): boolean { return this._history.canRedo; }
  get undoLabel(): string | null { return this._history.snapshot().undoLabel ?? null; }
  get redoLabel(): string | null { return this._history.snapshot().redoLabel ?? null; }
  get estimatedBytes(): number { return this._history.snapshot().estimatedBytes; }
  get byteBudget(): number { return this._byteBudget; }

  /** Binds model transaction ownership without introducing a renderer dependency. */
  setTransactionRunner(runner: CommandTransactionRunner | null): this {
    this._transactionRunner = runner;
    return this;
  }

  execute(command: EditorCommand): boolean {
    if (commandBytes(command) > this._byteBudget) {
      if (!this._run(() => command.execute())) return false;
      this._history.clear();
      return true;
    }
    return this._history.execute(this._adapt(command));
  }

  /** Records a command whose effect has already been applied by an interactive operation. */
  recordApplied(command: EditorCommand): void {
    if (commandBytes(command) > this._byteBudget) this._history.clear();
    else this._history.recordApplied(this._adapt(command));
  }

  undo(): string | null {
    const label = this.undoLabel;
    return label && this._history.undo() ? label : null;
  }

  redo(): string | null {
    const label = this.redoLabel;
    return label && this._history.redo() ? label : null;
  }

  clear(): void {
    if (this.canUndo || this.canRedo) this._history.clear();
  }

  private _notify(): void {
    this.dispatchEvent(new Event('change'));
  }

  private _run<T>(operation: () => T): T {
    return this._transactionRunner ? this._transactionRunner(operation) : operation();
  }

  private _adapt(command: EditorCommand): EditorCommand {
    return {
      label: command.label,
      ...(command.estimatedBytes === undefined ? {} : { estimatedBytes: command.estimatedBytes }),
      execute: () => this._run(() => command.execute()),
      undo: () => { this._run(() => command.undo()); },
    };
  }

  dispose(): void {
    this._historySubscription.dispose();
    if (this._ownsHistory) this._history.dispose();
  }
}

function historySnapshotKey(history: EditorHistoryService): string {
  const snapshot = history.snapshot();
  return `${snapshot.canUndo}|${snapshot.canRedo}|${snapshot.undoLabel ?? ''}|${snapshot.redoLabel ?? ''}|${snapshot.estimatedBytes}`;
}

function commandBytes(command: EditorCommand): number {
  const estimate = Number(command.estimatedBytes);
  return Number.isFinite(estimate) && estimate > 0 ? Math.ceil(estimate) : 1024;
}

function serializedBytes(value: unknown): number {
  return JSON.stringify(value).length * 2;
}

export interface VoxelChange extends VoxelPosition {
  before: string | null;
  after: string | null;
  beforeMaterialId?: string | null;
  afterMaterialId?: string | null;
  beforeLayerId?: string | null;
  afterLayerId?: string | null;
}

export function createVoxelPatchCommand(
  document: VoxelDocument,
  moduleId: string | null,
  changes: Iterable<VoxelChange>,
  label: string,
): VoxelPatchCommand | null {
  const compact = Array.from(changes, change => ({ ...change })).filter(change =>
    change.before !== change.after
      || (change.beforeMaterialId ?? null) !== (change.afterMaterialId ?? null)
      || (change.beforeLayerId ?? null) !== (change.afterLayerId ?? null));
  return compact.length > 0 ? new VoxelPatchCommand(document, moduleId, compact, label) : null;
}

export function createReplaceVoxelsCommand(
  document: VoxelDocument,
  removed: Iterable<VoxelPosition>,
  added: Iterable<Voxel>,
  label: string,
): VoxelPatchCommand | null {
  const moduleId = document.editingModuleId;
  const desired = new Map<string, Voxel>();
  const affected = new Map<string, VoxelPosition>();
  for (const position of removed) {
    const key = voxelKey(position.x, position.y, position.z);
    affected.set(key, { x: position.x, y: position.y, z: position.z });
  }
  for (const voxel of added) {
    const position = { x: Math.round(voxel.x), y: Math.round(voxel.y), z: Math.round(voxel.z) };
    if (!document.contains(position.x, position.y, position.z)) {
      throw new Error(`变换结果超出编辑区域：(${position.x}, ${position.y}, ${position.z})。`);
    }
    const key = voxelKey(position.x, position.y, position.z);
    desired.set(key, {
      ...position, color: normalizeColor(voxel.color), materialId: voxel.materialId, layerId: voxel.layerId,
    });
    affected.set(key, position);
  }
  const changes: VoxelChange[] = [];
  for (const [key, position] of affected) {
    const before = document.getTargetVoxel(moduleId, position.x, position.y, position.z)?.color ?? null;
    const existing = document.getTargetVoxel(moduleId, position.x, position.y, position.z);
    const desiredVoxel = desired.get(key);
    if (moduleId === null && existing && !document.isBaseVoxelEditable(existing)) {
      throw new Error('变换涉及隐藏或锁定图层中的体素。');
    }
    if (moduleId === null && desiredVoxel && !document.isBaseVoxelEditable(desiredVoxel)) {
      throw new Error('变换目标图层已隐藏或锁定。');
    }
    changes.push({
      ...position,
      before,
      after: desiredVoxel?.color ?? null,
      beforeMaterialId: existing?.materialId ?? null,
      afterMaterialId: desiredVoxel?.materialId ?? null,
      beforeLayerId: existing?.layerId ?? null,
      afterLayerId: desiredVoxel ? desiredVoxel.layerId ?? null : null,
    });
  }
  return createVoxelPatchCommand(document, moduleId, changes, label);
}

export class VoxelPatchCommand implements EditorCommand {
  readonly label: string;
  readonly estimatedBytes: number;
  private readonly _document: VoxelDocument;
  private readonly _moduleId: string | null;
  private readonly _changes: readonly VoxelChange[];

  constructor(document: VoxelDocument, moduleId: string | null, changes: readonly VoxelChange[], label: string) {
    this._document = document;
    this._moduleId = moduleId;
    this._changes = changes;
    this.label = label;
    this.estimatedBytes = 256 + changes.length * ESTIMATED_VOXEL_HISTORY_BYTES;
  }

  execute(): boolean {
    return this._document.applyVoxelPatch(this._moduleId, this._entries('after'));
  }

  undo(): void {
    this._document.applyVoxelPatch(this._moduleId, this._entries('before'));
  }

  private _entries(side: 'before' | 'after'): VoxelPatchEntry[] {
    return this._changes.map(change => ({
      x: change.x,
      y: change.y,
      z: change.z,
      color: change[side],
      materialId: side === 'before' ? change.beforeMaterialId : change.afterMaterialId,
      layerId: side === 'before' ? change.beforeLayerId : change.afterLayerId,
    }));
  }
}

export class ModuleInstanceTransformCommand implements EditorCommand {
  readonly label: string;
  readonly estimatedBytes = 1024;
  private readonly _document: VoxelDocument;
  private readonly _instanceId: string;
  private readonly _before: VoxelModuleInstance;
  private readonly _after: VoxelModuleInstance;

  constructor(document: VoxelDocument, before: VoxelModuleInstance, after: VoxelModuleInstance, label = '变换模块实例') {
    if (before.id !== after.id) throw new Error('模块实例变换的前后状态不匹配。');
    this._document = document;
    this._instanceId = before.id;
    this._before = cloneInstance(before);
    this._after = cloneInstance(after);
    this.label = label;
  }

  execute(): boolean { return this._apply(this._after); }
  undo(): void { this._apply(this._before); }

  private _apply(state: VoxelModuleInstance): boolean {
    return this._document.updateModuleInstance(this._instanceId, {
      name: state.name,
      position: state.position,
      rotation: state.rotation,
      scale: state.scale,
      layerId: state.layerId,
    });
  }
}

export function createSetVoxelsCommand(
  document: VoxelDocument,
  positions: Iterable<VoxelPosition>,
  color: string,
  label: string,
): { command: VoxelPatchCommand | null; result: BatchVoxelResult } {
  const normalized = normalizeColor(color);
  const selectedMaterial = normalized === document.currentColor
    ? document.getPaletteMaterial(document.currentMaterialId)
    : document.getPaletteMaterial(normalized);
  const moduleId = document.editingModuleId;
  const changes = new Map<string, VoxelChange>();
  let unchanged = 0;
  for (const position of positions) {
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const z = Math.round(position.z);
    const key = voxelKey(x, y, z);
    if (!document.contains(x, y, z) || changes.has(key)) {
      unchanged += 1;
      continue;
    }
    const existing = document.getTargetVoxel(moduleId, x, y, z);
    if (moduleId === null && !document.isBaseVoxelEditable(existing ?? null)) {
      throw new Error('目标体素图层已隐藏或锁定。');
    }
    const materialId = selectedMaterial.id || undefined;
    if (existing?.color === normalized && existing.materialId === materialId) {
      unchanged += 1;
      continue;
    }
    changes.set(key, {
      x, y, z,
      before: existing?.color ?? null,
      after: normalized,
      beforeMaterialId: existing?.materialId ?? null,
      afterMaterialId: materialId ?? null,
      beforeLayerId: existing?.layerId ?? null,
      afterLayerId: moduleId === null
        ? existing ? existing.layerId ?? null : document.activeVoxelLayerId
        : null,
    });
  }
  const values = Array.from(changes.values());
  const added = values.reduce((count, change) => count + (change.before === null ? 1 : 0), 0);
  const painted = values.length - added;
  return {
    command: values.length > 0 ? new VoxelPatchCommand(document, moduleId, values, label) : null,
    result: { added, painted, unchanged },
  };
}

export function createRemoveVoxelCommand(
  document: VoxelDocument,
  position: VoxelPosition,
  label = '擦除方块',
): VoxelPatchCommand | null {
  const moduleId = document.editingModuleId;
  const existing = document.getTargetVoxel(moduleId, position.x, position.y, position.z);
  if (!existing) return null;
  if (moduleId === null && !document.isBaseVoxelEditable(existing)) throw new Error('目标体素图层已隐藏或锁定。');
  return new VoxelPatchCommand(document, moduleId, [{
    x: existing.x,
    y: existing.y,
    z: existing.z,
    before: existing.color,
    after: null,
    beforeMaterialId: existing.materialId ?? null,
    afterMaterialId: null,
    beforeLayerId: existing.layerId ?? null,
    afterLayerId: null,
  }], label);
}

export function createAssignVoxelsLayerCommand(
  document: VoxelDocument,
  positions: Iterable<VoxelPosition>,
  layerId: string,
  label = '移动基础体素到图层',
): VoxelPatchCommand | null {
  const targetLayer = document.getLayer(layerId);
  if (!targetLayer) throw new Error('目标图层不存在。');
  if (targetLayer.locked) throw new Error('目标图层已锁定。');
  const changes: VoxelChange[] = [];
  const visited = new Set<string>();
  for (const position of positions) {
    const key = voxelKey(position.x, position.y, position.z);
    if (visited.has(key)) continue;
    visited.add(key);
    const voxel = document.getTargetVoxel(null, position.x, position.y, position.z);
    if (!voxel || document.voxelLayerId(voxel) === layerId) continue;
    if (!document.isBaseVoxelEditable(voxel)) throw new Error('选择中包含隐藏或锁定图层的体素。');
    changes.push({
      x: voxel.x, y: voxel.y, z: voxel.z,
      before: voxel.color, after: voxel.color,
      beforeMaterialId: voxel.materialId ?? null,
      afterMaterialId: voxel.materialId ?? null,
      beforeLayerId: voxel.layerId ?? null,
      afterLayerId: layerId,
    });
  }
  return createVoxelPatchCommand(document, null, changes, label);
}

export class PaletteMaterialUpdateCommand implements EditorCommand {
  readonly estimatedBytes = 1024;
  private readonly _before: PbrPaletteMaterial;
  private _after: PbrPaletteMaterial | null = null;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _materialId: string,
    private readonly _patch: Partial<Pick<PbrPaletteMaterial, 'name' | 'metallic' | 'roughness'>>,
    readonly label = '修改 PBR 调色板材质',
  ) {
    this._before = _document.getPaletteMaterial(_materialId);
  }

  execute(): boolean {
    if (this._after) {
      this._document.restorePaletteMaterial(this._after);
      return true;
    }
    if (!this._document.updatePaletteMaterial(this._materialId, this._patch)) return false;
    this._after = this._document.getPaletteMaterial(this._materialId);
    return true;
  }

  undo(): void { this._document.restorePaletteMaterial(this._before); }
}

export class PaletteMaterialCreateCommand implements EditorCommand {
  readonly estimatedBytes = 1024;
  private _material: PbrPaletteMaterial | null = null;
  private readonly _previousMaterialId: string;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _color: string,
    private readonly _name: string,
    private readonly _properties: Partial<Pick<PbrPaletteMaterial, 'metallic' | 'roughness'>> = {},
    readonly label = '复制 PBR 调色板材质',
  ) {
    this._previousMaterialId = _document.currentMaterialId;
  }

  get material(): PbrPaletteMaterial | null { return this._material ? { ...this._material } : null; }

  execute(): boolean {
    if (this._material) {
      this._document.restorePaletteMaterial(this._material);
    } else {
      const created = this._document.createPaletteMaterial(this._color, this._name);
      this._document.updatePaletteMaterial(created.id, this._properties);
      this._material = this._document.getPaletteMaterial(created.id);
    }
    this._document.selectPaletteMaterial(this._material.id);
    return true;
  }

  undo(): void {
    if (!this._material) return;
    this._document.selectPaletteMaterial(this._previousMaterialId);
    this._document.removePaletteMaterial(this._material.id);
  }
}

export class PaletteMaterialRemoveCommand implements EditorCommand {
  readonly estimatedBytes = 1024;
  private readonly _material: PbrPaletteMaterial;
  private readonly _previousMaterialId: string;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _materialId: string,
    readonly label = '删除 PBR 调色板材质',
  ) {
    this._material = _document.getPaletteMaterial(_materialId);
    this._previousMaterialId = _document.currentMaterialId;
  }

  execute(): boolean {
    if (!this._document.removePaletteMaterial(this._materialId)) return false;
    return true;
  }

  undo(): void {
    this._document.restorePaletteMaterial(this._material);
    this._document.selectPaletteMaterial(this._previousMaterialId);
  }
}

export class LayerCreateCommand implements EditorCommand {
  readonly estimatedBytes = 1024;
  private _layer: VoxelLayer | null = null;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _name: string,
    readonly label = '新建图层',
  ) {}

  get layer(): VoxelLayer | null { return this._layer ? { ...this._layer } : null; }

  execute(): boolean {
    if (this._layer) this._document.restoreLayer(this._layer);
    else this._layer = this._document.createLayer(this._name);
    return true;
  }

  undo(): void { if (this._layer) this._document.removeLayer(this._layer.id); }
}

export class LayerUpdateCommand implements EditorCommand {
  readonly estimatedBytes = 1024;
  private readonly _before: VoxelLayer;
  private _after: VoxelLayer | null = null;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _layerId: string,
    private readonly _patch: Partial<Pick<VoxelLayer, 'name' | 'visible' | 'locked'>>,
    readonly label: string,
  ) {
    const layer = _document.getLayer(_layerId);
    if (!layer) throw new Error('图层不存在。');
    this._before = layer;
  }

  execute(): boolean {
    if (this._after) {
      this._document.restoreLayer(this._after);
      return true;
    }
    if (!this._document.updateLayer(this._layerId, this._patch)) return false;
    this._after = this._document.getLayer(this._layerId);
    return this._after !== null;
  }

  undo(): void { this._document.restoreLayer(this._before); }
}

export class LayerRemoveCommand implements EditorCommand {
  readonly estimatedBytes: number;
  private readonly _layer: VoxelLayer;
  private readonly _instanceIds: string[];
  private readonly _baseVoxels: Voxel[];

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _layerId: string,
    readonly label = '删除图层',
  ) {
    const layer = _document.getLayer(_layerId);
    if (!layer) throw new Error('图层不存在。');
    this._layer = layer;
    this._instanceIds = [..._document.getModuleInstanceIdsInLayer(_layerId)];
    this._baseVoxels = [..._document.getBaseVoxelsInLayer(_layerId)];
    this.estimatedBytes = 512 + this._instanceIds.length * 64 + serializedBytes(this._baseVoxels);
  }

  execute(): boolean { return this._document.removeLayer(this._layerId); }

  undo(): void {
    this._document.restoreLayer(this._layer);
    for (const instanceId of this._instanceIds) this._document.updateModuleInstance(instanceId, { layerId: this._layerId });
    this._document.applyVoxelPatch(null, this._baseVoxels.map(voxel => ({
      ...voxel, color: voxel.color, materialId: voxel.materialId, layerId: this._layerId,
    })));
  }
}

export class ModuleCreateCommand implements EditorCommand {
  private _module: VoxelModuleData | null = null;
  private _createdMaterials: PbrPaletteMaterial[] = [];
  private readonly _previousEditingModuleId: string | null;
  private _estimatedBytes: number;
  private _initialVoxels: readonly Voxel[] | null;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _name: string,
    private readonly _size: SceneSize,
    voxels: readonly Voxel[] = [],
    private readonly _editAfter = true,
    readonly label = '新建模块',
  ) {
    this._previousEditingModuleId = _document.editingModuleId;
    this._initialVoxels = voxels;
    this._estimatedBytes = 512 + serializedBytes(voxels);
  }

  get module(): VoxelModuleData | null { return this._module ? cloneModule(this._module) : null; }
  get estimatedBytes(): number { return this._estimatedBytes; }

  execute(): boolean {
    if (this._module) {
      for (const material of this._createdMaterials) this._document.restorePaletteMaterial(material);
      this._document.restoreModule(this._module);
    } else {
      const created = this._document.createModule(this._name, this._size);
      const previousMaterialIds = new Set(this._document.paletteMaterials.map(material => material.id));
      if (this._initialVoxels && this._initialVoxels.length > 0) {
        this._document.applyVoxelPatch(created.id, this._initialVoxels);
      }
      this._module = this._document.getModule(created.id);
      this._createdMaterials = this._document.paletteMaterials
        .filter(material => !previousMaterialIds.has(material.id));
      this._estimatedBytes = 512 + serializedBytes(this._module) + serializedBytes(this._createdMaterials);
      this._initialVoxels = null;
    }
    if (!this._module) return false;
    if (this._editAfter) this._document.editModule(this._module.id);
    else this._document.editScene();
    return true;
  }

  undo(): void {
    if (!this._module) return;
    this._document.removeModule(this._module.id);
    for (const material of this._createdMaterials) this._document.removePaletteMaterial(material.id);
    restoreEditingTarget(this._document, this._previousEditingModuleId);
  }
}

export class ModuleRenameCommand implements EditorCommand {
  readonly estimatedBytes = 512;
  private readonly _before: string;
  private _after = '';

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _moduleId: string,
    private readonly _name: string,
    readonly label = '重命名模块',
  ) {
    const module = _document.getModule(_moduleId);
    if (!module) throw new Error('模块不存在。');
    this._before = module.name;
  }

  execute(): boolean {
    if (this._after) return this._document.updateModule(this._moduleId, { name: this._after });
    if (!this._document.updateModule(this._moduleId, { name: this._name })) return false;
    this._after = this._document.getModule(this._moduleId)?.name ?? this._name;
    return true;
  }

  undo(): void { this._document.updateModule(this._moduleId, { name: this._before }); }
}

export class ModuleRemoveCommand implements EditorCommand {
  readonly estimatedBytes: number;
  private readonly _module: VoxelModuleData;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _moduleId: string,
    readonly label = '删除未使用模块',
  ) {
    const module = _document.getModule(_moduleId);
    if (!module) throw new Error('模块不存在。');
    if (_document.isModuleUsed(_moduleId)) throw new Error('模块仍被场景实例或动画关键帧使用，无法删除。');
    this._module = module;
    this.estimatedBytes = 512 + serializedBytes(module);
  }

  execute(): boolean { return this._document.removeModule(this._moduleId); }
  undo(): void { this._document.restoreModule(this._module); }
}

export class ModuleInstanceCreateCommand implements EditorCommand {
  readonly estimatedBytes = 1024;
  private _instance: VoxelModuleInstance | null = null;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _moduleId: string,
    private readonly _position: VoxelPosition,
    private readonly _layerId: string,
    readonly label = '粘贴模块实例',
  ) {}

  get instance(): VoxelModuleInstance | null { return this._instance ? cloneInstance(this._instance) : null; }

  execute(): boolean {
    if (this._instance) this._document.restoreModuleInstance(this._instance);
    else this._instance = this._document.addModuleInstance(this._moduleId, this._position, this._layerId);
    return true;
  }

  undo(): void { if (this._instance) this._document.removeModuleInstance(this._instance.id); }
}

interface StoredAnimationKeyframe {
  animationId: string;
  instanceId: string;
  keyframe: VoxelAnimationKeyframe;
}

export class ModuleInstanceRemoveCommand implements EditorCommand {
  readonly estimatedBytes: number;
  private readonly _instance: VoxelModuleInstance;
  private readonly _keyframes: StoredAnimationKeyframe[];

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _instanceId: string,
    readonly label = '删除模块实例',
  ) {
    const instance = _document.getModuleInstance(_instanceId);
    if (!instance) throw new Error('模块实例不存在。');
    this._instance = instance;
    this._keyframes = _document.getAnimationKeyframesForInstance(_instanceId).map(entry => ({
      animationId: entry.animationId,
      instanceId: _instanceId,
      keyframe: entry.keyframe,
    }));
    this.estimatedBytes = 1024 + serializedBytes(this._keyframes);
  }

  execute(): boolean { return this._document.removeModuleInstance(this._instanceId); }

  undo(): void {
    this._document.restoreModuleInstance(this._instance);
    for (const entry of this._keyframes) {
      this._document.applyAnimationKeyframeSnapshot(
        entry.animationId,
        entry.instanceId,
        entry.keyframe.frame,
        entry.keyframe,
      );
    }
  }
}

export class AnimationCreateCommand implements EditorCommand {
  private _clip: VoxelAnimationClip | null = null;
  private readonly _previousAnimationId: string | null;
  private readonly _previousFrame: number;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _name: string,
    private readonly _frameCount = 12,
    private readonly _fps = 12,
    readonly label = '新建动画',
  ) {
    this._previousAnimationId = _document.activeAnimationId;
    this._previousFrame = _document.animationFrame;
  }

  get estimatedBytes(): number { return 512 + (this._clip ? serializedBytes(this._clip) : 0); }
  get clip(): VoxelAnimationClip | null { return this._clip ? cloneAnimation(this._clip) : null; }

  execute(): boolean {
    if (this._clip) {
      this._document.restoreAnimation(this._clip);
      this._document.setActiveAnimation(this._clip.id);
    } else {
      this._clip = this._document.createAnimation(this._name, this._frameCount, this._fps);
    }
    return true;
  }

  undo(): void {
    if (!this._clip) return;
    this._document.removeAnimation(this._clip.id);
    restoreAnimationCursor(this._document, this._previousAnimationId, this._previousFrame);
  }
}

export class AnimationDuplicateCommand implements EditorCommand {
  private _clip: VoxelAnimationClip | null = null;
  private readonly _previousAnimationId: string | null;
  private readonly _previousFrame: number;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _sourceAnimationId: string,
    private readonly _name = '',
    readonly label = '复制动画片段',
  ) {
    if (!_document.getAnimation(_sourceAnimationId)) throw new Error('动画不存在。');
    this._previousAnimationId = _document.activeAnimationId;
    this._previousFrame = _document.animationFrame;
  }

  get estimatedBytes(): number { return 512 + (this._clip ? serializedBytes(this._clip) : 0); }
  get clip(): VoxelAnimationClip | null { return this._clip ? cloneAnimation(this._clip) : null; }

  execute(): boolean {
    if (this._clip) {
      this._document.restoreAnimation(this._clip);
      this._document.setActiveAnimation(this._clip.id);
    } else this._clip = this._document.duplicateAnimation(this._sourceAnimationId, this._name);
    return true;
  }

  undo(): void {
    if (!this._clip) return;
    this._document.removeAnimation(this._clip.id);
    restoreAnimationCursor(this._document, this._previousAnimationId, this._previousFrame);
  }
}

export class AnimationRemoveCommand implements EditorCommand {
  readonly estimatedBytes: number;
  private readonly _clip: VoxelAnimationClip;
  private readonly _previousAnimationId: string | null;
  private readonly _previousFrame: number;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _animationId: string,
    readonly label = '删除动画',
  ) {
    const clip = _document.getAnimation(_animationId);
    if (!clip) throw new Error('动画不存在。');
    this._clip = clip;
    this._previousAnimationId = _document.activeAnimationId;
    this._previousFrame = _document.animationFrame;
    this.estimatedBytes = 512 + serializedBytes(this._clip);
  }

  execute(): boolean {
    if (!this._document.removeAnimation(this._animationId)) return false;
    return true;
  }

  undo(): void {
    this._document.restoreAnimation(this._clip);
    restoreAnimationCursor(this._document, this._previousAnimationId, this._previousFrame);
  }
}

export class AnimationUpdateCommand implements EditorCommand {
  private readonly _before: VoxelAnimationClip;
  private _after: VoxelAnimationClip | null = null;
  private readonly _beforeFrame: number;
  private _afterFrame = 0;
  private _estimatedBytes: number;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _animationId: string,
    private readonly _patch: Partial<Pick<
      VoxelAnimationClip,
      'name' | 'fps' | 'frameCount' | 'loop' | 'playbackStart' | 'playbackEnd'
    >>,
    readonly label = '修改动画设置',
  ) {
    const clip = _document.getAnimation(_animationId);
    if (!clip) throw new Error('动画不存在。');
    this._before = clip;
    this._beforeFrame = _document.animationFrame;
    this._estimatedBytes = 512 + serializedBytes(this._before);
  }

  get estimatedBytes(): number { return this._estimatedBytes; }

  execute(): boolean {
    if (this._after) {
      this._document.restoreAnimation(this._after);
      if (this._document.activeAnimationId === this._animationId) this._document.setAnimationFrame(this._afterFrame);
      return true;
    }
    if (!this._document.updateAnimation(this._animationId, this._patch)) return false;
    this._after = this._document.getAnimation(this._animationId);
    this._afterFrame = this._document.animationFrame;
    this._estimatedBytes += serializedBytes(this._after);
    return this._after !== null;
  }

  undo(): void {
    this._document.restoreAnimation(this._before);
    if (this._document.activeAnimationId === this._animationId) this._document.setAnimationFrame(this._beforeFrame);
  }
}

type AnimationKeyframeState = Readonly<Pick<
  VoxelModuleInstance,
  'moduleId' | 'position' | 'rotation' | 'scale' | 'visible'
>>;

export class AnimationKeyframeCommand implements EditorCommand {
  readonly estimatedBytes = 1536;
  private readonly _before: VoxelAnimationKeyframe | null;
  private _after: VoxelAnimationKeyframe | null = null;
  private _hasAfter = false;

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _animationId: string,
    private readonly _instanceId: string,
    private readonly _frame: number,
    private readonly _state: AnimationKeyframeState | null,
    readonly label = '记录动画关键帧',
    options?: { before?: VoxelAnimationKeyframe | null; alreadyApplied?: boolean },
  ) {
    this._before = options && Object.hasOwn(options, 'before')
      ? cloneKeyframe(options.before ?? null)
      : _document.getAnimationKeyframe(_animationId, _instanceId, _frame);
    if (options?.alreadyApplied) {
      this._after = _document.getAnimationKeyframe(_animationId, _instanceId, _frame);
      this._hasAfter = true;
    }
  }

  execute(): boolean {
    if (this._hasAfter) return this._apply(this._after);
    const changed = this._state
      ? this._document.setAnimationKeyframe(this._animationId, this._instanceId, this._frame, this._state)
      : this._document.removeAnimationKeyframe(this._animationId, this._instanceId, this._frame);
    if (!changed) return false;
    this._after = this._document.getAnimationKeyframe(this._animationId, this._instanceId, this._frame);
    this._hasAfter = true;
    return true;
  }

  undo(): void { this._apply(this._before); }

  private _apply(keyframe: VoxelAnimationKeyframe | null): boolean {
    return this._document.applyAnimationKeyframeSnapshot(
      this._animationId,
      this._instanceId,
      this._frame,
      keyframe,
    );
  }
}

export interface AnimationKeyframeClipboardEntry {
  instanceId: string;
  relativeFrame: number;
  keyframe: VoxelAnimationKeyframe;
}

export interface AnimationKeyframeChange extends AnimationKeyframeRef {
  before: VoxelAnimationKeyframe | null;
  after: VoxelAnimationKeyframe | null;
}

export class AnimationKeyframesBatchCommand implements EditorCommand {
  readonly estimatedBytes: number;
  private readonly _changes: AnimationKeyframeChange[];

  constructor(
    private readonly _document: VoxelDocument,
    private readonly _animationId: string,
    changes: Iterable<Readonly<AnimationKeyframeChange>>,
    readonly label = '批量修改动画关键帧',
  ) {
    this._changes = Array.from(changes, change => ({
      instanceId: change.instanceId,
      frame: change.frame,
      before: cloneKeyframe(change.before),
      after: cloneKeyframe(change.after),
    })).filter(change => !sameKeyframe(change.before, change.after));
    this.estimatedBytes = 512 + serializedBytes(this._changes);
  }

  execute(): boolean { return this._apply('after'); }
  undo(): void { this._apply('before'); }

  private _apply(side: 'before' | 'after'): boolean {
    return this._document.applyAnimationKeyframeSnapshots(
      this._animationId,
      this._changes.map(change => ({
        instanceId: change.instanceId,
        frame: change.frame,
        keyframe: change[side],
      } satisfies AnimationKeyframeSnapshot)),
    );
  }
}

export function createDeleteAnimationKeyframesCommand(
  document: VoxelDocument,
  animationId: string,
  refs: Iterable<Readonly<AnimationKeyframeRef>>,
): AnimationKeyframesBatchCommand | null {
  const changes = uniqueAnimationRefs(refs).flatMap(ref => {
    const before = document.getAnimationKeyframe(animationId, ref.instanceId, ref.frame);
    return before ? [{ ...ref, before, after: null }] : [];
  });
  return changes.length > 0
    ? new AnimationKeyframesBatchCommand(document, animationId, changes, '删除选中关键帧')
    : null;
}

export function createMoveAnimationKeyframesCommand(
  document: VoxelDocument,
  animationId: string,
  refs: Iterable<Readonly<AnimationKeyframeRef>>,
  delta: number,
  duplicate = false,
): AnimationKeyframesBatchCommand | null {
  const clip = document.getAnimation(animationId);
  if (!clip) throw new Error('动画不存在。');
  const offset = Math.round(delta);
  if (offset === 0) return null;
  const selected = uniqueAnimationRefs(refs).map(ref => {
    const keyframe = document.getAnimationKeyframe(animationId, ref.instanceId, ref.frame);
    if (!keyframe) throw new Error('选中的关键帧已不存在。');
    const targetFrame = ref.frame + offset;
    if (targetFrame < 0 || targetFrame >= clip.frameCount) throw new Error('关键帧移动后超出动画范围。');
    return { ...ref, targetFrame, keyframe };
  });
  if (selected.length === 0) return null;
  const affected = new Map<string, AnimationKeyframeChange>();
  const ensure = (instanceId: string, frame: number): AnimationKeyframeChange => {
    const key = animationRefKey(instanceId, frame);
    let change = affected.get(key);
    if (!change) {
      const before = document.getAnimationKeyframe(animationId, instanceId, frame);
      change = { instanceId, frame, before, after: cloneKeyframe(before) };
      affected.set(key, change);
    }
    return change;
  };
  if (!duplicate) for (const item of selected) ensure(item.instanceId, item.frame).after = null;
  for (const item of selected) {
    ensure(item.instanceId, item.targetFrame).after = { ...cloneKeyframe(item.keyframe)!, frame: item.targetFrame };
  }
  return new AnimationKeyframesBatchCommand(
    document,
    animationId,
    affected.values(),
    duplicate ? '复制拖动关键帧' : '移动关键帧',
  );
}

export function createPasteAnimationKeyframesCommand(
  document: VoxelDocument,
  animationId: string,
  entries: Iterable<Readonly<AnimationKeyframeClipboardEntry>>,
  startFrame: number,
): AnimationKeyframesBatchCommand | null {
  const clip = document.getAnimation(animationId);
  if (!clip) throw new Error('动画不存在。');
  const changes = new Map<string, AnimationKeyframeChange>();
  for (const entry of entries) {
    const frame = Math.round(startFrame + entry.relativeFrame);
    if (frame < 0 || frame >= clip.frameCount) throw new Error('粘贴后的关键帧超出动画范围。');
    if (!document.getModuleInstance(entry.instanceId)) continue;
    const before = document.getAnimationKeyframe(animationId, entry.instanceId, frame);
    changes.set(animationRefKey(entry.instanceId, frame), {
      instanceId: entry.instanceId,
      frame,
      before,
      after: { ...cloneKeyframe(entry.keyframe)!, frame },
    });
  }
  return changes.size > 0
    ? new AnimationKeyframesBatchCommand(document, animationId, changes.values(), '粘贴关键帧')
    : null;
}

export class SceneResizeCommand implements EditorCommand {
  private readonly _before: SceneSize;
  private readonly _after: SceneSize;
  private readonly _removed: Voxel[];

  constructor(
    private readonly _document: VoxelDocument,
    size: SceneSize,
    readonly label = '调整场景尺寸',
  ) {
    this._before = { ..._document.size };
    this._after = normalizeSceneSize(size);
    this._removed = [];
    for (const voxel of _document.voxels.values()) {
      if (voxel.x >= this._after.x || voxel.y >= this._after.y || voxel.z >= this._after.z) {
        this._removed.push({ ...voxel });
      }
    }
  }

  get removedCount(): number { return this._removed.length; }
  get estimatedBytes(): number { return 512 + this._removed.length * ESTIMATED_VOXEL_HISTORY_BYTES; }

  execute(): boolean {
    if (sameSize(this._before, this._after)) return false;
    this._document.setSize(this._after);
    return true;
  }

  undo(): void {
    this._document.setSize(this._before);
    if (this._removed.length > 0) this._document.applyVoxelPatch(null, this._removed);
  }
}

export class SceneBackgroundColorCommand implements EditorCommand {
  readonly estimatedBytes = 256;
  private readonly _before: string;
  private readonly _after: string;

  constructor(
    private readonly _document: VoxelDocument,
    color: string,
    readonly label = '修改场景背景色',
  ) {
    this._before = _document.sceneBackgroundColor;
    this._after = normalizeColor(color);
  }

  execute(): boolean { return this._document.setSceneBackgroundColor(this._after); }
  undo(): void { this._document.setSceneBackgroundColor(this._before); }
}

export class ClearDocumentCommand implements EditorCommand {
  readonly estimatedBytes: number;
  private readonly _moduleId: string | null;
  private readonly _voxels: Voxel[];
  private readonly _instances: VoxelModuleInstance[];
  private readonly _keyframes: StoredAnimationKeyframe[];

  constructor(
    private readonly _document: VoxelDocument,
    readonly label: string,
  ) {
    this._moduleId = _document.editingModuleId;
    this._voxels = this._moduleId
      ? _document.getModule(this._moduleId)?.voxels.map(voxel => ({ ...voxel })) ?? []
      : Array.from(_document.voxels.values(), voxel => ({ ...voxel }));
    this._instances = this._moduleId ? [] : _document.moduleInstances.map(cloneInstance);
    this._keyframes = this._moduleId ? [] : [..._document.getAllAnimationKeyframes()];
    this.estimatedBytes = 512
      + this._voxels.length * ESTIMATED_VOXEL_HISTORY_BYTES
      + serializedBytes(this._instances)
      + serializedBytes(this._keyframes);
  }

  execute(): boolean { return this._document.clear(); }

  undo(): void {
    if (this._voxels.length > 0) this._document.applyVoxelPatch(this._moduleId, this._voxels);
    for (const instance of this._instances) this._document.restoreModuleInstance(instance);
    for (const entry of this._keyframes) {
      this._document.applyAnimationKeyframeSnapshot(
        entry.animationId,
        entry.instanceId,
        entry.keyframe.frame,
        entry.keyframe,
      );
    }
  }
}

interface DocumentSnapshot {
  project: VoxelProject;
  editingModuleId: string | null;
}

export class DocumentSnapshotCommand implements EditorCommand {
  readonly label: string;
  private readonly _document: VoxelDocument;
  private readonly _mutate: () => boolean;
  private readonly _before: DocumentSnapshot;
  private _after: DocumentSnapshot | null = null;
  private _estimatedBytes: number;

  get estimatedBytes(): number { return this._estimatedBytes; }

  constructor(document: VoxelDocument, label: string, mutate: () => boolean) {
    this._document = document;
    this.label = label;
    this._mutate = mutate;
    this._before = captureDocument(document);
    this._estimatedBytes = serializedBytes(this._before);
  }

  execute(): boolean {
    if (this._after) {
      restoreDocument(this._document, this._after);
      return true;
    }
    if (!this._mutate()) return false;
    this._after = captureDocument(this._document);
    this._estimatedBytes += serializedBytes(this._after);
    return true;
  }

  undo(): void {
    restoreDocument(this._document, this._before);
  }
}

function captureDocument(document: VoxelDocument): DocumentSnapshot {
  return { project: document.toJSON(), editingModuleId: document.editingModuleId };
}

function restoreDocument(document: VoxelDocument, snapshot: DocumentSnapshot): void {
  document.load(snapshot.project);
  if (snapshot.editingModuleId) document.editModule(snapshot.editingModuleId);
}

function restoreEditingTarget(document: VoxelDocument, moduleId: string | null): void {
  if (moduleId && document.getModule(moduleId)) document.editModule(moduleId);
  else document.editScene();
}

function restoreAnimationCursor(document: VoxelDocument, animationId: string | null, frame: number): void {
  document.setActiveAnimation(animationId);
  document.setAnimationFrame(frame);
}
