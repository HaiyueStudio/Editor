import { EditorHistoryService } from '@haiyue/editor-platform';
import type { Command } from '../types';
import {
  isHierarchyTransactionActive,
  measureHierarchyStage,
} from '../domain/scene/hierarchyTransactionMetrics';

export class CommandBus {
  private readonly _history: EditorHistoryService;
  private readonly _ownsHistory: boolean;
  private readonly _groupMutations: boolean[] = [];

  constructor(
    private readonly _onChange: () => void,
    history?: EditorHistoryService,
  ) {
    this._history = history ?? new EditorHistoryService();
    this._ownsHistory = history === undefined;
  }

  execute(command: Command): void {
    const applied = this._history.execute(command);
    if (!applied) return;
    if (this._groupMutations.length > 0) {
      this._groupMutations[this._groupMutations.length - 1] = true;
      return;
    }
    this._notifyChange();
  }

  beginGroup(label: string): void {
    this._history.beginGroup(label);
    this._groupMutations.push(false);
  }

  endGroup(): void {
    if (this._history.activeGroupDepth === 0) return;
    const changed = this._groupMutations.pop() ?? false;
    this._history.endGroup();
    if (!changed) return;
    if (this._groupMutations.length > 0) {
      this._groupMutations[this._groupMutations.length - 1] = true;
      return;
    }
    this._notifyChange();
  }

  cancelGroup(): void {
    if (this._history.activeGroupDepth === 0) return;
    this._groupMutations.pop();
    this._history.cancelGroup();
  }

  runGroup(label: string, callback: () => void): void {
    this._history.runGroup(label, callback);
  }

  undo(): void {
    if (this._history.activeGroupDepth > 0) return;
    if (this._history.undo()) this._notifyChange();
  }

  redo(): void {
    if (this._history.activeGroupDepth > 0) return;
    if (this._history.redo()) this._notifyChange();
  }

  get canUndo(): boolean {
    return this._history.canUndo;
  }

  get canRedo(): boolean {
    return this._history.canRedo;
  }

  get platformHistory(): EditorHistoryService { return this._history; }

  dispose(): void {
    if (this._ownsHistory) this._history.dispose();
  }

  private _notifyChange(): void {
    if (isHierarchyTransactionActive()) measureHierarchyStage('dirty-notification', this._onChange);
    else this._onChange();
  }
}
