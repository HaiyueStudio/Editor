import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EditorAssetAdapter,
  EditorSceneAdapter,
  EditorPluginHost,
  EngineErrorCode,
  RuntimeOwnershipScope,
} from '../dist-test/testing.js';

test('EditorPluginHost installs, rolls back, restores dependencies, and protects unload', () => {
  const calls = [];
  const host = new EditorPluginHost({
    createContext(tracker) {
      return {
        scope: 'editor',
        rollback: tracker,
        unregister: () => tracker.unregister(),
        registerComponentDescriptor(descriptor) {
          calls.push(`descriptor:${descriptor.name}`);
          tracker.track(() => calls.push(`descriptor:remove:${descriptor.name}`));
        },
        registerInspectorRenderer() {},
        registerResourceImporter() {},
        registerStarterKit() {},
      };
    },
  });

  const base = {
    name: 'base',
    version: '1.0.0',
    installEditor(context) {
      calls.push('base:install');
      context.registerComponentDescriptor({ name: 'BaseComponent' });
    },
    enableEditor() { calls.push('base:enable'); },
    disableEditor() { calls.push('base:disable'); },
    uninstallEditor() { calls.push('base:uninstall'); },
  };
  const dependent = {
    name: 'dependent',
    version: '1.0.0',
    dependencies: ['base'],
    installEditor() { calls.push('dependent:install'); },
    enableEditor() { calls.push('dependent:enable'); },
  };

  host.installPlugin(base);
  host.disablePlugin('base');
  host.installPlugin(dependent);
  assert.equal(host.isPluginEnabled('base'), true);
  assert.throws(
    () => host.removePlugin('base'),
    error => error.code === EngineErrorCode.PluginDependencyInUse,
  );
  host.removePlugin('dependent');
  host.removePlugin('base');

  assert.deepEqual(calls, [
    'base:install',
    'descriptor:BaseComponent',
    'base:enable',
    'base:disable',
    'dependent:install',
    'base:enable',
    'dependent:enable',
    'base:disable',
    'base:uninstall',
    'descriptor:remove:BaseComponent',
  ]);
});

test('RuntimeOwnershipScope releases play restart owners in one idempotent order', () => {
  const calls = [];
  const scope = new RuntimeOwnershipScope();
  scope.bindEngine({ stop: () => calls.push('engine:stop'), destroy: () => calls.push('engine:destroy') });
  scope.bindWorld({ destroy: () => calls.push('world:destroy') });
  scope.bindPointer({ destroy: () => calls.push('pointer:destroy') });

  scope.release();
  scope.release();
  assert.deepEqual(calls, ['engine:stop', 'world:destroy', 'pointer:destroy', 'engine:destroy']);
});

test('EditorAssetAdapter attaches ResourcePool to engine AssetManager', () => {
  const attached = [];
  const resourcePool = {
    attachAssetManager(assetManager) {
      attached.push(assetManager);
    },
  };
  const assetAdapter = new EditorAssetAdapter({ resourcePool });
  const assetManager = { id: 'asset-manager' };

  assetAdapter.attachEngine({ assetManager });
  assetAdapter.attachEngine(null);
  assetAdapter.attachAssetManager(assetManager);

  assert.deepEqual(attached, [assetManager, null, assetManager]);
});

test('EditorSceneAdapter owns editor scene session state behind an adapter boundary', () => {
  const adapter = new EditorSceneAdapter({
    resourcePool: {},
    resourceDisplayNames: new WeakMap(),
    componentLibraries: [],
    getGlobalSettings: () => ({ gameName: 'Test' }),
    setGlobalSettings() {},
    applyGlobalSettingsToWorld() {},
    syncViewportClearColor() {},
    clearResourceSelection() {},
    setActiveScriptResource() {},
    setSelectedComponentName() {},
    renderGlobalSettingsPanel() {},
    refreshResourcePool() {},
  });
  const systems = [{ type: 'Physics2DSystem', disabled: false }];
  const clipboard = [{ id: 1 }];

  adapter.setSystemConfigs(systems);
  adapter.addSystemConfig({ type: 'RadialShadowRenderFeature', disabled: false });
  adapter.setEntityClipboard(clipboard);

  assert.equal(adapter.sceneActions !== null, true);
  assert.deepEqual(adapter.getSystemConfigs(), [
    { type: 'Physics2DSystem', disabled: false },
    { type: 'RadialShadowRenderFeature', disabled: false },
  ]);
  assert.equal(adapter.getEntityClipboard(), clipboard);
  adapter.clearEntityClipboard();
  assert.deepEqual(adapter.getEntityClipboard(), []);
});
