import type { GEDropdownItem } from '@haiyue/ui';
import { CartesianTransform3D, SphericalTransform3D, Transform2D, type Entity } from '@haiyue/engine';
import { ScriptComponent, ScriptResource } from '@haiyue/engine/components';
import type { InspectorContext } from '../../types';
import { getScriptLifecycleExample } from '../../script/scriptAuthoringText';
import type { ScriptEditorControllerPort } from '../../script/ScriptEditorControllerPort';
import { bindInspectorEvents } from '../../ui/inspector/inspectorEventBindings';
import {
  applyCartesianTransformInputs,
  applySphericalTransformInputs,
  applyTransform2DInputs,
  snapshotSphericalTransform,
  snapshotTransform,
  snapshotTransform2D,
} from '../../ui/inspector/transformEditor';
import { invalidateEntityNameCache } from '../../scene/entityHierarchy';
import type { createInspectorCommitHandlers, InspectorCommitState } from './commitHandlers';

type InspectorCommitHandlers = ReturnType<typeof createInspectorCommitHandlers>;

export interface EditorInspectorEventElements {
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
  transform2DInputs: {
    xInput: HTMLInputElement | null;
    yInput: HTMLInputElement | null;
    rotationInput: HTMLInputElement | null;
    scaleXInput: HTMLInputElement | null;
    scaleYInput: HTMLInputElement | null;
  };
  sphericalInputs: {
    radiusInput: HTMLInputElement | null;
    thetaInput: HTMLInputElement | null;
    phiInput: HTMLInputElement | null;
    targetInputs: Array<HTMLInputElement | null>;
  };
  mesh2DInputs: Array<HTMLInputElement | HTMLSelectElement | null>;
  canvasTextTextInput: HTMLTextAreaElement | HTMLInputElement | null;
  canvasTextStyleInput: HTMLTextAreaElement | HTMLInputElement | null;
  dataComponentInput: HTMLTextAreaElement | HTMLInputElement | null;
  tilemapInputs: Array<HTMLInputElement | HTMLTextAreaElement | null>;
}

export interface EditorInspectorEventDeps {
  elements: EditorInspectorEventElements;
  inspectorCommitState: InspectorCommitState;
  inspectorCommitHandlers: InspectorCommitHandlers;
  getInspectorContext: () => InspectorContext | null;
  getSuppressInspectorInput: () => boolean;
  setSelectedComponentName: (name: string) => void;
  getActiveScriptTarget: () => ScriptComponent | ScriptResource | null;
  scriptEditorController: ScriptEditorControllerPort;
  getAddComponentDropdownItems: () => GEDropdownItem[];
  refreshTreeSelection: () => void;
  renderInspector: (entity: Entity | null, selectionCount?: number) => void;
  addTextureFiles: (files: FileList) => void | Promise<void>;
  addScriptFiles: (files: FileList) => void | Promise<void>;
  addModelFiles: (files: FileList | File[]) => void | Promise<void>;
  reportError: (message: string, error?: unknown) => void;
}

function applyTransformInputs(deps: EditorInspectorEventDeps): void {
  const context = deps.getInspectorContext();
  if (!context) return;
  for (const entity of context.getSelection()) {
    const transform = entity.getComponent(CartesianTransform3D);
    if (!transform) continue;
    applyCartesianTransformInputs(transform, {
      positionInputs: deps.elements.positionInputs,
      rotationInputs: deps.elements.rotationInputs,
      scaleInputs: deps.elements.scaleInputs,
    });
  }
}

function applySphericalInputs(deps: EditorInspectorEventDeps): void {
  const entity = deps.getInspectorContext()?.getActiveEntity();
  const transform = entity?.getComponent(SphericalTransform3D);
  if (!transform) return;
  applySphericalTransformInputs(transform, deps.elements.sphericalInputs);
}

function applyTransform2D(deps: EditorInspectorEventDeps): void {
  const entity = deps.getInspectorContext()?.getActiveEntity();
  const transform = entity?.getComponent(Transform2D);
  if (!transform) return;
  applyTransform2DInputs(transform, deps.elements.transform2DInputs);
}

export function setupEditorInspectorEvents(deps: EditorInspectorEventDeps): void {
  const { elements, inspectorCommitHandlers } = deps;
  bindInspectorEvents({
    elements: {
      ...elements,
      transform2DInputs: [
        elements.transform2DInputs.xInput,
        elements.transform2DInputs.yInput,
        elements.transform2DInputs.rotationInput,
        elements.transform2DInputs.scaleXInput,
        elements.transform2DInputs.scaleYInput,
      ],
      sphericalInputs: [
        elements.sphericalInputs.radiusInput,
        elements.sphericalInputs.thetaInput,
        elements.sphericalInputs.phiInput,
        ...elements.sphericalInputs.targetInputs,
      ],
    },
    actions: {
      onEntityNameFocus: () => {
        deps.inspectorCommitState.nameEditStartValue = deps.getInspectorContext()?.getActiveEntity()?.name ?? null;
      },
      onEntityNameInput: () => {
        if (deps.getSuppressInspectorInput()) return;
        const context = deps.getInspectorContext();
        const entity = context?.getActiveEntity();
        if (!context || !entity || !elements.entityNameInput) return;
        entity.name = elements.entityNameInput.value.trim() || 'Untitled Entity';
        invalidateEntityNameCache(context.world);
        deps.refreshTreeSelection();
      },
      commitNameEdit: inspectorCommitHandlers.commitNameEdit,
      setSelectedComponentName: deps.setSelectedComponentName,
      rerenderInspector: () => {
        const context = deps.getInspectorContext();
        deps.renderInspector(context?.getActiveEntity() ?? null, context?.getSelection().size ?? 0);
      },
      onScriptLifecycleChange: lifecycle => {
        deps.scriptEditorController.lifecycle = lifecycle;
        const target = deps.scriptEditorController.getTarget(deps.getActiveScriptTarget());
        if (!target) return;
        deps.scriptEditorController.reset();
        deps.scriptEditorController.render(target);
      },
      insertScriptExample: () => {
        const target = deps.scriptEditorController.getTarget(deps.getActiveScriptTarget());
        if (!target) return;
        const current = target.getScript(deps.scriptEditorController.lifecycle).trim();
        if (current && !confirm('Replace current lifecycle code with the example?')) return;
        deps.scriptEditorController.setCode(target, getScriptLifecycleExample(deps.scriptEditorController.lifecycle));
      },
      closeScriptEditor: () => deps.scriptEditorController.closeResource(),
      applyScriptResourceSelection: inspectorCommitHandlers.applyScriptResourceSelection,
      refreshAddComponentDropdown: () => {
        if (elements.addComponentDropdown) (elements.addComponentDropdown as HTMLElement & { items: GEDropdownItem[] }).items = deps.getAddComponentDropdownItems();
      },
      addComponentToActiveEntity: inspectorCommitHandlers.addComponentToActiveEntity,
      removeSelectedComponentFromActiveEntity: inspectorCommitHandlers.removeSelectedComponentFromActiveEntity,
      applyMeshGeometrySelection: inspectorCommitHandlers.applyMeshGeometrySelection,
      applyMeshMaterialSelection: inspectorCommitHandlers.applyMeshMaterialSelection,
      applyMesh2DMaterialSelection: inspectorCommitHandlers.applyMesh2DMaterialSelection,
      commitCameraEdit: inspectorCommitHandlers.commitCameraEdit,
      commitGlobalSettingsEdit: inspectorCommitHandlers.commitGlobalSettingsEdit,
      addTextureFiles: deps.addTextureFiles,
      addScriptFiles: deps.addScriptFiles,
      addModelFiles: files => deps.addModelFiles(files as FileList | File[]),
      reportError: deps.reportError,
      onTransformFocus: () => {
        const context = deps.getInspectorContext();
        const records = context ? [...context.getSelection()]
          .map(entity => {
            const transform = entity.getComponent(CartesianTransform3D);
            return transform ? { entity, transform, before: snapshotTransform(transform) } : null;
          })
          .filter((record): record is NonNullable<typeof record> => record !== null) : [];
        deps.inspectorCommitState.multiTransformEditStartValue = records.length > 1 ? records : null;
        deps.inspectorCommitState.transformEditStartValue = records.length === 1 ? records[0]?.before ?? null : null;
      },
      applyTransformInputs: () => applyTransformInputs(deps),
      commitTransformEdit: inspectorCommitHandlers.commitTransformEdit,
      onTransform2DFocus: () => {
        const transform = deps.getInspectorContext()?.getActiveEntity()?.getComponent(Transform2D);
        deps.inspectorCommitState.transform2DEditStartValue = transform ? snapshotTransform2D(transform) : null;
      },
      applyTransform2DInputs: () => applyTransform2D(deps),
      commitTransform2DEdit: inspectorCommitHandlers.commitTransform2DEdit,
      onSphericalTransformFocus: () => {
        const transform = deps.getInspectorContext()?.getActiveEntity()?.getComponent(SphericalTransform3D);
        deps.inspectorCommitState.sphericalTransformEditStartValue = transform ? snapshotSphericalTransform(transform) : null;
      },
      applySphericalTransformInputs: () => applySphericalInputs(deps),
      commitSphericalTransformEdit: inspectorCommitHandlers.commitSphericalTransformEdit,
      commitMesh2DEdit: inspectorCommitHandlers.commitMesh2DEdit,
      commitCanvasTextEdit: inspectorCommitHandlers.commitCanvasTextEdit,
      commitDataComponentEdit: inspectorCommitHandlers.commitDataComponentEdit,
      commitTilemap2DEdit: inspectorCommitHandlers.commitTilemap2DEdit,
      getSuppressInspectorInput: deps.getSuppressInspectorInput,
    },
  });
}
