import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorPlatform } from '@haiyue/editor-platform';
import { VoxelDocument } from '../dist/model.js';
import { registerVoxelEditorOperations } from '../dist/operations.js';
import { parseMagicaVoxel } from '../dist/vox-importer.js';
import { operationClient, textResource, readText } from '../../scripts/editor-e2e/operationWorkflow.mjs';

test('voxel open/query/edit/undo/export shares domain/history and emits real VOX', async () => {
  const platform = new EditorPlatform(), document = new VoxelDocument({ x: 4, y: 4, z: 4 });
  const priorLayer = document.createLayer('Prior layer'); document.setActiveVoxelLayer(priorLayer.id);
  let revision = 0;
  document.addEventListener('change', () => revision++);
  platform.documents.attach({ identity: { id: 'voxel.current', kind: 'haiyue.voxel-project', name: 'test' },
    get revision() { return revision; }, savedRevision: 0, serialize: () => document.toJSON(), markSaved() {},
    subscribe(listener) { document.addEventListener('change', listener); return { dispose: () => document.removeEventListener('change', listener) }; }, dispose() {} });
  const bindings = registerVoxelEditorOperations(platform, document), call = operationClient(platform, 'voxel.current');
  try {
    const source = new VoxelDocument({ x: 8, y: 8, z: 8 }); source.setVoxel(1, 2, 3, '#ff0000');
    await call('voxel.document.open', { resourceId: textResource(platform, JSON.stringify(source.toJSON())) });
    const before = document.toJSON(), query = await call('voxel.document.query');
    assert.equal(query.voxelCount, 1);
    await call('voxel.cell.set', { x: 1, y: 2, z: 3, color: '#123456' });
    assert.equal(document.get(1, 2, 3).color, '#123456');
    const edited = await call('voxel.document.export', { format: 'vox' });
    assert.ok(parseMagicaVoxel(platform.resources.read(edited.resourceId)));
    await call('voxel.history.undo'); assert.deepEqual(document.toJSON(), before);
    const exported = await call('voxel.document.export', { format: 'project' });
    assert.deepEqual(JSON.parse(readText(platform, exported)), JSON.parse(JSON.stringify(before)));
    const created = await call('voxel.layer.create', { name: 'Batch' });
    await call('voxel.cells.patch', { cells: [
      { x: 1, y: 2, z: 3, action: 'remove' },
      { x: 3, y: 3, z: 3, action: 'set', color: '#abcdef', layerId: created.layerId },
    ] });
    assert.equal(document.get(1, 2, 3), undefined); assert.equal(document.get(3, 3, 3).layerId, created.layerId);
    const patched = document.toJSON(), entries = platform.history.snapshot();
    const invalidBatch = await platform.operations.execute({ apiVersion: '1', requestId: 'bad-batch', operation: 'voxel.cells.patch', documentId: 'voxel.current', expectedRevision: revision, params: { cells: [
      { x: 4, y: 4, z: 4, action: 'set', color: '#112233' }, { x: 99, y: 0, z: 0, action: 'remove' },
    ] } });
    assert.equal(invalidBatch.status, 'failed'); assert.deepEqual(document.toJSON(), patched); assert.deepEqual(platform.history.snapshot(), entries);
    await call('voxel.history.undo'); assert.equal(document.get(1, 2, 3).color, '#ff0000');
    await call('voxel.history.redo'); assert.deepEqual(document.toJSON(), patched);
    await call('voxel.layer.update', { layerId: created.layerId, patch: { locked: true } });
    assert.equal(document.getLayer(created.layerId).locked, true);
    for (let i = 0; i < 3; i++) await call('voxel.history.undo');
    assert.deepEqual(document.toJSON(), before);
    const history = platform.history.snapshot();
    const subscription = platform.history.subscribe(() => { throw new Error('history observer failure'); });
    const bad = await platform.operations.execute({ apiVersion: '1', requestId: 'fault', operation: 'voxel.cell.set', documentId: 'voxel.current', expectedRevision: revision, params: { x: 2, y: 2, z: 3, color: '#abcdef' } });
    subscription.dispose(); assert.equal(bad.status, 'failed'); assert.deepEqual(document.toJSON(), before); assert.deepEqual(platform.history.snapshot(), history);
    await call('voxel.history.undo'); assert.deepEqual(document.size, { x: 4, y: 4, z: 4 }); assert.equal(document.activeVoxelLayerId, priorLayer.id);
  } finally { await bindings.dispose(); await platform.dispose(); }
});
