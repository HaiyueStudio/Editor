import type { EditorDisposable, EditorProductAdapter, EditorSelectionReference } from '@haiyue/editor-plugin-sdk';
import { EditorPlatform } from '@haiyue/editor-platform';
import { BrowserEditorShell, EditorLazyPluginLoader } from '@haiyue/editor-shell';
import type { ProjectSessionController } from '../controllers/ProjectSessionController';
import type { VoxelDocument, VoxelDocumentChangeDetail, VoxelProject } from '../model';
import type { VoxelSelection } from '../selection';
import { voxelEditorProductManifest } from './voxelEditorProductManifest';

export interface VoxelEditorProductMutation {
  readonly label: string;
  readonly project: VoxelProject;
}

export const voxelEditorPlatform = new EditorPlatform({
  history: { maxEntries: 100, byteBudget: 64 * 1024 * 1024 },
  diagnostic: diagnostic => console.warn(`[${diagnostic.code}] ${diagnostic.message}`, diagnostic.cause ?? ''),
});
export const voxelEditorShell = new BrowserEditorShell(voxelEditorPlatform.contributions);
const lazyPlugins = new EditorLazyPluginLoader(voxelEditorPlatform.plugins, voxelEditorProductManifest.lazyPlugins ?? []);
let started: Promise<void> | null = null;

export function startVoxelEditorPlatform(): Promise<void> {
  started ??= voxelEditorPlatform.start(voxelEditorProductManifest);
  return started;
}

export function loadVoxelEditorPlugin(id: string): Promise<void> {
  return lazyPlugins.load(id).then(state => {
    if (state.status !== 'active') throw state.diagnostic?.cause ?? new Error(`Voxel editor plugin ${id} is unavailable.`);
  });
}

export function createVoxelEditorProductAdapter(
  documentModel: VoxelDocument,
  revision: () => number,
): EditorProductAdapter<Readonly<{ revision: number; project: VoxelProject }>, VoxelEditorProductMutation, VoxelProject> {
  return Object.freeze({
    productId: 'haiyue.voxel-editor',
    documentKind: 'haiyue.voxel-project',
    snapshot: () => Object.freeze({ revision: revision(), project: documentModel.toJSON() }),
    prepare(mutation: VoxelEditorProductMutation, baseRevision: number, signal?: AbortSignal) {
      if (signal?.aborted) throw abortError();
      if (revision() !== baseRevision) throw new Error(`Voxel project revision changed from ${baseRevision} to ${revision()}.`);
      return structuredClone(mutation.project);
    },
    commit(prepared: VoxelProject, baseRevision: number) {
      if (revision() !== baseRevision) throw new Error('Voxel project revision changed before commit.');
      documentModel.load(prepared);
    },
  });
}

export function connectVoxelEditorPlatform(
  documentModel: VoxelDocument,
  selection: VoxelSelection,
  projectSession: ProjectSessionController,
): EditorDisposable {
  let revision = 0;
  let savedRevision = 0;
  const documentListeners = new Set<() => void>();
  const emitDocument = (): void => { for (const listener of [...documentListeners]) listener(); };

  voxelEditorPlatform.session.open('voxel.current', projectSession.projectName, revision);
  const onDocumentChange = (event: Event): void => {
    const detail = (event as CustomEvent<VoxelDocumentChangeDetail>).detail;
    if (!isPersistentChange(detail)) return;
    revision++;
    voxelEditorPlatform.session.updateDocumentRevision(revision);
    if (!projectSession.dirty) {
      savedRevision = revision;
      voxelEditorPlatform.session.markSaved(revision);
    }
    emitDocument();
  };
  documentModel.addEventListener('change', onDocumentChange);

  const unsubscribeSession = projectSession.subscribe(snapshot => {
    const platformSession = voxelEditorPlatform.session.snapshot();
    if (platformSession.name !== snapshot.projectName) {
      voxelEditorPlatform.session.open('voxel.current', snapshot.projectName, revision);
    }
    if (!snapshot.dirty) {
      savedRevision = revision;
      voxelEditorPlatform.session.markSaved(revision);
    }
    emitDocument();
  });

  const documentRegistration = voxelEditorPlatform.documents.attach({
    get identity() {
      return Object.freeze({ id: 'voxel.current', kind: 'haiyue.voxel-project', name: projectSession.projectName });
    },
    get revision() { return revision; },
    get savedRevision() { return projectSession.dirty ? savedRevision : revision; },
    serialize: signal => {
      if (signal?.aborted) throw abortError();
      return documentModel.toJSON();
    },
    markSaved: () => { void projectSession.save(); },
    subscribe(listener) {
      documentListeners.add(listener);
      return once(() => documentListeners.delete(listener));
    },
    dispose() { documentListeners.clear(); },
  });

  const syncSelection = (): void => {
    const references = [...selection.keys].map<EditorSelectionReference>(id => Object.freeze({
      kind: 'voxel.cell', id, documentId: 'voxel.current',
    }));
    voxelEditorPlatform.selection.set(references, references.at(-1) ?? null);
  };
  selection.addEventListener('change', syncSelection);
  syncSelection();

  return once(() => {
    selection.removeEventListener('change', syncSelection);
    unsubscribeSession();
    documentModel.removeEventListener('change', onDocumentChange);
    void documentRegistration.dispose();
  });
}

export function disposeVoxelEditorPlatform(): void {
  lazyPlugins.dispose();
  voxelEditorShell.dispose();
  void voxelEditorPlatform.dispose();
}

function isPersistentChange(detail: VoxelDocumentChangeDetail): boolean {
  return detail.reason !== 'color'
    && detail.reason !== 'edit-target'
    && detail.reason !== 'animation-select'
    && detail.reason !== 'animation-frame';
}

function abortError(): Error {
  const error = new Error('Voxel editor operation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function once(dispose: () => void): EditorDisposable {
  let active = true;
  return Object.freeze({ dispose() { if (active) { active = false; dispose(); } } });
}
