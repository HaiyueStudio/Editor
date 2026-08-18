import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BasicMaterial,
  CanvasTextComponent,
  DataComponent,
  Entity,
  EngineErrorCode,
  Geometry3D,
  GltfModelComponent,
  Mesh3D,
  PbrMaterial,
  ResourcePool,
  Spine2DComponent,
  ToonMaterial,
  World,
  createGltfPlugin,
  createMainComponentContext,
  createSpinePlugin,
  createTilemapPlugin,
  deserializeEntity,
  deserializeGeometry,
  deserializeMaterial,
  serializeEditorScene,
  serializeEntity,
  serializeMaterial,
  validateSerializedEditorScene,
} from '../dist-test/testing.js';

test('PBR advanced material extensions survive editor serialization and runtime reconstruction', () => {
  const pool = createPool();
  const factor = pool.registerTexture('textures/clearcoat.png', { name: 'Clearcoat' });
  const roughness = pool.registerTexture('textures/clearcoat-roughness.png', { name: 'Clearcoat roughness' });
  const normal = pool.registerTexture('textures/clearcoat-normal.png', { name: 'Clearcoat normal' });
  const specular = pool.registerTexture('textures/specular.png', { name: 'Specular' });
  const specularColor = pool.registerTexture('textures/specular-color.png', { name: 'Specular color' });
  const sheenColor = pool.registerTexture('textures/sheen-color.png', { name: 'Sheen color' });
  const sheenRoughness = pool.registerTexture('textures/sheen-roughness.png', { name: 'Sheen roughness' });
  const transmission = pool.registerTexture('textures/transmission.png', { name: 'Transmission' });
  const thickness = pool.registerTexture('textures/thickness.png', { name: 'Thickness' });
  const material = new PbrMaterial({
    clearcoatFactor: 0.85,
    clearcoatTexture: factor.resource,
    clearcoatRoughnessFactor: 0.22,
    clearcoatRoughnessTexture: roughness.resource,
    clearcoatNormalTexture: normal.resource,
    clearcoatNormalScale: 0.7,
    ior: 1.33,
    specularFactor: 0.62,
    specularColorFactor: [1.2, 0.8, 0.6],
    specularTexture: specular.resource,
    specularColorTexture: specularColor.resource,
    sheenColorFactor: [0.75, 0.2, 0.45],
    sheenRoughnessFactor: 0.38,
    sheenColorTexture: sheenColor.resource,
    sheenRoughnessTexture: sheenRoughness.resource,
    transmissionFactor: 0.7,
    transmissionTexture: transmission.resource,
    thicknessFactor: 0.45,
    thicknessTexture: thickness.resource,
    attenuationDistance: 2.5,
    attenuationColor: [0.9, 0.65, 0.4],
  });
  const serialized = serializeMaterial({ name: 'Coated', resource: material }, pool);
  assert.ok(serialized);
  assert.equal(serialized.clearcoatFactor, 0.85);
  assert.equal(serialized.clearcoatTextureId, factor.id);
  assert.equal(serialized.clearcoatRoughnessTextureId, roughness.id);
  assert.equal(serialized.clearcoatNormalTextureId, normal.id);
  assert.equal(serialized.ior, 1.33);
  assert.equal(serialized.specularFactor, 0.62);
  assert.deepEqual(serialized.specularColorFactor, [1.2, 0.8, 0.6]);
  assert.equal(serialized.specularTextureId, specular.id);
  assert.equal(serialized.specularColorTextureId, specularColor.id);
  assert.deepEqual(serialized.sheenColorFactor, [0.75, 0.2, 0.45]);
  assert.equal(serialized.sheenRoughnessFactor, 0.38);
  assert.equal(serialized.sheenColorTextureId, sheenColor.id);
  assert.equal(serialized.sheenRoughnessTextureId, sheenRoughness.id);
  assert.equal(serialized.transmissionFactor, 0.7);
  assert.equal(serialized.transmissionTextureId, transmission.id);
  assert.equal(serialized.thicknessFactor, 0.45);
  assert.equal(serialized.thicknessTextureId, thickness.id);
  assert.equal(serialized.attenuationDistance, 2.5);
  assert.deepEqual(serialized.attenuationColor, [0.9, 0.65, 0.4]);

  const restored = deserializeMaterial(serialized, new Map([
    [factor.id, factor.resource],
    [roughness.id, roughness.resource],
    [normal.id, normal.resource],
    [specular.id, specular.resource],
    [specularColor.id, specularColor.resource],
    [sheenColor.id, sheenColor.resource],
    [sheenRoughness.id, sheenRoughness.resource],
    [transmission.id, transmission.resource],
    [thickness.id, thickness.resource],
  ]));
  assert.ok(restored instanceof PbrMaterial);
  assert.equal(restored.clearcoatFactor, 0.85);
  assert.equal(restored.clearcoatRoughnessFactor, 0.22);
  assert.equal(restored.clearcoatNormalScale, 0.7);
  assert.equal(restored.clearcoatNormalTexture, normal.resource);
  assert.equal(restored.ior, 1.33);
  assert.equal(restored.specularFactor, 0.62);
  assert.deepEqual(restored.specularColorFactor, [1.2, 0.8, 0.6]);
  assert.equal(restored.specularTexture, specular.resource);
  assert.equal(restored.specularColorTexture, specularColor.resource);
  assert.deepEqual(restored.sheenColorFactor, [0.75, 0.2, 0.45]);
  assert.equal(restored.sheenRoughnessFactor, 0.38);
  assert.equal(restored.sheenColorTexture, sheenColor.resource);
  assert.equal(restored.sheenRoughnessTexture, sheenRoughness.resource);
  assert.equal(restored.transmissionFactor, 0.7);
  assert.equal(restored.transmissionTexture, transmission.resource);
  assert.equal(restored.thicknessFactor, 0.45);
  assert.equal(restored.thicknessTexture, thickness.resource);
  assert.equal(restored.attenuationDistance, 2.5);
  assert.deepEqual(restored.attenuationColor, [0.9, 0.65, 0.4]);
});

test('Toon independent texture layers survive editor serialization', () => {
  const pool = createPool();
  const shadow = pool.registerTexture('textures/toon-shadow.png', { name: 'Toon shadow' });
  const highlight = pool.registerTexture('textures/toon-highlight.png', { name: 'Toon highlight' });
  const material = new ToonMaterial({
    baseColor: [0.8, 0.9, 1, 1],
    bandSoftness: 0.025,
    layers: [
      { minLight: 0, color: [0.25, 0.3, 0.45, 1], texture: shadow.resource, sampler: { magFilter: 'nearest' } },
      { minLight: 0.5, color: [0.7, 0.75, 0.85, 1] },
      { minLight: 0.82, color: [1, 1, 1, 1], texture: highlight.resource, textureMapping: { texCoord: 1, offset: [0.1, 0.2] } },
    ],
    doubleSided: true,
  });
  const serialized = serializeMaterial({ name: 'Stylized', resource: material }, pool);
  assert.equal(serialized.type, 'ToonMaterial');
  assert.equal(serialized.layers[0].textureId, shadow.id);
  assert.equal(serialized.layers[2].textureId, highlight.id);

  const restored = deserializeMaterial(serialized, new Map([
    [shadow.id, shadow.resource],
    [highlight.id, highlight.resource],
  ]));
  assert.ok(restored instanceof ToonMaterial);
  assert.equal(restored.layers.length, 3);
  assert.equal(restored.layers[0].texture, shadow.resource);
  assert.equal(restored.layers[2].textureMapping.texCoord, 1);
  assert.deepEqual(restored.layers[2].textureMapping.offset, [0.1, 0.2]);
  assert.equal(restored.doubleSided, true);
});

test('scene validation reports exact entity/component and resource paths', () => {
  assert.throws(
    () => validateSerializedEditorScene({
      version: 1,
      name: 'Broken',
      globals: {},
      resources: { geometries: [], materials: [], textures: [], prefabs: [], scripts: [] },
      entities: [{ name: 'Entity', components: [{ type: 42 }], children: [] }],
    }),
    error => error.code === EngineErrorCode.SceneDataInvalid
      && error.path === 'entities[0].components[0].type'
      && error.context.entity === 0
      && error.context.component === 0
      && error.context.field === 'type'
      && error.recovery === 'terminate-runtime',
  );

  assert.throws(
    () => validateSerializedEditorScene({
      version: 1,
      name: 'Broken resource',
      globals: {},
      resources: { geometries: [{ id: 17, name: false }], materials: [], textures: [], prefabs: [], scripts: [] },
      entities: [],
    }),
    error => error.code === EngineErrorCode.SceneDataInvalid
      && error.path === 'resources.geometries[0].name'
      && error.context.resourceType === 'geometries'
      && error.context.resourceId === 17,
  );

  assert.throws(
    () => validateSerializedEditorScene({
      version: 1,
      name: 'Broken compatibility report',
      globals: {},
      resources: {
        geometries: [],
        materials: [],
        textures: [],
        models: [{
          id: 23,
          name: 'Broken model',
          compatibilityReport: { status: 'degraded', extensions: [], textures: 'invalid', bounds: [], uvSemantics: [], performance: { loadMs: 0, decodedGeometryBytes: 0 }, issues: [] },
        }],
        prefabs: [],
        scripts: [],
      },
      entities: [],
    }),
    error => error.code === EngineErrorCode.SceneDataInvalid
      && error.path === 'resources.models[0].compatibilityReport.textures'
      && error.context.resourceType === 'models'
      && error.context.resourceIndex === 0,
  );
});

function createPool() {
  return new ResourcePool({
    getResourceName: (_resource, fallback) => fallback,
    getPrefabId: entity => entity.prefabId ?? null,
  });
}

function createComponentLibrary() {
  const context = createMainComponentContext({
    createDefaultMesh2DComponent: () => null,
    createDefaultMeshComponent: () => null,
    createDefaultScriptComponent: () => null,
    getDefaultCanvasTextStyle: () => ({
      font: '16px sans-serif',
      textAlign: 'left',
      textBaseline: 'top',
    }),
  });
  context.installEditorPlugin(createGltfPlugin());
  context.installEditorPlugin(createSpinePlugin());
  context.installEditorPlugin(createTilemapPlugin());
  return context.componentLibraries[0];
}

test('editor entity serialization round-trips glTF and Spine extension components', () => {
  const library = createComponentLibrary();
  const entity = new Entity('Imported Character');
  const gltfModel = new GltfModelComponent({
    src: 'models/hero.glb',
    scene: 2,
    autoLoad: true,
    clearPrevious: false,
    baseColorFactor: [0.2, 0.3, 0.4, 1],
  });
  const runtimeRoot = new Entity('Runtime glTF Root');
  gltfModel.runtimeRoot = runtimeRoot;
  entity.addChild(runtimeRoot);
  entity.addComponent(gltfModel);
  entity.addComponent(new Spine2DComponent({
    jsonUrl: 'spine/hero.json',
    atlasUrl: 'spine/hero.atlas',
    imageUrls: { hero: 'hero.png' },
    skin: 'blue',
    animation: 'run',
    loop: false,
    timeScale: 1.25,
    scale: 0.75,
    premultipliedAlpha: true,
  }));

  const serialized = serializeEntity(entity, {}, [library]);
  assert.deepEqual(serialized.components, [
    {
      type: 'GltfModelComponent',
      src: 'models/hero.glb',
      scene: 2,
      autoLoad: true,
      clearPrevious: false,
      baseColorFactor: [0.2, 0.3, 0.4, 1],
    },
    {
      type: 'Spine2DComponent',
      jsonUrl: 'spine/hero.json',
      atlasUrl: 'spine/hero.atlas',
      imageUrl: '',
      imageUrls: { hero: 'hero.png' },
      skin: 'blue',
      animation: 'run',
      loop: false,
      timeScale: 1.25,
      scale: 0.75,
      premultipliedAlpha: true,
    },
  ]);
  assert.deepEqual(serialized.children, []);

  const restored = deserializeEntity(serialized, new Map(), new Map(), new Map(), { extensions: [library] });
  assert.equal(restored.getComponent(GltfModelComponent).sourceKey, 'models/hero.glb|2');
  assert.equal(restored.getComponent(Spine2DComponent).sourceKey, 'spine/hero.json|spine/hero.atlas||{"hero":"hero.png"}|blue');
});

test('editor component serialization lets explicit contributions override the core registry', () => {
  const entity = new Entity('Data');
  entity.addComponent(new DataComponent({ hp: 10 }));
  const extension = {
    serializeComponent(component) {
      if (component instanceof DataComponent) return { type: 'DataComponent', data: { hp: 99 } };
      return null;
    },
    deserializeComponent(data) {
      if (data.type === 'DataComponent') return new GltfModelComponent({ src: 'adapter-override.glb' });
      return null;
    },
  };

  const serialized = serializeEntity(entity, {}, [extension]);
  assert.deepEqual(serialized.components, [{ type: 'DataComponent', data: { hp: 99 } }]);

  const restored = deserializeEntity(serialized, new Map(), new Map(), new Map(), { extensions: [extension] });
  assert.equal(restored.getComponent(DataComponent), null);
  assert.equal(restored.getComponent(GltfModelComponent).src, 'adapter-override.glb');
});

test('player-style scene deserialization preserves built-in component package text', () => {
  const scene = JSON.parse(readFileSync(new URL('../scene-examples/hex-minesweeper-starter.scene.json', import.meta.url), 'utf8'));
  const roots = scene.entities.map(entity => deserializeEntity(entity, new Map(), new Map(), new Map(), {
    deserializePrefabInstances: false,
    extensions: [createComponentLibrary()],
  }));
  const texts = [];
  const visit = entity => {
    const text = entity.getComponent(CanvasTextComponent);
    if (text) texts.push({ entity, text });
    for (const child of entity.children) visit(child);
  };
  for (const root of roots) visit(root);

  assert.equal(texts.length, 83);
  assert.equal(texts.filter(item => item.entity.name.startsWith('Hex Minesweeper Text ')).length, 81);
  assert.equal(texts.find(item => item.entity.name === 'Hex Minesweeper Status Text')?.text.text, 'Click a hex to start');
});

test('editor scene serialization preserves resources, typed arrays, textures, and validation shape', async () => {
  const pool = createPool();
  const world = new World('Serialization World');
  const compatibilityReport = Object.freeze({
    status: 'degraded',
    extensions: Object.freeze([]),
    textures: Object.freeze([]),
    bounds: Object.freeze([
      Object.freeze({
        meshIndex: 0,
        primitiveIndex: 0,
        support: 'fail-open',
        path: 'gltf.meshes[0].primitives[0]',
        reason: 'Base POSITION bounds are unavailable.',
      }),
    ]),
    uvSemantics: Object.freeze([
      Object.freeze({
        meshIndex: 0,
        primitiveIndex: 0,
        capacity: 2,
        availableSemantics: Object.freeze(['TEXCOORD_2']),
        referencedSemantics: Object.freeze(['TEXCOORD_2']),
        mappings: Object.freeze([Object.freeze({ semantic: 'TEXCOORD_2', set: 2, channel: 0 })]),
        path: 'gltf.meshes[0].primitives[0]',
      }),
    ]),
    performance: Object.freeze({ loadMs: 4.5, decodedGeometryBytes: 512 }),
    issues: Object.freeze([
      Object.freeze({
        category: 'bounds',
        path: 'gltf.meshes[0].primitives[0]',
        code: 'GLTF_BOUNDS_FAIL_OPEN',
        message: 'Base POSITION bounds are unavailable.',
      }),
    ]),
  });
  pool.registerModel('models/degraded.glb', {
    name: 'Degraded Model',
    compatibilityReport,
  });
  const texture = pool.registerTexture('textures/albedo.ktx2', {
    name: 'Albedo KTX2',
    previewUrl: 'blob:preview',
    width: 4,
    height: 4,
    fileType: 'image/ktx2',
  });
  const geometry = new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    textureCoordinates: [{ set: 2, data: new Float32Array([0, 0, 1, 0, 0, 1]) }],
    textureCoordinateLayout: [2],
    indices: new Uint16Array([0, 1, 2]),
  });
  const material = new BasicMaterial({ texture: texture.resource, color: [1, 0.5, 0.25, 1] });
  pool.registerGeometry(geometry, 'Triangle');
  pool.registerMaterial(material, 'Textured Material');

  const entity = new Entity('Triangle');
  entity.addComponent(new Mesh3D(geometry, material));
  world.addEntity(entity);
  pool.trackEntity(entity);

  const scene = await serializeEditorScene(world, {
    resourcePool: pool,
    globals: { language: 'zh-CN' },
    systems: [{ type: 'Render3DSystem', enabled: true }],
    componentExtensions: [createComponentLibrary()],
    cloneGlobalSettings: settings => ({ ...settings }),
    cloneSystemConfig: system => ({ ...system }),
    textureSourceToSerializableUrl: async source => source,
  });

  validateSerializedEditorScene(scene);
  assert.equal(scene.resources.textures[0].src, 'textures/albedo.ktx2');
  assert.equal(scene.resources.textures[0].previewUrl, 'textures/albedo.ktx2');
  assert.equal(scene.resources.geometries[0].positions.componentType, 'float32');
  assert.equal(scene.resources.geometries[0].textureCoordinates[0].set, 2);
  assert.deepEqual(scene.resources.geometries[0].textureCoordinateLayout, [2]);
  assert.equal(scene.resources.geometries[0].indices.componentType, 'uint16');
  assert.equal(scene.resources.materials[0].textureId, texture.id);
  assert.deepEqual(scene.resources.models[0].compatibilityReport, compatibilityReport);
  assert.equal(scene.entities[0].components[0].type, 'Mesh3D');

  const restoredPool = createPool();
  const resourceOptions = {
    resourcePool: restoredPool,
    resourceDisplayNames: new WeakMap(),
  };
  const restoredGeometry = deserializeGeometry(scene.resources.geometries[0], resourceOptions);
  const restoredMaterial = deserializeMaterial(scene.resources.materials[0], new Map([[texture.id, 'textures/albedo.ktx2']]), resourceOptions);
  const restoredEntity = deserializeEntity(
    scene.entities[0],
    new Map([[geometry.id, restoredGeometry]]),
    new Map([[material.id, restoredMaterial]]),
    new Map(),
    { extensions: [createComponentLibrary()] },
  );
  const restoredMesh = restoredEntity.getComponent(Mesh3D);

  assert.deepEqual(Array.from(restoredMesh.geometry.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(restoredMesh.geometry.getTextureCoordinates(2)), [0, 0, 1, 0, 0, 1]);
  assert.deepEqual(restoredMesh.geometry.textureCoordinateLayout, [2]);
  assert.deepEqual(Array.from(restoredMesh.geometry.indices), [0, 1, 2]);
  assert.equal(restoredMesh.material.texture, 'textures/albedo.ktx2');
});
