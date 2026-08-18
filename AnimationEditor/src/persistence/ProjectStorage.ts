import type { AnimationEditorProject } from '../domain/AnimationEditorProject';
import { parseAnimationEditorProject } from './ProjectCodec';

const DATABASE_NAME = 'haiyue-animation-editor';
const DATABASE_VERSION = 1;
const SESSION_STORE = 'session';
const RECENT_STORE = 'recent';
const CURRENT_KEY = 'current';
const RECOVERY_KEY = 'recovery';

export interface ProjectSnapshot {
  readonly name: string;
  readonly fileName: string;
  readonly project: AnimationEditorProject;
  readonly savedFingerprint: string;
  readonly dirty: boolean;
  readonly updatedAt: number;
}

export interface RecentProject extends ProjectSnapshot {
  readonly id: string;
}

export interface AnimationEditorProjectPersistence {
  loadCurrent(): Promise<ProjectSnapshot | null>;
  saveCurrent(snapshot: ProjectSnapshot): Promise<void>;
  loadRecovery(): Promise<ProjectSnapshot | null>;
  saveRecovery(snapshot: ProjectSnapshot): Promise<void>;
  clearRecovery(): Promise<void>;
  listRecent(): Promise<readonly RecentProject[]>;
  saveRecent(project: RecentProject): Promise<void>;
  clearRecent(): Promise<void>;
}

interface SessionRecord extends ProjectSnapshot { readonly key: string; }

export class IndexedDbAnimationEditorProjectPersistence implements AnimationEditorProjectPersistence {
  private _database: Promise<IDBDatabase> | null = null;

  async loadCurrent(): Promise<ProjectSnapshot | null> {
    const record = await this._getSession(CURRENT_KEY);
    return record ? validatedSnapshot(record) : null;
  }

  async saveCurrent(snapshot: ProjectSnapshot): Promise<void> {
    await this._put(SESSION_STORE, { ...detachedSnapshot(snapshot), key: CURRENT_KEY });
  }

  async loadRecovery(): Promise<ProjectSnapshot | null> {
    const record = await this._getSession(RECOVERY_KEY);
    return record ? validatedSnapshot(record) : null;
  }

  async saveRecovery(snapshot: ProjectSnapshot): Promise<void> {
    await this._put(SESSION_STORE, { ...detachedSnapshot(snapshot), key: RECOVERY_KEY });
  }

  async clearRecovery(): Promise<void> {
    await this._delete(SESSION_STORE, RECOVERY_KEY);
  }

  async listRecent(): Promise<readonly RecentProject[]> {
    const database = await this._open();
    const records = await request<RecentProject[]>(database.transaction(RECENT_STORE).objectStore(RECENT_STORE).getAll());
    return records
      .map(record => ({ ...validatedSnapshot(record), id: String(record.id) }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  }

  async saveRecent(project: RecentProject): Promise<void> {
    await this._put(RECENT_STORE, { ...detachedSnapshot(project), id: project.id });
    const recent = await this.listRecent();
    const keep = new Set(recent.map(record => record.id));
    const database = await this._open();
    const allKeys = await request<IDBValidKey[]>(database.transaction(RECENT_STORE).objectStore(RECENT_STORE).getAllKeys());
    await Promise.all(allKeys.filter(key => !keep.has(String(key))).map(key => this._delete(RECENT_STORE, key)));
  }

  async clearRecent(): Promise<void> {
    const database = await this._open();
    await transactionDone(database.transaction(RECENT_STORE, 'readwrite'), transaction => {
      transaction.objectStore(RECENT_STORE).clear();
    });
  }

  private async _getSession(key: string): Promise<SessionRecord | null> {
    const database = await this._open();
    return (await request<SessionRecord | undefined>(
      database.transaction(SESSION_STORE).objectStore(SESSION_STORE).get(key),
    )) ?? null;
  }

  private async _put(storeName: string, value: unknown): Promise<void> {
    const database = await this._open();
    await transactionDone(database.transaction(storeName, 'readwrite'), transaction => {
      transaction.objectStore(storeName).put(value);
    });
  }

  private async _delete(storeName: string, key: IDBValidKey): Promise<void> {
    const database = await this._open();
    await transactionDone(database.transaction(storeName, 'readwrite'), transaction => {
      transaction.objectStore(storeName).delete(key);
    });
  }

  private _open(): Promise<IDBDatabase> {
    this._database ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      open.addEventListener('upgradeneeded', () => {
        const database = open.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) database.createObjectStore(SESSION_STORE, { keyPath: 'key' });
        if (!database.objectStoreNames.contains(RECENT_STORE)) database.createObjectStore(RECENT_STORE, { keyPath: 'id' });
      });
      open.addEventListener('success', () => resolve(open.result));
      open.addEventListener('error', () => reject(open.error ?? new Error('无法打开动画编辑器 IndexedDB。')));
      open.addEventListener('blocked', () => reject(new Error('动画编辑器数据库升级被其他页面阻塞。')));
    });
    return this._database;
  }
}

/** Deterministic in-memory implementation used by tests and non-browser hosts. */
export class MemoryAnimationEditorProjectPersistence implements AnimationEditorProjectPersistence {
  current: ProjectSnapshot | null = null;
  recovery: ProjectSnapshot | null = null;
  recent: RecentProject[] = [];

  async loadCurrent(): Promise<ProjectSnapshot | null> { return this.current ? detachedSnapshot(this.current) : null; }
  async saveCurrent(snapshot: ProjectSnapshot): Promise<void> { this.current = detachedSnapshot(snapshot); }
  async loadRecovery(): Promise<ProjectSnapshot | null> { return this.recovery ? detachedSnapshot(this.recovery) : null; }
  async saveRecovery(snapshot: ProjectSnapshot): Promise<void> { this.recovery = detachedSnapshot(snapshot); }
  async clearRecovery(): Promise<void> { this.recovery = null; }
  async listRecent(): Promise<readonly RecentProject[]> { return structuredClone(this.recent); }
  async saveRecent(project: RecentProject): Promise<void> {
    this.recent = [structuredClone(project), ...this.recent.filter(record => record.id !== project.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  }
  async clearRecent(): Promise<void> { this.recent = []; }
}

export function recentProjectId(project: AnimationEditorProject): string {
  return project.id.toLocaleLowerCase();
}

function detachedSnapshot<T extends ProjectSnapshot>(snapshot: T): T {
  return structuredClone(snapshot);
}

function validatedSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return { ...structuredClone(snapshot), project: parseAnimationEditorProject(snapshot.project) };
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.addEventListener('success', () => resolve(value.result));
    value.addEventListener('error', () => reject(value.error ?? new Error('IndexedDB 请求失败。')));
  });
}

function transactionDone(
  transaction: IDBTransaction,
  operation: (transaction: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB 事务失败。')));
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB 事务已中止。')));
    operation(transaction);
  });
}
