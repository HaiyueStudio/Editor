import type { Entity, Geometry3D, World } from '@haiyue/engine';
import type { Material } from '@haiyue/engine/material';
import type { CommandBus } from '../commands/CommandBus';
import type { SerializedGlobalSettings } from '../export/runtimeScene';
import type { ResourcePool } from '../resources/ResourcePool';
import type { EditorComponentDescriptor,
  InspectorContext,
  TextureSource } from '../types';
import {
  cloneGlobalSettings,
  normalizeGlobalSettings,
  } from '../domain/settings/globalSettings';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import {
  createInspectorCommitHandlers,
  type InspectorCommitState,
} from '../infra/inspector/commitHandlers';
import type { InspectorRegistry } from '../infra/inspector/InspectorRegistry';

type EditorDom = ReturnType<typeof import('../dom').getEditorDom>;
type InspectorCommitHandlers = ReturnType<typeof createInspectorCommitHandlers>;

export interface EditorInspectorAdapterOptions {
  editorDom: EditorDom;
  inspectorCommitState: InspectorCommitState;
  getInspectorContext(): InspectorContext | null;
  getCommandBus(): CommandBus | null;
  getSuppressInspectorInput(): boolean;
  getSelectedComponentName(): string;
  setSelectedComponentName(componentName: string): void;
  getComponentDescriptors(): EditorComponentDescriptor[];
  inspectorRegistry?: InspectorRegistry;
  resourcePool: ResourcePool;
  getGlobalSettings(): SerializedGlobalSettings;
  setGlobalSettings(settings: SerializedGlobalSettings): void;
  applyGlobalSettingsToWorld(world: World): void;
  syncViewportClearColor(): void;
  renderGlobalSettingsPanel(world: World | null): void;
  renderInspector(entity: Entity | null, selectionCount?: number): void;
  refreshEditorView(entity?: Entity | null): void;
  refreshResourcePool(world: World): void;
  refreshSceneTree(): void;
  renderResourcePool(): void;
  ensureCanvasTextMesh(entity: Entity, component: CanvasTextComponent): void;
  syncCanvasTextGeometry(entity: Entity, component: CanvasTextComponent): void;
}

export interface EditorInspectorAdapterResult {
  inspectorCommitHandlers: InspectorCommitHandlers;
  commitGenericComponentEdit(): void;
  changeMeshGeometry(entity: Entity, nextGeometry: Geometry3D): boolean;
  changeMeshMaterial(entity: Entity, nextMaterial: Material): boolean;
  changeMaterialTexture(entity: Entity, texture: TextureSource): boolean;
}

export function createEditorInspectorAdapter(options: EditorInspectorAdapterOptions): EditorInspectorAdapterResult {
  const { editorDom } = options;
  const inspectorCommitHandlers = createInspectorCommitHandlers({
    state: options.inspectorCommitState,
    getInspectorContext: options.getInspectorContext,
    getCommandBus: options.getCommandBus,
    getSuppressInspectorInput: options.getSuppressInspectorInput,
    getSelectedComponentName: options.getSelectedComponentName,
    setSelectedComponentName: options.setSelectedComponentName,
    getComponentDescriptors: options.getComponentDescriptors,
    ...(options.inspectorRegistry === undefined ? {} : { inspectorRegistry: options.inspectorRegistry }),
    resourcePool: options.resourcePool,
    getGlobalSettings: options.getGlobalSettings,
    setGlobalSettings: options.setGlobalSettings,
    cloneGlobalSettings,
    normalizeGlobalSettings,
    applyGlobalSettingsToWorld: options.applyGlobalSettingsToWorld,
    syncViewportClearColor: options.syncViewportClearColor,
    renderGlobalSettingsPanel: options.renderGlobalSettingsPanel,
    renderInspector: options.renderInspector,
    refreshEditorView: options.refreshEditorView,
    refreshResourcePool: options.refreshResourcePool,
    refreshSceneTree: options.refreshSceneTree,
    renderResourcePool: options.renderResourcePool,
    ensureCanvasTextMesh: options.ensureCanvasTextMesh,
    syncCanvasTextGeometry: options.syncCanvasTextGeometry,
    entityNameInput: editorDom.entityNameInput,
    globalInputs: {
      gameNameInput: editorDom.globalGameNameInput,
      designWidthInput: editorDom.globalDesignWidthInput,
      designHeightInput: editorDom.globalDesignHeightInput,
      viewportModeSelect: editorDom.globalViewportModeSelect,
      clearColorInput: editorDom.globalClearColorInput,
      clearAlphaInput: editorDom.globalClearAlphaInput,
      reverseZInput: editorDom.globalReverseZInput,
      render2DLoadOpSelect: editorDom.globalRender2DLoadOpSelect,
      guiLoadOpSelect: editorDom.globalGuiLoadOpSelect,
      parametersInput: editorDom.globalParametersInput,
    },
    cameraInputs: {
      projectionSelect: editorDom.cameraProjectionSelect,
      fovInput: editorDom.cameraFovInput,
      nearInput: editorDom.cameraNearInput,
      farInput: editorDom.cameraFarInput,
      reverseZInput: editorDom.cameraReverseZInput,
      orthoLeftInput: editorDom.cameraOrthoLeftInput,
      orthoRightInput: editorDom.cameraOrthoRightInput,
      orthoTopInput: editorDom.cameraOrthoTopInput,
      orthoBottomInput: editorDom.cameraOrthoBottomInput,
      camera2DWidthInput: editorDom.camera2DWidthInput,
      camera2DHeightInput: editorDom.camera2DHeightInput,
      camera2DZoomInput: editorDom.camera2DZoomInput,
      camera2DNearInput: editorDom.camera2DNearInput,
      camera2DFarInput: editorDom.camera2DFarInput,
    },
    componentInputs: {
      mesh2DColorInput: editorDom.mesh2DColorInput,
      mesh2DAlphaInput: editorDom.mesh2DAlphaInput,
      mesh2DBlendingSelect: editorDom.mesh2DBlendingSelect,
      canvasTextTextInput: editorDom.canvasTextTextInput,
      canvasTextStyleInput: editorDom.canvasTextStyleInput,
      dataComponentInput: editorDom.dataComponentInput,
      tilemapColumnsInput: editorDom.tilemapColumnsInput,
      tilemapRowsInput: editorDom.tilemapRowsInput,
      tilemapCellWidthInput: editorDom.tilemapCellWidthInput,
      tilemapCellHeightInput: editorDom.tilemapCellHeightInput,
      tilemapGapInput: editorDom.tilemapGapInput,
      tilemapOriginXInput: editorDom.tilemapOriginXInput,
      tilemapOriginYInput: editorDom.tilemapOriginYInput,
      tilemapPaletteInput: editorDom.tilemapPaletteInput,
      tilemapCellsInput: editorDom.tilemapCellsInput,
      genericComponentFields: editorDom.genericComponentFields,
    },
  });

  return {
    inspectorCommitHandlers,
    commitGenericComponentEdit: () => inspectorCommitHandlers.commitGenericComponentEdit(),
    changeMeshGeometry: (entity, nextGeometry) => inspectorCommitHandlers.changeMeshGeometry(entity, nextGeometry),
    changeMeshMaterial: (entity, nextMaterial) => inspectorCommitHandlers.changeMeshMaterial(entity, nextMaterial),
    changeMaterialTexture: (entity, texture) => inspectorCommitHandlers.changeMaterialTexture(entity, texture),
  };
}
