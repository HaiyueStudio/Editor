import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageWorkspace } from '../dist/workspace.js';
import { ImageDocument } from '../dist/document.js';
import { serializeProject, deserializeProject } from '../dist/projectFile.js';
import { exportPsd, importPsd } from '../dist/psdAdapter.js';
import { operationClient, textResource, readText } from '../../scripts/editor-e2e/operationWorkflow.mjs';

for (const format of ['project', 'psd']) test(`image ${format}: open/query/edit/undo/export uses live document`, async () => {
  const workspace = new ImageWorkspace(); await workspace.start();
  try {
    const source = ImageDocument.create('API image', 2, 2, true);
    const resourceId = format === 'psd' ? workspace.platform.resources.put(exportPsd(source.state).bytes).resourceId : textResource(workspace.platform, serializeProject(source.state));
    const opened = await operationClient(workspace.platform)('image.document.open', { resourceId, format, name: 'test.psd' });
    const call = operationClient(workspace.platform, opened.documentId), live = workspace.active;
    const query = await call('image.document.query');
    assert.equal(query.dirty, false); assert.equal(query.layers.length, 1);
    const before = serializeProject(live.state), history = live.history.snapshot();
    await call('image.layer.opacity', { layerId: query.layers[0].id, opacity: 0.25 });
    assert.equal(live.state.layers[0].opacity, 0.25); assert.equal(live.dirty, true);
    const edited = await call('image.document.export', { format: 'psd' });
    assert.ok(Math.abs(importPsd(workspace.platform.resources.read(edited.resourceId), 'out.psd').layered.layers[0].opacity - 0.25) < 0.004);
    await call('image.history.undo');
    assert.equal(serializeProject(live.state), before); assert.equal(live.dirty, false);
    const restored = await call('image.document.export', { format: 'project' });
    assert.deepEqual(JSON.parse(serializeProject(deserializeProject(readText(workspace.platform, restored)))), JSON.parse(before));
    assert.equal(live.history.snapshot().entries.length, history.entries.length);
    const failed = await workspace.platform.operations.execute({ apiVersion: '1', requestId: 'stale', operation: 'image.layer.opacity', documentId: opened.documentId, expectedRevision: 9999, params: { layerId: query.layers[0].id, opacity: 0.1 } });
    assert.equal(failed.error.code, 'REVISION_CONFLICT'); assert.equal(serializeProject(live.state), before);
    source.dispose();
  } finally { await workspace.dispose(); }
  assert.equal(workspace.platform.operations.list().length, 0);
});

test('image failed commit preserves document and redo stack', async () => {
  const workspace = new ImageWorkspace(); await workspace.start();
  try {
    const doc = ImageDocument.create('Atomic', 2, 2, true); workspace.add(doc);
    doc.updateLayer(doc.selected.id, { opacity: 0.5 }); doc.history.undo();
    const before = serializeProject(doc.state), history = doc.history.snapshot();
    const sub = doc.subscribe(() => { throw new Error('injected observer failure'); });
    const result = await workspace.platform.operations.execute({ apiVersion: '1', requestId: 'fault', operation: 'image.layer.opacity', documentId: doc.identity.id, expectedRevision: doc.revision, params: { layerId: doc.selected.id, opacity: 0.2 } });
    sub.dispose();
    assert.equal(result.status, 'failed'); assert.equal(serializeProject(doc.state), before);
    assert.deepEqual(doc.history.snapshot(), history);
    doc.history.redo(); assert.equal(doc.selected.opacity, 0.5);
  } finally { await workspace.dispose(); }
});

test('failed image open restores the previously active document', async () => {
  const workspace = new ImageWorkspace(); await workspace.start();
  const first = ImageDocument.create('First', 2, 2), second = ImageDocument.create('Second', 2, 2);
  workspace.add(first); workspace.add(second);
  const source = textResource(workspace.platform, serializeProject(first.state));
  const unsubscribe = workspace.subscribe(() => { if (workspace.documents.length === 3) throw Error('reject new document'); });
  try {
    const result = await workspace.platform.operations.execute({ apiVersion: '1', requestId: 'open-fault', operation: 'image.document.open', params: { resourceId: source, name: 'test.hyimage', format: 'project' } });
    assert.equal(result.status, 'failed'); assert.equal(workspace.active, second); assert.equal(workspace.documents.length, 2);
  } finally { unsubscribe(); await workspace.dispose(); }
});

test('image domain commands apply filters only within selection and undo/redo actual pixels', async () => {
  const workspace = new ImageWorkspace(); await workspace.start();
  try {
    const doc = ImageDocument.create('Filters', 4, 4, true); workspace.add(doc);
    const call = operationClient(workspace.platform, doc.identity.id), layerId = doc.selected.id;
    const before = serializeProject(doc.state);
    await call('image.selection.set', { shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 });
    await call('image.filter.apply', { layerId, kind: 'invert', amount: 100 });
    assert.deepEqual([...doc.selected.bitmap.data.slice(0, 8)], [0, 0, 0, 255, 255, 255, 255, 255]);
    await call('image.history.undo'); assert.equal(doc.selected.bitmap.data[0], 255);
    await call('image.history.redo'); assert.equal(doc.selected.bitmap.data[0], 0);
    await call('image.selection.invert'); assert.equal((await call('image.document.query')).selection.pixels, 15);
    await call('image.selection.clear'); assert.equal(doc.state.selection, null);
    const created = await call('image.layer.create', { name: 'Group', kind: 'group' });
    await call('image.layer.update', { layerId: created.layerId, patch: { visible: false, name: 'Renamed' } });
    assert.ok((await call('image.document.query')).layers.some(layer => layer.id === created.layerId && layer.name === 'Renamed' && !layer.visible));
    await call('image.document.rename', { name: 'Result' }); assert.equal(doc.state.name, 'Result');
    await call('image.selection.set', { shape: 'ellipse', x: 1, y: 1, width: 2, height: 2 });
    await call('image.document.crop'); assert.equal(doc.state.width, 2);
    while (doc.history.canUndo) await call('image.history.undo'); assert.equal(serializeProject(doc.state), before);
  } finally { await workspace.dispose(); }
});
