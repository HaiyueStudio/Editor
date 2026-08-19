import type {
  EditorDisposable,
  EditorTaskContext,
  EditorTaskDefinition,
  EditorTaskProgress,
} from '@haiyue/editor-plugin-sdk';

export type EditorTaskStatus = 'completed' | 'cancelled' | 'failed';
export type EditorTaskResult<T> =
  | Readonly<{ status: 'completed'; value: T }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'failed'; error: unknown }>;

export interface EditorTaskSnapshot {
  readonly lane: string;
  readonly generation: number;
  readonly phase: 'preparing' | 'committing' | 'rolling-back';
  readonly progress?: EditorTaskProgress;
}

interface ActiveTask {
  readonly generation: number;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  settle(): void;
}

export class EditorTaskCoordinator implements EditorDisposable {
  private readonly active = new Map<string, ActiveTask>();
  private readonly generations = new Map<string, number>();
  private readonly listeners = new Set<(snapshot: EditorTaskSnapshot) => void>();
  private disposed = false;

  get activeCount(): number { return this.active.size; }

  async run<Prepared, Result>(lane: string, definition: EditorTaskDefinition<Prepared, Result>): Promise<EditorTaskResult<Result>> {
    this.assertActive();
    const normalizedLane = lane.trim();
    if (!normalizedLane) throw new TypeError('Task lane is required.');
    const predecessor = this.active.get(normalizedLane);
    predecessor?.controller.abort(`editor-task:${normalizedLane}:superseded`);
    const generation = (this.generations.get(normalizedLane) ?? 0) + 1;
    this.generations.set(normalizedLane, generation);
    const run = createActiveTask(generation);
    this.active.set(normalizedLane, run);
    let prepared: Prepared | undefined;
    try {
      if (predecessor) await predecessor.settled;
      this.assertCurrent(normalizedLane, run);
      this.emit(normalizedLane, generation, 'preparing');
      prepared = await definition.prepare(this.context(normalizedLane, run));
      this.assertCurrent(normalizedLane, run);
      this.emit(normalizedLane, generation, 'committing');
      const value = definition.commit(prepared);
      if (isPromiseLike(value)) throw new TypeError(`Task ${normalizedLane} commit must be synchronous.`);
      return Object.freeze({ status: 'completed', value });
    } catch (error) {
      const cancelled = run.controller.signal.aborted || isAbortError(error);
      if (definition.rollback) {
        this.emit(normalizedLane, generation, 'rolling-back');
        try { await definition.rollback(cancelled ? 'cancelled' : 'failed', prepared, error); }
        catch (rollbackError) { return Object.freeze({ status: 'failed', error: rollbackError }); }
      }
      return cancelled
        ? Object.freeze({ status: 'cancelled' })
        : Object.freeze({ status: 'failed', error });
    } finally {
      if (this.active.get(normalizedLane) === run) this.active.delete(normalizedLane);
      run.settle();
    }
  }

  cancel(lane: string): void { this.active.get(lane)?.controller.abort(`editor-task:${lane}:cancelled`); }

  cancelAll(): void {
    for (const [lane, task] of this.active) task.controller.abort(`editor-task:${lane}:disposed`);
  }

  subscribe(listener: (snapshot: EditorTaskSnapshot) => void): EditorDisposable {
    this.assertActive();
    this.listeners.add(listener);
    return disposable(() => this.listeners.delete(listener));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
    this.listeners.clear();
  }

  private context(lane: string, run: ActiveTask): EditorTaskContext {
    return Object.freeze({
      signal: run.controller.signal,
      generation: run.generation,
      report: (progress: EditorTaskProgress) => {
        if (this.isCurrent(lane, run)) this.emit(lane, run.generation, 'preparing', normalizeProgress(progress));
      },
      assertCurrent: () => this.assertCurrent(lane, run),
    });
  }

  private isCurrent(lane: string, run: ActiveTask): boolean {
    return !this.disposed && !run.controller.signal.aborted && this.active.get(lane) === run;
  }

  private assertCurrent(lane: string, run: ActiveTask): void {
    if (this.isCurrent(lane, run)) return;
    const error = new Error(`Task ${lane} is no longer current.`);
    error.name = 'AbortError';
    throw error;
  }

  private emit(lane: string, generation: number, phase: EditorTaskSnapshot['phase'], progress?: EditorTaskProgress): void {
    const snapshot = Object.freeze({ lane, generation, phase, ...(progress ? { progress } : {}) });
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private assertActive(): void { if (this.disposed) throw new Error('Task coordinator is disposed.'); }
}

function createActiveTask(generation: number): ActiveTask {
  const controller = new AbortController();
  let resolve!: () => void;
  const settled = new Promise<void>(done => { resolve = done; });
  return { generation, controller, settled, settle: resolve };
}

function normalizeProgress(progress: EditorTaskProgress): EditorTaskProgress {
  const total = progress.total === undefined ? undefined : Math.max(0, progress.total);
  const current = Math.max(0, total === undefined ? progress.current : Math.min(total, progress.current));
  return Object.freeze({ current, ...(total === undefined ? {} : { total }), ...(progress.message ? { message: progress.message } : {}) });
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return ((typeof value === 'object' && value !== null) || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}

function disposable(dispose: () => void): EditorDisposable {
  let active = true;
  return Object.freeze({ dispose() { if (active) { active = false; dispose(); } } });
}
