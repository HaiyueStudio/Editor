import type {
  GEDropdownItem,
  GESelectOption } from '@haiyue/ui';
import { Camera2D, Camera3D, CartesianTransform3D, Mesh2D, Mesh3D, SphericalTransform3D, Transform2D, type Component, type Entity, type Material2D, type Geometry3D } from '@haiyue/engine';
import { DataComponent, KeyboardComponent, ScriptComponent, Transform3D } from '@haiyue/engine/components';
import { type Material } from '@haiyue/engine/material';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import { Tilemap2DComponent } from '@haiyue/extensions/tilemap';
import {
  getGenericEditorSchema,
  renderGenericComponentEditor,
} from '../../ui/inspector/genericComponentEditor';
import {
  renderCanvasTextInputs,
  renderDataComponentInput,
  renderMesh2DInputs,
  renderTilemap2DInputs,
} from '../../ui/inspector/componentForms';
import { renderInspectorShell } from '../../ui/inspector/inspectorShellRenderer';
import { renderMixedCartesianTransformInputs } from '../../ui/inspector/transformEditor';
import {
  renderCartesianTransformInputs,
  renderSphericalTransformInputs,
  renderTransform2DInputs,
} from '../../ui/inspector/transformEditor';
import {
  renderCamera2DInputs,
  renderCamera3DInputs,
} from '../../ui/inspector/cameraEditor';
import { t } from '../options/editorOptions';
import { InspectorRegistry } from './InspectorRegistry';

interface SelectLikeElement extends HTMLElement {
  options: GESelectOption[];
  value: string;
  disabled: boolean;
}

interface DropdownLikeElement {
  items: GEDropdownItem[];
}

export interface InspectorRendererElements {
  entityInspectorPanel: HTMLElement | null;
  resourceDetail: HTMLElement | null;
  resourceDetailGrid: HTMLElement | null;
  inspectorEmpty: HTMLElement | null;
  inspectorForm: HTMLElement | null;
  entityNameInput: HTMLInputElement | null;
  entityIdValue: HTMLElement | null;
  selectedComponents: SelectLikeElement | null;
  addComponentDropdown: DropdownLikeElement | null;
  removeComponentButton: HTMLButtonElement | null;
  componentSectionTitle: HTMLElement | null;
  componentEditorEmpty: HTMLElement | null;
  genericComponentSection: HTMLElement | null;
  genericComponentTitle: HTMLElement | null;
  genericComponentFields: HTMLElement | null;
  transformSection: HTMLElement | null;
  cartesianTransformFields: HTMLElement | null;
  sphericalTransformFields: HTMLElement | null;
  transformNote: HTMLElement | null;
  meshSection: HTMLElement | null;
  meshGeometrySelect: SelectLikeElement | null;
  meshMaterialSelect: SelectLikeElement | null;
  transform2DSection: HTMLElement | null;
  transform2DXInput: HTMLInputElement | null;
  transform2DYInput: HTMLInputElement | null;
  transform2DRotationInput: HTMLInputElement | null;
  transform2DScaleXInput: HTMLInputElement | null;
  transform2DScaleYInput: HTMLInputElement | null;
  mesh2DSection: HTMLElement | null;
  mesh2DMaterialSelect: SelectLikeElement | null;
  mesh2DColorInput: HTMLInputElement | null;
  mesh2DAlphaInput: HTMLInputElement | null;
  mesh2DBlendingSelect: HTMLSelectElement | null;
  canvasTextSection: HTMLElement | null;
  canvasTextTextInput: HTMLTextAreaElement | null;
  canvasTextStyleInput: HTMLTextAreaElement | null;
  dataComponentSection: HTMLElement | null;
  dataComponentInput: HTMLTextAreaElement | null;
  tilemap2DSection: HTMLElement | null;
  tilemapColumnsInput: HTMLInputElement | null;
  tilemapRowsInput: HTMLInputElement | null;
  tilemapCellWidthInput: HTMLInputElement | null;
  tilemapCellHeightInput: HTMLInputElement | null;
  tilemapGapInput: HTMLInputElement | null;
  tilemapOriginXInput: HTMLInputElement | null;
  tilemapOriginYInput: HTMLInputElement | null;
  tilemapPaletteInput: HTMLTextAreaElement | null;
  tilemapCellsInput: HTMLTextAreaElement | null;
  keyboardSection: HTMLElement | null;
  cameraSection: HTMLElement | null;
  cameraSectionTitle: HTMLElement | null;
  camera3DFields: HTMLElement | null;
  camera2DFields: HTMLElement | null;
  cameraProjectionSelect: HTMLSelectElement | null;
  cameraFovInput: HTMLInputElement | null;
  cameraNearInput: HTMLInputElement | null;
  cameraFarInput: HTMLInputElement | null;
  cameraReverseZInput: HTMLInputElement | null;
  cameraOrthoLeftInput: HTMLInputElement | null;
  cameraOrthoRightInput: HTMLInputElement | null;
  cameraOrthoTopInput: HTMLInputElement | null;
  cameraOrthoBottomInput: HTMLInputElement | null;
  camera2DWidthInput: HTMLInputElement | null;
  camera2DHeightInput: HTMLInputElement | null;
  camera2DZoomInput: HTMLInputElement | null;
  camera2DNearInput: HTMLInputElement | null;
  camera2DFarInput: HTMLInputElement | null;
  scriptSection: HTMLElement | null;
  scriptResourceSelect: SelectLikeElement | null;
  positionInputs: HTMLInputElement[];
  rotationInputs: HTMLInputElement[];
  scaleInputs: HTMLInputElement[];
  sphericalRadiusInput: HTMLInputElement | null;
  sphericalThetaInput: HTMLInputElement | null;
  sphericalPhiInput: HTMLInputElement | null;
  sphericalTargetInputs: HTMLInputElement[];
}

export interface InspectorRendererDeps {
  elements: InspectorRendererElements;
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

export function renderInspectorView(
  deps: InspectorRendererDeps,
  entity: Entity | null,
  selectionCount = entity ? 1 : 0,
): void {
  const { elements } = deps;
  const selection = deps.getSelection?.() ?? (entity ? new Set([entity]) : new Set<Entity>());
  const componentOptions = entity
    ? selectionCount > 1 ? getCommonComponentOptions([...selection], deps.getComponentOptions) : deps.getComponentOptions(entity)
    : [];
  const shell = renderInspectorShell(
    {
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
    },
    {
      entity,
      selectionCount,
      selectedComponentName: deps.getSelectedComponentName(),
      componentOptions,
      addComponentItems: deps.getAddComponentDropdownItems(),
      clearResourceSelection: deps.clearResourceSelection,
      clearActiveScriptResource: deps.clearActiveScriptResource,
      updateAllResourceSelectionStates: deps.updateAllResourceSelectionStates,
      setSelectedComponentName: deps.setSelectedComponentName,
    },
  );
  deps.setSelectedComponentName(shell.selectedComponentName);
  if (!shell.canRenderEntity || !entity) {
    return;
  }

  if (shell.multi) {
    hideComponentEditorSections(elements);
    const transforms = [...selection]
      .map(selected => selected.getComponent(CartesianTransform3D))
      .filter((transform): transform is CartesianTransform3D => Boolean(transform));
    const showTransform = shell.selectedComponentName === 'CartesianTransform3D' && transforms.length === selection.size;
    if (elements.transformSection) elements.transformSection.hidden = !showTransform;
    if (elements.cartesianTransformFields) elements.cartesianTransformFields.hidden = !showTransform;
    if (elements.sphericalTransformFields) elements.sphericalTransformFields.hidden = true;
    if (showTransform) {
      renderMixedCartesianTransformInputs(transforms, {
        positionInputs: elements.positionInputs,
        rotationInputs: elements.rotationInputs,
        scaleInputs: elements.scaleInputs,
      }, deps.formatNumber);
    }
    if (elements.componentEditorEmpty) {
      elements.componentEditorEmpty.hidden = showTransform;
      elements.componentEditorEmpty.textContent = showTransform ? '' : t('inspector.mixedUnsupported');
    }
    return;
  }

  const selectedComponentName = shell.selectedComponentName;
  const selectedComponent = Array.from(entity.components.values()).find(component => component.constructor.name === selectedComponentName) ?? null;
  const genericSchema = selectedComponent
    ? deps.inspectorRegistry?.resolveSchema(selectedComponent) ?? getGenericEditorSchema(selectedComponent)
    : null;
  const showGenericComponent = Boolean(selectedComponent && genericSchema);
  hideComponentEditorSections(elements);
  let handledByRegistry = false;
  if (selectedComponent) {
    handledByRegistry = showGenericComponent
      ? renderGenericSection(deps, selectedComponent, genericSchema, true)
      : deps.inspectorRegistry?.render({
          deps,
          entity,
          component: selectedComponent as Component,
          componentName: selectedComponentName,
          genericSchema,
        }) === true;
  }

  if (elements.componentSectionTitle) elements.componentSectionTitle.textContent = selectedComponentName || 'Component';
  if (elements.componentEditorEmpty) {
    elements.componentEditorEmpty.hidden = handledByRegistry || componentOptions.length === 0;
    elements.componentEditorEmpty.textContent = selectedComponentName
      ? t('component.noEditor', { name: selectedComponentName })
      : t('component.empty');
  }
}

function getCommonComponentOptions(
  entities: readonly Entity[],
  getOptions: (entity: Entity) => GESelectOption[],
): GESelectOption[] {
  const first = entities[0];
  if (!first) return [];
  const restValues = entities.slice(1).map(entity => new Set(getOptions(entity).map(option => option.value)));
  return getOptions(first).filter(option => restValues.every(values => values.has(option.value)));
}

function renderGenericSection(
  deps: InspectorRendererDeps,
  selectedComponent: unknown,
  genericSchema: ReturnType<typeof getGenericEditorSchema> | null,
  showGenericComponent: boolean,
): boolean {
  const { elements } = deps;
  if (elements.genericComponentSection) elements.genericComponentSection.hidden = !showGenericComponent;
  if (selectedComponent && genericSchema && showGenericComponent) {
    renderGenericComponentEditor({
      component: selectedComponent as never,
      schema: genericSchema,
      elements: {
        section: elements.genericComponentSection,
        title: elements.genericComponentTitle,
        fields: elements.genericComponentFields,
      },
      formatNumber: deps.formatNumber,
      onCommit: deps.commitGenericComponentEdit,
      ...(deps.getAssetRefOptions === undefined ? {} : { getAssetRefOptions: deps.getAssetRefOptions }),
    });
    return true;
  } else {
    elements.genericComponentFields?.replaceChildren();
    return false;
  }
}

function renderTransformSection(
  deps: InspectorRendererDeps,
  transform: Transform3D | null,
  cartesian: CartesianTransform3D | null,
  spherical: SphericalTransform3D | null,
  showTransform: boolean,
  selectedComponentName: string,
): void {
  const { elements } = deps;
  if ((cartesian || spherical) && showTransform) {
    if (elements.transformSection) elements.transformSection.hidden = false;
    if (elements.transformNote) elements.transformNote.hidden = true;
    if (elements.cartesianTransformFields) elements.cartesianTransformFields.hidden = !cartesian;
    if (elements.sphericalTransformFields) elements.sphericalTransformFields.hidden = !spherical || selectedComponentName !== 'SphericalTransform3D';
    if (cartesian) renderCartesianTransformInputs(cartesian, { positionInputs: elements.positionInputs, rotationInputs: elements.rotationInputs, scaleInputs: elements.scaleInputs }, deps.formatNumber);
    if (spherical && selectedComponentName === 'SphericalTransform3D') {
      renderSphericalTransformInputs(spherical, {
        radiusInput: elements.sphericalRadiusInput,
        thetaInput: elements.sphericalThetaInput,
        phiInput: elements.sphericalPhiInput,
        targetInputs: elements.sphericalTargetInputs,
      }, deps.formatNumber);
    }
  } else {
    if (elements.transformSection) elements.transformSection.hidden = true;
    if (elements.cartesianTransformFields) elements.cartesianTransformFields.hidden = true;
    if (elements.sphericalTransformFields) elements.sphericalTransformFields.hidden = true;
    if (elements.transformNote) {
      elements.transformNote.hidden = !transform || !showTransform;
      elements.transformNote.textContent = transform ? t('component.transformCannotEdit', { name: transform.constructor.name }) : '';
    }
  }
}

function renderMeshSection(deps: InspectorRendererDeps, mesh: Mesh3D | null, showMesh: boolean): void {
  const { elements } = deps;
  if (elements.meshSection) elements.meshSection.hidden = !mesh || !showMesh;
  if (!mesh || !showMesh) return;
  setSelectOptions(elements.meshGeometrySelect, deps.getGeometryOptions(), String(mesh.geometry.id), t('empty.noGeometries'));
  setSelectOptions(elements.meshMaterialSelect, deps.getMaterialOptions(), String((mesh.material as Material).id), t('empty.noMaterials'));
}

function renderTransform2DSection(deps: InspectorRendererDeps, transform2D: Transform2D | null, showTransform2D: boolean): void {
  const { elements } = deps;
  if (elements.transform2DSection) elements.transform2DSection.hidden = !transform2D || !showTransform2D;
  if (!transform2D || !showTransform2D) return;
  renderTransform2DInputs(transform2D, {
    xInput: elements.transform2DXInput,
    yInput: elements.transform2DYInput,
    rotationInput: elements.transform2DRotationInput,
    scaleXInput: elements.transform2DScaleXInput,
    scaleYInput: elements.transform2DScaleYInput,
  }, deps.formatNumber);
}

function renderMesh2DSection(deps: InspectorRendererDeps, mesh2D: Mesh2D | null, showMesh2D: boolean): void {
  const { elements } = deps;
  if (elements.mesh2DSection) elements.mesh2DSection.hidden = !mesh2D || !showMesh2D;
  if (!mesh2D || !showMesh2D) return;
  setSelectOptions(elements.mesh2DMaterialSelect, deps.getMaterial2DOptions(), String((mesh2D.material as Material2D).id), t('empty.no2DMaterials'));
  renderMesh2DInputs(mesh2D, {
    colorInput: elements.mesh2DColorInput,
    alphaInput: elements.mesh2DAlphaInput,
    blendingSelect: elements.mesh2DBlendingSelect,
  }, deps.formatNumber);
}

function renderComponentDataSections(
  deps: InspectorRendererDeps,
  canvasText: CanvasTextComponent | null,
  dataComponent: DataComponent | null,
  tilemap2D: Tilemap2DComponent | null,
  showCanvasText: boolean,
  showDataComponent: boolean,
  showTilemap2D: boolean,
): void {
  const { elements } = deps;
  if (elements.canvasTextSection) elements.canvasTextSection.hidden = !canvasText || !showCanvasText;
  if (canvasText && showCanvasText) renderCanvasTextInputs(canvasText, { textInput: elements.canvasTextTextInput, styleInput: elements.canvasTextStyleInput });
  if (elements.dataComponentSection) elements.dataComponentSection.hidden = !dataComponent || !showDataComponent;
  if (dataComponent && showDataComponent) renderDataComponentInput(dataComponent, { input: elements.dataComponentInput });
  if (elements.tilemap2DSection) elements.tilemap2DSection.hidden = !tilemap2D || !showTilemap2D;
  if (tilemap2D && showTilemap2D) {
    renderTilemap2DInputs(tilemap2D, {
      columnsInput: elements.tilemapColumnsInput,
      rowsInput: elements.tilemapRowsInput,
      cellWidthInput: elements.tilemapCellWidthInput,
      cellHeightInput: elements.tilemapCellHeightInput,
      gapInput: elements.tilemapGapInput,
      originXInput: elements.tilemapOriginXInput,
      originYInput: elements.tilemapOriginYInput,
      paletteInput: elements.tilemapPaletteInput,
      cellsInput: elements.tilemapCellsInput,
    }, deps.formatNumber);
  }
}

function renderCameraSection(
  deps: InspectorRendererDeps,
  camera3D: Camera3D | null,
  camera2D: Camera2D | null,
  showCamera: boolean,
  selectedComponentName: string,
): void {
  const { elements } = deps;
  if (elements.cameraSection) elements.cameraSection.hidden = !showCamera || (!camera3D && !camera2D);
  if (elements.cameraSectionTitle) elements.cameraSectionTitle.textContent = selectedComponentName || 'Camera';
  if (elements.camera3DFields) elements.camera3DFields.hidden = !camera3D || selectedComponentName !== 'Camera3D';
  if (elements.camera2DFields) elements.camera2DFields.hidden = !camera2D || selectedComponentName !== 'Camera2D';
  if (camera3D && selectedComponentName === 'Camera3D') {
    renderCamera3DInputs(camera3D, {
      projectionSelect: elements.cameraProjectionSelect,
      fovInput: elements.cameraFovInput,
      nearInput: elements.cameraNearInput,
      farInput: elements.cameraFarInput,
      reverseZInput: elements.cameraReverseZInput,
      orthoLeftInput: elements.cameraOrthoLeftInput,
      orthoRightInput: elements.cameraOrthoRightInput,
      orthoTopInput: elements.cameraOrthoTopInput,
      orthoBottomInput: elements.cameraOrthoBottomInput,
    }, deps.formatNumber);
  }
  if (camera2D && selectedComponentName === 'Camera2D') {
    renderCamera2DInputs(camera2D, {
      widthInput: elements.camera2DWidthInput,
      heightInput: elements.camera2DHeightInput,
      zoomInput: elements.camera2DZoomInput,
      nearInput: elements.camera2DNearInput,
      farInput: elements.camera2DFarInput,
    }, deps.formatNumber);
  }
}

function setSelectOptions(select: SelectLikeElement | null, options: GESelectOption[], value: string, emptyLabel: string): void {
  if (!select) return;
  select.options = options.length ? options : [{ label: emptyLabel, value: '', disabled: true }];
  select.value = value;
  select.disabled = options.length === 0;
}

function hideComponentEditorSections(elements: InspectorRendererElements): void {
  if (elements.genericComponentSection) elements.genericComponentSection.hidden = true;
  elements.genericComponentFields?.replaceChildren();
  if (elements.transformSection) elements.transformSection.hidden = true;
  if (elements.cartesianTransformFields) elements.cartesianTransformFields.hidden = true;
  if (elements.sphericalTransformFields) elements.sphericalTransformFields.hidden = true;
  if (elements.transformNote) elements.transformNote.hidden = true;
  if (elements.meshSection) elements.meshSection.hidden = true;
  if (elements.transform2DSection) elements.transform2DSection.hidden = true;
  if (elements.mesh2DSection) elements.mesh2DSection.hidden = true;
  if (elements.canvasTextSection) elements.canvasTextSection.hidden = true;
  if (elements.dataComponentSection) elements.dataComponentSection.hidden = true;
  if (elements.tilemap2DSection) elements.tilemap2DSection.hidden = true;
  if (elements.keyboardSection) elements.keyboardSection.hidden = true;
  if (elements.cameraSection) elements.cameraSection.hidden = true;
  if (elements.camera3DFields) elements.camera3DFields.hidden = true;
  if (elements.camera2DFields) elements.camera2DFields.hidden = true;
  if (elements.scriptSection) elements.scriptSection.hidden = true;
}

export function registerDefaultInspectorRenderers(registry: InspectorRegistry): void {
  registry.register(CartesianTransform3D, context => {
      const transform = context.entity.getComponent(Transform3D);
      renderTransformSection(context.deps, transform, context.entity.getComponent(CartesianTransform3D), context.entity.getComponent(SphericalTransform3D), true, context.componentName);
    });
  registry.register(Transform3D, context => {
      const transform = context.entity.getComponent(Transform3D);
      renderTransformSection(context.deps, transform, context.entity.getComponent(CartesianTransform3D), context.entity.getComponent(SphericalTransform3D), true, context.componentName);
    });
  registry.register(SphericalTransform3D, context => {
      const transform = context.entity.getComponent(Transform3D);
      renderTransformSection(context.deps, transform, context.entity.getComponent(CartesianTransform3D), context.entity.getComponent(SphericalTransform3D), true, context.componentName);
    });
  registry.register(Mesh3D, context => renderMeshSection(context.deps, context.entity.getComponent(Mesh3D), true));
  registry.register(Transform2D, context => renderTransform2DSection(context.deps, context.entity.getComponent(Transform2D), true));
  registry.register(Mesh2D, context => renderMesh2DSection(context.deps, context.entity.getComponent(Mesh2D), true));
  registry.register(CanvasTextComponent, context => renderComponentDataSections(context.deps, context.entity.getComponent(CanvasTextComponent), null, null, true, false, false));
  registry.register(DataComponent, context => renderComponentDataSections(context.deps, null, context.entity.getComponent(DataComponent), null, false, true, false));
  registry.register(Tilemap2DComponent, context => renderComponentDataSections(context.deps, null, null, context.entity.getComponent(Tilemap2DComponent), false, false, true));
  registry.register(Camera3D, context => renderCameraSection(context.deps, context.entity.getComponent(Camera3D), context.entity.getComponent(Camera2D), true, context.componentName));
  registry.register(Camera2D, context => renderCameraSection(context.deps, context.entity.getComponent(Camera3D), context.entity.getComponent(Camera2D), true, context.componentName));
  registry.register(KeyboardComponent, context => {
      const keyboard = context.entity.getComponent(KeyboardComponent);
      if (context.deps.elements.keyboardSection) context.deps.elements.keyboardSection.hidden = !keyboard;
      if (keyboard) context.deps.renderKeyboardEditor(keyboard);
      return !!keyboard;
    });
  registry.register(ScriptComponent, context => {
      const script = context.entity.getComponent(ScriptComponent);
      if (context.deps.elements.scriptSection) context.deps.elements.scriptSection.hidden = !script;
      if (script && context.deps.elements.scriptResourceSelect) {
        context.deps.elements.scriptResourceSelect.options = context.deps.getScriptResourceOptions();
        context.deps.elements.scriptResourceSelect.value = script.resource ? String(script.resource.id) : '';
      }
      return !!script;
    });
}
