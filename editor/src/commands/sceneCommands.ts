import type { SerializedEditorScene } from '../export/runtimeScene';
import type { Command } from '../types';

export interface LoadEditorSceneCommandOptions {
  before: SerializedEditorScene;
  after: SerializedEditorScene;
  apply: (scene: SerializedEditorScene) => void;
  label?: string;
}

export function loadEditorSceneCommand(options: LoadEditorSceneCommandOptions): Command {
  return {
    label: options.label ?? 'Load Scene',
    execute: () => {
      options.apply(options.after);
    },
    undo: () => {
      options.apply(options.before);
    },
  };
}
