import type { EditorDisposable, EditorJsonValue, EditorOperationContext, EditorOperationSchema } from '@haiyue/editor-plugin-sdk';
import type { ImageWorkspace } from './workspace.js';
import { ellipseSelection, invertSelection, selectionCount } from './selection.js';
import { FILTERS, filterLayer, type FilterKind } from './filters.js';
import { BLEND_MODES } from './layerFeatures.js';
import { allLayers, makeLayer, ImageDocument, type ImageLayer } from './document.js';
import { deserializeProject, serializeProject } from './projectFile.js';

const empty = { type: 'object', properties: {} } as const;
const string = { type: 'string', minLength: 1, maxLength: 160 } as const;
type Params = { readonly [key: string]: EditorJsonValue };

export function registerImageOperations(workspace: ImageWorkspace): EditorDisposable {
  const platform = workspace.platform, owned: EditorDisposable[] = [];
  const doc = (context: EditorOperationContext) => {
    const found = workspace.documents.find(item => item.identity.id === context.document?.id);
    if (!found) throw new Error('Image document is unavailable.');
    return found;
  };
  function register<T>(id: string, input: EditorOperationSchema, access: 'read' | 'write',
    prepare: (params: Params, context: EditorOperationContext) => T | Promise<T>, commit: (value: T) => EditorJsonValue) {
    owned.push(platform.operations.register({ ownerId: 'image.operations',
      descriptor: { id: `image.${id}`, version: 1, title: id, target: 'document', documentKinds: ['haiyue.image'], access, input, output: { type: 'json' } },
      prepare, commit,
      // Document commits use runAtomic and return bounded, fixed JSON; all failures restore there.
      rollback() {},
    }));
  }
  owned.push(platform.operations.register({ ownerId: 'image.operations',
    descriptor: { id: 'image.document.open', version: 1, title: 'Open image project or PSD', target: 'workspace', access: 'write',
      input: { type: 'object', properties: { resourceId: string, name: string, format: { type: 'string', enum: ['project', 'psd'] } }, required: ['resourceId', 'name', 'format'] }, output: { type: 'json' } },
    async prepare(params: Params) {
      const bytes = platform.resources.read(params.resourceId as string);
      let state;
      let warnings: string[] = [];
      if (params.format === 'psd') {
        const { importPsd } = await import('./psdAdapter.js');
        const result = importPsd(bytes, params.name as string);
        if (!result.layered || result.blockers.length) throw new Error(result.blockers.join(' ') || 'PSD cannot be opened losslessly.');
        state = result.layered; warnings = result.warnings;
      } else state = deserializeProject(new TextDecoder('utf-8', { fatal: true }).decode(bytes), true);
      return { document: new ImageDocument(state, true), warnings, previousActiveId: null as string | null };
    },
    commit(prepared) {
      prepared.previousActiveId = workspace.active?.identity.id ?? null;
      workspace.add(prepared.document);
      return { documentId: prepared.document.identity.id, revision: prepared.document.revision, warnings: prepared.warnings };
    },
    async rollback(prepared) {
      if (!prepared) return;
      const { document, previousActiveId } = prepared;
      if (workspace.documents.includes(document)) {
        try { await workspace.close(document.identity.id); }
        finally { if (previousActiveId && workspace.documents.some(item => item.identity.id === previousActiveId)) workspace.activate(previousActiveId); }
      } else document.dispose();
    },
  }));
  register('document.query', empty, 'read', (_, context) => doc(context), document => ({
    name: document.state.name, width: document.state.width, height: document.state.height, dirty: document.dirty,
    canUndo: document.history.canUndo, canRedo: document.history.canRedo,
    selection: document.state.selection ? { x: document.state.selection.x, y: document.state.selection.y, width: document.state.selection.width, height: document.state.selection.height, pixels: selectionCount(document.state.selection) } : null,
    layers: allLayers(document.state.layers).map(layer => ({ id: layer.id, name: layer.name, opacity: layer.opacity, visible: layer.visible, locked: layer.locked, kind: layer.kind, x: layer.x, y: layer.y, blend: layer.blend })),
  }));
  register('layer.opacity', { type: 'object', properties: { layerId: string, opacity: { type: 'number', minimum: 0, maximum: 1 } }, required: ['layerId', 'opacity'] }, 'write',
    (params, context) => ({ document: doc(context), layerId: params.layerId as string, opacity: params.opacity as number }),
    ({ document, layerId, opacity }) => document.runAtomic(() => { const revision = document.revision; document.updateLayer(layerId, { opacity }); return { applied: document.revision !== revision }; }));
  register('history.undo', empty, 'write', (_, context) => doc(context), document => document.runAtomic(() => ({ applied: document.history.undo() })));
  register('history.redo', empty, 'write', (_, context) => doc(context), document => document.runAtomic(() => ({ applied: document.history.redo() })));
  register('document.rename', { type: 'object', properties: { name: string }, required: ['name'] }, 'write',
    (params, context) => ({ document: doc(context), name: params.name as string }),
    ({ document, name }) => document.runAtomic(() => { document.rename(name); return { applied: true }; }));
  register('layer.create', { type: 'object', properties: { name: string, kind: { type: 'string', enum: ['pixel', 'group'] } }, required: ['name', 'kind'] }, 'write',
    (params, context) => ({ document: doc(context), layer: makeLayer(params.name as string, null, params.kind as 'pixel' | 'group') }),
    ({ document, layer }) => document.runAtomic(() => { document.addLayer(layer, false); return { layerId: layer.id }; }));
  register('layer.update', { type: 'object', properties: { layerId: string, patch: { type: 'object', properties: {
    name: string, visible: { type: 'boolean' }, locked: { type: 'boolean' }, opacity: { type: 'number', minimum: 0, maximum: 1 },
    blend: { type: 'string', enum: Object.keys(BLEND_MODES) }, x: { type: 'integer', minimum: -32768, maximum: 32768 }, y: { type: 'integer', minimum: -32768, maximum: 32768 },
  } } }, required: ['layerId', 'patch'] }, 'write',
    (params, context) => ({ document: doc(context), id: params.layerId as string, patch: params.patch as Partial<ImageLayer> }),
    ({ document, id, patch }) => document.runAtomic(() => { const revision = document.revision; document.updateLayer(id, patch); return { applied: revision !== document.revision }; }));
  register('filters.query', empty, 'read', () => null, () => Object.entries(FILTERS).map(([kind, settings]) => ({ kind, ...settings })));
  register('filter.apply', { type: 'object', properties: { layerId: string, kind: { type: 'string', enum: Object.keys(FILTERS) }, amount: { type: 'integer' } }, required: ['layerId', 'kind', 'amount'] }, 'write',
    (params, context) => { const document = doc(context), id = params.layerId as string;
      return { document, id, layer: filterLayer(document.state, id, { kind: params.kind as FilterKind, amount: params.amount as number }) }; },
    ({ document, id, layer }) => document.runAtomic(() => { document.replaceLayerPixels(id, layer, 'API: filter'); return { applied: true }; }));
  const position = { type: 'integer', minimum: 0, maximum: 8191 } as const, dimension = { type: 'integer', minimum: 1, maximum: 8192 } as const;
  register('selection.set', { type: 'object', properties: { shape: { type: 'string', enum: ['rectangle', 'ellipse'] }, x: position, y: position, width: dimension, height: dimension }, required: ['shape', 'x', 'y', 'width', 'height'] }, 'write',
    (params, context) => { const document = doc(context), rect = { x: params.x as number, y: params.y as number, width: params.width as number, height: params.height as number };
      if (rect.x + rect.width > document.state.width || rect.y + rect.height > document.state.height) throw new Error('Selection is outside the canvas.');
      return { document, selection: params.shape === 'ellipse' ? ellipseSelection(rect) : rect }; },
    ({ document, selection }) => document.runAtomic(() => { document.setSelection(selection); return { applied: true }; }));
  register('selection.invert', empty, 'write', (_, context) => { const document = doc(context); return { document, selection: invertSelection(document.state.selection, document.state.width, document.state.height) }; },
    ({ document, selection }) => document.runAtomic(() => { document.setSelection(selection); return { applied: true }; }));
  register('selection.clear', empty, 'write', (_, context) => doc(context), document => document.runAtomic(() => { document.setSelection(null); return { applied: true }; }));
  register('document.crop', empty, 'write', (_, context) => doc(context), document => document.runAtomic(() => { document.cropToSelection(); return { applied: true }; }));
  register('document.export', { type: 'object', properties: { format: { type: 'string', enum: ['project', 'psd'] } }, required: ['format'] }, 'read',
    async (params, context) => {
      const snapshot = structuredClone(doc(context).state);
      const bytes = params.format === 'psd'
        ? (await import('./psdAdapter.js')).exportPsd(snapshot).bytes
        : new TextEncoder().encode(serializeProject(snapshot));
      return { bytes, format: params.format as string };
    }, ({ bytes, format }) => ({ ...platform.resources.put(bytes), format }));
  return { async dispose() { await Promise.all(owned.map(item => item.dispose())); } };
}
