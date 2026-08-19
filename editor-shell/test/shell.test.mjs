import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EditorHistoryControlsAdapter,
  EditorShortcutRegistry,
  registerHistoryShortcuts,
} from '../dist/index.js';
import { EditorHistoryService } from '@haiyue/editor-platform';

test('history controls remain controlled and release listeners', () => {
  class Controls extends EventTarget {}
  const element = new Controls();
  const history = new EditorHistoryService();
  let value = 0;
  history.execute({ label: 'Increment', execute: () => { value++; }, undo: () => { value--; } });
  const adapter = new EditorHistoryControlsAdapter(element, history);
  assert.equal(element.canUndo, true);
  element.dispatchEvent(new Event('undo-request'));
  assert.equal(value, 0);
  adapter.dispose();
  element.dispatchEvent(new Event('redo-request'));
  assert.equal(value, 0);
});

test('shortcut routing applies deterministic Mod history chords', () => {
  const history = new EditorHistoryService();
  const shortcuts = new EditorShortcutRegistry();
  let value = 0;
  history.execute({ label: 'Increment', execute: () => { value++; }, undo: () => { value--; } });
  const registrations = registerHistoryShortcuts(shortcuts, history, 'test');
  let prevented = false;
  assert.equal(shortcuts.route({ key: 'z', ctrlKey: true, preventDefault: () => { prevented = true; } }), true);
  assert.equal(value, 0);
  assert.equal(prevented, true);
  registrations.dispose();
  shortcuts.dispose();
});
