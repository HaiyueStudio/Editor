import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AssetOperationCenter,
  applyCartesianTransformInputs,
  CartesianTransform3D,
  EditorShortcutRegistry,
  renderMixedCartesianTransformInputs,
  ShortcutConflictError,
  normalizeShortcutChord,
} from '../dist-test/testing.js';

function numericInputs() {
  return [0, 1, 2].map(() => ({ value: '', placeholder: '', dataset: {} }));
}

test('shortcut registry normalizes platform modifiers and rejects same-context conflicts', () => {
  const registry = new EditorShortcutRegistry(null);
  let handled = 0;
  registry.register({ id: 'save', chord: 'Cmd+Shift+S', handler: () => { handled++; } });
  assert.equal(normalizeShortcutChord('Ctrl+Shift+s'), 'mod+shift+s');
  assert.throws(
    () => registry.register({ id: 'other-save', chord: 'Ctrl+Shift+S', handler() {} }),
    error => error instanceof ShortcutConflictError
      && error.shortcutIds.join(',') === 'save,other-save',
  );
  let prevented = 0;
  assert.equal(registry.handle({
    key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true,
    target: null,
    preventDefault() { prevented++; },
  }), true);
  assert.equal(handled, 1);
  assert.equal(prevented, 1);
  registry.dispose();
});

test('shortcut registry dispatches viewport bindings before global bindings', () => {
  const originalHTMLElement = globalThis.HTMLElement;
  class FakeElement {
    constructor(context) { this.context = context; this.isContentEditable = false; }
    matches() { return false; }
    closest() { return this; }
    get dataset() { return { editorShortcutContext: this.context }; }
  }
  globalThis.HTMLElement = FakeElement;
  const registry = new EditorShortcutRegistry(null);
  const calls = [];
  registry.register({ id: 'global-focus', chord: 'f', handler: () => calls.push('global') });
  registry.register({ id: 'viewport-focus', chord: 'f', context: 'viewport', handler: () => calls.push('viewport') });
  try {
    registry.handle({
      key: 'f', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      target: new FakeElement('viewport'), preventDefault() {},
    });
    assert.deepEqual(calls, ['viewport']);
  } finally {
    registry.dispose();
    globalThis.HTMLElement = originalHTMLElement;
  }
});

test('asset operation center reports progress, terminal states, retry, cancel, and dismissal', () => {
  const center = new AssetOperationCenter();
  const history = [];
  const unsubscribe = center.subscribe(snapshot => history.push(snapshot));
  let retries = 0;
  let cancellations = 0;
  const first = center.begin({
    kind: 'reimport', label: 'level.glb', assetIds: ['model:7'],
    retry: () => { retries++; }, cancel: () => { cancellations++; },
  });
  first.progress({ current: 2, total: 4, message: 'textures' });
  first.fail(new Error('decode failed'));
  const failed = center.snapshot()[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'decode failed');
  assert.equal(failed.progress.current, 2);
  assert.equal(center.retry(first.id), true);
  assert.equal(retries, 1);
  assert.equal(center.dismiss(first.id), true);

  const second = center.begin({ label: 'texture.png', cancel: () => { cancellations++; } });
  assert.equal(center.cancel(second.id), true);
  assert.equal(center.snapshot()[0].status, 'cancelled');
  assert.equal(cancellations, 1);
  assert.ok(history.length >= 6);
  unsubscribe();
});

test('mixed transform fields preserve untouched axes and apply one edited value to every selection', () => {
  const first = new CartesianTransform3D({ position: [1, 2, 3] });
  const second = new CartesianTransform3D({ position: [1, 9, 3] });
  const elements = {
    positionInputs: numericInputs(),
    rotationInputs: numericInputs(),
    scaleInputs: numericInputs(),
  };
  renderMixedCartesianTransformInputs([first, second], elements, String);
  assert.equal(elements.positionInputs[0].value, '1');
  assert.equal(elements.positionInputs[1].value, '');
  assert.equal(elements.positionInputs[1].placeholder, 'Mixed');

  elements.positionInputs[0].value = '5';
  applyCartesianTransformInputs(first, elements);
  applyCartesianTransformInputs(second, elements);
  assert.deepEqual([...first.position], [5, 2, 3]);
  assert.deepEqual([...second.position], [5, 9, 3]);
});
