import { HistoryManager } from '../scene/history';
import type { Command } from '../types';
import {
  isHierarchyTransactionActive,
  measureHierarchyStage,
} from '../domain/scene/hierarchyTransactionMetrics';

interface CommandGroup {
  label: string;
  commands: Command[];
}

export class CommandBus {
  private readonly _history: HistoryManager;
  private readonly _groups: CommandGroup[] = [];

  constructor(onChange: () => void) {
    this._history = new HistoryManager(
      () => {
        if (isHierarchyTransactionActive()) measureHierarchyStage('dirty-notification', onChange);
        else onChange();
      },
    );
  }

  execute(command: Command): void {
    if (this._groups.length > 0) {
      command.execute();
      this._groups.at(-1)?.commands.push(command);
      return;
    }
    this._history.execute(command);
  }

  beginGroup(label: string): void {
    this._groups.push({ label, commands: [] });
  }

  endGroup(): void {
    const group = this._groups.pop();
    if (!group) return;
    const command = createCompositeCommand(group.label, group.commands);
    if (!command) return;
    const parent = this._groups.at(-1);
    if (parent) parent.commands.push(command);
    else this._history.pushExecuted(command);
  }

  cancelGroup(): void {
    const group = this._groups.pop();
    if (!group) return;
    for (const command of group.commands.slice().reverse()) command.undo();
  }

  runGroup(label: string, callback: () => void): void {
    this.beginGroup(label);
    try {
      callback();
      this.endGroup();
    } catch (error) {
      this.cancelGroup();
      throw error;
    }
  }

  undo(): void {
    if (this._groups.length > 0) return;
    this._history.undo();
  }

  redo(): void {
    if (this._groups.length > 0) return;
    this._history.redo();
  }

  get canUndo(): boolean {
    return this._history.canUndo;
  }

  get canRedo(): boolean {
    return this._history.canRedo;
  }
}

function createCompositeCommand(label: string, commands: readonly Command[]): Command | null {
  const items = commands.filter(Boolean);
  if (items.length === 0) return null;
  if (items.length === 1) return items[0] ?? null;
  return {
    label,
    execute: () => {
      for (const command of items) command.execute();
    },
    undo: () => {
      for (const command of items.slice().reverse()) command.undo();
    },
  };
}
