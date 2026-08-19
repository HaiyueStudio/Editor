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
import type { RayTracingPreviewOwner } from '../infra/ray-tracing/RayTracingPreviewOwner';

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
let rayTracingPanel: { dispose(): void } | null = null;
let rayTracingTransition: Promise<void> | null = null;

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
  if (sceneEditorPlatform.plugins.has(id)) return sceneEditorPlatform.plugins.activate(id);
  return lazyPlugins.load(id).then(state => {
    if (state.status !== 'active') throw state.diagnostic?.cause ?? new Error(`Scene editor plugin ${id} is unavailable.`);
  });
}

export function enableSceneRayTracingPreview(host: HTMLElement = document.body): Promise<void> {
  if (rayTracingPanel) return Promise.resolve();
  if (rayTracingTransition) return rayTracingTransition;
  rayTracingTransition = loadSceneEditorPlugin('scene.ray-tracing').then(async () => {
    const contribution = sceneEditorShell.list<{
      readonly owner: RayTracingPreviewOwner;
      readonly load: () => Promise<typeof import('../infra/ray-tracing/RayTracingPanel')>;
    }>('panel').find(value => value.id === 'scene.ray-tracing-preview');
    if (!contribution) throw new Error('Ray tracing preview panel contribution is unavailable.');
    const panel = await contribution.value.load();
    rayTracingPanel = panel.mountRayTracingPanel({ owner: contribution.value.owner, host, onDisable: disableSceneRayTracingPreview });
    sceneEditorShell.activatePanel('scene.ray-tracing-preview');
  }).finally(() => { rayTracingTransition = null; });
  return rayTracingTransition;
}

export async function disableSceneRayTracingPreview(): Promise<void> {
  rayTracingPanel?.dispose();
  rayTracingPanel = null;
  if (sceneEditorPlatform.plugins.isActive('scene.ray-tracing')) {
    sceneEditorShell.setPanelHidden('scene.ray-tracing-preview', true);
    await sceneEditorPlatform.plugins.disable('scene.ray-tracing');
  }
}

export function sceneRayTracingPreviewState(): Readonly<{ pluginActive: boolean; panelMounted: boolean; contributionCount: number; activeTaskCount: number }> {
  return Object.freeze({
    pluginActive: sceneEditorPlatform.plugins.isActive('scene.ray-tracing'),
    panelMounted: rayTracingPanel !== null,
    contributionCount: (['panel', 'viewport', 'diagnostics', 'exporter'] as const)
      .reduce((count, kind) => count + sceneEditorShell.list(kind).filter(value => value.ownerId === 'scene.ray-tracing').length, 0),
    activeTaskCount: sceneEditorPlatform.tasks.activeCount,
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
  rayTracingPanel?.dispose();
  rayTracingPanel = null;
  lazyPlugins.dispose();
  void sceneEditorShell.dispose();
  void sceneEditorPlatform.dispose();
}
