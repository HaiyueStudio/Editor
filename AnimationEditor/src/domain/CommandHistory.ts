import {
  animationEditorProjectSnapshotKey,
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorProject,
  type DeepMutable,
} from './AnimationEditorProject';
import { AnimationEditorStore } from './AnimationEditorStore';
import { EditorHistoryService } from '@haiyue/editor-platform';

export interface EditorCommand {
  readonly label: string;
  readonly estimatedBytes?: number;
  execute(): boolean;
  undo(): void;
}

export interface CommandHistorySnapshot {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly estimatedBytes: number;
}

export type CommandHistoryListener = (snapshot: CommandHistorySnapshot) => void;

export class CommandHistory {
  private readonly _listeners = new Set<CommandHistoryListener>();
  private readonly _byteBudget: number;
  private readonly _history: EditorHistoryService;
  private readonly _ownsHistory: boolean;
  private readonly _historySubscription: { dispose(): void };

  constructor(
    limit = 100,
    byteBudget = 32 * 1024 * 1024,
    history?: EditorHistoryService,
  ) {
    this._byteBudget = Math.max(1, Math.floor(byteBudget));
    this._ownsHistory = history === undefined;
    this._history = history ?? new EditorHistoryService({
      maxEntries: Math.max(1, Math.floor(limit)),
      byteBudget: this._byteBudget,
    });
    this._historySubscription = this._history.subscribe(() => this._notify());
  }

  get canUndo(): boolean { return this._history.canUndo; }
  get canRedo(): boolean { return this._history.canRedo; }
  get undoLabel(): string | null { return this._history.snapshot().undoLabel ?? null; }
  get redoLabel(): string | null { return this._history.snapshot().redoLabel ?? null; }
  get estimatedBytes(): number { return this._history.snapshot().estimatedBytes; }
  get byteBudget(): number { return this._byteBudget; }

  subscribe(listener: CommandHistoryListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  execute(command: EditorCommand | null): boolean {
    if (!command) return false;
    if (commandBytes(command) > this._byteBudget) {
      if (!command.execute()) return false;
      this._history.clear();
      return true;
    }
    return this._history.execute(command);
  }

  recordApplied(command: EditorCommand): void {
    if (commandBytes(command) > this._byteBudget) this._history.clear();
    else this._history.recordApplied(command);
  }

  undo(): string | null {
    const label = this.undoLabel;
    return label && this._history.undo() ? label : null;
  }

  redo(): string | null {
    const label = this.redoLabel;
    return label && this._history.redo() ? label : null;
  }

  clear(): void {
    if (this.canUndo || this.canRedo) this._history.clear();
  }

  snapshot(): CommandHistorySnapshot {
    return Object.freeze({
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoLabel,
      redoLabel: this.redoLabel,
      estimatedBytes: this.estimatedBytes,
    });
  }

  private _notify(): void {
    const snapshot = this.snapshot();
    for (const listener of [...this._listeners]) listener(snapshot);
  }

  dispose(): void {
    this._historySubscription.dispose();
    if (this._ownsHistory) this._history.dispose();
  }
}

export function createProjectMutationCommand(
  store: AnimationEditorStore,
  label: string,
  mutation: (draft: DeepMutable<AnimationEditorProject>) => void,
): EditorCommand | null {
  const before = store.project;
  const draft = cloneAnimationEditorProject(before);
  mutation(draft);
  const after = freezeAnimationEditorProject(draft as unknown as AnimationEditorProject);
  if (animationEditorProjectSnapshotKey(before) === animationEditorProjectSnapshotKey(after)) return null;
  const estimatedBytes = (animationEditorProjectSnapshotKey(before).length + animationEditorProjectSnapshotKey(after).length) * 2;
  return Object.freeze({
    label,
    estimatedBytes,
    execute: () => store.replaceProject(after, { reason: label }),
    undo: () => { store.replaceProject(before, { reason: `undo:${label}` }); },
  });
}

function commandBytes(command: EditorCommand): number {
  const value = Number(command.estimatedBytes);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 1024;
}
