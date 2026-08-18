import { ScriptComponent, type ScriptResource } from '@haiyue/engine/components';
import { type Entity } from '@haiyue/engine';
import type { getEditorDom } from '../../dom';
import type { InspectorContext } from '../../types';
import type { ScriptEditorControllerPort } from '../../script/ScriptEditorControllerPort';
import { setupMainInspectorEvents } from './mainInspectorEvents';
import type { MainInspectorCommitContext } from './mainInspectorCommitContext';
import type { MainInspectorState } from './mainInspectorState';

type EditorDom = ReturnType<typeof getEditorDom>;

export interface MainInspectorEventsContextDeps {
  editorDom: EditorDom;
  inspectorState: MainInspectorState;
  inspectorCommitContext: MainInspectorCommitContext;
  getInspectorContext(): InspectorContext | null;
  getActiveScriptResource(): ScriptResource | null;
  scriptEditorController: ScriptEditorControllerPort;
  getAddComponentDropdownItems(): ReturnType<Parameters<typeof setupMainInspectorEvents>[0]['getAddComponentDropdownItems']>;
  refreshTreeSelection(treeElement: EditorDom['tree'], world: NonNullable<InspectorContext>['world'], selection: Set<Entity>): void;
  renderInspector(entity: Entity | null, selectionCount?: number): void;
  addModelFiles(files: FileList | File[]): Promise<void>;
  addTextureFiles(files: FileList | File[]): Promise<void>;
  addScriptFiles(files: FileList | File[]): Promise<void>;
  reportError(message: string, error?: unknown): void;
}

export function setupMainInspectorEventBindings(deps: MainInspectorEventsContextDeps): void {
  setupMainInspectorEvents({
    elements: deps.editorDom,
    inspectorCommitState: deps.inspectorState.inspectorCommitState,
    inspectorCommitHandlers: deps.inspectorCommitContext.inspectorCommitHandlers,
    getInspectorContext: deps.getInspectorContext,
    getSuppressInspectorInput: deps.inspectorState.inspectorInputGuard.isActive,
    setSelectedComponentName: deps.inspectorState.setSelectedComponentName,
    getActiveScriptTarget: () => deps.getActiveScriptResource() ?? deps.getInspectorContext()?.getActiveEntity()?.getComponent(ScriptComponent) ?? null,
    scriptEditorController: deps.scriptEditorController,
    getAddComponentDropdownItems: deps.getAddComponentDropdownItems,
    refreshCurrentTreeSelection: () => {
      const context = deps.getInspectorContext();
      if (context) deps.refreshTreeSelection(deps.editorDom.tree, context.world, context.getSelection());
    },
    renderInspector: deps.renderInspector,
    addTextureFiles: deps.addTextureFiles,
    addScriptFiles: deps.addScriptFiles,
    addModelFiles: deps.addModelFiles,
    reportError: deps.reportError,
  });
}
