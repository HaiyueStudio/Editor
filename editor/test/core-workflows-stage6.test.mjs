import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandBus, CoreWorkflowCoordinator } from '../dist-test/testing.js';

const workflows = [
  ['open', 'openDocument'],
  ['save', 'saveDocument'],
  ['import', 'importAssets'],
  ['preview', 'preview'],
  ['export', 'exportProject'],
];

for (const [kind, method] of workflows) {
  test(`${kind} workflow isolates prepare, synchronous commit, cancellation, and failure`, async () => {
    const events = [];
    const coordinator = new CoreWorkflowCoordinator(snapshot => events.push(snapshot));
    let commits = 0;
    let rollbacks = 0;

    const success = await coordinator[method]({
      prepare: ({ reportProgress }) => {
        reportProgress({ current: 1, total: 2, message: 'prepared' });
        return `${kind}:prepared`;
      },
      commit: prepared => {
        commits++;
        return prepared.replace('prepared', 'ok');
      },
    });
    assert.deepEqual(success, { status: 'completed', value: `${kind}:ok` });

    const cancelledPromise = coordinator[method]({
      prepare: ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve('late'), { once: true })),
      commit: () => { commits++; },
      rollback: reason => { if (reason === 'cancelled') rollbacks++; },
    });
    coordinator.cancel(kind);
    assert.deepEqual(await cancelledPromise, { status: 'cancelled' });

    const failed = await coordinator[method]({
      prepare: () => { throw new Error(`${kind}:failed`); },
      commit: () => { commits++; },
      rollback: reason => { if (reason === 'failed') rollbacks++; },
    });
    assert.equal(failed.status, 'failed');
    assert.match(failed.error.message, /failed/);
    assert.equal(commits, 1);
    assert.equal(rollbacks, 2);
    assert.equal(coordinator.activeCount, 0);
    assert.deepEqual(events.filter(event => event.kind === kind && event.status !== 'running').map(event => event.status), [
      'completed', 'cancelled', 'failed',
    ]);
    assert.equal(events.some(event => event.progress?.message === 'prepared'), true);
  });
}

test('a superseding workflow waits for the previous rollback before preparing', async () => {
  const coordinator = new CoreWorkflowCoordinator();
  const order = [];
  const first = coordinator.importAssets({
    prepare: ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve('first'), { once: true })),
    commit: () => order.push('first:commit'),
    rollback: async () => {
      order.push('first:rollback:start');
      await Promise.resolve();
      order.push('first:rollback:end');
    },
  });
  const second = coordinator.importAssets({
    prepare: () => { order.push('second:prepare'); return 'second'; },
    commit: () => { order.push('second:commit'); return 'second:committed'; },
  });

  assert.deepEqual(await first, { status: 'cancelled' });
  assert.deepEqual(await second, { status: 'completed', value: 'second:committed' });
  assert.deepEqual(order, [
    'first:rollback:start',
    'first:rollback:end',
    'second:prepare',
    'second:commit',
  ]);
});

test('an asynchronous commit is rejected by the workflow contract', async () => {
  const coordinator = new CoreWorkflowCoordinator();
  const result = await coordinator.saveDocument({
    prepare: () => 'snapshot',
    commit: async () => 'invalid',
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /commit must be synchronous/);
});

test('commands executed while prepare awaits remain outside the workflow commit group', async () => {
  const bus = new CommandBus(() => {});
  const coordinator = new CoreWorkflowCoordinator();
  const state = { user: 0, imported: 0 };
  let finishPrepare;
  const running = coordinator.importAssets({
    prepare: () => new Promise(resolve => { finishPrepare = () => resolve('prepared'); }),
    commit: () => bus.runGroup('Import assets', () => bus.execute({
      label: 'Import asset',
      execute: () => { state.imported++; },
      undo: () => { state.imported--; },
    })),
  });

  bus.execute({
    label: 'User edit',
    execute: () => { state.user++; },
    undo: () => { state.user--; },
  });
  finishPrepare();
  await running;
  assert.deepEqual(state, { user: 1, imported: 1 });

  bus.undo();
  assert.deepEqual(state, { user: 1, imported: 0 });
  bus.undo();
  assert.deepEqual(state, { user: 0, imported: 0 });
});
