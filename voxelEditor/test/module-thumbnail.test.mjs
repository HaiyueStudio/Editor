import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleThumbnailPoints } from '../dist/module-thumbnail.js';

test('module thumbnails are deterministic, bounded and sampled for large assets', () => {
  assert.deepEqual(moduleThumbnailPoints([]), []);
  const voxels = Array.from({ length: 400 }, (_, index) => ({
    x: index % 20,
    y: Math.floor(index / 20) % 10,
    z: Math.floor(index / 200),
    color: Math.floor(index / 10) % 2 ? '#ff0000' : '#00ff00',
  }));
  const first = moduleThumbnailPoints(voxels, 64, 52, 40);
  const second = moduleThumbnailPoints(voxels, 64, 52, 40);

  assert.deepEqual(first, second);
  assert.equal(first.length <= 40, true);
  assert.equal(first.every(point => point.x >= 0 && point.x <= 64 && point.y >= 0 && point.y <= 52), true);
  assert.equal(first.every(point => point.size >= 2.4 && point.size <= 7), true);
  assert.equal(new Set(first.map(point => point.color)).size, 2);
});
