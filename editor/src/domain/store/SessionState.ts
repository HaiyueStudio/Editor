import { EngineError, EngineErrorCode } from '@haiyue/engine';
import { ErrorDomain, ErrorRecovery } from '@haiyue/engine/core';

export interface EditorLayoutSession {
  resourceTab: string;
  inspectorTab: string;
  workspaceRatio: number | null;
  leftStackRatio: number | null;
  centerRatio: number | null;
  viewportStackRatio: number | null;
}

export interface EditorPlayDeviceSession {
  deviceId: string;
  width: number | null;
  height: number | null;
  dpr: number;
  zoom: number;
}

export interface EditorRecentFileSession {
  name: string;
  path?: string;
  handleId?: string;
  openedAt: number;
}

export interface EditorSessionState {
  layout: EditorLayoutSession;
  recentFiles: EditorRecentFileSession[];
  playDevice: EditorPlayDeviceSession;
}

export type SerializedEditorSessionState = EditorSessionState;

export interface SerializedEditorSessionEnvelope {
  format: 'haiyue-editor-session';
  version: 1;
  data: SerializedEditorSessionState;
}

export interface EditorSessionPersistence {
  load(): string | null;
  save(value: string): void;
}

export interface SessionStateSnapshot {
  readonly layout: Readonly<EditorLayoutSession>;
  readonly recentFiles: readonly Readonly<EditorRecentFileSession>[];
  readonly playDevice: Readonly<EditorPlayDeviceSession>;
}

const MAX_RECENT_FILES = 20;
const DEFAULT_SESSION_STATE: EditorSessionState = {
  layout: {
    resourceTab: '', inspectorTab: '', workspaceRatio: null, leftStackRatio: null,
    centerRatio: null, viewportStackRatio: null,
  },
  recentFiles: [],
  playDevice: { deviceId: 'pc', width: null, height: null, dpr: 1, zoom: 1 },
};

export class SessionState {
  private _state: EditorSessionState;

  constructor(options: {
    initial?: Partial<EditorSessionState>;
    persistence?: EditorSessionPersistence | null;
    changed: (snapshot: SessionStateSnapshot) => void;
  }) {
    this._persistence = options.persistence ?? null;
    this._changed = options.changed;
    this._state = normalizeSessionState(options.initial ?? this._readPersisted());
  }

  private readonly _persistence: EditorSessionPersistence | null;
  private readonly _changed: (snapshot: SessionStateSnapshot) => void;

  snapshot(): SessionStateSnapshot {
    return Object.freeze({
      layout: Object.freeze({ ...this._state.layout }),
      recentFiles: Object.freeze(this._state.recentFiles.map(item => Object.freeze({ ...item }))),
      playDevice: Object.freeze({ ...this._state.playDevice }),
    });
  }

  replace(session: Partial<EditorSessionState>): void {
    this._state = normalizeSessionState({
      layout: session.layout ?? this._state.layout,
      recentFiles: session.recentFiles ?? this._state.recentFiles,
      playDevice: session.playDevice ?? this._state.playDevice,
    });
    this._commit();
  }

  setLayout(layout: Partial<EditorLayoutSession>): void {
    this._state.layout = normalizeLayoutSession({ ...this._state.layout, ...layout });
    this._commit();
  }

  setPlayDevice(playDevice: Partial<EditorPlayDeviceSession>): void {
    this._state.playDevice = normalizePlayDeviceSession({ ...this._state.playDevice, ...playDevice });
    this._commit();
  }

  addRecentFile(file: { name: string; path?: string; handleId?: string; openedAt?: number }): void {
    const name = normalizeString(file.name, '').trim();
    if (!name) return;
    const key = file.handleId ?? file.path ?? name;
    const next: EditorRecentFileSession = {
      name,
      openedAt: normalizeNumber(file.openedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    };
    if (file.path) next.path = file.path;
    if (file.handleId) next.handleId = file.handleId;
    const index = this._state.recentFiles.findIndex(item => (item.handleId ?? item.path ?? item.name) === key);
    if (index >= 0) this._state.recentFiles.splice(index, 1);
    this._state.recentFiles.unshift(next);
    this._state.recentFiles.length = Math.min(this._state.recentFiles.length, MAX_RECENT_FILES);
    this._commit();
  }

  clearRecentFiles(): void {
    if (this._state.recentFiles.length === 0) return;
    this._state.recentFiles = [];
    this._commit();
  }

  removeRecentFile(key: string): boolean {
    const index = this._state.recentFiles.findIndex(item => (item.handleId ?? item.path ?? item.name) === key);
    if (index < 0) return false;
    this._state.recentFiles.splice(index, 1);
    this._commit();
    return true;
  }

  restore(snapshot: SessionStateSnapshot): void {
    this._state = normalizeSessionState({
      layout: { ...snapshot.layout },
      recentFiles: snapshot.recentFiles.map(item => ({ ...item })),
      playDevice: { ...snapshot.playDevice },
    });
    this._persist(this.snapshot());
  }

  private _commit(): void {
    const snapshot = this.snapshot();
    this._persist(snapshot);
    this._changed(snapshot);
  }

  private _persist(snapshot: SessionStateSnapshot): void {
    if (this._persistence) {
      try {
        const envelope: SerializedEditorSessionEnvelope = {
          format: 'haiyue-editor-session', version: 1,
          data: {
            layout: { ...snapshot.layout },
            recentFiles: snapshot.recentFiles.map(item => ({ ...item })),
            playDevice: { ...snapshot.playDevice },
          },
        };
        this._persistence.save(JSON.stringify(envelope));
      } catch { /* Persistence is best-effort. */ }
    }
  }

  private _readPersisted(): Partial<EditorSessionState> | undefined {
    if (!this._persistence) return undefined;
    try {
      const value = this._persistence.load();
      return value ? parseEditorSessionState(value) : undefined;
    } catch {
      return undefined;
    }
  }
}

export function parseEditorSessionState(raw: string): Partial<EditorSessionState> {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; }
  catch (error) { throw sessionDataError('Editor session is not valid JSON.', 'session', error); }
  if (!isRecord(value)) throw sessionDataError('Editor session root must be an object.', 'session');
  if (value.format !== 'haiyue-editor-session') throw sessionDataError('Editor session format is invalid.', 'session.format');
  if (value.version !== 1) throw sessionDataError('Editor session version is unsupported.', 'session.version');
  if (!isRecord(value.data)) throw sessionDataError('Editor session data must be an object.', 'session.data');
  validateSessionSection(value.data, 'layout');
  validateSessionSection(value.data, 'playDevice');
  if (value.data.recentFiles !== undefined) {
    if (!Array.isArray(value.data.recentFiles)) throw sessionDataError('Editor recent files must be an array.', 'session.data.recentFiles');
    for (const [index, item] of value.data.recentFiles.entries()) {
      if (!isRecord(item)) throw sessionDataError('Editor recent file must be an object.', `session.data.recentFiles[${index}]`);
      if (typeof item.name !== 'string') throw sessionDataError('Editor recent file name must be a string.', `session.data.recentFiles[${index}].name`);
      if (typeof item.openedAt !== 'number') throw sessionDataError('Editor recent file openedAt must be a number.', `session.data.recentFiles[${index}].openedAt`);
    }
  }
  return value.data as unknown as Partial<EditorSessionState>;
}

function normalizeSessionState(value?: Partial<EditorSessionState>): EditorSessionState {
  return {
    layout: normalizeLayoutSession(value?.layout),
    recentFiles: normalizeRecentFiles(value?.recentFiles),
    playDevice: normalizePlayDeviceSession(value?.playDevice),
  };
}

function normalizeLayoutSession(value?: Partial<EditorLayoutSession>): EditorLayoutSession {
  return {
    resourceTab: normalizeString(value?.resourceTab, DEFAULT_SESSION_STATE.layout.resourceTab),
    inspectorTab: normalizeString(value?.inspectorTab, DEFAULT_SESSION_STATE.layout.inspectorTab),
    workspaceRatio: normalizeNullableNumber(value?.workspaceRatio, null, 0.05, 0.95),
    leftStackRatio: normalizeNullableNumber(value?.leftStackRatio, null, 0.05, 0.95),
    centerRatio: normalizeNullableNumber(value?.centerRatio, null, 0.05, 0.95),
    viewportStackRatio: normalizeNullableNumber(value?.viewportStackRatio, null, 0.05, 0.95),
  };
}

function normalizePlayDeviceSession(value?: Partial<EditorPlayDeviceSession>): EditorPlayDeviceSession {
  return {
    deviceId: normalizeString(value?.deviceId, 'pc'),
    width: normalizeNullableNumber(value?.width, null, 1, 10000),
    height: normalizeNullableNumber(value?.height, null, 1, 10000),
    dpr: normalizeNumber(value?.dpr, 1, 0.5, 4),
    zoom: normalizeNumber(value?.zoom, 1, 0.25, 2),
  };
}

function normalizeRecentFiles(value?: readonly EditorRecentFileSession[]): EditorRecentFileSession[] {
  if (!Array.isArray(value)) return [];
  const result: EditorRecentFileSession[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const name = normalizeString(item?.name, '').trim();
    if (!name) continue;
    const path = typeof item.path === 'string' && item.path ? item.path : undefined;
    const handleId = typeof item.handleId === 'string' && item.handleId ? item.handleId : undefined;
    const key = handleId ?? path ?? name;
    if (seen.has(key)) continue;
    seen.add(key);
    const normalized: EditorRecentFileSession = { name, openedAt: normalizeNumber(item.openedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER) };
    if (path) normalized.path = path;
    if (handleId) normalized.handleId = handleId;
    result.push(normalized);
    if (result.length >= MAX_RECENT_FILES) break;
  }
  return result;
}

function validateSessionSection(value: Record<string, unknown>, key: string): void {
  if (value[key] !== undefined && !isRecord(value[key])) throw sessionDataError(`Editor session ${key} must be an object.`, `session.data.${key}`);
}
function sessionDataError(message: string, path: string, cause?: unknown): EngineError {
  return new EngineError(EngineErrorCode.SessionDataInvalid, message, { domain: ErrorDomain.Editor, recovery: ErrorRecovery.Ignore, path, cause });
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function normalizeString(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback; }
function normalizeNullableNumber(value: unknown, fallback: number | null, min: number, max: number): number | null {
  if (value === null) return null;
  if (value === undefined) return fallback;
  return normalizeNumber(value, fallback ?? min, min, max);
}
function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}
