import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClippingPlanes,
  CommandBus,
  Entity,
  applyGenericComponentSnapshot,
  createMainComponentContext,
  deserializeEntity,
  exportRuntimeSceneFromEditorScene,
  generateRuntimeProjectFiles,
  serializeEntity,
  serializeRuntimeProjectFiles,
  snapshotEditCommand,
  snapshotGenericComponent,
  validateClippingPlanesEditorValue,
} from '../dist-test/testing.js';

function createComponentContext() {
  return createMainComponentContext({
    createDefaultMesh2DComponent: () => null,
    createDefaultMeshComponent: () => null,
    createDefaultScriptComponent: () => null,
    getDefaultCanvasTextStyle: () => ({ font: '16px sans-serif' }),
  });
}

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

test('ClippingPlanes is createable and its contributed Inspector schema edits transactionally', () => {
  const context = createComponentContext();
  const descriptor = context.getComponentDescriptors().find(item => item.name === 'ClippingPlanes');
  assert.ok(descriptor, 'ClippingPlanes must be visible in Add Component');

  const clipping = descriptor.create();
  assert.ok(clipping instanceof ClippingPlanes);
  assert.deepEqual(clipping.getPlane(0), { normal: [1, 0, 0], constant: 0 });

  const schema = context.inspectorRegistry.resolveSchema(clipping);
  assert.ok(schema, 'ClippingPlanes must resolve an editor-owned Inspector schema');
  assert.equal(schema.fields.planes.type, 'array');
  assert.match(validateClippingPlanesEditorValue(Array.from({ length: 9 }, () => ({ normal: [1, 0, 0], constant: 0 }))), /at most 8/);
  assert.match(validateClippingPlanesEditorValue([{ normal: [0, 0, 0], constant: 0 }]), /non-zero/);
  assert.equal(validateClippingPlanesEditorValue([{ normal: [0, 2, 0], constant: -4 }]), null);

  const entity = new Entity('Clipped mesh');
  entity.addComponent(clipping);
  const before = snapshotGenericComponent(clipping, schema);
  const after = {
    planes: [
      { normal: [0, 2, 0], constant: -4 },
      { normal: [0, 0, -3], constant: 6 },
    ],
  };
  const bus = new CommandBus(() => {});
  bus.execute(snapshotEditCommand({
    label: 'Edit ClippingPlanes',
    entity,
    before,
    after,
    apply: snapshot => applyGenericComponentSnapshot(clipping, snapshot, schema),
    onChange: () => {},
  }));
  assert.equal(clipping.count, 2);
  assert.deepEqual(clipping.getPlane(0), { normal: [0, 1, 0], constant: -2 });
  assert.deepEqual(clipping.getPlane(1), { normal: [0, 0, -1], constant: 2 });

  bus.undo();
  assert.equal(clipping.count, 1);
  assert.deepEqual(clipping.getPlane(0), { normal: [1, 0, 0], constant: 0 });
  bus.redo();
  assert.equal(clipping.count, 2);
});

test('ClippingPlanes survives editor save, runtime export, and player deserialization', () => {
  const entity = new Entity('Clipped mesh');
  entity.addComponent(new ClippingPlanes([
    { normal: [1, 0, 0], constant: -0.5 },
    { normal: [0, 1, 0], constant: 0.25 },
  ]));
  const serializedEntity = serializeEntity(entity);
  assert.deepEqual(serializedEntity.components, [{
    type: 'ClippingPlanes',
    planes: [
      { normal: [1, 0, 0], constant: -0.5 },
      { normal: [0, 1, 0], constant: 0.25 },
    ],
  }]);

  const runtimeExport = exportRuntimeSceneFromEditorScene({
    version: 1,
    name: 'Clipping authoring',
    globals: createGlobals(),
    systems: [],
    resources: { geometries: [], materials: [], textures: [], models: [], prefabs: [], scripts: [] },
    entities: [serializedEntity],
  });
  assert.deepEqual(runtimeExport.scene.entities[0].components, serializedEntity.components);
  assert.deepEqual(runtimeExport.manifest.warnings, []);

  const restoredEntity = deserializeEntity(runtimeExport.scene.entities[0], new Map(), new Map(), new Map());
  const restored = restoredEntity.getComponent(ClippingPlanes);
  assert.ok(restored instanceof ClippingPlanes);
  assert.equal(restored.count, 2);
  assert.deepEqual(restored.getPlane(1), { normal: [0, 1, 0], constant: 0.25 });

  const project = generateRuntimeProjectFiles(runtimeExport, {
    mode: 'static',
    projectName: 'Clipping authoring',
    precompileRuntimeData: false,
  });
  const files = serializeRuntimeProjectFiles(project.files);
  assert.match(files['src/runtime-deserialization.ts'], /coreComponentSerializationRegistry\.deserialize/);
  assert.match(files['src/scene.runtime.json'], /"ClippingPlanes"/);
});
