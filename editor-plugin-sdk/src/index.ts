export const EDITOR_PLUGIN_API_VERSION = '1' as const;

export type EditorPluginApiVersion = typeof EDITOR_PLUGIN_API_VERSION;
export type EditorCapabilityId = string;
export type EditorContributionKind =
  | 'panel'
  | 'menu'
  | 'toolbar'
  | 'shortcut'
  | 'inspector'
  | 'importer'
  | 'exporter'
  | 'viewport'
  | 'diagnostics';

export interface EditorDisposable {
  dispose(): void | Promise<void>;
}

export type EditorDisposer = EditorDisposable | (() => void | Promise<void>);

export interface EditorLifecycleScopePort extends EditorDisposable {
  readonly id: string;
  readonly disposed: boolean;
  own<T extends EditorDisposer>(resource: T): T;
  defer(dispose: () => void | Promise<void>): () => void;
  assertActive(): void;
}

export interface EditorDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly ownerId?: string;
  readonly capability?: string;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface EditorServiceToken<T> {
  readonly id: string;
  readonly key: symbol;
  readonly _service?: T;
}

export function createEditorServiceToken<T>(id: string): EditorServiceToken<T> {
  const normalized = requireIdentifier(id, 'service token');
  return Object.freeze({ id: normalized, key: Symbol.for(`@haiyue/editor-service/${normalized}`) });
}

export interface EditorServiceRegistrationOptions {
  readonly ownerId: string;
  readonly priority?: number;
  readonly replace?: boolean;
}

export interface EditorServiceRegistryPort {
  register<T>(token: EditorServiceToken<T>, value: T, options: EditorServiceRegistrationOptions): EditorDisposable;
  get<T>(token: EditorServiceToken<T>): T;
  optional<T>(token: EditorServiceToken<T>): T | undefined;
  has<T>(token: EditorServiceToken<T>): boolean;
}

export interface EditorContribution<T = unknown> {
  readonly kind: EditorContributionKind;
  readonly id: string;
  readonly value: T;
  readonly ownerId: string;
  readonly priority?: number;
}

export interface EditorContributionRegistryPort {
  register<T>(contribution: EditorContribution<T>): EditorDisposable;
  list<T = unknown>(kind: EditorContributionKind): readonly EditorContribution<T>[];
}

export interface EditorPluginActivationContext {
  readonly pluginId: string;
  readonly scope: EditorLifecycleScopePort;
  readonly services: EditorServiceRegistryPort;
  readonly contributions: EditorContributionRegistryPort;
  readonly optionalCapabilities: Readonly<Record<string, boolean>>;
  report(diagnostic: EditorDiagnostic): void;
}

export interface EditorPluginManifest {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: EditorPluginApiVersion;
  readonly requiredCapabilities?: readonly EditorCapabilityId[];
  readonly optionalCapabilities?: readonly EditorCapabilityId[];
  readonly provides?: readonly EditorCapabilityId[];
  readonly conflicts?: readonly string[];
  activate(context: EditorPluginActivationContext): void | EditorDisposer | Promise<void | EditorDisposer>;
}

export interface EditorLazyPluginManifest {
  readonly id: string;
  readonly load: () => Promise<EditorPluginManifest>;
}

export interface EditorProductManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly requiredPlugins: readonly EditorPluginManifest[];
  readonly defaultPlugins?: readonly EditorPluginManifest[];
  readonly lazyPlugins?: readonly EditorLazyPluginManifest[];
}

export interface EditorDocumentIdentity {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

export interface EditorDocumentSnapshot {
  readonly identity: EditorDocumentIdentity;
  readonly revision: number;
  readonly savedRevision: number;
  readonly dirty: boolean;
  readonly active: boolean;
  readonly closed: boolean;
}

export interface EditorDocumentAdapter<Serialized = unknown> extends EditorDisposable {
  readonly identity: EditorDocumentIdentity;
  readonly revision: number;
  readonly savedRevision: number;
  serialize(signal?: AbortSignal): Serialized | Promise<Serialized>;
  markSaved(revision?: number): void;
  subscribe(listener: () => void): EditorDisposable;
}

export interface EditorCommand {
  readonly label: string;
  readonly estimatedBytes?: number;
  execute(): void | boolean;
  undo(): void;
  redo?(): void | boolean;
  mergeWith?(next: EditorCommand): EditorCommand | null;
  dispose?(): void;
}

export interface EditorHistoryEntrySnapshot {
  readonly id: number;
  readonly label: string;
  readonly estimatedBytes: number;
}

export interface EditorHistorySnapshot {
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel?: string;
  readonly redoLabel?: string;
  readonly busy: boolean;
  readonly estimatedBytes: number;
  readonly entries: readonly EditorHistoryEntrySnapshot[];
}

export interface EditorSelectionReference {
  readonly kind: string;
  readonly id: string;
  readonly documentId?: string;
}

export interface EditorSelectionSnapshot {
  readonly revision: number;
  readonly active: EditorSelectionReference | null;
  readonly items: readonly EditorSelectionReference[];
}

export interface EditorTaskProgress {
  readonly current: number;
  readonly total?: number;
  readonly message?: string;
}

export interface EditorTaskContext {
  readonly signal: AbortSignal;
  readonly generation: number;
  report(progress: EditorTaskProgress): void;
  assertCurrent(): void;
}

export interface EditorTaskDefinition<Prepared, Result = Prepared> {
  prepare(context: EditorTaskContext): Prepared | Promise<Prepared>;
  commit(prepared: Prepared): Result;
  rollback?(reason: 'cancelled' | 'failed', prepared: Prepared | undefined, error?: unknown): void | Promise<void>;
}

export interface EditorProductAdapter<Snapshot = unknown, Mutation = unknown, Result = unknown> {
  readonly productId: string;
  readonly documentKind: string;
  snapshot(): Readonly<Snapshot>;
  prepare(mutation: Mutation, baseRevision: number, signal?: AbortSignal): Result | Promise<Result>;
  commit(prepared: Result, baseRevision: number): void;
}

export const editorServiceTokens = Object.freeze({
  document: createEditorServiceToken<unknown>('document'),
  history: createEditorServiceToken<unknown>('history'),
  selection: createEditorServiceToken<unknown>('selection'),
  tasks: createEditorServiceToken<unknown>('tasks'),
  projectSession: createEditorServiceToken<unknown>('project-session'),
  diagnostics: createEditorServiceToken<unknown>('diagnostics'),
});

export function defineEditorPlugin(manifest: EditorPluginManifest): EditorPluginManifest {
  requireIdentifier(manifest.id, 'plugin');
  if (manifest.apiVersion !== EDITOR_PLUGIN_API_VERSION) {
    throw new TypeError(`Unsupported Editor Plugin API ${manifest.apiVersion}.`);
  }
  return Object.freeze({
    ...manifest,
    requiredCapabilities: freezeStrings(manifest.requiredCapabilities),
    optionalCapabilities: freezeStrings(manifest.optionalCapabilities),
    provides: freezeStrings(manifest.provides),
    conflicts: freezeStrings(manifest.conflicts),
  });
}

export function defineEditorProduct(manifest: EditorProductManifest): EditorProductManifest {
  if (manifest.schemaVersion !== 1) throw new TypeError('Unsupported Editor Product manifest schema.');
  requireIdentifier(manifest.id, 'product');
  const ids = new Set<string>();
  for (const plugin of [...manifest.requiredPlugins, ...(manifest.defaultPlugins ?? [])]) {
    if (ids.has(plugin.id)) throw new TypeError(`Duplicate product plugin ${plugin.id}.`);
    ids.add(plugin.id);
  }
  for (const plugin of manifest.lazyPlugins ?? []) {
    requireIdentifier(plugin.id, 'lazy plugin');
    if (ids.has(plugin.id)) throw new TypeError(`Duplicate product plugin ${plugin.id}.`);
    ids.add(plugin.id);
  }
  return Object.freeze({
    ...manifest,
    requiredPlugins: Object.freeze([...manifest.requiredPlugins]),
    defaultPlugins: Object.freeze([...(manifest.defaultPlugins ?? [])]),
    lazyPlugins: Object.freeze([...(manifest.lazyPlugins ?? [])]),
  });
}

function requireIdentifier(value: string, kind: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new TypeError(`Invalid ${kind} identifier "${value}".`);
  }
  return normalized;
}

function freezeStrings(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(values ?? [])]);
}
