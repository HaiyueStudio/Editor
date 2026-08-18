import type { GETree, GETreeNodeData } from '@haiyue/ui';
import { Entity, type Geometry3D, type HaiyueEngine, type World } from '@haiyue/engine';
import { ScriptComponent } from '@haiyue/engine/components';
import { type Material } from '@haiyue/engine/material';
import type { CommandBus } from '../../commands/CommandBus';
import type { SelectionController } from '../../domain/selection/SelectionState';
import { RuntimeOwnershipScope } from '../../domain/runtime/RuntimeOwnershipScope';
import type { CoreWorkflowCoordinator } from '../../domain/workflows/CoreWorkflowCoordinator';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type { SerializedGlobalSettings, SerializedSystem } from '../../export/runtimeScene';
import type { PlayDevicePreviewController } from '../../play/devicePreview';
import type { PlaySession } from '../../play/playSession';
import type { ResourcePool } from '../../resources/ResourcePool';
import { createDefaultSystemConfig } from '../../scene/systemConfig';
import type { EditorStarterKit, InspectorContext, ModelResourceItem, PrefabResourceItem, TextureSource } from '../../types';
import type { EditorRecentFileSession } from '../../domain/store/EditorStore';
import type { RecentSceneFileOpenResult } from '../file/recentSceneHandles';
import { update2DSelectionHelpers } from '../../ui/viewport/viewportInteraction';
import {
  setupPlayEvents,
  setupSceneFileEvents,
  setupStarterKitEvents,
  setupUndoRedoShortcuts,
  type AppEventElements,
} from './appEvents';
import { setupEntityTreeEvents } from '../entity-tree/treeEvents';
import {
  bootstrapEditorViewport,
  createDefaultEditorScene,
  createViewportResizeController,
} from '../../engine-adapter/EditorViewportBootstrap';
import { setupViewportEvents } from '../viewport/viewportEvents';
import {
  createEditorScriptRuntimeApiFactory,
  updateEditorWorld,
} from '../script/editorScriptRuntime';
import type { EditorSceneActions } from '../scene/editorSceneActions';
import { EditorViewportAdapter } from '../../engine-adapter/EditorViewportAdapter';
import type { DocumentRevisionState } from '../file/documentLifecycle';
import { EditorShortcutRegistry } from '../shortcuts/EditorShortcutRegistry';
import type { OptionalEditorCapability } from '../../domain/library/optionalComponentManifest';

type EntityContextMenu = HTMLElement & {
  items: Array<{ label?: string; value?: string; disabled?: boolean; separator?: boolean }>;
  openAt(x: number, y: number): void;
};

export interface EditorAppElements extends AppEventElements {
  canvas: HTMLCanvasElement | null;
  viewportWrap: HTMLElement | null;
  viewportMessage: HTMLElement | null;
  selectionHelper2DLayer: HTMLElement | null;
  tree: GETree | null;
  entityContextMenu: EntityContextMenu | null;
  systemAddSelect: HTMLSelectElement | null;
  systemAddButton: HTMLElement | null;
  orbitModeButton: HTMLElement | null;
  boxModeButton: HTMLElement | null;
  boxSelectTargetDropdown: (HTMLElement & {
    items: Array<{ label?: string; value?: string; disabled?: boolean; separator?: boolean }>;
    show(): void;
  }) | null;
  viewportTranslateButton: HTMLElement | null;
  viewportRotateButton: HTMLElement | null;
  viewportScaleButton: HTMLElement | null;
  viewportTransformSpace: HTMLSelectElement | null;
  viewportTransformPivot: HTMLSelectElement | null;
  viewportSnapEnabled: HTMLInputElement | null;
  viewportSnapValue: HTMLInputElement | null;
  viewportFocusSelection: HTMLElement | null;
}

export interface EditorAppDeps {
  elements: EditorAppElements;
  componentLibraries: EditorComponentLibrary[];
  resourcePool: ResourcePool;
  sceneActions: EditorSceneActions;
  starterKits: EditorStarterKit[];
  getStarterKitDropdownItems: () => Array<{ label?: string; value?: string; disabled?: boolean; separator?: boolean }>;
  getGlobalSettings: () => SerializedGlobalSettings;
  getSystemConfigs: () => SerializedSystem[];
  addSystemConfig: (config: SerializedSystem) => void;
  getEntityClipboard: () => Entity[];
  setEntityClipboard: (entities: Entity[]) => void;
  entityContextMenuState: { targetId: string | null };
  entityToTreeNode: (entity: Entity) => GETreeNodeData;
  getEntityIdFromNode: (node: unknown) => number | null;
  createCommandBus: () => CommandBus;
  getCommandBus: () => CommandBus | null;
  setCommandBus: (commandBus: CommandBus) => void;
  updateHistoryButtons: () => void;
  setButtonDisabled: (button: HTMLElement | null, disabled: boolean) => void;
  setInspectorContext: (context: InspectorContext | null) => void;
  attachRuntime: (context: { viewportEngine: HaiyueEngine; world: World; commandBus: CommandBus; ownership: RuntimeOwnershipScope }) => void;
  clearRuntime: () => void;
  selectionState: SelectionController;
  applyGlobalSettingsToWorld: (world: World) => void;
  getGlobalClearColor: () => { r: number; g: number; b: number; a: number };
  syncViewportClearColor: (engine?: HaiyueEngine | null) => void;
  renderGlobalSettingsPanel: (world: World | null) => void;
  renderSystemPanel: (onChange?: () => void) => void;
  refreshResourcePool: (world: World) => void;
  renderInspector: (entity: Entity | null, selectionCount?: number) => void;
  selectEntities: (
    entities: Entity[],
    treeElement: GETree | null,
    previousSelected: Set<Entity>,
    activeEntity?: Entity | null,
  ) => Set<Entity>;
  refreshTreeSelection: (treeElement: GETree | null, world: World, selection: Set<Entity>) => void;
  instantiateModelIntoScene: (
    world: World,
    model: ModelResourceItem,
    target: Entity | null,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
  ) => void;
  instantiatePrefabIntoScene: (
    world: World,
    prefab: PrefabResourceItem,
    target: Entity | null,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
  ) => void;
  createEntityUnderTarget: (
    world: World,
    target: Entity | null,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
  ) => void;
  create2DEntityUnderTarget: EditorAppDeps['createEntityUnderTarget'];
  create2DCameraUnderTarget: (
    world: World,
    target: Entity | null,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
    onCreate: (entity: Entity) => void,
  ) => void;
  createPrefabFromEntity: (
    world: World,
    source: Entity,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
  ) => void;
  changeMeshGeometry: (entity: Entity, geometry: Geometry3D) => boolean;
  changeMeshMaterial: (entity: Entity, material: Material) => boolean;
  changeMaterialTexture: (entity: Entity, texture: TextureSource) => boolean;
  playDevicePreview: PlayDevicePreviewController;
  playSession: PlaySession;
  reportError: (message: string, error?: unknown) => void;
  recordRecentSceneFile?: (file: File, options?: { handle?: RecentSceneFileOpenResult['handle'] }) => void | Promise<void>;
  getRecentSceneFiles?: () => EditorRecentFileSession[];
  clearRecentSceneFiles?: () => void;
  openRecentSceneFile?: (file: EditorRecentFileSession) => Promise<RecentSceneFileOpenResult | null>;
  onRecentSceneFilesChange?: (listener: () => void) => () => void;
  getDocumentState: () => DocumentRevisionState;
  markDocumentSaved: (revision: number, documentName: string) => void;
  markDocumentOpened: (documentName: string) => void;
  markDocumentRecovered: (documentName: string | null) => void;
  markDocumentChanged: () => void;
  onProjectChanged: (listener: () => void) => () => void;
  activateOptionalCapabilitiesForProject(project: unknown): Promise<void>;
  subscribeOptionalCapabilityActivation(
    listener: (capability: OptionalEditorCapability) => void,
  ): () => void;
  workflows: CoreWorkflowCoordinator;
}

export async function startEditorApp(deps: EditorAppDeps): Promise<void> {
  const { elements } = deps;
  const { canvas, tree } = elements;
  if (!canvas) return;

  const scene = createDefaultEditorScene();
  const { world, sceneRoot, cameraEntity } = scene;
  deps.applyGlobalSettingsToWorld(world);
  const selectionState = deps.selectionState;
  let syncConfiguredSystems = () => {};
  const syncChangedSystemConfigs = () => {
    syncConfiguredSystems();
    deps.markDocumentChanged();
  };
  const editorGlobalListeners = new AbortController();
  const shortcuts = new EditorShortcutRegistry();
  window.addEventListener('beforeunload', () => {
    deps.workflows.cancelAll();
    editorGlobalListeners.abort();
    shortcuts.dispose();
  }, { once: true });

  deps.setCommandBus(deps.createCommandBus());
  deps.refreshResourcePool(world);

  deps.setInspectorContext({
    world,
    getActiveEntity: () => selectionState.active,
    setActiveEntity: entity => { selectionState.setActive(entity); },
    getSelection: () => selectionState.selection,
    setSelection: (entities, nextActive = entities[entities.length - 1] ?? null) => {
      selectionState.setSelection(deps.selectEntities(entities, tree, selectionState.selection, nextActive), nextActive);
    },
    refreshSceneTree: () => deps.refreshTreeSelection(tree, world, selectionState.selection),
  });
  deps.renderGlobalSettingsPanel(world);

  selectionState.setSelection(deps.selectEntities([sceneRoot], tree, selectionState.selection, sceneRoot), sceneRoot);

  const viewportBootstrap = await bootstrapEditorViewport({
    canvas,
    viewportMessage: elements.viewportMessage,
    getClearColor: deps.getGlobalClearColor,
    getReverseZ: () => deps.getGlobalSettings().reverseZ === true,
    syncViewportClearColor: engine => deps.syncViewportClearColor(engine),
  }, scene);
  if (!viewportBootstrap) return;
  const { engine, orbitControl, render3D } = viewportBootstrap;
  ScriptComponent.setRuntimeApiFactory(createEditorScriptRuntimeApiFactory(world, engine, { canvas }));
  ScriptComponent.enableTrustedProject({ capabilities: ['read', 'scene', 'asset', 'input', 'debug'] });
  const viewportAdapter = new EditorViewportAdapter({
    engine,
    world,
    cameraEntity,
    render3D,
    getSystemConfigs: deps.getSystemConfigs,
  });
  const ownership = new RuntimeOwnershipScope()
    .bindEngine(engine)
    .bindWorld(world)
    .bindPointer({
      destroy() {
        orbitControl.dispose();
        viewportAdapter.dispose();
        ScriptComponent.resetRuntimeApiFactory();
      },
    });
  const commandBus = deps.getCommandBus();
  if (!commandBus) throw new Error('Editor runtime requires a CommandBus before attachment.');
  deps.attachRuntime({ viewportEngine: engine, world, commandBus, ownership });
  editorGlobalListeners.signal.addEventListener('abort', () => {
    deps.playSession.close();
    deps.clearRuntime();
  }, { once: true });
  syncConfiguredSystems = () => viewportAdapter.syncConfiguredSystems();
  syncConfiguredSystems();
  deps.renderSystemPanel(syncChangedSystemConfigs);
  elements.systemAddButton?.addEventListener('click', () => {
    const type = elements.systemAddSelect?.value as SerializedSystem['type'] | undefined;
    if (type !== 'Physics2DSystem' && type !== 'RadialShadowRenderFeature') return;
    if (deps.getSystemConfigs().some(config => config.type === type)) return;
    deps.addSystemConfig(createDefaultSystemConfig(type));
    deps.renderSystemPanel(syncChangedSystemConfigs);
    syncChangedSystemConfigs();
  });

  const selectInTree = (entities: Entity[], activeEntity: Entity | null = entities[entities.length - 1] ?? null) =>
    deps.selectEntities(entities, tree, selectionState.selection, activeEntity);
  const viewportController = setupViewportEvents({
    world,
    engine,
    cameraEntity,
    tree,
    elements: {
      canvas,
      dropTarget: elements.viewportWrap,
      orbitModeButton: elements.orbitModeButton,
      boxModeButton: elements.boxModeButton,
      boxSelectTargetDropdown: elements.boxSelectTargetDropdown,
      transformHost: elements.viewportWrap,
      translateButton: elements.viewportTranslateButton,
      rotateButton: elements.viewportRotateButton,
      scaleButton: elements.viewportScaleButton,
      transformSpace: elements.viewportTransformSpace,
      transformPivot: elements.viewportTransformPivot,
      snapEnabled: elements.viewportSnapEnabled,
      snapValue: elements.viewportSnapValue,
      focusSelection: elements.viewportFocusSelection,
    },
    selectionState,
    shortcuts,
    getCommandBus: deps.getCommandBus,
    onTransformChange: () => {
      deps.renderInspector(selectionState.active, selectionState.selection.size);
      deps.refreshTreeSelection(tree, world, selectionState.selection);
    },
    orbitControl,
    componentLibraries: deps.componentLibraries,
    resourcePool: deps.resourcePool,
    getGlobalSettings: deps.getGlobalSettings,
    createMesh2DRenderSystem: camera2DEntity => viewportAdapter.createMesh2DRenderSystem(camera2DEntity),
    registerRenderSystem: (system, options) => viewportAdapter.registerRenderSystem(system, options),
    findCamera2D: entity => viewportAdapter.findCamera2D(entity),
    selectEntities: selectInTree,
    instantiateModelIntoScene: (model, target) => deps.instantiateModelIntoScene(
      world,
      model,
      target,
      tree,
      () => selectionState.selection,
      entity => { selectionState.setActive(entity); },
      selection => { selectionState.setSelection(selection); },
    ),
    instantiatePrefabIntoScene: (prefab, target) => deps.instantiatePrefabIntoScene(
      world,
      prefab,
      target,
      tree,
      () => selectionState.selection,
      entity => { selectionState.setActive(entity); },
      selection => { selectionState.setSelection(selection); },
    ),
    changeMeshGeometry: deps.changeMeshGeometry,
    changeMeshMaterial: deps.changeMeshMaterial,
    changeMaterialTexture: deps.changeMaterialTexture,
  });
  editorGlobalListeners.signal.addEventListener('abort', () => viewportController.dispose(), { once: true });
  const unsubscribeOptionalCapabilities = deps.subscribeOptionalCapabilityActivation(() => {
    viewportController.syncRender2DForScene();
    deps.refreshResourcePool(world);
    deps.renderInspector(selectionState.active, selectionState.selection.size);
  });
  editorGlobalListeners.signal.addEventListener(
    'abort',
    unsubscribeOptionalCapabilities,
    { once: true },
  );
  viewportController.syncRender2DForScene();

  setupEntityTreeEvents({
    world,
    tree,
    entityContextMenu: elements.entityContextMenu,
    selectionState,
    getCommandBus: deps.getCommandBus,
    componentLibraries: deps.componentLibraries,
    contextMenuState: deps.entityContextMenuState,
    getEntityClipboard: deps.getEntityClipboard,
    setEntityClipboard: deps.setEntityClipboard,
    entityToTreeNode: deps.entityToTreeNode,
    getEntityIdFromNode: deps.getEntityIdFromNode,
    resourcePool: deps.resourcePool,
    changeMeshGeometry: deps.changeMeshGeometry,
    changeMeshMaterial: deps.changeMeshMaterial,
    changeMaterialTexture: deps.changeMaterialTexture,
    refreshTreeSelection: () => deps.refreshTreeSelection(tree, world, selectionState.selection),
    refreshResourcePool: () => deps.refreshResourcePool(world),
    selectEntities: selectInTree,
    createEntityUnderTarget: target => deps.createEntityUnderTarget(
      world,
      target,
      tree,
      () => selectionState.selection,
      entity => { selectionState.setActive(entity); },
      selection => { selectionState.setSelection(selection); },
    ),
    create2DEntityUnderTarget: target => deps.create2DEntityUnderTarget(
      world,
      target,
      tree,
      () => selectionState.selection,
      entity => { selectionState.setActive(entity); },
      selection => { selectionState.setSelection(selection); },
    ),
    create2DCameraUnderTarget: target => deps.create2DCameraUnderTarget(
      world,
      target,
      tree,
      () => selectionState.selection,
      entity => { selectionState.setActive(entity); },
      selection => { selectionState.setSelection(selection); },
      viewportController.ensureRender2DForCamera,
    ),
    createPrefabFromEntity: source => deps.createPrefabFromEntity(
      world,
      source,
      tree,
      () => selectionState.selection,
      entity => { selectionState.setActive(entity); },
      selection => { selectionState.setSelection(selection); },
    ),
  });

  const appEventDeps = {
    world,
    elements,
    getCommandBus: deps.getCommandBus,
    selectionState,
    playDevicePreview: deps.playDevicePreview,
    playSession: deps.playSession,
    starterKits: deps.starterKits,
    getStarterKitDropdownItems: deps.getStarterKitDropdownItems,
    getTree: () => tree,
    setCommandBus: deps.setCommandBus,
    createCommandBus: deps.createCommandBus,
    updateHistoryButtons: deps.updateHistoryButtons,
    setButtonDisabled: deps.setButtonDisabled,
    serializeEditorScene: deps.sceneActions.serializeEditorScene,
    prepareSceneDownload: deps.sceneActions.prepareSceneDownload,
    prepareRuntimeProjectDownload: deps.sceneActions.prepareRuntimeProjectDownload,
    downloadPreparedFile: deps.sceneActions.downloadPreparedFile,
    activateOptionalCapabilitiesForProject: deps.activateOptionalCapabilitiesForProject,
    prepareEditorScene: deps.sceneActions.prepareEditorScene,
    loadEditorScene: deps.sceneActions.loadEditorScene,
    loadPreparedEditorScene: deps.sceneActions.loadPreparedEditorScene,
    syncRender2DForScene: viewportController.syncRender2DForScene,
    renderSystemPanel: () => deps.renderSystemPanel(syncConfiguredSystems),
    syncConfiguredSystems,
    selectEntities: selectInTree,
    refreshTreeSelection: () => deps.refreshTreeSelection(tree, world, selectionState.selection),
    renderInspector: deps.renderInspector,
    ensure2DCamera: viewportController.ensureRender2DForCamera,
    reportError: deps.reportError,
    ...(deps.recordRecentSceneFile === undefined ? {} : { recordRecentSceneFile: deps.recordRecentSceneFile }),
    ...(deps.getRecentSceneFiles === undefined ? {} : { getRecentSceneFiles: deps.getRecentSceneFiles }),
    ...(deps.clearRecentSceneFiles === undefined ? {} : { clearRecentSceneFiles: deps.clearRecentSceneFiles }),
    ...(deps.openRecentSceneFile === undefined ? {} : { openRecentSceneFile: deps.openRecentSceneFile }),
    ...(deps.onRecentSceneFilesChange === undefined ? {} : { onRecentSceneFilesChange: deps.onRecentSceneFilesChange }),
    getDocumentState: deps.getDocumentState,
    markDocumentSaved: deps.markDocumentSaved,
    markDocumentOpened: deps.markDocumentOpened,
    markDocumentRecovered: deps.markDocumentRecovered,
    markDocumentChanged: deps.markDocumentChanged,
    onProjectChanged: deps.onProjectChanged,
    shortcuts,
    workflows: deps.workflows,
  };
  setupUndoRedoShortcuts(appEventDeps, editorGlobalListeners.signal);
  setupSceneFileEvents(appEventDeps);
  setupPlayEvents(appEventDeps);
  setupStarterKitEvents(appEventDeps);

  createViewportResizeController(canvas, engine).observe(elements.viewportWrap, editorGlobalListeners.signal);

  engine.on('update', ({ detail: { time, delta } }) => {
    updateEditorWorld(world, time, delta, deps.getGlobalSettings().parameters?.runScriptsInEditor === true);
    update2DSelectionHelpers(elements.selectionHelper2DLayer, selectionState.selection, viewportController.getActiveCamera2DEntity(), engine);
  });

  engine.run();
}
