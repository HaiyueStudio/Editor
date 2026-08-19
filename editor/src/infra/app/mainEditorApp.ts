import type { GEDropdownItem, GESelectOption } from '@haiyue/ui';
import { Entity, type World } from '@haiyue/engine';
import { KeyboardComponent, ScriptComponent, ScriptResource } from '@haiyue/engine/components';
import { getEditorDom } from '../../dom';
import { createMainInspectorState } from '../inspector/mainInspectorState';
import {
  createMainInspectorCommitContext,
  type MainInspectorCommitContext,
} from '../inspector/mainInspectorCommitContext';
import { setupMainInspectorEventBindings } from '../inspector/mainInspectorEventsContext';
import {
  formatNumber,
  getAddComponentDropdownItems as getAddComponentDropdownItemsFromDescriptors,
  getComponentOptions,
} from '../inspector/inspectorUiUtils';
import {
  renderSystemPanel as renderSystemConfigPanel,
} from '../../scene/systemConfig';
import {
  cloneGlobalSettings,
  DEFAULT_GLOBAL_SETTINGS,
} from '../../domain/settings/globalSettings';
import { EditorStore, editorSelectors } from '../../domain/store/EditorStore';
import { createBrowserEditorSessionPersistence } from '../storage/LocalStorageEditorSessionPersistence';
import { getKeyboardExample } from '../../script/scriptAuthoringText';
import { LazyScriptEditorController } from '../../script/LazyScriptEditorController';
import { getErrorMessage, showEditorError } from '../notification/editorNotifications';
import { createMainEntityActions } from '../entity/mainEntityActions';
import { startMainEditorWithContext } from './mainEditorStartupContext';
import { getDefaultEditorMaterialKind, onEditorLanguageChange, setupEditorOptions } from '../options/editorOptions';
import type { ResourcePanelAdapter } from '../resource/resourcePanelAdapter';
import { createMainPlayContext } from '../play/mainPlayContext';
import { createMainResourceContext } from '../resource/mainResourceContext';
import {
  clearRecentSceneHandles,
  createRecentSceneHandleId,
  deleteRecentSceneHandle,
  loadRecentSceneFileResult,
  saveRecentSceneHandle,
} from '../file/recentSceneHandles';
import {
  createMainResourcePanelContext,
  type MainResourcePanelContext,
} from '../resource/mainResourcePanelContext';
import { createMainSceneContext } from '../scene/mainSceneContext';
import { createMainGlobalSettingsBindings } from '../settings/mainGlobalSettingsBindings';
import { createMainComponentContext } from '../library/mainComponentContext';
import { EditorAssetAdapter } from '../../engine-adapter/EditorAssetAdapter';
import { createSelectEntities } from '../selection/mainSelection';
import {
  getDefaultCanvasTextStyle,
} from '../../domain/resource/resourceDefaults';
import type { PrefabResourceItem, PreparedResourceImport } from '../../types';
import { createEntityTreePresenter } from '../../ui/entityTreePresenter';
import type { MainEntityActions } from '../entity/mainEntityActions';
import { CoreWorkflowCoordinator, type WorkflowPrepareContext } from '../../domain/workflows/CoreWorkflowCoordinator';
import { AssetOperationCenter, AssetOperationStatusView, type AssetOperationKind } from '../resource/AssetOperationCenter';
import {
  loadEditorInspectorContribution,
  OptionalEditorCapabilityLoader,
} from './lazyContributionLoader';
import {
  getOptionalCapabilityForComponentType,
  type OptionalEditorCapability,
} from '../../domain/library/optionalComponentManifest';
import { ContentAuthoringStore } from '../../domain/content/ContentAuthoringStore';
import {
  attachSceneDocumentBridge,
  enableSceneRayTracingPreview,
  syncSceneSelection,
} from '../../platform/sceneEditorPlatform';
import type { EditorSelectionReference } from '@haiyue/editor-plugin-sdk';

const editorDom = getEditorDom();
document.getElementById('ray-tracing-preview-button')?.addEventListener('click', () => {
  void enableSceneRayTracingPreview().catch(error => console.error('Failed to enable ray tracing preview.', error));
});
const {
  systemList,
  canvas,
  resourceDetail,
  globalGameNameInput,
  globalDesignWidthInput,
  globalDesignHeightInput,
  globalViewportModeSelect,
  globalClearColorInput,
  globalClearAlphaInput,
  globalReverseZInput,
  globalRender2DLoadOpSelect,
  globalGuiLoadOpSelect,
  globalParametersInput,
  keyboardPressedValue,
  keyboardExampleCode,
  scriptLifecycleSelect,
  scriptEditorHost,
  scriptParametersCode,
  scriptEditorOverlay,
  scriptEditorOverlayTitle,
  editorOptionsButton,
  editorOptionsPanel,
  editorLanguageSelect,
  editorDefaultMaterialSelect,
  resourceTabs,
  inspectorTabs,
  workspaceSplit,
  leftStackSplit,
  centerSplit,
  viewportStackSplit,
  entitySearchInput,
  resourceSearchInput,
  assetOperationCenter,
  playOverlay,
  playDeviceSelect,
  playDeviceDprInput,
  playDeviceCustom,
  playDeviceWidthInput,
  playDeviceHeightInput,
  playDeviceZoomInput,
  playDeviceViewport,
  playDeviceFrame,
  playFrame,
  playPauseButton,
  playOutput,
  playRuntimeInspector,
  playPerformance,
  playDiagnosticExportButton,
  playBreakpointsInput,
  playBreakpointsApplyButton,
  playBreakpointsStatus,
} = editorDom;

const editorStore = new EditorStore({
  settings: cloneGlobalSettings(DEFAULT_GLOBAL_SETTINGS),
  sessionPersistence: createBrowserEditorSessionPersistence(),
});
const storeCommands = editorStore.commands;
const getSettings = () => editorStore.select(editorSelectors.settings);
const getActiveScriptResource = () => editorStore.select(editorSelectors.activeScriptResource);
const getRuntimeContext = () => editorStore.select(editorSelectors.runtimeContext);
const getInspectorContext = () => editorStore.select(editorSelectors.inspectorContext);
let pendingCommandBus: import('../../commands/CommandBus').CommandBus | null = null;
const getCommandBus = () => getRuntimeContext()?.commandBus ?? pendingCommandBus;
const resourceSelection = createResourceSelectionAdapter();
const workflows = new CoreWorkflowCoordinator();
const assetOperations = new AssetOperationCenter();
const contentAuthoringStore = new ContentAuthoringStore();
new AssetOperationStatusView(assetOperationCenter, assetOperations);
setupEditorOptions({
  button: editorOptionsButton,
  panel: editorOptionsPanel,
  languageSelect: editorLanguageSelect,
  defaultMaterialSelect: editorDefaultMaterialSelect,
  resourceTabs,
  inspectorTabs,
  workspaceSplit,
  leftStackSplit,
  centerSplit,
  viewportStackSplit,
}, {
  session: { ...editorStore.select(editorSelectors.layout) },
  onSessionChange: session => { storeCommands.session.setLayout(session); },
});
const inspectorState = createMainInspectorState(editorStore);

let contentAuthoringPanelPromise: Promise<void> | null = null;
const loadContentAuthoringPanel = (): Promise<void> => {
  if (contentAuthoringPanelPromise) return contentAuthoringPanelPromise;
  const animationHost = document.getElementById('animation-authoring-panel');
  const materialGraphHost = document.getElementById('material-graph-authoring-panel');
  if (!animationHost || !materialGraphHost) return Promise.resolve();
  contentAuthoringPanelPromise = import('../content/ContentAuthoringPanel').then(module => {
    module.createContentAuthoringPanel({
      animationHost,
      materialGraphHost,
      store: contentAuthoringStore,
      reportError,
    });
  }).catch(error => {
    contentAuthoringPanelPromise = null;
    reportError('Failed to load content authoring tools.', error);
  });
  return contentAuthoringPanelPromise;
};
inspectorTabs?.addEventListener('tab-change', event => {
  const value = (event as CustomEvent<{ value?: string }>).detail?.value;
  if (value === 'animation' || value === 'material-graph') void loadContentAuthoringPanel();
});
const restoredInspectorTab = editorStore.select(editorSelectors.layout).inspectorTab;
if (restoredInspectorTab === 'animation' || restoredInspectorTab === 'material-graph') void loadContentAuthoringPanel();
contentAuthoringStore.subscribe(() => storeCommands.project.markResourcesChanged());
const {
  inspectorInputGuard,
  inspectorCommitState,
  getSelectedComponentName,
  setSelectedComponentName,
} = inspectorState;

function clearResourceSelection(): void {
  resourcePanelContext.clearResourceSelection();
}

const {
  resourcePool,
  resourceDisplayNames,
  getResourceName,
  createDefaultMeshComponent,
  createDefaultMesh2DComponent,
  createDefaultScriptComponent,
  ensureCanvasTextMesh,
  syncCanvasTextGeometry,
  getUniqueGeometryName,
  getUniqueMaterialName,
  getUniqueScriptName,
} = createMainResourceContext({
  getActiveScriptResource,
  getDefaultMaterialKind: getDefaultEditorMaterialKind,
  resourceSelection,
});

const {
  applyGlobalSettingsToWorld,
  getGlobalClearColor,
  syncViewportClearColor,
  renderGlobalSettingsPanel,
} = createMainGlobalSettingsBindings({
  elements: {
    canvas,
    gameNameInput: globalGameNameInput,
    designWidthInput: globalDesignWidthInput,
    designHeightInput: globalDesignHeightInput,
    viewportModeSelect: globalViewportModeSelect,
    clearColorInput: globalClearColorInput,
    clearAlphaInput: globalClearAlphaInput,
    reverseZInput: globalReverseZInput,
    render2DLoadOpSelect: globalRender2DLoadOpSelect,
    guiLoadOpSelect: globalGuiLoadOpSelect,
    parametersInput: globalParametersInput,
  },
  getSettings,
  getRuntimeContext,
  getInspectorWorld: () => getInspectorContext()?.world ?? null,
  formatNumber,
});

const entityTreePresenter = createEntityTreePresenter({ resourcePool });
const { refreshTreeSelection, refreshTreeStructure } = entityTreePresenter;
entitySearchInput?.addEventListener('input', () => {
  if (!entityTreePresenter.setFilter(entitySearchInput.value)) return;
  const context = getInspectorContext();
  if (context) refreshTreeStructure(editorDom.tree, context.world, context.getSelection());
});

const scriptEditorController = new LazyScriptEditorController({
  host: scriptEditorHost,
  lifecycleSelect: scriptLifecycleSelect,
  parametersCode: scriptParametersCode,
  overlay: scriptEditorOverlay,
  overlayTitle: scriptEditorOverlayTitle,
  getOnlyScriptResource: () => resourcePool.scripts.size === 1 ? [...resourcePool.scripts.values()][0]?.resource ?? null : null,
  onScriptChange: target => {
    const resource = target instanceof ScriptResource
      ? target
      : target instanceof ScriptComponent
        ? target.resource
        : null;
    if (resource) playSession.updateScriptResource(resource);
  },
  reportError,
});

const {
  componentLibraries,
  inspectorRegistry,
  resourceImporters,
  starterKits,
  registerStarterKit,
  installEditorPlugin,
  getStarterKitDropdownItems,
  getComponentDescriptors,
} = createMainComponentContext({
  createDefaultMesh2DComponent,
  createDefaultMeshComponent,
  createDefaultScriptComponent,
  getDefaultCanvasTextStyle,
});
resourcePool.setComponentResourceExtensions(componentLibraries);

const optionalCapabilities = new OptionalEditorCapabilityLoader({
  installPlugin: installEditorPlugin,
  reportFailure: (capability, error) => {
    reportError(`Optional ${capability} editor capability is unavailable.`, error);
  },
});
optionalCapabilities.subscribe(capability => {
  if (capability !== 'gltf') return;
  const runtime = getRuntimeContext();
  if (!runtime) return;
  void import('@haiyue/extensions/gltf')
    .then(({ GltfModelSystem }) => {
      if (!runtime.world.getSystem(GltfModelSystem)) {
        runtime.world.addSystem(new GltfModelSystem({
          priority: 0,
          assetManager: runtime.viewportEngine.assetManager ?? null,
        }));
      }
    })
    .catch(error => reportError('Failed to activate the glTF viewport runtime.', error));
});

const editorAssetAdapter = new EditorAssetAdapter({ resourcePool });

const inspectorRendererOptions = {
  elements: editorDom,
  inspectorInputGuard,
  getSelectedComponentName,
  setSelectedComponentName,
  clearResourceSelection,
  clearActiveScriptResource: () => { storeCommands.project.setActiveScriptResource(null); },
  updateAllResourceSelectionStates,
  getComponentOptions,
  getAddComponentDropdownItems,
  getGeometryOptions,
  getMaterialOptions,
  getMaterial2DOptions,
  getScriptResourceOptions,
  getAssetRefOptions,
  formatNumber,
  commitGenericComponentEdit,
  renderKeyboardEditor,
  inspectorRegistry,
  getSelection: () => getInspectorContext()?.getSelection() ?? new Set(),
};
let activeInspectorRenderer:
  ReturnType<typeof import('../inspector/mainInspectorRenderer').createMainInspectorRenderer>
  | null = null;
let pendingInspectorEntity: Entity | null = null;
let pendingInspectorSelectionCount = 0;
let inspectorLoadRequested = false;

const renderInspector = (entity: Entity | null, selectionCount = entity ? 1 : 0): void => {
  pendingInspectorEntity = entity;
  pendingInspectorSelectionCount = selectionCount;
  if (activeInspectorRenderer) {
    activeInspectorRenderer(entity, selectionCount);
    return;
  }
  if (!entity || inspectorLoadRequested) return;
  inspectorLoadRequested = true;
  void loadEditorInspectorContribution()
    .then(([mainInspector, inspector]) => {
      inspector.registerDefaultInspectorRenderers(inspectorRegistry);
      activeInspectorRenderer = mainInspector.createMainInspectorRenderer(inspectorRendererOptions);
      activeInspectorRenderer(pendingInspectorEntity, pendingInspectorSelectionCount);
    })
    .catch(error => {
      inspectorLoadRequested = false;
      reportError('Failed to load the entity Inspector.', error);
    });
};

const selectEntities = createSelectEntities({ renderInspector });
let mainEntityActions: MainEntityActions;
let resourcePanelContext: MainResourcePanelContext;
let resourcePanel: ResourcePanelAdapter;

let starterKitContributionPromise: Promise<void> | null = null;
const loadStarterKitContribution = (): Promise<void> => {
  if (!getComponentDescriptors().some(descriptor => descriptor.name === 'Tilemap2DComponent')) {
    return Promise.resolve();
  }
  starterKitContributionPromise ??= optionalCapabilities.activate('tilemap').then(active => {
    if (!active) return null;
    return import('../library/mainStarterKits');
  }).then(module => {
    if (!module) return;
    module.registerMainStarterKits({
      registerStarterKit,
      getCommandBus,
      resourcePool,
      resourceDisplayNames,
      getGlobalSettings: getSettings,
      setGlobalSettings: settings => { storeCommands.project.setSettings(settings); },
      applyGlobalSettingsToWorld,
      selectEntities,
      refreshTreeSelection,
      refreshResourcePool,
      renderGlobalSettingsPanel,
      renderInspector,
    });
    if (editorDom.starterKitDropdown) {
      editorDom.starterKitDropdown.items = getStarterKitDropdownItems();
    }
  });
  return starterKitContributionPromise;
};
const warmStarterKitContribution = (): void => {
  void loadStarterKitContribution().catch(error => reportError('Failed to load starter kits.', error));
};
editorDom.starterKitDropdown?.addEventListener('pointerenter', warmStarterKitContribution, { once: true });
editorDom.starterKitDropdown?.addEventListener('focusin', warmStarterKitContribution, { once: true });
editorDom.starterKitDropdown?.addEventListener('pointerdown', warmStarterKitContribution, { once: true });

const inspectorCommitContext: MainInspectorCommitContext = createMainInspectorCommitContext({
  editorDom,
  inspectorCommitState,
  getInspectorContext,
  getCommandBus,
  getSuppressInspectorInput: inspectorInputGuard.isActive,
  getSelectedComponentName,
  setSelectedComponentName,
  getComponentDescriptors,
  inspectorRegistry,
  resourcePool,
  getGlobalSettings: getSettings,
  setGlobalSettings: settings => { storeCommands.project.setSettings(settings); },
  applyGlobalSettingsToWorld,
  syncViewportClearColor,
  renderGlobalSettingsPanel,
  renderInspector,
  refreshEditorView,
  refreshResourcePool,
  refreshSceneTree: () => getInspectorContext()?.refreshSceneTree(),
  renderResourcePool,
  ensureCanvasTextMesh,
  syncCanvasTextGeometry,
});

function getAddComponentDropdownItems(): GEDropdownItem[] {
  return getAddComponentDropdownItemsFromDescriptors(getComponentDescriptors());
}

function getGeometryOptions(): GESelectOption[] {
  return resourcePanel.getGeometryOptions();
}

function getMaterialOptions(): GESelectOption[] {
  return resourcePanel.getMaterialOptions();
}

function getMaterial2DOptions(): GESelectOption[] {
  return resourcePanel.getMaterial2DOptions();
}

function getScriptResourceOptions(): GESelectOption[] {
  return resourcePanel.getScriptResourceOptions();
}

function getAssetRefOptions(assetType: string): GESelectOption[] {
  return resourcePanel.getAssetRefOptions(assetType);
}

resourcePanelContext = createMainResourcePanelContext({
  editorDom,
  resourcePool,
  resourceImporters,
  resourceDisplayNames,
  componentLibraries,
  resourceSelection,
  scriptEditorController,
  getCommandBus,
  getActiveScriptResource,
  setActiveScriptResource: resource => { storeCommands.project.setActiveScriptResource(resource); },
  getInspectorContext,
  getRuntimeContext,
  getMainEntityActions: () => mainEntityActions,
  getUniqueGeometryName,
  getUniqueMaterialName,
  getUniqueScriptName,
  renderInspector,
  formatNumber,
  reportError,
  ensureModelCapability: () => optionalCapabilities.activate('gltf'),
  runAssetImport,
});
resourcePanel = resourcePanelContext.resourcePanel;
resourceTabs?.addEventListener('tab-change', () => resourcePanel.renderResourcePool());
resourceSearchInput?.addEventListener('input', () => resourcePanel.renderResourcePool());

const sceneContext = createMainSceneContext({
  resourcePool,
  resourceDisplayNames,
  componentLibraries,
  authoringStore: contentAuthoringStore,
  getGlobalSettings: getSettings,
  setGlobalSettings: settings => { storeCommands.project.setSettings(settings); },
  applyGlobalSettingsToWorld,
  syncViewportClearColor,
  clearResourceSelection,
  setActiveScriptResource: resource => { storeCommands.project.setActiveScriptResource(resource); },
  setSelectedComponentName,
  renderGlobalSettingsPanel,
  refreshResourcePool,
});
const { sceneActions } = sceneContext;

const { playDevicePreview, playSession } = createMainPlayContext({
  elements: {
    playDeviceCustom,
    playDeviceDprInput,
    playDeviceWidthInput,
    playDeviceHeightInput,
    playDeviceZoomInput,
    playDeviceViewport,
    playDeviceFrame,
    playDeviceSelect,
    playOverlay,
    playFrame,
    playPauseButton,
    playOutput,
    playRuntimeInspector,
    playPerformance,
    playDiagnosticExportButton,
    playBreakpointsInput,
    playBreakpointsApplyButton,
    playBreakpointsStatus,
  },
  serializeScene: (world, signal) => sceneActions.serializeEditorScene(world, signal === undefined ? {} : { signal }),
  getSelectedEntityId: () => getInspectorContext()?.getActiveEntity()?.id ?? null,
  subscribeSelectedEntityId: listener => editorStore.subscribeSlice(
    'selection',
    snapshot => snapshot.active?.id ?? null,
    entityId => listener(entityId),
  ),
  onStateChange: state => storeCommands.play.transition(state),
  playDeviceSession: { ...editorStore.select(editorSelectors.playDevice) },
  onPlayDeviceSessionChange: session => { storeCommands.session.setPlayDevice(session); },
});

onEditorLanguageChange(() => {
  resourcePanel.renderResourcePool();
  if (resourceDetail?.hidden === false) {
    resourcePanel.refreshActiveResourceDetail();
  } else {
    resourcePanelContext.renderActiveInspector();
  }
});

mainEntityActions = createMainEntityActions({
  componentLibraries,
  resourcePool,
  createDefaultMesh2DComponent,
  getCommandBus,
  refreshTreeSelection: refreshTreeStructure,
  refreshResourcePool,
  renderInspector,
  selectEntities,
  showPrefabDetails: item => resourcePanel.showPrefabDetails(item),
  clearPrefabSelectionIf: prefabId => {
    storeCommands.selection.clearResourceIf('prefabId', prefabId);
  },
});

function updateAllResourceSelectionStates(): void {
  resourcePanelContext.updateAllResourceSelectionStates();
}

function renderResourcePool(): void {
  resourcePanelContext.renderResourcePool();
}

function reportError(message: string, error?: unknown): void {
  if (error !== undefined) console.error(message, error);
  showEditorError(getErrorMessage(error, message));
}

async function runAssetImport(
  label: string,
  prepare: (context: WorkflowPrepareContext) => Promise<PreparedResourceImport> | PreparedResourceImport,
  options: { kind?: AssetOperationKind; assetIds?: readonly string[] } = {},
): Promise<void> {
  const kind = options.kind ?? 'import';
  const assetIds = options.assetIds ?? [];
  const operation = assetOperations.begin({
    label,
    kind,
    assetIds,
    retry: () => { void runAssetImport(label, prepare, options).catch(error => reportError(`${label} failed.`, error)); },
    cancel: () => workflows.cancel('import'),
  });
  const result = await workflows.importAssets({
    prepare: context => prepare({
      signal: context.signal,
      reportProgress: progress => {
        operation.progress(progress);
        context.reportProgress(progress);
      },
    }),
    commit: prepared => storeCommands.transaction(label, () => {
      prepared.commit();
      storeCommands.project.markResourcesChanged();
    }),
    rollback: (_reason, prepared) => prepared?.dispose(),
  });
  if (result.status === 'completed') operation.complete(assetIds);
  else if (result.status === 'cancelled') operation.cancel();
  else {
    operation.fail(result.error);
    throw result.error;
  }
}

function refreshResourcePool(world: World): void {
  resourcePanelContext.refreshResourcePool(world);
}

function renderSystemPanel(onChange?: () => void): void {
  renderSystemConfigPanel({
    systemList,
    configs: sceneContext.getSystemConfigs(),
    formatNumber,
    ...(onChange === undefined ? {} : { onChange }),
  });
}

function renderKeyboardEditor(component: KeyboardComponent): void {
  if (keyboardPressedValue) {
    const snapshot = component.snapshot();
    keyboardPressedValue.textContent = snapshot.pressed.length ? snapshot.pressed.join(', ') : '-';
  }
  if (keyboardExampleCode) keyboardExampleCode.textContent = getKeyboardExample();
}

function refreshEditorView(activeEntity?: Entity | null): void {
  getInspectorContext()?.refreshSceneTree();
  const context = getInspectorContext();
  renderInspector(activeEntity ?? context?.getActiveEntity() ?? null, context?.getSelection().size ?? 0);
}

async function addModelFiles(files: FileList | File[]): Promise<void> {
  await resourcePanelContext.addModelFiles(files);
}

function commitGenericComponentEdit(): void {
  inspectorCommitContext.commitGenericComponentEdit();
}

async function addTextureFiles(files: FileList | File[]): Promise<void> {
  await resourcePanelContext.addTextureFiles(files);
}
async function addScriptFiles(files: FileList | File[]): Promise<void> {
  await resourcePanelContext.addScriptFiles(files);
}

const handleOptionalComponentSelection = (event: Event): void => {
  const detail = (event as CustomEvent<{ value?: unknown }>).detail;
  const componentType = typeof detail?.value === 'string' ? detail.value : '';
  const capability = getOptionalCapabilityForComponentType(componentType);
  if (!capability || optionalCapabilities.isActive(capability)) return;
  event.stopImmediatePropagation();
  void optionalCapabilities.activate(capability).then(active => {
    if (!active || !editorDom.addComponentDropdown) return;
    editorDom.addComponentDropdown.dispatchEvent(new CustomEvent('item-select', {
      bubbles: true,
      composed: true,
      detail,
    }));
  });
};
editorDom.addComponentDropdown?.addEventListener(
  'item-select',
  handleOptionalComponentSelection,
  { capture: true },
);

setupMainInspectorEventBindings({
  editorDom,
  inspectorState,
  inspectorCommitContext,
  getInspectorContext,
  getActiveScriptResource,
  scriptEditorController,
  getAddComponentDropdownItems,
  refreshTreeSelection,
  renderInspector,
  addTextureFiles,
  addScriptFiles,
  addModelFiles,
  reportError,
});

export async function runMainEditorApp(): Promise<void> {
  const documentRegistration = attachSceneDocumentBridge({
    get revision() { return editorStore.select(editorSelectors.projectDocument).currentRevision; },
    get savedRevision() { return editorStore.select(editorSelectors.projectDocument).savedRevision; },
    get name() { return editorStore.select(editorSelectors.projectDocument).documentName ?? 'Untitled Scene'; },
    serialize: signal => {
      const world = getRuntimeContext()?.world;
      if (!world) throw new Error('Cannot serialize the scene before the editor runtime is attached.');
      return sceneActions.serializeEditorScene(world, signal === undefined ? {} : { signal });
    },
    markSaved: revision => storeCommands.project.markSaved(
      revision,
      editorStore.select(editorSelectors.projectDocument).documentName,
    ),
    subscribe: listener => editorStore.subscribe('project.changed', listener),
  });
  const selectionRegistration = editorStore.subscribe('selection.changed', selection => {
    const entityReferences = [...selection.entities].map<EditorSelectionReference>(entity => Object.freeze({
      kind: 'scene.entity',
      id: String(entity.id),
      documentId: 'scene.current',
    }));
    const resourceReferences = Object.entries(selection.resources)
      .filter((entry): entry is [string, number] => entry[1] !== null)
      .map<EditorSelectionReference>(([kind, id]) => Object.freeze({
        kind: `scene.resource.${kind}`,
        id: String(id),
        documentId: 'scene.current',
      }));
    const items = [...entityReferences, ...resourceReferences];
    const active = selection.active
      ? items.find(item => item.kind === 'scene.entity' && item.id === String(selection.active?.id)) ?? null
      : items[0] ?? null;
    syncSceneSelection(items, active);
  });
  const initialSelection = editorStore.snapshot().selection;
  syncSceneSelection(
    [...initialSelection.entities].map(entity => ({ kind: 'scene.entity', id: String(entity.id), documentId: 'scene.current' })),
    initialSelection.active
      ? { kind: 'scene.entity', id: String(initialSelection.active.id), documentId: 'scene.current' }
      : null,
  );
  window.addEventListener('pagehide', () => {
    selectionRegistration();
    void documentRegistration.dispose();
    pendingCommandBus?.dispose();
    pendingCommandBus = null;
  }, { once: true });
  await startMainEditorWithContext({
    editorDom,
    componentLibraries,
    resourcePool,
    sceneContext,
    entityTreePresenter,
    history: {
      getCommandBus,
      setCommandBus: nextCommandBus => {
        pendingCommandBus?.dispose();
        pendingCommandBus = nextCommandBus;
      },
    },
    viewport: {
      setInspectorContext: context => { storeCommands.inspector.setContext(context); },
      attachRuntime: context => {
        storeCommands.runtime.attach(context);
        editorAssetAdapter.attachEngine(context.viewportEngine);
      },
      clearRuntime: () => {
        storeCommands.runtime.clear();
        editorAssetAdapter.attachEngine(null);
      },
      selectionState: storeCommands.selection,
      applyGlobalSettingsToWorld,
      getGlobalSettings: getSettings,
      getGlobalClearColor,
      syncViewportClearColor,
    },
    panels: {
      renderGlobalSettingsPanel,
      renderSystemPanel,
      refreshResourcePool,
      renderInspector,
    },
    selection: {
      selectEntities,
      refreshTreeSelection,
    },
    entityActions: {
      mainEntityActions,
      inspectorCommitContext,
    },
    play: {
      playDevicePreview,
      playSession,
    },
    starterKits: {
      items: starterKits,
      getDropdownItems: getStarterKitDropdownItems,
    },
    optionalCapabilities: {
      activateForProject: project => optionalCapabilities.activateForProject(project),
      subscribe: listener => optionalCapabilities.subscribe(listener),
    },
    reportError,
    workflows,
    document: {
      getState: () => editorStore.select(editorSelectors.projectDocument),
      markSceneChanged: () => storeCommands.project.markSceneChanged(),
      markSaved: (revision, name) => storeCommands.project.markSaved(revision, name),
      markOpened: name => storeCommands.project.openDocument(name),
      markRecovered: name => storeCommands.project.restoreRecovery(name),
      onChanged: listener => editorStore.subscribe('project.changed', () => listener()),
    },
    recentFiles: {
      recordRecentSceneFile: async (file, options) => {
        let handleId: string | undefined;
        if (options?.handle) {
          handleId = createRecentSceneHandleId(file);
          await saveRecentSceneHandle(handleId, options.handle);
        }
        storeCommands.session.addRecentFile({
          name: file.name,
          ...(file.webkitRelativePath ? { path: file.webkitRelativePath } : {}),
          ...(handleId === undefined ? {} : { handleId }),
        });
      },
      getRecentSceneFiles: () => editorStore.select(editorSelectors.recentFiles).map(file => ({ ...file })),
      clearRecentSceneFiles: () => {
        storeCommands.session.clearRecentFiles();
        void clearRecentSceneHandles().catch(error => reportError('Failed to clear recent scene handles.', error));
      },
      openRecentSceneFile: async file => {
        if (!file.handleId) return null;
        const result = await loadRecentSceneFileResult(file.handleId);
        if (!result) {
          storeCommands.session.removeRecentFile(file.handleId);
          void deleteRecentSceneHandle(file.handleId).catch(error => reportError('Failed to delete stale recent scene handle.', error));
          reportError(`Cannot reopen "${file.name}". Pick the scene file again to refresh permission.`);
        }
        return result;
      },
      onRecentSceneFilesChange: listener => editorStore.subscribeSelector(editorSelectors.recentFiles, () => listener()),
    },
  });
}

function createResourceSelectionAdapter() {
  const get = () => editorStore.select(editorSelectors.resourceSelection);
  return {
    get geometryId() { return get().geometryId; },
    set geometryId(value: number | null) { storeCommands.selection.setResources({ geometryId: value }); },
    get geometry2DId() { return get().geometry2DId; },
    set geometry2DId(value: number | null) { storeCommands.selection.setResources({ geometry2DId: value }); },
    get materialId() { return get().materialId; },
    set materialId(value: number | null) { storeCommands.selection.setResources({ materialId: value }); },
    get material2DId() { return get().material2DId; },
    set material2DId(value: number | null) { storeCommands.selection.setResources({ material2DId: value }); },
    get textureId() { return get().textureId; },
    set textureId(value: number | null) { storeCommands.selection.setResources({ textureId: value }); },
    get modelId() { return get().modelId; },
    set modelId(value: number | null) { storeCommands.selection.setResources({ modelId: value }); },
    get prefabId() { return get().prefabId; },
    set prefabId(value: number | null) { storeCommands.selection.setResources({ prefabId: value }); },
  };
}
