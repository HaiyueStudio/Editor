import assert from 'node:assert/strict';
import test from 'node:test';
import { VoxelDocument, packVoxelKey, unpackVoxelKey } from '../dist/model.js';

test('module summaries avoid returning definition voxel arrays', () => {
  const document = new VoxelDocument({ x: 16, y: 16, z: 16 });
  const module = document.createModule('wall', { x: 4, y: 4, z: 4 });
  document.setVoxel(1, 2, 3, '#f26b5e');
  document.editScene();
  document.addModuleInstance(module.id, { x: 0, y: 0, z: 0 });
  assert.deepEqual(document.moduleSummaries.map(summary => ({
    name: summary.name, voxelCount: summary.voxelCount, instanceCount: summary.instanceCount,
  })), [{ name: 'wall', voxelCount: 1, instanceCount: 1 }]);
  assert.equal([...document.getModuleVoxelsView(module.id)].length, 1);
});

test('material usage is exposed as a lightweight definition count', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  document.setVoxel(0, 0, 0, '#f26b5e');
  document.setVoxel(1, 0, 0, '#f26b5e');
  assert.equal(document.getMaterialUsageCount('material-1'), 2);
  document.removeVoxel(1, 0, 0);
  assert.equal(document.getMaterialUsageCount('material-1'), 1);
});

test('voxel changes carry packed incremental render keys', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  let detail;
  document.addEventListener('change', event => { detail = event.detail; }, { once: true });
  document.setVoxel(3, 4, 5, '#f26b5e');
  assert.equal(typeof document.voxels.keys().next().value, 'number');
  assert.equal(detail.impact.fullRender, false);
  assert.deepEqual(detail.impact.voxelKeys, [packVoxelKey(3, 4, 5)]);
  assert.deepEqual(unpackVoxelKey(detail.impact.voxelKeys[0]), { x: 3, y: 4, z: 5 });
});

test('animation frame changes skip structural animation and module UI invalidation', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  document.createAnimation('idle', 4, 12);
  let detail;
  document.addEventListener('change', event => { detail = event.detail; }, { once: true });
  document.setAnimationFrame(1);
  assert.equal(detail.reason, 'animation-frame');
  assert.equal(detail.dirty.render, true);
  assert.equal(detail.dirty.modules, false);
  assert.equal(detail.dirty.animation, false);
  assert.equal(document.activeAnimationView, document.activeAnimationView);
});
