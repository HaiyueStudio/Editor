import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageDocument, makeLayer } from '../dist/document.js';
import { RecoveryCodec, decodeRecovery, RECOVERY_CHUNK_BYTES } from '../dist/recoveryCodec.js';
import { RecoveryQueue } from '../dist/recovery.js';
import { ImageWorkspace } from '../dist/workspace.js';
import { serializeProject } from '../dist/projectFile.js';

function session(doc) { return { version: 2, activeId: doc.identity.id, documents: [{ state: doc.state, dirty: true }] }; }
test('binary recovery deduplicates chunks, retains masks, rejects corruption and re-encodes after failed writes', async () => {
  const doc = ImageDocument.create('chunks', 512, 512, true), codec = new RecoveryCodec();
  doc.setSelection({ x: 0, y: 0, width: 2, height: 2, mask: new Uint8Array([0, 64, 128, 255]) });
  const first = await codec.encode(session(doc), new Set()); assert.equal(first.chunks.size, 2);
  assert.equal(first.session.documents[0].state.layers[0].bitmap.data.chunks.length, 4);
  const restored = await decodeRecovery(first.session, first.chunks); assert.deepEqual(restored, session(doc));
  const second = await codec.encode(session(doc), first.used); assert.equal(second.chunks.size, 0);
  const retry = await codec.encode(session(doc), new Set()); assert.equal(retry.chunks.size, 2);
  const pixels = doc.selected.bitmap.data.slice(); pixels[17] = 5;
  doc.replaceLayerPixels(doc.selected.id, { ...doc.selected, bitmap: { ...doc.selected.bitmap, data: pixels } }, 'one pixel');
  const next = await codec.encode(session(doc), first.used); assert.equal(next.chunks.size, 1); assert.equal([...next.chunks.values()][0].length, RECOVERY_CHUNK_BYTES);
  await assert.rejects(decodeRecovery(first.session, new Map()), /缺失/);
  const corrupt = new Map(first.chunks); const [key, data] = corrupt.entries().next().value; const bad = data.slice(); bad[0] ^= 1; corrupt.set(key, bad);
  await assert.rejects(decodeRecovery(first.session, corrupt), /校验/);
  const oversized = structuredClone(first.session); oversized.documents[0].state.layers[0].bitmap.width = 900000;
  await assert.rejects(decodeRecovery(oversized, first.chunks), /尺寸/); doc.dispose();
});
test('legacy recovery migrates without losing clean/dirty state', async () => {
  const doc = ImageDocument.create('legacy', 4, 4, true), workspace = new ImageWorkspace(); await workspace.start();
  assert.equal(workspace.restore({ version: 1, activeId: doc.identity.id, documents: [{ project: serializeProject(doc.state), dirty: false }] }), 1);
  assert.equal(workspace.active.dirty, false); assert.equal(workspace.session().version, 2); await workspace.dispose(); doc.dispose();
});
test('burst recovery coalesces pending work and disposal rejects new writes', async () => {
  const events = []; let release;
  const store = { load: async () => undefined, close: () => events.push('closed'), save: async session => {
    events.push(session.activeId); if (session.activeId === 'first') await new Promise(resolve => { release = resolve; });
  } };
  const queue = new RecoveryQueue(store), writes = ['first','obsolete','latest'].map(activeId => queue.write({version:1,activeId,documents:[]}));
  await new Promise(resolve => setImmediate(resolve)); release(); await Promise.all(writes); await queue.dispose(); assert.deepEqual(events, ['first','latest','closed']);
  await assert.rejects(queue.write({version:1,activeId:null,documents:[]}), /关闭/);
});
test('small pixel edits use tile history, survive branching and preserve hidden RGB', () => {
  const doc = ImageDocument.create('tiles', 1024, 1024, true); const initial = doc.selected.bitmap.data.slice();
  for (let n = 0; n < 20; n++) {
    const pixels = doc.selected.bitmap.data.slice(); pixels[n * 4] = n; pixels[n * 4 + 3] = 0;
    doc.replaceLayerPixels(doc.selected.id, { ...doc.selected, bitmap: { ...doc.selected.bitmap, data: pixels } }, 'stroke');
  }
  assert.equal(doc.history.snapshot().entries.length, 20); assert(doc.history.snapshot().estimatedBytes < 2 * 1024 * 1024);
  for (let i = 0; i < 20; i++) doc.history.undo(); assert.deepEqual(doc.selected.bitmap.data, initial);
  for (let i = 0; i < 20; i++) doc.history.redo(); assert.equal(doc.selected.bitmap.data[19*4],19); assert.equal(doc.selected.bitmap.data[19*4+3],0);
  doc.history.undo(); doc.updateLayer(doc.selected.id,{name:'branch'}); assert.equal(doc.history.canRedo,false);
  doc.dispose(); assert.equal(doc.state.layers.length,0); assert.equal(doc.history.snapshot().estimatedBytes,0);
});
test('dimension-changing edits and tile-edge pixels roundtrip with metadata edits', () => {
  const doc = ImageDocument.create('edges',257,131,true); const original=doc.selected.bitmap.data.slice();
  const pixels=original.slice(); for(const x of [127,128,256]) pixels[(130*257+x)*4]=11;
  doc.replaceLayerPixels(doc.selected.id,{...doc.selected,bitmap:{...doc.selected.bitmap,data:pixels}},'edges');
  doc.updateLayer(doc.selected.id,{x:-10,opacity:.5}); doc.history.undo(); doc.history.undo(); assert.deepEqual(doc.selected.bitmap.data,original);
  doc.history.redo(); assert.deepEqual(doc.selected.bitmap.data,pixels);
  doc.replaceLayerPixels(doc.selected.id,{...doc.selected,bitmap:{width:1,height:1,data:new Uint8ClampedArray([1,2,3,0])}},'resize');
  doc.history.undo(); assert.deepEqual(doc.selected.bitmap.data,pixels); doc.history.redo(); assert.equal(doc.selected.bitmap.width,1); doc.dispose();
});
test('partial pixel commits only admit owned pixels inside the supplied region',()=>{
 const doc=ImageDocument.create('partial',256,256,true),data=new Uint8ClampedArray(256*256*4);
 doc.replaceLayerPixels(doc.selected.id,{...doc.selected,bitmap:{width:256,height:256,data}},'partial',doc.revision,{x:120,y:120,width:20,height:20});
 assert.equal(doc.selected.bitmap.data[(125*256+125)*4],0);assert.equal(doc.selected.bitmap.data[0],255);
 data.fill(80);assert.equal(doc.selected.bitmap.data[(125*256+125)*4],0);
 doc.history.undo();assert(doc.selected.bitmap.data.every(v=>v===255));doc.history.redo();assert.equal(doc.selected.bitmap.data[0],255);
 const before=doc.state;assert.throws(()=>doc.replaceLayerPixels(doc.selected.id,doc.selected,'bad',doc.revision,{x:-1,y:0,width:20,height:20}),/范围/);assert.equal(doc.state,before);doc.dispose();
});
test('metadata history counts shared pixel buffers once per command',()=>{
 const doc=ImageDocument.create('metadata',1024,1024,true);doc.updateLayer(doc.selected.id,{opacity:.5});
 assert.equal(doc.history.snapshot().estimatedBytes,1024*1024*4+1024);doc.dispose();
});
