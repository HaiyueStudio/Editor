import type { GEDropdownItem, GESelectOption } from '@haiyue/ui';
import type { Entity } from '@haiyue/engine';
import type { KeyboardComponent } from '@haiyue/engine/components';
import type { getEditorDom } from '../../dom';
import type { InspectorInputGuard } from './inspectorInputGuard';
import { InspectorRegistry } from './InspectorRegistry';
import { registerDefaultInspectorRenderers, renderInspectorView } from './inspectorRenderer';

type EditorDom = ReturnType<typeof getEditorDom>;

export interface MainInspectorRendererOptions {
  elements: EditorDom;
  inspectorInputGuard: InspectorInputGuard;
  getSelectedComponentName: () => string;
  setSelectedComponentName: (name: string) => void;
  clearResourceSelection: () => void;
  clearActiveScriptResource: () => void;
  updateAllResourceSelectionStates: () => void;
  getComponentOptions: (entity: Entity) => GESelectOption[];
  getAddComponentDropdownItems: () => GEDropdownItem[];
  getGeometryOptions: () => GESelectOption[];
  getMaterialOptions: () => GESelectOption[];
  getMaterial2DOptions: () => GESelectOption[];
  getScriptResourceOptions: () => GESelectOption[];
  getAssetRefOptions?: (assetType: string) => GESelectOption[];
  formatNumber: (value: number) => string;
  commitGenericComponentEdit: () => void;
  renderKeyboardEditor: (component: KeyboardComponent) => void;
  inspectorRegistry?: InspectorRegistry;
  getSelection?: () => ReadonlySet<Entity>;
}

export function createMainInspectorRenderer(options: MainInspectorRendererOptions): (entity: Entity | null, selectionCount?: number) => void {
  const { elements } = options;
  const inspectorRegistry = options.inspectorRegistry ?? new InspectorRegistry();
  if (!options.inspectorRegistry) registerDefaultInspectorRenderers(inspectorRegistry);
  return (entity: Entity | null, selectionCount = entity ? 1 : 0): void => {
    options.inspectorInputGuard.run(() => renderInspectorView({
      elements: {
        entityInspectorPanel: elements.entityInspectorPanel,
        resourceDetail: elements.resourceDetail,
        resourceDetailGrid: elements.resourceDetailGrid,
        inspectorEmpty: elements.inspectorEmpty,
        inspectorForm: elements.inspectorForm,
        entityNameInput: elements.entityNameInput,
        entityIdValue: elements.entityIdValue,
        selectedComponents: elements.selectedComponents,
        addComponentDropdown: elements.addComponentDropdown,
        removeComponentButton: elements.removeComponentButton,
        componentSectionTitle: elements.componentSectionTitle,
        componentEditorEmpty: elements.componentEditorEmpty,
        genericComponentSection: elements.genericComponentSection,
        genericComponentTitle: elements.genericComponentTitle,
        genericComponentFields: elements.genericComponentFields,
        transformSection: elements.transformSection,
        cartesianTransformFields: elements.cartesianTransformFields,
        sphericalTransformFields: elements.sphericalTransformFields,
        transformNote: elements.transformNote,
        meshSection: elements.meshSection,
        meshGeometrySelect: elements.meshGeometrySelect,
        meshMaterialSelect: elements.meshMaterialSelect,
        transform2DSection: elements.transform2DSection,
        transform2DXInput: elements.transform2DXInput,
        transform2DYInput: elements.transform2DYInput,
        transform2DRotationInput: elements.transform2DRotationInput,
        transform2DScaleXInput: elements.transform2DScaleXInput,
        transform2DScaleYInput: elements.transform2DScaleYInput,
        mesh2DSection: elements.mesh2DSection,
        mesh2DMaterialSelect: elements.mesh2DMaterialSelect,
        mesh2DColorInput: elements.mesh2DColorInput,
        mesh2DAlphaInput: elements.mesh2DAlphaInput,
        mesh2DBlendingSelect: elements.mesh2DBlendingSelect,
        canvasTextSection: elements.canvasTextSection,
        canvasTextTextInput: elements.canvasTextTextInput,
        canvasTextStyleInput: elements.canvasTextStyleInput,
        dataComponentSection: elements.dataComponentSection,
        dataComponentInput: elements.dataComponentInput,
        tilemap2DSection: elements.tilemap2DSection,
        tilemapColumnsInput: elements.tilemapColumnsInput,
        tilemapRowsInput: elements.tilemapRowsInput,
        tilemapCellWidthInput: elements.tilemapCellWidthInput,
        tilemapCellHeightInput: elements.tilemapCellHeightInput,
        tilemapGapInput: elements.tilemapGapInput,
        tilemapOriginXInput: elements.tilemapOriginXInput,
        tilemapOriginYInput: elements.tilemapOriginYInput,
        tilemapPaletteInput: elements.tilemapPaletteInput,
        tilemapCellsInput: elements.tilemapCellsInput,
        keyboardSection: elements.keyboardSection,
        cameraSection: elements.cameraSection,
        cameraSectionTitle: elements.cameraSectionTitle,
        camera3DFields: elements.camera3DFields,
        camera2DFields: elements.camera2DFields,
        cameraProjectionSelect: elements.cameraProjectionSelect,
        cameraFovInput: elements.cameraFovInput,
        cameraNearInput: elements.cameraNearInput,
        cameraFarInput: elements.cameraFarInput,
        cameraReverseZInput: elements.cameraReverseZInput,
        cameraOrthoLeftInput: elements.cameraOrthoLeftInput,
        cameraOrthoRightInput: elements.cameraOrthoRightInput,
        cameraOrthoTopInput: elements.cameraOrthoTopInput,
        cameraOrthoBottomInput: elements.cameraOrthoBottomInput,
        camera2DWidthInput: elements.camera2DWidthInput,
        camera2DHeightInput: elements.camera2DHeightInput,
        camera2DZoomInput: elements.camera2DZoomInput,
        camera2DNearInput: elements.camera2DNearInput,
        camera2DFarInput: elements.camera2DFarInput,
        scriptSection: elements.scriptSection,
        scriptResourceSelect: elements.scriptResourceSelect,
        positionInputs: elements.positionInputs.filter((input): input is HTMLInputElement => input !== null),
        rotationInputs: elements.rotationInputs.filter((input): input is HTMLInputElement => input !== null),
        scaleInputs: elements.scaleInputs.filter((input): input is HTMLInputElement => input !== null),
        sphericalRadiusInput: elements.sphericalRadiusInput,
        sphericalThetaInput: elements.sphericalThetaInput,
        sphericalPhiInput: elements.sphericalPhiInput,
        sphericalTargetInputs: elements.sphericalTargetInputs.filter((input): input is HTMLInputElement => input !== null),
      },
      getSelectedComponentName: options.getSelectedComponentName,
      setSelectedComponentName: options.setSelectedComponentName,
      clearResourceSelection: options.clearResourceSelection,
      clearActiveScriptResource: options.clearActiveScriptResource,
      updateAllResourceSelectionStates: options.updateAllResourceSelectionStates,
      getComponentOptions: options.getComponentOptions,
      getAddComponentDropdownItems: options.getAddComponentDropdownItems,
      getGeometryOptions: options.getGeometryOptions,
      getMaterialOptions: options.getMaterialOptions,
      getMaterial2DOptions: options.getMaterial2DOptions,
      getScriptResourceOptions: options.getScriptResourceOptions,
      ...(options.getAssetRefOptions === undefined ? {} : { getAssetRefOptions: options.getAssetRefOptions }),
      formatNumber: options.formatNumber,
      commitGenericComponentEdit: options.commitGenericComponentEdit,
      renderKeyboardEditor: options.renderKeyboardEditor,
      inspectorRegistry,
      ...(options.getSelection === undefined ? {} : { getSelection: options.getSelection }),
    }, entity, selectionCount));
  };
}
