import type { EditorDisposable, EditorProductAdapter, EditorSelectionReference } from '@haiyue/editor-plugin-sdk';
import { EditorPlatform } from '@haiyue/editor-platform';
import { BrowserEditorShell, EditorLazyPluginLoader } from '@haiyue/editor-shell';
import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorProject,
} from '../domain/AnimationEditorProject';
import type { AnimationEditorStore } from '../domain/AnimationEditorStore';
import type { SelectionStore } from '../domain/SelectionStore';
import { animationEditorProductManifest } from './animationEditorProductManifest';

export interface AnimationEditorProductMutation {
  readonly label: string;
  readonly project: AnimationEditorProject;
}

export const animationEditorPlatform = new EditorPlatform({
  history: { maxEntries: 100, byteBudget: 32 * 1024 * 1024 },
  diagnostic: diagnostic => console.warn(`[${diagnostic.code}] ${diagnostic.message}`, diagnostic.cause ?? ''),
});
export const animationEditorShell = new BrowserEditorShell(animationEditorPlatform.contributions);
const lazyPlugins = new EditorLazyPluginLoader(
  animationEditorPlatform.plugins,
  animationEditorProductManifest.lazyPlugins ?? [],
);
let started: Promise<void> | null = null;

export function startAnimationEditorPlatform(): Promise<void> {
  started ??= animationEditorPlatform.start(animationEditorProductManifest);
  return started;
}

export function loadAnimationEditorPlugin(id: string): Promise<void> {
  return lazyPlugins.load(id).then(state => {
    if (state.status !== 'active') throw state.diagnostic?.cause ?? new Error(`Animation editor plugin ${id} is unavailable.`);
  });
}

export function createAnimationEditorProductAdapter(
  store: AnimationEditorStore,
): EditorProductAdapter<Readonly<{ revision: number; project: AnimationEditorProject }>, AnimationEditorProductMutation, AnimationEditorProject> {
  return Object.freeze({
    productId: 'haiyue.animation-editor',
    documentKind: 'haiyue.animation-project',
    snapshot: () => Object.freeze({ revision: store.revision, project: store.project }),
    prepare(mutation: AnimationEditorProductMutation, baseRevision: number, signal?: AbortSignal) {
      if (signal?.aborted) throw abortError();
      if (store.revision !== baseRevision) throw new Error(`Animation project revision changed from ${baseRevision} to ${store.revision}.`);
      return freezeAnimationEditorProject(cloneAnimationEditorProject(mutation.project) as AnimationEditorProject);
    },
    commit(prepared: AnimationEditorProject, baseRevision: number) {
      if (store.revision !== baseRevision) throw new Error(`Animation project revision changed before commit.`);
      store.replaceProject(prepared, { reason: 'platform-product-adapter' });
    },
  });
}

export function connectAnimationEditorPlatform(
  store: AnimationEditorStore,
  selection: SelectionStore,
): EditorDisposable {
  const document = animationEditorPlatform.documents.attach({
    identity: Object.freeze({ id: 'animation.current', kind: 'haiyue.animation-project', name: store.project.name }),
    get revision() { return store.revision; },
    get savedRevision() { return store.isDirty ? Math.max(0, store.revision - 1) : store.revision; },
    serialize: signal => {
      if (signal?.aborted) throw abortError();
      return store.project;
    },
    markSaved: () => { store.markSaved('platform-document-save'); },
    subscribe(listener) {
      const unsubscribe = store.subscribe(listener);
      return Object.freeze({ dispose: unsubscribe });
    },
    dispose() {},
  });
  const sync = (items = selection.items, primary = selection.primary): void => {
    const references = items.map<EditorSelectionReference>(item => Object.freeze({
      kind: `animation.${item.kind}`,
      id: item.ownerId ? `${item.ownerId}/${item.id}` : item.id,
      documentId: 'animation.current',
    }));
    const active = primary
      ? references[items.findIndex(item => item === primary)] ?? references.at(-1) ?? null
      : null;
    animationEditorPlatform.selection.set(references, active);
  };
  const unsubscribeSelection = selection.subscribe(sync);
  sync();
  return once(() => {
    unsubscribeSelection();
    void document.dispose();
  });
}

export function disposeAnimationEditorPlatform(): void {
  lazyPlugins.dispose();
  animationEditorShell.dispose();
  void animationEditorPlatform.dispose();
}

function abortError(): Error {
  const error = new Error('Animation editor operation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function once(dispose: () => void): EditorDisposable {
  let active = true;
  return Object.freeze({ dispose() { if (active) { active = false; dispose(); } } });
}
