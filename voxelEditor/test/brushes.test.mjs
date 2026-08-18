import assert from 'node:assert/strict';
import test from 'node:test';
import { generateInteractiveBrushVoxels } from '../dist/brushes.js';
import {
  floodFillVoxels,
  mirrorVoxelPositions,
  replacementChanges,
  surfacePaintVoxels,
} from '../dist/voxel-paint.js';

const sceneSize = { x: 8, y: 8, z: 8 };

test('voxel brush expands around the pointed cell and clips to scene bounds', () => {
  const result = generateInteractiveBrushVoxels('voxel', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 3, sceneSize);
  assert.equal(result.length, 8);
  assert.ok(result.every(voxel => voxel.x <= 1 && voxel.y <= 1 && voxel.z <= 1));
});

test('line brush produces a continuous 3D path including both endpoints', () => {
  const result = generateInteractiveBrushVoxels('line', { x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }, 1, sceneSize);
  assert.deepEqual(result, [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 2, y: 1, z: 0 },
  ]);
});

test('box brush fills an inclusive axis-aligned volume', () => {
  const result = generateInteractiveBrushVoxels('box', { x: 2, y: 3, z: 4 }, { x: 1, y: 2, z: 3 }, 16, sceneSize);
  assert.equal(result.length, 8);
  assert.ok(result.some(voxel => voxel.x === 1 && voxel.y === 2 && voxel.z === 3));
  assert.ok(result.some(voxel => voxel.x === 2 && voxel.y === 3 && voxel.z === 4));
});

test('mirror painting expands across any axis combination without duplicate center voxels', () => {
  const mirrored = mirrorVoxelPositions([{ x: 1, y: 2, z: 3 }], sceneSize, { x: true, y: true, z: true });
  assert.equal(mirrored.length, 8);
  assert.ok(mirrored.some(voxel => voxel.x === 6 && voxel.y === 5 && voxel.z === 4));
  const centered = mirrorVoxelPositions([{ x: 2, y: 2, z: 2 }], { x: 5, y: 5, z: 5 }, { x: true, y: true, z: true });
  assert.deepEqual(centered, [{ x: 2, y: 2, z: 2 }]);
});

test('flood fill respects connected PBR material regions and surface paint excludes interior voxels', () => {
  const solid = [];
  for (let z = 0; z < 3; z += 1) for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) {
    solid.push({ x, y, z, color: '#123456', materialId: 'stone' });
  }
  solid.push({ x: 3, y: 1, z: 1, color: '#123456', materialId: 'metal' });
  assert.equal(floodFillVoxels(solid, { x: 0, y: 0, z: 0 }).length, 27);
  const surface = surfacePaintVoxels(solid, { x: 0, y: 0, z: 0 });
  assert.equal(surface.length, 25);
  assert.ok(!surface.some(voxel => voxel.x === 1 && voxel.y === 1 && voxel.z === 1));
});

test('replace color can target the complete source or only selected voxel keys', () => {
  const voxels = [
    { x: 0, y: 0, z: 0, color: '#112233', materialId: 'old', source: 'scene' },
    { x: 1, y: 0, z: 0, color: '#112233', materialId: 'old', source: 'scene' },
    { x: 2, y: 0, z: 0, color: '#445566', materialId: 'other', source: 'scene' },
  ];
  assert.equal(replacementChanges(voxels, '#112233', '#abcdef', 'new').length, 2);
  const selected = replacementChanges(voxels, '#112233', '#abcdef', 'new', new Set(['1,0,0']));
  assert.deepEqual(selected.map(change => [change.x, change.after, change.afterMaterialId]), [[1, '#abcdef', 'new']]);
});
