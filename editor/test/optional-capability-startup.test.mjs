import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OptionalEditorCapabilityLoader,
  collectOptionalCapabilitiesForProject,
} from '../dist-test/testing.js';

test('optional capability discovery scans scene entities and prefab resources', () => {
  assert.deepEqual(collectOptionalCapabilitiesForProject({
    entities: [{
      components: [
        { type: 'Transform2D' },
      ],
    }],
    resources: {
      models: [{ id: 1, name: 'Robot', src: 'robot.glb' }],
      prefabs: [{
        root: {
          components: [
            { type: 'Tween2DComponent', to: { x: 20 } },
            { type: 'Tilemap2DComponent', columns: 8 },
          ],
          children: [{ components: [{ type: 'Spine2DComponent' }] }],
        },
      }],
    },
  }), ['gltf', 'spine', 'tilemap', 'tween']);
});

test('one optional plugin failure degrades only that capability', async () => {
  const installed = [];
  const failures = [];
  const activated = [];
  const calls = new Map();
  const factory = (name, error = null, failCount = Infinity) => async () => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
    if (error && calls.get(name) <= failCount) throw error;
    return { name: `test/${name}`, version: '1.0.0' };
  };
  const loader = new OptionalEditorCapabilityLoader({
    installPlugin: plugin => installed.push(plugin.name),
    reportFailure: (capability, error) => failures.push([capability, error.message]),
    factories: {
      gltf: factory('gltf'),
      spine: factory('spine', new Error('spine unavailable'), 1),
      tilemap: factory('tilemap'),
      tween: factory('tween'),
    },
  });
  loader.subscribe(capability => activated.push(capability));

  await assert.rejects(
    loader.activateForProject({
      entities: [{
        components: [
          { type: 'GltfModelComponent' },
          { type: 'Spine2DComponent' },
          { type: 'Tilemap2DComponent' },
        ],
      }],
    }),
    /Project requires unavailable editor capabilities: spine/,
  );

  assert.deepEqual(installed.sort(), ['test/gltf', 'test/tilemap']);
  assert.deepEqual(activated.sort(), ['gltf', 'tilemap']);
  assert.deepEqual(failures, [['spine', 'spine unavailable']]);
  assert.equal(loader.isActive('gltf'), true);
  assert.equal(loader.isActive('spine'), false);

  assert.equal(await loader.activate('gltf'), true);
  assert.equal(await loader.activate('spine'), true);
  assert.equal(loader.isActive('spine'), true);
  assert.equal(calls.get('gltf'), 1);
  assert.equal(calls.get('spine'), 2);
  assert.equal(calls.get('tween'), undefined);
});
