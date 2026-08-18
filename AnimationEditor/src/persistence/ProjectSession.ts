import { AnimationEditorStore, type AnimationEditorStoreChange } from '../domain/AnimationEditorStore';
import { animationEditorProjectFingerprint, type AnimationEditorProject } from '../domain/AnimationEditorProject';
import { projectFileName } from './ProjectCodec';
import {
  IndexedDbAnimationEditorProjectPersistence,
  recentProjectId,
  type AnimationEditorProjectPersistence,
  type ProjectSnapshot,
  type RecentProject,
} from './ProjectStorage';

export interface ProjectSessionStartup {
  readonly restoredCurrent: boolean;
  readonly recovery: ProjectSnapshot | null;
  readonly recent: readonly RecentProject[];
}

export interface ProjectSessionOptions {
  readonly persistence?: AnimationEditorProjectPersistence;
  readonly autosaveDelay?: number;
  readonly now?: () => number;
  readonly onStorageError?: (error: unknown) => void;
}

export class AnimationEditorProjectSession {
  private readonly _persistence: AnimationEditorProjectPersistence;
  private readonly _autosaveDelay: number;
  private readonly _now: () => number;
  private readonly _onStorageError: (error: unknown) => void;
  private readonly _unsubscribe: () => void;
  private _autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _fileName: string;
  private _recent: RecentProject[] = [];
  private _activatingSnapshot = false;

  constructor(readonly store: AnimationEditorStore, options: ProjectSessionOptions = {}) {
    this._persistence = options.persistence ?? new IndexedDbAnimationEditorProjectPersistence();
    this._autosaveDelay = Math.max(0, options.autosaveDelay ?? 900);
    this._now = options.now ?? Date.now;
    this._onStorageError = options.onStorageError ?? (() => {});
    this._fileName = projectFileName(store.project.name);
    this._unsubscribe = store.subscribe(change => this._onStoreChange(change));
  }

  get fileName(): string { return this._fileName; }
  get recent(): readonly RecentProject[] { return this._recent; }

  async initialize(): Promise<ProjectSessionStartup> {
    try {
      const [current, recovery, recent] = await Promise.all([
        this._persistence.loadCurrent(),
        this._persistence.loadRecovery(),
        this._persistence.listRecent(),
      ]);
      this._recent = [...recent];
      if (current) this._activateSnapshot(current, 'restore-current', true);
      return {
        restoredCurrent: current !== null,
        recovery: recovery?.dirty && isNewerRecovery(recovery, current) ? recovery : null,
        recent: this._recent,
      };
    } catch (error) {
      this._onStorageError(error);
      return { restoredCurrent: false, recovery: null, recent: [] };
    }
  }

  async activateSavedProject(
    project: AnimationEditorProject,
    fileName: string,
    reason: string,
    rememberRecent = true,
  ): Promise<void> {
    this._cancelAutosave();
    this._fileName = projectFileName(fileName);
    this.store.replaceProject(project, { reason, markSaved: true });
    await this._persistSaved(rememberRecent);
  }

  async save(): Promise<void> {
    this._cancelAutosave();
    this.store.markSaved('save-project');
    await this._persistSaved(true);
  }

  async saveAs(fileName: string): Promise<void> {
    this._fileName = projectFileName(fileName);
    await this.save();
  }

  async restoreRecovery(snapshot: ProjectSnapshot): Promise<void> {
    this._cancelAutosave();
    this._activateSnapshot(snapshot, 'restore-recovery', false);
    await this._persistence.clearRecovery();
    if (this.store.isDirty) this._scheduleAutosave();
  }

  async discardRecovery(): Promise<void> {
    await this._persistence.clearRecovery();
  }

  async openRecent(id: string): Promise<RecentProject | null> {
    const project = this._recent.find(record => record.id === id) ?? null;
    if (!project) return null;
    await this.activateSavedProject(project.project, project.fileName, 'open-recent-project');
    return project;
  }

  async clearRecent(): Promise<void> {
    this._recent = [];
    await this._persistence.clearRecent();
  }

  async flushAutosave(): Promise<void> {
    this._cancelAutosave();
    if (!this.store.isDirty) {
      await this._persistence.clearRecovery();
      return;
    }
    try {
      await this._persistence.saveRecovery(this._snapshot(true));
    } catch (error) {
      this._onStorageError(error);
    }
  }

  dispose(): void {
    this._cancelAutosave();
    this._unsubscribe();
  }

  private _onStoreChange(change: AnimationEditorStoreChange): void {
    if (this._activatingSnapshot) return;
    if (!change.contentChanged && !change.dirtyChanged) return;
    if (change.isDirty) this._scheduleAutosave();
    else {
      this._cancelAutosave();
      void this._persistence.clearRecovery().catch(this._onStorageError);
    }
  }

  private _scheduleAutosave(): void {
    this._cancelAutosave();
    this._autosaveTimer = setTimeout(() => {
      this._autosaveTimer = null;
      void this.flushAutosave();
    }, this._autosaveDelay);
  }

  private _cancelAutosave(): void {
    if (this._autosaveTimer === null) return;
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = null;
  }

  private async _persistSaved(rememberRecent: boolean): Promise<void> {
    const snapshot = this._snapshot(false);
    try {
      await this._persistence.saveCurrent(snapshot);
      await this._persistence.clearRecovery();
      if (rememberRecent) {
        const recent: RecentProject = { ...snapshot, id: recentProjectId(snapshot.project) };
        await this._persistence.saveRecent(recent);
        this._recent = [...await this._persistence.listRecent()];
      }
    } catch (error) {
      this._onStorageError(error);
    }
  }

  private _activateSnapshot(snapshot: ProjectSnapshot, reason: string, markSaved: boolean): void {
    this._fileName = snapshot.fileName;
    this._activatingSnapshot = true;
    try {
      this.store.replaceProject(snapshot.project, markSaved
        ? { reason, markSaved: true }
        : { reason, savedFingerprint: snapshot.savedFingerprint });
    } finally {
      this._activatingSnapshot = false;
    }
  }

  private _snapshot(dirty: boolean): ProjectSnapshot {
    return {
      name: this.store.project.name,
      fileName: this._fileName,
      project: this.store.project,
      savedFingerprint: dirty ? this.store.savedFingerprint : animationEditorProjectFingerprint(this.store.project),
      dirty,
      updatedAt: this._now(),
    };
  }
}

function isNewerRecovery(recovery: ProjectSnapshot, current: ProjectSnapshot | null): boolean {
  if (!current) return true;
  return recovery.updatedAt > current.updatedAt
    && animationEditorProjectFingerprint(recovery.project) !== animationEditorProjectFingerprint(current.project);
}
