const DB_NAME = '@haiyue/engine-editor';
const DB_VERSION = 2;
const STORE_NAME = 'recent-scene-handles';
const RECOVERY_STORE_NAME = 'document-recovery';

type FilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};

export type FilePickerOptions = {
  multiple?: boolean;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
};

type PermissionMode = 'read' | 'readwrite';

export type FileSystemPermissionDescriptor = {
  mode?: PermissionMode;
};

export type FileSystemWritableFileStreamLike = {
  write(data: Blob | ArrayBuffer | ArrayBufferView | string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
};

export type FileSystemFileHandleLike = {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable?(): Promise<FileSystemWritableFileStreamLike>;
  queryPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
};

type FilePickerHost = typeof globalThis & {
  showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandleLike[]>;
  showSaveFilePicker?: (options?: FilePickerOptions & { suggestedName?: string }) => Promise<FileSystemFileHandleLike>;
};

export interface RecentSceneFileOpenResult {
  file: File;
  handle?: FileSystemFileHandleLike;
}

export function canUseRecentSceneHandles(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function canUseSceneFilePicker(): boolean {
  return typeof (globalThis as FilePickerHost).showOpenFilePicker === 'function';
}

export function canUseSceneSavePicker(): boolean {
  return typeof (globalThis as FilePickerHost).showSaveFilePicker === 'function';
}

export async function pickSceneJsonFile(): Promise<RecentSceneFileOpenResult | null> {
  const picker = (globalThis as FilePickerHost).showOpenFilePicker;
  if (!picker) return null;
  const [handle] = await picker({
    multiple: false,
    excludeAcceptAllOption: false,
    types: [{
      description: 'Scene JSON',
      accept: { 'application/json': ['.json'] },
    }],
  });
  if (!handle) return null;
  return { file: await handle.getFile(), handle };
}

export async function pickSceneJsonSaveHandle(suggestedName: string): Promise<FileSystemFileHandleLike | null> {
  const picker = (globalThis as FilePickerHost).showSaveFilePicker;
  if (!picker) return null;
  return picker({
    suggestedName,
    excludeAcceptAllOption: false,
    types: [{
      description: 'Scene JSON',
      accept: { 'application/json': ['.json'] },
    }],
  });
}

export function createRecentSceneHandleId(file: File): string {
  const random = Math.random().toString(36).slice(2);
  return `scene:${Date.now()}:${file.name}:${random}`;
}

export async function saveRecentSceneHandle(handleId: string, handle: FileSystemFileHandleLike): Promise<void> {
  if (!canUseRecentSceneHandles()) return;
  const db = await openRecentSceneHandleDb();
  await requestStore(db, 'readwrite', store => store.put(handle, handleId));
  db.close();
}

export async function loadRecentSceneFile(handleId: string): Promise<File | null> {
  return (await loadRecentSceneFileResult(handleId))?.file ?? null;
}

export async function loadRecentSceneFileResult(handleId: string): Promise<RecentSceneFileOpenResult | null> {
  if (!canUseRecentSceneHandles()) return null;
  const db = await openRecentSceneHandleDb();
  const handle = await requestStore<FileSystemFileHandleLike | undefined>(db, 'readonly', store => store.get(handleId));
  db.close();
  if (!handle) return null;
  const permission = await ensureReadPermission(handle);
  if (!permission) return null;
  return { file: await handle.getFile(), handle };
}

export async function ensureSceneWritePermission(handle: FileSystemFileHandleLike): Promise<boolean> {
  if (!handle.createWritable) return false;
  if (!handle.queryPermission || !handle.requestPermission) return true;
  const descriptor = { mode: 'readwrite' as const };
  const current = await handle.queryPermission(descriptor);
  if (current === 'granted') return true;
  return (await handle.requestPermission(descriptor)) === 'granted';
}

export async function deleteRecentSceneHandle(handleId: string): Promise<void> {
  if (!canUseRecentSceneHandles()) return;
  const db = await openRecentSceneHandleDb();
  await requestStore(db, 'readwrite', store => store.delete(handleId));
  db.close();
}

export async function clearRecentSceneHandles(): Promise<void> {
  if (!canUseRecentSceneHandles()) return;
  const db = await openRecentSceneHandleDb();
  await requestStore(db, 'readwrite', store => store.clear());
  db.close();
}

async function ensureReadPermission(handle: FileSystemFileHandleLike): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  const descriptor = { mode: 'read' as const };
  const current = await handle.queryPermission(descriptor);
  if (current === 'granted') return true;
  const requested = await handle.requestPermission(descriptor);
  return requested === 'granted';
}

function openRecentSceneHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(RECOVERY_STORE_NAME)) db.createObjectStore(RECOVERY_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open recent scene handle database.'));
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
    request.onerror = () => reject(request.error ?? new Error('Recent scene handle request failed.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Recent scene handle transaction failed.'));
  });
}
