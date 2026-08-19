import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_PLUGIN_API_VERSION,
  createEditorServiceToken,
  defineEditorPlugin,
  defineEditorProduct,
} from '../dist/index.js';

test('service tokens are stable by id without exposing a mutable registry key', () => {
  const left = createEditorServiceToken('history');
  const right = createEditorServiceToken('history');
  assert.equal(left.key, right.key);
  assert.ok(Object.isFrozen(left));
});

test('plugin and product manifests reject invalid or duplicate identities', () => {
  const plugin = defineEditorPlugin({
    id: 'scene.core', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION, activate() {},
  });
  assert.ok(Object.isFrozen(plugin));
  assert.throws(() => defineEditorProduct({
    schemaVersion: 1,
    id: 'scene',
    version: '0.1.0',
    displayName: 'Scene',
    requiredPlugins: [plugin],
    defaultPlugins: [plugin],
  }), /Duplicate product plugin/);
});
