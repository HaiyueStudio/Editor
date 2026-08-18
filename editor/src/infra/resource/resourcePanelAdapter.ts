import type { GESelectOption } from '@haiyue/ui';
import type { BasicMaterial, PbrMaterial, HaiyueEngine, World } from '@haiyue/engine';
import type { MaterialTextureSource } from '@haiyue/engine/material';
import type { ScriptResource } from '@haiyue/engine/components';
import type { CommandBus } from '../../commands/CommandBus';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type { EditorRuntimeContext } from '../../domain/store/RuntimeState';
import type { ModelPreviewData } from '../../resources/modelPreview';
import type { ResourcePool } from '../../resources/ResourcePool';
import type {
  Geometry2DResourceItem,
  Geometry3DResourceItem,
  EditorResourceImporter,
  Material2DResourceItem,
  MaterialResourceItem,
  ModelResourceItem,
  PrefabResourceItem,
  PreparedResourceImport,
  ScriptResourceItem,
  TextureResourceItem,
} from '../../types';
import {
  createResourceCardFactories,
} from '../resource-ui/resourceCards';
import type { ResourceDetailDeps } from '../resource-ui/resourceDetails';
import {
  refreshResourcePool as refreshResourcePoolView,
  renderResourcePool as renderResourcePoolView,
  updateResourceSelectionStates,
  type ResourcePanelElements,
  type ResourceRendererDeps,
  type ResourceSelectionState,
} from '../resource-ui/resourceRenderer';
import {
  addGeometryResource as addGeometryResourceAction,
  addMaterialResource as addMaterialResourceAction,
  addScriptResource as addScriptResourceAction,
  prepareModelFiles,
  prepareScriptFiles,
  prepareTextureFiles,
  createPrefabFromModel as createPrefabFromModelAction,
  type ResourceCommandActionDeps,
} from './resourceCommandActions';
import { t } from '../options/editorOptions';
import type { WorkflowPrepareContext } from '../../domain/workflows/CoreWorkflowCoordinator';

export type { ResourcePanelElements } from '../resource-ui/resourceRenderer';

type ResourceDetailsModule = typeof import('../resource-ui/resourceDetails');

let resourceDetailsModulePromise: Promise<ResourceDetailsModule> | null = null;

function loadResourceDetailsModule(): Promise<ResourceDetailsModule> {
  resourceDetailsModulePromise ??= import('../resource-ui/resourceDetails');
  return resourceDetailsModulePromise;
}

export interface ResourcePanelSelection {
  geometryId: number | null;
  geometry2DId: number | null;
  materialId: number | null;
  material2DId: number | null;
  textureId: number | null;
  modelId: number | null;
  prefabId: number | null;
}

export interface ResourcePanelAdapterDeps {
  elements: ResourcePanelElements;
  detailElements: ResourceDetailDeps['elements'];
  resourcePool: ResourcePool;
  resourceImporters: EditorResourceImporter[];
  resourceDisplayNames: WeakMap<object, string>;
  componentLibraries: EditorComponentLibrary[];
  selection: ResourcePanelSelection;
  getCommandBus: () => CommandBus | null;
  getActiveScriptResource: () => ScriptResource | null;
  setActiveScriptResource: (resource: ScriptResource | null) => void;
  getRuntimeContext: () => EditorRuntimeContext | null;
  getDefaultCanvasTextStyle: ResourceCommandActionDeps['getDefaultCanvasTextStyle'];
  getScriptLifecycleExample: ResourceCommandActionDeps['getScriptLifecycleExample'];
  getUniqueGeometryName: (baseName: string) => string;
  getUniqueMaterialName: (baseName: string) => string;
  getUniqueScriptName: (baseName: string) => string;
  createModelPreviewData: (src: string) => Promise<ModelPreviewData>;
  bindScriptResourceToActiveScriptComponent: ResourceCommandActionDeps['bindScriptResourceToActiveScriptComponent'];
  openScriptResource: (resource: ScriptResource) => void;
  renderActiveInspector: () => void;
  instantiateModel: (item: ModelResourceItem) => void;
  syncPrefabInstances: (item: PrefabResourceItem) => void;
  syncSelectedPrefabInstances: (item: PrefabResourceItem) => void;
  createPrefabVariant: (item: PrefabResourceItem) => void;
  rebasePrefabVariant: (item: PrefabResourceItem) => void;
  capturePrefabVariantOverrides: (item: PrefabResourceItem) => void;
  updatePrefabVariantOverride: ResourceDetailDeps['updatePrefabVariantOverride'];
  resolvePrefabVariantFieldConflict: ResourceDetailDeps['resolvePrefabVariantFieldConflict'];
  refreshResourceUsage: () => void;
  refreshSceneTree: () => void;
  formatNumber: (value: number) => string;
  reportError: (message: string, error?: unknown) => void;
  ensureModelCapability: () => Promise<boolean>;
  runAssetImport: (
    label: string,
    prepare: (context: WorkflowPrepareContext) => Promise<PreparedResourceImport> | PreparedResourceImport,
    options?: { kind?: 'import' | 'reimport'; assetIds?: readonly string[] },
  ) => Promise<void>;
}

export interface ResourcePanelAdapter {
  clearSelection: () => void;
  getSelectionState: () => ResourceSelectionState;
  updateAllSelectionStates: () => void;
  addGeometryResource: (kind: string) => void;
  addMaterialResource: (kind: string) => void;
  addScriptResource: () => void;
  addModelFiles: (files: FileList | File[]) => Promise<void>;
  addTextureFiles: (files: FileList | File[]) => Promise<void>;
  addScriptFiles: (files: FileList | File[]) => Promise<void>;
  importResourceFiles: (importer: EditorResourceImporter, files: FileList | File[]) => Promise<void>;
  createPrefabFromModel: (model: ModelResourceItem) => void;
  openScriptResource: (resource: ScriptResource) => void;
  enrichModelResource: (item: ModelResourceItem) => Promise<void>;
  renderResourcePool: () => void;
  refreshActiveResourceDetail: () => boolean;
  refreshResourcePool: (world: World) => void;
  showGeometryDetails: (item: Geometry3DResourceItem) => void;
  showGeometry2DDetails: (item: Geometry2DResourceItem) => void;
  showMaterialDetails: (item: MaterialResourceItem) => void;
  showMaterial2DDetails: (item: Material2DResourceItem) => void;
  showTextureDetails: (item: TextureResourceItem) => void;
  showModelDetails: (item: ModelResourceItem) => void;
  showPrefabDetails: (item: PrefabResourceItem) => void;
  showScriptResourceDetails: (item: ScriptResourceItem) => void;
  getGeometryOptions: () => GESelectOption[];
  getMaterialOptions: () => GESelectOption[];
  getMaterial2DOptions: () => GESelectOption[];
  getScriptResourceOptions: () => GESelectOption[];
  getAssetRefOptions: (assetType: string) => GESelectOption[];
}

export function createResourcePanelAdapter(deps: ResourcePanelAdapterDeps): ResourcePanelAdapter {
  let adapter: ResourcePanelAdapter;
  let detailRenderToken = 0;

  const getSelectionState = (): ResourceSelectionState => ({
    selectedGeometryId: deps.selection.geometryId,
    selectedGeometry2DId: deps.selection.geometry2DId,
    selectedMaterialId: deps.selection.materialId,
    selectedMaterial2DId: deps.selection.material2DId,
    selectedTextureId: deps.selection.textureId,
    selectedModelId: deps.selection.modelId,
    selectedPrefabId: deps.selection.prefabId,
    activeScriptResourceId: deps.getActiveScriptResource()?.id ?? null,
  });

  const updateAllSelectionStates = () => {
    updateResourceSelectionStates(deps.elements, getSelectionState());
  };

  const clearSelection = () => {
    deps.selection.geometryId = null;
    deps.selection.geometry2DId = null;
    deps.selection.materialId = null;
    deps.selection.material2DId = null;
    deps.selection.textureId = null;
    deps.selection.modelId = null;
    deps.selection.prefabId = null;
  };

  const setDetailSelection = (state: ResourceSelectionState, scriptResource: ScriptResource | null) => {
    deps.selection.geometryId = state.selectedGeometryId;
    deps.selection.geometry2DId = state.selectedGeometry2DId;
    deps.selection.materialId = state.selectedMaterialId;
    deps.selection.material2DId = state.selectedMaterial2DId;
    deps.selection.textureId = state.selectedTextureId;
    deps.selection.modelId = state.selectedModelId;
    deps.selection.prefabId = state.selectedPrefabId;
    deps.setActiveScriptResource(scriptResource);
  };

  const markSelectedResourceUpdated = () => {
    const state = getSelectionState();
    if (state.selectedGeometryId !== null) deps.resourcePool.markUpdated('geometry3d', state.selectedGeometryId);
    else if (state.selectedGeometry2DId !== null) deps.resourcePool.markUpdated('geometry2d', state.selectedGeometry2DId);
    else if (state.selectedMaterialId !== null) deps.resourcePool.markUpdated('material3d', state.selectedMaterialId);
    else if (state.selectedMaterial2DId !== null) deps.resourcePool.markUpdated('material2d', state.selectedMaterial2DId);
    else if (state.selectedTextureId !== null) deps.resourcePool.markUpdated('texture', state.selectedTextureId);
    else if (state.selectedModelId !== null) deps.resourcePool.markUpdated('model', state.selectedModelId);
    else if (state.selectedPrefabId !== null) deps.resourcePool.markUpdated('prefab', state.selectedPrefabId);
    else if (state.activeScriptResourceId !== null) deps.resourcePool.markUpdated('script', state.activeScriptResourceId);
  };

  const renderEditedResourcePool = () => {
    markSelectedResourceUpdated();
    adapter.renderResourcePool();
  };

  const refreshMaterialTextureEdit = () => {
    markSelectedResourceUpdated();
    deps.refreshResourceUsage();
    adapter.renderResourcePool();
    adapter.refreshActiveResourceDetail();
  };

  const editMaterialTexture = (material: BasicMaterial, texture: MaterialTextureSource): void => {
    if (material.texture === texture) return;
    const before = material.texture;
    const execute = () => {
      material.texture = texture;
      refreshMaterialTextureEdit();
    };
    const undo = () => {
      material.texture = before;
      refreshMaterialTextureEdit();
    };
    const commandBus = deps.getCommandBus();
    if (commandBus) commandBus.execute({ label: 'Change Material Texture', execute, undo });
    else execute();
  };

  const editPbrMaterial = (
    _material: PbrMaterial,
    label: string,
    executeEdit: () => void,
    undoEdit: () => void,
  ): void => {
    const execute = () => {
      executeEdit();
      refreshMaterialTextureEdit();
    };
    const undo = () => {
      undoEdit();
      refreshMaterialTextureEdit();
    };
    const commandBus = deps.getCommandBus();
    if (commandBus) commandBus.execute({ label, execute, undo });
    else execute();
  };

  const getDetailDeps = (): ResourceDetailDeps => ({
    elements: deps.detailElements,
    resourcePool: deps.resourcePool,
    resourceDisplayNames: deps.resourceDisplayNames,
    formatNumber: deps.formatNumber,
    renderResourcePool: renderEditedResourcePool,
    setSelection: setDetailSelection,
    updateSelectionStates: updateAllSelectionStates,
    enrichModelResource: adapter.enrichModelResource,
    instantiateModel: deps.instantiateModel,
    createPrefabFromModel: adapter.createPrefabFromModel,
    syncPrefabInstances: deps.syncPrefabInstances,
    syncSelectedPrefabInstances: deps.syncSelectedPrefabInstances,
    editMaterialTexture,
    editPbrMaterial,
    createPrefabVariant: deps.createPrefabVariant,
    rebasePrefabVariant: deps.rebasePrefabVariant,
    capturePrefabVariantOverrides: deps.capturePrefabVariantOverrides,
    updatePrefabVariantOverride: deps.updatePrefabVariantOverride,
    resolvePrefabVariantFieldConflict: deps.resolvePrefabVariantFieldConflict,
    refreshSceneTree: deps.refreshSceneTree,
  });

  const showResourceDetail = (
    render: (module: ResourceDetailsModule, detailDeps: ResourceDetailDeps) => void,
  ): void => {
    const token = ++detailRenderToken;
    void loadResourceDetailsModule()
      .then(module => {
        if (token !== detailRenderToken) return;
        render(module, getDetailDeps());
      })
      .catch(error => deps.reportError('Failed to load resource detail panel.', error));
  };

  const getCommandDeps = (): ResourceCommandActionDeps => ({
    getCommandBus: deps.getCommandBus,
    resourcePool: deps.resourcePool,
    resourceDisplayNames: deps.resourceDisplayNames,
    componentLibraries: deps.componentLibraries,
    getDefaultCanvasTextStyle: deps.getDefaultCanvasTextStyle,
    getScriptLifecycleExample: deps.getScriptLifecycleExample,
    getUniqueGeometryName: deps.getUniqueGeometryName,
    getUniqueMaterialName: deps.getUniqueMaterialName,
    getUniqueScriptName: deps.getUniqueScriptName,
    createModelPreviewData: deps.createModelPreviewData,
    bindScriptResourceToActiveScriptComponent: deps.bindScriptResourceToActiveScriptComponent,
    getActiveScriptResource: deps.getActiveScriptResource,
    setActiveScriptResource: deps.setActiveScriptResource,
    getRuntimeContext: deps.getRuntimeContext,
    clearGeometrySelectionIf: id => {
      deps.selection.geometryId = deps.selection.geometryId === id ? null : deps.selection.geometryId;
    },
    clearGeometry2DSelectionIf: id => {
      deps.selection.geometry2DId = deps.selection.geometry2DId === id ? null : deps.selection.geometry2DId;
    },
    clearMaterialSelectionIf: id => {
      deps.selection.materialId = deps.selection.materialId === id ? null : deps.selection.materialId;
    },
    clearModelSelectionIf: id => {
      deps.selection.modelId = deps.selection.modelId === id ? null : deps.selection.modelId;
    },
    clearPrefabSelectionIf: id => {
      deps.selection.prefabId = deps.selection.prefabId === id ? null : deps.selection.prefabId;
    },
    renderResourcePool: () => adapter.renderResourcePool(),
    renderActiveInspector: deps.renderActiveInspector,
    showGeometryDetails: item => adapter.showGeometryDetails(item),
    showGeometry2DDetails: item => adapter.showGeometry2DDetails(item),
    showMaterialDetails: item => adapter.showMaterialDetails(item),
    showScriptResourceDetails: item => adapter.showScriptResourceDetails(item),
    showTextureDetails: item => adapter.showTextureDetails(item),
    showModelDetails: item => adapter.showModelDetails(item),
    showPrefabDetails: item => adapter.showPrefabDetails(item),
    reportError: deps.reportError,
  });

  const getRendererDeps = (): ResourceRendererDeps => ({
    elements: deps.elements,
    resourcePool: deps.resourcePool,
    resourceImporters: deps.resourceImporters,
    factories: createResourceCardFactories({
      getSelectionState,
      callbacks: {
        addGeometryResource: kind => adapter.addGeometryResource(kind),
        showGeometryDetails: item => adapter.showGeometryDetails(item),
        showGeometry2DDetails: item => adapter.showGeometry2DDetails(item),
        addMaterialResource: kind => adapter.addMaterialResource(kind),
        showMaterialDetails: item => adapter.showMaterialDetails(item),
        showMaterial2DDetails: item => adapter.showMaterial2DDetails(item),
        addTextureFiles: files => adapter.addTextureFiles(files),
        showTextureDetails: item => adapter.showTextureDetails(item),
        addModelFiles: files => adapter.addModelFiles(files),
        importResourceFiles: (importer, files) => adapter.importResourceFiles(importer, files),
        reportError: deps.reportError,
        showModelDetails: item => adapter.showModelDetails(item),
        instantiateModel: deps.instantiateModel,
        showPrefabDetails: item => adapter.showPrefabDetails(item),
        addScriptResource: () => adapter.addScriptResource(),
        showScriptResourceDetails: item => adapter.showScriptResourceDetails(item),
        openScriptResource: resource => adapter.openScriptResource(resource),
      },
    }),
  });

  const refreshActiveResourceDetail = (): boolean => {
    if (deps.selection.geometryId !== null) {
      const item = deps.resourcePool.geometries.get(deps.selection.geometryId);
      if (item) {
        adapter.showGeometryDetails(item);
        return true;
      }
    }
    if (deps.selection.geometry2DId !== null) {
      const item = deps.resourcePool.geometries2D.get(deps.selection.geometry2DId);
      if (item) {
        adapter.showGeometry2DDetails(item);
        return true;
      }
    }
    if (deps.selection.materialId !== null) {
      const item = deps.resourcePool.materials.get(deps.selection.materialId);
      if (item) {
        adapter.showMaterialDetails(item);
        return true;
      }
    }
    if (deps.selection.material2DId !== null) {
      const item = deps.resourcePool.materials2D.get(deps.selection.material2DId);
      if (item) {
        adapter.showMaterial2DDetails(item);
        return true;
      }
    }
    if (deps.selection.textureId !== null) {
      const item = deps.resourcePool.textures.get(deps.selection.textureId);
      if (item) {
        adapter.showTextureDetails(item);
        return true;
      }
    }
    if (deps.selection.modelId !== null) {
      const item = deps.resourcePool.models.get(deps.selection.modelId);
      if (item) {
        adapter.showModelDetails(item);
        return true;
      }
    }
    if (deps.selection.prefabId !== null) {
      const item = deps.resourcePool.prefabs.get(deps.selection.prefabId);
      if (item) {
        adapter.showPrefabDetails(item);
        return true;
      }
    }
    const activeScriptId = deps.getActiveScriptResource()?.id ?? null;
    if (activeScriptId !== null) {
      const item = deps.resourcePool.scripts.get(activeScriptId);
      if (item) {
        adapter.showScriptResourceDetails(item);
        return true;
      }
    }
    return false;
  };

  adapter = {
    clearSelection,
    getSelectionState,
    updateAllSelectionStates,
    addGeometryResource: kind => addGeometryResourceAction(getCommandDeps(), kind),
    addMaterialResource: kind => addMaterialResourceAction(getCommandDeps(), kind),
    addScriptResource: () => addScriptResourceAction(getCommandDeps()),
    addModelFiles: async files => {
      const selectedFiles = Array.from(files);
      if (!await deps.ensureModelCapability()) return;
      await deps.runAssetImport('Import model resources', context => prepareModelFiles(getCommandDeps(), selectedFiles, context));
    },
    addTextureFiles: files => deps.runAssetImport('Import texture resources', context => prepareTextureFiles(getCommandDeps(), files, context)),
    addScriptFiles: files => deps.runAssetImport('Import script resources', context => prepareScriptFiles(getCommandDeps(), files, context)),
    importResourceFiles: async (importer, files) => {
      try {
        await deps.runAssetImport(`Import ${importer.label}`, context => importer.prepareImport(files, context));
      } catch (error) {
        deps.reportError(`Failed to import ${importer.label}.`, error);
      }
    },
    createPrefabFromModel: model => createPrefabFromModelAction(getCommandDeps(), model),
    openScriptResource: resource => {
      deps.setActiveScriptResource(resource);
      deps.openScriptResource(resource);
      updateAllSelectionStates();
    },
    enrichModelResource: async item => {
      if (item.previewUrl && item.vertexCount !== undefined && item.triangleCount !== undefined && item.assetStats && item.compatibilityReport) return;
      try {
        await deps.runAssetImport(`Refresh ${item.name}`, async context => {
          context.reportProgress({ current: 0, total: 1, message: `Reading ${item.name}` });
          const previewData = await deps.createModelPreviewData(item.src);
          context.signal.throwIfAborted();
          return {
            resourceCount: 1,
            commit: () => {
              item.previewUrl = previewData.previewUrl;
              item.vertexCount = previewData.vertexCount;
              item.triangleCount = previewData.triangleCount;
              item.assetStats = previewData.assetStats;
              item.compatibilityReport = previewData.compatibilityReport;
              item.previewError = undefined;
              deps.resourcePool.registerModel(item.src, {
                id: item.id,
                name: item.name,
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
              adapter.renderResourcePool();
              if (deps.selection.modelId === item.id) adapter.showModelDetails(item);
            },
            dispose: () => {},
          };
        }, { kind: 'reimport', assetIds: [`model:${item.id}`] });
      } catch (error) {
        item.previewError = error instanceof Error ? error.message : String(error);
        adapter.renderResourcePool();
        if (deps.selection.modelId === item.id) adapter.showModelDetails(item);
      }
    },
    renderResourcePool: () => renderResourcePoolView(getRendererDeps()),
    refreshActiveResourceDetail,
    refreshResourcePool: world => refreshResourcePoolView(deps.resourcePool, world, adapter.renderResourcePool),
    showGeometryDetails: item => showResourceDetail((module, detailDeps) => module.showGeometryDetails(detailDeps, item)),
    showGeometry2DDetails: item => showResourceDetail((module, detailDeps) => module.showGeometry2DDetails(detailDeps, item)),
    showMaterialDetails: item => showResourceDetail((module, detailDeps) => module.showMaterialDetails(detailDeps, item)),
    showMaterial2DDetails: item => showResourceDetail((module, detailDeps) => module.showMaterial2DDetails(detailDeps, item)),
    showTextureDetails: item => showResourceDetail((module, detailDeps) => module.showTextureDetails(detailDeps, item)),
    showModelDetails: item => showResourceDetail((module, detailDeps) => module.showModelDetails(detailDeps, item)),
    showPrefabDetails: item => showResourceDetail((module, detailDeps) => module.showPrefabDetails(detailDeps, item)),
    showScriptResourceDetails: item => showResourceDetail((module, detailDeps) => module.showScriptResourceDetails(detailDeps, item)),
    getGeometryOptions: () => [...deps.resourcePool.geometries.values()].map(item => ({
      label: item.name,
      value: String(item.resource.id),
    })),
    getMaterialOptions: () => [...deps.resourcePool.materials.values()].map(item => ({
      label: item.name,
      value: String(item.resource.id),
    })),
    getMaterial2DOptions: () => [...deps.resourcePool.materials2D.values()].map(item => ({
      label: item.name,
      value: String(item.resource.id),
    })),
    getScriptResourceOptions: () => [
      { label: t('empty.noScript'), value: '' },
      ...[...deps.resourcePool.scripts.values()].map(item => ({
        label: item.name,
        value: String(item.id),
      })),
    ],
    getAssetRefOptions: (assetType: string) => {
      switch (assetType.toLowerCase()) {
      case 'geometry':
      case 'geometry3d':
        return adapter.getGeometryOptions();
      case 'geometry2d':
        return [...deps.resourcePool.geometries2D.values()].map(item => ({
          label: item.name,
          value: String(item.resource.id),
        }));
      case 'material':
      case 'material3d':
        return adapter.getMaterialOptions();
      case 'material2d':
        return adapter.getMaterial2DOptions();
      case 'script':
        return adapter.getScriptResourceOptions();
      case 'model':
      case 'gltf':
        return [...deps.resourcePool.models.values()].map(item => ({
          label: item.name,
          value: String(item.id),
        }));
      case 'texture':
        return [...deps.resourcePool.textures.values()].map(item => ({
          label: item.name,
          value: String(item.id),
        }));
      case 'prefab':
        return [...deps.resourcePool.prefabs.values()].map(item => ({
          label: item.name,
          value: String(item.id),
        }));
      default:
        return [];
      }
    },
  };

  return adapter;
}
