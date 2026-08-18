import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnimationEditorProjectSession,
  AnimationEditorStore,
  MemoryAnimationEditorProjectPersistence,
  animationEditorProjectFingerprint,
  createEmptyAnimationEditorProject,
  projectFileName,
} from '../dist-test/testing.js';

function snapshot(project, overrides = {}) {
  return {
    name: project.name,
    fileName: projectFileName(project.name),
    project,
    savedFingerprint: animationEditorProjectFingerprint(project),
    dirty: false,
    updatedAt: 100,
    ...overrides,
  };
}

test('session restores the current project and offers only newer dirty recovery', async () => {
  const empty = createEmptyAnimationEditorProject();
  const currentProject = createEmptyAnimationEditorProject({ id: 'current', name: 'Current' });
  const recoveredProject = structuredClone(currentProject);
  recoveredProject.name = 'Recovered Draft';
  const persistence = new MemoryAnimationEditorProjectPersistence();
  persistence.current = snapshot(currentProject, { updatedAt: 200 });
  persistence.recovery = snapshot(recoveredProject, {
    dirty: true,
    savedFingerprint: animationEditorProjectFingerprint(currentProject),
    updatedAt: 300,
  });
  const store = new AnimationEditorStore(empty);
  const session = new AnimationEditorProjectSession(store, { persistence, autosaveDelay: 60_000 });

  const startup = await session.initialize();
  assert.equal(startup.restoredCurrent, true);
  assert.equal(store.project.name, 'Current');
  assert.equal(store.isDirty, false);
  assert.equal(startup.recovery.project.name, 'Recovered Draft');
  assert.notEqual(persistence.recovery, null, 'startup restore must not discard the pending recovery');

  await session.restoreRecovery(startup.recovery);
  assert.equal(store.project.name, 'Recovered Draft');
  assert.equal(store.isDirty, true, 'recovery preserves the last explicit save baseline');
  assert.equal(persistence.recovery, null);
  session.dispose();
});

test('session autosaves dirty work and explicit saves clear recovery and update recents', async () => {
  let now = 1000;
  const persistence = new MemoryAnimationEditorProjectPersistence();
  const store = new AnimationEditorStore(createEmptyAnimationEditorProject({ id: 'hero', name: 'Hero' }));
  const session = new AnimationEditorProjectSession(store, {
    persistence,
    autosaveDelay: 60_000,
    now: () => now,
  });
  store.update('rename', draft => { draft.name = 'Hero Walk'; });
  await session.flushAutosave();
  assert.equal(persistence.recovery.dirty, true);
  assert.equal(persistence.recovery.project.name, 'Hero Walk');
  assert.notEqual(persistence.recovery.savedFingerprint, animationEditorProjectFingerprint(store.project));

  now = 2000;
  await session.saveAs('walk-cycle');
  assert.equal(store.isDirty, false);
  assert.equal(persistence.recovery, null);
  assert.equal(persistence.current.fileName, 'walk-cycle.hya-project.json');
  assert.equal(persistence.recent.length, 1);
  assert.equal(persistence.recent[0].id, 'hero');
  session.dispose();
});
