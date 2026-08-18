import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnimationCreateCommand,
  AnimationDuplicateCommand,
  AnimationKeyframeCommand,
  AnimationRemoveCommand,
  AnimationUpdateCommand,
  ClearDocumentCommand,
  CommandHistory,
  createDeleteAnimationKeyframesCommand,
  createMoveAnimationKeyframesCommand,
  createPasteAnimationKeyframesCommand,
  createAssignVoxelsLayerCommand,
  createRemoveVoxelCommand,
  createReplaceVoxelsCommand,
  createSetVoxelsCommand,
  DocumentSnapshotCommand,
  LayerCreateCommand,
  LayerRemoveCommand,
  LayerUpdateCommand,
  ModuleCreateCommand,
  ModuleInstanceCreateCommand,
  ModuleInstanceRemoveCommand,
  ModuleInstanceTransformCommand,
  ModuleRemoveCommand,
  ModuleRenameCommand,
  PaletteMaterialCreateCommand,
  PaletteMaterialRemoveCommand,
  PaletteMaterialUpdateCommand,
  SceneBackgroundColorCommand,
  SceneResizeCommand,
} from '../dist/commands.js';
import { VoxelDocument } from '../dist/model.js';

test('voxel commands execute, undo and redo compact patches', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const history = new CommandHistory();
  const { command, result } = createSetVoxelsCommand(document, [
    { x: 1, y: 2, z: 3 },
    { x: 1, y: 2, z: 3 },
    { x: 2, y: 2, z: 3 },
  ], '#ff0000', '添加方块');

  assert.deepEqual(result, { added: 2, painted: 0, unchanged: 1 });
  assert.equal(history.execute(command), true);
  assert.equal(document.voxelCount, 2);
  assert.equal(history.undo(), '添加方块');
  assert.equal(document.voxelCount, 0);
  assert.equal(history.redo(), '添加方块');
  assert.equal(document.get(1, 2, 3)?.color, '#ff0000');

  const remove = createRemoveVoxelCommand(document, { x: 1, y: 2, z: 3 });
  assert.equal(history.execute(remove), true);
  assert.equal(document.get(1, 2, 3), undefined);
  history.undo();
  assert.equal(document.get(1, 2, 3)?.color, '#ff0000');
});

test('already-applied commands can be recorded without executing them twice', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const history = new CommandHistory();
  const { command } = createSetVoxelsCommand(
    document,
    [{ x: 1, y: 2, z: 3 }],
    '#ff0000',
    '连续笔刷添加方块',
  );
  const execute = command.execute.bind(command);
  let executeCount = 0;
  command.execute = () => {
    executeCount += 1;
    return execute();
  };

  assert.equal(command.execute(), true);
  assert.equal(executeCount, 1);
  history.recordApplied(command);
  assert.equal(executeCount, 1);
  assert.equal(history.canUndo, true);
  assert.equal(document.voxelCount, 1);
  assert.equal(history.undo(), '连续笔刷添加方块');
  assert.equal(document.voxelCount, 0);
  assert.equal(history.redo(), '连续笔刷添加方块');
  assert.equal(executeCount, 2);
  assert.equal(document.get(1, 2, 3)?.color, '#ff0000');
});

test('history evicts oldest commands when its memory budget is exceeded', () => {
  const history = new CommandHistory(100, 2_500);
  let value = 0;
  for (let index = 0; index < 3; index += 1) {
    history.execute({
      label: `命令 ${index}`,
      estimatedBytes: 1_000,
      execute() { value += 1; return true; },
      undo() { value -= 1; },
    });
  }

  assert.equal(value, 3);
  assert.equal(history.estimatedBytes, 2_000);
  assert.equal(history.undo(), '命令 2');
  assert.equal(history.undo(), '命令 1');
  assert.equal(history.undo(), null);
  assert.equal(value, 1);

  history.execute({
    label: '超大命令',
    estimatedBytes: 3_000,
    execute() { value += 1; return true; },
    undo() { value -= 1; },
  });
  assert.equal(history.estimatedBytes, 0);
  assert.equal(history.canUndo, false);
  assert.equal(value, 2);
});

test('palette commands retain only material deltas and fully support undo and redo', () => {
  const document = new VoxelDocument({ x: 32, y: 32, z: 32 });
  for (let index = 0; index < 4_000; index += 1) {
    document.setVoxel(index % 32, Math.floor(index / 1024), Math.floor(index / 32) % 32, '#69d2e7');
  }
  const history = new CommandHistory();
  const create = new PaletteMaterialCreateCommand(document, '#123456', '测试材质', { metallic: 0.8, roughness: 0.2 });
  history.execute(create);
  const materialId = create.material.id;
  assert.ok(create.estimatedBytes < 2_000);
  assert.equal(document.currentMaterialId, materialId);

  history.execute(new PaletteMaterialUpdateCommand(document, materialId, { name: '已修改', roughness: 0.4 }));
  assert.equal(document.getPaletteMaterial(materialId).name, '已修改');
  history.undo();
  assert.equal(document.getPaletteMaterial(materialId).name, '测试材质');
  history.undo();
  assert.equal(document.paletteMaterials.some(material => material.id === materialId), false);
  history.redo();
  assert.equal(document.getPaletteMaterial(materialId).metallic, 0.8);

  const remove = new PaletteMaterialRemoveCommand(document, materialId);
  history.execute(remove);
  assert.equal(document.paletteMaterials.some(material => material.id === materialId), false);
  history.undo();
  assert.equal(document.getPaletteMaterial(materialId).name, '测试材质');
});

test('module voxel undo does not switch the active editing target', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const module = document.createModule('模块', { x: 4, y: 4, z: 4 });
  const history = new CommandHistory();
  const { command } = createSetVoxelsCommand(document, [{ x: 1, y: 1, z: 1 }], '#abcdef', '模块添加方块');
  history.execute(command);
  document.editScene();

  history.undo();
  assert.equal(document.editingModuleId, null);
  assert.equal(document.getModule(module.id)?.voxels.length, 0);
  history.redo();
  assert.equal(document.editingModuleId, null);
  assert.equal(document.getModule(module.id)?.voxels[0]?.color, '#abcdef');
});

test('snapshot commands restore structural document changes and clear redo after a new command', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  document.setVoxel(1, 0, 1, '#123456');
  const history = new CommandHistory();
  history.execute(new DocumentSnapshotCommand(document, '清空场景', () => document.clear()));
  assert.equal(document.voxelCount, 0);
  history.undo();
  assert.equal(document.get(1, 0, 1)?.color, '#123456');
  history.redo();
  assert.equal(document.voxelCount, 0);
  history.undo();

  const { command } = createSetVoxelsCommand(document, [{ x: 2, y: 0, z: 2 }], '#654321', '添加新方块');
  history.execute(command);
  assert.equal(history.canRedo, false);
  assert.equal(document.voxelCount, 2);
});

test('selection replacement is atomic and restores overwritten voxels on undo', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  document.setVoxel(1, 1, 1, '#ff0000');
  document.setVoxel(2, 1, 1, '#0000ff');
  const history = new CommandHistory();
  const command = createReplaceVoxelsCommand(
    document,
    [{ x: 1, y: 1, z: 1 }],
    [{ x: 2, y: 1, z: 1, color: '#ff0000' }],
    '移动选择',
  );

  assert.equal(history.execute(command), true);
  assert.equal(document.get(1, 1, 1), undefined);
  assert.equal(document.get(2, 1, 1)?.color, '#ff0000');
  assert.equal(history.undo(), '移动选择');
  assert.equal(document.get(1, 1, 1)?.color, '#ff0000');
  assert.equal(document.get(2, 1, 1)?.color, '#0000ff');
});

test('module instance transform commands undo and redo complete transform state', () => {
  const document = new VoxelDocument({ x: 12, y: 12, z: 12 });
  const module = document.createModule('模块', { x: 1, y: 1, z: 1 });
  document.setVoxel(0, 0, 0, '#abcdef');
  const before = document.addModuleInstance(module.id, { x: 1, y: 0, z: 1 });
  const after = {
    ...before,
    position: { x: 4, y: 2, z: 3 },
    rotation: { x: 0, y: 1, z: 0 },
    scale: { x: 2, y: 1, z: 1 },
  };
  const history = new CommandHistory();
  assert.equal(history.execute(new ModuleInstanceTransformCommand(document, before, after)), true);
  assert.deepEqual(document.getModuleInstance(before.id)?.position, after.position);
  assert.deepEqual(document.getModuleInstance(before.id)?.scale, after.scale);
  history.undo();
  assert.deepEqual(document.getModuleInstance(before.id)?.position, before.position);
  history.redo();
  assert.deepEqual(document.getModuleInstance(before.id)?.rotation, after.rotation);
});

test('an already-applied module Gizmo transform is recorded without replaying the transform', () => {
  const document = new VoxelDocument({ x: 16, y: 16, z: 16 });
  const module = document.createModule('Gizmo module', { x: 2, y: 2, z: 2 });
  document.setVoxel(0, 0, 0, '#ff0000');
  document.editScene();
  const before = document.addModuleInstance(module.id, { x: 1, y: 0, z: 1 });
  const after = { ...before, position: { x: 6, y: 2, z: 3 } };
  let transformChanges = 0;
  document.addEventListener('change', event => {
    if (event.detail.reason === 'module-instance-transform') transformChanges += 1;
  });
  document.updateModuleInstance(before.id, { position: after.position });
  const history = new CommandHistory();

  history.recordApplied(new ModuleInstanceTransformCommand(document, before, after, 'Gizmo 移动模块实例'));

  assert.equal(transformChanges, 1);
  assert.deepEqual(document.getModuleInstance(before.id)?.position, after.position);
  assert.equal(history.undo(), 'Gizmo 移动模块实例');
  assert.deepEqual(document.getModuleInstance(before.id)?.position, before.position);
  assert.equal(history.redo(), 'Gizmo 移动模块实例');
  assert.deepEqual(document.getModuleInstance(before.id)?.position, after.position);
});

test('painting with the same base color can switch independent PBR material references', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const matte = document.createPaletteMaterial('#445566', '哑光');
  const metal = document.createPaletteMaterial('#445566', '金属');
  document.updatePaletteMaterial(metal.id, { metallic: 1, roughness: 0.1 });
  const history = new CommandHistory();

  document.selectPaletteMaterial(matte.id);
  let created = createSetVoxelsCommand(document, [{ x: 1, y: 1, z: 1 }], '#445566', '添加哑光体素');
  history.execute(created.command);
  assert.equal(document.get(1, 1, 1)?.materialId, matte.id);

  document.selectPaletteMaterial(metal.id);
  created = createSetVoxelsCommand(document, [{ x: 1, y: 1, z: 1 }], '#445566', '切换金属材质');
  assert.equal(created.result.painted, 1);
  history.execute(created.command);
  assert.equal(document.get(1, 1, 1)?.materialId, metal.id);
  history.undo();
  assert.equal(document.get(1, 1, 1)?.materialId, matte.id);
});

test('layer and module instance commands restore only affected structure', () => {
  const document = new VoxelDocument({ x: 16, y: 16, z: 16 });
  const history = new CommandHistory();
  const moduleCommand = new ModuleCreateCommand(
    document,
    '墙体',
    { x: 4, y: 4, z: 4 },
    [{ x: 0, y: 0, z: 0, color: '#69d2e7' }],
    false,
  );
  history.execute(moduleCommand);
  const moduleId = moduleCommand.module.id;

  const layerCommand = new LayerCreateCommand(document, '建筑');
  history.execute(layerCommand);
  const layerId = layerCommand.layer.id;
  history.execute(new LayerUpdateCommand(document, layerId, { locked: true }, '锁定图层'));
  assert.equal(document.getLayer(layerId)?.locked, true);
  history.undo();
  assert.equal(document.getLayer(layerId)?.locked, false);

  document.setActiveVoxelLayer(layerId);
  document.setVoxel(4, 0, 4, '#123456');
  assert.equal(document.get(4, 0, 4)?.layerId, layerId);

  const instanceCommand = new ModuleInstanceCreateCommand(
    document,
    moduleId,
    { x: 2, y: 0, z: 3 },
    layerId,
  );
  history.execute(instanceCommand);
  const instanceId = instanceCommand.instance.id;
  history.execute(new LayerRemoveCommand(document, layerId));
  assert.equal(document.getModuleInstance(instanceId)?.layerId, 'layer-1');
  assert.equal(document.get(4, 0, 4)?.layerId, undefined);
  history.undo();
  assert.equal(document.getModuleInstance(instanceId)?.layerId, layerId);
  assert.equal(document.get(4, 0, 4)?.layerId, layerId);

  history.execute(new ModuleInstanceRemoveCommand(document, instanceId));
  assert.equal(document.getModuleInstance(instanceId), null);
  history.undo();
  assert.equal(document.getModuleInstance(instanceId)?.moduleId, moduleId);
});

test('base voxel layer assignment and module asset commands are undoable deltas', () => {
  const document = new VoxelDocument({ x: 12, y: 12, z: 12 });
  const history = new CommandHistory();
  document.setVoxel(1, 0, 1, '#123456');
  const layer = document.createLayer('道具');

  const assign = createAssignVoxelsLayerCommand(document, [{ x: 1, y: 0, z: 1 }], layer.id);
  assert.equal(history.execute(assign), true);
  assert.equal(document.get(1, 0, 1)?.layerId, layer.id);
  history.undo();
  assert.equal(document.get(1, 0, 1)?.layerId, undefined);
  history.redo();
  assert.equal(document.get(1, 0, 1)?.layerId, layer.id);

  const module = document.createModule('原始模块', { x: 2, y: 2, z: 2 });
  document.setVoxel(0, 0, 0, '#abcdef');
  document.editScene();
  assert.equal(history.execute(new ModuleRenameCommand(document, module.id, '重命名模块')), true);
  assert.equal(document.getModule(module.id)?.name, '重命名模块');
  history.undo();
  assert.equal(document.getModule(module.id)?.name, '原始模块');
  history.redo();
  assert.equal(document.getModule(module.id)?.name, '重命名模块');

  assert.equal(history.execute(new ModuleRemoveCommand(document, module.id)), true);
  assert.equal(document.getModule(module.id), null);
  history.undo();
  assert.equal(document.getModule(module.id)?.voxels.length, 1);
  const instance = document.addModuleInstance(module.id, { x: 3, y: 0, z: 3 });
  assert.throws(() => new ModuleRemoveCommand(document, module.id), /仍被/);
  document.removeModuleInstance(instance.id);
});

test('image-style module creation restores only its module and generated palette entries', () => {
  const document = new VoxelDocument({ x: 16, y: 16, z: 16 });
  const history = new CommandHistory();
  const paletteSize = document.paletteMaterials.length;
  const command = new ModuleCreateCommand(
    document,
    '图片模块',
    { x: 2, y: 1, z: 1 },
    [
      { x: 0, y: 0, z: 0, color: '#123456' },
      { x: 1, y: 0, z: 0, color: '#654321' },
    ],
    false,
    '导入图片为模块',
  );

  history.execute(command);
  const moduleId = command.module.id;
  assert.equal(document.getModule(moduleId)?.voxels.length, 2);
  assert.equal(document.paletteMaterials.length, paletteSize + 2);
  history.undo();
  assert.equal(document.getModule(moduleId), null);
  assert.equal(document.paletteMaterials.length, paletteSize);
  history.redo();
  assert.deepEqual(document.getModule(moduleId)?.voxels.map(voxel => voxel.color).sort(), ['#123456', '#654321']);
});

test('animation commands preserve clip and keyframe deltas across undo and redo', () => {
  const document = new VoxelDocument({ x: 16, y: 16, z: 16 });
  const module = document.createModule('角色', { x: 2, y: 2, z: 2 });
  document.editScene();
  const instance = document.addModuleInstance(module.id, { x: 0, y: 0, z: 0 });
  const history = new CommandHistory();
  const create = new AnimationCreateCommand(document, '行走', 12, 12);
  history.execute(create);
  const animationId = create.clip.id;

  history.execute(new AnimationKeyframeCommand(document, animationId, instance.id, 4, {
    ...instance,
    position: { x: 4, y: 0, z: 0 },
  }));
  assert.equal(document.getAnimationKeyframe(animationId, instance.id, 4)?.position.x, 4);
  history.undo();
  assert.equal(document.getAnimationKeyframe(animationId, instance.id, 4), null);
  history.redo();
  assert.equal(document.getAnimationKeyframe(animationId, instance.id, 4)?.position.x, 4);

  history.execute(new AnimationUpdateCommand(document, animationId, { frameCount: 3, fps: 24 }));
  assert.equal(document.getAnimation(animationId)?.tracks.length, 0);
  history.undo();
  assert.equal(document.getAnimationKeyframe(animationId, instance.id, 4)?.position.x, 4);

  history.execute(new AnimationRemoveCommand(document, animationId));
  assert.equal(document.getAnimation(animationId), null);
  history.undo();
  assert.equal(document.getAnimationKeyframe(animationId, instance.id, 4)?.position.x, 4);

  history.execute(new ModuleInstanceRemoveCommand(document, instance.id));
  assert.equal(document.getAnimation(animationId)?.tracks.length, 0);
  history.undo();
  assert.equal(document.getAnimationKeyframe(animationId, instance.id, 4)?.position.x, 4);
});

test('timeline commands move, duplicate, paste and delete multi-track keyframes as one undo step', () => {
  const document = new VoxelDocument({ x: 20, y: 8, z: 8 });
  const module = document.createModule('演员', { x: 1, y: 1, z: 1 });
  document.setVoxel(0, 0, 0, '#abcdef');
  document.editScene();
  const first = document.addModuleInstance(module.id, { x: 0, y: 0, z: 0 });
  const second = document.addModuleInstance(module.id, { x: 0, y: 0, z: 2 });
  const clip = document.createAnimation('时间线', 12, 12);
  document.setAnimationKeyframe(clip.id, first.id, 1, { ...first, position: { x: 1, y: 0, z: 0 } });
  document.setAnimationKeyframe(clip.id, first.id, 3, { ...first, position: { x: 9, y: 0, z: 0 } });
  document.setAnimationKeyframe(clip.id, second.id, 2, { ...second, position: { x: 2, y: 0, z: 2 } });
  const history = new CommandHistory();
  const refs = [{ instanceId: first.id, frame: 1 }, { instanceId: second.id, frame: 2 }];

  assert.equal(history.execute(createMoveAnimationKeyframesCommand(document, clip.id, refs, 2)), true);
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 1), null);
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 3)?.position.x, 1);
  assert.equal(document.getAnimationKeyframe(clip.id, second.id, 4)?.position.x, 2);
  history.undo();
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 1)?.position.x, 1);
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 3)?.position.x, 9);
  assert.equal(document.getAnimationKeyframe(clip.id, second.id, 2)?.position.x, 2);
  history.redo();

  const movedRefs = [{ instanceId: first.id, frame: 3 }, { instanceId: second.id, frame: 4 }];
  assert.equal(history.execute(createMoveAnimationKeyframesCommand(document, clip.id, movedRefs, 2, true)), true);
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 3)?.position.x, 1);
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 5)?.position.x, 1);
  assert.equal(document.getAnimationKeyframe(clip.id, second.id, 6)?.position.x, 2);

  const copied = movedRefs.map(ref => ({
    instanceId: ref.instanceId,
    relativeFrame: ref.frame - 3,
    keyframe: document.getAnimationKeyframe(clip.id, ref.instanceId, ref.frame),
  }));
  assert.equal(history.execute(createPasteAnimationKeyframesCommand(document, clip.id, copied, 7)), true);
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 7)?.position.x, 1);
  assert.equal(document.getAnimationKeyframe(clip.id, second.id, 8)?.position.x, 2);

  assert.equal(history.execute(createDeleteAnimationKeyframesCommand(document, clip.id, [
    { instanceId: first.id, frame: 5 }, { instanceId: second.id, frame: 6 },
  ])), true);
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 5), null);
  assert.equal(document.getAnimationKeyframe(clip.id, second.id, 6), null);
  history.undo();
  assert.equal(document.getAnimationKeyframe(clip.id, first.id, 5)?.position.x, 1);
  assert.equal(document.getAnimationKeyframe(clip.id, second.id, 6)?.position.x, 2);
});

test('animation playback ranges and duplicated clips persist through undo and JSON', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const history = new CommandHistory();
  const create = new AnimationCreateCommand(document, '待机', 20, 10);
  history.execute(create);
  const animationId = create.clip.id;
  history.execute(new AnimationUpdateCommand(document, animationId, {
    playbackStart: 4,
    playbackEnd: 11,
    loop: true,
  }));
  assert.equal(document.getAnimation(animationId)?.playbackStart, 4);
  assert.equal(document.getAnimation(animationId)?.playbackEnd, 11);

  const duplicate = new AnimationDuplicateCommand(document, animationId, '待机循环');
  assert.equal(history.execute(duplicate), true);
  const copyId = duplicate.clip.id;
  assert.notEqual(copyId, animationId);
  assert.equal(document.activeAnimationId, copyId);
  assert.equal(document.getAnimation(copyId)?.playbackStart, 4);
  history.undo();
  assert.equal(document.getAnimation(copyId), null);
  history.redo();
  assert.equal(document.getAnimation(copyId)?.name, '待机循环');

  const restored = new VoxelDocument();
  restored.load(document.toJSON());
  assert.equal(restored.getAnimation(copyId)?.playbackStart, 4);
  assert.equal(restored.getAnimation(copyId)?.playbackEnd, 11);
});

test('resize and clear commands retain only removed scene content', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  document.setVoxel(1, 1, 1, '#ff0000');
  document.setVoxel(7, 7, 7, '#00ff00');
  const module = document.createModule('模块', { x: 1, y: 1, z: 1 });
  document.setVoxel(0, 0, 0, '#0000ff');
  document.editScene();
  const instance = document.addModuleInstance(module.id, { x: 3, y: 0, z: 3 });
  const history = new CommandHistory();

  const resize = new SceneResizeCommand(document, { x: 4, y: 4, z: 4 });
  history.execute(resize);
  assert.equal(resize.removedCount, 1);
  assert.equal(document.getTargetVoxel(null, 7, 7, 7), undefined);
  history.undo();
  assert.equal(document.getTargetVoxel(null, 7, 7, 7)?.color, '#00ff00');

  history.execute(new ClearDocumentCommand(document, '清空场景'));
  assert.equal(document.voxelCount, 0);
  assert.equal(document.getModuleInstance(instance.id), null);
  history.undo();
  assert.equal(document.voxelCount, 2);
  assert.equal(document.getModuleInstance(instance.id)?.moduleId, module.id);
  assert.equal(document.getModule(module.id)?.voxels.length, 1);
});

test('scene background color command supports undo and redo', () => {
  const document = new VoxelDocument();
  const history = new CommandHistory();
  const original = document.sceneBackgroundColor;

  assert.equal(history.execute(new SceneBackgroundColorCommand(document, '#336699')), true);
  assert.equal(document.sceneBackgroundColor, '#336699');
  assert.equal(document.toJSON().scene.backgroundColor, '#336699');
  assert.equal(history.undo(), '修改场景背景色');
  assert.equal(document.sceneBackgroundColor, original);
  assert.equal(history.redo(), '修改场景背景色');
  assert.equal(document.sceneBackgroundColor, '#336699');
  assert.equal(history.execute(new SceneBackgroundColorCommand(document, '#336699')), false);
});
