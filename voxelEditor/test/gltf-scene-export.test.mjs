import assert from 'node:assert/strict';
import test from 'node:test';
import { exportVoxelProjectAsGlb } from '../dist/gltf-scene-exporter.js';

function projectFixture() {
  return {
    format: 'haiyue-voxel', version: 1,
    size: { x: 16, y: 16, z: 16 },
    editor: { currentColor: '#ff0000', activeAnimationId: 'animation-1', animationFrame: 0 },
    voxels: [{ x: 1, y: 0, z: 1, color: '#ffffff' }],
    palette: [
      { id: 'red', name: 'Red', color: '#ff0000', metallic: 0, roughness: 0.8 },
      { id: 'blue', name: 'Blue', color: '#0000ff', metallic: 0, roughness: 0.8 },
    ],
    modules: [
      { id: 'red-module', name: 'Red Module', size: { x: 1, y: 1, z: 1 }, voxels: [{ x: 0, y: 0, z: 0, color: '#ff0000', materialId: 'red' }] },
      { id: 'blue-module', name: 'Blue Module', size: { x: 1, y: 1, z: 1 }, voxels: [{ x: 0, y: 0, z: 0, color: '#0000ff', materialId: 'blue' }] },
    ],
    moduleInstances: [{
      id: 'instance-1', moduleId: 'red-module', name: 'Actor',
      position: { x: 2, y: 0, z: 3 }, rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }, layerId: 'layer-1', visible: true,
    }],
    layers: [{ id: 'layer-1', name: 'Default', visible: true, locked: false }],
    animations: [{
      id: 'animation-1', name: 'Swap', fps: 10, frameCount: 5, loop: true,
      playbackStart: 1, playbackEnd: 4,
      tracks: [{
        instanceId: 'instance-1',
        keyframes: [{
          frame: 2, moduleId: 'blue-module', position: { x: 6, y: 0, z: 3 },
          rotation: { x: 0, y: 1, z: 0 }, scale: { x: 2, y: 1, z: 1 }, visible: true,
        }],
      }],
    }],
  };
}

function glbJson(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + jsonLength)).trim());
}

test('instance GLB keeps shared module meshes, logical nodes and STEP animation tracks', () => {
  const result = exportVoxelProjectAsGlb(projectFixture(), { mode: 'instances', includeAnimations: true });
  const gltf = glbJson(result.data);

  assert.equal(result.instanceCount, 1);
  assert.equal(result.animationCount, 1);
  assert.equal(gltf.extras.haiyueExportMode, 'instances');
  assert.equal(gltf.meshes.length, 3); // base voxels plus two module definitions
  const variants = gltf.nodes.filter(node => node.extras?.haiyueInstanceId === 'instance-1');
  assert.equal(variants.length, 2);
  assert.deepEqual(new Set(variants.map(node => node.extras.haiyueModuleId)), new Set(['red-module', 'blue-module']));
  assert.equal(gltf.animations[0].extras.playbackStart, 1);
  assert.equal(gltf.animations[0].extras.playbackEnd, 4);
  assert.equal(gltf.animations[0].samplers.every(sampler => sampler.interpolation === 'STEP'), true);
  assert.equal(gltf.animations[0].channels.some(channel => channel.target.path === 'translation'), true);
  assert.equal(gltf.animations[0].channels.some(channel => channel.target.path === 'rotation'), true);
  assert.equal(gltf.animations[0].channels.some(channel => channel.target.path === 'scale'), true);
});

test('merged GLB remains a single static current-frame mesh', () => {
  const result = exportVoxelProjectAsGlb(projectFixture(), { mode: 'merged', includeAnimations: true });
  const gltf = glbJson(result.data);
  assert.equal(result.nodeCount, 1);
  assert.equal(result.animationCount, 0);
  assert.equal(gltf.meshes.length, 1);
  assert.equal(gltf.animations, undefined);
});
