import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { writePsdUint8Array } from 'ag-psd';
import { inspectPsd, inspectHeader, composite, exportEditedPsd } from '../dist/psdPrototype.js';
import { solid, syntheticDocument, applyEdit } from './synthetic.mjs';

const directory = new URL('./fixtures/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory)));
export function layerContract(layer) {
  const result = Object.fromEntries(['name', 'left', 'top', 'right', 'bottom', 'blendMode', 'opacity', 'hidden', 'clipping', 'transparencyProtected'].map(key => [key, layer[key] ?? null]));
  if (layer.children) result.children = layer.children.map(layerContract);
  return result;
}

for (const sample of manifest.samples) {
  test(`external fixture: ${sample.id} hash, admission and reference structure`, () => {
    const bytes = readFileSync(new URL(sample.file, directory));
    assert.equal(bytes.length, sample.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sample.sha256);
    if (sample.expectedAdmission !== 'readable') {
      assert.throws(() => inspectPsd(bytes), { code: sample.expectedAdmission });
      return;
    }
    const { document } = inspectPsd(bytes);
    const expectedBytes = readFileSync(new URL(sample.expectedFile, directory));
    assert.equal(createHash('sha256').update(expectedBytes).digest('hex'), sample.expectedSha256);
    const expected = JSON.parse(expectedBytes);
    assert.equal(document.width, expected.width);
    assert.equal(document.height, expected.height);
    assert.deepEqual(document.children.map(layerContract), expected.children.map(layerContract));
  });
}

test('normal, multiply and screen against hand-calculated opaque pixels', () => {
  for (const [mode, expected] of [['normal', [200, 50, 100, 255]], ['multiply', [78, 29, 78, 255]], ['screen', [222, 171, 222, 255]]]) {
    const image = composite({ width: 1, height: 1, children: [
      { imageData: solid(1, 1, [100, 150, 200, 255]) },
      { blendMode: mode, imageData: solid(1, 1, [200, 50, 100, 255]) },
    ] });
    assert.deepEqual([...image.data], expected);
  }
});
test('straight alpha over transparent canvas retains RGB, hidden layers ignored', () => {
  const image = composite({ width: 1, height: 1, children: [
    { imageData: solid(1, 1, [30, 80, 200, 128]) },
    { hidden: true, imageData: solid(1, 1, [255, 0, 0, 255]) },
  ] });
  assert.deepEqual([...image.data], [30, 80, 200, 128]);
});
test('group opacity is applied once after isolation', () => {
  const image = composite({ width: 1, height: 1, children: [{ opacity: 0.5, children: [
    { imageData: solid(1, 1, [255, 0, 0, 255]) }, { imageData: solid(1, 1, [0, 0, 255, 255]) },
  ] }] });
  assert.deepEqual([...image.data], [0, 0, 255, 128]);
});
test('pass-through group blends with backdrop', () => {
  const image = composite({ width: 1, height: 1, children: [
    { imageData: solid(1, 1, [100, 150, 200, 255]) },
    { blendMode: 'pass through', children: [{ blendMode: 'multiply', imageData: solid(1, 1, [200, 50, 100, 255]) }] },
  ] });
  assert.deepEqual([...image.data], [78, 29, 78, 255]);
});
test('offsets crop off-canvas pixels without shifting source coordinates', () => {
  const data = solid(2, 1, [255, 0, 0, 255]); data.data.set([0, 255, 0, 255], 4);
  assert.deepEqual([...composite({ width: 1, height: 1, children: [{ left: -1, imageData: data }] }).data], [0, 255, 0, 255]);
});
test('edited PSD refreshes composite and retains Unicode, pixels and offset', () => {
  const source = writePsdUint8Array(syntheticDocument(), { noBackground: true });
  const inspection = inspectPsd(source);
  applyEdit(inspection.document);
  const reopened = inspectPsd(exportEditedPsd(inspection)).document;
  assert.equal(reopened.children[1].children[0].name, 'Edited 编辑');
  assert.equal(reopened.children[1].children[0].left, 5);
  assert.deepEqual([...reopened.children[1].children[0].imageData.data.slice(0, 4)], [10, 240, 80, 255]);
  assert.deepEqual(reopened.imageData.data, composite(reopened).data);
});
test('semi-transparent and invisible RGB survives byte-array roundtrip', () => {
  const image = solid(2, 1, [99, 33, 201, 1]); image.data.set([15, 80, 120, 0], 4);
  const document = { width: 2, height: 1, children: [{ imageData: image }], imageData: image };
  const reopened = inspectPsd(writePsdUint8Array(document, { noBackground: true })).document;
  assert.deepEqual(reopened.children[0].imageData.data, image.data);
});
test('unsupported editing features reject export without mutating the source', () => {
  for (const extra of [{ clipping: true }, { mask: {} }, { text: {} }, { blendMode: 'overlay' }, { blendMode: 'pass through', opacity: 0.5, children: [] }]) {
    const document = { width: 1, height: 1, children: [{ ...extra, imageData: solid(1, 1, [1, 2, 3, 255]) }] };
    const before = structuredClone(document);
    assert.throws(() => exportEditedPsd({ document, diagnostics: [], estimatedPixelBytes: 4 }), { code: 'unsafe-export' });
    assert.deepEqual(document, before);
  }
});
test('ICC and unknown source resources are not silently approved for editing', () => {
  const inspection = inspectPsd(readFileSync(new URL('layers.psd', directory)));
  assert(inspection.resourceIds.includes(1039));
  assert(inspection.diagnostics.some(d => d.code === 'icc-profile'));
  assert.throws(() => exportEditedPsd(inspection), { code: 'unsafe-export' });
  const simple = inspectPsd(writePsdUint8Array(syntheticDocument()));
  simple.resourceIds.push(65000);
  assert.throws(() => exportEditedPsd(simple), { code: 'resource-loss' });
});
test('truncated, invalid and over-budget PSDs fail with structured reasons', () => {
  const source = writePsdUint8Array(syntheticDocument());
  assert.throws(() => inspectPsd(source.subarray(0, 12)), { code: 'truncated-header' });
  assert.throws(() => inspectPsd(source.subarray(0, 40)), { code: 'truncated-resource' });
  const bad = source.slice(); bad[0] = 0;
  assert.throws(() => inspectHeader(bad), { code: 'invalid-signature' });
  const big = source.slice(); new DataView(big.buffer).setUint32(18, 30000);
  assert.throws(() => inspectHeader(big), { code: 'canvas-budget' });
});
test('off-canvas layer bounds are checked before decompression', () => {
  const source = writePsdUint8Array({ width: 1, height: 1, children: [{ imageData: solid(20000, 1, [1, 2, 3, 255]) }] });
  assert.throws(() => inspectPsd(source), { code: 'layer-budget' });
});
test('real baseline composites equal the embedded reference pixels', () => {
  for (const id of ['layers', 'layer-offsets-read']) {
    const { document } = inspectPsd(readFileSync(new URL(`${id}.psd`, directory)));
    assert.deepEqual(composite(document).data, document.imageData.data);
  }
});
test('partial-alpha cached composite quantization is observable; layers stay exact', () => {
  const imageData = solid(2, 2, [99, 33, 201, 10]);
  const source = { width: 2, height: 2, children: [{ imageData }], imageData };
  const reopened = inspectPsd(writePsdUint8Array(source, { noBackground: true })).document;
  assert.deepEqual(reopened.children[0].imageData.data, imageData.data);
  assert.equal(reopened.imageData.data[3], 10);
  assert.notDeepEqual(reopened.imageData.data, imageData.data, 'Revisit the P0 finding if the pinned codec fixes matte quantization');
});
test('one-pixel transparent composite codec defect cannot escape the export guard', () => {
  for (const [width, height] of [[1, 1], [1, 32], [2, 1]]) {
    const document = { width, height, children: [{ imageData: solid(width, height, [99, 33, 201, 10]) }] };
    assert.throws(() => exportEditedPsd({ document, diagnostics: [], estimatedPixelBytes: width * height * 4 }), { code: 'composite-alpha-corruption' });
  }
});
