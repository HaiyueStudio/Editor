import assert from 'node:assert/strict';
import test from 'node:test';
import { projectFingerprint, recentProjectId } from '../dist/project-storage.js';

const project = {
  format: 'haiyue-voxel',
  version: 1,
  size: { x: 8, y: 8, z: 8 },
  editor: { currentColor: '#ff0000', animationFrame: 0 },
  voxels: [{ x: 1, y: 2, z: 3, color: '#ff0000' }],
};

test('project fingerprints ignore transient editor state but detect saved content changes', () => {
  const baseline = projectFingerprint(project);
  assert.equal(projectFingerprint({ ...project, editor: { currentColor: '#00ff00', animationFrame: 12 } }), baseline);
  assert.notEqual(projectFingerprint({
    ...project,
    voxels: [...project.voxels, { x: 2, y: 2, z: 3, color: '#00ff00' }],
  }), baseline);
});

test('recent project ids are stable across filename case', () => {
  assert.equal(recentProjectId('Castle', 'vox'), recentProjectId('CASTLE', 'vox'));
  assert.notEqual(recentProjectId('Castle', 'vox'), recentProjectId('Castle', 'json'));
});
