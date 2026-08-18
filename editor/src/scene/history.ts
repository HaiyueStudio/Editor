import type { Command } from '../types';

export interface HistoryManagerOptions {
  maxLength?: number;
}

export interface ExecuteCommandOptions {
  alreadyExecuted?: boolean;
}

const DEFAULT_HISTORY_MAX_LENGTH = 200;

export class HistoryManager {
  private readonly _undoStack: Command[] = [];
  private readonly _redoStack: Command[] = [];
  private readonly _maxLength: number;

  constructor(private readonly _onChange: () => void, options: HistoryManagerOptions = {}) {
    this._maxLength = normalizeMaxLength(options.maxLength);
  }

  execute(command: Command, options: ExecuteCommandOptions = {}): void {
    if (!options.alreadyExecuted) command.execute();
    this._pushUndoCommand(command);
    this._redoStack.length = 0;
    this._onChange();
  }

  pushExecuted(command: Command): void {
    this.execute(command, { alreadyExecuted: true });
  }

  private _pushUndoCommand(command: Command): void {
    const previous = this._undoStack.at(-1);
    const merged = previous?.mergeWith?.(command) ?? null;
    if (merged) this._undoStack[this._undoStack.length - 1] = merged;
    else this._undoStack.push(command);
    this._trimUndoStack();
  }

  undo(): void {
    const command = this._undoStack.pop();
    if (!command) return;
    command.undo();
    this._redoStack.push(command);
    this._onChange();
  }

  redo(): void {
    const command = this._redoStack.pop();
    if (!command) return;
    command.execute();
    this._undoStack.push(command);
    this._trimUndoStack();
    this._onChange();
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  private _trimUndoStack(): void {
    const overflow = this._undoStack.length - this._maxLength;
    if (overflow > 0) this._undoStack.splice(0, overflow);
  }
}

function normalizeMaxLength(value: number | undefined): number {
  if (value === undefined) return DEFAULT_HISTORY_MAX_LENGTH;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_HISTORY_MAX_LENGTH;
}
