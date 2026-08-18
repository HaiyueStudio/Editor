import assert from 'node:assert/strict';
import test from 'node:test';

class MockElement extends EventTarget {
  constructor(value = '') {
    super();
    this.value = value;
  }
}

const elements = new Map([
  ['selection-gizmo-mode', new MockElement('move')],
  ['selection-snap', new MockElement('5')],
  ['selection-pivot-mode', new MockElement('center')],
  ['selection-pivot-x', new MockElement('0')],
  ['selection-pivot-y', new MockElement('0')],
  ['selection-pivot-z', new MockElement('0')],
]);
globalThis.document = { getElementById: id => elements.get(id) ?? null };

const { SelectionTransformController } = await import('../dist/selection-transform-controller.js');

function fixture() {
  const previews = [];
  const commits = [];
  let cleared = 0;
  let dragSteps = 7;
  let rotationTurns = -1;
  let pickedAxis = 'x';
  const renderer = {
    setSelectionTransformGizmo: () => true,
    pickSelectionGizmo: () => pickedAxis,
    selectionGizmoDragSteps: () => dragSteps,
    selectionGizmoRotationTurns: () => rotationTurns,
    setSelectionTransformPreview: voxels => previews.push(voxels.map(voxel => ({ ...voxel }))),
    clearBrushPreview: () => { cleared += 1; },
  };
  const source = [
    { x: 1, y: 2, z: 3, color: '#ff0000', source: 'scene' },
    { x: 2, y: 2, z: 3, color: '#00ff00', source: 'scene' },
  ];
  const controller = new SelectionTransformController({
    getRenderer: () => renderer,
    getSelectedVoxels: () => source,
    execute: (result, label, duplicate) => commits.push({ result, label, duplicate }),
    requestRender: () => {},
  });
  controller.setEnabled(true);
  return {
    controller,
    commits,
    previews,
    get cleared() { return cleared; },
    setDragSteps(value) { dragSteps = value; },
    setRotationTurns(value) { rotationTurns = value; },
    setPickedAxis(value) { pickedAxis = value; },
  };
}

test('selection Gizmo previews snapped movement and commits exactly once on release', () => {
  elements.get('selection-gizmo-mode').value = 'move';
  elements.get('selection-snap').value = '5';
  const state = fixture();
  assert.equal(state.controller.begin({ clientX: 20, clientY: 30, altKey: false }), true);
  state.controller.move({ clientX: 70, clientY: 30 });
  assert.deepEqual(state.previews.at(-1).map(({ x, y, z }) => ({ x, y, z })), [
    { x: 6, y: 2, z: 3 },
    { x: 7, y: 2, z: 3 },
  ]);
  assert.equal(state.commits.length, 0);
  assert.equal(state.controller.finish(), true);
  assert.equal(state.commits.length, 1);
  assert.equal(state.commits[0].duplicate, false);
  assert.match(state.commits[0].label, /移动选择/);
  assert.equal(state.controller.finish(), false);
  assert.equal(state.commits.length, 1);
});

test('Alt-drag duplicates and cancellation never commits the ghost preview', () => {
  elements.get('selection-gizmo-mode').value = 'move';
  const state = fixture();
  state.controller.begin({ clientX: 20, clientY: 30, altKey: true });
  state.controller.move({ clientX: 70, clientY: 30 });
  state.controller.finish();
  assert.equal(state.commits[0].duplicate, true);

  state.controller.begin({ clientX: 20, clientY: 30, altKey: false });
  state.controller.move({ clientX: 70, clientY: 30 });
  state.controller.finish(true);
  assert.equal(state.commits.length, 1);
});

test('rotation ring waits for drag and previews quantized 90-degree turns', () => {
  elements.get('selection-gizmo-mode').value = 'rotate';
  const state = fixture();
  state.setPickedAxis('y');
  state.controller.begin({ clientX: 20, clientY: 30, altKey: false });
  assert.equal(state.previews.length, 0);
  state.controller.move({ clientX: 20, clientY: 80 });
  assert.deepEqual(state.previews.at(-1).map(({ x, y, z }) => ({ x, y, z })), [
    { x: 2, y: 2, z: 3 },
    { x: 2, y: 2, z: 4 },
  ]);
  state.controller.finish();
  assert.equal(state.commits.length, 1);
  assert.match(state.commits[0].label, /旋转选择/);
});

test('scale handle resizes the bounding box by integer grid cells', () => {
  elements.get('selection-gizmo-mode').value = 'scale';
  elements.get('selection-snap').value = '1';
  const state = fixture();
  state.setDragSteps(-1);
  state.controller.begin({ clientX: 20, clientY: 30, altKey: false });
  state.controller.move({ clientX: 10, clientY: 30 });
  assert.deepEqual(state.previews.at(-1).map(({ x, y, z }) => ({ x, y, z })), [
    { x: 2, y: 2, z: 3 },
  ]);
  state.controller.finish();
  assert.equal(state.commits.length, 1);
  assert.match(state.commits[0].label, /缩放选择/);
});
