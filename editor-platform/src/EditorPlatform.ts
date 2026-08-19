import {
  editorServiceTokens,
  type EditorDiagnostic,
  type EditorDisposable,
  type EditorProductManifest,
} from '@haiyue/editor-plugin-sdk';
import { EditorContributionRegistry, EditorServiceRegistry } from './Registries.js';
import { EditorDocumentHost } from './DocumentHost.js';
import { EditorHistoryService, type EditorHistoryOptions } from './HistoryService.js';
import { EditorPluginHost } from './PluginHost.js';
import { EditorProjectSessionState, type EditorProjectSessionPersistence } from './ProjectSessionState.js';
import { EditorSelectionService } from './SelectionService.js';
import { EditorTaskCoordinator } from './TaskCoordinator.js';

export interface EditorPlatformOptions {
  readonly history?: EditorHistoryOptions;
  readonly sessionPersistence?: EditorProjectSessionPersistence;
  readonly diagnostic?: (diagnostic: EditorDiagnostic) => void;
}

export class EditorPlatform implements EditorDisposable {
  readonly services = new EditorServiceRegistry();
  readonly contributions = new EditorContributionRegistry();
  readonly documents = new EditorDocumentHost();
  readonly history: EditorHistoryService;
  readonly selection = new EditorSelectionService();
  readonly tasks = new EditorTaskCoordinator();
  readonly session: EditorProjectSessionState;
  readonly plugins: EditorPluginHost;
  private readonly registrations: EditorDisposable[];
  private disposed = false;

  constructor(options: EditorPlatformOptions = {}) {
    this.history = new EditorHistoryService(options.history);
    this.session = new EditorProjectSessionState(options.sessionPersistence);
    this.plugins = new EditorPluginHost({
      services: this.services,
      contributions: this.contributions,
      ...(options.diagnostic ? { diagnostic: options.diagnostic } : {}),
    });
    this.registrations = [
      this.services.register(editorServiceTokens.document, this.documents, { ownerId: 'editor-platform' }),
      this.services.register(editorServiceTokens.history, this.history, { ownerId: 'editor-platform' }),
      this.services.register(editorServiceTokens.selection, this.selection, { ownerId: 'editor-platform' }),
      this.services.register(editorServiceTokens.tasks, this.tasks, { ownerId: 'editor-platform' }),
      this.services.register(editorServiceTokens.projectSession, this.session, { ownerId: 'editor-platform' }),
    ];
  }

  async start(product: EditorProductManifest): Promise<void> {
    this.assertActive();
    await this.session.restore();
    await this.plugins.activateProduct(product);
  }

  snapshot() {
    return Object.freeze({
      plugins: this.plugins.snapshot(),
      services: this.services.snapshot(),
      contributions: this.contributions.snapshot(),
      documents: this.documents.snapshot(),
      history: this.history.snapshot(),
      selection: this.selection.snapshot(),
      session: this.session.snapshot(),
      activeTasks: this.tasks.activeCount,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const resource of [
      this.plugins,
      this.tasks,
      this.documents,
      this.selection,
      this.history,
      this.session,
      ...this.registrations.reverse(),
      this.contributions,
      this.services,
    ]) {
      try { await resource.dispose(); }
      catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Editor Platform disposal failed.');
  }

  private assertActive(): void { if (this.disposed) throw new Error('Editor Platform is disposed.'); }
}
