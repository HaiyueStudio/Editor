import { RecoveryCodec, decodeRecovery, type BinarySession, type StoredSession } from './recoveryCodec.js';
export interface LegacySession { version: 1; activeId: string | null; documents: { project: string; dirty: boolean }[] }
export type RecoverySession = LegacySession | BinarySession;
export interface RecoveryStore { load(): Promise<unknown>; save(session: RecoverySession): Promise<void>; close(): void }

export class IndexedDbRecovery implements RecoveryStore {
  private connection: Promise<IDBDatabase> | undefined;
  private closed = false;
  private codec = new RecoveryCodec();
  private keys = new Set<string>();
  private db() {
    if (this.closed) throw new Error('恢复存储已关闭。');
    return this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('haiyue.image-editor.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recovery');
      request.onerror = () => { this.connection = undefined; reject(request.error ?? new Error('无法打开本地恢复存储。')); };
      request.onblocked = () => reject(new Error('本地存储被其他窗口占用，请关闭旧窗口后重试。'));
      request.onsuccess = () => {
        const db = request.result;
        if (this.closed) { db.close(); reject(new Error('恢复存储已关闭。')); return; }
        db.onversionchange = () => { db.close(); this.connection = undefined; }; resolve(db);
      };
    });
  }
  async load(): Promise<unknown> {
    const db = await this.db();
    const entries = await new Promise<Map<string, unknown>>((resolve, reject) => {
      const tx = db.transaction('recovery', 'readonly'), store = tx.objectStore('recovery'), entries = new Map<string, unknown>();
      const cursor = store.openCursor(); cursor.onsuccess = () => { const row = cursor.result; if (row) { entries.set(String(row.key), row.value); row.continue(); } };
      tx.oncomplete = () => resolve(entries);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('无法读取恢复副本。'));
    });
    this.keys = new Set([...entries.keys()].filter(key => key.startsWith('chunk:')));
    const value = entries.get('session');
    return [3,4].includes((value as StoredSession)?.version) ? decodeRecovery(value as StoredSession, entries) : value;
  }
  async save(session: RecoverySession): Promise<void> {
    const db = await this.db();
    const encoded = session.version === 2 ? await this.codec.encode(session, this.keys) : { session, chunks: new Map<string, Uint8Array>(), used: new Set<string>() };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recovery', 'readwrite'), store = tx.objectStore('recovery');
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('恢复副本保存失败，可能没有足够空间。'));
      try {
        store.put(encoded.session, 'session');
        for (const [key, data] of encoded.chunks) store.put(data, key);
        // Manifest, new chunks and stale-chunk removal commit atomically.
        for (const key of this.keys) if (!encoded.used.has(key)) store.delete(key);
      } catch (error) { tx.abort(); reject(error); }
    });
    this.keys = encoded.used;
  }
  close() { this.closed = true; void this.connection?.then(db => db.close()).catch(() => {}); }
}

// Keep at most one in-flight snapshot and one latest pending snapshot.
export class RecoveryQueue {
  private running: Promise<void> | undefined;
  private pending: { session: RecoverySession; waiters: { resolve(): void; reject(error: unknown): void }[] } | undefined;
  private closed = false;
  constructor(private readonly store: RecoveryStore) {}
  write(session: RecoverySession): Promise<void> {
    if (this.closed) return Promise.reject(new Error('恢复队列已关闭。'));
    const result = new Promise<void>((resolve, reject) => {
      if (this.pending) { this.pending.session = session; this.pending.waiters.push({ resolve, reject }); }
      else this.pending = { session, waiters: [{ resolve, reject }] };
    });
    if (!this.running) this.running = this.drain();
    return result;
  }
  private async drain() {
    while (this.pending) {
      const entry = this.pending; this.pending = undefined;
      try { await Promise.resolve().then(() => this.store.save(entry.session)); for (const waiter of entry.waiters) waiter.resolve(); }
      catch (error) { for (const waiter of entry.waiters) waiter.reject(error); }
    }
    this.running = undefined;
  }
  async dispose() { this.closed = true; await this.running; this.store.close(); }
}
