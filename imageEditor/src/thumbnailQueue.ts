interface Consumer<T> {
  resolve(value: T): void;
  reject(reason: unknown): void;
  detach(): void;
}
interface Job<K, V> {
  key: K;
  controller: AbortController;
  consumers: Set<Consumer<V>>;
}

/** One bounded computation at a time; a shared request lives only while it has consumers. */
export class ThumbnailQueue<K extends object, V> {
  private completed = new WeakMap<K, V>();
  private pending = new WeakMap<K, Job<K, V>>();
  private queue: Job<K, V>[] = [];
  private running = false;

  constructor(private compute: (key: K, signal: AbortSignal) => Promise<V>) {}

  read(key: K, signal?: AbortSignal): Promise<V> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const cached = this.completed.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    let job = this.pending.get(key);
    if (!job) {
      job = { key, controller: new AbortController(), consumers: new Set() };
      this.pending.set(key, job);
      this.queue.push(job);
    }
    const current = job;
    return new Promise<V>((resolve, reject) => {
      const abort = () => {
        consumer.detach();
        current.consumers.delete(consumer);
        reject(signal!.reason);
        if (!current.consumers.size) {
          current.controller.abort();
          if (this.pending.get(key) === current) this.pending.delete(key);
          const index = this.queue.indexOf(current);
          if (index >= 0) this.queue.splice(index, 1);
        }
      };
      const consumer = { resolve, reject, detach: () => signal?.removeEventListener('abort', abort) };
      current.consumers.add(consumer);
      signal?.addEventListener('abort', abort, { once: true });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = true;
    try {
      const value = await this.compute(job.key, job.controller.signal);
      job.controller.signal.throwIfAborted();
      this.completed.set(job.key, value);
      for (const consumer of job.consumers) consumer.resolve(value);
    } catch (error) {
      for (const consumer of job.consumers) consumer.reject(error);
    } finally {
      for (const consumer of job.consumers) consumer.detach();
      job.consumers.clear();
      if (this.pending.get(job.key) === job) this.pending.delete(job.key);
      this.running = false;
      void this.drain();
    }
  }
}
