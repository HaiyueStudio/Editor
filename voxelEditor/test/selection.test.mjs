import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectedVoxels,
  projectWorldPoint,
  VoxelSelection,
  voxelsWithColor,
} from '../dist/selection.js';

const a = { x: 0, y: 0, z: 0 };
const b = { x: 1, y: 0, z: 0 };
const c = { x: 2, y: 0, z: 0 };

test('voxel selection supports replace, add, subtract, invert and retain', () => {
  const selection = new VoxelSelection();
  assert.equal(selection.apply([a, b]), true);
  assert.equal(selection.count, 2);
  assert.equal(selection.apply([c], 'add'), true);
  assert.equal(selection.count, 3);
  assert.equal(selection.apply([b], 'subtract'), true);
  assert.equal(selection.has(b), false);
  assert.equal(selection.has(c), true);

  selection.invert([a, b, c]);
  assert.equal(selection.count, 1);
  assert.equal(selection.has(b), true);
  selection.retain([a, c]);
  assert.equal(selection.count, 0);
});

test('connected selection follows six-neighbour voxels with the same color', () => {
  const source = [
    { ...a, color: '#ff0000' },
    { ...b, color: '#ff0000' },
    { x: 1, y: 1, z: 0, color: '#0000ff' },
    { x: 2, y: 1, z: 0, color: '#ff0000' },
    { x: 4, y: 0, z: 0, color: '#ff0000' },
  ];
  assert.deepEqual(connectedVoxels(source, a).map(voxel => [voxel.x, voxel.y, voxel.z]), [
    [0, 0, 0],
    [1, 0, 0],
  ]);
  assert.equal(voxelsWithColor(source, '#ff0000').length, 4);
});

test('world points project into client-space selection rectangles', () => {
  const identity = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const viewport = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(projectWorldPoint(identity, [0, 0, 0.5], viewport), { x: 110, y: 70 });
  assert.equal(projectWorldPoint(identity, [2, 0, 0.5], viewport), null);
  assert.equal(projectWorldPoint(identity, [0, 0, -0.1], viewport), null);
});
