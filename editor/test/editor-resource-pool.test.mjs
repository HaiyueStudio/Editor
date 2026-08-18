import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BasicMaterial,
  Entity,
  GltfModelComponent,
  Geometry3D,
  Mesh3D,
  ResourcePool,
  World,
  createGltfPlugin,
  createMainComponentContext,
  presentModelCompatibility,
} from '../dist-test/testing.js';

const compatibilityReport = Object.freeze({
  status: 'degraded',
  extensions: Object.freeze([
    Object.freeze({
      extension: 'VENDOR_optional',
      required: false,
      support: 'unsupported',
      disposition: 'ignored',
      note: 'Optional extension is ignored.',
    }),
  ]),
  textures: Object.freeze([
    Object.freeze({ textureIndex: 0, imageIndex: 0, mipmapSource: 'generated-full-chain', path: 'gltf.textures[0]', note: 'generated' }),
    Object.freeze({ textureIndex: 1, imageIndex: 1, mipmapSource: 'source-provided', path: 'gltf.textures[1]', note: 'source' }),
    Object.freeze({ textureIndex: 2, imageIndex: null, mipmapSource: 'unavailable', path: 'gltf.textures[2]', note: 'missing source' }),
  ]),
  bounds: Object.freeze([
    Object.freeze({ meshIndex: 0, primitiveIndex: 0, support: 'accessor-conservative', path: 'gltf.meshes[0].primitives[0]', reason: null }),
    Object.freeze({ meshIndex: 0, primitiveIndex: 1, support: 'fail-open', path: 'gltf.meshes[0].primitives[1]', reason: 'missing bounds' }),
    Object.freeze({ meshIndex: 1, primitiveIndex: 0, support: 'static', path: 'gltf.meshes[1].primitives[0]', reason: null }),
  ]),
  uvSemantics: Object.freeze([
    Object.freeze({
      meshIndex: 0,
      primitiveIndex: 0,
      capacity: 2,
      availableSemantics: Object.freeze(['TEXCOORD_0', 'TEXCOORD_3']),
      referencedSemantics: Object.freeze(['TEXCOORD_3']),
      mappings: Object.freeze([Object.freeze({ semantic: 'TEXCOORD_3', set: 3, channel: 0 })]),
      path: 'gltf.meshes[0].primitives[0]',
    }),
  ]),
  performance: Object.freeze({ loadMs: 12.25, decodedGeometryBytes: 1536 }),
  issues: Object.freeze([
    Object.freeze({
      category: 'bounds',
      path: 'gltf.meshes[0].primitives[1]',
      code: 'GLTF_BOUNDS_FAIL_OPEN',
      message: 'missing bounds',
    }),
  ]),
});

function createComponentLibrary() {
  const context = createMainComponentContext({
    createDefaultMesh2DComponent: () => null,
    createDefaultMeshComponent: () => null,
    createDefaultScriptComponent: () => null,
    getDefaultCanvasTextStyle: () => ({ font: '16px sans-serif' }),
  });
  context.installEditorPlugin(createGltfPlugin());
  return context.componentLibraries[0];
}

function createPool(assetManager = null, componentResourceExtensions = [createComponentLibrary()]) {
  return new ResourcePool({
    assetManager,
    componentResourceExtensions,
    getResourceName: (_resource, fallback) => fallback,
    getPrefabId: entity => entity.prefabId ?? null,
  });
}

function createAssetManager() {
  const assets = new Map();
  const deleted = [];
  const released = [];
  return {
    assets,
    deleted,
    released,
    setAsset(key, value) {
      assets.set(key, value);
    },
    deleteAsset(key) {
      deleted.push(key);
      assets.delete(key);
    },
    async loadTexture(source) {
      const key = `gpu:${typeof source === 'string' ? source : source.src ?? 'object'}`;
      return {
        key,
        release() {
          released.push(key);
        },
      };
    },
    getJobState() {
      return 'ready';
    },
  };
}

async function flushAsyncTextureSync() {
  await Promise.resolve();
  await Promise.resolve();
}

test('ResourcePool indexes textures and synchronizes editor asset handles', async () => {
  const assetManager = createAssetManager();
  const pool = createPool(assetManager);

  const first = pool.registerTexture('textures/albedo.png', {
    name: 'Albedo',
    width: 128,
    height: 64,
    fileType: 'image/png',
  });
  const duplicate = pool.registerTexture('textures/albedo.png');
  assert.equal(duplicate, first);

  await flushAsyncTextureSync();
  assert.deepEqual(assetManager.assets.get(first.assetKey), {
    id: first.id,
    name: 'Albedo',
    width: 128,
    height: 64,
    fileType: 'image/png',
    fileSize: undefined,
    previewUrl: undefined,
  });
  assert.equal(first.status, 'ready');
  assert.equal(first.gpuAssetKey, 'gpu:textures/albedo.png');

  assert.equal(pool.unregisterTexture(first.id), true);
  assert.deepEqual(assetManager.deleted, [first.assetKey]);
  assert.deepEqual(assetManager.released, ['gpu:textures/albedo.png']);
  assert.equal(pool.findTextureByResource('textures/albedo.png'), null);
});

test('ResourcePool tracks model references from live entities and serialized prefabs', () => {
  const pool = createPool();
  const model = pool.registerModel('models/character.glb', { name: 'Character' });
  const entity = new Entity('Character Entity');
  entity.addComponent(new GltfModelComponent({ src: 'models/character.glb' }));

  pool.trackEntity(entity);
  assert.equal(model.refs, 1);
  pool.untrackEntity(entity);
  assert.equal(model.refs, 0);

  const prefab = pool.registerPrefab({
    name: 'Character Prefab',
    components: [{ type: 'GltfModelComponent', src: 'models/character.glb' }],
    children: [],
  }, 'Character Prefab');
  assert.equal(model.refs, 1);
  pool.unregisterPrefab(prefab.id);
  assert.equal(model.refs, 0);
});

test('model compatibility presentation and ResourcePool preserve the loader report contract', () => {
  const presentation = presentModelCompatibility(compatibilityReport);
  assert.deepEqual(presentation, {
    status: 'degraded',
    extensions: 'VENDOR_optional: unsupported — Optional extension is ignored.',
    mipmaps: 'generated 1, source 1, unavailable 1',
    bounds: 'conservative 1, static 1, fail-open 1',
    uvSemantics: 'TEXCOORD_3->UV0 (capacity 2)',
    performance: 'load 12.3 ms, decoded geometry 1.5 KiB',
    issues: ['[GLTF_BOUNDS_FAIL_OPEN] gltf.meshes[0].primitives[1]: missing bounds'],
  });
  assert.equal(Object.isFrozen(presentation), true);
  assert.equal(Object.isFrozen(presentation.issues), true);

  const pool = createPool();
  const model = pool.registerModel('models/degraded.glb', {
    name: 'Degraded Model',
    compatibilityReport,
  });
  assert.equal(model.compatibilityReport, compatibilityReport);
  assert.equal(pool.models.get(model.id)?.compatibilityReport, compatibilityReport);
});

test('ResourcePool model references are supplied by component resource extensions', () => {
  const pool = createPool(null, []);
  const model = pool.registerModel('models/character.glb', { name: 'Character' });
  const entity = new Entity('Character Entity');
  entity.addComponent(new GltfModelComponent({ src: 'models/character.glb' }));

  pool.trackEntity(entity);
  assert.equal(model.refs, 0);

  pool.setComponentResourceExtensions([createComponentLibrary()]);
  pool.trackEntity(entity);
  assert.equal(model.refs, 1);
});

test('ResourcePool creates prefab variants, detects conflicts, and resolves fields', () => {
  const pool = createPool();
  const baseRoot = {
    name: 'Base',
    disabled: false,
    components: [],
    children: [
      { name: 'Child', disabled: false, components: [], children: [] },
    ],
  };
  const base = pool.registerPrefab(baseRoot, 'Base', 10);
  const variant = pool.createPrefabVariant(base, 'Variant', 11);
  const editedVariantRoot = pool.resolvePrefabRoot(variant);
  editedVariantRoot.name = 'Variant Root';
  editedVariantRoot.children[0].disabled = true;

  pool.updatePrefabVariantRoot(variant, editedVariantRoot);
  assert.deepEqual(variant.variantOverrides, [
    { path: [], name: 'Variant Root' },
    { path: [0], disabled: true },
  ]);
  assert.equal(pool.resolvePrefabRoot(variant).children[0].disabled, true);

  pool.registerPrefab({
    name: 'Base',
    disabled: false,
    components: [],
    children: [
      { name: 'Renamed Child', disabled: false, components: [], children: [] },
    ],
  }, 'Base', 10);

  assert.deepEqual(pool.getPrefabVariantConflicts(variant), [
    { path: [], fields: ['name'], baseRevision: 1, currentBaseRevision: 2 },
    { path: [0], fields: ['disabled'], baseRevision: 1, currentBaseRevision: 2 },
  ]);

  pool.acceptBaseForVariantField(variant, [0], 'disabled');
  assert.equal(pool.resolvePrefabRoot(variant).children[0].name, 'Renamed Child');
  assert.equal(pool.resolvePrefabRoot(variant).children[0].disabled, false);
  assert.deepEqual(variant.variantOverrides, [{ path: [], name: 'Variant Root' }]);

  pool.keepOverrideForVariantField(variant, [], 'name');
  assert.equal(variant.baseRevision, 2);
  assert.equal(pool.getPrefabVariantConflicts(variant).length, 0);
});

test('ResourcePool refreshes Mesh3D material and geometry references when entities change', () => {
  const pool = createPool();
  const geometryA = new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) });
  const geometryB = new Geometry3D({ positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]) });
  const materialA = new BasicMaterial();
  const materialB = new BasicMaterial();
  pool.registerGeometry(geometryA, 'Geometry A');
  pool.registerGeometry(geometryB, 'Geometry B');
  pool.registerMaterial(materialA, 'Material A');
  pool.registerMaterial(materialB, 'Material B');

  const entity = new Entity('Mesh');
  const mesh = new Mesh3D(geometryA, materialA);
  entity.addComponent(mesh);

  pool.trackEntity(entity);
  assert.equal(pool.geometries.get(geometryA.id).refs, 1);
  assert.equal(pool.materials.get(materialA.id).refs, 1);

  mesh.geometry = geometryB;
  mesh.material = materialB;
  pool.trackEntity(entity);
  assert.equal(pool.geometries.get(geometryA.id).refs, 0);
  assert.equal(pool.materials.get(materialA.id).refs, 0);
  assert.equal(pool.geometries.get(geometryB.id).refs, 1);
  assert.equal(pool.materials.get(materialB.id).refs, 1);
});

test('ResourcePool consumes World changes incrementally and emits coalesced resource changes', () => {
  const pool = createPool();
  const geometryA = new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) });
  const geometryB = new Geometry3D({ positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]) });
  const materialA = new BasicMaterial();
  const materialB = new BasicMaterial();
  pool.registerGeometry(geometryA, 'Geometry A');
  pool.registerGeometry(geometryB, 'Geometry B');
  pool.registerMaterial(materialA, 'Material A');
  pool.registerMaterial(materialB, 'Material B');

  const initialResources = pool.consumeChanges();
  assert.deepEqual(new Set(initialResources.added), new Set([
    `geometry3d:${geometryA.id}`,
    `geometry3d:${geometryB.id}`,
    `material3d:${materialA.id}`,
    `material3d:${materialB.id}`,
  ]));

  const world = new World('Incremental resource world');
  const entity = new Entity('Mesh');
  const mesh = new Mesh3D(geometryA, materialA);
  entity.addComponent(mesh);
  world.addEntity(entity);

  pool.syncWorld(world);
  assert.deepEqual(new Set(pool.consumeChanges().referencesChanged), new Set([
    `geometry3d:${geometryA.id}`,
    `material3d:${materialA.id}`,
  ]));

  pool.syncWorld(world);
  assert.deepEqual(pool.consumeChanges(), {
    version: initialResources.version + 2,
    added: [],
    updated: [],
    removed: [],
    referencesChanged: [],
  });

  mesh.geometry = geometryB;
  mesh.material = materialB;
  pool.syncWorld(world);
  assert.equal(pool.geometries.get(geometryA.id).refs, 0);
  assert.equal(pool.geometries.get(geometryB.id).refs, 1);
  assert.equal(pool.materials.get(materialA.id).refs, 0);
  assert.equal(pool.materials.get(materialB.id).refs, 1);
  assert.deepEqual(new Set(pool.consumeChanges().referencesChanged), new Set([
    `geometry3d:${geometryA.id}`,
    `geometry3d:${geometryB.id}`,
    `material3d:${materialA.id}`,
    `material3d:${materialB.id}`,
  ]));

  world.removeEntity(entity);
  pool.syncWorld(world);
  assert.equal(pool.geometries.get(geometryB.id).refs, 0);
  assert.equal(pool.materials.get(materialB.id).refs, 0);
  assert.deepEqual(new Set(pool.consumeChanges().referencesChanged), new Set([
    `geometry3d:${geometryB.id}`,
    `material3d:${materialB.id}`,
  ]));
});

test('ResourcePool change sets coalesce transient and replacement mutations', () => {
  const pool = createPool();
  const transient = pool.registerModel('transient.glb', { id: 20, name: 'Transient' });
  pool.unregisterModel(transient.id);
  const transientChanges = pool.consumeChanges();
  assert.deepEqual(transientChanges.added, []);
  assert.deepEqual(transientChanges.removed, []);

  pool.registerModel('old.glb', { id: 21, name: 'Old' });
  pool.consumeChanges();
  pool.unregisterModel(21);
  pool.registerModel('new.glb', { id: 21, name: 'New' });
  const replacementChanges = pool.consumeChanges();
  assert.deepEqual(replacementChanges.updated, ['model:21']);
  assert.deepEqual(replacementChanges.added, []);
  assert.deepEqual(replacementChanges.removed, []);
});

test('ResourcePool only re-collects entities named by the World journal', () => {
  let componentVisits = 0;
  const pool = createPool(null, [{
    collectComponentResourceUsage() {
      componentVisits++;
    },
  }]);
  const geometry = new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) });
  const materialA = new BasicMaterial();
  const materialB = new BasicMaterial();
  pool.registerGeometry(geometry);
  pool.registerMaterial(materialA);
  pool.registerMaterial(materialB);

  const world = new World('Sparse resource updates');
  const meshes = [];
  for (let index = 0; index < 64; index++) {
    const entity = new Entity(`Mesh ${index}`);
    const mesh = new Mesh3D(geometry, materialA);
    meshes.push(mesh);
    entity.addComponent(mesh);
    world.addEntity(entity);
  }
  pool.syncWorld(world);
  assert.equal(componentVisits, 64);

  componentVisits = 0;
  meshes[17].material = materialB;
  pool.syncWorld(world);
  assert.equal(componentVisits, 1);
});
