import assert from 'node:assert/strict';
import test from 'node:test';
import { exportVoxelsAsGlb, exportVoxelsAsGltf } from '../dist/gltf-exporter.js';
import { VoxelDocument, packVoxelKey } from '../dist/model.js';
import { pickGridPlaneCell, pickGroundCell } from '../dist/picking.js';
import { generateShapeVoxels } from '../dist/shape-generator.js';

test('empty scene ground grid can receive the first voxel', () => {
  const size = { x: 50, y: 50, z: 50 };
  assert.deepEqual(pickGroundCell({ origin: [0, 20, 0], direction: [0, -1, 0] }, size), { x: 25, y: 0, z: 25 });
  assert.deepEqual(pickGroundCell({ origin: [25, 20, 25], direction: [0, -1, 0] }, size), { x: 49, y: 0, z: 49 });
  assert.equal(pickGroundCell({ origin: [26, 20, 0], direction: [0, -1, 0] }, size), null);
});

test('drag picking remains locked to the initial voxel plane', () => {
  const size = { x: 10, y: 10, z: 10 };
  const horizontal = pickGridPlaneCell(
    { origin: [0, 10, 0], direction: [0.1, -1, 0.2] },
    size,
    { x: 4, y: 2, z: 4 },
    [0, 1, 0],
  );
  assert.deepEqual(horizontal, { x: 5, y: 2, z: 6 });

  const vertical = pickGridPlaneCell(
    { origin: [8, 3.2, 0], direction: [-1, 0.2, 0.1] },
    size,
    { x: 3, y: 1, z: 4 },
    [1, 0, 0],
  );
  assert.equal(vertical.x, 3);
  assert.equal(pickGridPlaneCell(
    { origin: [0, 10, 0], direction: [1, 0, 0] }, size, { x: 4, y: 2, z: 4 }, [0, 1, 0],
  ), null);
});

test('voxel document serializes deterministically and removes out-of-bounds voxels on resize', () => {
  const document = new VoxelDocument({ x: 12, y: 12, z: 12 });
  document.setVoxel(9, 3, 4, '#FF0000');
  document.setVoxel(1, 0, 2, '#00FF00');

  const before = document.toJSON();
  assert.deepEqual(before.voxels.map(voxel => [voxel.x, voxel.y, voxel.z]), [[1, 0, 2], [9, 3, 4]]);
  assert.equal(document.setSize({ x: 5, y: 5, z: 5 }), 1);
  assert.equal(document.voxelCount, 1);
  assert.equal(document.get(1, 0, 2)?.color, '#00ff00');
});

test('voxel document loads the saved project format', () => {
  const source = new VoxelDocument({ x: 8, y: 9, z: 10 });
  source.currentColor = '#123456';
  source.setSceneBackgroundColor('#345678');
  source.setVoxel(2, 3, 4, '#abcdef');

  const restored = new VoxelDocument();
  restored.load(source.toJSON());
  assert.deepEqual(restored.size, { x: 8, y: 9, z: 10 });
  assert.equal(restored.currentColor, '#123456');
  assert.equal(restored.sceneBackgroundColor, '#345678');
  assert.equal(restored.get(2, 3, 4)?.color, '#abcdef');
});

test('voxel projects default and validate the persisted scene background color', () => {
  const document = new VoxelDocument();
  assert.equal(document.sceneBackgroundColor, '#090c11');

  const withoutSceneSettings = document.toJSON();
  delete withoutSceneSettings.scene;
  document.setSceneBackgroundColor('#abcdef');
  document.load(withoutSceneSettings);
  assert.equal(document.sceneBackgroundColor, '#090c11');

  const before = document.toJSON();
  assert.throws(() => document.load({ ...before, scene: { backgroundColor: 'invalid' } }), /无效颜色/);
  assert.deepEqual(document.toJSON(), before);
});

test('failed project loads leave the complete document unchanged', () => {
  const document = new VoxelDocument({ x: 8, y: 9, z: 10 });
  document.setVoxel(2, 0, 3, '#123456');
  const module = document.createModule('保留模块', { x: 2, y: 2, z: 2 });
  document.setVoxel(1, 1, 1, '#abcdef');
  document.editScene();
  const layer = document.createLayer('保留图层');
  const instance = document.addModuleInstance(module.id, { x: 4, y: 0, z: 4 }, layer.id);
  const animation = document.createAnimation('保留动画', 6, 12);
  document.setAnimationKeyframe(animation.id, instance.id, 2, instance);
  document.editModule(module.id);

  const before = document.toJSON();
  const beforeScene = [...document.sceneVoxels.entries()];
  const beforeEditingModuleId = document.editingModuleId;
  let changes = 0;
  document.addEventListener('change', () => { changes += 1; });

  assert.throws(() => document.load({
    format: 'haiyue-voxel',
    version: 1,
    size: { x: 4, y: 4, z: 4 },
    voxels: [{ x: 0, y: 0, z: 0, color: '#ff0000' }],
    modules: [{
      id: 'broken-module',
      name: '损坏模块',
      size: { x: 2, y: 2, z: 2 },
      voxels: [{ x: 0, y: 0, z: 0, color: 'invalid-color' }],
    }],
  }), /无效颜色/);

  assert.deepEqual(document.toJSON(), before);
  assert.deepEqual([...document.sceneVoxels.entries()], beforeScene);
  assert.equal(document.editingModuleId, beforeEditingModuleId);
  assert.equal(changes, 0);
});

test('document change events scope UI and render invalidation', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const changes = [];
  document.addEventListener('change', event => changes.push(event.detail));

  document.currentColor = '#123456';
  assert.deepEqual(changes.at(-1), {
    reason: 'color',
    dirty: {
      scene: false, view: false, render: false,
      palette: true, modules: false, animation: false, grid: false,
      selection: 'none',
    },
    impact: { fullRender: false, voxelKeys: [], instanceIds: [], materialIds: [] },
  });

  document.setSceneBackgroundColor('#123456');
  assert.deepEqual(changes.at(-1), {
    reason: 'scene-background',
    dirty: {
      scene: false, view: false, render: false,
      palette: false, modules: false, animation: false, grid: false,
      selection: 'none',
    },
    impact: { fullRender: false, voxelKeys: [], instanceIds: [], materialIds: [] },
  });

  document.setVoxel(1, 1, 1);
  assert.deepEqual(changes.at(-1), {
    reason: 'add',
    dirty: {
      scene: true, view: true, render: true,
      palette: true, modules: true, animation: false, grid: false,
      selection: 'retain',
    },
    impact: {
      fullRender: false,
      voxelKeys: [packVoxelKey(1, 1, 1)],
      instanceIds: [],
      materialIds: [document.currentMaterialId],
    },
  });

  document.createLayer('仅更新模块树');
  assert.deepEqual(changes.at(-1), {
    reason: 'layer-create',
    dirty: {
      scene: false, view: false, render: false,
      palette: false, modules: true, animation: false, grid: false,
      selection: 'none',
    },
    impact: { fullRender: false, voxelKeys: [], instanceIds: [], materialIds: [] },
  });
});

test('shape generator creates bounded boxes, shells, disks, spheres and cylinders', () => {
  const sceneSize = { x: 10, y: 10, z: 10 };
  const reversedCube = { min: { x: 2, y: 2, z: 2 }, max: { x: 0, y: 0, z: 0 } };
  assert.equal(Array.from(generateShapeVoxels('box', reversedCube, sceneSize)).length, 27);
  assert.equal(Array.from(generateShapeVoxels('box-shell', reversedCube, sceneSize)).length, 26);

  const fiveCube = { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 4 } };
  const disk = Array.from(generateShapeVoxels('disk', fiveCube, sceneSize));
  assert.equal(disk.length, 21);
  assert.equal(disk.every(voxel => voxel.y === 2), true);
  assert.equal(Array.from(generateShapeVoxels('cylinder', fiveCube, sceneSize)).length, 105);

  const sphere = Array.from(generateShapeVoxels('sphere', reversedCube, sceneSize));
  const sphereShell = Array.from(generateShapeVoxels('sphere-shell', reversedCube, sceneSize));
  assert.equal(sphere.length, 19);
  assert.equal(sphereShell.length, 18);
});

test('batch generation updates the document in one change and applies the selected color', () => {
  const document = new VoxelDocument({ x: 10, y: 10, z: 10 });
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } };
  let changes = 0;
  document.addEventListener('change', () => { changes += 1; });

  const added = document.setVoxels(generateShapeVoxels('box', bounds, document.size), '#ff0000');
  assert.deepEqual(added, { added: 27, painted: 0, unchanged: 0 });
  assert.equal(changes, 1);
  const painted = document.setVoxels(generateShapeVoxels('box-shell', bounds, document.size), '#00ff00');
  assert.deepEqual(painted, { added: 0, painted: 26, unchanged: 0 });
  assert.equal(changes, 2);
  assert.equal(document.get(1, 1, 1)?.color, '#ff0000');
  assert.equal(document.get(0, 0, 0)?.color, '#00ff00');
});

test('module instances override base voxels and module edits update every instance', () => {
  const document = new VoxelDocument({ x: 12, y: 12, z: 12 });
  document.setVoxel(2, 0, 2, '#0000ff');

  const module = document.createModule('双格模块', { x: 2, y: 1, z: 1 });
  document.setVoxel(0, 0, 0, '#ff0000');
  document.setVoxel(1, 0, 0, '#00ff00');
  const first = document.addModuleInstance(module.id, { x: 2, y: 0, z: 2 });
  const second = document.addModuleInstance(module.id, { x: 6, y: 0, z: 2 });

  assert.equal(document.sceneVoxelCount, 4);
  assert.equal(document.sceneVoxels.get('2,0,2')?.color, '#ff0000');
  assert.equal(document.sceneVoxels.get('2,0,2')?.source, 'module-instance');
  assert.equal(document.hasModuleInstanceCollision(first.id), true);
  assert.equal(document.hasModuleInstanceCollision(second.id), false);

  document.editModule(module.id);
  document.setVoxel(0, 0, 0, '#ffff00');
  document.editScene();
  assert.equal(document.sceneVoxels.get('2,0,2')?.color, '#ffff00');
  assert.equal(document.sceneVoxels.get('6,0,2')?.color, '#ffff00');
});

test('overlapping module instances are both marked and survive JSON round trips', () => {
  const source = new VoxelDocument({ x: 10, y: 10, z: 10 });
  const module = source.createModule('重叠测试', { x: 2, y: 1, z: 1 });
  source.setVoxels([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], '#abcdef');
  const first = source.addModuleInstance(module.id, { x: 1, y: 0, z: 1 });
  const second = source.addModuleInstance(module.id, { x: 2, y: 0, z: 1 });

  assert.equal(source.hasModuleInstanceCollision(first.id), true);
  assert.equal(source.hasModuleInstanceCollision(second.id), true);
  assert.deepEqual(source.getModuleInstanceCollisions(first.id), [{ x: 2, y: 0, z: 1 }]);
  assert.deepEqual(source.getModuleInstanceCollisions(second.id), [{ x: 2, y: 0, z: 1 }]);
  assert.equal(source.sceneVoxelCount, 3);

  const restored = new VoxelDocument();
  restored.load(source.toJSON());
  assert.equal(restored.modules.length, 1);
  assert.equal(restored.moduleInstances.length, 2);
  assert.equal(restored.sceneVoxelCount, 3);
  assert.equal(restored.hasModuleInstanceCollision(first.id), true);
  assert.equal(restored.hasModuleInstanceCollision(second.id), true);

  const nextModule = restored.createModule('新模块');
  assert.notEqual(nextModule.id, module.id);
  assert.throws(() => restored.addModuleInstance(nextModule.id, { x: Number.NaN, y: 0, z: 0 }), /坐标无效/);
});

test('base voxels belong to layers for visibility, locking, serialization and layer removal', () => {
  const source = new VoxelDocument({ x: 10, y: 10, z: 10 });
  source.setVoxel(1, 0, 1, '#ff0000');
  const layer = source.createLayer('建筑体素');
  source.setActiveVoxelLayer(layer.id);
  source.setVoxel(2, 0, 1, '#00ff00');

  assert.equal(source.get(1, 0, 1)?.layerId, undefined);
  assert.equal(source.get(2, 0, 1)?.layerId, layer.id);
  assert.equal(source.getBaseVoxelCountInLayer('layer-1'), 1);
  assert.equal(source.getBaseVoxelCountInLayer(layer.id), 1);

  source.updateLayer(layer.id, { visible: false });
  assert.equal(source.sceneVoxels.has('1,0,1'), true);
  assert.equal(source.sceneVoxels.has('2,0,1'), false);
  assert.throws(() => source.setVoxel(3, 0, 1, '#abcdef'), /隐藏或锁定/);

  source.updateLayer(layer.id, { visible: true, locked: true });
  assert.throws(() => source.setVoxel(2, 0, 1, '#abcdef'), /隐藏或锁定/);

  const restored = new VoxelDocument();
  restored.load(source.toJSON());
  assert.equal(restored.get(2, 0, 1)?.layerId, layer.id);
  assert.deepEqual(restored.getLayer(layer.id), { id: layer.id, name: '建筑体素', visible: true, locked: true });
  restored.removeLayer(layer.id);
  assert.equal(restored.get(2, 0, 1)?.layerId, undefined);
  assert.equal(restored.getBaseVoxelCountInLayer('layer-1'), 2);
});

test('module instance transforms and layers affect scene composition and survive JSON', () => {
  const source = new VoxelDocument({ x: 16, y: 16, z: 16 });
  const module = source.createModule('可变换模块', { x: 2, y: 1, z: 1 });
  source.setVoxel(0, 0, 0, '#ff0000');
  source.setVoxel(1, 0, 0, '#00ff00');
  const layer = source.createLayer('建筑');
  const instance = source.addModuleInstance(module.id, { x: 5, y: 0, z: 5 }, layer.id);
  source.updateModuleInstance(instance.id, {
    rotation: { x: 0, y: 0, z: 1 },
    scale: { x: 2, y: 1, z: 1 },
  });

  assert.equal(source.sceneVoxelCount, 4);
  assert.equal(source.sceneVoxels.get('5,3,5')?.color, '#ff0000');
  assert.equal(source.sceneVoxels.get('5,0,5')?.color, '#00ff00');
  source.updateLayer(layer.id, { visible: false, locked: true });
  assert.equal(source.sceneVoxelCount, 0);

  const restored = new VoxelDocument();
  restored.load(source.toJSON());
  assert.deepEqual(restored.getLayer(layer.id), { id: layer.id, name: '建筑', visible: false, locked: true });
  assert.deepEqual(restored.getModuleInstance(instance.id)?.rotation, { x: 0, y: 0, z: 1 });
  restored.updateLayer(layer.id, { visible: true });
  assert.equal(restored.sceneVoxelCount, 4);
  restored.removeLayer(layer.id);
  assert.equal(restored.getModuleInstance(instance.id)?.layerId, 'layer-1');
});

test('legacy projects load module instances into the default layer', () => {
  const restored = new VoxelDocument();
  restored.load({
    format: 'haiyue-voxel', version: 1,
    size: { x: 8, y: 8, z: 8 }, editor: { currentColor: '#ffffff' }, voxels: [],
    modules: [{ id: 'module-1', name: '旧模块', size: { x: 1, y: 1, z: 1 }, voxels: [{ x: 0, y: 0, z: 0, color: '#abcdef' }] }],
    moduleInstances: [{ id: 'module-instance-1', moduleId: 'module-1', name: '旧实例', position: { x: 1, y: 2, z: 3 } }],
  });
  const instance = restored.moduleInstances[0];
  assert.equal(instance.layerId, 'layer-1');
  assert.deepEqual(instance.rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(instance.scale, { x: 1, y: 1, z: 1 });
});

test('animation keyframes step module transforms, visibility and module variants and survive JSON', () => {
  const document = new VoxelDocument({ x: 12, y: 6, z: 6 });
  const red = document.createModule('红', { x: 1, y: 1, z: 1 });
  document.setVoxel(0, 0, 0, '#ff0000');
  const blue = document.createModule('蓝', { x: 1, y: 1, z: 1 });
  document.setVoxel(0, 0, 0, '#0000ff');
  const instance = document.addModuleInstance(red.id, { x: 1, y: 0, z: 1 });
  const clip = document.createAnimation('移动与换色', 4, 8);
  document.setAnimationKeyframe(clip.id, instance.id, 0, instance);
  document.setAnimationKeyframe(clip.id, instance.id, 2, {
    ...instance, moduleId: blue.id, position: { x: 5, y: 0, z: 1 }, visible: true,
  });
  document.setAnimationKeyframe(clip.id, instance.id, 3, {
    ...instance, moduleId: blue.id, position: { x: 5, y: 0, z: 1 }, visible: false,
  });

  document.setAnimationFrame(1);
  assert.equal(document.sceneVoxels.get('1,0,1')?.color, '#ff0000');
  const sampledFrame = document.sceneVoxelsAtFrame(2);
  assert.equal(sampledFrame.get('5,0,1')?.color, '#0000ff');
  assert.equal(document.animationFrame, 1);
  document.setAnimationFrame(2);
  assert.equal(document.sceneVoxels.get('5,0,1')?.color, '#0000ff');
  assert.equal(document.getEvaluatedModuleInstance(instance.id)?.moduleId, blue.id);
  document.setAnimationFrame(3);
  assert.equal(document.sceneVoxelCount, 0);

  const restored = new VoxelDocument();
  restored.load(document.toJSON());
  assert.equal(restored.activeAnimation?.name, '移动与换色');
  assert.equal(restored.activeAnimation?.fps, 8);
  assert.equal(restored.animationFrame, 3);
  assert.equal(restored.activeAnimation?.playbackStart, 0);
  assert.equal(restored.activeAnimation?.playbackEnd, 3);
  assert.equal(restored.sceneVoxelCount, 0);
  restored.setAnimationFrame(2);
  assert.equal(restored.sceneVoxels.get('5,0,1')?.color, '#0000ff');
});

test('independent PBR palette materials can share a color and survive JSON and glTF export', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const metal = document.createPaletteMaterial('#336699', '蓝色金属');
  document.updatePaletteMaterial(metal.id, { metallic: 0.92, roughness: 0.18 });
  const plastic = document.createPaletteMaterial('#336699', '蓝色塑料');
  document.updatePaletteMaterial(plastic.id, { metallic: 0.02, roughness: 0.74 });

  document.selectPaletteMaterial(metal.id);
  document.setVoxel(1, 0, 1);
  document.selectPaletteMaterial(plastic.id);
  document.setVoxel(2, 0, 1);
  assert.equal(document.get(1, 0, 1)?.materialId, metal.id);
  assert.equal(document.get(2, 0, 1)?.materialId, plastic.id);

  const result = exportVoxelsAsGltf(document.size, document.sceneVoxels.values(), document.paletteMaterials);
  const gltf = JSON.parse(result.json);
  assert.equal(gltf.meshes[0].primitives.length, 2);
  assert.deepEqual(gltf.materials.map(material => material.name), ['蓝色金属', '蓝色塑料']);
  assert.deepEqual(gltf.materials.map(material => material.pbrMetallicRoughness.metallicFactor), [0.92, 0.02]);
  assert.deepEqual(gltf.materials.map(material => material.pbrMetallicRoughness.roughnessFactor), [0.18, 0.74]);
  assert.equal(gltf.materials[0].extras.haiyueMaterialId, metal.id);

  const restored = new VoxelDocument();
  restored.load(document.toJSON());
  assert.equal(restored.get(1, 0, 1)?.materialId, metal.id);
  assert.equal(restored.getPaletteMaterial(plastic.id).roughness, 0.74);
  assert.throws(() => restored.removePaletteMaterial(metal.id), /仍被体素使用/);
});

test('glTF export merges voxels and removes their shared face', () => {
  const document = new VoxelDocument({ x: 50, y: 50, z: 50 });
  document.setVoxel(1, 0, 1, '#ff0000');
  document.setVoxel(2, 0, 1, '#00ff00');

  const result = exportVoxelsAsGltf(document.size, document.voxels.values());
  const gltf = JSON.parse(result.json);
  assert.equal(result.exposedFaceCount, 10);
  assert.equal(result.vertexCount, 40);
  assert.equal(result.triangleCount, 20);
  assert.equal(gltf.asset.version, '2.0');
  assert.equal(gltf.meshes[0].primitives.length, 2);
  assert.equal(gltf.materials.length, 2);
  assert.deepEqual(gltf.materials.map(material => material.extras.haiyueVoxelColor), ['#00ff00', '#ff0000']);
  assert.deepEqual(gltf.materials[0].pbrMetallicRoughness.baseColorFactor, [0, 1, 0, 1]);
  assert.deepEqual(gltf.materials[1].pbrMetallicRoughness.baseColorFactor, [1, 0, 0, 1]);
  assert.deepEqual(gltf.meshes[0].primitives.map(primitive => primitive.material), [0, 1]);
  assert.match(gltf.buffers[0].uri, /^data:application\/octet-stream;base64,/);
  assert.equal(gltf.bufferViews.every(view => view.byteOffset % 4 === 0), true);
});

test('glTF export greedily merges a solid 3x3x3 color block into six large faces', () => {
  const document = new VoxelDocument({ x: 3, y: 3, z: 3 });
  for (let y = 0; y < 3; y++) {
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) document.setVoxel(x, y, z, '#4f83e1');
    }
  }

  const result = exportVoxelsAsGltf(document.size, document.voxels.values());
  const gltf = JSON.parse(result.json);
  assert.equal(result.exposedFaceCount, 6);
  assert.equal(result.vertexCount, 24);
  assert.equal(result.triangleCount, 12);
  assert.equal(gltf.meshes[0].primitives.length, 1);
  assert.equal(gltf.materials.length, 1);
  assert.deepEqual(gltf.accessors[0].min, [-1.5, 0, -1.5]);
  assert.deepEqual(gltf.accessors[0].max, [1.5, 3, 1.5]);
});

test('GLB export embeds aligned JSON and binary chunks without a Base64 URI', () => {
  const document = new VoxelDocument({ x: 4, y: 4, z: 4 });
  document.setVoxel(1, 0, 1, '#ff0000');
  const progress = [];
  const result = exportVoxelsAsGlb(
    document.size,
    document.voxels.values(),
    document.paletteMaterials,
    value => progress.push(value),
  );
  const view = new DataView(result.data.buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), result.data.byteLength);
  const jsonLength = view.getUint32(12, true);
  assert.equal(jsonLength % 4, 0);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const json = JSON.parse(new TextDecoder().decode(result.data.subarray(20, 20 + jsonLength)).trim());
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.buffers[0].uri, undefined);
  assert.equal(view.getUint32(20 + jsonLength + 4, true), 0x004e4942);
  assert.equal(progress.at(-1), 1);
});

test('glTF export rejects an empty scene', () => {
  const document = new VoxelDocument();
  assert.throws(() => exportVoxelsAsGltf(document.size, document.voxels.values()), /没有可导出的体素/);
});
