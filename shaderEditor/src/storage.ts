import { validateProject, type ShaderProject } from './model.js';
export interface GalleryItem { project: ShaderProject; thumbnail: string; savedAt: string }
export class GalleryStore {
  private connection: Promise<IDBDatabase> | undefined;
  private db() {
    return this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('haiyue.shader-editor.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'project.id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.connection = undefined; reject(request.error); };
    });
  }
  private async request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('projects', mode), req = action(tx.objectStore('projects'));
      tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('保存已中止。'));
    });
  }
  async list(): Promise<GalleryItem[]> {
    const entries = await this.request('readonly', s => s.getAll()) as GalleryItem[];
    return entries.map(item => ({ ...item, project: validateProject(item.project) })).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async save(project: ShaderProject, thumbnail: string) {
    await this.request('readwrite', s => s.put({ project: validateProject(project), thumbnail, savedAt: new Date().toISOString() }));
  }
  async delete(id: string) { await this.request('readwrite', s => s.delete(id)); }
  async close() { if (this.connection) (await this.connection).close(); }
}
