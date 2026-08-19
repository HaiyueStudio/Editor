import type {
  EditorContribution,
  EditorContributionRegistryPort,
  EditorDiagnostic,
  EditorDisposable,
  EditorPluginManifest,
  EditorProductManifest,
  EditorServiceRegistrationOptions,
  EditorServiceRegistryPort,
  EditorServiceToken,
} from '@haiyue/editor-plugin-sdk';
import { EditorLifecycleScope } from './LifecycleScope.js';
import { EditorContributionRegistry, EditorServiceRegistry } from './Registries.js';

interface ActivePlugin {
  readonly manifest: EditorPluginManifest;
  readonly scope: EditorLifecycleScope;
  readonly order: number;
}

export interface EditorPluginSnapshot {
  readonly id: string;
  readonly version: string;
  readonly state: 'installed' | 'active';
  readonly provides: readonly string[];
}

export interface EditorPluginHostSnapshot {
  readonly plugins: readonly EditorPluginSnapshot[];
  readonly capabilities: Readonly<Record<string, string>>;
  readonly diagnostics: readonly EditorDiagnostic[];
}

export interface EditorPluginHostOptions {
  readonly services?: EditorServiceRegistry;
  readonly contributions?: EditorContributionRegistry;
  readonly diagnostic?: (diagnostic: EditorDiagnostic) => void;
}

export class EditorPluginHost implements EditorDisposable {
  readonly services: EditorServiceRegistry;
  readonly contributions: EditorContributionRegistry;
  private readonly installed = new Map<string, EditorPluginManifest>();
  private readonly active = new Map<string, ActivePlugin>();
  private readonly diagnostics: EditorDiagnostic[] = [];
  private activationOrder = 1;
  private disposed = false;

  constructor(private readonly options: EditorPluginHostOptions = {}) {
    this.services = options.services ?? new EditorServiceRegistry();
    this.contributions = options.contributions ?? new EditorContributionRegistry();
  }

  install(manifest: EditorPluginManifest): void {
    this.assertActive();
    const existing = this.installed.get(manifest.id);
    if (existing && existing !== manifest) throw new Error(`Plugin ${manifest.id} is already installed.`);
    this.installed.set(manifest.id, manifest);
  }

  installProduct(product: EditorProductManifest): void {
    for (const plugin of [...product.requiredPlugins, ...(product.defaultPlugins ?? [])]) this.install(plugin);
  }

  async activateProduct(product: EditorProductManifest): Promise<void> {
    this.installProduct(product);
    for (const plugin of product.requiredPlugins) await this.activate(plugin.id);
    for (const plugin of product.defaultPlugins ?? []) {
      try { await this.activate(plugin.id); }
      catch (cause) {
        this.report({
          code: 'EDITOR_PLUGIN_DEFAULT_ACTIVATION_FAILED',
          severity: 'warning',
          message: `Default plugin ${plugin.id} was disabled after activation failed.`,
          ownerId: plugin.id,
          cause,
        });
      }
    }
  }

  async activate(id: string): Promise<void> {
    this.assertActive();
    await this.activateWithStack(id, []);
  }

  async disable(id: string): Promise<void> {
    const active = this.active.get(id);
    if (!active) return;
    const provided = new Set(active.manifest.provides ?? []);
    const dependents = [...this.active.values()]
      .filter(candidate => candidate.manifest.id !== id)
      .filter(candidate => (candidate.manifest.requiredCapabilities ?? []).some(capability => provided.has(capability)))
      .map(candidate => candidate.manifest.id);
    if (dependents.length > 0) {
      throw new Error(`Cannot disable plugin ${id}; active dependents: ${dependents.sort().join(', ')}.`);
    }
    this.active.delete(id);
    try { await active.scope.dispose(); }
    catch (cause) {
      this.report({
        code: 'EDITOR_PLUGIN_DISPOSE_FAILED', severity: 'error',
        message: `Plugin ${id} failed during disposal.`, ownerId: id, cause,
      });
      throw cause;
    }
  }

  async uninstall(id: string): Promise<void> {
    await this.disable(id);
    this.installed.delete(id);
  }

  has(id: string): boolean { return this.installed.has(id); }
  isActive(id: string): boolean { return this.active.has(id); }

  snapshot(): EditorPluginHostSnapshot {
    const capabilities: Record<string, string> = {};
    for (const plugin of this.active.values()) {
      for (const capability of plugin.manifest.provides ?? []) capabilities[capability] = plugin.manifest.id;
    }
    return Object.freeze({
      plugins: Object.freeze([...this.installed.values()].map(manifest => Object.freeze({
        id: manifest.id,
        version: manifest.version,
        state: this.active.has(manifest.id) ? 'active' as const : 'installed' as const,
        provides: Object.freeze([...(manifest.provides ?? [])]),
      })).sort((left, right) => left.id.localeCompare(right.id))),
      capabilities: Object.freeze(capabilities),
      diagnostics: Object.freeze([...this.diagnostics]),
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const plugins = [...this.active.values()].sort((left, right) => right.order - left.order);
    const errors: unknown[] = [];
    for (const plugin of plugins) {
      this.active.delete(plugin.manifest.id);
      try { await plugin.scope.dispose(); }
      catch (error) { errors.push(error); }
    }
    this.installed.clear();
    if (!this.options.services) this.services.dispose();
    if (!this.options.contributions) this.contributions.dispose();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Multiple editor plugins failed during disposal.');
  }

  private async activateWithStack(id: string, stack: readonly string[]): Promise<void> {
    if (this.active.has(id)) return;
    const manifest = this.installed.get(id);
    if (!manifest) throw this.failure('EDITOR_PLUGIN_NOT_INSTALLED', id, `Plugin ${id} is not installed.`);
    if (stack.includes(id)) {
      throw this.failure('EDITOR_PLUGIN_DEPENDENCY_CYCLE', id, `Plugin dependency cycle: ${[...stack, id].join(' -> ')}.`);
    }
    for (const conflict of manifest.conflicts ?? []) {
      if (this.active.has(conflict)) {
        throw this.failure('EDITOR_PLUGIN_CONFLICT', id, `Plugin ${id} conflicts with active plugin ${conflict}.`);
      }
    }
    const nextStack = [...stack, id];
    for (const capability of manifest.requiredCapabilities ?? []) {
      const provider = this.findProvider(capability, id);
      if (!provider) {
        throw this.failure('EDITOR_PLUGIN_REQUIRED_CAPABILITY_MISSING', id, `Plugin ${id} requires capability ${capability}.`, capability);
      }
      await this.activateWithStack(provider.id, nextStack);
    }
    const optionalCapabilities: Record<string, boolean> = {};
    for (const capability of manifest.optionalCapabilities ?? []) {
      const provider = this.findProvider(capability, id);
      if (!provider) {
        optionalCapabilities[capability] = false;
        continue;
      }
      try {
        await this.activateWithStack(provider.id, nextStack);
        optionalCapabilities[capability] = true;
      } catch (cause) {
        optionalCapabilities[capability] = false;
        this.report({
          code: 'EDITOR_PLUGIN_OPTIONAL_CAPABILITY_UNAVAILABLE', severity: 'warning',
          message: `Optional capability ${capability} is unavailable to ${id}.`, ownerId: id, capability, cause,
        });
      }
    }
    for (const capability of manifest.provides ?? []) {
      const current = this.activeProvider(capability);
      if (current && current.manifest.id !== id) {
        throw this.failure('EDITOR_PLUGIN_CAPABILITY_CONFLICT', id, `Capability ${capability} is already provided by ${current.manifest.id}.`, capability);
      }
    }

    const scope = new EditorLifecycleScope(`plugin:${id}`);
    try {
      const result = await manifest.activate(Object.freeze({
        pluginId: id,
        scope,
        services: scopedServices(this.services, scope, id),
        contributions: scopedContributions(this.contributions, scope, id),
        optionalCapabilities: Object.freeze(optionalCapabilities),
        report: (diagnostic: EditorDiagnostic) => this.report({ ...diagnostic, ownerId: diagnostic.ownerId ?? id }),
      }));
      if (result) scope.own(result);
      scope.assertActive();
      this.active.set(id, { manifest, scope, order: this.activationOrder++ });
    } catch (cause) {
      try { await scope.dispose(); }
      catch (rollbackError) {
        cause = new AggregateError([cause, rollbackError], `Plugin ${id} activation and rollback failed.`);
      }
      throw this.failure('EDITOR_PLUGIN_ACTIVATION_FAILED', id, `Plugin ${id} activation failed.`, undefined, cause);
    }
  }

  private findProvider(capability: string, consumerId: string): EditorPluginManifest | undefined {
    const providers = [...this.installed.values()]
      .filter(manifest => manifest.id !== consumerId && (manifest.provides ?? []).includes(capability))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (providers.length > 1) {
      throw this.failure(
        'EDITOR_PLUGIN_CAPABILITY_AMBIGUOUS', consumerId,
        `Capability ${capability} has multiple providers: ${providers.map(provider => provider.id).join(', ')}.`, capability,
      );
    }
    return providers[0];
  }

  private activeProvider(capability: string): ActivePlugin | undefined {
    return [...this.active.values()].find(plugin => (plugin.manifest.provides ?? []).includes(capability));
  }

  private failure(code: string, ownerId: string, message: string, capability?: string, cause?: unknown): Error {
    const diagnostic: EditorDiagnostic = {
      code, severity: 'error', message, ownerId,
      ...(capability ? { capability } : {}),
      ...(cause === undefined ? {} : { cause }),
    };
    this.report(diagnostic);
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.name = code;
    return error;
  }

  private report(diagnostic: EditorDiagnostic): void {
    const frozen = Object.freeze({ ...diagnostic });
    this.diagnostics.push(frozen);
    this.options.diagnostic?.(frozen);
  }

  private assertActive(): void { if (this.disposed) throw new Error('Plugin host is disposed.'); }
}

function scopedServices(
  registry: EditorServiceRegistry,
  scope: EditorLifecycleScope,
  ownerId: string,
): EditorServiceRegistryPort {
  return Object.freeze({
    register<T>(token: EditorServiceToken<T>, value: T, options: EditorServiceRegistrationOptions): EditorDisposable {
      const registration = registry.register(token, value, { ...options, ownerId });
      scope.own(registration);
      return registration;
    },
    get: <T>(token: EditorServiceToken<T>) => registry.get(token),
    optional: <T>(token: EditorServiceToken<T>) => registry.optional(token),
    has: <T>(token: EditorServiceToken<T>) => registry.has(token),
  });
}

function scopedContributions(
  registry: EditorContributionRegistry,
  scope: EditorLifecycleScope,
  ownerId: string,
): EditorContributionRegistryPort {
  return Object.freeze({
    register<T>(contribution: EditorContribution<T>): EditorDisposable {
      const registration = registry.register({ ...contribution, ownerId });
      scope.own(registration);
      return registration;
    },
    list: <T>(kind: EditorContribution<T>['kind']) => registry.list<T>(kind),
  });
}
