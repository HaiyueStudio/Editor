import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorPlatform, EditorResourceStore, EditorHistoryService, createEditorAutomationAPI } from '../dist/index.js';

test('binary resources are owned, isolated, bounded, releasable and disposed with the platform', async () => {
  const store = new EditorResourceStore(8, 2), source = new Uint8Array([1, 2, 3]);
  const first = store.put(source); source[0] = 99;
  const read = store.read(first.resourceId); read[0] = 88;
  assert.deepEqual([...store.read(first.resourceId)], [1, 2, 3]);
  const buffer = Buffer.from([1]); const bufferStore = new EditorResourceStore(); const bufferRef = bufferStore.put(buffer); buffer[0] = 2; assert.equal(bufferStore.read(bufferRef.resourceId)[0], 1);
  const other = new EditorResourceStore(); other.put(new Uint8Array([5]));
  assert.throws(() => other.read(first.resourceId), /unavailable/);
  assert.throws(() => store.put(new Uint8Array(6)), /budget/);
  store.put(new Uint8Array(1)); assert.throws(() => store.put(new Uint8Array(1)), /budget/);
  store.release(first.resourceId); store.release(first.resourceId); store.put(new Uint8Array(6));
  store.dispose(); assert.throws(() => store.read(first.resourceId)); assert.throws(() => store.put(source), /disposed/);
  const platform = new EditorPlatform(), api = createEditorAutomationAPI(platform), resource = api.putResource(new Uint8Array([9]));
  assert.equal(api.apiVersion, '1'); assert.deepEqual(api.listOperations(), []);
  await platform.dispose(); assert.throws(() => api.readResource(resource.resourceId));
});

test('atomic history restores redo and defers destruction on failed commits', () => {
  const history = new EditorHistoryService(), disposed = [];
  const command = id => ({ label: id, execute() {}, undo() {}, dispose() { disposed.push(id); } });
  history.execute(command('first')); history.undo();
  const before = history.snapshot();
  assert.throws(() => history.runAtomic(() => { history.execute(command('second')); throw Error('fail'); }));
  assert.deepEqual(history.snapshot(), before); assert.deepEqual(disposed, ['second']);
  history.redo(); history.undo();
  history.runAtomic(() => history.execute(command('third')));
  assert.deepEqual(disposed, ['second', 'first']);
  assert.throws(() => history.runAtomic(async () => {}), /synchronous/);
  assert.throws(() => history.runAtomic(() => history.beginGroup('nested')), /group/);
  assert.equal(history.activeGroupDepth, 0); history.dispose();
});

test('atomic history blocks reentrant writes while publishing a commit', () => {
  const history = new EditorHistoryService(), command = { label: 'edit', execute() {}, undo() {} };
  history.execute(command); history.undo();
  const before = history.snapshot();
  const subscription = history.subscribe(() => history.clear());
  assert.throws(() => history.runAtomic(() => history.execute(command)), /busy/);
  subscription.dispose(); assert.deepEqual(history.snapshot(), before);
  assert.throws(() => history.runAtomic(() => history.dispose()), /atomic/);
  history.redo(); history.dispose();
});
