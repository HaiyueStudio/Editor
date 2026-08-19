import type { EditorDisposable } from '@haiyue/editor-plugin-sdk';

export interface EditorProjectSessionSnapshot {
  readonly revision: number;
  readonly projectId: string | null;
  readonly name: string;
  readonly documentRevision: number;
  readonly savedRevision: number;
  readonly dirty: boolean;
  readonly recentProjectIds: readonly string[];
}

export interface EditorProjectSessionPersistence {
  load(): Partial<EditorProjectSessionSnapshot> | null | Promise<Partial<EditorProjectSessionSnapshot> | null>;
  save(snapshot: EditorProjectSessionSnapshot): void | Promise<void>;
}

export class EditorProjectSessionState implements EditorDisposable {
  private readonly listeners = new Set<(snapshot: EditorProjectSessionSnapshot) => void>();
  private revision = 0;
  private projectId: string | null = null;
  private name = 'Untitled';
  private documentRevision = 0;
  private savedRevision = 0;
  private recentProjectIds: readonly string[] = Object.freeze([]);
  private disposed = false;

  constructor(private readonly persistence?: EditorProjectSessionPersistence) {}

  async restore(): Promise<void> {
    this.assertActive();
    const snapshot = await this.persistence?.load();
    if (!snapshot) return;
    this.projectId = snapshot.projectId ?? null;
    this.name = snapshot.name?.trim() || 'Untitled';
    this.documentRevision = Math.max(0, snapshot.documentRevision ?? 0);
    this.savedRevision = Math.min(this.documentRevision, Math.max(0, snapshot.savedRevision ?? 0));
    this.recentProjectIds = Object.freeze([...(snapshot.recentProjectIds ?? [])]);
    this.emit();
  }

  open(projectId: string, name: string, revision = 0): void {
    this.assertActive();
    this.projectId = projectId;
    this.name = name.trim() || 'Untitled';
    this.documentRevision = Math.max(0, revision);
    this.savedRevision = this.documentRevision;
    this.recentProjectIds = Object.freeze([projectId, ...this.recentProjectIds.filter(id => id !== projectId)].slice(0, 20));
    this.emitAndPersist();
  }

  updateDocumentRevision(revision: number): void {
    this.assertActive();
    const normalized = Math.max(0, Math.floor(revision));
    if (normalized === this.documentRevision) return;
    this.documentRevision = normalized;
    this.emitAndPersist();
  }

  markSaved(revision = this.documentRevision): void {
    this.assertActive();
    this.savedRevision = Math.max(0, Math.min(this.documentRevision, Math.floor(revision)));
    this.emitAndPersist();
  }

  snapshot(): EditorProjectSessionSnapshot {
    return Object.freeze({
      revision: this.revision,
      projectId: this.projectId,
      name: this.name,
      documentRevision: this.documentRevision,
      savedRevision: this.savedRevision,
      dirty: this.documentRevision !== this.savedRevision,
      recentProjectIds: this.recentProjectIds,
    });
  }

  subscribe(listener: (snapshot: EditorProjectSessionSnapshot) => void, emitInitial = false): EditorDisposable {
    this.assertActive();
    this.listeners.add(listener);
    if (emitInitial) listener(this.snapshot());
    return disposable(() => this.listeners.delete(listener));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }

  private emitAndPersist(): void {
    this.emit();
    void this.persistence?.save(this.snapshot());
  }

  private emit(): void {
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private assertActive(): void { if (this.disposed) throw new Error('Project session is disposed.'); }
}

function disposable(dispose: () => void): EditorDisposable {
  let active = true;
  return Object.freeze({ dispose() { if (active) { active = false; dispose(); } } });
}
