export type CoreWorkflowKind = 'open' | 'save' | 'import' | 'export' | 'preview';
export type WorkflowStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export type WorkflowPhase = 'preparing' | 'committing' | 'rolling-back';

export interface WorkflowProgress {
  readonly current: number;
  readonly total?: number;
  readonly message?: string;
}

export interface WorkflowSnapshot {
  readonly kind: CoreWorkflowKind;
  readonly status: WorkflowStatus;
  readonly phase?: WorkflowPhase;
  readonly progress?: WorkflowProgress;
  readonly runId: number;
  readonly error?: unknown;
}

export interface WorkflowPrepareContext {
  readonly signal: AbortSignal;
  reportProgress(progress: WorkflowProgress): void;
}

/**
 * Long-running work belongs in prepare. commit must be a short, synchronous mutation.
 * A prepared value must not mutate shared editor state before commit is called.
 */
export interface WorkflowTask<Prepared, Result = Prepared> {
  prepare(context: WorkflowPrepareContext): Promise<Prepared> | Prepared;
  commit(prepared: Prepared): Result;
  rollback?(reason: 'cancelled' | 'failed', prepared: Prepared | undefined, error?: unknown): Promise<void> | void;
}

export type WorkflowResult<T> =
  | Readonly<{ status: 'completed'; value: T }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'failed'; error: unknown }>;

interface ActiveWorkflowRun {
  readonly id: number;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  settle(): void;
}

/** Coordinates isolated prepare/commit workflows and retires an older same-kind run before starting its successor. */
export class CoreWorkflowCoordinator {
  private readonly _runs = new Map<CoreWorkflowKind, ActiveWorkflowRun>();
  private _nextRunId = 1;

  constructor(private readonly _changed: (snapshot: WorkflowSnapshot) => void = () => {}) {}

  openDocument<P, T = P>(task: WorkflowTask<P, T>): Promise<WorkflowResult<T>> { return this._run('open', task); }
  saveDocument<P, T = P>(task: WorkflowTask<P, T>): Promise<WorkflowResult<T>> { return this._run('save', task); }
  importAssets<P, T = P>(task: WorkflowTask<P, T>): Promise<WorkflowResult<T>> { return this._run('import', task); }
  preview<P, T = P>(task: WorkflowTask<P, T>): Promise<WorkflowResult<T>> { return this._run('preview', task); }
  exportProject<P, T = P>(task: WorkflowTask<P, T>): Promise<WorkflowResult<T>> { return this._run('export', task); }

  cancel(kind: CoreWorkflowKind): void {
    this._runs.get(kind)?.controller.abort(`editor-workflow:${kind}:cancelled`);
  }

  cancelAll(): void {
    for (const [kind, run] of this._runs) run.controller.abort(`editor-workflow:${kind}:disposed`);
  }

  get activeCount(): number { return this._runs.size; }

  private async _run<P, T>(kind: CoreWorkflowKind, task: WorkflowTask<P, T>): Promise<WorkflowResult<T>> {
    const predecessor = this._runs.get(kind);
    predecessor?.controller.abort(`editor-workflow:${kind}:superseded`);

    const run = createActiveRun(this._nextRunId++);
    this._runs.set(kind, run);
    let prepared: P | undefined;
    try {
      // Do not let an older rollback race a newer prepare/commit against the same state.
      if (predecessor) await predecessor.settled;
      if (run.controller.signal.aborted || this._runs.get(kind)?.id !== run.id) {
        const rollbackFailure = await this._rollback(kind, run.id, task, 'cancelled', undefined);
        if (rollbackFailure) return this._failed(kind, run.id, rollbackFailure.error);
        return this._cancelled(kind, run.id);
      }

      this._emit(kind, run.id, 'running', 'preparing');
      prepared = await task.prepare({
        signal: run.controller.signal,
        reportProgress: progress => {
          if (!run.controller.signal.aborted && this._runs.get(kind)?.id === run.id) {
            this._emit(kind, run.id, 'running', 'preparing', normalizeProgress(progress));
          }
        },
      });

      if (run.controller.signal.aborted || this._runs.get(kind)?.id !== run.id) {
        const rollbackFailure = await this._rollback(kind, run.id, task, 'cancelled', prepared);
        if (rollbackFailure) return this._failed(kind, run.id, rollbackFailure.error);
        return this._cancelled(kind, run.id);
      }

      this._emit(kind, run.id, 'running', 'committing');
      const value = task.commit(prepared);
      if (isPromiseLike(value)) {
        throw new TypeError(`Workflow ${kind} commit must be synchronous; move asynchronous work to prepare().`);
      }
      this._emit(kind, run.id, 'completed');
      return Object.freeze({ status: 'completed', value });
    } catch (error) {
      const cancelled = run.controller.signal.aborted || isAbortError(error);
      const rollbackFailure = await this._rollback(kind, run.id, task, cancelled ? 'cancelled' : 'failed', prepared, error);
      if (rollbackFailure) return this._failed(kind, run.id, rollbackFailure.error);
      if (cancelled) return this._cancelled(kind, run.id);
      return this._failed(kind, run.id, error);
    } finally {
      if (this._runs.get(kind)?.id === run.id) this._runs.delete(kind);
      run.settle();
    }
  }

  private async _rollback<P, T>(
    kind: CoreWorkflowKind,
    runId: number,
    task: WorkflowTask<P, T>,
    reason: 'cancelled' | 'failed',
    prepared: P | undefined,
    error?: unknown,
  ): Promise<{ readonly error: unknown } | null> {
    if (!task.rollback) return null;
    this._emit(kind, runId, 'running', 'rolling-back');
    try {
      await task.rollback(reason, prepared, error);
      return null;
    } catch (rollbackError) {
      return Object.freeze({ error: rollbackError });
    }
  }

  private _cancelled(kind: CoreWorkflowKind, runId: number): WorkflowResult<never> {
    this._emit(kind, runId, 'cancelled');
    return Object.freeze({ status: 'cancelled' });
  }

  private _failed(kind: CoreWorkflowKind, runId: number, error: unknown): WorkflowResult<never> {
    this._emit(kind, runId, 'failed', undefined, undefined, error);
    return Object.freeze({ status: 'failed', error });
  }

  private _emit(
    kind: CoreWorkflowKind,
    runId: number,
    status: WorkflowStatus,
    phase?: WorkflowPhase,
    progress?: WorkflowProgress,
    error?: unknown,
  ): void {
    this._changed(Object.freeze({
      kind,
      status,
      ...(phase === undefined ? {} : { phase }),
      ...(progress === undefined ? {} : { progress }),
      ...(error === undefined ? {} : { error }),
      runId,
    }));
  }
}

function createActiveRun(id: number): ActiveWorkflowRun {
  const controller = new AbortController();
  let resolveSettled!: () => void;
  const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
  return { id, controller, settled, settle: resolveSettled };
}

function normalizeProgress(progress: WorkflowProgress): WorkflowProgress {
  const total = progress.total === undefined ? undefined : Math.max(0, progress.total);
  const current = Math.max(0, total === undefined ? progress.current : Math.min(progress.current, total));
  return Object.freeze({
    current,
    ...(total === undefined ? {} : { total }),
    ...(progress.message === undefined ? {} : { message: progress.message }),
  });
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false;
}
