import assert from 'node:assert/strict';
import test from 'node:test';
import { orthographicBounds, orthographicCameraRay } from '../dist/camera-projection.js';

test('orthographic bounds preserve perspective scale at the orbit target', () => {
  const bounds = orthographicBounds(10, Math.PI / 2, 2);
  assert.ok(Math.abs(bounds.top - 10) < 1e-10);
  assert.ok(Math.abs(bounds.bottom + 10) < 1e-10);
  assert.ok(Math.abs(bounds.right - 20) < 1e-10);
  assert.ok(Math.abs(bounds.left + 20) < 1e-10);
});

test('orthographic picking rays are parallel and start at the pointer position', () => {
  const identity = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const first = orthographicCameraRay(-0.5, 0.25, identity);
  const second = orthographicCameraRay(0.75, -0.4, identity);

  assert.deepEqual(first.origin, [-0.5, 0.25, 0]);
  assert.deepEqual(second.origin, [0.75, -0.4, 0]);
  assert.deepEqual(first.direction, [0, 0, 1]);
  assert.deepEqual(second.direction, first.direction);
});

test('orthographic picking supports reverse-Z projections', () => {
  const identity = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const ray = orthographicCameraRay(0, 0, identity, true);
  assert.deepEqual(ray.origin, [0, 0, 1]);
  assert.deepEqual(ray.direction, [0, 0, -1]);
});
