import type { GEDropdownItem } from '@haiyue/ui';
import type { Entity } from '@haiyue/engine';
import type { ScriptComponent, ScriptResource } from '@haiyue/engine/components';
import type { getEditorDom } from '../../dom';
import type { ScriptEditorControllerPort } from '../../script/ScriptEditorControllerPort';
import type { InspectorContext } from '../../types';
import type { createInspectorCommitHandlers, InspectorCommitState } from './commitHandlers';
import { setupEditorInspectorEvents } from './inspectorEvents';

type EditorDom = ReturnType<typeof getEditorDom>;
type InspectorCommitHandlers = ReturnType<typeof createInspectorCommitHandlers>;

export interface MainInspectorEventsOptions {
  elements: EditorDom;
  inspectorCommitState: InspectorCommitState;
  inspectorCommitHandlers: InspectorCommitHandlers;
  getInspectorContext: () => InspectorContext | null;
  getSuppressInspectorInput: () => boolean;
  setSelectedComponentName: (name: string) => void;
  getActiveScriptTarget: () => ScriptComponent | ScriptResource | null;
  scriptEditorController: ScriptEditorControllerPort;
  getAddComponentDropdownItems: () => GEDropdownItem[];
  refreshCurrentTreeSelection: () => void;
  renderInspector: (entity: Entity | null, selectionCount?: number) => void;
  addTextureFiles: (files: FileList | File[]) => void | Promise<void>;
  addScriptFiles: (files: FileList | File[]) => void | Promise<void>;
  addModelFiles: (files: FileList | File[]) => void | Promise<void>;
  reportError: (message: string, error?: unknown) => void;
}

export function setupMainInspectorEvents(options: MainInspectorEventsOptions): void {
  const { elements } = options;
  setupEditorInspectorEvents({
    elements: {
      entityNameInput: elements.entityNameInput,
      selectedComponents: elements.selectedComponents,
      scriptLifecycleSelect: elements.scriptLifecycleSelect,
      scriptInsertExampleButton: elements.scriptInsertExampleButton,
      scriptEditorOverlayClose: elements.scriptEditorOverlayClose,
      scriptEditorOverlay: elements.scriptEditorOverlay,
      scriptResourceSelect: elements.scriptResourceSelect,
      addComponentButton: elements.addComponentButton,
      addComponentDropdown: elements.addComponentDropdown,
      removeComponentButton: elements.removeComponentButton,
      meshGeometrySelect: elements.meshGeometrySelect,
      meshMaterialSelect: elements.meshMaterialSelect,
      mesh2DMaterialSelect: elements.mesh2DMaterialSelect,
      cameraProjectionSelect: elements.cameraProjectionSelect,
      cameraInputs: [
        elements.cameraFovInput,
        elements.cameraNearInput,
        elements.cameraFarInput,
        elements.cameraReverseZInput,
        elements.cameraOrthoLeftInput,
        elements.cameraOrthoRightInput,
        elements.cameraOrthoTopInput,
        elements.cameraOrthoBottomInput,
        elements.camera2DWidthInput,
        elements.camera2DHeightInput,
        elements.camera2DZoomInput,
        elements.camera2DNearInput,
        elements.camera2DFarInput,
      ],
      globalInputs: [
        elements.globalGameNameInput,
        elements.globalDesignWidthInput,
        elements.globalDesignHeightInput,
        elements.globalViewportModeSelect,
        elements.globalClearColorInput,
        elements.globalClearAlphaInput,
        elements.globalReverseZInput,
        elements.globalRender2DLoadOpSelect,
        elements.globalGuiLoadOpSelect,
        elements.globalParametersInput,
      ],
      textureResources: elements.textureResources,
      scriptResources: elements.scriptResources,
      modelResources: elements.modelResources,
      positionInputs: elements.positionInputs,
      rotationInputs: elements.rotationInputs,
      scaleInputs: elements.scaleInputs,
      transform2DInputs: {
        xInput: elements.transform2DXInput,
        yInput: elements.transform2DYInput,
        rotationInput: elements.transform2DRotationInput,
        scaleXInput: elements.transform2DScaleXInput,
        scaleYInput: elements.transform2DScaleYInput,
      },
      sphericalInputs: {
        radiusInput: elements.sphericalRadiusInput,
        thetaInput: elements.sphericalThetaInput,
        phiInput: elements.sphericalPhiInput,
        targetInputs: elements.sphericalTargetInputs,
      },
      mesh2DInputs: [elements.mesh2DColorInput, elements.mesh2DAlphaInput, elements.mesh2DBlendingSelect],
      canvasTextTextInput: elements.canvasTextTextInput,
      canvasTextStyleInput: elements.canvasTextStyleInput,
      dataComponentInput: elements.dataComponentInput,
      tilemapInputs: [
        elements.tilemapColumnsInput,
        elements.tilemapRowsInput,
        elements.tilemapCellWidthInput,
        elements.tilemapCellHeightInput,
        elements.tilemapGapInput,
        elements.tilemapOriginXInput,
        elements.tilemapOriginYInput,
        elements.tilemapPaletteInput,
        elements.tilemapCellsInput,
      ],
    },
    inspectorCommitState: options.inspectorCommitState,
    inspectorCommitHandlers: options.inspectorCommitHandlers,
    getInspectorContext: options.getInspectorContext,
    getSuppressInspectorInput: options.getSuppressInspectorInput,
    setSelectedComponentName: options.setSelectedComponentName,
    getActiveScriptTarget: options.getActiveScriptTarget,
    scriptEditorController: options.scriptEditorController,
    getAddComponentDropdownItems: options.getAddComponentDropdownItems,
    refreshTreeSelection: options.refreshCurrentTreeSelection,
    renderInspector: options.renderInspector,
    addTextureFiles: options.addTextureFiles,
    addScriptFiles: options.addScriptFiles,
    addModelFiles: options.addModelFiles,
    reportError: options.reportError,
  });
}
