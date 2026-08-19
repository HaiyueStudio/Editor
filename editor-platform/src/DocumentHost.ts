import type {
  EditorDisposable,
  EditorDocumentAdapter,
  EditorDocumentSnapshot,
} from '@haiyue/editor-plugin-sdk';

interface HostedDocument {
  readonly adapter: EditorDocumentAdapter;
  readonly subscription: EditorDisposable;
  closed: boolean;
}

export interface EditorDocumentHostSnapshot {
  readonly revision: number;
  readonly activeId: string | null;
  readonly documents: readonly EditorDocumentSnapshot[];
}

export class EditorDocumentHost implements EditorDisposable {
  private readonly documents = new Map<string, HostedDocument>();
  private readonly listeners = new Set<(snapshot: EditorDocumentHostSnapshot) => void>();
  private activeId: string | null = null;
  private revision = 0;
  private disposed = false;

  attach(adapter: EditorDocumentAdapter, activate = true): EditorDisposable {
    this.assertActive();
    const id = adapter.identity.id.trim();
    if (!id) throw new TypeError('Document identity id is required.');
    if (this.documents.has(id)) throw new Error(`Document ${id} is already attached.`);
    const hosted: HostedDocument = {
      adapter,
      subscription: adapter.subscribe(() => this.emit()),
      closed: false,
    };
    this.documents.set(id, hosted);
    if (activate || this.activeId === null) this.activeId = id;
    this.emit();
    return disposable(() => { void this.close(id); });
  }

  activate(id: string): void {
    this.assertActive();
    if (!this.documents.has(id)) throw new Error(`Cannot activate unknown document ${id}.`);
    if (this.activeId === id) return;
    this.activeId = id;
    this.emit();
  }

  active(): EditorDocumentAdapter | null {
    return this.activeId ? this.documents.get(this.activeId)?.adapter ?? null : null;
  }

  get(id: string): EditorDocumentAdapter | undefined { return this.documents.get(id)?.adapter; }

  async close(id: string): Promise<void> {
    const hosted = this.documents.get(id);
    if (!hosted || hosted.closed) return;
    hosted.closed = true;
    hosted.subscription.dispose();
    this.documents.delete(id);
    if (this.activeId === id) this.activeId = this.documents.keys().next().value ?? null;
    try { await hosted.adapter.dispose(); }
    finally { this.emit(); }
  }

  snapshot(): EditorDocumentHostSnapshot {
    return Object.freeze({
      revision: this.revision,
      activeId: this.activeId,
      documents: Object.freeze([...this.documents.values()].map(hosted => freezeDocumentSnapshot(
        hosted.adapter,
        hosted.adapter.identity.id === this.activeId,
        hosted.closed,
      ))),
    });
  }

  subscribe(listener: (snapshot: EditorDocumentHostSnapshot) => void, emitInitial = false): EditorDisposable {
    this.assertActive();
    this.listeners.add(listener);
    if (emitInitial) listener(this.snapshot());
    return disposable(() => { this.listeners.delete(listener); });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([...this.documents.keys()].map(id => this.close(id)));
    this.listeners.clear();
  }

  private emit(): void {
    if (this.disposed) return;
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private assertActive(): void { if (this.disposed) throw new Error('Document host is disposed.'); }
}

function freezeDocumentSnapshot(adapter: EditorDocumentAdapter, active: boolean, closed: boolean): EditorDocumentSnapshot {
  const revision = Math.max(0, Math.floor(adapter.revision));
  const savedRevision = Math.max(0, Math.floor(adapter.savedRevision));
  return Object.freeze({
    identity: Object.freeze({ ...adapter.identity }),
    revision,
    savedRevision,
    dirty: revision !== savedRevision,
    active,
    closed,
  });
}

function disposable(dispose: () => void | Promise<void>): EditorDisposable {
  let active = true;
  return Object.freeze({ dispose() { if (!active) return; active = false; return dispose(); } });
}
