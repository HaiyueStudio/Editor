import type { Entity, World } from '@haiyue/engine';
import type { GETreeNodeData } from '@haiyue/ui';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type { ResourcePool } from '../../resources/ResourcePool';
import type { EditorStarterKit, InspectorContext } from '../../types';
import type { EditorRecentFileSession } from '../../domain/store/EditorStore';
import type { RecentSceneFileOpenResult } from '../file/recentSceneHandles';
import { CommandBus } from '../../commands/CommandBus';
import { setButtonDisabled } from '../inspector/inspectorUiUtils';
import type { createEntityTreePresenter } from '../../ui/entityTreePresenter';
import type { PlayDevicePreviewController } from '../../play/devicePreview';
import type { PlaySession } from '../../play/playSession';
import type { MainEntityActions } from '../entity/mainEntityActions';
import type { MainSceneContext } from '../scene/mainSceneContext';
import type { MainInspectorCommitContext } from '../inspector/mainInspectorCommitContext';
import type { CoreWorkflowCoordinator } from '../../domain/workflows/CoreWorkflowCoordinator';
import type { startMainEditorApp, MainEditorStartupDeps } from './mainStartup';
import type { OptionalEditorCapability } from '../../domain/library/optionalComponentManifest';
import { sceneEditorPlatform } from '../../platform/sceneEditorPlatform';

type EditorDom = ReturnType<typeof import('../../dom').getEditorDom>;
type EntityTreePresenter = ReturnType<typeof createEntityTreePresenter>;

export interface MainEditorStartupContextDeps {
  editorDom: EditorDom;
  componentLibraries: EditorComponentLibrary[];
  resourcePool: ResourcePool;
  sceneContext: MainSceneContext;
  entityTreePresenter: EntityTreePresenter;
  history: MainEditorHistoryContext;
  viewport: MainEditorViewportContext;
  panels: MainEditorPanelContext;
  selection: MainEditorSelectionContext;
  entityActions: MainEditorEntityActionContext;
  play: MainEditorPlayContext;
  optionalCapabilities: MainEditorOptionalCapabilitiesContext;
  recentFiles?: MainEditorRecentFileContext;
  starterKits: MainEditorStarterKitContext;
  reportError(message: string, error?: unknown): void;
  workflows: CoreWorkflowCoordinator;
  document: MainEditorDocumentContext;
}

export interface MainEditorDocumentContext {
  getState: MainEditorStartupDeps['getDocumentState'];
  markSceneChanged(): void;
  markSaved: MainEditorStartupDeps['markDocumentSaved'];
  markOpened: MainEditorStartupDeps['markDocumentOpened'];
  markRecovered: MainEditorStartupDeps['markDocumentRecovered'];
  onChanged: MainEditorStartupDeps['onProjectChanged'];
}

export interface MainEditorHistoryContext {
  getCommandBus(): CommandBus | null;
  setCommandBus(commandBus: CommandBus): void;
}

export interface MainEditorViewportContext {
  setInspectorContext(context: InspectorContext | null): void;
  attachRuntime: MainEditorStartupDeps['attachRuntime'];
  clearRuntime: MainEditorStartupDeps['clearRuntime'];
  selectionState: MainEditorStartupDeps['selectionState'];
  applyGlobalSettingsToWorld(world: World): void;
  getGlobalSettings: Parameters<typeof startMainEditorApp>[0]['getGlobalSettings'];
  getGlobalClearColor(): { r: number; g: number; b: number; a: number };
  syncViewportClearColor(engine?: Parameters<typeof startMainEditorApp>[0]['syncViewportClearColor'] extends (engine?: infer T) => void ? T : never): void;
}

export interface MainEditorPanelContext {
  renderGlobalSettingsPanel(world: World | null): void;
  renderSystemPanel(onChange?: () => void): void;
  refreshResourcePool(world: World): void;
  renderInspector(entity: Entity | null, selectionCount?: number): void;
}

export interface MainEditorSelectionContext {
  selectEntities: Parameters<typeof startMainEditorApp>[0]['selectEntities'];
  refreshTreeSelection: Parameters<typeof startMainEditorApp>[0]['refreshTreeSelection'];
}

export interface MainEditorEntityActionContext {
  mainEntityActions: MainEntityActions;
  inspectorCommitContext: MainInspectorCommitContext;
}

export interface MainEditorPlayContext {
  playDevicePreview: PlayDevicePreviewController;
  playSession: PlaySession;
}

export interface MainEditorOptionalCapabilitiesContext {
  activateForProject(project: unknown): Promise<void>;
  subscribe(
    listener: (capability: OptionalEditorCapability) => void,
  ): () => void;
}

export interface MainEditorStarterKitContext {
  items: EditorStarterKit[];
  getDropdownItems(): Array<{ label?: string; value?: string; disabled?: boolean; separator?: boolean }>;
}

export interface MainEditorRecentFileContext {
  recordRecentSceneFile?: (file: File, options?: { handle?: RecentSceneFileOpenResult['handle'] }) => void | Promise<void>;
  getRecentSceneFiles?: () => EditorRecentFileSession[];
  clearRecentSceneFiles?: () => void;
  openRecentSceneFile?: (file: EditorRecentFileSession) => Promise<RecentSceneFileOpenResult | null>;
  onRecentSceneFilesChange?: (listener: () => void) => () => void;
}

export async function startMainEditorWithContext(deps: MainEditorStartupContextDeps): Promise<void> {
  const updateHistoryButtons = (): void => {
    const commandBus = deps.history.getCommandBus();
    setButtonDisabled(deps.editorDom.undoButton, !(commandBus?.canUndo));
    setButtonDisabled(deps.editorDom.redoButton, !(commandBus?.canRedo));
  };

  // Keep the viewport/rendering runtime out of the editor shell evaluation
  // task. The visible shell and its command contexts can become responsive
  // before WebGPU systems are parsed and initialized.
  const startup = await import('./mainStartup');
  await startup.startMainEditorApp(createMainEditorStartupDeps(deps, updateHistoryButtons));
}

function createMainEditorStartupDeps(
  deps: MainEditorStartupContextDeps,
  updateHistoryButtons: () => void,
): MainEditorStartupDeps {
  return {
    editorDom: deps.editorDom,
    componentLibraries: deps.componentLibraries,
    resourcePool: deps.resourcePool,
    sceneActions: deps.sceneContext.sceneActions,
    starterKits: deps.starterKits.items,
    getStarterKitDropdownItems: deps.starterKits.getDropdownItems,
    getGlobalSettings: deps.viewport.getGlobalSettings,
    getSystemConfigs: deps.sceneContext.getSystemConfigs,
    addSystemConfig: deps.sceneContext.addSystemConfig,
    getEntityClipboard: deps.sceneContext.getEntityClipboard,
    setEntityClipboard: deps.sceneContext.setEntityClipboard,
    entityContextMenuState: deps.sceneContext.entityContextMenuState,
    entityToTreeNode: deps.entityTreePresenter.entityToTreeNode,
    getEntityIdFromNode: node => deps.entityTreePresenter.getEntityIdFromNode(node as GETreeNodeData),
    createCommandBus: () => new CommandBus(() => {
      updateHistoryButtons();
      deps.document.markSceneChanged();
    }, sceneEditorPlatform.history),
    getCommandBus: deps.history.getCommandBus,
    setCommandBus: deps.history.setCommandBus,
    updateHistoryButtons,
    setButtonDisabled,
    setInspectorContext: deps.viewport.setInspectorContext,
    attachRuntime: deps.viewport.attachRuntime,
    clearRuntime: deps.viewport.clearRuntime,
    selectionState: deps.viewport.selectionState,
    applyGlobalSettingsToWorld: deps.viewport.applyGlobalSettingsToWorld,
    getGlobalClearColor: deps.viewport.getGlobalClearColor,
    syncViewportClearColor: deps.viewport.syncViewportClearColor,
    renderGlobalSettingsPanel: deps.panels.renderGlobalSettingsPanel,
    renderSystemPanel: deps.panels.renderSystemPanel,
    refreshResourcePool: deps.panels.refreshResourcePool,
    renderInspector: deps.panels.renderInspector,
    selectEntities: deps.selection.selectEntities,
    refreshTreeSelection: deps.selection.refreshTreeSelection,
    instantiateModelIntoScene: deps.entityActions.mainEntityActions.instantiateModelIntoScene,
    instantiatePrefabIntoScene: deps.entityActions.mainEntityActions.instantiatePrefabIntoScene,
    createEntityUnderTarget: deps.entityActions.mainEntityActions.createEntityUnderTarget,
    create2DEntityUnderTarget: deps.entityActions.mainEntityActions.create2DEntityUnderTarget,
    create2DCameraUnderTarget: deps.entityActions.mainEntityActions.create2DCameraUnderTarget,
    createPrefabFromEntity: deps.entityActions.mainEntityActions.createPrefabFromEntity,
    changeMeshGeometry: deps.entityActions.inspectorCommitContext.changeMeshGeometry,
    changeMeshMaterial: deps.entityActions.inspectorCommitContext.changeMeshMaterial,
    changeMaterialTexture: deps.entityActions.inspectorCommitContext.changeMaterialTexture,
    playDevicePreview: deps.play.playDevicePreview,
    playSession: deps.play.playSession,
    activateOptionalCapabilitiesForProject:
      deps.optionalCapabilities.activateForProject,
    subscribeOptionalCapabilityActivation:
      deps.optionalCapabilities.subscribe,
    reportError: deps.reportError,
    ...(deps.recentFiles?.recordRecentSceneFile === undefined ? {} : { recordRecentSceneFile: deps.recentFiles.recordRecentSceneFile }),
    ...(deps.recentFiles?.getRecentSceneFiles === undefined ? {} : { getRecentSceneFiles: deps.recentFiles.getRecentSceneFiles }),
    ...(deps.recentFiles?.clearRecentSceneFiles === undefined ? {} : { clearRecentSceneFiles: deps.recentFiles.clearRecentSceneFiles }),
    ...(deps.recentFiles?.openRecentSceneFile === undefined ? {} : { openRecentSceneFile: deps.recentFiles.openRecentSceneFile }),
    ...(deps.recentFiles?.onRecentSceneFilesChange === undefined ? {} : { onRecentSceneFilesChange: deps.recentFiles.onRecentSceneFilesChange }),
    workflows: deps.workflows,
    getDocumentState: deps.document.getState,
    markDocumentSaved: deps.document.markSaved,
    markDocumentOpened: deps.document.markOpened,
    markDocumentRecovered: deps.document.markRecovered,
    markDocumentChanged: deps.document.markSceneChanged,
    onProjectChanged: deps.document.onChanged,
  };
}
