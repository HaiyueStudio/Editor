import type {
  EditorContribution,
  EditorContributionKind,
  EditorDiagnostic,
  EditorDisposable,
  EditorLazyPluginManifest,
} from '@haiyue/editor-plugin-sdk';
import {
  EditorContributionRegistry,
  EditorHistoryService,
  EditorPluginHost,
} from '@haiyue/editor-platform';

export interface EditorShellLayoutSnapshot {
  readonly revision: number;
  readonly activePanelId: string | null;
  readonly hiddenPanelIds: readonly string[];
}

export interface EditorShortcutInput {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
  readonly defaultPrevented?: boolean;
  preventDefault?(): void;
}

export interface EditorShortcutContribution {
  readonly id: string;
  readonly chord: string;
  readonly ownerId: string;
  readonly priority?: number;
  readonly when?: () => boolean;
  readonly handler: () => void | Promise<void>;
}

export interface EditorHistoryControlsElement extends EventTarget {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  busy: boolean;
  entries?: readonly Readonly<{ id: number; label: string }>[];
}

export interface EditorLazyPluginState {
  readonly id: string;
  readonly status: 'idle' | 'loading' | 'active' | 'failed';
  readonly diagnostic?: EditorDiagnostic;
}

export class EditorShortcutRegistry implements EditorDisposable {
  private readonly entries = new Map<string, EditorShortcutContribution>();
  private disposed = false;

  register(contribution: EditorShortcutContribution): EditorDisposable {
    this.assertActive();
    const chord = normalizeChord(contribution.chord);
    const existing = [...this.entries.values()].find(entry => normalizeChord(entry.chord) === chord);
    const priority = contribution.priority ?? 0;
    if (existing && (existing.priority ?? 0) === priority) {
      throw new Error(`Shortcut ${contribution.chord} conflicts with ${existing.id}.`);
    }
    this.entries.set(contribution.id, Object.freeze({ ...contribution, chord }));
    return disposable(() => this.entries.delete(contribution.id));
  }

  route(input: EditorShortcutInput): boolean {
    if (this.disposed || input.defaultPrevented || input.repeat) return false;
    const chord = chordFromInput(input);
    const match = [...this.entries.values()]
      .filter(entry => normalizeChord(entry.chord) === chord && (entry.when?.() ?? true))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id))[0];
    if (!match) return false;
    input.preventDefault?.();
    void match.handler();
    return true;
  }

  attach(target: EventTarget): EditorDisposable {
    this.assertActive();
    const listener = (event: Event) => this.route(event as unknown as EditorShortcutInput);
    target.addEventListener('keydown', listener);
    return disposable(() => target.removeEventListener('keydown', listener));
  }

  snapshot(): readonly EditorShortcutContribution[] {
    return Object.freeze([...this.entries.values()].sort((left, right) => left.id.localeCompare(right.id)));
  }

  dispose(): void { if (!this.disposed) { this.disposed = true; this.entries.clear(); } }
  private assertActive(): void { if (this.disposed) throw new Error('Shortcut registry is disposed.'); }
}

export class EditorHistoryControlsAdapter implements EditorDisposable {
  private readonly subscription: EditorDisposable;
  private disposed = false;
  private readonly undo = () => { this.history.undo(); };
  private readonly redo = () => { this.history.redo(); };

  constructor(private readonly element: EditorHistoryControlsElement, private readonly history: EditorHistoryService) {
    this.element.addEventListener('undo-request', this.undo);
    this.element.addEventListener('redo-request', this.redo);
    this.subscription = history.subscribe(snapshot => {
      element.canUndo = snapshot.canUndo;
      element.canRedo = snapshot.canRedo;
      element.undoLabel = snapshot.undoLabel ?? '';
      element.redoLabel = snapshot.redoLabel ?? '';
      element.busy = snapshot.busy;
      element.entries = snapshot.entries.map(entry => Object.freeze({ id: entry.id, label: entry.label }));
    }, true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscription.dispose();
    this.element.removeEventListener('undo-request', this.undo);
    this.element.removeEventListener('redo-request', this.redo);
  }
}

export class EditorLazyPluginLoader implements EditorDisposable {
  private readonly states = new Map<string, EditorLazyPluginState>();
  private readonly pending = new Map<string, Promise<EditorLazyPluginState>>();
  private disposed = false;

  constructor(
    private readonly host: EditorPluginHost,
    manifests: readonly EditorLazyPluginManifest[],
    private readonly diagnostic: (diagnostic: EditorDiagnostic) => void = () => {},
  ) {
    for (const manifest of manifests) {
      if (this.states.has(manifest.id)) throw new Error(`Duplicate lazy plugin ${manifest.id}.`);
      this.states.set(manifest.id, Object.freeze({ id: manifest.id, status: 'idle' }));
      this.loaders.set(manifest.id, manifest.load);
    }
  }

  private readonly loaders = new Map<string, EditorLazyPluginManifest['load']>();

  load(id: string): Promise<EditorLazyPluginState> {
    if (this.disposed) return Promise.reject(new Error('Lazy plugin loader is disposed.'));
    const current = this.states.get(id);
    if (!current) return Promise.reject(new Error(`Unknown lazy plugin ${id}.`));
    if (current.status === 'active') return Promise.resolve(current);
    const existing = this.pending.get(id);
    if (existing) return existing;
    this.states.set(id, Object.freeze({ id, status: 'loading' }));
    const request = this.performLoad(id).finally(() => this.pending.delete(id));
    this.pending.set(id, request);
    return request;
  }

  snapshot(): readonly EditorLazyPluginState[] {
    return Object.freeze([...this.states.values()].sort((left, right) => left.id.localeCompare(right.id)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    this.loaders.clear();
  }

  private async performLoad(id: string): Promise<EditorLazyPluginState> {
    try {
      const manifest = await this.loaders.get(id)?.();
      if (!manifest) throw new Error(`Lazy plugin ${id} has no loader.`);
      if (this.disposed) throw new Error(`Lazy plugin ${id} completed after loader disposal.`);
      if (manifest.id !== id) throw new Error(`Lazy plugin ${id} loaded mismatched manifest ${manifest.id}.`);
      this.host.install(manifest);
      await this.host.activate(id);
      const state = Object.freeze({ id, status: 'active' as const });
      this.states.set(id, state);
      return state;
    } catch (cause) {
      const diagnostic: EditorDiagnostic = Object.freeze({
        code: 'EDITOR_SHELL_LAZY_PLUGIN_FAILED', severity: 'warning',
        message: `Lazy plugin ${id} could not be loaded.`, ownerId: id, cause,
      });
      const state = Object.freeze({ id, status: 'failed' as const, diagnostic });
      this.states.set(id, state);
      this.diagnostic(diagnostic);
      return state;
    }
  }
}

export class BrowserEditorShell implements EditorDisposable {
  readonly shortcuts = new EditorShortcutRegistry();
  private readonly listeners = new Set<(snapshot: EditorShellLayoutSnapshot) => void>();
  private hidden = new Set<string>();
  private activePanelId: string | null = null;
  private revision = 0;
  private disposed = false;

  constructor(readonly contributions: EditorContributionRegistry) {}

  list<T = unknown>(kind: EditorContributionKind): readonly EditorContribution<T>[] {
    return this.contributions.list<T>(kind);
  }

  activatePanel(id: string): void {
    this.assertActive();
    if (!this.list('panel').some(panel => panel.id === id)) throw new Error(`Unknown panel ${id}.`);
    this.hidden.delete(id);
    this.activePanelId = id;
    this.emit();
  }

  setPanelHidden(id: string, hidden: boolean): void {
    this.assertActive();
    if (hidden) this.hidden.add(id); else this.hidden.delete(id);
    if (hidden && this.activePanelId === id) this.activePanelId = null;
    this.emit();
  }

  snapshot(): EditorShellLayoutSnapshot {
    return Object.freeze({
      revision: this.revision,
      activePanelId: this.activePanelId,
      hiddenPanelIds: Object.freeze([...this.hidden].sort()),
    });
  }

  subscribe(listener: (snapshot: EditorShellLayoutSnapshot) => void, emitInitial = false): EditorDisposable {
    this.assertActive();
    this.listeners.add(listener);
    if (emitInitial) listener(this.snapshot());
    return disposable(() => this.listeners.delete(listener));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.shortcuts.dispose();
    this.listeners.clear();
    this.hidden.clear();
    this.activePanelId = null;
  }

  private emit(): void {
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private assertActive(): void { if (this.disposed) throw new Error('Browser Editor Shell is disposed.'); }
}

export async function defineEditorShellUI(): Promise<void> {
  const { defineHaiyueUI } = await import('@haiyue/ui');
  defineHaiyueUI();
}

export function registerHistoryShortcuts(registry: EditorShortcutRegistry, history: EditorHistoryService, ownerId: string): EditorDisposable {
  const registrations = [
    registry.register({ id: `${ownerId}.history.undo`, chord: 'Mod+Z', ownerId, handler: () => { history.undo(); } }),
    registry.register({ id: `${ownerId}.history.redo.shift`, chord: 'Mod+Shift+Z', ownerId, handler: () => { history.redo(); } }),
    registry.register({ id: `${ownerId}.history.redo`, chord: 'Mod+Y', ownerId, handler: () => { history.redo(); } }),
  ];
  return disposable(() => { for (const registration of registrations.reverse()) registration.dispose(); });
}

function normalizeChord(chord: string): string {
  const parts = chord.split('+').map(part => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new TypeError('Shortcut chord requires a key.');
  const modifiers = new Set(parts.map(part => part.toLowerCase()));
  return [
    modifiers.has('mod') ? 'Mod' : null,
    modifiers.has('ctrl') ? 'Ctrl' : null,
    modifiers.has('meta') ? 'Meta' : null,
    modifiers.has('alt') ? 'Alt' : null,
    modifiers.has('shift') ? 'Shift' : null,
    key.length === 1 ? key.toUpperCase() : key,
  ].filter(Boolean).join('+');
}

function chordFromInput(input: EditorShortcutInput): string {
  return [
    input.ctrlKey || input.metaKey ? 'Mod' : null,
    input.altKey ? 'Alt' : null,
    input.shiftKey ? 'Shift' : null,
    input.key.length === 1 ? input.key.toUpperCase() : input.key,
  ].filter(Boolean).join('+');
}

function disposable(dispose: () => void): EditorDisposable {
  let active = true;
  return Object.freeze({ dispose() { if (active) { active = false; dispose(); } } });
}
