import type { GEDropdownSelectDetail, GESelectChangeDetail } from '@haiyue/ui';

export interface InspectorEventBindingElements {
  entityNameInput: HTMLInputElement | null;
  selectedComponents: HTMLElement | null;
  scriptLifecycleSelect: HTMLElement | null;
  scriptInsertExampleButton: HTMLElement | null;
  scriptEditorOverlayClose: HTMLElement | null;
  scriptEditorOverlay: HTMLElement | null;
  scriptResourceSelect: HTMLElement | null;
  addComponentButton: HTMLElement | null;
  addComponentDropdown: HTMLElement | null;
  removeComponentButton: HTMLElement | null;
  meshGeometrySelect: HTMLElement | null;
  meshMaterialSelect: HTMLElement | null;
  mesh2DMaterialSelect: HTMLElement | null;
  cameraProjectionSelect: HTMLElement | null;
  cameraInputs: Array<HTMLElement | null>;
  globalInputs: Array<HTMLElement | null>;
  textureResources: HTMLElement | null;
  scriptResources: HTMLElement | null;
  modelResources: HTMLElement | null;
  positionInputs: Array<HTMLInputElement | null>;
  rotationInputs: Array<HTMLInputElement | null>;
  scaleInputs: Array<HTMLInputElement | null>;
  transform2DInputs: Array<HTMLInputElement | null>;
  sphericalInputs: Array<HTMLInputElement | null>;
  mesh2DInputs: Array<HTMLInputElement | HTMLSelectElement | null>;
  canvasTextTextInput: HTMLTextAreaElement | HTMLInputElement | null;
  canvasTextStyleInput: HTMLTextAreaElement | HTMLInputElement | null;
  dataComponentInput: HTMLTextAreaElement | HTMLInputElement | null;
  tilemapInputs: Array<HTMLInputElement | HTMLTextAreaElement | null>;
}

export interface InspectorEventBindingActions {
  onEntityNameFocus: () => void;
  onEntityNameInput: () => void;
  commitNameEdit: () => void;
  setSelectedComponentName: (name: string) => void;
  rerenderInspector: () => void;
  onScriptLifecycleChange: (lifecycle: string) => void;
  insertScriptExample: () => void;
  closeScriptEditor: () => void;
  applyScriptResourceSelection: (id: string) => void;
  refreshAddComponentDropdown: () => void;
  addComponentToActiveEntity: (type: string) => void;
  removeSelectedComponentFromActiveEntity: () => void;
  applyMeshGeometrySelection: (id: string) => void;
  applyMeshMaterialSelection: (id: string) => void;
  applyMesh2DMaterialSelection: (id: string) => void;
  commitCameraEdit: () => void;
  commitGlobalSettingsEdit: () => void;
  addTextureFiles: (files: FileList) => void | Promise<void>;
  addScriptFiles: (files: FileList) => void | Promise<void>;
  addModelFiles: (files: FileList) => void | Promise<void>;
  reportError: (message: string, error?: unknown) => void;
  onTransformFocus: () => void;
  applyTransformInputs: () => void;
  commitTransformEdit: () => void;
  onTransform2DFocus: () => void;
  applyTransform2DInputs: () => void;
  commitTransform2DEdit: () => void;
  onSphericalTransformFocus: () => void;
  applySphericalTransformInputs: () => void;
  commitSphericalTransformEdit: () => void;
  commitMesh2DEdit: () => void;
  commitCanvasTextEdit: () => void;
  commitDataComponentEdit: () => void;
  commitTilemap2DEdit: () => void;
  getSuppressInspectorInput: () => boolean;
}

export interface InspectorEventBindingDeps {
  elements: InspectorEventBindingElements;
  actions: InspectorEventBindingActions;
}

function getSelectValue(event: Event): string {
  return (event as CustomEvent<GESelectChangeDetail>).detail.value;
}

function getDropdownValue(event: Event): string {
  return (event as CustomEvent<GEDropdownSelectDetail>).detail.value;
}

function bindFileDrop(
  target: HTMLElement | null,
  addFiles: (files: FileList) => void | Promise<void>,
  reportError?: (message: string, error?: unknown) => void,
  errorMessage = 'Failed to import files.',
): void {
  target?.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  target?.addEventListener('drop', (event) => {
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    event.preventDefault();
    const result = addFiles(files);
    if (result instanceof Promise && reportError) {
      void result.catch((error) => reportError(errorMessage, error));
    }
  });
}

export function bindInspectorEvents(deps: InspectorEventBindingDeps): void {
  const { elements, actions } = deps;

  elements.entityNameInput?.addEventListener('focus', actions.onEntityNameFocus);
  elements.entityNameInput?.addEventListener('input', actions.onEntityNameInput);
  elements.entityNameInput?.addEventListener('change', actions.commitNameEdit);
  elements.entityNameInput?.addEventListener('blur', actions.commitNameEdit);

  elements.selectedComponents?.addEventListener('value-change', (event) => {
    actions.setSelectedComponentName(getSelectValue(event));
    actions.rerenderInspector();
  });

  elements.scriptLifecycleSelect?.addEventListener('value-change', (event) => {
    actions.onScriptLifecycleChange(getSelectValue(event));
  });
  elements.scriptInsertExampleButton?.addEventListener('click', actions.insertScriptExample);
  elements.scriptEditorOverlayClose?.addEventListener('click', actions.closeScriptEditor);
  elements.scriptEditorOverlay?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') actions.closeScriptEditor();
  });
  elements.scriptResourceSelect?.addEventListener('value-change', (event) => {
    actions.applyScriptResourceSelection(getSelectValue(event));
  });

  elements.addComponentButton?.addEventListener('click', actions.refreshAddComponentDropdown);
  elements.addComponentDropdown?.addEventListener('item-select', (event) => {
    const value = getDropdownValue(event);
    if (value) actions.addComponentToActiveEntity(value);
  });
  elements.removeComponentButton?.addEventListener('click', actions.removeSelectedComponentFromActiveEntity);
  elements.meshGeometrySelect?.addEventListener('value-change', (event) => actions.applyMeshGeometrySelection(getSelectValue(event)));
  elements.meshMaterialSelect?.addEventListener('value-change', (event) => actions.applyMeshMaterialSelection(getSelectValue(event)));
  elements.mesh2DMaterialSelect?.addEventListener('value-change', (event) => actions.applyMesh2DMaterialSelection(getSelectValue(event)));

  elements.cameraProjectionSelect?.addEventListener('change', actions.commitCameraEdit);
  for (const input of elements.cameraInputs) input?.addEventListener('change', actions.commitCameraEdit);
  for (const input of elements.globalInputs) input?.addEventListener('change', actions.commitGlobalSettingsEdit);

  bindFileDrop(elements.textureResources, actions.addTextureFiles);
  bindFileDrop(elements.scriptResources, actions.addScriptFiles);
  bindFileDrop(elements.modelResources, actions.addModelFiles, actions.reportError, 'Failed to import model.');

  for (const input of [...elements.positionInputs, ...elements.rotationInputs, ...elements.scaleInputs]) {
    input?.addEventListener('focus', actions.onTransformFocus);
    input?.addEventListener('input', () => {
      if (!actions.getSuppressInspectorInput()) actions.applyTransformInputs();
    });
    input?.addEventListener('change', actions.commitTransformEdit);
    input?.addEventListener('blur', actions.commitTransformEdit);
  }

  for (const input of elements.transform2DInputs) {
    input?.addEventListener('focus', actions.onTransform2DFocus);
    input?.addEventListener('input', () => {
      if (!actions.getSuppressInspectorInput()) actions.applyTransform2DInputs();
    });
    input?.addEventListener('change', actions.commitTransform2DEdit);
    input?.addEventListener('blur', actions.commitTransform2DEdit);
  }

  for (const input of elements.sphericalInputs) {
    input?.addEventListener('focus', actions.onSphericalTransformFocus);
    input?.addEventListener('input', () => {
      if (!actions.getSuppressInspectorInput()) actions.applySphericalTransformInputs();
    });
    input?.addEventListener('change', actions.commitSphericalTransformEdit);
    input?.addEventListener('blur', actions.commitSphericalTransformEdit);
  }

  for (const input of elements.mesh2DInputs) input?.addEventListener('change', actions.commitMesh2DEdit);
  elements.canvasTextTextInput?.addEventListener('change', actions.commitCanvasTextEdit);
  elements.canvasTextStyleInput?.addEventListener('change', actions.commitCanvasTextEdit);
  elements.dataComponentInput?.addEventListener('change', actions.commitDataComponentEdit);
  elements.dataComponentInput?.addEventListener('blur', actions.commitDataComponentEdit);
  for (const input of elements.tilemapInputs) {
    input?.addEventListener('change', actions.commitTilemap2DEdit);
    input?.addEventListener('blur', actions.commitTilemap2DEdit);
  }
}
