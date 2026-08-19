export type DesignerTaskState = 'idle' | 'running' | 'completed' | 'cancelled' | 'failed' | 'closed';

export interface DesignerTaskSnapshot {
  readonly generation: number;
  readonly label: string;
  readonly state: DesignerTaskState;
  readonly progress: number;
  readonly detail: string;
  readonly durationMs: number;
}

export interface DesignerTaskContext {
  readonly signal: AbortSignal;
  readonly report: (progress: number, detail?: string) => void;
}

type DesignerTaskListener = (snapshot: DesignerTaskSnapshot) => void;

/** Latest-wins owner for import, compile, package, and other cancellable editor tasks. */
export class DesignerTaskCoordinator {
  #generation = 0;
  #active: { generation: number; startedAt: number; settled: Promise<unknown> } | null = null;
  #closed = false;
  #listeners = new Set<DesignerTaskListener>();
  #snapshot: DesignerTaskSnapshot = Object.freeze({
    generation: 0, label: '', state: 'idle', progress: 0, detail: '', durationMs: 0,
  });

  private readonly tasks: EditorTaskCoordinator;
  private readonly ownsTasks: boolean;

  constructor(tasks?: EditorTaskCoordinator) {
    this.tasks = tasks ?? new EditorTaskCoordinator();
    this.ownsTasks = tasks === undefined;
  }

  get snapshot(): DesignerTaskSnapshot { return this.#snapshot; }
  get active(): boolean { return this.#active !== null; }
  get listenerCount(): number { return this.#listeners.size; }

  subscribe(listener: DesignerTaskListener): () => void {
    if (this.#closed) throw new Error('Designer task coordinator is closed.');
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  async run<T>(label: string, task: (context: DesignerTaskContext) => Promise<T>): Promise<T> {
    if (this.#closed) throw new DOMException('Designer task coordinator is closed.', 'AbortError');
    if (this.#active) await this.cancel();
    const generation = ++this.#generation;
    const startedAt = performance.now();
    this.#publish({ generation, label, state: 'running', progress: 0, detail: '', durationMs: 0 });
    const active = { generation, startedAt, settled: Promise.resolve() as Promise<unknown> };
    this.#active = active;
    const resultPromise = this.tasks.run(`animation-editor:${label}`, {
      prepare: async context => task(Object.freeze({
        signal: context.signal,
        report: (progress: number, detail = '') => {
          context.report({ current: clamp(progress), total: 1, ...(detail ? { message: detail } : {}) });
          if (this.#active?.generation !== generation) return;
          this.#publish({
            generation, label, state: 'running', progress: clamp(progress), detail,
            durationMs: performance.now() - startedAt,
          });
        },
      })),
      commit: value => value,
    });
    active.settled = resultPromise;
    try {
      const result = await resultPromise;
      this.#active = null;
      if (result.status === 'cancelled') throw abortError();
      if (result.status === 'failed') throw result.error;
      this.#publish({ generation, label, state: 'completed', progress: 1, detail: '', durationMs: performance.now() - startedAt });
      return result.value;
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      if (this.#active === active) this.#active = null;
      this.#publish({
        generation, label, state: cancelled ? 'cancelled' : 'failed', progress: this.#snapshot.progress,
        detail: cancelled ? 'cancelled' : error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - startedAt,
      });
      throw cancelled ? abortError() : error;
    }
  }

  async cancel(): Promise<void> {
    const active = this.#active;
    if (!active) return;
    this.tasks.cancel(`animation-editor:${this.#snapshot.label}`);
    this.#publish({
      ...this.#snapshot, generation: active.generation, state: 'cancelled',
      durationMs: performance.now() - active.startedAt,
    });
    await active.settled;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.cancel();
    this.#closed = true;
    this.#publish({ ...this.#snapshot, state: 'closed' });
    this.#listeners.clear();
    if (this.ownsTasks) this.tasks.dispose();
  }

  #publish(snapshot: DesignerTaskSnapshot): void {
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of this.#listeners) listener(this.#snapshot);
  }
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function abortError(): DOMException {
  return new DOMException('Designer task was cancelled.', 'AbortError');
}
import { EditorTaskCoordinator } from '@haiyue/editor-platform';
