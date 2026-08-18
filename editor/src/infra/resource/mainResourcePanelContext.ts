import { ScriptComponent, type ScriptResource } from '@haiyue/engine/components';
import { type Entity, type HaiyueEngine, type World } from '@haiyue/engine';
import type { CommandBus } from '../../commands/CommandBus';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type { EditorRuntimeContext } from '../../domain/store/RuntimeState';
import { getScriptLifecycleExample } from '../../script/scriptAuthoringText';
import type { ScriptEditorControllerPort } from '../../script/ScriptEditorControllerPort';
import type { EditorResourceImporter, InspectorContext, ModelResourceItem, PreparedResourceImport } from '../../types';
import type { WorkflowPrepareContext } from '../../domain/workflows/CoreWorkflowCoordinator';
import type { ResourcePool } from '../../resources/ResourcePool';
import { getDefaultCanvasTextStyle } from '../../domain/resource/resourceDefaults';
import { updateWorldMatrix } from '../../ui/viewport/viewportInteraction';
import { PrefabInstanceComponent } from '../../scene/prefabInstance';
import { serializeEntity } from '../../domain/scene/serialization';
import type { MainEntityActions } from '../entity/mainEntityActions';
import {
  createResourcePanelAdapter,
  type ResourcePanelAdapter,
  type ResourcePanelSelection,
} from './resourcePanelAdapter';

type EditorDom = ReturnType<typeof import('../../dom').getEditorDom>;

export interface MainResourcePanelContextDeps {
  editorDom: EditorDom;
  resourcePool: ResourcePool;
  resourceImporters: EditorResourceImporter[];
  resourceDisplayNames: WeakMap<object, string>;
  componentLibraries: EditorComponentLibrary[];
  resourceSelection: ResourcePanelSelection;
  scriptEditorController: ScriptEditorControllerPort;
  getCommandBus(): CommandBus | null;
  getInspectorContext(): InspectorContext | null;
  getRuntimeContext(): EditorRuntimeContext | null;
  getActiveScriptResource(): ScriptResource | null;
  setActiveScriptResource(resource: ScriptResource | null): void;
  getMainEntityActions(): MainEntityActions;
  getUniqueGeometryName(baseName: string): string;
  getUniqueMaterialName(baseName: string): string;
  getUniqueScriptName(baseName: string): string;
  renderInspector(entity: Entity | null, selectionCount?: number): void;
  formatNumber(value: number): string;
  reportError(message: string, error?: unknown): void;
  ensureModelCapability(): Promise<boolean>;
  runAssetImport(
    label: string,
    prepare: (context: WorkflowPrepareContext) => Promise<PreparedResourceImport> | PreparedResourceImport,
    options?: { kind?: 'import' | 'reimport'; assetIds?: readonly string[] },
  ): Promise<void>;
}

export interface MainResourcePanelContext {
  resourcePanel: ResourcePanelAdapter;
  clearResourceSelection(): void;
  updateAllResourceSelectionStates(): void;
  renderResourcePool(): void;
  refreshResourcePool(world: World): void;
  renderActiveInspector(): void;
  addModelFiles(files: FileList | File[]): Promise<void>;
  addTextureFiles(files: FileList | File[]): Promise<void>;
  addScriptFiles(files: FileList | File[]): Promise<void>;
}

export function createMainResourcePanelContext(deps: MainResourcePanelContextDeps): MainResourcePanelContext {
  const bindScriptResourceToActiveScriptComponent = (
    resource: ScriptResource,
  ): { entity: Entity; component: ScriptComponent; previousResource: ScriptResource | null } | null => {
    const entity = deps.getInspectorContext()?.getActiveEntity();
    const component = entity?.getComponent(ScriptComponent);
    if (!entity || !component || component.resource) return null;
    const previousResource = component.resource;
    component.resource = resource;
    return { entity, component, previousResource };
  };

  const renderActiveInspector = (): void => {
    const context = deps.getInspectorContext();
    deps.renderInspector(context?.getActiveEntity() ?? null, context?.getSelection().size ?? 0);
  };

  const instantiateModelFromResourceCard = (item: ModelResourceItem): void => {
    const context = deps.getInspectorContext();
    const world = context?.world;
    if (!world) return;
    deps.getMainEntityActions().instantiateModelIntoScene(
      world,
      item,
      null,
      deps.editorDom.tree,
      () => context.getSelection(),
      entity => context.setActiveEntity(entity),
      selection => context.setSelection([...selection]),
    );
  };

  const syncPrefabInstancesFromResourceDetail = (item: import('../../types').PrefabResourceItem, selectedOnly = false): void => {
    const context = deps.getInspectorContext();
    if (!context) return;
    deps.getMainEntityActions().syncPrefabInstances(
      context.world,
      item,
      deps.editorDom.tree,
      () => context.getSelection(),
      entity => context.setActiveEntity(entity),
      selection => context.setSelection([...selection]),
      { selectedOnly },
    );
  };

  const createPrefabVariantFromResourceDetail = (item: import('../../types').PrefabResourceItem): void => {
    let variant: import('../../types').PrefabResourceItem | null = null;
    const execute = () => {
      variant = deps.resourcePool.createPrefabVariant(item, variant?.name, variant?.id);
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(variant);
    };
    const undo = () => {
      if (!variant) return;
      deps.resourcePool.unregisterPrefab(variant.id);
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const commandBus = deps.getCommandBus();
    if (commandBus) commandBus.execute({ label: 'Create Prefab Variant', execute, undo });
    else execute();
  };

  const rebasePrefabVariantFromResourceDetail = (item: import('../../types').PrefabResourceItem): void => {
    const beforeRoot = structuredClone(item.root);
    const beforeOverrides = item.variantOverrides ? structuredClone(item.variantOverrides) : undefined;
    const beforeBaseRevision = item.baseRevision;
    const beforeRevision = item.revision;
    const beforeBasePrefabId = item.basePrefabId;
    const execute = () => {
      deps.resourcePool.rebasePrefabVariant(item);
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const undo = () => {
      deps.resourcePool.registerPrefab(beforeRoot, item.name, item.id, {
        revision: beforeRevision,
        basePrefabId: beforeBasePrefabId,
        baseRevision: beforeBaseRevision,
        variantOverrides: beforeOverrides,
      });
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const commandBus = deps.getCommandBus();
    if (commandBus) commandBus.execute({ label: 'Merge Prefab Variant Base Changes', execute, undo });
    else execute();
  };

  const capturePrefabVariantOverridesFromSelection = (item: import('../../types').PrefabResourceItem): void => {
    if (item.basePrefabId === undefined) return;
    const context = deps.getInspectorContext();
    if (!context) return;
    const selected = [context.getActiveEntity(), ...context.getSelection()]
      .filter((entity): entity is Entity => entity != null)
      .find(entity => entity.getComponent(PrefabInstanceComponent)?.prefabId === item.id);
    if (!selected) return;
    const nextRoot = serializeEntity(selected, {
      excludePrefabInstanceForEntityIds: new Set([selected.id]),
    }, deps.componentLibraries);
    const beforeRoot = structuredClone(item.root);
    const beforeOverrides = item.variantOverrides ? structuredClone(item.variantOverrides) : undefined;
    const beforeBaseRevision = item.baseRevision;
    const beforeRevision = item.revision;
    const execute = () => {
      deps.resourcePool.updatePrefabVariantRoot(item, nextRoot);
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const undo = () => {
      deps.resourcePool.registerPrefab(beforeRoot, item.name, item.id, {
        revision: beforeRevision,
        basePrefabId: item.basePrefabId,
        baseRevision: beforeBaseRevision,
        variantOverrides: beforeOverrides,
      });
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const commandBus = deps.getCommandBus();
    if (commandBus) commandBus.execute({ label: 'Capture Prefab Variant Overrides', execute, undo });
    else execute();
  };

  const updatePrefabVariantOverrideFromDetail = (
    item: import('../../types').PrefabResourceItem,
    index: number,
    override: import('../../types').PrefabVariantOverride,
  ): void => {
    const beforeRoot = structuredClone(item.root);
    const beforeOverrides = item.variantOverrides ? structuredClone(item.variantOverrides) : undefined;
    const beforeRevision = item.revision;
    const execute = () => {
      deps.resourcePool.updatePrefabVariantOverride(item, index, override);
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const undo = () => {
      deps.resourcePool.registerPrefab(beforeRoot, item.name, item.id, {
        revision: beforeRevision,
        basePrefabId: item.basePrefabId,
        baseRevision: item.baseRevision,
        variantOverrides: beforeOverrides,
      });
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const commandBus = deps.getCommandBus();
    if (commandBus) commandBus.execute({ label: 'Edit Prefab Variant Override', execute, undo });
    else execute();
  };

  const resolvePrefabVariantFieldConflictFromDetail = (
    item: import('../../types').PrefabResourceItem,
    path: number[],
    field: string,
    resolution: 'accept-base' | 'keep-override',
  ): void => {
    const beforeRoot = structuredClone(item.root);
    const beforeOverrides = item.variantOverrides ? structuredClone(item.variantOverrides) : undefined;
    const beforeRevision = item.revision;
    const beforeBaseRevision = item.baseRevision;
    const execute = () => {
      if (resolution === 'accept-base') {
        deps.resourcePool.acceptBaseForVariantField(item, path, field);
      } else {
        deps.resourcePool.keepOverrideForVariantField(item, path, field);
      }
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const undo = () => {
      deps.resourcePool.registerPrefab(beforeRoot, item.name, item.id, {
        revision: beforeRevision,
        basePrefabId: item.basePrefabId,
        baseRevision: beforeBaseRevision,
        variantOverrides: beforeOverrides,
      });
      resourcePanel.renderResourcePool();
      resourcePanel.showPrefabDetails(item);
    };
    const commandBus = deps.getCommandBus();
    const label = resolution === 'accept-base' ? 'Accept Prefab Base Field' : 'Keep Prefab Override Field';
    if (commandBus) commandBus.execute({ label, execute, undo });
    else execute();
  };

  const resourcePanel = createResourcePanelAdapter({
    elements: {
      geometryResources: deps.editorDom.geometryResources,
      materialResources: deps.editorDom.materialResources,
      textureResources: deps.editorDom.textureResources,
      modelResources: deps.editorDom.modelResources,
      prefabResources: deps.editorDom.prefabResources,
      scriptResources: deps.editorDom.scriptResources,
      resourceSearchInput: deps.editorDom.resourceSearchInput,
    },
    detailElements: {
      entityInspectorPanel: deps.editorDom.entityInspectorPanel,
      resourceDetail: deps.editorDom.resourceDetail,
      resourceDetailTitle: deps.editorDom.resourceDetailTitle,
      resourceDetailGrid: deps.editorDom.resourceDetailGrid,
    },
    resourcePool: deps.resourcePool,
    resourceImporters: deps.resourceImporters,
    resourceDisplayNames: deps.resourceDisplayNames,
    componentLibraries: deps.componentLibraries,
    selection: deps.resourceSelection,
    getCommandBus: deps.getCommandBus,
    getActiveScriptResource: deps.getActiveScriptResource,
    setActiveScriptResource: deps.setActiveScriptResource,
    getRuntimeContext: deps.getRuntimeContext,
    getDefaultCanvasTextStyle,
    getScriptLifecycleExample,
    getUniqueGeometryName: deps.getUniqueGeometryName,
    getUniqueMaterialName: deps.getUniqueMaterialName,
    getUniqueScriptName: deps.getUniqueScriptName,
    createModelPreviewData: async src => {
      const { createModelPreviewData } = await import('../../resources/modelPreview');
      return createModelPreviewData(src, updateWorldMatrix);
    },
    bindScriptResourceToActiveScriptComponent,
    openScriptResource: resource => deps.scriptEditorController.openResource(resource),
    renderActiveInspector,
    instantiateModel: instantiateModelFromResourceCard,
    syncPrefabInstances: item => syncPrefabInstancesFromResourceDetail(item, false),
    syncSelectedPrefabInstances: item => syncPrefabInstancesFromResourceDetail(item, true),
    createPrefabVariant: createPrefabVariantFromResourceDetail,
    rebasePrefabVariant: rebasePrefabVariantFromResourceDetail,
    capturePrefabVariantOverrides: capturePrefabVariantOverridesFromSelection,
    updatePrefabVariantOverride: updatePrefabVariantOverrideFromDetail,
    resolvePrefabVariantFieldConflict: resolvePrefabVariantFieldConflictFromDetail,
    refreshResourceUsage: () => {
      const world = deps.getInspectorContext()?.world;
      if (world) deps.resourcePool.syncWorld(world);
    },
    refreshSceneTree: () => deps.getInspectorContext()?.refreshSceneTree(),
    formatNumber: deps.formatNumber,
    reportError: deps.reportError,
    ensureModelCapability: deps.ensureModelCapability,
    runAssetImport: deps.runAssetImport,
  });

  return {
    resourcePanel,
    clearResourceSelection: () => resourcePanel.clearSelection(),
    updateAllResourceSelectionStates: () => resourcePanel.updateAllSelectionStates(),
    renderResourcePool: () => resourcePanel.renderResourcePool(),
    refreshResourcePool: world => resourcePanel.refreshResourcePool(world),
    renderActiveInspector,
    addModelFiles: files => resourcePanel.addModelFiles(files),
    addTextureFiles: files => resourcePanel.addTextureFiles(files),
    addScriptFiles: files => resourcePanel.addScriptFiles(files),
  };
}
