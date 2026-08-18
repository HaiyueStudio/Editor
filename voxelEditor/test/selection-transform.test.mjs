import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVoxelClipboard,
  flipVoxels,
  pasteVoxelClipboard,
  resizeVoxelsAlongAxis,
  rotateVoxels90,
  rotateVoxels90AroundPivot,
  scaleVoxelsInteger,
  selectionPivot,
  snapTransformSteps,
  translateVoxels,
} from '../dist/selection-transform.js';

const source = [
  { x: 2, y: 3, z: 4, color: '#ff0000' },
  { x: 3, y: 3, z: 4, color: '#00ff00' },
  { x: 2, y: 4, z: 4, color: '#0000ff' },
];

test('selection translation preserves each voxel color', () => {
  assert.deepEqual(translateVoxels(source, { x: 2, y: -1, z: 3 }), [
    { x: 4, y: 2, z: 7, color: '#ff0000' },
    { x: 5, y: 2, z: 7, color: '#00ff00' },
    { x: 4, y: 3, z: 7, color: '#0000ff' },
  ]);
});

test('selection rotates 90 degrees around its bounding box origin', () => {
  assert.deepEqual(rotateVoxels90(source, 'z'), [
    { x: 2, y: 4, z: 4, color: '#ff0000' },
    { x: 2, y: 3, z: 4, color: '#00ff00' },
    { x: 3, y: 4, z: 4, color: '#0000ff' },
  ]);
  assert.deepEqual(rotateVoxels90(source, 'x').map(({ x, y, z }) => ({ x, y, z })), [
    { x: 2, y: 3, z: 5 },
    { x: 3, y: 3, z: 5 },
    { x: 2, y: 3, z: 4 },
  ]);
});

test('selection resolves center/minimum pivots and rotates around the chosen pivot', () => {
  assert.deepEqual(selectionPivot(source, 'center'), { x: 3, y: 4, z: 4.5 });
  assert.deepEqual(selectionPivot(source, 'minimum'), { x: 2, y: 3, z: 4 });
  assert.deepEqual(
    rotateVoxels90AroundPivot(source, 'z', { x: 3, y: 4, z: 4.5 })
      .map(({ x, y, z, color }) => ({ x, y, z, color })),
    [
      { x: 3, y: 3, z: 4, color: '#ff0000' },
      { x: 3, y: 4, z: 4, color: '#00ff00' },
      { x: 2, y: 3, z: 4, color: '#0000ff' },
    ],
  );
  assert.deepEqual(
    rotateVoxels90AroundPivot([source[0]], 'y', { x: 2.5, y: 3.5, z: 4.5 }, -1),
    [source[0]],
  );
});

test('integer scaling preserves voxel attributes and bounding-box resize supports expansion and shrink', () => {
  const scaled = scaleVoxelsInteger([{ ...source[0], materialId: 'paint' }], { x: 2, y: 1, z: 1 }, { x: 2, y: 3, z: 4 });
  assert.equal(scaled.length, 2);
  assert.ok(scaled.every(voxel => voxel.color === '#ff0000' && voxel.materialId === 'paint'));

  const expanded = resizeVoxelsAlongAxis(source, 'x', 4, { x: 3, y: 4, z: 4.5 });
  assert.equal(expanded.length, 6);
  assert.deepEqual([...new Set(expanded.map(voxel => voxel.x))], [1, 2, 3, 4]);
  const shrunk = resizeVoxelsAlongAxis(source, 'x', 1, { x: 3, y: 4, z: 4.5 });
  assert.deepEqual(shrunk, [
    { x: 3, y: 3, z: 4, color: '#ff0000' },
    { x: 3, y: 4, z: 4, color: '#0000ff' },
  ]);
});

test('transform snapping quantizes movement to 1, 5, or 10 grid units', () => {
  assert.equal(snapTransformSteps(3.6, 1), 4);
  assert.equal(snapTransformSteps(3.6, 5), 5);
  assert.equal(snapTransformSteps(-7, 5), -5);
  assert.equal(snapTransformSteps(14.9, 10), 10);
});

test('selection flips within its current bounds', () => {
  assert.deepEqual(flipVoxels(source, 'x').map(({ x, y, z }) => ({ x, y, z })), [
    { x: 3, y: 3, z: 4 },
    { x: 2, y: 3, z: 4 },
    { x: 3, y: 4, z: 4 },
  ]);
});

test('clipboard stores relative voxels and pastes them at a new origin', () => {
  const clipboard = createVoxelClipboard(source);
  assert.ok(clipboard);
  assert.deepEqual(clipboard.origin, { x: 2, y: 3, z: 4 });
  assert.deepEqual(clipboard.size, { x: 2, y: 2, z: 1 });
  assert.deepEqual(pasteVoxelClipboard(clipboard, { x: 10, y: 11, z: 12 }), [
    { x: 10, y: 11, z: 12, color: '#ff0000' },
    { x: 11, y: 11, z: 12, color: '#00ff00' },
    { x: 10, y: 12, z: 12, color: '#0000ff' },
  ]);
});
