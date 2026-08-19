import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorDocumentHost, EditorSelectionService, EditorTaskCoordinator } from '../dist/index.js';

test('latest task wins and stale prepared results cannot commit', async () => {
  const tasks = new EditorTaskCoordinator();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const commits = [];
  const first = tasks.run('compile', {
    async prepare() { await gate; return 'old'; },
    commit(value) { commits.push(value); return value; },
  });
  const second = tasks.run('compile', {
    prepare() { return 'new'; },
    commit(value) { commits.push(value); return value; },
  });
  release();
  assert.equal((await first).status, 'cancelled');
  assert.deepEqual(await second, { status: 'completed', value: 'new' });
  assert.deepEqual(commits, ['new']);
});

test('document host and selection expose immutable identity snapshots and clean close', async () => {
  let revision = 1;
  let listener = () => {};
  let disposeCount = 0;
  const adapter = {
    identity: { id: 'doc-1', kind: 'fixture', name: 'Fixture' },
    get revision() { return revision; },
    savedRevision: 1,
    serialize: () => ({ revision }),
    markSaved() {},
    subscribe(next) { listener = next; return { dispose() { listener = () => {}; } }; },
    dispose() { disposeCount++; },
  };
  const host = new EditorDocumentHost();
  host.attach(adapter);
  revision = 2;
  listener();
  assert.equal(host.snapshot().documents[0].dirty, true);

  const selection = new EditorSelectionService();
  selection.set([{ kind: 'fixture', id: 'node-1', documentId: 'doc-1' }]);
  assert.equal(selection.snapshot().active.id, 'node-1');
  await host.close('doc-1');
  await host.close('doc-1');
  assert.equal(disposeCount, 1);
});
