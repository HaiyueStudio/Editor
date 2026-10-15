import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageDocument, makeLayer } from '../dist/document.js';
import { copyPixels, pastePixels, sampleColor, gradientPixels, alignLayers, moveLayers, mergeLayers } from '../dist/dailyEditing.js';
import { transformedLayer } from '../dist/freeTransform.js';
import { compositeState } from '../dist/compositor.js';
import { serializeProject, deserializeProject } from '../dist/projectFile.js';
import { imageDocument } from '../dist/imageImport.js';
import { ImageWorkspace } from '../dist/workspace.js';
import { operationClient } from '../../scripts/editor-e2e/operationWorkflow.mjs';
const pixel = (name, x, y, color, width = 2, height = 2) => ({ ...makeLayer(name, { width, height, data: new Uint8ClampedArray(Array.from({ length: width * height }, () => color).flat()) }), x, y });
test('pixel copy owns cropped, feathered RGBA and paste is one reversible cross-document edit', () => {
  const source = ImageDocument.create('source', 4, 4), target = ImageDocument.create('target', 8, 8);
  source.addLayer(pixel('red', 1, 1, [255, 0, 0, 255])); source.setSelection({ x: 1, y: 1, width: 2, height: 1, mask: new Uint8Array([128, 0]) });
  const copy = copyPixels(source.state, source.selected.id), before = serializeProject(target.state);
  assert.deepEqual([...copy.bitmap.data], [255, 0, 0, 128, 255, 0, 0, 0]);
  const id = pastePixels(target, copy); copy.bitmap.data.fill(0);
  assert.equal(target.selected.id, id); assert.deepEqual(sampleColor(target.state, 1, 1), [255, 0, 0, 128]);
  target.history.undo(); assert.equal(serializeProject(target.state), before); target.history.redo(); assert.equal(target.selected.bitmap.data[3], 128);
  source.dispose(); target.dispose();
});
test('linear and radial gradients respect selection weights, offsets and do not mutate source buffers', () => {
  const doc = ImageDocument.create('gradient', 4, 2); doc.addLayer(pixel('off canvas', -1, 0, [0, 255, 0, 255], 6, 2));
  doc.setSelection({ x: 0, y: 0, width: 4, height: 1, mask: new Uint8Array([255, 128, 255, 0]) });
  const source = doc.selected.bitmap.data.slice();
  const layer = gradientPixels(doc.state, doc.selected.id, { x: .5, y: .5 }, { x: 2.5, y: .5 }, [0, 0, 0], [255, 255, 255], 'linear');
  assert.deepEqual([...layer.bitmap.data.slice(0, 8)], [0, 255, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual([...layer.bitmap.data.slice(12, 20)], [255, 255, 255, 255, 0, 255, 0, 255]);
  assert.deepEqual(doc.selected.bitmap.data, source);
  const radial = gradientPixels(doc.state, doc.selected.id, { x: .5, y: .5 }, { x: 2.5, y: .5 }, [0, 0, 0], [255, 255, 255], 'radial');
  assert.deepEqual(radial.bitmap.data, layer.bitmap.data); doc.dispose();
});
test('multi-selection aligns in canvas coordinates, prunes selected descendants and roundtrips', () => {
  const doc = ImageDocument.create('layers', 12, 10), child = pixel('child', 1, 1, [10, 20, 30, 255]), group = { ...makeLayer('group', null, 'group'), x: 2, y: 1, children: [child] }, other = pixel('other', 7, 7, [1, 2, 3, 255]);
  doc.addLayer(group, false); doc.addLayer(other, false); doc.selectMany([group.id, child.id, other.id]);
  const before = serializeProject(doc.state);
  alignLayers(doc, doc.selectedIds, 'left'); assert.equal(doc.state.layers.at(-1).x, 3);
  doc.history.undo(); assert.equal(serializeProject(doc.state), before);
  moveLayers(doc, doc.selectedIds, 2, 1); assert.equal(doc.state.layers[1].x, 4); assert.equal(doc.state.layers[1].children[0].x, 1);
  assert.deepEqual(deserializeProject(serializeProject(doc.state)).selectedIds, [group.id, child.id, other.id]);
  doc.updateLayer(other.id, { locked: true }); const locked = serializeProject(doc.state); assert.throws(() => alignLayers(doc, doc.selectedIds, 'right', 'canvas'), /锁定/); assert.equal(serializeProject(doc.state), locked); doc.dispose();
});
test('merging contiguous normal layers preserves composite, nested parent coordinates and undo', () => {
  const doc = ImageDocument.create('merge', 10, 10), a = pixel('a', -1, 0, [255, 0, 0, 255]), b = { ...pixel('b', 0, 1, [0, 0, 255, 200]), opacity: .5 }, group = { ...makeLayer('group', null, 'group'), x: 3, y: 2, children: [a, b] };
  doc.addLayer(group, false); doc.selectMany([a.id, b.id]); const before = serializeProject(doc.state), output = compositeState(doc.state);
  mergeLayers(doc, doc.selectedIds); assert.deepEqual(compositeState(doc.state), output); doc.history.undo(); assert.equal(serializeProject(doc.state), before);
  doc.updateLayer(b.id, { blend: 'multiply' }); assert.throws(() => mergeLayers(doc, [a.id, b.id]), /混合/); doc.dispose();
});
test('transform is prepared from immutable pixels and rejects content/masks and locked layers', () => {
  const doc = ImageDocument.create('transform', 8, 8); doc.addLayer(pixel('red', 1, 1, [255, 0, 0, 255], 2, 3)); const before = serializeProject(doc.state);
  const layer = transformedLayer(doc.state, doc.selected.id, { width: 4, height: 6, angle: 90, dx: 2, dy: 1 });
  assert.equal(layer.bitmap.width, 6); assert.equal(layer.bitmap.height, 4); assert.equal(serializeProject(doc.state), before);
  doc.replaceLayerPixels(layer.id, layer, 'transform'); doc.history.undo(); assert.equal(serializeProject(doc.state), before);
  doc.updateLayer(doc.selected.id, { locked: true }); assert.throws(() => transformedLayer(doc.state, doc.selected.id, { width: 2, height: 3, angle: 0, dx: 0, dy: 0 }), /锁定/); doc.dispose();
});
test('API pixel resources, sampling, gradients, transforms and masks use live revisions and reversible edits', async () => {
  const workspace = new ImageWorkspace(); await workspace.start();
  try {
    const opened = await operationClient(workspace.platform)('image.document.create', { name: 'agent', width: 8, height: 8 });
    const d = workspace.active, call = operationClient(workspace.platform, opened.documentId), id = d.selected.id;
    await call('image.pixels.fill', { layerId: id, color: '#ff0000' }); assert.deepEqual((await call('image.color.sample', { x: 1, y: 1 })).rgba, [255, 0, 0, 255]);
    await call('image.selection.wand', { x: 1, y: 1, tolerance: 0 }); assert.equal((await call('image.document.query')).selection.pixels, 64);
    await call('image.selection.polygon', { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }] });
    const copied = await call('image.pixels.copy', { layerId: id }); const pasted = await call('image.pixels.paste', { resourceId: copied.resourceId, width: copied.width, height: copied.height, x: 2, y: 2 }); assert.equal(d.selected.id, pasted.layerId);
    await call('image.selection.clear'); await call('image.pixels.gradient', { layerId: id, start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, from: '#000000', to: '#ffffff', kind: 'linear' });
    await call('image.mask.update', { layerId: id, action: 'fromSelection' }); await call('image.pixels.stroke', { layerId: id, target: 'mask', erase: true, points: [{ x: 4, y: 4 }], size: 2 });
    assert.ok(d.state.layers[0].mask.data.some(v => v < 255)); await call('image.mask.update', { layerId: id, action: 'remove' });
    await call('image.layer.transform', { layerId: id, width: 4, height: 4, angle: 90, dx: 1 }); assert.equal(d.state.layers[0].bitmap.width, 4);
    await call('image.history.undo'); assert.equal(d.state.layers[0].bitmap.width, 8);
    const before = serializeProject(d.state), history = d.history.snapshot();
    const failed = await workspace.platform.operations.execute({ apiVersion: '1', requestId: 'bad-paste', operation: 'image.pixels.paste', documentId: d.identity.id, expectedRevision: d.revision, params: { resourceId: copied.resourceId, width: 8, height: 8 } });
    assert.equal(failed.status, 'failed'); assert.equal(serializeProject(d.state), before); assert.deepEqual(d.history.snapshot(), history);
  } finally { await workspace.dispose(); }
});
test('API multi-layer transaction rolls back state, selection and redo after observer failure', async () => {
  const workspace = new ImageWorkspace(); await workspace.start();
  try { const d = ImageDocument.create('atomic', 8, 8); workspace.add(d); d.addLayer(pixel('a', 0, 0, [1, 2, 3, 255])); d.addLayer(pixel('b', 4, 4, [1, 2, 3, 255]));
    d.selectMany(d.state.layers.slice(1).map(l => l.id)); d.updateLayer(d.selected.id, { opacity: .5 }); d.history.undo();
    const before = serializeProject(d.state), history = d.history.snapshot(), sub = d.subscribe(() => { throw Error('observer'); });
    const result = await workspace.platform.operations.execute({ apiVersion: '1', requestId: 'atomic-merge', operation: 'image.layers.merge', documentId: d.identity.id, expectedRevision: d.revision, params: { layerIds: d.selectedIds } }); sub.dispose();
    assert.equal(result.status, 'failed'); assert.equal(serializeProject(d.state), before); assert.deepEqual(d.history.snapshot(), history);
  } finally { await workspace.dispose(); }
});

test('raster import establishes selection only from imported layers', () => {
  const doc = imageDocument('image', { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) });
  assert.deepEqual(doc.selectedIds, [doc.state.layers[0].id]); assert.equal(doc.selected.bitmap.data[0], 1); doc.dispose();
});
