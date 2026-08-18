import {
  type InspectorCommitState,
} from './commitHandlers';
import type { EditorStoreCommands, EditorStoreSelector, EditorStoreSnapshot } from '../../domain/store/EditorStore';
import { createInspectorInputGuard, type InspectorInputGuard } from './inspectorInputGuard';

export interface MainInspectorState {
  inspectorInputGuard: InspectorInputGuard;
  inspectorCommitState: InspectorCommitState;
  getSelectedComponentName(): string;
  setSelectedComponentName(name: string): void;
  clearSelectedComponentName(): void;
}

export function createMainInspectorState(store?: {
  commands: EditorStoreCommands;
  select<T>(selector: EditorStoreSelector<T>): T;
}): MainInspectorState {
  let fallbackSelectedComponentName = '';
  const inspectorCommitState: InspectorCommitState = store?.commands.inspector.commit ?? {
    nameEditStartValue: null,
    transformEditStartValue: null,
    multiTransformEditStartValue: null,
    sphericalTransformEditStartValue: null,
    transform2DEditStartValue: null,
  };
  return {
    inspectorInputGuard: createInspectorInputGuard(),
    inspectorCommitState,
    getSelectedComponentName: () => store?.select((snapshot: EditorStoreSnapshot) => snapshot.inspector.selectedComponentName) ?? fallbackSelectedComponentName,
    setSelectedComponentName(name) {
      if (store) store.commands.inspector.setSelectedComponentName(name);
      else fallbackSelectedComponentName = name;
    },
    clearSelectedComponentName() {
      if (store) store.commands.inspector.setSelectedComponentName('');
      else fallbackSelectedComponentName = '';
    },
  };
}
