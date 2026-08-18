import type { SerializedEditorScene } from '../../export/runtimeScene';

const DB_NAME = '@haiyue/engine-editor';
const DB_VERSION = 2;
const STORE_NAME = 'document-recovery';
const RECOVERY_KEY = 'active-document';
const RECENT_STORE_NAME = 'recent-scene-handles';

export interface DocumentRecoveryRecord {
  readonly format: 'haiyue-editor-recovery';
  readonly version: 1;
  readonly scene: SerializedEditorScene;
  readonly documentName: string | null;
  readonly currentRevision: number;
  readonly savedRevision: number;
  readonly updatedAt: number;
}

export interface DocumentRecoveryStore {
  load(): Promise<DocumentRecoveryRecord | null>;
  save(record: DocumentRecoveryRecord): Promise<void>;
  clear(): Promise<void>;
}

export function createDocumentRecoveryRecord(
  scene: SerializedEditorScene,
  state: Pick<DocumentRecoveryRecord, 'documentName' | 'currentRevision' | 'savedRevision'>,
  updatedAt = Date.now(),
): DocumentRecoveryRecord {
  return Object.freeze({
    format: 'haiyue-editor-recovery',
    version: 1,
    scene,
    documentName: state.documentName,
    currentRevision: state.currentRevision,
    savedRevision: state.savedRevision,
    updatedAt,
  });
}

export function createBrowserDocumentRecoveryStore(): DocumentRecoveryStore | null {
  if (typeof indexedDB === 'undefined') return null;
  return {
    async load() {
      const db = await openDb();
      const value = await requestStore<unknown>(db, 'readonly', store => store.get(RECOVERY_KEY));
      db.close();
      return isRecoveryRecord(value) ? value : null;
    },
    async save(record) {
      const db = await openDb();
      await requestStore(db, 'readwrite', store => store.put(record, RECOVERY_KEY));
      db.close();
    },
    async clear() {
      const db = await openDb();
      await requestStore(db, 'readwrite', store => store.delete(RECOVERY_KEY));
      db.close();
    },
  };
}

function isRecoveryRecord(value: unknown): value is DocumentRecoveryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DocumentRecoveryRecord>;
  return record.format === 'haiyue-editor-recovery'
    && record.version === 1
    && typeof record.scene === 'object'
    && (record.documentName === null || typeof record.documentName === 'string')
    && typeof record.currentRevision === 'number'
    && typeof record.savedRevision === 'number'
    && typeof record.updatedAt === 'number';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECENT_STORE_NAME)) db.createObjectStore(RECENT_STORE_NAME);
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open editor recovery database.'));
  });
}

function requestStore<T = unknown>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Document recovery request failed.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Document recovery transaction failed.'));
  });
}
