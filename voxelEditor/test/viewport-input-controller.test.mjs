import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = new EventTarget();
globalThis.HTMLInputElement = class {};
globalThis.HTMLTextAreaElement = class {};
globalThis.HTMLSelectElement = class {};
globalThis.HTMLElement = class {};

const { ViewportInputController } = await import('../dist/viewport-input-controller.js');

class MockCanvas extends EventTarget {
  style = {};
  focus() {}
  setPointerCapture() {}
  matches() { return false; }
  getBoundingClientRect() {
    return { left: 0, right: 200, top: 0, bottom: 100 };
  }
}

function pointer(type, properties) {
  const event = new Event(type);
  Object.assign(event, properties);
  return event;
}

test('viewport input controller routes a brush gesture and releases listeners on dispose', () => {
  const canvas = new MockCanvas();
  const brushCalls = [];
  const brush = {
    isActive: false,
    begin(event, tool) {
      brushCalls.push(['begin', tool, event.clientX]);
      this.isActive = true;
    },
    complete(event) {
      brushCalls.push(['complete', event.clientX]);
      this.isActive = false;
    },
    move() {},
    cancel() { this.isActive = false; },
    adjustSize() {},
  };
  const controller = new ViewportInputController({
    canvas,
    coordinate: { textContent: '' },
    selectionRect: { style: {}, classList: { add() {}, remove() {} } },
    selectionKind: { value: 'single' },
    boxSelectionMode: { value: 'visible' },
    document: { viewVoxels: new Map() },
    viewport: {
      activeTool: 'add',
      isNavigating: false,
      setSpaceNavigation() {},
      exitLockedNavigation: () => false,
      setTool() {},
    },
    brush,
    selection: {
      count: 0,
      selectAll() {},
      invert() {},
      copy() {},
      cut() {},
      paste() {},
      delete() {},
      clear: () => false,
      run(action) { action(); },
      apply() {},
    },
    selectionTransform: {
      active: false,
      begin: () => false,
      move() {},
      finish: () => false,
    },
    moduleGizmo: {
      active: false,
      begin: () => false,
      move() {},
      finish: () => false,
    },
    getRenderer: () => ({
      pick: () => ({ voxel: null, target: null }),
      pickSelectionGizmo: () => null,
      pickModuleGizmo: () => null,
    }),
    selectModuleInstance() {},
    undo() {},
    redo() {},
    notify() {},
  });

  canvas.dispatchEvent(pointer('pointerdown', {
    button: 0, buttons: 1, pointerId: 7, clientX: 12, clientY: 20,
  }));
  canvas.dispatchEvent(pointer('pointerup', {
    button: 0, buttons: 0, pointerId: 7, clientX: 18, clientY: 20,
  }));
  assert.deepEqual(brushCalls, [['begin', 'add', 12], ['complete', 18]]);

  controller.dispose();
  canvas.dispatchEvent(pointer('pointerdown', {
    button: 0, buttons: 1, pointerId: 8, clientX: 30, clientY: 20,
  }));
  assert.equal(brushCalls.length, 2);
});
