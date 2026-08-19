import type {
  EditorDisposable,
  EditorSelectionReference,
  EditorSelectionSnapshot,
} from '@haiyue/editor-plugin-sdk';

export type EditorSelectionResolver<T = unknown> = (reference: EditorSelectionReference) => T | undefined;

interface ResolverRegistration {
  readonly ownerId: string;
  readonly resolve: EditorSelectionResolver;
}

export class EditorSelectionService implements EditorDisposable {
  private readonly resolvers = new Map<string, ResolverRegistration>();
  private readonly listeners = new Set<(snapshot: EditorSelectionSnapshot) => void>();
  private items: readonly EditorSelectionReference[] = Object.freeze([]);
  private active: EditorSelectionReference | null = null;
  private revision = 0;
  private disposed = false;

  set(items: readonly EditorSelectionReference[], active: EditorSelectionReference | null = items[0] ?? null): void {
    this.assertActive();
    const normalized = dedupe(items.map(freezeReference));
    const normalizedActive = active ? freezeReference(active) : null;
    if (normalizedActive && !normalized.some(item => referenceKey(item) === referenceKey(normalizedActive))) {
      throw new Error('Active selection must be present in the selection set.');
    }
    this.items = Object.freeze(normalized);
    this.active = normalizedActive;
    this.emit();
  }

  clear(): void { this.set([], null); }

  registerResolver<T>(kind: string, ownerId: string, resolver: EditorSelectionResolver<T>): EditorDisposable {
    this.assertActive();
    if (this.resolvers.has(kind)) throw new Error(`Selection resolver ${kind} is already registered.`);
    this.resolvers.set(kind, { ownerId, resolve: resolver as EditorSelectionResolver });
    return disposable(() => {
      const current = this.resolvers.get(kind);
      if (current?.ownerId === ownerId) this.resolvers.delete(kind);
    });
  }

  resolve<T = unknown>(reference: EditorSelectionReference): T | undefined {
    return this.resolvers.get(reference.kind)?.resolve(reference) as T | undefined;
  }

  snapshot(): EditorSelectionSnapshot {
    return Object.freeze({ revision: this.revision, active: this.active, items: this.items });
  }

  subscribe(listener: (snapshot: EditorSelectionSnapshot) => void, emitInitial = false): EditorDisposable {
    this.assertActive();
    this.listeners.add(listener);
    if (emitInitial) listener(this.snapshot());
    return disposable(() => this.listeners.delete(listener));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resolvers.clear();
    this.listeners.clear();
    this.items = Object.freeze([]);
    this.active = null;
  }

  private emit(): void {
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private assertActive(): void { if (this.disposed) throw new Error('Selection service is disposed.'); }
}

function freezeReference(reference: EditorSelectionReference): EditorSelectionReference {
  if (!reference.kind.trim() || !reference.id.trim()) throw new TypeError('Selection kind and id are required.');
  return Object.freeze({ kind: reference.kind, id: reference.id, ...(reference.documentId ? { documentId: reference.documentId } : {}) });
}

function dedupe(items: readonly EditorSelectionReference[]): EditorSelectionReference[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = referenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function referenceKey(reference: EditorSelectionReference): string {
  return `${reference.documentId ?? ''}\u0000${reference.kind}\u0000${reference.id}`;
}

function disposable(dispose: () => void): EditorDisposable {
  let active = true;
  return Object.freeze({ dispose() { if (active) { active = false; dispose(); } } });
}
