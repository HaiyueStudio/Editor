import type { EditorRuntimeAdapterElements, EditorRuntimeAdapterOptions } from '../../engine-adapter/EditorRuntimeAdapter';
import { createEditorRuntimeAdapter } from '../../engine-adapter/EditorRuntimeAdapter';

export type MainPlayContextElements = EditorRuntimeAdapterElements;
export type MainPlayContextDeps = EditorRuntimeAdapterOptions;

export function createMainPlayContext(deps: MainPlayContextDeps) {
  return createEditorRuntimeAdapter(deps);
}
