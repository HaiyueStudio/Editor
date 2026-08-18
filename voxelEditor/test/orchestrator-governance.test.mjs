import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CommandHistory } from '../dist/commands.js';
import { packVoxelKey, VoxelDocument } from '../dist/model.js';
import {
  migrateVoxelProject,
  VoxelProjectMigrationError,
} from '../dist-test/project-migration.js';
import { VoxelRenderProjectionCache } from '../dist-test/voxel-render-projection-cache.js';
import { VoxelSceneProjectionCache } from '../dist-test/voxel-scene-projection-cache.js';

test('command execute, undo and redo each commit one atomic document transaction', () => {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const history = new CommandHistory()
    .setTransactionRunner(operation => document.transact(operation));
  const changes = [];
  document.addEventListener('change', event => changes.push(event.detail));
  const command = {
    label: '原子双体素操作',
    execute() {
      document.setVoxel(1, 1, 1, '#123456');
      document.setVoxel(2, 1, 1, '#654321');
      return true;
    },
    undo() {
      document.removeVoxel(1, 1, 1);
      document.removeVoxel(2, 1, 1);
    },
  };

  assert.equal(history.execute(command), true);
  assert.equal(changes.length, 1);
  assert.deepEqual(new Set(changes[0].impact.voxelKeys), new Set([
    packVoxelKey(1, 1, 1),
    packVoxelKey(2, 1, 1),
  ]));

  history.undo();
  assert.equal(changes.length, 2);
  assert.equal(document.voxelCount, 0);

  history.redo();
  assert.equal(changes.length, 3);
  assert.equal(document.voxelCount, 2);
});

test('preview transaction cancellation and repeated close are idempotent', () => {
  const document = new VoxelDocument({ x: 4, y: 4, z: 4 });
  let changes = 0;
  document.addEventListener('change', () => { changes += 1; });
  const transaction = document.beginTransaction();
  document.setVoxel(1, 1, 1);
  document.removeVoxel(1, 1, 1);
  transaction.cancel();
  transaction.cancel();
  transaction.commit();

  assert.equal(changes, 0);
  assert.equal(document.voxelCount, 0);
});

test('an out-of-order transaction close stays active and can recover in LIFO order', () => {
  const document = new VoxelDocument({ x: 4, y: 4, z: 4 });
  let changes = 0;
  document.addEventListener('change', () => { changes += 1; });
  const outer = document.beginTransaction();
  const inner = document.beginTransaction();

  assert.throws(
    () => outer.commit(),
    /transactions must close in reverse order/,
  );
  assert.equal(outer.active, true);
  assert.equal(inner.active, true);

  document.setVoxel(0, 0, 0);
  inner.commit();
  assert.equal(changes, 0);
  outer.commit();
  assert.equal(changes, 1);

  document.setVoxel(1, 0, 0);
  assert.equal(changes, 2);
  assert.equal(outer.active, false);
  assert.equal(inner.active, false);
});

test('version migration is explicit, path-structured and preserves version-1 serialization', () => {
  const legacy = {
    format: 'haiyue-voxel',
    version: 0,
    size: { x: 6, y: 7, z: 8 },
    voxels: [{ x: 1, y: 2, z: 3, color: '#123456' }],
  };
  const migrated = migrateVoxelProject(legacy);
  assert.equal(migrated.version, 1);
  assert.equal(migrated.editor.currentColor, '#69d2e7');
  assert.equal(legacy.version, 0);

  const document = new VoxelDocument();
  document.load(legacy);
  assert.equal(document.toJSON().version, 1);
  assert.equal(document.get(1, 2, 3)?.color, '#123456');

  assert.throws(
    () => migrateVoxelProject({ format: 'haiyue-voxel', version: 99 }),
    error => error instanceof VoxelProjectMigrationError
      && error.path === '$.version'
      && /不支持版本/.test(error.message),
  );
});

test('save/load roundtrip retains hierarchy, palette and animation timeline data', () => {
  const source = new VoxelDocument({ x: 20, y: 12, z: 20 });
  source.setVoxel(0, 0, 0, '#123456');
  const layer = source.createLayer('角色');
  const module = source.createModule('角色模块', { x: 2, y: 2, z: 2 });
  source.setVoxel(0, 0, 0, '#abcdef');
  source.setVoxel(1, 0, 0, '#654321');
  source.editScene();
  const instance = source.addModuleInstance(module.id, { x: 3, y: 1, z: 4 }, layer.id);
  const animation = source.createAnimation('移动', 24, 12);
  source.updateAnimation(animation.id, { loop: false, playbackStart: 2, playbackEnd: 20 });
  source.setAnimationKeyframe(animation.id, instance.id, 2, instance);
  source.setAnimationKeyframe(animation.id, instance.id, 20, {
    ...instance,
    position: { x: 10, y: 1, z: 4 },
    visible: false,
  });
  source.setAnimationFrame(20);

  const serialized = JSON.parse(JSON.stringify(source.toJSON()));
  const restored = new VoxelDocument();
  restored.load(serialized);
  assert.deepEqual(restored.toJSON(), serialized);
});

test('renderer reverse indexes remove whole-model scans from material and instance invalidation', () => {
  const cache = new VoxelRenderProjectionCache();
  cache.set('1,0,0', 'red', 'left');
  cache.set('2,0,0', 'red', 'right');
  cache.set('3,0,0', 'blue', 'right');

  assert.deepEqual(cache.keysForMaterials(['red']), new Set(['1,0,0', '2,0,0']));
  assert.deepEqual(cache.keysForInstances(['right']), new Set(['2,0,0', '3,0,0']));
  cache.set('2,0,0', 'blue', 'left');
  assert.deepEqual(cache.keysForMaterials(['red']), new Set(['1,0,0']));
  cache.delete('1,0,0');
  assert.equal(cache.size, 2);
});

test('large instance edits rebuild only the changed projection and touched coordinates', () => {
  const moduleVoxels = new Map();
  for (let z = 0; z < 5; z += 1) {
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        moduleVoxels.set(packVoxelKey(x, y, z), { x, y, z, color: '#ffffff' });
      }
    }
  }
  const module = {
    id: 'module-1',
    name: 'large',
    size: { x: 20, y: 10, z: 5 },
    voxels: moduleVoxels,
    revision: 1,
  };
  const instance = (id, x) => ({
    id,
    moduleId: module.id,
    name: id,
    position: { x, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    layerId: 'layer-1',
    visible: true,
  });
  const instances = new Map([
    ['instance-1', instance('instance-1', 0)],
    ['instance-2', instance('instance-2', 40)],
  ]);
  let baseGets = 0;
  const baseVoxels = {
    get() {
      baseGets += 1;
      return undefined;
    },
  };
  const input = {
    size: { x: 100, y: 20, z: 20 },
    baseVoxels,
    modules: new Map([[module.id, module]]),
    instances,
    layers: new Map([['layer-1', { id: 'layer-1', name: 'default', visible: true, locked: false }]]),
    animation: null,
    frame: 0,
  };
  const cache = new VoxelSceneProjectionCache();
  const first = cache.project({
    ...input,
    requestedKeys: [],
    changedInstanceIds: instances.keys(),
  });
  const oldFirstKeys = [...first.voxels]
    .filter(([, voxel]) => voxel.moduleInstanceId === 'instance-1')
    .map(([key]) => key);
  instances.set('instance-1', instance('instance-1', 1));
  const second = cache.project({
    ...input,
    requestedKeys: oldFirstKeys,
    changedInstanceIds: ['instance-1'],
  });

  assert.equal(cache.diagnostics.projectionBuilds, 3);
  assert.ok(cache.diagnostics.projectionReuses >= 1);
  assert.equal(cache.diagnostics.lastRecomposedKeyCount, 1_050);
  assert.equal(second.keys.size, 1_050);
  assert.equal(baseGets, first.keys.size + second.keys.size);
});

test('incremental scene projection preserves overlap priority and uncovers lower layers', () => {
  const module = {
    id: 'module-1',
    name: 'single',
    size: { x: 1, y: 1, z: 1 },
    voxels: new Map([[packVoxelKey(0, 0, 0), { x: 0, y: 0, z: 0, color: '#ffffff' }]]),
    revision: 1,
  };
  const makeInstance = id => ({
    id,
    moduleId: module.id,
    name: id,
    position: { x: 1, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    layerId: 'layer-1',
    visible: true,
  });
  const instances = new Map([
    ['lower', makeInstance('lower')],
    ['upper', makeInstance('upper')],
  ]);
  const input = {
    size: { x: 8, y: 8, z: 8 },
    baseVoxels: new Map([[packVoxelKey(1, 0, 0), { x: 1, y: 0, z: 0, color: '#ff0000' }]]),
    modules: new Map([[module.id, module]]),
    instances,
    layers: new Map([['layer-1', { id: 'layer-1', name: 'default', visible: true, locked: false }]]),
    animation: null,
    frame: 0,
  };
  const cache = new VoxelSceneProjectionCache();
  const first = cache.project({
    ...input,
    requestedKeys: [],
    changedInstanceIds: instances.keys(),
  });
  const key = packVoxelKey(1, 0, 0);
  assert.equal(first.voxels.get(key)?.moduleInstanceId, 'upper');

  instances.delete('upper');
  const second = cache.project({
    ...input,
    requestedKeys: [key],
    changedInstanceIds: ['upper'],
  });
  assert.equal(second.voxels.get(key)?.moduleInstanceId, 'lower');

  instances.delete('lower');
  const third = cache.project({
    ...input,
    requestedKeys: [key],
    changedInstanceIds: ['lower'],
  });
  assert.equal(third.voxels.get(key)?.source, 'base');
});

test('commands and model retain domain boundaries instead of UI/renderer lifecycles', async () => {
  const commandsSource = await readFile(new URL('../src/commands.ts', import.meta.url), 'utf8');
  const modelSource = await readFile(new URL('../src/model.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(commandsSource, /from\s+['"].*VoxelRenderer/);
  assert.doesNotMatch(commandsSource, /\._renderer\b/);
  assert.doesNotMatch(modelSource, /\bHTMLElement\b|\brequestAnimationFrame\b|from\s+['"].*controllers\//);
  assert.doesNotMatch(modelSource, /from\s+['"].*render\//);
});
