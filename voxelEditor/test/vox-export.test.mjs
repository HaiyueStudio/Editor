import assert from 'node:assert/strict';
import test from 'node:test';
import { exportVoxelProjectAsVox, exportVoxelsAsVox } from '../dist/vox-exporter.js';
import { parseMagicaVoxel } from '../dist/vox-importer.js';
import { VoxelDocument } from '../dist/model.js';
import { editorQuarterTurnsToMatrix } from '../dist/vox-importer.js';

test('VOX export round-trips Y-up coordinates, dimensions and exact palette colors', () => {
  const source = [
    { x: 0, y: 0, z: 0, color: '#123456' },
    { x: 2, y: 3, z: 4, color: '#fedcba' },
    { x: 1, y: 2, z: 3, color: '#123456' },
  ];
  const exported = exportVoxelsAsVox({ x: 3, y: 4, z: 5 }, source);

  assert.equal(new TextDecoder('ascii').decode(exported.data.subarray(0, 4)), 'VOX ');
  assert.equal(exported.voxelCount, 3);
  assert.equal(exported.paletteSize, 2);
  assert.equal(exported.quantized, false);

  const imported = parseMagicaVoxel(exported.data);
  assert.equal(imported.version, 200);
  assert.deepEqual(imported.models[0].size, { x: 3, y: 4, z: 5 });
  assert.deepEqual(imported.models[0].voxels.map(({ materialId: _materialId, ...voxel }) => voxel), source);
});

test('VOX export preserves extended Glass MATL properties and marks them partially compatible', () => {
  const project = {
    format: 'haiyue-voxel', version: 1,
    size: { x: 2, y: 2, z: 2 },
    editor: { currentColor: '#88ccff', currentMaterialId: 'glass' },
    palette: [{
      id: 'glass', color: '#88ccff', name: 'Glass', metallic: 0.04, roughness: 0.08,
      vox: {
        type: 'glass', compatibility: 'partial',
        properties: { _type: '_glass', _rough: '0.08', _ior: '0.3', _trans: '0.75' },
      },
    }],
    voxels: [{ x: 0, y: 0, z: 0, color: '#88ccff', materialId: 'glass' }],
  };
  const exported = exportVoxelProjectAsVox(project);
  assert.equal(exported.partialMaterialCount, 1);
  const imported = parseMagicaVoxel(exported.data);
  assert.equal(imported.materials[0].vox.type, 'glass');
  assert.equal(imported.materials[0].vox.compatibility, 'partial');
  assert.equal(imported.materials[0].vox.properties._ior, '0.3');
  assert.equal(imported.materials[0].vox.properties._trans, '0.75');
  const document = new VoxelDocument();
  document.load(imported.project);
  assert.deepEqual(document.toJSON().palette[0].vox, imported.materials[0].vox);
});

test('complete VOX scene export round-trips modules, instances, layers, transforms and PBR materials', () => {
  const project = {
    format: 'haiyue-voxel', version: 1,
    size: { x: 32, y: 24, z: 32 },
    editor: { currentColor: '#336699', currentMaterialId: 'metal-blue' },
    palette: [{ id: 'metal-blue', color: '#336699', name: '蓝色金属', metallic: 0.88, roughness: 0.16 }],
    voxels: [{ x: 0, y: 0, z: 0, color: '#336699', materialId: 'metal-blue' }],
    modules: [{
      id: 'module-a', name: '拱门', size: { x: 2, y: 3, z: 4 },
      voxels: [
        { x: 0, y: 0, z: 0, color: '#336699', materialId: 'metal-blue' },
        { x: 1, y: 2, z: 3, color: '#336699', materialId: 'metal-blue' },
      ],
    }],
    layers: [
      { id: 'layer-1', name: '默认图层', visible: true, locked: false },
      { id: 'layer-2', name: '隐藏参考', visible: false, locked: false },
    ],
    moduleInstances: [
      {
        id: 'instance-a', moduleId: 'module-a', name: '旋转拱门', position: { x: 5, y: 6, z: 7 },
        rotation: { x: 1, y: 0, z: 1 }, scale: { x: 1, y: 1, z: 1 }, layerId: 'layer-1', visible: true,
      },
      {
        id: 'instance-b', moduleId: 'module-a', name: '隐藏放大拱门', position: { x: 14, y: 2, z: 3 },
        rotation: { x: 0, y: 2, z: 0 }, scale: { x: 2, y: 1, z: 1 }, layerId: 'layer-2', visible: false,
      },
    ],
  };
  const progress = [];
  const exported = exportVoxelProjectAsVox(project, value => progress.push(value));
  assert.equal(exported.modelCount, 3);
  assert.equal(exported.instanceCount, 3);
  assert.equal(exported.layerCount, 2);
  assert.equal(progress.at(-1), 1);
  assert.equal(progress.every((value, index) => index === 0 || value >= progress[index - 1]), true);
  const imported = parseMagicaVoxel(exported.data);
  assert.equal(imported.hasSceneGraph, true);
  assert.equal(imported.instances.length, 3);
  assert.equal(imported.project.layers.find(layer => layer.name === '隐藏参考').visible, false);
  assert.equal(imported.instances.find(instance => instance.name === '隐藏放大拱门').visible, false);
  assert.equal(imported.materials[0].metallic, 0.88);
  assert.equal(imported.materials[0].roughness, 0.16);
  const restoredRotation = imported.instances.find(instance => instance.name === '旋转拱门').rotation;
  assert.deepEqual(editorQuarterTurnsToMatrix(restoredRotation), editorQuarterTurnsToMatrix({ x: 1, y: 0, z: 1 }));

  const before = new VoxelDocument();
  before.load(project);
  const after = new VoxelDocument();
  after.load(imported.project);
  const visible = document => Array.from(document.sceneVoxels.values(), voxel => `${voxel.x},${voxel.y},${voxel.z}:${voxel.color}`).sort();
  assert.deepEqual(visible(after), visible(before));
});

test('VOX project export preserves separate base voxel layer assignment and visibility', () => {
  const project = {
    format: 'haiyue-voxel', version: 1,
    size: { x: 8, y: 8, z: 8 },
    editor: { currentColor: '#ffffff' },
    voxels: [
      { x: 1, y: 0, z: 1, color: '#ff0000' },
      { x: 2, y: 0, z: 2, color: '#00ff00', layerId: 'layer-2' },
    ],
    modules: [],
    moduleInstances: [],
    layers: [
      { id: 'layer-1', name: '默认图层', visible: true, locked: false },
      { id: 'layer-2', name: '隐藏参考', visible: false, locked: false },
    ],
  };

  const exported = exportVoxelProjectAsVox(project);
  assert.equal(exported.modelCount, 2);
  assert.equal(exported.instanceCount, 2);
  const imported = parseMagicaVoxel(exported.data);
  const hiddenLayer = imported.project.layers.find(layer => layer.name === '隐藏参考');
  const hiddenBase = imported.instances.find(instance => instance.name === '场景体素 · 隐藏参考');
  assert.equal(hiddenLayer?.visible, false);
  assert.equal(hiddenBase?.layerId, hiddenLayer?.id);
  assert.equal(imported.models[hiddenBase.modelIndex].voxels[0].color, '#00ff00');
});

test('VOX scene animation round-trips transform, visibility and shape frames', () => {
  const project = {
    format: 'haiyue-voxel', version: 1,
    size: { x: 16, y: 8, z: 8 },
    editor: { currentColor: '#ff0000', activeAnimationId: 'animation-1', animationFrame: 0 },
    voxels: [],
    modules: [
      { id: 'red', name: '红', size: { x: 1, y: 1, z: 1 }, voxels: [{ x: 0, y: 0, z: 0, color: '#ff0000' }] },
      { id: 'blue', name: '蓝', size: { x: 1, y: 1, z: 1 }, voxels: [{ x: 0, y: 0, z: 0, color: '#0000ff' }] },
    ],
    moduleInstances: [{
      id: 'actor', moduleId: 'red', name: '演员', position: { x: 1, y: 0, z: 1 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, layerId: 'layer-1', visible: true,
    }],
    animations: [{
      id: 'animation-1', name: '动作', fps: 18, frameCount: 6, loop: false, playbackStart: 1, playbackEnd: 4,
      tracks: [{ instanceId: 'actor', keyframes: [
        { frame: 0, moduleId: 'red', position: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true },
        { frame: 2, moduleId: 'blue', position: { x: 6, y: 1, z: 2 }, rotation: { x: 0, y: 1, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true },
        { frame: 3, moduleId: 'blue', position: { x: 6, y: 1, z: 2 }, rotation: { x: 0, y: 1, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: false },
      ] }],
    }],
  };

  const exported = exportVoxelProjectAsVox(project);
  assert.equal(exported.animationFrameCount, 6);
  assert.equal(exported.modelCount, 2);
  const imported = parseMagicaVoxel(exported.data);
  assert.equal(imported.animated, true);
  assert.equal(imported.project.animations[0].frameCount, 6);
  assert.equal(imported.project.animations[0].name, '动作');
  assert.equal(imported.project.animations[0].fps, 18);
  assert.equal(imported.project.animations[0].loop, false);
  assert.equal(imported.project.animations[0].playbackStart, 1);
  assert.equal(imported.project.animations[0].playbackEnd, 4);

  const restored = new VoxelDocument();
  restored.load(imported.project);
  restored.setAnimationFrame(0);
  assert.equal(restored.sceneVoxels.get('1,0,1')?.color, '#ff0000');
  restored.setAnimationFrame(2);
  assert.equal(restored.sceneVoxels.get('6,1,2')?.color, '#0000ff');
  restored.setAnimationFrame(3);
  assert.equal(restored.sceneVoxelCount, 0);
});

test('VOX export quantizes scenes with more than 255 colors', () => {
  const source = Array.from({ length: 256 }, (_, index) => ({
    x: index % 16,
    y: Math.floor(index / 16),
    z: 0,
    color: `#${index.toString(16).padStart(2, '0')}0000`,
  }));
  const exported = exportVoxelsAsVox({ x: 16, y: 16, z: 1 }, source);

  assert.equal(exported.voxelCount, 256);
  assert.equal(exported.paletteSize, 255);
  assert.equal(exported.quantized, true);
  assert.equal(parseMagicaVoxel(exported.data).models[0].voxels.length, 256);
});

test('VOX export rejects empty scenes and invalid dimensions', () => {
  assert.throws(() => exportVoxelsAsVox({ x: 8, y: 8, z: 8 }, []), /没有可导出/);
  assert.throws(
    () => exportVoxelsAsVox({ x: 257, y: 8, z: 8 }, [{ x: 0, y: 0, z: 0, color: '#ffffff' }]),
    /1 到 256/,
  );
});
