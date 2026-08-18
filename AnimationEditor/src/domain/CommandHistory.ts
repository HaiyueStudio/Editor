import {
  animationEditorProjectSnapshotKey,
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorProject,
  type DeepMutable,
} from './AnimationEditorProject';
import { AnimationEditorStore } from './AnimationEditorStore';

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
  private readonly _undoStack: EditorCommand[] = [];
  private readonly _redoStack: EditorCommand[] = [];
  private readonly _listeners = new Set<CommandHistoryListener>();
  private readonly _limit: number;
  private readonly _byteBudget: number;
  private _undoBytes = 0;
  private _redoBytes = 0;

  constructor(limit = 100, byteBudget = 32 * 1024 * 1024) {
    this._limit = Math.max(1, Math.floor(limit));
    this._byteBudget = Math.max(1, Math.floor(byteBudget));
  }

  get canUndo(): boolean { return this._undoStack.length > 0; }
  get canRedo(): boolean { return this._redoStack.length > 0; }
  get undoLabel(): string | null { return this._undoStack.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this._redoStack.at(-1)?.label ?? null; }
  get estimatedBytes(): number { return this._undoBytes + this._redoBytes; }
  get byteBudget(): number { return this._byteBudget; }

  subscribe(listener: CommandHistoryListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  execute(command: EditorCommand | null): boolean {
    if (!command || !command.execute()) return false;
    this.recordApplied(command);
    return true;
  }

  recordApplied(command: EditorCommand): void {
    const bytes = commandBytes(command);
    this._redoStack.length = 0;
    this._redoBytes = 0;
    if (bytes > this._byteBudget) {
      this._undoStack.length = 0;
      this._undoBytes = 0;
      this._notify();
      return;
    }
    this._undoStack.push(command);
    this._undoBytes += bytes;
    while ((this._undoStack.length > this._limit || this._undoBytes > this._byteBudget) && this._undoStack.length > 1) {
      const removed = this._undoStack.shift();
      if (removed) this._undoBytes -= commandBytes(removed);
    }
    this._notify();
  }

  undo(): string | null {
    const command = this._undoStack.pop();
    if (!command) return null;
    const bytes = commandBytes(command);
    this._undoBytes -= bytes;
    command.undo();
    this._redoStack.push(command);
    this._redoBytes += bytes;
    this._notify();
    return command.label;
  }

  redo(): string | null {
    const command = this._redoStack.pop();
    if (!command) return null;
    const bytes = commandBytes(command);
    this._redoBytes -= bytes;
    if (!command.execute()) {
      this._redoStack.push(command);
      this._redoBytes += bytes;
      return null;
    }
    this._undoStack.push(command);
    this._undoBytes += bytes;
    this._notify();
    return command.label;
  }

  clear(): void {
    if (!this.canUndo && !this.canRedo) return;
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._undoBytes = 0;
    this._redoBytes = 0;
    this._notify();
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
