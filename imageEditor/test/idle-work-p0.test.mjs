import test from 'node:test';
import assert from 'node:assert/strict';
import { previewFingerprint } from '../dist/previewCache.js';
import { sameRenderState } from '../dist/renderInputs.js';
import { documentDamage } from '../dist/renderDamage.js';
import { CanvasView, paintThumbnail } from '../dist/canvasView.js';
import { ImageDocument, makeLayer } from '../dist/document.js';
import { ThumbnailQueue } from '../dist/thumbnailQueue.js';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const b = { width: 3, height: 2, data: new Uint8ClampedArray(24).fill(255) };
  const l = { ...makeLayer('pixels', b), mask: { x: 0, y: 0, width: 3, height: 2, disabled: false, defaultColor: 255, data: new Uint8Array(6).fill(255) } };
  return { id: 'p0', name: 'P0', width: 9001, height: 257, bitDepth: 8, layers: [l], selectedId: l.id, revision: 1 };
}

test('render/cache inputs ignore editing metadata but retain all visual changes and undo branches', async () => {
  const state = fixture(), l = state.layers[0], key = await previewFingerprint(state, 'sdr');
  for (const patch of [{ name: 'renamed' }, { locked: true }, { locks: { pixels: true } }, { nativePsd: { id: 9, contentKey: 'x', stylesKey: 'y' } }]) {
    const next = { ...state, revision: 20, selectedId: null, layers: [{ ...l, ...patch, mask: { ...l.mask } }] };
    assert(sameRenderState(state, next));
    assert.equal(await previewFingerprint(next, 'sdr'), key);
    assert.equal(documentDamage(state, next).width, 0);
  }
  for (const patch of [{ opacity: .5 }, { visible: false }, { x: 1 }, { blend: 'multiply' }, { fillOpacity: .4 },
    { advancedBlend: { channels: { red: false } } }, { mask: { ...l.mask, density: .4 } },
    { bitmap: { ...l.bitmap, data: new Uint8ClampedArray(24) } },
    { content: { type: 'adjustment', filter: 'brightness', amount: 12 } }]) {
    const next = { ...state, layers: [{ ...l, ...patch }] };
    assert(!sameRenderState(state, next), JSON.stringify(patch));
    assert.notEqual(await previewFingerprint(next, 'sdr'), key);
  }
  for (const patch of [{ width: 9002 }, { height: 258 }, { bitDepth: 16 }, { colorMode: 'cmyk' },
    { display: { exposure: 1, operator: 'clip' } }, { icc: { intent: 2 } },
    { psdOrigin: { resources: new Uint8Array([1]), sourceName: 'x', flattened: false } }]) {
    assert(!sameRenderState(state, { ...state, ...patch }));
    assert.notEqual(await previewFingerprint({ ...state, ...patch }, 'sdr'), key);
  }
  assert.equal(await previewFingerprint({ ...state, id: 'other', name: 'other', revision: 90, selectedId: null }, 'sdr'), key);
  assert.notEqual(await previewFingerprint(state, 'hdr'), key);
});

test('actual document metadata commits preserve rendering, including frozen effect metadata', () => {
  const state = fixture(), doc = new ImageDocument(state), before = doc.state;
  doc.updateLayer(doc.selected.id, { name: 'new name' });
  assert(sameRenderState(before, doc.state));
  doc.updateLayer(doc.selected.id, { locked: true });
  assert(sameRenderState(before, doc.state));
  doc.history.undo(); doc.history.undo();
  assert(sameRenderState(before, doc.state));
  doc.dispose();
});

test('selection and metadata updates schedule no canvas work; pixel changes and viewport movement still paint', () => {
  const before = fixture(), view = Object.create(CanvasView.prototype), paints = [], scheduled = [];
  const originals = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = fn => { scheduled.push(fn); return scheduled.length; };
  globalThis.cancelAnimationFrame = () => {};
  Object.assign(view, { state: before, renderedKey: 'p0:1', cameras: new Map([['p0', { zoom: 1, x: 0, y: 0 }]]), artboard: { style: {} }, changed() {}, paint: s => paints.push(s) });
  try {
    for (const patch of [{ selectedId: null }, { revision: 2, name: 'Renamed' },
      { revision: 3, layers: [{ ...before.layers[0], name: 'New label', locked: true, mask: { ...before.layers[0].mask } }] }]) view.setDocument({ ...before, ...patch });
    assert.equal(paints.length, 0); assert.equal(scheduled.length, 0);
    view.zoom(.5); assert.equal(scheduled.length, 1); scheduled[0](); assert.equal(paints.length, 1);
    view.setDocument({ ...before, revision: 4, layers: [{ ...before.layers[0], opacity: .5 }] });
    assert.equal(paints.length, 2);
    view.setDocument({ ...before, revision: 5, width: 9002 }); assert.equal(paints.length, 3);
  } finally { [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = originals; }
});

test('shared thumbnail requests cancel only after the last consumer leaves; queued cancellations never compute', async () => {
  const started = [], pending = new Map(), stopped = [];
  const queue = new ThumbnailQueue((key, signal) => new Promise((resolve, reject) => {
    started.push(key); pending.set(key, resolve);
    signal.addEventListener('abort', () => { stopped.push(key); reject(signal.reason); }, { once: true });
  }));
  const a = {}, b = {}, first = new AbortController(), second = new AbortController(), queued = new AbortController();
  const p1 = queue.read(a, first.signal), p2 = queue.read(a, second.signal), p3 = queue.read(b, queued.signal);
  const r1 = assert.rejects(p1, { name: 'AbortError' }), r3 = assert.rejects(p3, { name: 'AbortError' });
  first.abort(); queued.abort(); await Promise.all([r1, r3]);
  assert.deepEqual(started, [a]); assert.equal(stopped.length, 0);
  pending.get(a)('ready'); assert.equal(await p2, 'ready');
  assert.equal(await queue.read(a), 'ready'); assert.deepEqual(started, [a]);
  const cancel = new AbortController(), p4 = queue.read(b, cancel.signal), r4 = assert.rejects(p4, { name: 'AbortError' });
  cancel.abort(); await r4; await turn(); assert.deepEqual(stopped, [b]);
  const retry = queue.read(b); pending.get(b)('retry'); assert.equal(await retry, 'retry');
});

test('cancelling a large thumbnail actually terminates its Worker and allows a fresh request', async () => {
  const originalWorker = globalThis.Worker, originalDocument = globalThis.document;
  let started = 0, terminated = 0;
  globalThis.Worker = class { constructor() { started++; } postMessage() {} terminate() { terminated++; } };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() {} }) }) };
  const b = { width: 9001, height: 1, data: new Uint8ClampedArray(9001 * 4) }, canvas = document.createElement('canvas');
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController(), job = paintThumbnail(canvas, b, controller.signal);
      const rejected = assert.rejects(job, { name: 'AbortError' });
      for (let i = 0; started < attempt && i < 100; i++) await turn();
      assert.equal(started, attempt); controller.abort(); await rejected;
      for (let i = 0; terminated < attempt && i < 100; i++) await turn();
      assert.equal(terminated, attempt);
    }
  } finally { globalThis.Worker = originalWorker; globalThis.document = originalDocument; }
});
