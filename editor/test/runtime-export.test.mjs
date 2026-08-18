import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import ts from 'typescript';
import {
  BasicMaterial,
  BinaryWriter,
  DataComponent,
  Entity,
  EngineErrorCode,
  ExportWorkerClient,
  Geometry3D,
  Mesh3D,
  PbrMaterial,
  InspectorRegistry,
  PrefabInstanceComponent,
  ResourcePool,
  ScriptComponent,
  World,
  createGltfPlugin,
  createRuntimeProjectZipBytes,
  createMainComponentContext,
  createTweenEditorPlugin,
  createEntityTreePresenter,
  deserializeEntity,
  deserializePlayerResources,
  generateRuntimeProjectFiles,
  precompileRuntimeScene,
  serializeEntity,
  serializeRuntimeProjectFiles,
  validateRuntimeScene,
} from '../dist-test/testing.js';

test('BinaryWriter appends in linear time and precompile preserves its input scene', () => {
  const writer = new BinaryWriter(16);
  let expectedBytes = 0;
  for (let index = 0; index < 4096; index++) {
    const values = new Float32Array([index, index + 1, index + 2]);
    const view = writer.appendTypedArray(values, 'float32');
    assert.equal(view.byteOffset % 4, 0);
    expectedBytes += values.byteLength;
  }
  const binary = writer.finish();
  assert.equal(binary.byteLength, expectedBytes);
  assert.equal(writer.metrics.appendCount, 4096);
  assert.equal(writer.metrics.payloadBytes, expectedBytes);
  assert.ok(writer.metrics.copiedBytes >= expectedBytes * 2);
  assert.ok(writer.metrics.copiedBytes < expectedBytes * 4);
  assert.ok(writer.metrics.reallocations < 20);
  assert.ok(writer.metrics.peakWorkingBytes < binary.byteLength * 5);

  const scene = {
    version: 1,
    format: 'haiyue-runtime-scene',
    name: 'Precompile',
    globals: createGlobals(),
    systems: [],
    resources: {
      geometries: [{
        id: 1,
        name: 'Triangle',
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        normals: null,
        textureCoordinates: [],
        textureCoordinateLayout: [],
        indices: [0, 1, 2],
        indexType: 'uint16',
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      }],
      materials: [], textures: [], prefabs: [], scripts: [],
    },
    entities: [],
  };
  const progress = [];
  const result = precompileRuntimeScene(scene, { onProgress: (current, total) => progress.push([current, total]) });
  assert.deepEqual(scene.resources.geometries[0].positions, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.ok(result.binaryAsset.byteLength > 0);
  assert.equal(result.metrics.appendCount, 2);
  assert.deepEqual(progress, [[1, 1]]);
});

test('ExportWorkerClient forwards progress, receives transferred bytes, and terminates on cancellation', async () => {
  const workers = [];
  const client = new ExportWorkerClient(() => {
    const worker = {
      onmessage: null,
      onerror: null,
      terminated: false,
      postMessage(request) {
        queueMicrotask(() => {
          if (worker.terminated) return;
          worker.onmessage?.({ data: { id: request.id, type: 'progress', progress: { stage: 'zip', current: 50, total: 100 } } });
          const bytes = new Uint8Array([1, 2, 3]).buffer;
          worker.onmessage?.({ data: {
            id: request.id,
            type: 'zip',
            bytes,
            projectName: 'worker-export',
            metrics: { outputBytes: 10, precompile: null, zipBytes: 3, estimatedPeakBytes: 13 },
          } });
        });
      },
      terminate() { worker.terminated = true; },
    };
    workers.push(worker);
    return worker;
  });
  const progress = [];
  const result = await client.buildZip({}, {}, { onProgress: value => progress.push(value.current) });
  assert.deepEqual([...new Uint8Array(result.buffer)], [1, 2, 3]);
  assert.deepEqual(progress, [50]);
  assert.equal(workers[0].terminated, true);

  const controller = new AbortController();
  const cancelledClient = new ExportWorkerClient(() => {
    const worker = { onmessage: null, onerror: null, terminated: false, postMessage() {}, terminate() { worker.terminated = true; } };
    workers.push(worker);
    return worker;
  });
  const pending = cancelledClient.buildProject({}, {}, { signal: controller.signal });
  controller.abort('cancel benchmark');
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(workers.at(-1).terminated, true);
});

test('export archive uses a standards-compatible deterministic ZIP container', async () => {
  const progress = [];
  const bytes = await createRuntimeProjectZipBytes({
    mode: 'project',
    projectName: 'zip-fixture',
    files: [
      { path: 'src/main.ts', content: 'export const answer = 42;\n', type: 'text' },
      { path: 'assets/data.bin', content: new Uint8Array([0, 1, 2, 255]), type: 'binary' },
    ],
    metrics: { outputBytes: 30, precompile: null },
  }, {
    onProgress: (percent, file) => progress.push([percent, file]),
  });
  const archive = await JSZip.loadAsync(bytes);

  assert.equal(await archive.file('zip-fixture/src/main.ts').async('string'), 'export const answer = 42;\n');
  assert.deepEqual(
    [...await archive.file('zip-fixture/assets/data.bin').async('uint8array')],
    [0, 1, 2, 255],
  );
  assert.deepEqual(progress, [
    [50, 'src/main.ts'],
    [100, 'assets/data.bin'],
  ]);
});

test('runtime scene validation rejects invalid exported resource ids with an exact path', () => {
  assert.throws(
    () => validateRuntimeScene({
      version: 1,
      format: 'haiyue-runtime-scene',
      name: 'Broken runtime scene',
      resources: { geometries: [{ id: 'bad' }], materials: [], textures: [], prefabs: [], scripts: [] },
      entities: [],
    }),
    error => error.code === EngineErrorCode.SceneDataInvalid
      && error.path === 'runtimeScene.resources.geometries[0].id'
      && error.context.resourceType === 'geometries'
      && error.context.resourceId === 'bad',
  );
});

function createGlobals() {
  return {
    designWidth: 1280,
    designHeight: 720,
    viewportMode: 'expand',
    clearColor: [0, 0, 0, 1],
    reverseZ: false,
    render2DLoadOp: 'load',
    guiLoadOp: 'load',
    parameters: {},
    inputMap: {},
  };
}

test('runtime export template includes dependency-pruned component imports and optional deserializers', () => {
  const componentContext = createMainComponentContext({
    createDefaultMesh2DComponent: () => null,
    createDefaultMeshComponent: () => null,
    createDefaultScriptComponent: () => null,
    getDefaultCanvasTextStyle: () => ({ font: '16px sans-serif' }),
  });
  componentContext.installEditorPlugin(createTweenEditorPlugin());
  const runtimeExport = {
    scene: {
      version: 1,
      format: 'haiyue-runtime-scene',
      name: 'Runtime Test',
      globals: createGlobals(),
      systems: [],
      resources: {
        geometries: [],
        materials: [],
        textures: [],
        prefabs: [],
        scripts: [],
      },
      entities: [
        {
          name: 'Text',
          disabled: false,
          components: [
            { type: 'CanvasTextComponent', text: 'Hello', style: { font: '16px sans-serif' } },
            { type: 'Tween2DComponent', to: { x: 10 }, duration: 200 },
          ],
          children: [],
        },
      ],
    },
    manifest: {
      version: 1,
      sceneName: 'Runtime Test',
      resourceCounts: { geometries: 0, materials: 0, textures: 0, prefabs: 0, scripts: 0 },
      idMap: { geometries: {}, materials: {}, textures: {}, prefabs: {}, scripts: {} },
      warnings: [],
    },
  };

  const project = generateRuntimeProjectFiles(runtimeExport, {
    mode: 'static',
    projectName: 'Runtime Test',
    precompileRuntimeData: false,
    componentContributions: componentContext.getComponentContributions(),
  });
  const files = serializeRuntimeProjectFiles(project.files);

  assert.equal(project.projectName, 'runtime-test');
  assert.match(files['src/runtime-deserialization.ts'], /from '@haiyue\/extensions\/canvas-text'/);
  assert.match(files['src/runtime-deserialization.ts'], /from '@haiyue\/extensions\/tween'/);
  assert.match(files['src/runtime-deserialization.ts'], /coreComponentSerializationRegistry\.deserialize/);
  assert.match(files['src/runtime-deserialization.ts'], /case "CanvasTextComponent"/);
  assert.match(files['src/runtime-deserialization.ts'], /case "Tween2DComponent"/);
  assert.doesNotMatch(files['src/runtime-deserialization.ts'], /case 'CartesianTransform3D'/);
  assert.match(files['src/runtime-player.ts'], /new Tween2DSystem/);
  assert.doesNotMatch(files['src/runtime-player.ts'], /new GltfModelSystem/);
  assert.doesNotMatch(files['src/runtime-player.ts'], /worldMatrixDirty|localMatrix\s*\[/);
  assert.doesNotMatch(files['src/runtime-player.ts'], /navigator\.gpu|WebGL/);
  assert.match(files['src/main.ts'], /HaiyueEngine\.webGpuCompatibility/);
  assert.match(files['src/main.ts'], /webGpuCompatibility\.classifyError/);
  assert.match(files['src/main.ts'], /webGpuCompatibility\.report/);
  assert.match(files['src/main.ts'], /webGpuCompatibility\.renderPage/);
  assert.match(files['src/main.ts'], /Haiyue Export Runtime/);
  assert.equal(
    ts.createSourceFile(
      'main.ts',
      files['src/main.ts'],
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ).parseDiagnostics.length,
    0,
  );
  assertRuntimePlayerUsesSceneGoldenPath(files['src/runtime-player.ts']);
});

test('runtime export installs ToonRenderSystem and reconstructs four-layer materials', () => {
  const runtimeExport = {
    scene: {
      version: 1,
      format: 'haiyue-runtime-scene',
      name: 'Toon Runtime',
      globals: createGlobals(),
      systems: [],
      resources: {
        geometries: [],
        materials: [{
          id: 1,
          name: 'Toon',
          type: 'ToonMaterial',
          baseColor: [1, 1, 1, 1],
          bandSoftness: 0,
          layers: [{ minLight: 0, color: [1, 1, 1, 1], textureId: null, sampler: null, textureMapping: { texCoord: 0, offset: [0, 0], rotation: 0, scale: [1, 1] } }],
          alphaMode: 'opaque',
          doubleSided: false,
        }],
        textures: [],
        prefabs: [],
        scripts: [],
      },
      entities: [{ name: 'Mesh', disabled: false, components: [{ type: 'Mesh3D', geometryId: 1, materialId: 1 }], children: [] }],
    },
    manifest: {
      version: 1,
      sceneName: 'Toon Runtime',
      resourceCounts: { geometries: 0, materials: 1, textures: 0, prefabs: 0, scripts: 0 },
      idMap: { geometries: {}, materials: { 1: 1 }, textures: {}, prefabs: {}, scripts: {} },
      warnings: [],
    },
  };
  const project = generateRuntimeProjectFiles(runtimeExport, { mode: 'static', projectName: 'Toon Runtime', precompileRuntimeData: false });
  const files = serializeRuntimeProjectFiles(project.files);
  assert.match(files['src/runtime-deserialization.ts'], /new ToonMaterial/);
  assert.match(files['src/runtime-player.ts'], /new ToonRenderSystem/);
  assert.match(files['src/runtime-player.ts'], /hasToonMesh/);
});

test('runtime export consumes component contribution imports, deserializer, and system installer', () => {
  const runtimeExport = {
    scene: {
      version: 1,
      format: 'haiyue-runtime-scene',
      name: 'Contributed Runtime',
      globals: createGlobals(),
      systems: [],
      resources: { geometries: [], materials: [], textures: [], prefabs: [], scripts: [] },
      entities: [{
        name: 'Weather',
        disabled: false,
        components: [{ type: 'WeatherComponent', intensity: 0.8 }],
        children: [],
      }],
    },
    manifest: {
      version: 1,
      sceneName: 'Contributed Runtime',
      resources: {
        input: { geometries: 0, materials: 0, textures: 0, prefabs: 0, scripts: 0 },
        output: { geometries: 0, materials: 0, textures: 0, prefabs: 0, scripts: 0 },
        removed: { geometries: 0, materials: 0, textures: 0, prefabs: 0, scripts: 0 },
      },
      idMaps: { geometries: {}, materials: {}, textures: {}, prefabs: {}, scripts: {} },
      warnings: [],
    },
  };
  const project = generateRuntimeProjectFiles(runtimeExport, {
    mode: 'static',
    precompileRuntimeData: false,
    componentContributions: [{
      type: 'WeatherComponent',
      create: () => new DataComponent(),
      inspector: { fields: {} },
      serialize: () => ({ type: 'WeatherComponent' }),
      deserialize: () => new DataComponent(),
      collectDependencies: () => [],
      runtimeExport: {
        imports: [{ from: '@example/weather', names: ['WeatherComponent', 'WeatherSystem'] }],
        systems: ['WeatherSystem'],
        deserializeExpression: 'new WeatherComponent(data)',
        installSystems: '  world.addSystem(new WeatherSystem());',
        has3D: true,
      },
    }],
  });
  const files = serializeRuntimeProjectFiles(project.files);
  assert.match(files['src/runtime-deserialization.ts'], /from '@example\/weather'/);
  assert.match(files['src/runtime-deserialization.ts'], /case "WeatherComponent":/);
  assert.match(files['src/runtime-deserialization.ts'], /new WeatherComponent\(data\)/);
  assert.match(files['src/runtime-player.ts'], /world\.addSystem\(new WeatherSystem\(\)\)/);
});

test('glTF runtime export is owned by the installed extension plugin contribution', () => {
  const componentContext = createMainComponentContext({
    createDefaultMesh2DComponent: () => null,
    createDefaultMeshComponent: () => null,
    createDefaultScriptComponent: () => null,
    getDefaultCanvasTextStyle: () => ({ font: '16px sans-serif' }),
  });
  componentContext.installEditorPlugin(createGltfPlugin());
  const project = generateRuntimeProjectFiles({
    scene: {
      version: 1,
      format: 'haiyue-runtime-scene',
      name: 'glTF Contribution',
      globals: createGlobals(),
      systems: [],
      resources: { geometries: [], materials: [], textures: [], prefabs: [], scripts: [] },
      entities: [{
        name: 'Model',
        disabled: false,
        components: [{ type: 'GltfModelComponent', src: 'model.glb' }],
        children: [],
      }],
    },
    manifest: {
      version: 1,
      sceneName: 'glTF Contribution',
      resources: {
        input: { geometries: 0, materials: 0, textures: 0, prefabs: 0, scripts: 0 },
        output: { geometries: 0, materials: 0, textures: 0, prefabs: 0, scripts: 0 },
        removed: { geometries: 0, materials: 0, textures: 0, prefabs: 0, scripts: 0 },
      },
      idMaps: { geometries: {}, materials: {}, textures: {}, prefabs: {}, scripts: {} },
      warnings: [],
    },
  }, {
    mode: 'static',
    precompileRuntimeData: false,
    componentContributions: componentContext.getComponentContributions(),
  });
  const files = serializeRuntimeProjectFiles(project.files);
  assert.match(files['src/runtime-deserialization.ts'], /from '@haiyue\/extensions\/gltf'/);
  assert.match(files['src/runtime-deserialization.ts'], /case "GltfModelComponent"/);
  assert.match(files['src/runtime-player.ts'], /new GltfModelSystem/);
});

test('runtime export keeps PBR lighting and shadow component dependencies', () => {
  const runtimeExport = {
    scene: {
      version: 1, format: 'haiyue-runtime-scene', name: 'PBR Lighting', globals: createGlobals(), systems: [],
      resources: { geometries: [], materials: [], textures: [], prefabs: [], scripts: [] },
      entities: [{
        name: 'Lighting', disabled: false,
        components: [
          { type: 'DirectionalLight', color: [1, 1, 1, 1], intensity: 2, direction: [-1, -1, 0], castShadow: true, shadow: { mapSize: 2048, extent: 30, near: 0.1, far: 80, bias: 0.001, normalBias: 0.02 } },
          { type: 'EnvironmentLight', intensity: 1, rotation: 0, diffuseColor: [0.2, 0.3, 0.5, 1], specularColor: [0.8, 0.9, 1, 1] },
        ],
        children: [],
      }],
    },
    manifest: { version: 1, sceneName: 'PBR Lighting', resourceCounts: { geometries: 0, materials: 0, textures: 0, prefabs: 0, scripts: 0 }, idMap: { geometries: {}, materials: {}, textures: {}, prefabs: {}, scripts: {} }, warnings: [] },
  };
  const project = generateRuntimeProjectFiles(runtimeExport, { mode: 'static', projectName: 'PBR Lighting' });
  const files = serializeRuntimeProjectFiles(project.files);
  assert.match(files['src/runtime-deserialization.ts'], /DirectionalLight/);
  assert.match(files['src/runtime-deserialization.ts'], /EnvironmentLight/);
  assert.match(files['src/runtime-player.ts'], /new Render3DSystem/);
});

test('runtime export installs InstancedMesh3D render system for static instanced scenes', () => {
  const runtimeExport = {
    scene: {
      version: 1,
      format: 'haiyue-runtime-scene',
      name: 'Instanced Runtime Test',
      globals: createGlobals(),
      systems: [],
      resources: {
        geometries: [
          {
            id: 1,
            name: 'Quad',
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            normals: null,
            textureCoordinates: [],
            textureCoordinateLayout: [],
            indices: null,
            indexType: null,
          },
        ],
        materials: [
          { id: 2, name: 'Instances', type: 'InstancedMaterial', capacity: 4 },
        ],
        textures: [],
        prefabs: [],
        scripts: [],
      },
      entities: [
        {
          name: 'Camera',
          disabled: false,
          components: [
            { type: 'Camera3D', cameraType: 'perspective', fov: Math.PI / 4, near: 0.1, far: 100 },
          ],
          children: [],
        },
        {
          name: 'Instances',
          disabled: false,
          components: [
            { type: 'InstancedMesh3D', geometryId: 1, materialId: 2 },
          ],
          children: [],
        },
      ],
    },
    manifest: {
      version: 1,
      sceneName: 'Instanced Runtime Test',
      resourceCounts: { geometries: 1, materials: 1, textures: 0, prefabs: 0, scripts: 0 },
      idMap: { geometries: {}, materials: {}, textures: {}, prefabs: {}, scripts: {} },
      warnings: [],
    },
  };

  const project = generateRuntimeProjectFiles(runtimeExport, {
    mode: 'static',
    projectName: 'Instanced Runtime Test',
    precompileRuntimeData: false,
  });
  const files = serializeRuntimeProjectFiles(project.files);

  assert.match(files['src/runtime-player.ts'], /InstancedMesh3DRenderSystem/);
  assert.match(files['src/runtime-player.ts'], /hasComponentType\(world, InstancedMesh3D\)/);
  assert.match(files['src/runtime-player.ts'], /addRenderSystem\(instancedSystem, \{ pass: 'shared', loadOp: 'load' \}\)/);
  assert.match(files['src/runtime-deserialization.ts'], /InstancedMesh3D/);
});

test('player runtime resource deserialization rebuilds maps and dual script ids', () => {
  const resources = {
    textures: [
      { id: 1, name: 'Albedo', src: 'textures/albedo.png' },
      { id: 6, name: 'Sheen color', src: 'textures/sheen-color.png' },
      { id: 7, name: 'Sheen roughness', src: 'textures/sheen-roughness.png' },
      { id: 9, name: 'Transmission', src: 'textures/transmission.png' },
      { id: 10, name: 'Thickness', src: 'textures/thickness.png' },
    ],
    geometries: [
      {
        id: 2,
        name: 'Triangle',
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        normals: null,
        textureCoordinates: [],
        textureCoordinateLayout: [],
        indices: null,
        indexType: null,
      },
    ],
    materials: [
      { id: 3, name: 'Material', type: 'BasicMaterial', color: [1, 1, 1, 1], blending: 'none', textureId: 1 },
      {
        id: 8,
        name: 'Fabric',
        type: 'PbrMaterial',
        baseColor: [0.3, 0.2, 0.4, 1],
        metallic: 0,
        roughness: 0.6,
        baseColorTextureId: null,
        metallicRoughnessTextureId: null,
        normalTextureId: null,
        normalScale: 1,
        occlusionTextureId: null,
        occlusionStrength: 1,
        emissiveTextureId: null,
        emissiveFactor: [0, 0, 0],
        clearcoatFactor: 0,
        clearcoatTextureId: null,
        clearcoatRoughnessFactor: 0,
        clearcoatRoughnessTextureId: null,
        clearcoatNormalTextureId: null,
        clearcoatNormalScale: 1,
        sheenColorFactor: [0.8, 0.2, 0.45],
        sheenRoughnessFactor: 0.35,
        sheenColorTextureId: 6,
        sheenRoughnessTextureId: 7,
        transmissionFactor: 0.72,
        transmissionTextureId: 9,
        thicknessFactor: 0.45,
        thicknessTextureId: 10,
        attenuationDistance: 2.5,
        attenuationColor: [0.9, 0.65, 0.4],
        alphaMode: 'opaque',
        alphaCutoff: 0.5,
        doubleSided: false,
      },
    ],
    prefabs: [
      { id: 4, name: 'Prefab', root: { name: 'Root', disabled: false, components: [], children: [] } },
    ],
    scripts: [
      { id: 5, name: 'Logic', scripts: { onStart: 'api.debug.console.log("start");' } },
    ],
  };

  const result = deserializePlayerResources(resources);
  const geometry = result.geometryMap.get(2);
  const material = result.materialMap.get(3);
  const script = result.scriptMap.get(5);

  assert.ok(geometry instanceof Geometry3D);
  assert.deepEqual(Array.from(geometry.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.ok(material instanceof BasicMaterial);
  assert.equal(material.texture, 'textures/albedo.png');
  const sheenMaterial = result.materialMap.get(8);
  assert.ok(sheenMaterial instanceof PbrMaterial);
  assert.deepEqual(sheenMaterial.sheenColorFactor, [0.8, 0.2, 0.45]);
  assert.equal(sheenMaterial.sheenRoughnessFactor, 0.35);
  assert.equal(sheenMaterial.sheenColorTexture, 'textures/sheen-color.png');
  assert.equal(sheenMaterial.sheenRoughnessTexture, 'textures/sheen-roughness.png');
  assert.equal(sheenMaterial.transmissionFactor, 0.72);
  assert.equal(sheenMaterial.transmissionTexture, 'textures/transmission.png');
  assert.equal(sheenMaterial.thicknessFactor, 0.45);
  assert.equal(sheenMaterial.thicknessTexture, 'textures/thickness.png');
  assert.equal(sheenMaterial.attenuationDistance, 2.5);
  assert.deepEqual(sheenMaterial.attenuationColor, [0.9, 0.65, 0.4]);
  assert.equal(result.prefabMap.get(4).root.name, 'Root');
  assert.equal(script.name, 'Logic');
  assert.equal(result.scriptMap.get(script.id), script);
});

function assertRuntimePlayerUsesSceneGoldenPath(source) {
  const sourceFile = ts.createSourceFile('runtime-player.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls = [];
  visit(sourceFile);
  const create = calls.find(call => call.owner === 'engine' && call.method === 'createScene');
  const sceneSwitch = calls.find(call => call.owner === 'engine' && call.method === 'switchScene');
  const run = calls.find(call => call.owner === 'engine' && call.method === 'run');
  assert.ok(create && sceneSwitch && run);
  assert.ok(create.position < sceneSwitch.position && sceneSwitch.position < run.position);
  assert.equal(calls.some(call => call.owner === 'world' && call.method === 'update'), false);

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      calls.push({
        owner: node.expression.expression.getText(sourceFile),
        method: node.expression.name.text,
        position: node.getStart(sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  }
}

test('editor plugin lifecycle failure paths wrap errors and rollback registrations', () => {
  const context = createMainComponentContext({
    createDefaultMesh2DComponent: () => new Mesh3D(new Geometry3D({ positions: new Float32Array(0) }), new BasicMaterial()),
    createDefaultMeshComponent: () => new Mesh3D(new Geometry3D({ positions: new Float32Array(0) }), new BasicMaterial()),
    createDefaultScriptComponent: () => new ScriptComponent(),
    getDefaultCanvasTextStyle: () => ({ font: '16px sans-serif' }),
  });

  assert.throws(() => context.installEditorPlugin({
    name: 'editor-install-fail',
    version: '1.0.0',
    installEditor(pluginContext) {
      pluginContext.registerResourceImporter({ id: 'bad', label: 'Bad', target: 'texture', accept: '.png', import: async () => [] });
      throw new Error('install failed');
    },
  }), error => error.code === EngineErrorCode.PluginInstallFailed);
  assert.equal(context.resourceImporters.some(importer => importer.id === 'bad'), false);

  assert.throws(() => context.installEditorPlugin({
    name: 'editor-enable-fail',
    version: '1.0.0',
    installEditor(pluginContext) {
      pluginContext.registerResourceImporter({ id: 'enable', label: 'Enable', target: 'texture', accept: '.png', import: async () => [] });
    },
    enableEditor() {
      throw new Error('enable failed');
    },
  }), error => error.code === EngineErrorCode.PluginLifecycleFailed);
  assert.equal(context.resourceImporters.some(importer => importer.id === 'enable'), false);

  context.installEditorPlugin({
    name: 'editor-disable-fail',
    version: '1.0.0',
    installEditor(pluginContext) {
      pluginContext.registerResourceImporter({ id: 'disable', label: 'Disable', target: 'texture', accept: '.png', import: async () => [] });
    },
    disableEditor() {
      throw new Error('disable failed');
    },
  });
  assert.equal(context.isEditorPluginEnabled('editor-disable-fail'), true);
  assert.throws(() => context.disableEditorPlugin('editor-disable-fail'), error => error.code === EngineErrorCode.PluginLifecycleFailed);
  assert.equal(context.isEditorPluginEnabled('editor-disable-fail'), true);
  assert.equal(context.resourceImporters.some(importer => importer.id === 'disable'), true);
});

test('editor extension registrations return independently reversible tokens', () => {
  const context = createMainComponentContext({
    createDefaultMesh2DComponent: () => new Mesh3D(new Geometry3D({ positions: new Float32Array(0) }), new BasicMaterial()),
    createDefaultMeshComponent: () => new Mesh3D(new Geometry3D({ positions: new Float32Array(0) }), new BasicMaterial()),
    createDefaultScriptComponent: () => new ScriptComponent(),
    getDefaultCanvasTextStyle: () => ({ font: '16px sans-serif' }),
  });
  const tokens = {};
  const importer = {
    name: 'token-importer',
    label: 'Token',
    accept: '.token',
    prepareImport() { return { resourceCount: 0, commit() {}, dispose() {} }; },
  };
  const kit = { name: 'Token kit', apply() {} };

  context.installEditorPlugin({
    name: 'editor-registration-tokens',
    version: '1.0.0',
    installEditor(pluginContext) {
      tokens.descriptor = pluginContext.registerComponentDescriptor({ name: 'TokenDescriptor', create() { return null; } });
      tokens.inspector = pluginContext.registerInspectorRenderer('TokenDescriptor', () => {});
      tokens.importer = pluginContext.registerResourceImporter(importer);
      tokens.kit = pluginContext.registerStarterKit(kit);
    },
  });

  assert.equal(Object.values(tokens).every(token => token.active), true);
  assert.equal(context.getComponentDescriptors().some(descriptor => descriptor.name === 'TokenDescriptor'), true);
  assert.equal(context.resourceImporters.includes(importer), true);
  assert.equal(context.starterKits.includes(kit), true);

  for (const token of Object.values(tokens)) token.unregister();
  assert.equal(Object.values(tokens).every(token => !token.active), true);
  assert.equal(context.getComponentDescriptors().some(descriptor => descriptor.name === 'TokenDescriptor'), false);
  assert.equal(context.resourceImporters.includes(importer), false);
  assert.equal(context.starterKits.includes(kit), false);
  assert.doesNotThrow(() => context.uninstallEditorPlugin('editor-registration-tokens'));
});

test('InspectorRegistry and editor contributions unregister by identity under same-key overrides', () => {
  const registry = new InspectorRegistry();
  const firstRenderer = () => true;
  const secondRenderer = () => true;
  const firstRendererToken = registry.register('TokenComponent', firstRenderer);
  const secondRendererToken = registry.register('TokenComponent', secondRenderer);
  class TokenComponent extends DataComponent {}
  const component = new TokenComponent({ owner: 'new' });
  assert.equal(registry.resolve(component).render, secondRenderer);
  firstRendererToken.unregister();
  assert.equal(registry.resolve(component).render, secondRenderer);
  secondRendererToken.unregister();
  assert.equal(registry.resolve(component), null);

  const context = createMainComponentContext({
    createDefaultMesh2DComponent: () => new Mesh3D(new Geometry3D({ positions: new Float32Array(0) }), new BasicMaterial()),
    createDefaultMeshComponent: () => new Mesh3D(new Geometry3D({ positions: new Float32Array(0) }), new BasicMaterial()),
    createDefaultScriptComponent: () => new ScriptComponent(),
    getDefaultCanvasTextStyle: () => ({ font: '16px sans-serif' }),
  });
  const contribution = (owner) => ({ components: [{
    type: 'TokenComponent',
    create: () => new TokenComponent({ owner }),
    inspector: { fields: { [owner]: { type: 'string' } } },
    serialize: value => ({ type: 'TokenComponent', owner: value.value.owner }),
    deserialize: data => new TokenComponent({ owner: data.owner }),
    collectDependencies: value => value.value.assetId ? [value.value.assetId] : [],
  }] });
  context.installEditorPlugin({
    name: 'old-token-contribution', version: '1.0.0',
    installEditor(pluginContext) { pluginContext.registerContribution(contribution('old')); },
  });
  context.installEditorPlugin({
    name: 'new-token-contribution', version: '1.0.0',
    installEditor(pluginContext) { pluginContext.registerContribution(contribution('new')); },
  });
  assert.deepEqual(context.getComponentDescriptors().find(item => item.name === 'TokenComponent').create().value, { owner: 'new' });
  assert.ok(context.inspectorRegistry.resolveSchema(component).fields.new);

  const contributedEntity = new Entity('Contributed');
  contributedEntity.addComponent(new TokenComponent({ owner: 'new' }));
  const serialized = serializeEntity(contributedEntity, {}, context.componentLibraries);
  assert.deepEqual(serialized.components, [{ type: 'TokenComponent', owner: 'new' }]);
  const restored = deserializeEntity(serialized, new Map(), new Map(), new Map(), { extensions: context.componentLibraries });
  assert.deepEqual(restored.getComponent(TokenComponent).value, { owner: 'new' });

  const resourcePool = new ResourcePool({
    componentResourceExtensions: context.componentLibraries,
    getResourceName: (_resource, fallback) => fallback,
    getPrefabId: () => null,
  });
  const model = resourcePool.registerModel('weather.glb');
  const resourceEntity = new Entity('Resource contribution');
  resourceEntity.addComponent(new TokenComponent({ owner: 'new', assetId: `model:${model.id}` }));
  const world = new World('Contribution dependencies');
  world.addEntity(resourceEntity);
  resourcePool.syncWorld(world);
  assert.equal(model.refs, 1);

  context.uninstallEditorPlugin('old-token-contribution');
  assert.deepEqual(context.getComponentDescriptors().find(item => item.name === 'TokenComponent').create().value, { owner: 'new' });
  assert.ok(context.inspectorRegistry.resolveSchema(component).fields.new);
  context.uninstallEditorPlugin('new-token-contribution');
  assert.equal(context.getComponentDescriptors().some(item => item.name === 'TokenComponent'), false);
  assert.equal(context.inspectorRegistry.resolveSchema(component), null);
});

test('entity tree presenter maps hierarchy state and refreshes UI selection data', () => {
  const resourcePool = {
    prefabs: new Map([
      [7, { id: 7, name: 'Enemy Prefab' }],
    ]),
  };
  const presenter = createEntityTreePresenter({ resourcePool });
  const world = new World('Tree World');
  const root = new Entity('Root');
  const child = new Entity('Child');
  child.disabled = true;
  root.addChild(child);
  world.addEntity(root);

  const prefabRoot = new Entity('Prefab Root');
  prefabRoot.addComponent(new PrefabInstanceComponent(7, 1));
  const hiddenChild = new Entity('Hidden Prefab Child');
  prefabRoot.addChild(hiddenChild);
  world.addEntity(prefabRoot);

  const rootNode = presenter.entityToTreeNode(root);
  assert.equal(rootNode.label, 'Root');
  assert.equal(rootNode.icon, '◇');
  assert.equal(rootNode.expanded, true);
  assert.equal(rootNode.children.length, 1);
  assert.equal(rootNode.children[0].disabled, true);
  assert.equal(presenter.getEntityIdFromNode(rootNode), root.id);

  const prefabNode = presenter.entityToTreeNode(prefabRoot);
  assert.equal(prefabNode.icon, '▣');
  assert.equal(prefabNode.expanded, false);
  assert.equal(prefabNode.prefabId, 7);
  assert.equal(prefabNode.prefabName, 'Enemy Prefab');
  assert.equal(prefabNode.children.length, 0);

  let dataWrites = 0;
  let expansionSeed = null;
  const tree = {
    _data: [],
    selectedIds: [],
    get data() {
      return this._data;
    },
    set data(value) {
      dataWrites++;
      expansionSeed = value[0]?.expanded ?? null;
      this._data = value;
    },
  };
  presenter.refreshTreeSelection(tree, world, new Set([child]));
  assert.equal(tree.data.length, 2);
  assert.deepEqual(tree.selectedIds, [String(child.id)]);
  assert.equal(dataWrites, 1);
  assert.equal(expansionSeed, true);
  assert.equal(tree.data[0].expanded, undefined, 'expansion is only seeded once and then owned by ge-tree');

  presenter.refreshTreeSelection(tree, world, new Set([root]));
  assert.equal(dataWrites, 1, 'selection-only changes do not re-project the hierarchy');
  assert.deepEqual(tree.selectedIds, [String(root.id)]);

  root.addChild(new Entity('Added Child'));
  presenter.refreshTreeSelection(tree, world, new Set([root]));
  assert.equal(dataWrites, 2, 'hierarchy changes invalidate the structural projection');
  assert.equal(tree.data[0].children.length, 2);

  root.addChild(hiddenChild);
  presenter.refreshTreeSelection(tree, world, new Set([root]));
  assert.equal(dataWrites, 3, 'reparenting an existing entity advances the structural projection');
  assert.equal(tree.data[0].children.length, 3);

  root.name = 'Renamed Root';
  presenter.refreshTreeSelection(tree, world, new Set([root]));
  assert.equal(dataWrites, 4, 'selected presentation changes refresh labels without requiring a hierarchy mutation');
  assert.equal(tree.data[0].label, 'Renamed Root');

  assert.equal(presenter.setFilter('hidden'), true);
  presenter.refreshTreeSelection(tree, world, new Set([root]));
  assert.equal(dataWrites, 5);
  assert.equal(tree.data.length, 1, 'filter retains only matching entities and their ancestors');
  assert.equal(tree.data[0].label, 'Renamed Root');
  assert.equal(tree.data[0].children[0].label, 'Hidden Prefab Child');
  assert.equal(presenter.setFilter(' HIDDEN '), false, 'normalized duplicate filters avoid projection work');

  assert.equal(presenter.setFilter(''), true);
  presenter.refreshTreeSelection(tree, world, new Set([root]));
  assert.equal(tree.data.length, 2, 'clearing the filter restores the full hierarchy');
});
