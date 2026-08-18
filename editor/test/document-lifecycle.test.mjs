import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentAutoRecovery, DocumentFileSession } from '../dist-test/testing.js';

function createHandle(name = 'scene.json') {
  let file = new File(['initial'], name, { type: 'application/json', lastModified: 10 });
  let written = null;
  return {
    handle: {
      name,
      getFile: async () => file,
      createWritable: async () => ({
        write: async value => { written = value; },
        close: async () => {
          file = new File([written], name, { type: 'application/json', lastModified: file.lastModified + 1 });
        },
      }),
    },
    get file() { return file; },
    replaceExternal(text) { file = new File([text], name, { type: 'application/json', lastModified: file.lastModified + 1 }); },
  };
}

test('DocumentFileSession writes an opened handle in place and detects external changes', async () => {
  const target = createHandle();
  const session = new DocumentFileSession();
  session.attachOpenedFile(target.file, target.handle);
  const download = { blob: new Blob(['saved']), fileName: 'scene.json' };
  const prepared = await session.prepareSave(download, 4);
  assert.equal(prepared.download, null);
  assert.equal(prepared.documentName, 'scene.json');
  assert.equal(prepared.handleChanged, false);
  assert.equal(await prepared.savedFile.text(), 'saved');
  session.commitSave(prepared);

  target.replaceExternal('outside');
  await assert.rejects(
    session.prepareSave(download, 5, { confirmOverwrite: () => false }),
    error => error.name === 'AbortError',
  );
  const overwritten = await session.prepareSave(download, 5, { confirmOverwrite: () => true });
  assert.equal(await overwritten.savedFile.text(), 'saved');
});

test('DocumentAutoRecovery stores only a stable dirty revision and clears it after save', async () => {
  let state = { currentRevision: 2, savedRevision: 1, documentName: 'scene.json', dirty: true };
  let stored = null;
  let clearCount = 0;
  const recovery = new DocumentAutoRecovery({
    store: {
      load: async () => stored,
      save: async value => { stored = value; },
      clear: async () => { stored = null; clearCount++; },
    },
    serialize: async () => ({ version: 1, name: 'scene', globals: {}, systems: [], resources: {}, entities: [] }),
    getState: () => state,
  });
  await recovery.flush();
  assert.equal(stored.currentRevision, 2);
  assert.equal(stored.documentName, 'scene.json');

  state = { ...state, savedRevision: 2, dirty: false };
  recovery.saved();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(stored, null);
  assert.equal(clearCount, 1);
  recovery.dispose();
});
