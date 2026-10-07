import { EditorPlatform } from '@haiyue/editor-platform';
import { BrowserEditorShell } from '@haiyue/editor-shell';
import { defineEditorPlugin, defineEditorProduct, EDITOR_PLUGIN_API_VERSION } from '@haiyue/editor-plugin-sdk';
import { ImageDocument, IMAGE_LIMITS } from './document.js';
import { deserializeProject } from './projectFile.js';
import type { RecoverySession } from './recovery.js';

const product = defineEditorProduct({ schemaVersion: 1, id: 'haiyue.image-editor', displayName: 'Haiyue Image Editor', version: '0.1.0',
  requiredPlugins: [defineEditorPlugin({ id: 'image.core', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION,
    activate(context) {
      for (const [kind, id] of [['panel', 'image.layers'], ['panel', 'image.properties'], ['viewport', 'image.canvas'], ['importer', 'image.raster'], ['exporter', 'image.project']] as const)
        context.contributions.register({ kind, id, ownerId: context.pluginId, value: Object.freeze({ id }) });
    } })] });

export class ImageWorkspace {
  readonly platform = new EditorPlatform();
  readonly shell = new BrowserEditorShell(this.platform.contributions);
  private items = new Map<string, ImageDocument>();
  private subscriptions = new Map<string, () => void>();
  private listeners = new Set<() => void>();
  async start() { await this.platform.start(product); }
  get documents() { return [...this.items.values()]; }
  get active(): ImageDocument | undefined { return this.items.get(this.platform.documents.active()?.identity.id ?? ''); }
  get dirty() { return this.documents.some(doc => doc.dirty); }
  add(doc: ImageDocument) {
    if (this.items.size >= IMAGE_LIMITS.documents) throw new Error('最多同时打开 8 个文档，请先保存并关闭一个。');
    if (this.items.has(doc.identity.id)) throw new Error('文档已打开。');
    this.items.set(doc.identity.id, doc);
    this.platform.documents.attach(doc);
    const changed = doc.subscribe(() => this.emit()), history = doc.history.subscribe(() => this.emit());
    this.subscriptions.set(doc.identity.id, () => { changed.dispose(); history.dispose(); });
    this.emit();
  }
  activate(id: string) { this.platform.documents.activate(id); this.emit(); }
  async close(id: string) {
    this.subscriptions.get(id)?.(); this.subscriptions.delete(id); this.items.delete(id);
    await this.platform.documents.close(id); this.emit();
  }
  session(): RecoverySession {
    return { version: 2, activeId: this.active?.identity.id ?? null,
      documents: this.documents.map(doc => ({ state: doc.state, dirty: doc.dirty })) };
  }
  restore(value: unknown) {
    if (value === undefined) return 0;
    if (!value || typeof value !== 'object') throw new Error('恢复副本无效。');
    const session = value as RecoverySession;
    if (![1, 2].includes(session.version) || !Array.isArray(session.documents) || session.documents.length > IMAGE_LIMITS.documents) throw new Error('恢复副本版本或文档数量无效。');
    if (this.items.size) throw new Error('只能在空工作区恢复会话。');
    // Validate the whole session before attaching a single document.
    const documents = session.documents.map(item => {
      if (!item || typeof item.dirty !== 'boolean') throw new Error('恢复文档数据无效。');
      const state = 'project' in item ? deserializeProject(item.project) : structuredClone(item.state);
      if (!state || typeof state.id !== 'string' || !state.id || state.id.length > 80 || !Number.isSafeInteger(state.revision) || state.revision < 1) throw new Error('恢复文档标识无效。');
      return new ImageDocument(state, !item.dirty);
    });
    const ids = documents.map(doc => doc.identity.id);
    if (new Set(ids).size !== ids.length || (session.activeId !== null && !ids.includes(session.activeId))) throw new Error('恢复文档索引无效。');
    for (const doc of documents) this.add(doc);
    if (session.activeId) this.activate(session.activeId);
    return documents.length;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async dispose() {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe(); this.subscriptions.clear();
    this.listeners.clear(); this.items.clear(); this.shell.dispose(); await this.platform.dispose();
  }
  private emit() { for (const listener of this.listeners) listener(); }
}
