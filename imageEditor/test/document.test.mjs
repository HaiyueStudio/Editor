import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageDocument, makeLayer, allLayers } from '../dist/document.js';
import { serializeProject, deserializeProject } from '../dist/projectFile.js';
import { ImageWorkspace } from '../dist/workspace.js';
import { RecoveryQueue } from '../dist/recovery.js';
import { inspectImageSize } from '../dist/imageImport.js';
import { readFileSync } from 'node:fs';

const bitmap = () => ({ width: 2, height: 2, data: new Uint8ClampedArray([20, 50, 90, 128, 1, 2, 3, 0, 250, 100, 40, 255, 60, 90, 130, 1]) });
test('PNG/JPEG dimensions are admitted before browser decompression', () => {
  const png = readFileSync(new URL('./fixtures/p1/import.png', import.meta.url));
  assert.deepEqual(inspectImageSize(png), { width: 4, height: 4 });
  assert.deepEqual(inspectImageSize(readFileSync(new URL('./fixtures/p1/import.jpg', import.meta.url))), { width: 6, height: 5 });
  const oversized = Buffer.from(png); oversized.writeUInt32BE(100000, 16); assert.throws(() => inspectImageSize(oversized), /尺寸/);
  assert.throws(() => inspectImageSize(png.subarray(0, 12)), /损坏/);
});
test('pixel ownership, grouped duplicate and undo restore complete state', () => {
  const doc = ImageDocument.create('工作区', 64, 64), group = makeLayer('组', null, 'group');
  doc.addLayer(group); const pixels = bitmap(); doc.addLayer(makeLayer('图片', pixels));
  pixels.data.fill(0); assert.equal(doc.selected.bitmap.data[0], 20);
  const before = doc.state; doc.duplicateSelected();
  assert.equal(doc.state.layers[1].children.length, 2);
  assert.notEqual(doc.state.layers[1].children[0].id, doc.state.layers[1].children[1].id);
  assert.notEqual(doc.state.layers[1].children[0].bitmap.data, doc.state.layers[1].children[1].bitmap.data);
  doc.history.undo(); assert.equal(doc.state, before);
  doc.history.redo(); assert.equal(doc.state.layers[1].children.length, 2); doc.dispose();
});
test('saved revision survives undo/redo and branching without false clean state', () => {
  const doc = ImageDocument.create('历史', 32, 32); doc.markSaved(); const clean = doc.state;
  doc.updateLayer(doc.selected.id, { opacity: 0.5 }); assert.equal(doc.dirty, true);
  doc.history.undo(); assert.equal(doc.state, clean); assert.equal(doc.dirty, false);
  doc.history.redo(); doc.markSaved(); const saved = doc.revision;
  doc.history.undo(); assert.equal(doc.dirty, true);
  doc.updateLayer(doc.selected.id, { name: '分支' }); assert(doc.revision > saved); assert.equal(doc.dirty, true); assert.equal(doc.history.canRedo, false); doc.dispose();
});
test('selection is not an edit; locked ancestor prevents destructive changes atomically', () => {
  const doc = ImageDocument.create('锁定', 32, 32); doc.addLayer(makeLayer('组', null, 'group')); const group = doc.selected;
  doc.addLayer(makeLayer('子图层')); const child = doc.selected;
  doc.updateLayer(group.id, { locked: true }); doc.markSaved(); const revision = doc.revision;
  doc.select(child.id); assert.equal(doc.dirty, false); assert.equal(doc.revision, revision);
  const before = doc.state, history = doc.history.snapshot();
  assert.throws(() => doc.deleteSelected(), /锁定/);
  assert.throws(() => doc.updateLayer(child.id, { x: 20 }), /锁定/);
  assert.equal(doc.state, before); assert.deepEqual(doc.history.snapshot(), history);
  doc.updateLayer(child.id, { visible: false }); assert.equal(doc.selected.visible, false); doc.dispose();
});
test('invalid mutation does not alter state, selection, revision or history', () => {
  const doc = ImageDocument.create('校验', 64, 64); const before = doc.state, history = doc.history.snapshot();
  assert.throws(() => doc.updateLayer(doc.selected.id, { opacity: 2 }), /参数/);
  assert.throws(() => doc.addLayer(makeLayer('损坏像素', { width: 2, height: 2, data: new Uint8ClampedArray(3) })), /不完整/);
  assert.equal(doc.state, before); assert.deepEqual(doc.history.snapshot(), history); doc.dispose();
});
test('layer order and deletion restore exact sibling tree on undo', () => {
  const doc = ImageDocument.create('顺序', 64, 64); doc.addLayer(makeLayer('2')); doc.addLayer(makeLayer('3'));
  doc.reorder(-1); assert.deepEqual(doc.state.layers.map(l => l.name), ['图层 1', '3', '2']);
  const before = doc.state; doc.deleteSelected(); assert.deepEqual(doc.state.layers.map(l => l.name), ['图层 1', '2']);
  doc.history.undo(); assert.equal(doc.state, before); doc.dispose();
});
test('project format roundtrip preserves hidden RGB, groups and editable properties', () => {
  const doc = ImageDocument.create('可恢复工程', 64, 64); doc.addLayer(makeLayer('组', null, 'group')); doc.addLayer(makeLayer('像素', bitmap()));
  doc.updateLayer(doc.selected.id, { x: -5, y: 13, visible: false, blend: 'screen', opacity: 0.37 });
  const source = serializeProject(doc.state), reopened = deserializeProject(source);
  assert.deepEqual(reopened.layers, doc.state.layers); assert.equal(reopened.selectedId, doc.state.selectedId);
  assert.notEqual(deserializeProject(source, true).id, doc.state.id);
  assert.equal(allLayers(reopened.layers)[2].bitmap.data[4], 1); doc.dispose();
});
test('malformed projects reject invalid versions, bytes, IDs and dimensions', () => {
  const doc = ImageDocument.create('防损坏', 64, 64); doc.addLayer(makeLayer('像素', bitmap())); const base = JSON.parse(serializeProject(doc.state));
  for (const mutate of [p => { p.version = 99; }, p => { p.document.width = 1000000; }, p => { p.document.layers[1].id = p.document.layers[0].id; }, p => { p.document.layers[1].bitmap.rgba = 'AAAA'; }, p => { p.document.selectedId = 'missing'; }]) {
    const value = structuredClone(base); mutate(value); assert.throws(() => deserializeProject(JSON.stringify(value)));
  }
  doc.dispose();
});
test('multi-document host isolates histories and restores active/dirty state atomically', async () => {
  const workspace = new ImageWorkspace(); await workspace.start();
  const a = ImageDocument.create('A', 64, 64), b = ImageDocument.create('B', 100, 100); a.markSaved();
  workspace.add(a); workspace.add(b); b.updateLayer(b.selected.id, { name: 'B 图层' }); workspace.activate(a.identity.id);
  assert.equal(a.history.canUndo, false); assert.equal(workspace.active, a); assert.equal(workspace.dirty, true);
  const session = workspace.session(), restored = new ImageWorkspace(); await restored.start(); restored.restore(session);
  assert.equal(restored.active.identity.name, 'A'); assert.equal(restored.documents[0].dirty, false); assert.equal(restored.documents[1].dirty, true);
  const invalid = new ImageWorkspace(); await invalid.start();
  assert.throws(() => invalid.restore({ ...session, documents: [session.documents[0], { project: '{}', dirty: true }] })); assert.equal(invalid.documents.length, 0);
  await workspace.close(a.identity.id); assert.equal(workspace.active, b);
  await Promise.all([workspace.dispose(), restored.dispose(), invalid.dispose()]);
});
test('recovery writes are ordered and retry after a failed transaction', async () => {
  const events = []; let release;
  const store = { load: async () => undefined, close: () => events.push('close'), save: async session => {
    events.push('start:' + session.activeId);
    if (session.activeId === 'A') await new Promise(resolve => { release = resolve; });
    if (session.activeId === 'bad') throw new Error('QuotaExceededError');
    events.push('end:' + session.activeId);
  } };
  const queue = new RecoveryQueue(store), a = queue.write({ version: 1, activeId: 'A', documents: [] }), b = queue.write({ version: 1, activeId: 'B', documents: [] });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(events, ['start:A']); release(); await Promise.all([a, b]);
  await assert.rejects(queue.write({ version: 1, activeId: 'bad', documents: [] }), /Quota/);
  await queue.write({ version: 1, activeId: 'C', documents: [] }); await queue.dispose();
  assert.deepEqual(events, ['start:A', 'end:A', 'start:B', 'end:B', 'start:bad', 'start:C', 'end:C', 'close']);
});
