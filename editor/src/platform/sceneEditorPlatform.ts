import type {
  EditorDiagnostic,
  EditorDisposable,
  EditorDocumentAdapter,
  EditorSelectionReference,
} from '@haiyue/editor-plugin-sdk';
import { EditorPlatform } from '@haiyue/editor-platform';
import {
  BrowserEditorShell,
  EditorLazyPluginLoader,
  registerHistoryShortcuts,
} from '@haiyue/editor-shell';
import { sceneEditorProductManifest } from './sceneProductManifest';

export interface SceneDocumentBridge<Serialized = unknown> {
  readonly revision: number;
  readonly savedRevision: number;
  readonly name: string;
  serialize(signal?: AbortSignal): Serialized | Promise<Serialized>;
  markSaved(revision: number): void;
  subscribe(listener: () => void): () => void;
}

const diagnostics: EditorDiagnostic[] = [];
export const sceneEditorPlatform = new EditorPlatform({
  diagnostic: diagnostic => {
    diagnostics.push(diagnostic);
    const log = diagnostic.severity === 'error' ? console.error : console.warn;
    log(`[${diagnostic.code}] ${diagnostic.message}`, diagnostic.cause ?? '');
  },
});

export const sceneEditorShell = new BrowserEditorShell(sceneEditorPlatform.contributions);
const lazyPlugins = new EditorLazyPluginLoader(
  sceneEditorPlatform.plugins,
  sceneEditorProductManifest.lazyPlugins ?? [],
  diagnostic => diagnostics.push(diagnostic),
);
let started: Promise<void> | null = null;
let documentRegistration: EditorDisposable | null = null;
let historyShortcutRegistration: EditorDisposable | null = null;
let keyboardRegistration: EditorDisposable | null = null;
let pageLifecycleAttached = false;

export function startSceneEditorPlatform(): Promise<void> {
  started ??= sceneEditorPlatform.start(sceneEditorProductManifest).then(() => {
    historyShortcutRegistration = registerHistoryShortcuts(
      sceneEditorShell.shortcuts,
      sceneEditorPlatform.history,
      'scene.shell',
    );
    keyboardRegistration = sceneEditorShell.shortcuts.attach(document);
    if (!pageLifecycleAttached) {
      pageLifecycleAttached = true;
      window.addEventListener('pagehide', disposeSceneEditorPlatform, { once: true });
    }
  });
  return started;
}

export function loadSceneEditorPlugin(id: string): Promise<void> {
  return lazyPlugins.load(id).then(state => {
    if (state.status !== 'active') throw state.diagnostic?.cause ?? new Error(`Scene editor plugin ${id} is unavailable.`);
  });
}

export function attachSceneDocumentBridge<Serialized>(bridge: SceneDocumentBridge<Serialized>): EditorDisposable {
  documentRegistration?.dispose();
  const adapter: EditorDocumentAdapter<Serialized> = {
    identity: Object.freeze({ id: 'scene.current', kind: 'haiyue.scene', name: bridge.name }),
    get revision() { return bridge.revision; },
    get savedRevision() { return bridge.savedRevision; },
    serialize: signal => bridge.serialize(signal),
    markSaved: revision => bridge.markSaved(revision ?? bridge.revision),
    subscribe(listener) {
      const unsubscribe = bridge.subscribe(listener);
      return Object.freeze({ dispose: unsubscribe });
    },
    dispose() {},
  };
  documentRegistration = sceneEditorPlatform.documents.attach(adapter);
  return documentRegistration;
}

export function syncSceneSelection(
  items: readonly EditorSelectionReference[],
  active: EditorSelectionReference | null,
): void {
  sceneEditorPlatform.selection.set(items, active);
}

export function sceneEditorDiagnostics(): readonly EditorDiagnostic[] {
  return Object.freeze([...diagnostics]);
}

export function disposeSceneEditorPlatform(): void {
  window.removeEventListener('pagehide', disposeSceneEditorPlatform);
  documentRegistration?.dispose();
  documentRegistration = null;
  keyboardRegistration?.dispose();
  keyboardRegistration = null;
  historyShortcutRegistration?.dispose();
  historyShortcutRegistration = null;
  lazyPlugins.dispose();
  void sceneEditorShell.dispose();
  void sceneEditorPlatform.dispose();
}
