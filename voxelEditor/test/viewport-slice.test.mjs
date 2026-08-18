import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampSliceIndex,
  pickWorkPlaneCell,
  slicePlaneNormal,
  voxelSliceVisibility,
} from '../dist/viewport-slice.js';
import { frameVoxelBounds, sceneVoxelBounds, voxelBounds } from '../dist/camera-framing.js';

const size = { x: 10, y: 8, z: 12 };

test('slice state distinguishes active, context, and hidden voxels', () => {
  const voxel = { x: 4, y: 3, z: 7 };
  assert.equal(voxelSliceVisibility(voxel, { axis: 'y', index: 3, mode: 'single', workPlaneEnabled: false }), 'active');
  assert.equal(voxelSliceVisibility(voxel, { axis: 'y', index: 2, mode: 'single', workPlaneEnabled: false }), 'hidden');
  assert.equal(voxelSliceVisibility(voxel, { axis: 'y', index: 2, mode: 'context', workPlaneEnabled: false }), 'context');
  assert.equal(voxelSliceVisibility(voxel, { axis: 'x', index: 0, mode: 'all', workPlaneEnabled: false }), 'active');
});

test('slice indices clamp independently to each scene axis', () => {
  assert.equal(clampSliceIndex(size, 'x', 30), 9);
  assert.equal(clampSliceIndex(size, 'y', -2), 0);
  assert.equal(clampSliceIndex(size, 'z', 5.6), 6);
  assert.deepEqual(slicePlaneNormal('x'), [1, 0, 0]);
  assert.deepEqual(slicePlaneNormal('y'), [0, 1, 0]);
  assert.deepEqual(slicePlaneNormal('z'), [0, 0, 1]);
});

test('movable work planes return a bounded cell on X, Y, and Z layers', () => {
  assert.deepEqual(pickWorkPlaneCell(
    { origin: [0, 10, 0], direction: [0, -1, 0] }, size, 'y', 3,
  ), { x: 5, y: 3, z: 6 });
  assert.deepEqual(pickWorkPlaneCell(
    { origin: [-10, 4.2, 0], direction: [1, 0, 0] }, size, 'x', 2,
  ), { x: 2, y: 4, z: 6 });
  assert.deepEqual(pickWorkPlaneCell(
    { origin: [1.2, 2.8, 20], direction: [0, 0, -1] }, size, 'z', 7,
  ), { x: 6, y: 2, z: 7 });
  assert.equal(pickWorkPlaneCell(
    { origin: [20, 10, 20], direction: [0, -1, 0] }, size, 'y', 3,
  ), null);
});

test('frame calculations center voxel and scene bounds in renderer world space', () => {
  const bounds = voxelBounds([
    { x: 2, y: 1, z: 4 },
    { x: 5, y: 3, z: 8 },
  ]);
  assert.deepEqual(bounds, { minX: 2, minY: 1, minZ: 4, maxX: 6, maxY: 4, maxZ: 9 });
  const frame = frameVoxelBounds(bounds, size, Math.PI / 4, 16 / 9, 'perspective');
  assert.deepEqual(frame.target, [-1, 2.5, 0.5]);
  assert.ok(frame.radius > 3);
  assert.deepEqual(sceneVoxelBounds(size), { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 8, maxZ: 12 });
});
