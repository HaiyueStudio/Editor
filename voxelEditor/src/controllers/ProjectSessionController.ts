import type { GEDropdown, GEDropdownSelectDetail } from '@haiyue/ui';
import type { CommandHistory } from '../commands';
import type { VoxelDocument, VoxelDocumentChangeDetail } from '../model';
import {
  IndexedDbProjectStore,
  projectFingerprint,
  recentProjectId,
  type ProjectFileFormat,
  type ProjectStore,
  type RecentProject,
  type RecoverySnapshot,
} from '../projectStorage';
import type { ProjectIOController } from './ProjectIOController';
import { translate } from '../localization';

interface ProjectSessionControllerOptions {
  document: VoxelDocument;
  history: CommandHistory;
  io: ProjectIOController;
  notify(message: string, error?: boolean): void;
  resetCamera(): void;
  store?: ProjectStore;
  autosaveDelay?: number;
}

export interface ProjectSessionSnapshot {
  readonly projectName: string;
  readonly dirty: boolean;
}

/** Owns browser saves, project identity, crash recovery, recents, shortcuts, and file drops. */
export class ProjectSessionController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _io: ProjectIOController;
  private readonly _notify: ProjectSessionControllerOptions['notify'];
  private readonly _resetCamera: () => void;
  private readonly _store: ProjectStore;
  private readonly _autosaveDelay: number;
  private readonly _name = element<HTMLElement>('project-name');
  private readonly _unsaved = element<HTMLElement>('project-unsaved');
  private readonly _saveButton = element<HTMLElement>('save-project');
  private readonly _recentMenu = element<GEDropdown>('recent-projects-menu');
  private readonly _recoveryBanner = element<HTMLElement>('recovery-banner');
  private readonly _recoveryMessage = element<HTMLElement>('recovery-message');
  private readonly _dropOverlay = element<HTMLElement>('drop-import-overlay');
  private _projectName = translate('project.untitled');
  private _usesDefaultProjectName = true;
  private _format: ProjectFileFormat = 'json';
  private _savedFingerprint: string;
  private _dirty = false;
  private _autosaveTimer: number | null = null;
  private _recovery: RecoverySnapshot | null = null;
  private _recent = new Map<string, RecentProject>();
  private _dragDepth = 0;
  private _storageErrorReported = false;
  private _restoringSnapshot = false;
  private readonly _listeners = new Set<(snapshot: ProjectSessionSnapshot) => void>();

  constructor(options: ProjectSessionControllerOptions) {
    this._document = options.document;
    this._history = options.history;
    this._io = options.io;
    this._notify = options.notify;
    this._resetCamera = options.resetCamera;
    this._store = options.store ?? new IndexedDbProjectStore();
    this._autosaveDelay = Math.max(0, options.autosaveDelay ?? 900);
    this._savedFingerprint = projectFingerprint(this._document.toJSON());
    this._bind();
    this._renderIdentity();
  }

  get dirty(): boolean { return this._dirty; }
  get projectName(): string { return this._projectName; }

  subscribe(listener: (snapshot: ProjectSessionSnapshot) => void): () => void {
    this._listeners.add(listener);
    listener(Object.freeze({ projectName: this._projectName, dirty: this._dirty }));
    return () => this._listeners.delete(listener);
  }

  save(): Promise<void> { return this._save(); }

  async initialize(): Promise<void> {
    try {
      const [current, recovery, recent] = await Promise.all([
        this._store.loadCurrent(),
        this._store.loadRecovery(),
        this._store.listRecent(),
      ]);
      this._recent = new Map(recent.map(record => [record.id, record]));
      this._syncRecentMenu();
      const startupProject = current ?? (recovery && !recovery.dirty ? recovery : null);
      if (startupProject) {
        this._restoreCurrent(startupProject);
        if (!current) void this._saveCurrent(startupProject.project);
      }
      if (recovery?.dirty && isNewerRecovery(recovery, current)) this._showRecovery(recovery);
    } catch (error) {
      this._reportStorageError(error);
      this._syncRecentMenu();
    }
  }

  projectOpened(name: string, format: ProjectFileFormat): void {
    this._hideRecovery();
    this._projectName = normalizedProjectName(name);
    this._usesDefaultProjectName = false;
    this._format = format;
    const project = this._document.toJSON();
    this._savedFingerprint = projectFingerprint(project);
    this._setDirty(false);
    void this._saveCurrent(project);
    void this._rememberRecent(project);
    void this._saveRecovery(project);
    this._emitSession();
  }

  confirmReplace(): boolean {
    return !this._dirty || window.confirm(translate('project.confirmReplace', { name: this._projectName }));
  }

  syncLocale(): void {
    if (this._usesDefaultProjectName) this._projectName = translate('project.untitled');
    this._renderIdentity();
    this._emitSession();
    this._syncRecentMenu();
    if (this._recovery) this._showRecovery(this._recovery);
  }

  private _bind(): void {
    this._document.addEventListener('change', event => {
      if (this._restoringSnapshot) return;
      const detail = (event as CustomEvent<VoxelDocumentChangeDetail>).detail;
      if (!hasPersistentChange(detail)) return;
      this._setDirty(true);
      this._scheduleAutosave();
    });
    this._saveButton.addEventListener('click', () => void this._save());
    this._recentMenu.addEventListener('item-select', event => void this._openRecent(
      (event as CustomEvent<GEDropdownSelectDetail>).detail.value,
    ));
    element('restore-recovery').addEventListener('click', () => this._restoreRecovery());
    element('discard-recovery').addEventListener('click', () => void this._discardRecovery());
    window.addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (!event.repeat) void this._save();
    });
    window.addEventListener('beforeunload', event => {
      if (!this._dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('dragenter', event => this._onDragEnter(event));
    window.addEventListener('dragover', event => this._onDragOver(event));
    window.addEventListener('dragleave', event => this._onDragLeave(event));
    window.addEventListener('drop', event => void this._onDrop(event));
  }

  private async _save(): Promise<void> {
    if (this._autosaveTimer !== null) {
      window.clearTimeout(this._autosaveTimer);
      this._autosaveTimer = null;
    }
    const project = this._document.toJSON();
    const savedFingerprint = projectFingerprint(project);
    const snapshot = this._snapshot(project, savedFingerprint, false);
    try {
      await this._store.saveCurrent(snapshot);
      this._savedFingerprint = savedFingerprint;
      this._setDirty(projectFingerprint(this._document.toJSON()) !== savedFingerprint);
      this._hideRecovery();
      await Promise.all([
        this._rememberRecent(project),
        this._saveRecovery(),
      ]);
      this._notify(translate('project.savedToBrowser'));
    } catch (error) {
      this._notify(error instanceof Error ? error.message : String(error), true);
    }
  }

  private _scheduleAutosave(): void {
    if (this._recovery) return;
    if (this._autosaveTimer !== null) window.clearTimeout(this._autosaveTimer);
    this._autosaveTimer = window.setTimeout(() => {
      this._autosaveTimer = null;
      void this._saveRecovery();
    }, this._autosaveDelay);
  }

  private async _saveRecovery(project = this._document.toJSON()): Promise<void> {
    const fingerprint = projectFingerprint(project);
    this._setDirty(fingerprint !== this._savedFingerprint);
    try {
      await this._store.saveRecovery(this._snapshot(project, this._savedFingerprint, this._dirty));
      this._storageErrorReported = false;
    } catch (error) {
      this._reportStorageError(error);
    }
  }

  private async _saveCurrent(project: ReturnType<VoxelDocument['toJSON']>): Promise<void> {
    try {
      await this._store.saveCurrent(this._snapshot(project, this._savedFingerprint, false));
      this._storageErrorReported = false;
    } catch (error) {
      this._reportStorageError(error);
    }
  }

  private async _rememberRecent(project: ReturnType<VoxelDocument['toJSON']>): Promise<void> {
    const record: RecentProject = {
      id: recentProjectId(this._projectName, this._format),
      name: this._projectName,
      format: this._format,
      project,
      savedFingerprint: this._savedFingerprint,
      dirty: false,
      updatedAt: Date.now(),
    };
    this._recent.set(record.id, record);
    this._syncRecentMenu();
    try {
      await this._store.saveRecent(record);
      this._storageErrorReported = false;
    } catch (error) {
      this._reportStorageError(error);
    }
  }

  private async _openRecent(id: string): Promise<void> {
    if (id === '__clear__') {
      this._recent.clear();
      this._syncRecentMenu();
      try { await this._store.clearRecent(); }
      catch (error) { this._reportStorageError(error); }
      return;
    }
    const record = this._recent.get(id);
    if (!record || !this.confirmReplace()) return;
    this._io.openProjectSnapshot(record.project, record.name, record.format, '打开最近工程');
  }

  private _showRecovery(snapshot: RecoverySnapshot): void {
    this._recovery = snapshot;
    const time = new Date(snapshot.updatedAt).toLocaleString();
    this._recoveryMessage.textContent = translate('project.recoveryMessage', { name: snapshot.name, time });
    this._recoveryBanner.classList.add('visible');
  }

  private _restoreCurrent(snapshot: RecoverySnapshot): void {
    this._restoringSnapshot = true;
    try {
      this._document.load(snapshot.project);
    } finally {
      this._restoringSnapshot = false;
    }
    this._history.clear();
    this._projectName = normalizedProjectName(snapshot.name);
    this._usesDefaultProjectName = false;
    this._format = snapshot.format;
    this._savedFingerprint = projectFingerprint(snapshot.project);
    this._io.setProjectName(this._projectName);
    this._setDirty(false);
    this._resetCamera();
    this._renderIdentity();
    this._emitSession();
  }

  private _restoreRecovery(): void {
    const snapshot = this._recovery;
    if (!snapshot) return;
    try {
      this._document.load(snapshot.project);
      this._history.clear();
      this._projectName = snapshot.name;
      this._usesDefaultProjectName = false;
      this._format = snapshot.format;
      this._savedFingerprint = snapshot.savedFingerprint;
      this._setDirty(projectFingerprint(this._document.toJSON()) !== this._savedFingerprint);
      this._resetCamera();
      this._hideRecovery();
      this._notify(`已恢复“${snapshot.name}”的自动保存快照。`);
      this._scheduleAutosave();
      this._emitSession();
    } catch (error) {
      this._notify(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async _discardRecovery(): Promise<void> {
    this._hideRecovery();
    try { await this._store.clearRecovery(); }
    catch (error) { this._reportStorageError(error); }
    if (this._dirty) this._scheduleAutosave();
  }

  private _hideRecovery(): void {
    this._recovery = null;
    this._recoveryBanner.classList.remove('visible');
  }

  private _syncRecentMenu(): void {
    const recent = [...this._recent.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    this._recentMenu.items = recent.length === 0
      ? [{ label: translate('project.recentEmpty'), value: '' }]
      : [
          ...recent.map(record => ({ label: `${record.name} · ${record.format.toUpperCase()}`, value: record.id })),
          { separator: true },
          { label: translate('project.recentClear'), value: '__clear__' },
        ];
  }

  private _setDirty(dirty: boolean): void {
    if (dirty === this._dirty) return;
    this._dirty = dirty;
    this._renderIdentity();
    this._emitSession();
  }

  private _emitSession(): void {
    const snapshot = Object.freeze({ projectName: this._projectName, dirty: this._dirty });
    for (const listener of [...this._listeners]) listener(snapshot);
  }

  private _renderIdentity(): void {
    this._name.textContent = this._projectName;
    this._unsaved.hidden = !this._dirty;
    const suffix = this._dirty ? ' *' : '';
    document.title = `${this._projectName}${suffix} — ${translate('app.title')}`;
    this._saveButton.title = `${translate('app.saveShortcut')}${this._dirty ? translate('app.unsavedSuffix') : ''}`;
  }

  private _snapshot(
    project: ReturnType<VoxelDocument['toJSON']>,
    savedFingerprint: string,
    dirty: boolean,
  ): RecoverySnapshot {
    return {
      name: this._projectName,
      format: this._format,
      project,
      savedFingerprint,
      dirty,
      updatedAt: Date.now(),
    };
  }

  private _onDragEnter(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    this._dragDepth += 1;
    this._dropOverlay.classList.add('visible');
  }

  private _onDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  private _onDragLeave(event: DragEvent): void {
    if (!hasFiles(event)) return;
    this._dragDepth = Math.max(0, this._dragDepth - 1);
    if (this._dragDepth === 0) this._dropOverlay.classList.remove('visible');
  }

  private async _onDrop(event: DragEvent): Promise<void> {
    if (!hasFiles(event)) return;
    event.preventDefault();
    this._dragDepth = 0;
    this._dropOverlay.classList.remove('visible');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    await this._io.importDroppedFiles(files);
  }

  private _reportStorageError(error: unknown): void {
    if (this._storageErrorReported) return;
    this._storageErrorReported = true;
    this._notify(`自动保存不可用：${error instanceof Error ? error.message : String(error)}`, true);
  }
}

function hasPersistentChange(detail: VoxelDocumentChangeDetail): boolean {
  return detail.reason !== 'color'
    && detail.reason !== 'edit-target'
    && detail.reason !== 'animation-select'
    && detail.reason !== 'animation-frame';
}

function normalizedProjectName(name: string): string {
  return name.replace(/\.(json|vox)$/i, '').trim() || translate('project.untitled');
}

function isNewerRecovery(recovery: RecoverySnapshot, current: RecoverySnapshot | null): boolean {
  if (!current) return true;
  return recovery.updatedAt > current.updatedAt
    && projectFingerprint(recovery.project) !== projectFingerprint(current.project);
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function element<T extends Element = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as unknown as T;
}
