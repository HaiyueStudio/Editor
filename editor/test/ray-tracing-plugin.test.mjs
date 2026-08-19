import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorPlatform } from '@haiyue/editor-platform';
import { EDITOR_PLUGIN_API_VERSION, defineEditorPlugin, defineEditorProduct } from '@haiyue/editor-plugin-sdk';
import { sceneRayTracingPlugin } from '../dist-test/testing.js';

test('ray tracing preview is removable and keeps document/history truth untouched', async () => {
  const platform = new EditorPlatform();
  const core = defineEditorPlugin({
    id: 'test.scene-core', version: '1.0.0', apiVersion: EDITOR_PLUGIN_API_VERSION,
    provides: ['scene.document', 'scene.viewport'], activate() {},
  });
  await platform.start(defineEditorProduct({
    schemaVersion: 1, id: 'test.scene', version: '1.0.0', displayName: 'Test Scene', requiredPlugins: [core],
  }));
  let revision = 4;
  let savedRevision = 3;
  let changed = () => {};
  let serializeCount = 0;
  const document = {
    identity: Object.freeze({ id: 'scene.a', kind: 'haiyue.scene', name: 'A' }),
    get revision() { return revision; },
    get savedRevision() { return savedRevision; },
    serialize() { serializeCount++; return Object.freeze({ name: 'A' }); },
    markSaved(value = revision) { savedRevision = value; changed(); },
    subscribe(listener) { changed = listener; return Object.freeze({ dispose() { changed = () => {}; } }); },
    dispose() {},
  };
  platform.documents.attach(document);
  const historyBefore = platform.history.snapshot();
  platform.plugins.install(sceneRayTracingPlugin);
  await platform.plugins.activate(sceneRayTracingPlugin.id);
  assert.equal(platform.plugins.isActive(sceneRayTracingPlugin.id), true);
  const contribution = platform.contributions.list('panel').find(value => value.id === 'scene.ray-tracing-preview');
  assert.ok(contribution);
  const owner = contribution.value.owner;
  owner.configure({ mode: 'hybrid', effect: 'shadows' });
  await owner.render();
  assert.equal(owner.snapshot().status, 'unsupported');
  assert.equal(owner.snapshot().diagnostics[0].code, 'RAY_EDITOR_EFFECT_UNSUPPORTED');
  assert.equal(serializeCount, 0, 'unsupported policy must not even serialize document truth');
  revision++;
  changed();
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(document.revision, 5);
  assert.equal(document.savedRevision, 3);
  assert.deepEqual(platform.history.snapshot(), historyBefore);
  await platform.plugins.disable(sceneRayTracingPlugin.id);
  assert.equal(platform.contributions.list('panel').some(value => value.ownerId === sceneRayTracingPlugin.id), false);
  assert.equal(platform.tasks.activeCount, 0);
  assert.equal(owner.snapshot().status, 'disposed');
  await platform.plugins.activate(sceneRayTracingPlugin.id);
  assert.equal(platform.contributions.list('panel').filter(value => value.ownerId === sceneRayTracingPlugin.id).length, 1);
  await platform.dispose();
});
