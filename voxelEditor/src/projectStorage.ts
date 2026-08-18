import type { VoxelProject } from './model';

export type ProjectFileFormat = 'json' | 'vox';

export interface RecoverySnapshot {
  name: string;
  format: ProjectFileFormat;
  project: VoxelProject;
  savedFingerprint: string;
  dirty: boolean;
  updatedAt: number;
}

export interface RecentProject extends RecoverySnapshot {
  id: string;
}

export interface ProjectStore {
  loadCurrent(): Promise<RecoverySnapshot | null>;
  saveCurrent(snapshot: RecoverySnapshot): Promise<void>;
  loadRecovery(): Promise<RecoverySnapshot | null>;
  saveRecovery(snapshot: RecoverySnapshot): Promise<void>;
  clearRecovery(): Promise<void>;
  listRecent(): Promise<RecentProject[]>;
  saveRecent(project: RecentProject): Promise<void>;
  clearRecent(): Promise<void>;
}

const DATABASE_NAME = 'haiyue-voxel-editor';
const DATABASE_VERSION = 1;
const STATE_STORE = 'state';
const RECENT_STORE = 'recent';
const CURRENT_PROJECT_KEY = 'current-project';
const RECOVERY_KEY = 'recovery';
const MAX_RECENT_PROJECTS = 8;

/** IndexedDB-backed recovery and recent-project storage. */
export class IndexedDbProjectStore implements ProjectStore {
  private _database: Promise<IDBDatabase> | null = null;

  async loadCurrent(): Promise<RecoverySnapshot | null> {
    const record = await this._request<{ key: string; value: RecoverySnapshot } | undefined>(STATE_STORE, 'readonly', store => store.get(CURRENT_PROJECT_KEY));
    return record?.value ?? null;
  }

  async saveCurrent(snapshot: RecoverySnapshot): Promise<void> {
    await this._request(STATE_STORE, 'readwrite', store => store.put({ key: CURRENT_PROJECT_KEY, value: snapshot }));
  }

  async loadRecovery(): Promise<RecoverySnapshot | null> {
    const record = await this._request<{ key: string; value: RecoverySnapshot } | undefined>(STATE_STORE, 'readonly', store => store.get(RECOVERY_KEY));
    return record?.value ?? null;
  }

  async saveRecovery(snapshot: RecoverySnapshot): Promise<void> {
    await this._request(STATE_STORE, 'readwrite', store => store.put({ key: RECOVERY_KEY, value: snapshot }));
  }

  async clearRecovery(): Promise<void> {
    await this._request(STATE_STORE, 'readwrite', store => store.delete(RECOVERY_KEY));
  }

  async listRecent(): Promise<RecentProject[]> {
    const records = await this._request<RecentProject[]>(RECENT_STORE, 'readonly', store => store.getAll());
    return records.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECENT_PROJECTS);
  }

  async saveRecent(project: RecentProject): Promise<void> {
    await this._request(RECENT_STORE, 'readwrite', store => store.put(project));
    const records = await this.listRecent();
    const keep = new Set(records.slice(0, MAX_RECENT_PROJECTS).map(record => record.id));
    const all = await this._request<RecentProject[]>(RECENT_STORE, 'readonly', store => store.getAll());
    await Promise.all(all.filter(record => !keep.has(record.id)).map(record =>
      this._request(RECENT_STORE, 'readwrite', store => store.delete(record.id))));
  }

  async clearRecent(): Promise<void> {
    await this._request(RECENT_STORE, 'readwrite', store => store.clear());
  }

  private _request<T = undefined>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    return this._open().then(database => new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      let result: T;
      request.onsuccess = () => { result = request.result as T; };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
      transaction.oncomplete = () => resolve(result!);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    }));
  }

  private _open(): Promise<IDBDatabase> {
    if (this._database) return this._database;
    this._database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE, { keyPath: 'key' });
        if (!database.objectStoreNames.contains(RECENT_STORE)) database.createObjectStore(RECENT_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB。'));
    });
    return this._database;
  }
}

export function projectFingerprint(project: VoxelProject): string {
  // Editor cursor/playhead state is intentionally excluded from the saved-content identity.
  const { editor: _editor, ...persistentProject } = project;
  const serialized = JSON.stringify(persistentProject);
  let first = 0x811c9dc5;
  let second = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second, 33) ^ code;
  }
  return `${serialized.length}:${first >>> 0}:${second >>> 0}`;
}

export function recentProjectId(name: string, format: ProjectFileFormat): string {
  return `${format}:${name.trim().toLocaleLowerCase()}`;
}
