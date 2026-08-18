import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandBus,
  EditorStore,
  EngineErrorCode,
  RuntimeOwnershipScope,
  defineEditorSelector,
  editorSelectors,
  parseEditorSessionState,
} from '../dist-test/testing.js';

const settings = {
  clearColor: { r: 0, g: 0, b: 0, a: 1 },
  reverseZ: false,
};

test('EditorStore publishes minimal typed slice events and read-only snapshots', () => {
  const store = new EditorStore({ settings });
  const events = [];
  const sessions = [];
  const unsubscribeAll = store.subscribe(event => events.push(event));
  const unsubscribeSession = store.subscribe('session.changed', snapshot => sessions.push(snapshot));

  store.commands.session.setLayout({ resourceTab: 'textures' });
  store.commands.session.addRecentFile({ name: 'scene-a.json', handleId: 'handle-a', openedAt: 10 });
  store.commands.selection.setResources({ textureId: 7 });

  assert.deepEqual(events.map(event => event.type), ['session.changed', 'session.changed', 'selection.changed']);
  assert.equal('store' in events[0], false);
  assert.equal(sessions.at(-1).recentFiles[0].handleId, 'handle-a');
  assert.equal(Object.isFrozen(store.snapshot()), true);
  assert.equal(Object.isFrozen(store.select(editorSelectors.resourceSelection)), true);

  unsubscribeAll();
  unsubscribeSession();
  assert.equal(store.listenerCount, 0);
});

test('EditorStore caches snapshots and selectors by slice version and subscribes by equality', () => {
  const store = new EditorStore({ settings });
  const initialSnapshot = store.snapshot();
  assert.equal(store.snapshot(), initialSnapshot);

  let selectorRuns = 0;
  const reverseZSelector = defineEditorSelector(['project'], snapshot => {
    selectorRuns++;
    return snapshot.project.settings.reverseZ;
  });
  assert.equal(store.select(reverseZSelector), false);
  assert.equal(store.select(reverseZSelector), false);
  assert.equal(selectorRuns, 1);

  const projectVersion = store.getSliceVersion('project');
  const selectionVersion = store.getSliceVersion('selection');
  store.commands.selection.setResources({ textureId: 4 });
  assert.equal(store.getSliceVersion('project'), projectVersion);
  assert.equal(store.getSliceVersion('selection'), selectionVersion + 1);
  assert.equal(store.select(reverseZSelector), false);
  assert.equal(selectorRuns, 1);

  const modelChanges = [];
  const modelSelector = defineEditorSelector(['selection'], snapshot => snapshot.selection.resources.modelId);
  const unsubscribe = store.subscribeSelector(modelSelector, (value, previous) => modelChanges.push([previous, value]));
  store.commands.session.setLayout({ resourceTab: 'textures' });
  store.commands.selection.setResources({ textureId: 5 });
  store.commands.selection.setResources({ modelId: 8 });
  assert.deepEqual(modelChanges, [[null, 8]]);
  assert.equal(store.selectSlice('selection', slice => slice.resources.modelId), 8);
  unsubscribe();
});

test('Project document revisions preserve dirty state across an overlapping save', () => {
  const store = new EditorStore({ settings });
  assert.deepEqual(store.select(editorSelectors.projectDocument), {
    currentRevision: 0,
    savedRevision: 0,
    documentName: null,
    dirty: false,
  });

  store.commands.project.markSceneChanged();
  const savingRevision = store.select(editorSelectors.projectDocument).currentRevision;
  store.commands.project.markResourcesChanged();
  store.commands.project.markSaved(savingRevision, 'scene.json');
  assert.deepEqual(store.select(editorSelectors.projectDocument), {
    currentRevision: 2,
    savedRevision: 1,
    documentName: 'scene.json',
    dirty: true,
  });

  store.commands.project.markSaved();
  assert.equal(store.select(editorSelectors.projectDocument).dirty, false);
  store.commands.project.openDocument('opened.json');
  assert.equal(store.select(editorSelectors.projectDocument).dirty, false);
  store.commands.project.restoreRecovery('opened.json');
  assert.equal(store.select(editorSelectors.projectDocument).dirty, true);
});

test('SessionState persists through an injected port without referencing localStorage', () => {
  let persisted = null;
  const persistence = {
    load: () => persisted,
    save: value => { persisted = value; },
  };
  const store = new EditorStore({ settings, sessionPersistence: persistence });
  store.commands.session.setLayout({ resourceTab: 'models' });
  store.commands.session.addRecentFile({ name: 'scene.json', path: '/tmp/scene.json', openedAt: 5 });

  const stored = JSON.parse(persisted);
  assert.equal(stored.format, 'haiyue-editor-session');
  assert.equal(stored.version, 1);
  assert.equal(stored.data.layout.resourceTab, 'models');

  const restored = new EditorStore({ settings, sessionPersistence: persistence });
  assert.deepEqual(restored.select(editorSelectors.recentFiles), [
    { name: 'scene.json', path: '/tmp/scene.json', openedAt: 5 },
  ]);
});

test('RuntimeState owns one engine/world/command context and releases it on clear', () => {
  const store = new EditorStore({ settings });
  const released = [];
  const engine = { stop: () => released.push('stop'), destroy: () => released.push('engine') };
  const world = { destroy: () => released.push('world') };
  const commandBus = new CommandBus(() => {});
  const ownership = new RuntimeOwnershipScope().bindEngine(engine).bindWorld(world);

  const context = store.commands.runtime.attach({ viewportEngine: engine, world, commandBus, ownership });
  assert.equal(store.select(editorSelectors.runtimeContext), context);
  assert.equal(context.sessionId, 1);

  store.commands.runtime.clear();
  assert.equal(store.select(editorSelectors.runtimeContext), null);
  assert.deepEqual(released, ['stop', 'world', 'engine']);
});

test('EditorStore transaction commits atomically and restores state on failure', () => {
  const store = new EditorStore({ settings });
  const events = [];
  store.subscribe(event => events.push(event.type));

  store.commands.transaction('commit project', () => {
    store.commands.project.setSettings({ ...settings, reverseZ: true });
    store.commands.selection.setResources({ modelId: 3 });
  });
  assert.equal(store.select(editorSelectors.settings).reverseZ, true);
  assert.equal(store.select(editorSelectors.resourceSelection).modelId, 3);
  assert.equal(events.at(-1), 'transaction.committed');

  assert.throws(() => store.commands.transaction('rollback project', () => {
    store.commands.project.setSettings({ ...settings, reverseZ: false });
    store.commands.selection.setResources({ modelId: 99 });
    throw new Error('transaction failed');
  }), /transaction failed/);
  assert.equal(store.select(editorSelectors.settings).reverseZ, true);
  assert.equal(store.select(editorSelectors.resourceSelection).modelId, 3);
  assert.equal(events.at(-1), 'transaction.rolled-back');
});

test('EditorStore transaction coalesces repeated notifications for the same slice', () => {
  const store = new EditorStore({ settings });
  const projectEvents = [];
  store.subscribe('project.changed', snapshot => projectEvents.push(snapshot.currentRevision));
  store.commands.transaction('batch scene edits', () => {
    store.commands.project.markSceneChanged();
    store.commands.project.markSceneChanged();
  });
  assert.deepEqual(projectEvents, [2]);
  assert.equal(store.snapshot().project.currentRevision, 2);
});

test('EditorStore exposes only short synchronous transactions', () => {
  const store = new EditorStore({ settings });
  assert.equal(store.commands.transactionAsync, undefined);
  assert.throws(() => store.commands.transaction('sync import commit', () => {
    store.commands.project.markResourcesChanged();
    store.commands.selection.setResources({ textureId: 42 });
    throw new Error('upload failed');
  }), /upload failed/);
  assert.equal(store.snapshot().project.resourceRevision, 0);
  assert.equal(store.snapshot().selection.resources.textureId, null);
});

test('Selection, Inspector, and Play slices enforce command and transition boundaries', () => {
  const store = new EditorStore({ settings });
  const entity = { id: 7 };
  store.commands.selection.setEntities([entity], entity);
  const selectionCopy = store.commands.selection.selection;
  selectionCopy.clear();
  assert.equal(store.snapshot().selection.entities.size, 1);

  const inspectorContext = { world: {}, getActiveEntity: () => entity };
  store.commands.inspector.setContext(inspectorContext);
  store.commands.inspector.setSelectedComponentName('Transform3D');
  assert.equal(store.snapshot().inspector.context, inspectorContext);
  assert.equal(store.snapshot().inspector.selectedComponentName, 'Transform3D');

  assert.throws(() => store.commands.play.transition('paused'), /Invalid editor play transition/);
  store.commands.play.transition('playing');
  store.commands.play.transition('paused');
  store.commands.play.transition('editing');
  assert.equal(store.select(editorSelectors.playState), 'editing');
});

test('editor session parser returns structured ignore recovery errors', () => {
  assert.throws(
    () => parseEditorSessionState(JSON.stringify({ format: 'haiyue-editor-session', version: 2, data: {} })),
    error => error.code === EngineErrorCode.SessionDataInvalid
      && error.path === 'session.version'
      && error.recovery === 'ignore'
      && error.recoverable === true,
  );
});
