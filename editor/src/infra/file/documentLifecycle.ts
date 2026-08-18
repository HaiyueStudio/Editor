import type { SerializedEditorScene } from '../../export/runtimeScene';
import { createDocumentRecoveryRecord, type DocumentRecoveryRecord, type DocumentRecoveryStore } from './documentRecovery';
import {
  canUseSceneSavePicker,
  ensureSceneWritePermission,
  pickSceneJsonSaveHandle,
  type FileSystemFileHandleLike,
} from './recentSceneHandles';
import type { PreparedFileDownload } from '../scene/editorSceneActions';

export interface DocumentRevisionState {
  readonly currentRevision: number;
  readonly savedRevision: number;
  readonly documentName: string | null;
  readonly dirty: boolean;
}

export interface PreparedDocumentSave {
  readonly revision: number;
  readonly documentName: string;
  readonly handle: FileSystemFileHandleLike | null;
  readonly fingerprint: FileFingerprint | null;
  readonly download: PreparedFileDownload | null;
  readonly savedFile: File | null;
  readonly handleChanged: boolean;
}

interface FileFingerprint {
  readonly size: number;
  readonly lastModified: number;
}

export class DocumentFileSession {
  private _handle: FileSystemFileHandleLike | null = null;
  private _fingerprint: FileFingerprint | null = null;

  attachOpenedFile(file: File, handle?: FileSystemFileHandleLike): void {
    this._handle = handle ?? null;
    this._fingerprint = handle ? fingerprint(file) : null;
  }

  detach(): void {
    this._handle = null;
    this._fingerprint = null;
  }

  async prepareSave(
    download: PreparedFileDownload,
    revision: number,
    options: { saveAs?: boolean; confirmOverwrite?: (fileName: string) => boolean } = {},
  ): Promise<PreparedDocumentSave> {
    let handle = options.saveAs ? null : this._handle;
    if (!handle && canUseSceneSavePicker()) handle = await pickSceneJsonSaveHandle(download.fileName);
    if (!handle || !handle.createWritable || !(await ensureSceneWritePermission(handle))) {
      return Object.freeze({
        revision,
        documentName: download.fileName,
        handle: null,
        fingerprint: null,
        download,
        savedFile: null,
        handleChanged: false,
      });
    }

    if (!options.saveAs && handle === this._handle && this._fingerprint) {
      const current = fingerprint(await handle.getFile());
      if (!sameFingerprint(current, this._fingerprint)) {
        const overwrite = options.confirmOverwrite?.(handle.name) ?? false;
        if (!overwrite) throw new DOMException('The scene file changed outside the editor.', 'AbortError');
      }
    }

    const handleChanged = handle !== this._handle;
    const writable = await handle.createWritable();
    try {
      await writable.write(download.blob);
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => {});
      throw error;
    }
    const savedFile = await handle.getFile();
    return Object.freeze({
      revision,
      documentName: handle.name,
      handle,
      fingerprint: fingerprint(savedFile),
      download: null,
      savedFile,
      handleChanged,
    });
  }

  commitSave(prepared: PreparedDocumentSave): void {
    if (prepared.handle) {
      this._handle = prepared.handle;
      this._fingerprint = prepared.fingerprint;
    }
  }
}

export interface DocumentAutoRecoveryOptions {
  readonly store: DocumentRecoveryStore;
  readonly serialize: (signal: AbortSignal) => Promise<SerializedEditorScene>;
  readonly getState: () => DocumentRevisionState;
  readonly debounceMs?: number;
  readonly onError?: (error: unknown) => void;
}

export class DocumentAutoRecovery {
  private readonly _store: DocumentRecoveryStore;
  private readonly _serialize: (signal: AbortSignal) => Promise<SerializedEditorScene>;
  private readonly _getState: () => DocumentRevisionState;
  private readonly _debounceMs: number;
  private readonly _onError: (error: unknown) => void;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _run: AbortController | null = null;
  private _disposed = false;

  constructor(options: DocumentAutoRecoveryOptions) {
    this._store = options.store;
    this._serialize = options.serialize;
    this._getState = options.getState;
    this._debounceMs = options.debounceMs ?? 1500;
    this._onError = options.onError ?? (() => {});
  }

  load(): Promise<DocumentRecoveryRecord | null> { return this._store.load(); }

  changed(): void {
    if (this._disposed) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      void this.flush();
    }, this._debounceMs);
  }

  async flush(): Promise<void> {
    if (this._disposed) return;
    const state = this._getState();
    if (!state.dirty) {
      await this._store.clear();
      return;
    }
    this._run?.abort('document-recovery-superseded');
    const run = new AbortController();
    this._run = run;
    try {
      const scene = await this._serialize(run.signal);
      run.signal.throwIfAborted();
      const after = this._getState();
      if (after.currentRevision !== state.currentRevision) {
        this.changed();
        return;
      }
      await this._store.save(createDocumentRecoveryRecord(scene, state));
    } catch (error) {
      if (!run.signal.aborted) this._onError(error);
    } finally {
      if (this._run === run) this._run = null;
    }
  }

  saved(): void {
    this._run?.abort('document-saved');
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    void this._store.clear().catch(this._onError);
  }

  dispose(): void {
    this._disposed = true;
    this._run?.abort('document-recovery-disposed');
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }
}

function fingerprint(file: File): FileFingerprint {
  return Object.freeze({ size: file.size, lastModified: file.lastModified });
}

function sameFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.size === right.size && left.lastModified === right.lastModified;
}
