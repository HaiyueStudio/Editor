import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserializeEntity, loadPlayerOptionalRuntime } from '../dist-test/testing.js';

const emptyScene = Object.freeze({
  version: 1,
  name: 'Player cold-start boundary',
  globals: {
    designWidth: 1280,
    designHeight: 720,
    clearColor: [0, 0, 0, 1],
    parameters: {},
    inputMap: {},
  },
  systems: [],
  resources: {
    geometries: [],
    materials: [],
    textures: [],
    models: [],
    prefabs: [],
    scripts: [],
  },
  entities: [],
});

test('basic player scene does not activate optional component or physics runtimes', async () => {
  const runtime = await loadPlayerOptionalRuntime(emptyScene);
  assert.deepEqual(runtime.componentExtensions, []);
  assert.deepEqual(runtime.runtimeApiCapabilities.componentConstructors, {});
  assert.equal(runtime.runtimeApiCapabilities.canvasTextComponent, undefined);
  assert.equal(runtime.runtimeApiCapabilities.createPhysicsApi, undefined);
});

test('physics player scene activates the preserved script API only on demand', async () => {
  const runtime = await loadPlayerOptionalRuntime({
    ...emptyScene,
    systems: [{
      type: 'Physics2DSystem',
      gravity: [0, 9.8],
      pixelsPerMeter: 50,
      fixedTimeStep: 1 / 60,
      maxSubSteps: 4,
      velocityIterations: 8,
      positionIterations: 3,
      syncStaticBodiesFromTransform: true,
      priority: 0,
    }],
  });
  assert.equal(typeof runtime.runtimeApiCapabilities.createPhysicsApi, 'function');
  assert.equal(
    typeof runtime.runtimeApiCapabilities.componentConstructors.Physics2DSystem,
    'function',
  );
});

test('optional runtime restores Tilemap components before starter scripts execute', async () => {
  const serializedBoard = {
    name: 'Tetris Board',
    disabled: false,
    components: [{
      type: 'Tilemap2DComponent',
      columns: 10,
      rows: 20,
      cellWidth: 32,
      cellHeight: 32,
      originX: 0,
      originY: 0,
      gap: 2,
      cells: Array(200).fill(0),
      palette: [[0, 0, 0, 0], [0.13, 0.83, 0.93, 1]],
    }],
    children: [],
  };
  const runtime = await loadPlayerOptionalRuntime({
    ...emptyScene,
    entities: [serializedBoard],
  });
  const Tilemap2DComponent = runtime.runtimeApiCapabilities.componentConstructors.Tilemap2DComponent;
  assert.equal(typeof Tilemap2DComponent, 'function');

  const board = deserializeEntity(serializedBoard, new Map(), new Map(), new Map(), {
    extensions: runtime.componentExtensions,
  });
  const tilemap = board.getComponent(Tilemap2DComponent);
  assert.ok(tilemap);
  assert.equal(tilemap.name, 'Tilemap2DComponent');
  assert.equal(tilemap.columns, 10);
  assert.equal(tilemap.rows, 20);
  assert.equal(tilemap.gap, 2);
});

test('player runtime adapter keeps optional packages behind PlayerOptionalRuntime', () => {
  const adapter = readFileSync(new URL('../src/engine-adapter/PlayerRuntimeAdapter.ts', import.meta.url), 'utf8');
  for (const packageName of [
    '@haiyue/engine/physics',
    '@haiyue/extensions/canvas-text',
    '@haiyue/extensions/gltf',
    '@haiyue/extensions/grid',
    '@haiyue/extensions/spine',
    '@haiyue/extensions/tilemap',
    '@haiyue/extensions/tween',
  ]) {
    assert.doesNotMatch(adapter, new RegExp(`from ['"]${packageName.replaceAll('/', '\\/')}['"]`));
  }
  const optionalRuntime = readFileSync(new URL('../src/player/PlayerOptionalRuntime.ts', import.meta.url), 'utf8');
  assert.match(optionalRuntime, /import\('@haiyue\/engine\/physics'\)/);
  assert.match(optionalRuntime, /import\('@haiyue\/extensions\/gltf'\)/);
});

test('player and export worker keep cold capabilities behind dynamic imports', () => {
  const player = readFileSync(new URL('../src/player.ts', import.meta.url), 'utf8');
  for (const modulePath of [
    './domain/scene/deserialization',
    './engine-adapter/PlayerRuntimeAdapter',
    './player/PlayerDebugRuntime',
    './player/PlayerShadowRuntime',
  ]) {
    assert.match(player, new RegExp(`import\\(['"]${modulePath.replaceAll('/', '\\/')}['"]\\)`));
  }
  assert.doesNotMatch(player, /import\s*\{[^}]*InstancedMesh3DRenderSystem[^}]*\}\s*from ['"]@haiyue\/engine\/systems['"]/s);
  const adapter = readFileSync(new URL('../src/engine-adapter/PlayerRuntimeAdapter.ts', import.meta.url), 'utf8');
  assert.match(adapter, /export \{[^}]*InstancedMesh3DRenderSystem[^}]*\}/s);
  const worker = readFileSync(new URL('../src/export/exportWorkerEntry.ts', import.meta.url), 'utf8');
  for (const [modulePath, eagerBinding] of [
    ['./texturePipeline', 'optimizeRuntimeTextures'],
    ['./projectTemplate', 'generateRuntimeProjectFiles'],
    ['./projectZip', 'createRuntimeProjectZipBytes'],
  ]) {
    assert.match(worker, new RegExp(`import\\(['"]${modulePath.replaceAll('/', '\\/')}['"]\\)`));
    assert.doesNotMatch(worker, new RegExp(`import\\s*\\{[^}]*${eagerBinding}[^}]*\\}\\s*from ['"]${modulePath.replaceAll('/', '\\/')}['"]`));
  }
});
