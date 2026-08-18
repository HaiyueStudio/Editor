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
  #active: Readonly<{ generation: number; controller: AbortController; startedAt: number }> | null = null;
  #closed = false;
  #listeners = new Set<DesignerTaskListener>();
  #snapshot: DesignerTaskSnapshot = Object.freeze({
    generation: 0, label: '', state: 'idle', progress: 0, detail: '', durationMs: 0,
  });

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
    const controller = new AbortController();
    const startedAt = performance.now();
    const active = Object.freeze({ generation, controller, startedAt });
    this.#active = active;
    this.#publish({ generation, label, state: 'running', progress: 0, detail: '', durationMs: 0 });
    const report = (progress: number, detail = ''): void => {
      if (this.#active !== active || controller.signal.aborted) return;
      this.#publish({
        generation, label, state: 'running', progress: clamp(progress), detail,
        durationMs: performance.now() - startedAt,
      });
    };
    try {
      const result = await task(Object.freeze({ signal: controller.signal, report }));
      if (controller.signal.aborted || this.#active !== active) throw abortError();
      this.#active = null;
      this.#publish({ generation, label, state: 'completed', progress: 1, detail: '', durationMs: performance.now() - startedAt });
      return result;
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError';
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
    this.#active = null;
    active.controller.abort('cancelled');
    this.#publish({
      ...this.#snapshot, generation: active.generation, state: 'cancelled',
      durationMs: performance.now() - active.startedAt,
    });
    await Promise.resolve();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.cancel();
    this.#closed = true;
    this.#publish({ ...this.#snapshot, state: 'closed' });
    this.#listeners.clear();
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
