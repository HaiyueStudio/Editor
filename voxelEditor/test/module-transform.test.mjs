import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeModuleScale,
  normalizeQuarterTurn,
  projectGizmoDragSteps,
  transformModuleVoxels,
} from '../dist/module-transform.js';

test('module transforms expand integer scale and rotate on the voxel grid', () => {
  const result = transformModuleVoxels([
    { x: 0, y: 0, z: 0, color: '#ff0000' },
    { x: 1, y: 0, z: 0, color: '#00ff00' },
  ], {
    scale: { x: 2, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 1 },
  });
  assert.deepEqual(result.map(({ x, y, z, color }) => ({ x, y, z, color })), [
    { x: 0, y: 3, z: 0, color: '#ff0000' },
    { x: 0, y: 2, z: 0, color: '#ff0000' },
    { x: 0, y: 1, z: 0, color: '#00ff00' },
    { x: 0, y: 0, z: 0, color: '#00ff00' },
  ]);
});

test('module transform values are normalized to grid-safe ranges', () => {
  assert.equal(normalizeQuarterTurn(-1), 3);
  assert.equal(normalizeQuarterTurn(5), 1);
  assert.equal(normalizeModuleScale(0), 1);
  assert.equal(normalizeModuleScale(99), 16);
});

test('gizmo drag projects pointer movement onto its screen axis', () => {
  assert.equal(projectGizmoDragSteps({ x: 60, y: 0 }, 3, { x: 42, y: 30 }), 2);
  assert.equal(projectGizmoDragSteps({ x: 0, y: -80 }, 4, { x: 50, y: 39 }), -2);
});
