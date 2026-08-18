export type EditorEvent<K extends string, P> = Readonly<{ type: K; payload: P }>;

export class EditorEventBus<TEvents extends object> {
  private readonly _listeners = new Set<(event: EditorEvent<keyof TEvents & string, TEvents[keyof TEvents]>) => void>();
  private readonly _listenersByType = new Map<keyof TEvents, Set<(payload: TEvents[keyof TEvents]) => void>>();
  private _batchDepth = 0;
  private _batch: EditorEvent<keyof TEvents & string, TEvents[keyof TEvents]>[] = [];
  private readonly _batchEventIndexes = new Map<keyof TEvents, number>();

  subscribe(listener: (event: EditorEvent<keyof TEvents & string, TEvents[keyof TEvents]>) => void): () => void;
  subscribe<K extends keyof TEvents>(type: K, listener: (payload: TEvents[K]) => void): () => void;
  subscribe<K extends keyof TEvents>(
    typeOrListener: K | ((event: EditorEvent<keyof TEvents & string, TEvents[keyof TEvents]>) => void),
    maybeListener?: (payload: TEvents[K]) => void,
  ): () => void {
    if (typeof typeOrListener === 'function') {
      const listener = typeOrListener;
      this._listeners.add(listener);
      return () => { this._listeners.delete(listener); };
    }
    if (!maybeListener) return () => {};
    let listeners = this._listenersByType.get(typeOrListener);
    if (!listeners) {
      listeners = new Set();
      this._listenersByType.set(typeOrListener, listeners);
    }
    const listener = maybeListener as (payload: TEvents[keyof TEvents]) => void;
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (listeners!.size === 0) this._listenersByType.delete(typeOrListener);
    };
  }

  emit<K extends keyof TEvents & string>(type: K, payload: TEvents[K]): void {
    const event = Object.freeze({ type, payload }) as EditorEvent<keyof TEvents & string, TEvents[keyof TEvents]>;
    if (this._batchDepth > 0) {
      const previousIndex = this._batchEventIndexes.get(type);
      if (previousIndex === undefined) {
        this._batchEventIndexes.set(type, this._batch.length);
        this._batch.push(event);
      } else {
        this._batch[previousIndex] = event;
      }
      return;
    }
    this._dispatch(event);
  }

  beginBatch(): void { this._batchDepth++; }

  commitBatch(): void {
    if (this._batchDepth === 0) return;
    this._batchDepth--;
    if (this._batchDepth > 0) return;
    const events = this._batch;
    this._batch = [];
    this._batchEventIndexes.clear();
    for (const event of events) this._dispatch(event);
  }

  rollbackBatch(): void {
    if (this._batchDepth === 0) return;
    this._batchDepth--;
    if (this._batchDepth === 0) {
      this._batch = [];
      this._batchEventIndexes.clear();
    }
  }

  get listenerCount(): number {
    let count = this._listeners.size;
    for (const listeners of this._listenersByType.values()) count += listeners.size;
    return count;
  }

  clear(): void {
    this._listeners.clear();
    this._listenersByType.clear();
    this._batch = [];
    this._batchEventIndexes.clear();
    this._batchDepth = 0;
  }

  private _dispatch(event: EditorEvent<keyof TEvents & string, TEvents[keyof TEvents]>): void {
    for (const listener of [...this._listeners]) listener(event);
    const typed = this._listenersByType.get(event.type);
    if (!typed) return;
    for (const listener of [...typed]) listener(event.payload);
  }
}
