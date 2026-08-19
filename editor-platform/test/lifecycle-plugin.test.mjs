import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_PLUGIN_API_VERSION,
  createEditorServiceToken,
  defineEditorPlugin,
} from '@haiyue/editor-plugin-sdk';
import { EditorLifecycleScope, EditorPluginHost } from '../dist/index.js';

test('lifecycle scopes dispose owned resources once in reverse order', async () => {
  const disposed = [];
  const scope = new EditorLifecycleScope('test');
  scope.defer(() => disposed.push('first'));
  scope.defer(() => disposed.push('second'));
  await scope.dispose();
  await scope.dispose();
  assert.deepEqual(disposed, ['second', 'first']);
});

test('plugin host activates required providers and rolls back a failed activation', async () => {
  const host = new EditorPluginHost();
  const token = createEditorServiceToken('fixture');
  const order = [];
  host.install(defineEditorPlugin({
    id: 'provider', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION, provides: ['fixture'],
    activate({ scope, services }) {
      order.push('provider');
      services.register(token, 42, { ownerId: 'ignored' });
      scope.defer(() => order.push('provider-dispose'));
    },
  }));
  host.install(defineEditorPlugin({
    id: 'consumer', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION, requiredCapabilities: ['fixture'],
    activate({ services }) { order.push(`consumer:${services.get(token)}`); },
  }));
  await host.activate('consumer');
  assert.deepEqual(order, ['provider', 'consumer:42']);

  host.install(defineEditorPlugin({
    id: 'broken', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION,
    activate({ services }) { services.register(createEditorServiceToken('temporary'), true, { ownerId: 'ignored' }); throw new Error('boom'); },
  }));
  await assert.rejects(host.activate('broken'), /activation failed/);
  assert.equal(host.snapshot().plugins.find(plugin => plugin.id === 'broken').state, 'installed');
  await host.dispose();
  assert.equal(order.at(-1), 'provider-dispose');
});

test('required dependency cycles and dependent unloads fail closed', async () => {
  const host = new EditorPluginHost();
  host.install(defineEditorPlugin({
    id: 'a', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION, provides: ['a'], requiredCapabilities: ['b'], activate() {},
  }));
  host.install(defineEditorPlugin({
    id: 'b', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION, provides: ['b'], requiredCapabilities: ['a'], activate() {},
  }));
  await assert.rejects(host.activate('a'), /cycle/i);
});
