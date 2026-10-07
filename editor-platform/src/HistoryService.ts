import type {
  EditorCommand,
  EditorDisposable,
  EditorHistoryEntrySnapshot,
  EditorHistorySnapshot,
} from '@haiyue/editor-plugin-sdk';

interface HistoryEntry {
  readonly id: number;
  readonly command: EditorCommand;
  readonly label: string;
  readonly estimatedBytes: number;
}

interface HistoryGroup {
  readonly label: string;
  readonly entries: HistoryEntry[];
  estimatedBytes: number;
}

export interface EditorHistoryOptions {
  readonly byteBudget?: number;
  readonly maxEntries?: number;
  readonly changed?: (snapshot: EditorHistorySnapshot) => void;
}

export class EditorHistoryService implements EditorDisposable {
  private readonly undoEntries: HistoryEntry[] = [];
  private readonly redoEntries: HistoryEntry[] = [];
  private readonly groups: HistoryGroup[] = [];
  private readonly listeners = new Set<(snapshot: EditorHistorySnapshot) => void>();
  private readonly byteBudget: number;
  private readonly maxEntries: number;
  private nextId = 1;
  private revision = 0;
  private busy = false;
  private disposed = false;
  private atomicDisposals: HistoryEntry[] | undefined;
  private publishingAtomic = false;

  /** Synchronous transaction. The caller restores domain state if operation/observers throw. */
  runAtomic<T>(operation: () => T): T {
    this.assertReadyForMutation();
    if (this.atomicDisposals || this.groups.length) throw new Error('History transaction is already active.');
    if (operation.constructor.name === 'AsyncFunction') throw new TypeError('History transactions must be synchronous.');
    const undo = [...this.undoEntries], redo = [...this.redoEntries], revision = this.revision, nextId = this.nextId;
    const discarded: HistoryEntry[] = [];
    this.atomicDisposals = discarded;
    try {
      const result = operation();
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new TypeError('History transactions must be synchronous.');
      if (this.groups.length) throw new Error('History transaction left an open group.');
      this.atomicDisposals = undefined;
      this.publishingAtomic = true;
      try { this.emit(); } finally { this.publishingAtomic = false; }
      for (const entry of discarded) { try { entry.command.dispose?.(); } catch { /* Cleanup cannot invalidate committed state. */ } }
      return result;
    } catch (error) {
      const retained = new Set([...undo, ...redo]);
      const abandoned = new Set([...this.undoEntries, ...this.redoEntries, ...discarded, ...this.groups.flatMap(group => group.entries)]);
      this.atomicDisposals = undefined;
      this.groups.length = 0;
      this.undoEntries.splice(0, this.undoEntries.length, ...undo);
      this.redoEntries.splice(0, this.redoEntries.length, ...redo);
      this.revision = revision; this.nextId = nextId;
      for (const entry of abandoned) if (!retained.has(entry)) { try { entry.command.dispose?.(); } catch { /* Preserve the original error. */ } }
      const snapshot = this.snapshot();
      this.publishingAtomic = true;
      try { for (const listener of this.listeners) { try { listener(snapshot); } catch { /* Best effort rollback notification. */ } } }
      finally { this.publishingAtomic = false; }
      throw error;
    }
  }

  constructor(options: EditorHistoryOptions = {}) {
    this.byteBudget = Math.max(1, options.byteBudget ?? 32 * 1024 * 1024);
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 200));
    if (options.changed) this.listeners.add(options.changed);
  }

  get canUndo(): boolean { return !this.busy && this.groups.length === 0 && this.undoEntries.length > 0; }
  get canRedo(): boolean { return !this.busy && this.groups.length === 0 && this.redoEntries.length > 0; }
  get activeGroupDepth(): number { return this.groups.length; }

  execute(command: EditorCommand): boolean {
    this.assertReadyForMutation();
    const entry = this.createEntry(command);
    this.assertFitsActiveGroup(entry.estimatedBytes);
    const applied = this.withBusy(() => command.execute() !== false);
    if (!applied) return false;
    this.recordEntry(entry);
    return true;
  }

  recordApplied(command: EditorCommand): void {
    this.assertReadyForMutation();
    const entry = this.createEntry(command);
    this.assertFitsActiveGroup(entry.estimatedBytes);
    this.recordEntry(entry);
  }

  beginGroup(label: string): void {
    this.assertReadyForMutation();
    if (this.atomicDisposals) throw new Error('Cannot begin a group inside an atomic history transaction.');
    if (!label.trim()) throw new TypeError('History group label is required.');
    this.groups.push({ label, entries: [], estimatedBytes: 0 });
    this.emit();
  }

  endGroup(): void {
    this.assertActive();
    const group = this.groups.pop();
    if (!group) throw new Error('No history group is active.');
    if (group.entries.length === 0) {
      this.emit();
      return;
    }
    const entry = this.createCompositeEntry(group);
    const parent = this.groups.at(-1);
    if (parent) {
      parent.entries.push(entry);
      parent.estimatedBytes += entry.estimatedBytes;
    } else {
      this.pushUndo(entry);
    }
    this.emit();
  }

  cancelGroup(): void {
    this.assertActive();
    const group = this.groups.pop();
    if (!group) throw new Error('No history group is active.');
    this.withBusy(() => {
      for (const entry of group.entries.slice().reverse()) entry.command.undo();
    });
    for (const entry of group.entries) entry.command.dispose?.();
    this.emit();
  }

  runGroup<T>(label: string, operation: () => T): T {
    this.beginGroup(label);
    try {
      const result = operation();
      this.endGroup();
      return result;
    } catch (error) {
      this.cancelGroup();
      throw error;
    }
  }

  undo(): boolean {
    this.assertReadyForMutation();
    const entry = this.undoEntries.pop();
    if (!entry) return false;
    try {
      this.withBusy(() => entry.command.undo());
      this.redoEntries.push(entry);
      this.emit();
      return true;
    } catch (error) {
      this.undoEntries.push(entry);
      this.emit();
      throw error;
    }
  }

  redo(): boolean {
    this.assertReadyForMutation();
    const entry = this.redoEntries.pop();
    if (!entry) return false;
    try {
      const applied = this.withBusy(() => (entry.command.redo?.() ?? entry.command.execute()) !== false);
      if (!applied) throw new Error(`History command ${entry.label} rejected redo.`);
      this.undoEntries.push(entry);
      this.enforceBudget();
      this.emit();
      return true;
    } catch (error) {
      this.redoEntries.push(entry);
      this.emit();
      throw error;
    }
  }

  clear(): void {
    this.assertReadyForMutation();
    if (this.groups.length > 0) throw new Error('Cannot clear history while a group is active.');
    this.disposeEntries(this.undoEntries.splice(0));
    this.disposeEntries(this.redoEntries.splice(0));
    this.emit();
  }

  snapshot(): EditorHistorySnapshot {
    const undo = this.undoEntries.at(-1);
    const redo = this.redoEntries.at(-1);
    const entries: readonly EditorHistoryEntrySnapshot[] = Object.freeze(this.undoEntries.map(entry => Object.freeze({
      id: entry.id,
      label: entry.label,
      estimatedBytes: entry.estimatedBytes,
    })));
    return Object.freeze({
      revision: this.revision,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      ...(undo ? { undoLabel: undo.label } : {}),
      ...(redo ? { redoLabel: redo.label } : {}),
      busy: this.busy,
      estimatedBytes: this.totalBytes(),
      entries,
    });
  }

  subscribe(listener: (snapshot: EditorHistorySnapshot) => void, emitInitial = false): EditorDisposable {
    this.assertActive();
    this.listeners.add(listener);
    if (emitInitial) listener(this.snapshot());
    return disposable(() => this.listeners.delete(listener));
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.atomicDisposals || this.publishingAtomic) throw new Error('Cannot dispose history during an atomic transaction.');
    while (this.groups.length > 0) this.cancelGroup();
    this.disposeEntries(this.undoEntries.splice(0));
    this.disposeEntries(this.redoEntries.splice(0));
    this.listeners.clear();
    this.disposed = true;
  }

  private createEntry(command: EditorCommand): HistoryEntry {
    if (!command.label.trim()) throw new TypeError('History command label is required.');
    const estimatedBytes = Math.max(0, Math.floor(command.estimatedBytes ?? 0));
    if (estimatedBytes > this.byteBudget) {
      throw new RangeError(`History command ${command.label} exceeds the ${this.byteBudget} byte budget.`);
    }
    return { id: this.nextId++, command, label: command.label, estimatedBytes };
  }

  private createCompositeEntry(group: HistoryGroup): HistoryEntry {
    const entries = Object.freeze([...group.entries]);
    const command: EditorCommand = {
      label: group.label,
      estimatedBytes: group.estimatedBytes,
      execute() {
        for (const entry of entries) {
          if ((entry.command.redo?.() ?? entry.command.execute()) === false) {
            throw new Error(`Grouped history command ${entry.label} rejected execution.`);
          }
        }
      },
      undo() { for (const entry of entries.slice().reverse()) entry.command.undo(); },
      dispose() { for (const entry of entries) entry.command.dispose?.(); },
    };
    return { id: this.nextId++, command, label: group.label, estimatedBytes: group.estimatedBytes };
  }

  private assertFitsActiveGroup(bytes: number): void {
    const group = this.groups.at(-1);
    if (group && group.estimatedBytes + bytes > this.byteBudget) {
      throw new RangeError(`History group ${group.label} exceeds the ${this.byteBudget} byte budget.`);
    }
  }

  private recordEntry(entry: HistoryEntry): void {
    const group = this.groups.at(-1);
    if (group) {
      group.entries.push(entry);
      group.estimatedBytes += entry.estimatedBytes;
      this.emit();
      return;
    }
    this.pushUndo(entry);
    this.emit();
  }

  private pushUndo(entry: HistoryEntry): void {
    this.disposeEntries(this.redoEntries.splice(0));
    const previous = this.undoEntries.at(-1);
    const merged = previous?.command.mergeWith?.(entry.command) ?? null;
    if (previous && merged) {
      const mergedEntry = this.createEntry(merged);
      this.undoEntries[this.undoEntries.length - 1] = mergedEntry;
      this.enforceBudget();
      return;
    }
    this.undoEntries.push(entry);
    this.enforceBudget();
  }

  private enforceBudget(): void {
    while ((this.totalBytes() > this.byteBudget || this.undoEntries.length > this.maxEntries) && this.undoEntries.length > 1) {
      const removed = this.undoEntries.shift();
      if (removed) this.disposeEntries([removed]);
    }
  }

  private totalBytes(): number {
    return [...this.undoEntries, ...this.redoEntries].reduce((sum, entry) => sum + entry.estimatedBytes, 0);
  }

  private disposeEntries(entries: readonly HistoryEntry[]): void {
    if (this.atomicDisposals) { this.atomicDisposals.push(...entries); return; }
    for (const entry of entries) entry.command.dispose?.();
  }

  private withBusy<T>(operation: () => T): T {
    if (this.busy) throw new Error('History is already executing a command.');
    this.busy = true;
    this.emit();
    try { return operation(); }
    finally {
      this.busy = false;
      this.emit();
    }
  }

  private emit(): void {
    if (this.atomicDisposals) return;
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private assertReadyForMutation(): void {
    this.assertActive();
    if (this.busy || this.publishingAtomic) throw new Error('History is busy.');
    if (this.groups.length > 0 && (this.canUndo || this.canRedo)) throw new Error('Invalid history group state.');
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('History is disposed.');
  }
}

function disposable(dispose: () => void): EditorDisposable {
  let active = true;
  return Object.freeze({ dispose() { if (active) { active = false; dispose(); } } });
}
