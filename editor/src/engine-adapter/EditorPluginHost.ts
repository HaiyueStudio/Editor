import { type EditorPluginContext, type EnginePlugin, type PluginLifecycleState, type PluginRollbackScope } from '@haiyue/engine/core';
import { EnginePluginHost } from '@haiyue/engine/experimental';

export interface InstalledEditorPlugin<TContext extends EditorPluginContext = EditorPluginContext> {
  plugin: EnginePlugin;
  context: TContext;
  enabled: boolean;
  state: PluginLifecycleState;
}

export interface EditorPluginHostOptions<TContext extends EditorPluginContext> {
  createContext(tracker: PluginRollbackScope): TContext;
  hasDependency?: (name: string) => boolean;
  isDependencyEnabled?: (name: string) => boolean;
}

/** Editor plugins share the engine dependency graph and rollback semantics. */
export class EditorPluginHost<TContext extends EditorPluginContext = EditorPluginContext> {
  private readonly host: EnginePluginHost<TContext>;

  constructor(options: EditorPluginHostOptions<TContext>) {
    this.host = new EnginePluginHost<TContext>({
      scope: 'editor',
      installHint: 'Check the plugin installEditor() implementation and dependency list.',
      lifecycleHint: 'Check the editor plugin lifecycle implementation and dependency enabled state.',
      createContext: tracker => options.createContext(tracker),
      hasDependency: name => this.hasPlugin(name) || options.hasDependency?.(name) === true,
      isDependencyEnabled: name => this.isPluginEnabled(name) || options.isDependencyEnabled?.(name) === true,
    });
  }

  hasPlugin(name: string): boolean { return this.host.hasPlugin(name); }
  isPluginEnabled(name: string): boolean { return this.host.isPluginEnabled(name); }
  getPluginState(name: string): PluginLifecycleState | null { return this.host.getPluginState(name); }
  installPlugin(plugin: EnginePlugin): this { this.host.installPlugin(plugin); return this; }
  enablePlugin(name: string): this { this.host.enablePlugin(name); return this; }
  disablePlugin(name: string): this { this.host.disablePlugin(name); return this; }
  removePlugin(name: string): this { this.host.removePlugin(name); return this; }
  clear(): void { this.host.clear(); }
}
