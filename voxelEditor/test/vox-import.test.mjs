import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMagicaVoxel } from '../dist/vox-importer.js';

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function chunk(id, content = Buffer.alloc(0), children = []) {
  const childData = Buffer.concat(children);
  return Buffer.concat([
    Buffer.from(id, 'ascii'),
    uint32(content.length),
    uint32(childData.length),
    content,
    childData,
  ]);
}

function sizeChunk(x, y, z) {
  return chunk('SIZE', Buffer.concat([int32(x), int32(y), int32(z)]));
}

function xyziChunk(voxels) {
  const records = Buffer.from(voxels.flatMap(voxel => [voxel.x, voxel.y, voxel.z, voxel.color]));
  return chunk('XYZI', Buffer.concat([uint32(voxels.length), records]));
}

function string(value) {
  const encoded = Buffer.from(value, 'utf8');
  return Buffer.concat([int32(encoded.length), encoded]);
}

function dict(entries = {}) {
  return Buffer.concat([int32(Object.keys(entries).length), ...Object.entries(entries).flatMap(([key, value]) => [string(key), string(value)])]);
}

function ntrn(id, childId, attributes = {}, frame = {}, layerId = -1) {
  return chunk('nTRN', Buffer.concat([
    int32(id), dict(attributes), int32(childId), int32(-1), int32(layerId), int32(1), dict(frame),
  ]));
}

function ngrp(id, children) {
  return chunk('nGRP', Buffer.concat([int32(id), dict(), int32(children.length), ...children.map(int32)]));
}

function nshp(id, modelId) {
  return chunk('nSHP', Buffer.concat([int32(id), dict(), int32(1), int32(modelId), dict()]));
}

function voxFile(children, version = 150) {
  return Buffer.concat([
    Buffer.from('VOX ', 'ascii'),
    uint32(version),
    chunk('MAIN', Buffer.alloc(0), children),
  ]);
}

test('VOX import maps Z-up coordinates and embedded palette colors into the editor', () => {
  const palette = Buffer.alloc(1024);
  palette.set([12, 34, 56, 255], 0);
  palette.set([200, 100, 50, 0], 4);
  const source = voxFile([
    sizeChunk(2, 3, 4),
    xyziChunk([
      { x: 1, y: 2, z: 3, color: 1 },
      { x: 0, y: 1, z: 2, color: 2 },
    ]),
    chunk('RGBA', palette),
  ]);

  const result = parseMagicaVoxel(source);
  assert.equal(result.version, 150);
  assert.equal(result.models.length, 1);
  assert.deepEqual(result.models[0].size, { x: 2, y: 4, z: 3 });
  assert.deepEqual(result.models[0].voxels, [{ x: 1, y: 3, z: 2, color: '#0c2238', materialId: 'vox-material-1' }]);
});

test('VOX import supports multiple models and the official default palette', () => {
  const source = voxFile([
    chunk('PACK', uint32(2)),
    sizeChunk(2, 2, 2),
    xyziChunk([{ x: 0, y: 0, z: 0, color: 1 }]),
    sizeChunk(3, 4, 5),
    xyziChunk([{ x: 2, y: 3, z: 4, color: 2 }]),
  ]);

  const result = parseMagicaVoxel(source);
  assert.equal(result.models.length, 2);
  assert.deepEqual(result.models[0].voxels[0], { x: 0, y: 0, z: 0, color: '#ffffff', materialId: 'vox-material-1' });
  assert.deepEqual(result.models[1].size, { x: 3, y: 5, z: 4 });
  assert.deepEqual(result.models[1].voxels[0], { x: 2, y: 4, z: 3, color: '#ffffcc', materialId: 'vox-material-2' });
  assert.equal(result.project.modules.length, 2);
  assert.equal(result.project.moduleInstances.length, 2);
});

test('VOX import flattens scene graph transforms and preserves layers and PBR MATL data', () => {
  const palette = Buffer.alloc(1024);
  palette.set([40, 80, 120, 255], 0);
  const source = voxFile([
    sizeChunk(2, 3, 4),
    xyziChunk([{ x: 1, y: 2, z: 3, color: 1 }]),
    ntrn(0, 1, {}, { _r: '4', _t: '5 6 7' }),
    ngrp(1, [2]),
    ntrn(2, 3, { _name: '塔楼' }, { _r: '4', _t: '1 2 3' }, 0),
    nshp(3, 0),
    chunk('LAYR', Buffer.concat([int32(0), dict({ _name: '建筑', _hidden: '1' }), int32(-1)])),
    chunk('MATL', Buffer.concat([int32(1), dict({ _type: '_metal', _metal: '0.9', _rough: '0.2' })])),
    chunk('RGBA', palette),
  ], 200);

  const result = parseMagicaVoxel(source);
  assert.equal(result.hasSceneGraph, true);
  assert.equal(result.instances.length, 1);
  assert.deepEqual(result.instances[0], {
    modelIndex: 0,
    name: '塔楼',
    position: { x: 5, y: 8, z: 7 },
    rotation: { x: 0, y: 0, z: 0 },
    layerId: 'layer-1',
    visible: true,
    frames: [{
      frame: 0,
      modelIndex: 0,
      position: { x: 5, y: 8, z: 7 },
      rotation: { x: 0, y: 0, z: 0 },
      visible: true,
    }],
  });
  assert.deepEqual(result.layers[0], { id: 'layer-1', name: '建筑', visible: false, locked: false });
  assert.equal(result.materials[0].metallic, 0.9);
  assert.equal(result.materials[0].roughness, 0.2);
  assert.deepEqual(result.materials[0].vox, {
    type: 'metal',
    properties: { _type: '_metal', _metal: '0.9', _rough: '0.2' },
    compatibility: 'full',
  });
  assert.equal(result.project.modules[0].voxels[0].materialId, 'vox-material-1');
});

test('VOX import rejects invalid headers and truncated chunks', () => {
  assert.throws(() => parseMagicaVoxel(Buffer.from('not a vox file')), /不是有效/);
  const source = voxFile([sizeChunk(2, 2, 2), xyziChunk([{ x: 0, y: 0, z: 0, color: 1 }])]);
  assert.throws(() => parseMagicaVoxel(source.subarray(0, source.length - 2)), /长度无效|截断/);
});
