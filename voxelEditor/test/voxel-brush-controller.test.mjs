import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandHistory } from '../dist/commands.js';
import { VoxelDocument } from '../dist/model.js';

test('a continuous pointer stroke creates one undoable command', async () => {
  const inputs = new Map([
    ['brush-kind', { value: 'voxel', addEventListener() {} }],
    ['brush-size', { value: '1' }],
    ['mirror-x', { checked: false }],
    ['mirror-y', { checked: false }],
    ['mirror-z', { checked: false }],
  ]);
  globalThis.document = { getElementById: id => inputs.get(id) ?? null };
  const { VoxelBrushController } = await import('../dist/voxel-brush-controller.js');
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const history = new CommandHistory();
  let historyChanges = 0;
  let documentChanges = 0;
  history.addEventListener('change', () => { historyChanges += 1; });
  document.addEventListener('change', () => { documentChanges += 1; });
  const renderer = {
    pick() {
      return { target: { x: 0, y: 0, z: 0 }, voxel: null, normal: [0, 1, 0] };
    },
    pickCellOnPlane(clientX) {
      return { x: Math.max(0, Math.min(7, Math.round(clientX))), y: 0, z: 0 };
    },
    clearBrushPreview() {},
  };
  const controller = new VoxelBrushController({
    document,
    history,
    palette: { applyColor() {} },
    getRenderer: () => renderer,
    notify() {},
  });

  controller.begin({ altKey: false, clientX: 0, clientY: 0 }, 'add');
  for (const clientX of [1, 2, 3, 4, 4]) {
    controller.move({ clientX, clientY: 0, buttons: 1 });
  }
  assert.equal(documentChanges, 0);
  controller.complete({ clientX: 4, clientY: 0 });

  assert.equal(document.voxelCount, 5);
  assert.equal(documentChanges, 1);
  assert.equal(historyChanges, 1);
  assert.equal(history.undoLabel, '笔刷添加方块');
  assert.equal(history.undo(), '笔刷添加方块');
  assert.equal(document.voxelCount, 0);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), '笔刷添加方块');
  assert.equal(document.voxelCount, 5);
});

test('cancelling a continuous stroke restores the document without creating history', async () => {
  const inputs = new Map([
    ['brush-kind', { value: 'voxel', addEventListener() {} }],
    ['brush-size', { value: '1' }],
    ['mirror-x', { checked: false }],
    ['mirror-y', { checked: false }],
    ['mirror-z', { checked: false }],
  ]);
  globalThis.document = { getElementById: id => inputs.get(id) ?? null };
  const { VoxelBrushController } = await import('../dist/voxel-brush-controller.js');
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  document.setVoxel(0, 0, 0, '#123456');
  const history = new CommandHistory();
  let documentChanges = 0;
  document.addEventListener('change', () => { documentChanges += 1; });
  const renderer = {
    pick() {
      return { target: { x: 0, y: 0, z: 0 }, voxel: null, normal: [0, 1, 0] };
    },
    pickCellOnPlane(clientX) {
      return { x: Math.max(0, Math.min(7, Math.round(clientX))), y: 0, z: 0 };
    },
    clearBrushPreview() {},
  };
  const controller = new VoxelBrushController({
    document,
    history,
    palette: { applyColor() {} },
    getRenderer: () => renderer,
    notify() {},
  });

  controller.begin({ altKey: false, clientX: 0, clientY: 0 }, 'add');
  controller.move({ clientX: 3, clientY: 0, buttons: 1 });
  assert.equal(document.voxelCount, 4);
  assert.equal(documentChanges, 0);
  controller.cancel();

  assert.equal(document.voxelCount, 1);
  assert.equal(document.get(0, 0, 0)?.color, '#123456');
  assert.equal(history.canUndo, false);
  assert.equal(controller.isActive, false);
  assert.equal(documentChanges, 0);
});

test('X mirror applies one-command add, paint, and erase strokes to both sides', async () => {
  const inputs = new Map([
    ['brush-kind', { value: 'voxel', addEventListener() {} }],
    ['brush-size', { value: '1' }],
    ['mirror-x', { checked: true }],
    ['mirror-y', { checked: false }],
    ['mirror-z', { checked: false }],
  ]);
  globalThis.document = { getElementById: id => inputs.get(id) ?? null };
  const { VoxelBrushController } = await import('../dist/voxel-brush-controller.js');
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const history = new CommandHistory();
  const renderer = {
    pick() {
      return {
        target: { x: 1, y: 0, z: 0 },
        voxel: document.getViewVoxel(1, 0, 0) ?? null,
        normal: [0, 1, 0],
      };
    },
    pickCellOnPlane() { return { x: 1, y: 0, z: 0 }; },
    clearBrushPreview() {},
  };
  const controller = new VoxelBrushController({
    document, history, palette: { applyColor() {} }, getRenderer: () => renderer, notify() {},
  });

  controller.begin({ altKey: false, clientX: 0, clientY: 0 }, 'add');
  controller.complete({ clientX: 0, clientY: 0 });
  assert.equal(document.get(1, 0, 0)?.color, '#69d2e7');
  assert.equal(document.get(6, 0, 0)?.color, '#69d2e7');

  document.currentColor = '#ff0000';
  controller.begin({ altKey: false, clientX: 0, clientY: 0 }, 'paint');
  controller.complete({ clientX: 0, clientY: 0 });
  assert.equal(document.get(1, 0, 0)?.color, '#ff0000');
  assert.equal(document.get(6, 0, 0)?.color, '#ff0000');

  controller.begin({ altKey: false, clientX: 0, clientY: 0 }, 'erase');
  controller.complete({ clientX: 0, clientY: 0 });
  assert.equal(document.voxelCount, 0);
  assert.equal(history.undoLabel, '笔刷擦除方块');
  history.undo();
  assert.equal(document.voxelCount, 2);
});

test('flood and surface brushes commit one immediate undoable patch', async () => {
  const inputs = new Map([
    ['brush-kind', { value: 'flood', addEventListener() {} }],
    ['brush-size', { value: '1' }],
    ['mirror-x', { checked: false }],
    ['mirror-y', { checked: false }],
    ['mirror-z', { checked: false }],
  ]);
  globalThis.document = { getElementById: id => inputs.get(id) ?? null };
  const { VoxelBrushController } = await import('../dist/voxel-brush-controller.js');
  const document = new VoxelDocument({ x: 6, y: 6, z: 6 });
  const positions = [];
  for (let z = 0; z < 3; z += 1) for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) positions.push({ x, y, z });
  document.setVoxels(positions, '#112233');
  document.currentColor = '#abcdef';
  const history = new CommandHistory();
  const renderer = {
    pick() {
      return { target: null, voxel: document.getViewVoxel(0, 0, 0), normal: [0, 0, -1] };
    },
    clearBrushPreview() {},
  };
  const controller = new VoxelBrushController({
    document, history, palette: { applyColor() {} }, getRenderer: () => renderer, notify() {},
  });

  controller.begin({ altKey: false, clientX: 0, clientY: 0 }, 'paint');
  assert.equal(document.get(1, 1, 1)?.color, '#abcdef');
  assert.equal(history.undoLabel, '连通填充着色');
  history.undo();

  inputs.get('brush-kind').value = 'surface';
  controller.begin({ altKey: false, clientX: 0, clientY: 0 }, 'paint');
  assert.equal(document.get(0, 0, 0)?.color, '#abcdef');
  assert.equal(document.get(1, 1, 1)?.color, '#112233');
  assert.equal(history.undoLabel, '外露表面着色');
  assert.equal(controller.isActive, false);
});
