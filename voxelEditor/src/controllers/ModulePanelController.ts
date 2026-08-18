import { GETree, type GETreeNodeData, type GETreeSelectionChangeDetail } from '@haiyue/ui';
import {
  AnimationKeyframeCommand,
  LayerCreateCommand,
  LayerRemoveCommand,
  LayerUpdateCommand,
  createAssignVoxelsLayerCommand,
  ModuleCreateCommand,
  ModuleInstanceCreateCommand,
  ModuleInstanceRemoveCommand,
  ModuleInstanceTransformCommand,
  ModuleRemoveCommand,
  ModuleRenameCommand,
  type CommandHistory,
} from '../commands';
import { DEFAULT_LAYER_ID, type ModuleSummary, type Voxel, type VoxelDocument, type VoxelModuleData, type VoxelModuleInstance } from '../model';
import { moduleThumbnailPoints } from '../moduleThumbnail';
import { getEditorLocale, translate } from '../localization';
import type { ModuleGizmoMode, VoxelRenderer } from '../VoxelRenderer';

type Notify = (message: string, error?: boolean) => void;

export interface ModulePanelControllerOptions {
  document: VoxelDocument;
  history: CommandHistory;
  notify: Notify;
  getRenderer(): VoxelRenderer | null;
  requestRenderRefresh(): void;
  resetCamera(): void;
  onSelectionChange(): void;
  getSelectedBaseVoxels(): readonly Voxel[];
}

/** Owns module/library/layer selection and the module instance property panel. */
export class ModulePanelController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _notify: Notify;
  private readonly _getRenderer: () => VoxelRenderer | null;
  private readonly _requestRenderRefresh: () => void;
  private readonly _resetCamera: () => void;
  private readonly _onSelectionChange: () => void;
  private readonly _getSelectedBaseVoxels: () => readonly Voxel[];
  private readonly _moduleLibrary = element<HTMLSelectElement>('module-library');
  private readonly _moduleSearch = element<HTMLInputElement>('module-search');
  private readonly _moduleSort = element<HTMLSelectElement>('module-sort');
  private readonly _moduleAssets = element<HTMLElement>('module-assets');
  private readonly _layerLibrary = element<HTMLSelectElement>('layer-library');
  private readonly _gizmoModeInput = element<HTMLSelectElement>('gizmo-mode');
  private readonly _tree = element<GETree>('module-tree');
  private readonly _editContext = element<HTMLElement>('edit-context');
  private _copiedModuleId: string | null = null;
  private _selectedInstanceId: string | null = null;
  private _activeLayerId = DEFAULT_LAYER_ID;
  private _gizmoMode: ModuleGizmoMode = 'move';
  private _highlightedCollisionInstanceId: string | null = null;
  private _moduleAssetsSignature = '';

  constructor(options: ModulePanelControllerOptions) {
    defineModuleTreeNode();
    this._document = options.document;
    this._history = options.history;
    this._notify = options.notify;
    this._getRenderer = options.getRenderer;
    this._requestRenderRefresh = options.requestRenderRefresh;
    this._resetCamera = options.resetCamera;
    this._onSelectionChange = options.onSelectionChange;
    this._getSelectedBaseVoxels = options.getSelectedBaseVoxels;
    this._bind();
  }

  get selectedInstanceId(): string | null { return this._selectedInstanceId; }
  get activeLayerId(): string { return this._activeLayerId; }
  get gizmoMode(): ModuleGizmoMode { return this._gizmoMode; }

  setCopiedModuleId(moduleId: string): void { this._copiedModuleId = moduleId; }

  selectInstance(instanceId: string): boolean {
    const instance = this._document.getModuleInstance(instanceId);
    if (!instance) return false;
    this._selectedInstanceId = instance.id;
    this._activeLayerId = instance.layerId;
    this.sync();
    this._onSelectionChange();
    return true;
  }

  editableSelectedInstance(): VoxelModuleInstance {
    const instance = this._selectedInstanceId
      ? this._document.getEvaluatedModuleInstance(this._selectedInstanceId)
      : null;
    if (!instance) throw new Error('请先在场景模块树中选择一个实例。');
    const layer = this._document.getLayer(instance.layerId);
    if (layer?.locked) throw new Error(`图层“${layer.name}”已锁定。`);
    if (layer?.visible === false) throw new Error(`图层“${layer.name}”当前不可见。`);
    return instance;
  }

  executeInstanceTransform(after: VoxelModuleInstance, label: string): void {
    const before = this.editableSelectedInstance();
    const animationId = this._document.activeAnimationId;
    const changed = animationId
      ? this._history.execute(new AnimationKeyframeCommand(
        this._document, animationId, before.id, this._document.animationFrame, after, `${label}关键帧`,
      ))
      : this._history.execute(new ModuleInstanceTransformCommand(this._document, before, after, label));
    if (!changed) { this._notify('实例变换没有产生变化。'); return; }
    this._notify(animationId ? `${label}已记录到第 ${this._document.animationFrame + 1} 帧。` : `${label}完成。`);
  }

  sync(queueRender = true): boolean {
    let auxiliaryRenderChanged = false;
    const modules = this._document.moduleSummaries;
    const instances = this._document.evaluatedModuleInstances;
    const layers = this._document.layers;
    if (this._copiedModuleId && !modules.some(module => module.id === this._copiedModuleId)) this._copiedModuleId = null;
    const preferredId = this._document.editingModuleId ?? this._copiedModuleId ?? this._moduleLibrary.value ?? modules[0]?.id;
    const sortedModules = this._sortedModules(modules);
    this._moduleLibrary.replaceChildren();
    if (modules.length === 0) this._moduleLibrary.add(new Option(translate('module.empty'), ''));
    else {
      for (const module of sortedModules) this._moduleLibrary.add(new Option(translate('module.summary', {
        name: module.name,
        count: module.voxelCount,
      }), module.id));
      this._moduleLibrary.value = modules.some(module => module.id === preferredId) ? preferredId! : sortedModules[0]!.id;
    }
    const editingModule = this._document.editingModuleId
      ? modules.find(module => module.id === this._document.editingModuleId) ?? null
      : null;
    this._editContext.textContent = editingModule
      ? translate('module.editing', { name: editingModule.name })
      : translate('module.scene');
    if (!layers.some(layer => layer.id === this._activeLayerId)) this._activeLayerId = DEFAULT_LAYER_ID;
    this._document.setActiveVoxelLayer(this._activeLayerId);
    this._layerLibrary.replaceChildren(...layers.map(layer => new Option(layer.name, layer.id)));
    this._layerLibrary.value = this._activeLayerId;
    const activeLayer = this._document.getLayer(this._activeLayerId);
    const visibility = element<HTMLButtonElement>('toggle-layer-visibility');
    const lock = element<HTMLButtonElement>('toggle-layer-lock');
    visibility.textContent = translate(activeLayer?.visible === false ? 'module.showLayer' : 'layer.hide');
    visibility.setAttribute('aria-pressed', String(activeLayer?.visible === false));
    lock.textContent = translate(activeLayer?.locked ? 'module.unlockLayer' : 'layer.lock');
    lock.setAttribute('aria-pressed', String(activeLayer?.locked === true));
    this._tree.data = [{
      id: 'scene-modules',
      label: translate('module.sceneLayers', { count: layers.length }),
      expanded: true,
      children: layers.map(layer => this._layerNode(layer.id, modules, instances)),
    }];

    const selected = this._selectedInstanceId
      ? instances.find(instance => instance.id === this._selectedInstanceId) ?? null
      : null;
    if (selected) {
      this._tree.selectedId = `instance:${selected.id}`;
      if (modules.some(module => module.id === selected.moduleId)) this._moduleLibrary.value = selected.moduleId;
      setVectorInputs('module-pos', selected.position);
      setVectorInputs('module-rot', { x: selected.rotation.x * 90, y: selected.rotation.y * 90, z: selected.rotation.z * 90 });
      setVectorInputs('module-scale', selected.scale);
    } else {
      this._selectedInstanceId = null;
      this._tree.selectedId = null;
    }
    this._renderModuleAssets(sortedModules);
    this._gizmoModeInput.value = this._gizmoMode;
    const selectedLayer = selected ? this._document.getLayer(selected.layerId) : null;
    const instanceVisibility = element<HTMLButtonElement>('toggle-instance-visibility');
    instanceVisibility.textContent = translate(selected?.visible === false ? 'module.showSelected' : 'module.hideSelected');
    instanceVisibility.disabled = !selected || selectedLayer?.locked === true;
    element<HTMLButtonElement>('apply-instance-transform').disabled = !selected || selectedLayer?.locked === true || selectedLayer?.visible === false;
    element<HTMLButtonElement>('remove-module-instance').disabled = !selected || selectedLayer?.locked === true;
    element<HTMLButtonElement>('remove-layer').disabled = this._activeLayerId === DEFAULT_LAYER_ID;
    element<HTMLButtonElement>('assign-selection-layer').disabled = this._document.isEditingModule
      || this._getSelectedBaseVoxels().length === 0 || activeLayer?.locked === true || activeLayer?.visible === false;
    const selectedModuleId = this._moduleLibrary.value;
    const selectedModule = modules.find(module => module.id === selectedModuleId) ?? null;
    element<HTMLButtonElement>('rename-module').disabled = !selectedModule;
    element<HTMLButtonElement>('duplicate-module').disabled = !selectedModule;
    element<HTMLButtonElement>('remove-unused-module').disabled = !selectedModule || this._document.isModuleUsed(selectedModule.id);
    element<HTMLButtonElement>('locate-module-instances').disabled = !selectedModule
      || selectedModule.instanceCount === 0;
    const collisions = selected ? this._document.getModuleInstanceCollisions(selected.id) : [];
    const details = element<HTMLElement>('module-conflict-details');
    details.classList.toggle('conflict', collisions.length > 0);
    details.textContent = collisions.length === 0
      ? translate('module.noConflict')
      : `${translate('module.collisionSummary', { count: collisions.length })}\n${collisions.slice(0, 24).map(position => `(${position.x}, ${position.y}, ${position.z})`).join('  ')}${collisions.length > 24 ? '\n…' : ''}`;
    element<HTMLButtonElement>('highlight-module-conflicts').disabled = collisions.length === 0;
    if (this._highlightedCollisionInstanceId && this._highlightedCollisionInstanceId !== selected?.id) {
      this._highlightedCollisionInstanceId = null;
      auxiliaryRenderChanged = this._getRenderer()?.setConflictHighlights([]) ?? false;
    } else if (this._highlightedCollisionInstanceId === selected?.id) {
      auxiliaryRenderChanged = this._getRenderer()?.setConflictHighlights(collisions) ?? false;
      if (collisions.length === 0) this._highlightedCollisionInstanceId = null;
    }
    const renderChanged = (this._getRenderer()?.setModuleInstanceGizmo(
      selected && selected.visible !== false && selectedLayer?.visible !== false && !selectedLayer?.locked ? selected.id : null,
      this._gizmoMode,
    ) ?? false) || auxiliaryRenderChanged;
    if (renderChanged && queueRender) this._requestRenderRefresh();
    return renderChanged;
  }

  /** Animation playback only changes evaluated instance properties, not the asset tree. */
  syncAnimationFrame(): boolean {
    const selected = this._selectedInstanceId
      ? this._document.getEvaluatedModuleInstance(this._selectedInstanceId)
      : null;
    if (!selected) return false;
    setVectorInputs('module-pos', selected.position);
    setVectorInputs('module-rot', {
      x: selected.rotation.x * 90, y: selected.rotation.y * 90, z: selected.rotation.z * 90,
    });
    setVectorInputs('module-scale', selected.scale);
    return false;
  }

  private _layerNode(
    layerId: string,
    modules: readonly ModuleSummary[],
    allInstances: readonly VoxelModuleInstance[],
  ): GETreeNodeData {
    const layer = this._document.getLayer(layerId)!;
    const instances = allInstances.filter(instance => instance.layerId === layer.id);
    const moduleChildren = modules.flatMap(module => {
      const matching = instances.filter(instance => instance.moduleId === module.id);
      if (matching.length === 0) return [];
      const instanceNodes = matching.map(instance => {
        const conflictCount = this._document.getModuleInstanceCollisions(instance.id).length;
        return {
          id: `instance:${instance.id}`,
          label: `${instance.visible === false ? '○ ' : ''}${instance.name} @ (${instance.position.x}, ${instance.position.y}, ${instance.position.z})${conflictCount > 0 ? ` · ⚠ ${conflictCount}` : ''}`,
          renderer: 'voxel-module-tree-node',
          conflict: conflictCount > 0,
          visible: layer.visible && instance.visible !== false,
          locked: layer.locked,
        } satisfies GETreeNodeData;
      });
      return [{
        id: `module:${layer.id}:${module.id}`,
        label: `${module.name} (${matching.length})`,
        expanded: true,
        renderer: 'voxel-module-tree-node',
        conflict: instanceNodes.some(node => node.conflict === true),
        visible: layer.visible,
        locked: layer.locked,
        children: instanceNodes,
      } satisfies GETreeNodeData];
    });
    const baseVoxelCount = this._document.getBaseVoxelCountInLayer(layer.id);
    const children: GETreeNodeData[] = [
      {
        id: `base:${layer.id}`,
        label: translate('module.baseVoxels', { count: baseVoxelCount }),
        renderer: 'voxel-module-tree-node',
        visible: layer.visible,
        locked: layer.locked,
      },
      ...moduleChildren,
    ];
    return {
      id: `layer:${layer.id}`,
      label: `${layer.visible ? '◉' : '○'} ${translate('module.layerSummary', {
        name: layer.name,
        voxels: baseVoxelCount,
        instances: instances.length,
      })}`,
      expanded: true,
      renderer: 'voxel-module-tree-node',
      visible: layer.visible,
      locked: layer.locked,
      conflict: children.some(node => node.conflict === true),
      children,
    };
  }

  private _bind(): void {
    this._moduleLibrary.addEventListener('change', () => {
      if (this._moduleLibrary.value) this._copiedModuleId = this._moduleLibrary.value;
      this.sync();
    });
    this._moduleSearch.addEventListener('input', () => this._renderModuleAssets(this._sortedModules(this._document.moduleSummaries)));
    this._moduleSort.addEventListener('change', () => this.sync());
    this._layerLibrary.addEventListener('change', () => {
      this._activeLayerId = this._layerLibrary.value || DEFAULT_LAYER_ID;
      this._document.setActiveVoxelLayer(this._activeLayerId);
      this.sync();
    });
    this._gizmoModeInput.addEventListener('change', () => { this._gizmoMode = this._gizmoModeInput.value as ModuleGizmoMode; this.sync(); });
    element('new-layer').addEventListener('click', () => this._run(() => {
      const name = window.prompt('图层名称', `图层 ${this._document.layers.length + 1}`);
      if (name === null) return;
      const command = new LayerCreateCommand(this._document, name);
      this._history.execute(command);
      this._activeLayerId = command.layer?.id ?? DEFAULT_LAYER_ID;
    }));
    element('rename-layer').addEventListener('click', () => this._run(() => {
      const layer = this._document.getLayer(this._activeLayerId);
      if (!layer) return;
      const name = window.prompt('重命名图层', layer.name);
      if (name !== null) this._history.execute(new LayerUpdateCommand(this._document, layer.id, { name }, '重命名图层'));
    }));
    element('remove-layer').addEventListener('click', () => this._run(() => {
      if (this._activeLayerId === DEFAULT_LAYER_ID) throw new Error('默认图层不能删除。');
      if (this._history.execute(new LayerRemoveCommand(this._document, this._activeLayerId))) {
        this._activeLayerId = DEFAULT_LAYER_ID;
        this._document.setActiveVoxelLayer(DEFAULT_LAYER_ID);
        this._notify('图层已删除，其中的基础体素和实例已移至默认图层。');
      }
    }));
    element('toggle-layer-visibility').addEventListener('click', () => this._updateLayerFlag('visible'));
    element('toggle-layer-lock').addEventListener('click', () => this._updateLayerFlag('locked'));
    element('assign-selection-layer').addEventListener('click', () => this._run(() => this._assignSelectionLayer()));
    element('apply-instance-transform').addEventListener('click', () => this._run(() => this._applyTransformInputs()));
    element('toggle-instance-visibility').addEventListener('click', () => this._run(() => {
      const instance = this.editableSelectedInstance();
      const visible = instance.visible === false;
      this.executeInstanceTransform({ ...instance, visible }, visible ? '显示模块实例' : '隐藏模块实例');
    }));
    element('new-module').addEventListener('click', () => this._run(() => this._newModule()));
    element('rename-module').addEventListener('click', () => this._run(() => this._renameModule()));
    element('duplicate-module').addEventListener('click', () => this._run(() => this._duplicateModuleDefinition()));
    element('remove-unused-module').addEventListener('click', () => this._run(() => this._removeUnusedModule()));
    element('locate-module-instances').addEventListener('click', () => this._run(() => this._locateModuleInstances()));
    element('edit-module').addEventListener('click', () => this._run(() => {
      if (!this._moduleLibrary.value || !this._document.editModule(this._moduleLibrary.value)) throw new Error('请先新建或选择一个模块。');
      this._resetCamera();
      this._notify('已进入模块编辑模式；修改会同步到场景中的所有实例。');
    }));
    element('edit-scene').addEventListener('click', () => { this._document.editScene(); this._resetCamera(); this._notify('已返回主场景。'); });
    element('copy-module').addEventListener('click', () => this._run(() => this._copyModule()));
    element('paste-module').addEventListener('click', () => this._run(() => this._pasteModule()));
    element('remove-module-instance').addEventListener('click', () => this._run(() => this._removeInstance()));
    element('highlight-module-conflicts').addEventListener('click', () => this._run(() => this._highlightConflicts()));
    this._tree.addEventListener('selection-change', event => this._treeSelection(event));
    this._tree.addEventListener('data-change', () => this.sync());
  }

  private _applyTransformInputs(): void {
    const before = this.editableSelectedInstance();
    const targetLayer = this._document.getLayer(this._activeLayerId);
    if (!targetLayer) throw new Error('目标图层不存在。');
    if (targetLayer.locked) throw new Error(`目标图层“${targetLayer.name}”已锁定。`);
    this.executeInstanceTransform({
      ...before,
      position: vectorInputs('module-pos'),
      rotation: scaleVector(vectorInputs('module-rot'), 1 / 90),
      scale: vectorInputs('module-scale'),
      layerId: this._activeLayerId,
    }, '应用实例变换');
  }

  private _sortedModules(modules: readonly ModuleSummary[]): ModuleSummary[] {
    const direction = this._moduleSort.value === 'name-desc' ? -1 : 1;
    return [...modules].sort((a, b) => direction * a.name.localeCompare(b.name, getEditorLocale(), { numeric: true }));
  }

  private _renderModuleAssets(modules: readonly ModuleSummary[]): void {
    const query = this._moduleSearch.value.trim().toLocaleLowerCase();
    const signature = `${getEditorLocale()}|${query}|${this._moduleLibrary.value}|${modules.map(module =>
      `${module.id}:${module.name}:${module.size.x},${module.size.y},${module.size.z}:${module.voxelCount}:${module.revision}`).join('|')}`;
    if (signature === this._moduleAssetsSignature) return;
    this._moduleAssetsSignature = signature;
    const visible = modules.filter(module => !query || module.name.toLocaleLowerCase().includes(query));
    this._moduleAssets.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'module-assets-empty';
      empty.textContent = translate(modules.length === 0 ? 'module.empty' : 'module.noMatch');
      this._moduleAssets.append(empty);
      return;
    }
    for (const module of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `module-asset${module.id === this._moduleLibrary.value ? ' active' : ''}`;
      button.dataset.moduleId = module.id;
      button.title = `${module.name} · ${module.size.x}×${module.size.y}×${module.size.z}`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 64 52');
      svg.setAttribute('aria-hidden', 'true');
      for (const point of moduleThumbnailPoints(this._document.getModuleVoxelsView(module.id))) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(point.x - point.size / 2));
        rect.setAttribute('y', String(point.y - point.size / 2));
        rect.setAttribute('width', String(point.size));
        rect.setAttribute('height', String(point.size));
        rect.setAttribute('rx', '0.7');
        rect.setAttribute('fill', point.color);
        rect.setAttribute('stroke', 'rgba(255,255,255,.25)');
        rect.setAttribute('stroke-width', '.45');
        svg.append(rect);
      }
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = module.name;
      const meta = document.createElement('small');
      meta.textContent = translate('module.assetMeta', {
        count: module.voxelCount,
        size: `${module.size.x}×${module.size.y}×${module.size.z}`,
      });
      copy.append(name, meta);
      button.append(svg, copy);
      button.addEventListener('click', () => {
        this._moduleLibrary.value = module.id;
        this._copiedModuleId = module.id;
        this.sync();
      });
      this._moduleAssets.append(button);
    }
  }

  private _selectedModule(): VoxelModuleData {
    const module = this._document.getModule(this._moduleLibrary.value);
    if (!module) throw new Error('请先选择一个模块。');
    return module;
  }

  private _renameModule(): void {
    const module = this._selectedModule();
    const name = window.prompt('重命名模块', module.name);
    if (name === null) return;
    if (this._history.execute(new ModuleRenameCommand(this._document, module.id, name))) {
      this._notify(`模块已重命名为“${name.trim() || module.name}”。`);
    }
  }

  private _duplicateModuleDefinition(): void {
    const source = this._selectedModule();
    const command = new ModuleCreateCommand(
      this._document,
      `${source.name} 副本`,
      source.size,
      source.voxels,
      false,
      '复制模块定义',
    );
    if (!this._history.execute(command) || !command.module) return;
    this._copiedModuleId = command.module.id;
    this._moduleLibrary.value = command.module.id;
    this._notify(`已复制模块定义“${source.name}”。`);
  }

  private _removeUnusedModule(): void {
    const module = this._selectedModule();
    if (this._document.isModuleUsed(module.id)) throw new Error('模块仍被实例或动画关键帧使用。');
    if (!window.confirm(`删除未使用模块“${module.name}”？`)) return;
    if (this._history.execute(new ModuleRemoveCommand(this._document, module.id))) {
      if (this._copiedModuleId === module.id) this._copiedModuleId = null;
      this._notify(`已删除未使用模块“${module.name}”。`);
    }
  }

  private _locateModuleInstances(): void {
    const module = this._selectedModule();
    const positions = this._document.getModuleInstanceVoxelPositions(module.id);
    const renderer = this._getRenderer();
    if (positions.length === 0 || !renderer?.frameVoxels(positions)) throw new Error('该模块在场景中没有可定位的实例。');
    this._notify(`已定位“${module.name}”的全部实例。`);
  }

  private _assignSelectionLayer(): void {
    if (this._document.isEditingModule) throw new Error('模块定义体素不属于场景图层。');
    const selected = this._getSelectedBaseVoxels();
    if (selected.length === 0) throw new Error('请先选择主场景基础体素。');
    const command = createAssignVoxelsLayerCommand(this._document, selected, this._activeLayerId);
    if (!command || !this._history.execute(command)) {
      this._notify('选中体素已经位于当前图层。');
      return;
    }
    this._notify(`已将 ${selected.length.toLocaleString()} 个基础体素移至当前图层。`);
  }

  private _highlightConflicts(): void {
    const instance = this._selectedInstanceId
      ? this._document.getEvaluatedModuleInstance(this._selectedInstanceId)
      : null;
    if (!instance) throw new Error('请先在场景模块树中选择一个实例。');
    const collisions = this._document.getModuleInstanceCollisions(instance.id);
    if (collisions.length === 0) throw new Error('当前实例没有重合冲突。');
    const renderer = this._getRenderer();
    if (!renderer) return;
    this._highlightedCollisionInstanceId = instance.id;
    const changed = renderer.setConflictHighlights(collisions);
    renderer.frameVoxels(collisions);
    if (changed) this._requestRenderRefresh();
    this._notify(`已高亮 ${collisions.length.toLocaleString()} 个冲突格。`);
  }

  private _newModule(): void {
    const name = window.prompt('模块名称', `模块 ${this._document.moduleSummaries.length + 1}`);
    if (name === null) return;
    const rawSize = window.prompt('模块尺寸（X,Y,Z）', '16,16,16');
    if (rawSize === null) return;
    const axes = rawSize.split(/[,，x×\s]+/).filter(Boolean).map(Number);
    if (axes.length !== 3 || axes.some(axis => !Number.isFinite(axis) || axis <= 0)) throw new Error('模块尺寸格式无效，请输入类似 16,16,16。');
    const command = new ModuleCreateCommand(this._document, name, { x: axes[0]!, y: axes[1]!, z: axes[2]! });
    this._history.execute(command);
    const module = command.module;
    if (!module) return;
    this._copiedModuleId = module.id;
    this._moduleLibrary.value = module.id;
    this._resetCamera();
    this._notify(`已新建“${module.name}”，当前正在编辑模块。`);
  }

  private _copyModule(): void {
    const selected = this._selectedInstanceId ? this._document.getEvaluatedModuleInstance(this._selectedInstanceId) : null;
    const module = this._document.getModule(selected?.moduleId ?? this._moduleLibrary.value);
    if (!module) throw new Error('请先选择一个模块。');
    this._copiedModuleId = module.id;
    this._moduleLibrary.value = module.id;
    this._notify(`已复制模块“${module.name}”。`);
  }

  private _pasteModule(): void {
    const moduleId = this._copiedModuleId ?? this._moduleLibrary.value;
    if (!moduleId) throw new Error('请先复制或选择一个模块。');
    const layer = this._document.getLayer(this._activeLayerId);
    if (!layer || layer.locked) throw new Error('目标图层不存在或已锁定。');
    const command = new ModuleInstanceCreateCommand(this._document, moduleId, vectorInputs('module-pos'), this._activeLayerId);
    this._history.execute(command);
    if (!command.instance) return;
    this._selectedInstanceId = command.instance.id;
    this._resetCamera();
    this._notify(`已将“${command.instance.name}”粘贴到主场景。`);
  }

  private _removeInstance(): void {
    const instance = this._selectedInstanceId ? this._document.getModuleInstance(this._selectedInstanceId) : null;
    if (instance && this._document.getLayer(instance.layerId)?.locked) throw new Error('实例所在图层已锁定。');
    if (!this._selectedInstanceId || !this._history.execute(new ModuleInstanceRemoveCommand(this._document, this._selectedInstanceId))) {
      throw new Error('请先在树中选择一个模块实例。');
    }
    this._selectedInstanceId = null;
    this._notify('模块实例已从场景中移除。');
  }

  private _updateLayerFlag(key: 'visible' | 'locked'): void {
    this._run(() => {
      const layer = this._document.getLayer(this._activeLayerId);
      if (!layer) return;
      const value = !layer[key];
      this._history.execute(new LayerUpdateCommand(
        this._document, layer.id, { [key]: value },
        key === 'visible' ? (value ? '显示图层' : '隐藏图层') : (value ? '锁定图层' : '解锁图层'),
      ));
    });
  }

  private _treeSelection(event: Event): void {
    const selectedId = (event as CustomEvent<GETreeSelectionChangeDetail>).detail.selectedId;
    this._selectedInstanceId = null;
    if (selectedId?.startsWith('instance:')) {
      const instance = this._document.getEvaluatedModuleInstance(selectedId.slice('instance:'.length));
      if (instance) {
        this._selectedInstanceId = instance.id;
        this._activeLayerId = instance.layerId;
        this._moduleLibrary.value = instance.moduleId;
      }
    } else if (selectedId?.startsWith('layer:')) this._activeLayerId = selectedId.slice('layer:'.length);
    else if (selectedId?.startsWith('base:')) this._activeLayerId = selectedId.slice('base:'.length);
    else if (selectedId?.startsWith('module:')) {
      const [, layerId, moduleId] = selectedId.split(':');
      this._activeLayerId = layerId || DEFAULT_LAYER_ID;
      if (moduleId) this._moduleLibrary.value = moduleId;
    }
    this._document.setActiveVoxelLayer(this._activeLayerId);
    this.sync();
    this._onSelectionChange();
  }

  private _run(action: () => void): void {
    try { action(); }
    catch (error) { this._notify(error instanceof Error ? error.message : String(error), true); }
  }
}

class VoxelModuleTreeNode extends HTMLElement {
  private readonly _label = document.createElement('span');
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{box-sizing:border-box;display:flex;align-items:center;width:100%;min-width:0;height:24px;padding:0 6px;border-radius:3px;color:#aebdd0;font:10px system-ui,sans-serif}:host([selected]){color:#eaf5ff;background:#23435b}:host([conflict]){color:#ffd9dc;background:#612b33}:host([conflict][selected]){background:#7a313b}:host([hidden]){opacity:.52}:host([locked])::after{content:'🔒';margin-left:auto;font-size:9px}span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
    root.append(style, this._label);
  }
  set node(value: GETreeNodeData) {
    this._label.textContent = value.label ?? value.id;
    this.toggleAttribute('conflict', value.conflict === true);
    this.toggleAttribute('hidden', value.visible === false);
    this.toggleAttribute('locked', value.locked === true);
  }
  set selected(value: boolean) { this.toggleAttribute('selected', value); }
}

function defineModuleTreeNode(): void {
  if (!customElements.get('voxel-module-tree-node')) customElements.define('voxel-module-tree-node', VoxelModuleTreeNode);
}

function element<T extends Element = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
function numberValue(id: string): number { return Number(element<HTMLInputElement>(id).value); }
function vectorInputs(prefix: string): { x: number; y: number; z: number } {
  return { x: numberValue(`${prefix}-x`), y: numberValue(`${prefix}-y`), z: numberValue(`${prefix}-z`) };
}
function setVectorInputs(prefix: string, value: { x: number; y: number; z: number }): void {
  element<HTMLInputElement>(`${prefix}-x`).value = String(value.x);
  element<HTMLInputElement>(`${prefix}-y`).value = String(value.y);
  element<HTMLInputElement>(`${prefix}-z`).value = String(value.z);
}
function scaleVector(value: { x: number; y: number; z: number }, scale: number): { x: number; y: number; z: number } {
  return { x: value.x * scale, y: value.y * scale, z: value.z * scale };
}
