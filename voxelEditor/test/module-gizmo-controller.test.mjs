import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandHistory } from '../dist/commands.js';
import { VoxelDocument } from '../dist/model.js';
import { ModuleGizmoController } from '../dist/module-gizmo-controller.js';

function fixture() {
  const document = new VoxelDocument({ x: 16, y: 16, z: 16 });
  const module = document.createModule('Gizmo module', { x: 2, y: 2, z: 2 });
  const instance = document.addModuleInstance(module.id, { x: 1, y: 0, z: 1 });
  const history = new CommandHistory();
  let steps = 3;
  const controller = new ModuleGizmoController({
    document,
    history,
    getRenderer: () => ({
      pickModuleGizmo: () => 'x',
      moduleGizmoDragSteps: () => steps,
    }),
    getSelectedInstanceId: () => instance.id,
    getMode: () => 'move',
    getEditableSelectedInstance: () => document.getModuleInstance(instance.id),
    executeInstanceTransform: () => {
      throw new Error('move drag must use one deferred transaction');
    },
  });
  return {
    controller,
    document,
    history,
    instance,
    setSteps(value) { steps = value; },
  };
}

test('module Gizmo drag previews directly and records one undoable command', () => {
  const state = fixture();
  let documentChanges = 0;
  state.document.addEventListener('change', () => { documentChanges += 1; });
  assert.equal(state.controller.begin({ clientX: 10, clientY: 20 }), true);
  state.controller.move({ clientX: 40, clientY: 20 });
  assert.equal(state.document.getModuleInstance(state.instance.id).position.x, 4);
  assert.equal(state.history.canUndo, false);
  assert.equal(documentChanges, 0);

  assert.equal(state.controller.finish(), true);
  assert.equal(documentChanges, 1);
  assert.equal(state.history.undoLabel, 'Gizmo 移动模块实例');
  assert.equal(state.history.undo(), 'Gizmo 移动模块实例');
  assert.equal(state.document.getModuleInstance(state.instance.id).position.x, 1);
});

test('cancelling a module Gizmo drag restores the instance without history', () => {
  const state = fixture();
  let documentChanges = 0;
  state.document.addEventListener('change', () => { documentChanges += 1; });
  state.setSteps(5);
  state.controller.begin({ clientX: 10, clientY: 20 });
  state.controller.move({ clientX: 80, clientY: 20 });
  assert.equal(state.document.getModuleInstance(state.instance.id).position.x, 6);

  assert.equal(state.controller.finish(true), true);
  assert.equal(state.document.getModuleInstance(state.instance.id).position.x, 1);
  assert.equal(state.history.canUndo, false);
  assert.equal(documentChanges, 0);
});
