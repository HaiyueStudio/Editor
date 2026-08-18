import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandHistory } from '../dist/commands.js';
import { VoxelDocument } from '../dist/model.js';
import { projectFingerprint, recentProjectId } from '../dist/project-storage.js';

class FakeClassList {
  values = new Set();
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
}

class FakeElement extends EventTarget {
  textContent = '';
  title = '';
  hidden = false;
  items = [];
  classList = new FakeClassList();
  click() { this.dispatchEvent(new Event('click')); }
}

class FakeWindow extends EventTarget {
  confirmResult = true;
  setTimeout(callback, delay) { return globalThis.setTimeout(callback, delay); }
  clearTimeout(timer) { globalThis.clearTimeout(timer); }
  confirm() { return this.confirmResult; }
}

class MemoryStore {
  current = null;
  recovery = null;
  recent = [];
  async loadCurrent() { return structuredClone(this.current); }
  async saveCurrent(snapshot) { this.current = structuredClone(snapshot); }
  async loadRecovery() { return this.recovery; }
  async saveRecovery(snapshot) { this.recovery = structuredClone(snapshot); }
  async clearRecovery() { this.recovery = null; }
  async listRecent() { return structuredClone(this.recent); }
  async saveRecent(record) {
    this.recent = [structuredClone(record), ...this.recent.filter(item => item.id !== record.id)];
  }
  async clearRecent() { this.recent = []; }
}

const ids = [
  'project-name', 'project-unsaved', 'save-project', 'recent-projects-menu',
  'recovery-banner', 'recovery-message', 'restore-recovery', 'discard-recovery',
  'drop-import-overlay',
];

function fixture({ current = null, recovery = null, recent = [] } = {}) {
  const elements = new Map(ids.map(id => [id, new FakeElement()]));
  const fakeWindow = new FakeWindow();
  globalThis.window = fakeWindow;
  globalThis.document = {
    title: '',
    getElementById: id => elements.get(id) ?? null,
  };
  const store = new MemoryStore();
  store.current = current;
  store.recovery = recovery;
  store.recent = recent;
  const io = {
    projectName: '',
    opened: [],
    dropped: [],
    setProjectName(name) { this.projectName = name; },
    openProjectSnapshot(project, name, format, label) { this.opened.push({ project, name, format, label }); },
    async importDroppedFiles(files) { this.dropped.push(files); },
  };
  const documentModel = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const history = new CommandHistory();
  const notices = [];
  return import('../dist/project-session-controller.js').then(({ ProjectSessionController }) => ({
    elements,
    fakeWindow,
    store,
    io,
    documentModel,
    history,
    notices,
    controller: new ProjectSessionController({
      document: documentModel,
      history,
      io,
      notify: (message, error) => notices.push({ message, error }),
      resetCamera() {},
      store,
      autosaveDelay: 0,
    }),
  }));
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 5));
  await new Promise(resolve => setImmediate(resolve));
}

test('save shortcut writes the current project to IndexedDB and reconciles dirty state', async () => {
  const state = await fixture();
  await state.controller.initialize();
  assert.equal(state.elements.get('project-name').textContent, '未命名工程');
  assert.equal(state.controller.dirty, false);

  state.documentModel.setVoxel(1, 1, 1, '#ff0000');
  assert.equal(state.controller.dirty, true);
  assert.equal(state.elements.get('project-unsaved').hidden, false);
  assert.match(globalThis.document.title, /\*/);
  const unload = new Event('beforeunload', { cancelable: true });
  Object.defineProperty(unload, 'returnValue', { value: true, writable: true });
  state.fakeWindow.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  await settle();
  assert.equal(state.store.recovery.dirty, true);

  const shortcut = new Event('keydown', { cancelable: true });
  Object.defineProperties(shortcut, {
    ctrlKey: { value: true }, metaKey: { value: false }, key: { value: 's' }, repeat: { value: false },
  });
  state.fakeWindow.dispatchEvent(shortcut);
  await settle();
  assert.equal(state.store.current.project.voxels.length, 1);
  assert.equal(state.store.current.dirty, false);
  assert.equal(state.controller.dirty, false);
  assert.match(state.notices.at(-1).message, /保存到浏览器/);
  state.documentModel.removeVoxel(1, 1, 1);
  state.documentModel.setVoxel(1, 1, 1, '#ff0000');
  await settle();
  assert.equal(state.controller.dirty, false, 'returning to the saved content should clear the dirty marker');
});

test('startup automatically restores the last project explicitly saved in IndexedDB', async () => {
  const savedDocument = new VoxelDocument({ x: 12, y: 13, z: 14 });
  savedDocument.setVoxel(4, 5, 6, '#abcdef');
  const project = savedDocument.toJSON();
  const current = {
    name: 'browser-project',
    format: 'json',
    project,
    savedFingerprint: projectFingerprint(project),
    dirty: false,
    updatedAt: Date.now(),
  };
  const state = await fixture({ current });
  await state.controller.initialize();
  assert.deepEqual(state.documentModel.size, { x: 12, y: 13, z: 14 });
  assert.equal(state.documentModel.get(4, 5, 6)?.color, '#abcdef');
  assert.equal(state.controller.projectName, 'browser-project');
  assert.equal(state.io.projectName, 'browser-project');
  assert.equal(state.controller.dirty, false);
  assert.equal(state.history.canUndo, false);
  assert.equal(state.elements.get('recovery-banner').classList.contains('visible'), false);
});

test('a newer dirty recovery remains optional on top of the automatically restored saved project', async () => {
  const savedDocument = new VoxelDocument({ x: 8, y: 8, z: 8 });
  savedDocument.setVoxel(1, 1, 1, '#111111');
  const savedProject = savedDocument.toJSON();
  const dirtyDocument = new VoxelDocument({ x: 8, y: 8, z: 8 });
  dirtyDocument.load(savedProject);
  dirtyDocument.setVoxel(2, 2, 2, '#222222');
  const dirtyProject = dirtyDocument.toJSON();
  const now = Date.now();
  const current = {
    name: 'saved-project', format: 'json', project: savedProject,
    savedFingerprint: projectFingerprint(savedProject), dirty: false, updatedAt: now,
  };
  const recovery = {
    name: 'saved-project', format: 'json', project: dirtyProject,
    savedFingerprint: projectFingerprint(savedProject), dirty: true, updatedAt: now + 1,
  };
  const state = await fixture({ current, recovery });
  await state.controller.initialize();
  assert.equal(state.documentModel.voxelCount, 1, 'saved project loads before recovery is accepted');
  assert.equal(state.elements.get('recovery-banner').classList.contains('visible'), true);
  state.elements.get('restore-recovery').click();
  assert.equal(state.documentModel.voxelCount, 2);
  assert.equal(state.controller.dirty, true);
});

test('startup offers an unsaved IndexedDB snapshot and restores it atomically', async () => {
  const recoveredDocument = new VoxelDocument({ x: 6, y: 7, z: 8 });
  recoveredDocument.setVoxel(2, 3, 4, '#123456');
  const recoveredProject = recoveredDocument.toJSON();
  const recovery = {
    name: 'crashed-project',
    format: 'vox',
    project: recoveredProject,
    savedFingerprint: projectFingerprint({ ...recoveredProject, voxels: [] }),
    dirty: true,
    updatedAt: Date.now(),
  };
  const state = await fixture({ recovery });
  await state.controller.initialize();
  assert.equal(state.elements.get('recovery-banner').classList.contains('visible'), true);
  state.elements.get('restore-recovery').click();
  assert.deepEqual(state.documentModel.size, { x: 6, y: 7, z: 8 });
  assert.equal(state.documentModel.voxelCount, 1);
  assert.equal(state.controller.projectName, 'crashed-project');
  assert.equal(state.controller.dirty, true);
  assert.equal(state.elements.get('recovery-banner').classList.contains('visible'), false);
});

test('recent projects and file drops route through the shared project IO pipeline', async () => {
  const recentDocument = new VoxelDocument({ x: 4, y: 4, z: 4 });
  const project = recentDocument.toJSON();
  const id = recentProjectId('recent', 'json');
  const recent = [{
    id, name: 'recent', format: 'json', project,
    savedFingerprint: projectFingerprint(project), dirty: false, updatedAt: Date.now(),
  }];
  const state = await fixture({ recent });
  await state.controller.initialize();
  assert.equal(state.elements.get('recent-projects-menu').items[0].value, id);
  state.elements.get('recent-projects-menu').dispatchEvent(new CustomEvent('item-select', { detail: { value: id } }));
  await settle();
  assert.equal(state.io.opened.length, 1);

  const file = { name: 'model.vox', type: 'application/octet-stream' };
  const drop = new Event('drop', { cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file], dropEffect: 'none' } });
  state.fakeWindow.dispatchEvent(drop);
  await settle();
  assert.deepEqual(state.io.dropped, [[file]]);
  assert.equal(drop.defaultPrevented, true);
});
