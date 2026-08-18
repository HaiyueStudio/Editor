import assert from 'node:assert/strict';
import test from 'node:test';
import { projectCameraAxes } from '../dist/camera-axis.js';

test('projects world axes with the identity camera orientation', () => {
  const matrix = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);

  assert.deepEqual(projectCameraAxes(matrix), [
    { name: 'x', x: 1, y: -0, depth: 0 },
    { name: 'y', x: 0, y: -1, depth: 0 },
    { name: 'z', x: 0, y: -0, depth: 1 },
  ]);
});

test('rotates the screen-space axes with the camera basis', () => {
  const matrix = new Float32Array([
    0, 0, -1, 0,
    0, 1, 0, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  ]);

  assert.deepEqual(projectCameraAxes(matrix), [
    { name: 'x', x: 0, y: -0, depth: 1 },
    { name: 'y', x: 0, y: -1, depth: 0 },
    { name: 'z', x: -1, y: -0, depth: 0 },
  ]);
});

test('rejects an incomplete camera matrix', () => {
  assert.throws(() => projectCameraAxes([1, 0, 0]), /16/);
});
