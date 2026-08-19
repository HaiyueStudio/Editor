import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorHistoryService } from '../dist/index.js';

function command(label, state, delta = 1, estimatedBytes = 1) {
  return {
    label, estimatedBytes,
    execute() { state.value += delta; },
    undo() { state.value -= delta; },
  };
}

test('history supports nested groups, cancellation, redo invalidation and readonly snapshots', () => {
  const state = { value: 0 };
  const history = new EditorHistoryService({ byteBudget: 10 });
  history.beginGroup('outer');
  history.execute(command('one', state));
  history.beginGroup('inner');
  history.execute(command('two', state));
  history.endGroup();
  history.endGroup();
  assert.equal(state.value, 2);
  assert.equal(history.snapshot().undoLabel, 'outer');
  history.undo();
  assert.equal(state.value, 0);
  history.redo();
  assert.equal(state.value, 2);
  history.undo();
  history.execute(command('replacement', state, 5));
  assert.equal(history.canRedo, false);
  assert.ok(Object.isFrozen(history.snapshot().entries));

  history.beginGroup('cancelled');
  history.execute(command('temporary', state, 3));
  history.cancelGroup();
  assert.equal(state.value, 5);
});

test('history rejects a command before mutation when it exceeds budget', () => {
  const state = { value: 0 };
  const history = new EditorHistoryService({ byteBudget: 2 });
  assert.throws(() => history.execute(command('too-large', state, 1, 3)), /exceeds/);
  assert.equal(state.value, 0);
});

test('history coalesces compatible consecutive commands without replaying them', () => {
  const state = { value: 0 };
  const setValue = (before, after) => ({
    label: 'Set value',
    execute() { state.value = after; },
    undo() { state.value = before; },
    mergeWith(next) {
      return next.label === 'Set value' ? setValue(before, next.after) : null;
    },
    after,
  });
  const history = new EditorHistoryService();
  history.execute(setValue(0, 1));
  history.execute(setValue(1, 2));
  assert.equal(history.snapshot().entries.length, 1);
  history.undo();
  assert.equal(state.value, 0);
  history.redo();
  assert.equal(state.value, 2);
});
