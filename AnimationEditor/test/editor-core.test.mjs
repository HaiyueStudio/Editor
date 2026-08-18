import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnimationEditorStore,
  CommandHistory,
  DirtyState,
  SelectionStore,
  animationEditorProjectFingerprint,
  cloneAnimationEditorProject,
  createEmptyAnimationEditorProject,
  createProjectMutationCommand,
} from '../dist-test/testing.js';

function shapeNode(id = 'shape-1') {
  return {
    id,
    name: 'Shape',
    transform: { position: [400, 250], rotation: 0, scale: [1, 1], anchor: [40, 60], opacity: 1 },
    components: [{
      id: `${id}-component`,
      component: { type: 'shape2d', shape: 'rect', size: [80, 120], fill: [0.2, 0.6, 1, 1] },
    }],
    effects: [],
    compositeLayers: [],
  };
}

test('project factory returns a frozen v1 project with deterministic content identity', () => {
  const project = createEmptyAnimationEditorProject({ width: 960, height: 540, duration: 2 });
  assert.equal(project.format, 'haiyue-animation-editor-project@1');
  assert.equal(project.schemaVersion, 1);
  assert.deepEqual(project.composition.canvas, { width: 960, height: 540, coordinateSystem: 'screen-y-down' });
  assert.equal(Object.isFrozen(project), true);
  assert.equal(Object.isFrozen(project.composition.canvas), true);

  const editorOnly = cloneAnimationEditorProject(project);
  editorOnly.editor.timeline.playhead = 1.25;
  assert.equal(animationEditorProjectFingerprint(editorOnly), animationEditorProjectFingerprint(project));

  const authored = cloneAnimationEditorProject(project);
  authored.nodes.push(shapeNode());
  assert.notEqual(animationEditorProjectFingerprint(authored), animationEditorProjectFingerprint(project));
});

test('store revisions immutable snapshots and keeps editor-only changes clean', () => {
  const store = new AnimationEditorStore(createEmptyAnimationEditorProject());
  const changes = [];
  store.subscribe(change => changes.push(change));

  assert.equal(store.isDirty, false);
  assert.equal(store.update('seek', draft => { draft.editor.timeline.playhead = 0.5; }), true);
  assert.equal(store.revision, 1);
  assert.equal(store.isDirty, false, 'playhead is not authored content');

  store.update('rename', draft => { draft.name = 'Hero Motion'; });
  assert.equal(store.project.name, 'Hero Motion');
  assert.equal(store.isDirty, true);
  assert.equal(Object.isFrozen(store.project), true);
  assert.equal(changes.at(-1).reason, 'rename');
  assert.equal(changes.at(-1).dirtyChanged, true);

  assert.equal(store.markSaved(), true);
  assert.equal(store.isDirty, false);
  assert.equal(store.markSaved(), false);
});

test('command history executes project mutations and preserves undo/redo dirty semantics', () => {
  const store = new AnimationEditorStore(createEmptyAnimationEditorProject());
  const history = new CommandHistory(10, 1024 * 1024);
  const snapshots = [];
  history.subscribe(snapshot => snapshots.push(snapshot));

  const command = createProjectMutationCommand(store, 'Add Shape', draft => {
    draft.nodes.push(shapeNode());
  });
  assert.ok(command);
  assert.equal(history.execute(command), true);
  assert.equal(store.project.nodes.length, 1);
  assert.equal(store.isDirty, true);
  assert.equal(history.undoLabel, 'Add Shape');

  assert.equal(history.undo(), 'Add Shape');
  assert.equal(store.project.nodes.length, 0);
  assert.equal(store.isDirty, false, 'undo returned to saved fingerprint');
  assert.equal(history.redoLabel, 'Add Shape');

  assert.equal(history.redo(), 'Add Shape');
  assert.equal(store.project.nodes.length, 1);
  assert.equal(store.isDirty, true);
  assert.equal(snapshots.at(-1).canUndo, true);
  assert.equal(snapshots.at(-1).canRedo, false);

  assert.equal(createProjectMutationCommand(store, 'No-op', () => {}), null);
});

test('command history enforces its memory budget without retaining an oversized command', () => {
  const history = new CommandHistory(10, 16);
  let value = 0;
  assert.equal(history.execute({
    label: 'Oversized',
    estimatedBytes: 32,
    execute: () => { value = 1; return true; },
    undo: () => { value = 0; },
  }), true);
  assert.equal(value, 1);
  assert.equal(history.canUndo, false);
  assert.equal(history.estimatedBytes, 0);
});

test('selection supports replacement, additive/toggle behavior and stale-item pruning', () => {
  const selection = new SelectionStore();
  const events = [];
  selection.subscribe((items, primary) => events.push({ items, primary }));

  selection.select({ kind: 'node', id: 'root' });
  selection.select({ kind: 'node', id: 'body' }, { additive: true });
  assert.deepEqual(selection.items.map(item => item.id), ['root', 'body']);
  assert.equal(selection.primary.id, 'body');

  selection.select({ kind: 'node', id: 'root' }, { toggle: true });
  assert.deepEqual(selection.items.map(item => item.id), ['body']);
  assert.equal(selection.select({ kind: 'node', id: 'body' }), false, 'selecting the sole current item is stable');

  selection.select({ kind: 'track', id: 'opacity', ownerId: 'body' }, { additive: true });
  selection.prune(item => item.kind !== 'node');
  assert.deepEqual(selection.items, [{ kind: 'track', id: 'opacity', ownerId: 'body' }]);
  assert.ok(events.length >= 4);
  assert.equal(selection.clear(), true);
  assert.equal(selection.primary, null);
});

test('DirtyState reports only transitions across the saved baseline', () => {
  const dirty = new DirtyState('a');
  assert.equal(dirty.update('b'), true);
  assert.equal(dirty.isDirty, true);
  assert.equal(dirty.update('c'), false);
  assert.equal(dirty.markSaved(), true);
  assert.equal(dirty.isDirty, false);
  assert.equal(dirty.reset('a'), true);
  assert.equal(dirty.savedFingerprint, 'a');
  assert.equal(dirty.restore('saved', 'current'), true);
  assert.equal(dirty.isDirty, true);
});
