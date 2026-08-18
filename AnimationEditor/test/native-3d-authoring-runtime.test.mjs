import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import { rollup } from 'rollup';

import { workerModuleUrlPolicy } from '../../config/rollup.shared.js';
import { wgslRaw } from '../../scripts/rollup-plugin-wgsl.js';
import { native3dTypescript } from './native-3d-rollup.mjs';

const bundle = await rollup({
  input: fileURLToPath(new URL('./native-3d-entry.ts', import.meta.url)),
  plugins: [
    wgslRaw(), workerModuleUrlPolicy(),
    nodeResolve({ preferBuiltins: true, extensions: ['.mjs', '.js', '.json', '.node', '.ts'], exportConditions: ['source'] }), commonjs(),
    native3dTypescript(),
  ],
});
const generated = await bundle.generate({ format: 'es', inlineDynamicImports: true });
await bundle.close();
const entryChunk = generated.output.find(item => item.type === 'chunk' && item.isEntry);
if (!entryChunk) throw new Error('G06 node test bundle did not produce an entry chunk.');

const entry = await import(`data:text/javascript;base64,${Buffer.from(entryChunk.code).toString('base64')}`);
const editor = entry.native3dEditor;
const spec3d = entry.native3dSpec;
const core = entry.animationSpec;

const animationSpecRoot = new URL('../', import.meta.resolve('@haiyue/animation-spec'));
const extensionsRoot = new URL('../', import.meta.resolve('@haiyue/extensions'));
const VALID_FIXTURE = new URL('schema/fixtures/native-3d-valid.hya.json', animationSpecRoot);
const MIXED_FIXTURE = new URL('schema/fixtures/native-3d-mixed-invalid.hya.json', animationSpecRoot);
const GLTF_FIXTURE = new URL('test/fixtures/gltf/animation-characterization.gltf', extensionsRoot);

test('native-3D extension validates JSON/binary, rejects mixed carriers, and leaves old 2D decode intact', async () => {
  const source = JSON.parse(await readFile(VALID_FIXTURE, 'utf8'));
  const parsedJson = spec3d.parseNative3DAnimation(source);
  assert.equal(parsedJson.payload.mode, 'native-3d');
  assert.equal(parsedJson.payload.coordinateSystem.forwardAxis, '-z');
  assert.equal(parsedJson.payload.nodes.some(node => node.components.some(component => component.kind === 'particle3d')), true);

  const binary = core.encodeAnimationBinary(parsedJson.document);
  const parsedBinary = spec3d.parseNative3DAnimation(binary);
  assert.equal(parsedBinary.document.version, '1.0');
  assert.equal(parsedBinary.payload.clips[0].tracks.length, parsedJson.payload.clips[0].tracks.length);
  assert.equal(parsedBinary.resources[0].mimeType, 'model/gltf-binary');

  const mixed = JSON.parse(await readFile(MIXED_FIXTURE, 'utf8')).document;
  assert.throws(
    () => spec3d.parseNative3DAnimation(mixed),
    error => error.code === 'E_ANIMATION_3D_MIXED_DIMENSIONS' && typeof error.path === 'string',
  );

  const oldDocument = {
    format: 'haiyue-animation', version: '1.0', name: 'Legacy 2D',
    canvas: { width: 32, height: 32, coordinateSystem: 'screen-y-down' },
    duration: 1, frameRate: 30, endBehavior: 'hold', resources: [], nodes: [], tracks: [],
  };
  const oldBinary = core.encodeAnimationBinary(oldDocument);
  assert.equal(core.parseAnimation(oldBinary).name, 'Legacy 2D');
  assert.throws(
    () => spec3d.parseNative3DAnimation(oldBinary),
    error => error.code === 'E_ANIMATION_3D_INVALID_PAYLOAD',
  );
});

test('primitive, camera, material and TRS tracks survive save/reopen and deterministic exact-HYA compilation', () => {
  let project = editor.createNative3dProject({ id: 'g06-primitive', name: 'G06 原生 3D', duration: 2, frameRate: 60 });
  project = editor.addNative3dMaterial(project, defaultMaterial());
  project = editor.addNative3dCamera(project, {
    nodeId: 'camera', componentId: 'camera:main',
    transform: { translation: [0, 1.5, 5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    projection: { kind: 'perspective', fovYRadians: 0.6, near: 0.1, far: 100 },
  });
  project = editor.addNative3dPrimitive(project, {
    nodeId: 'box', componentId: 'box:mesh', primitive: 'box', materialId: 'material:hero',
  });
  project = editor.setNative3dNodeTransform(project, 'box', { eulerYXZ: [0.1, 0.2, 0.3], scale: [1, 2, 1] });
  project = editor.createNative3dClip(project, { id: 'clip:move', name: '移动', duration: 2 });
  project = addTrack(project, 'clip:move', translationTrack('box', 'track:move', [[0, [0, 0, 0]], [2, [2, 1, 0]]]));
  project = addTrack(project, 'clip:move', cameraTrack('track:fov', [[0, [0.6]], [2, [1]]]));
  project = addTrack(project, 'clip:move', materialTrack('track:color', [[0, [0.2, 0.55, 1, 1]], [2, [1, 0.2, 0.1, 1]]]));

  const serialized = editor.serializeNative3dProject(project);
  const reopened = editor.parseNative3dProject(serialized);
  assert.equal(reopened.mode, '3d');
  assert.equal(reopened.nodes.find(node => node.id === 'box').transform.scale[1], 2);
  const first = editor.compileNative3dProject(reopened);
  const second = editor.compileNative3dProject(reopened);
  assert.deepEqual(new Uint8Array(first.binary), new Uint8Array(second.binary));
  assert.equal(first.parsed.source, 'binary');
  const delivery = spec3d.parseNative3DAnimation(first.binary);
  assert.equal(delivery.payload.nodes.length, 2);
  assert.equal(delivery.payload.clips[0].tracks.length, 3);
  assert.deepEqual(editor.createNative3dHyaArtifact(reopened).bytes, new Uint8Array(first.binary));
});

test('real glTF Idle to Run cross-fade reuses Animation3D mixer for root, joint, GPU morph and camera', async () => {
  const gltfSource = await readFile(GLTF_FIXTURE, 'utf8');
  const gltfUri = `data:model/gltf+json,${encodeURIComponent(gltfSource)}`;
  const importedModel = await entry.loadGltfModel(gltfUri);
  let project;
  try {
    const clips = entry.createGltfAnimation3DClips(importedModel, 'fixture');
    assert.equal(clips.length, 2);
    project = editor.createNative3dProject({ id: 'g06-gltf', name: 'G06 glTF', duration: 1, frameRate: 60 });
    project = editor.addNative3dAsset(project, {
      id: 'model:fixture', name: 'Character fixture', type: 'model',
      source: { kind: 'external', uri: gltfUri },
      delivery: { uri: gltfUri, mimeType: 'model/gltf+json' },
      provenance: { importer: 'gltf', sourceFormat: 'gltf-2.0' },
    });
    project = editor.addNative3dModel(project, {
      nodeId: 'character', componentId: 'character:model', resource: 'model:fixture',
    });
    project = editor.addNative3dCamera(project, {
      nodeId: 'camera', componentId: 'camera:main',
      transform: { translation: [0, 1.5, 5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      projection: { kind: 'perspective', fovYRadians: 0.6, near: 0.1, far: 100 },
    });
    project = editor.importNative3dGltfClips(project, 'character', clips, { extendComposition: true });
    project = addTrack(project, 'gltf:character:0', cameraTrack('track:run-fov', [[0, [0.6]], [1, [1]]]));
    project = addTrack(project, 'gltf:character:1', cameraTrack('track:idle-fov', [[0, [0.6]], [1, [0.6]]]));
  } finally {
    entry.disposeGltfModel(importedModel);
  }

  const reopened = editor.parseNative3dProject(editor.serializeNative3dProject(project));
  const compilation = editor.compileNative3dProject(reopened);
  const delivery = spec3d.parseNative3DAnimation(compilation.binary);
  const scene = fakeScene();
  const runtime = await entry.native3dRuntime.createHyaAnimation3DRuntime({
    scene,
    payload: delivery.payload,
    resources: delivery.resources,
    addPreviewLights: false,
  });
  try {
    assert.equal(runtime.mixer.constructor.name, 'Animation3DMixer');
    assert.equal(runtime.pose.constructor.name, 'Animation3DPoseBuffer');
    const animated = requireEntity(runtime.root, 'AnimatedTRS').getComponent(entry.Transform3D);
    const geometry = requireGeometry(runtime.root, 'SkinnedMorph');
    const camera = runtime.getEntity('camera').getComponent(entry.Camera3D);
    assert.ok(animated && camera);
    assert.equal(geometry.morphUseGpu, true);
    assert.ok(geometry.skinning);

    const idle = runtime.playClip('gltf:character:1', { id: 'Idle', loop: 'once', clampWhenFinished: true });
    const run = runtime.playClip('gltf:character:0', {
      id: 'Run', loop: 'once', clampWhenFinished: true,
      fadeFrom: idle, fadeDuration: 1,
    });
    assert.equal(idle.actionCount, 2);
    assert.equal(run.actionCount, 2);

    runtime.update(0);
    assertArrayClose(animated.localMatrix.slice(12, 15), [1, 2, 3]);
    assertArrayClose(geometry.morphWeights, [0.1, 0.2]);
    assertArrayClose(geometry.skinning.jointMatrices.slice(28, 32), [0, 0, 0, 1]);
    assert.ok(Math.abs(camera.fov - 0.6) < 1e-5);

    runtime.update(0.5);
    assertArrayClose(animated.localMatrix.slice(12, 15), [1.5, 2.5, 3.5]);
    assertArrayClose(geometry.morphWeights, [0.3, 0.35]);
    assertArrayClose(geometry.skinning.jointMatrices.slice(28, 32), [0, 0.5, 0, 1]);
    assert.ok(Math.abs(camera.fov - 0.7) < 1e-5, `expected cross-faded fov 0.7, received ${camera.fov}`);

    runtime.update(0.5);
    assertArrayClose(animated.localMatrix.slice(12, 15), [3, 4, 5]);
    assertArrayClose(geometry.morphWeights, [0.75, 0.25]);
    assertArrayClose(geometry.skinning.jointMatrices.slice(28, 32), [0, 2, 0, 1]);
    assert.ok(Math.abs(camera.fov - 1) < 1e-5);
  } finally {
    runtime.destroy();
  }
  assert.deepEqual(runtime.diagnostics(), {
    state: 'destroyed', entityCount: 0, materialCount: 0, modelCount: 0,
    actionGroupCount: 0, ownerResidualCount: 0,
  });
});

test('local/world gizmo math edits immutable TRS without introducing Euler storage', () => {
  let project = editor.createNative3dProject({ id: 'gizmo', duration: 1 });
  project = editor.addNative3dMaterial(project, defaultMaterial());
  project = editor.addNative3dPrimitive(project, {
    nodeId: 'box', componentId: 'box:mesh', primitive: 'box', materialId: 'material:hero',
    transform: { translation: [0, 0, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], scale: [1, 1, 1] },
  });
  const transform = project.nodes[0].transform;
  const local = entry.native3dPreview.applyGizmoDelta(project, 'box', transform, 'translate', 'local', 'x', 80);
  assertArrayClose(local.nodes[0].transform.translation, [0, 1, 0]);
  const world = entry.native3dPreview.applyGizmoDelta(project, 'box', transform, 'translate', 'world', 'x', 80);
  assertArrayClose(world.nodes[0].transform.translation, [1, 0, 0]);
  const scaled = entry.native3dPreview.applyGizmoDelta(project, 'box', transform, 'scale', 'world', 'z', 40);
  assertArrayClose(scaled.nodes[0].transform.scale, [1, 1, 1.5]);
  const rotated = entry.native3dPreview.applyGizmoDelta(project, 'box', transform, 'rotate', 'world', 'y', 90);
  assert.ok(Math.abs(Math.hypot(...rotated.nodes[0].transform.rotation) - 1) < 1e-6);
  assert.equal('euler' in rotated.nodes[0].transform, false);
});

function defaultMaterial() {
  return {
    id: 'material:hero', name: 'Hero', baseColorFactor: [0.2, 0.55, 1, 1],
    metallicFactor: 0.1, roughnessFactor: 0.65, emissiveFactor: [0, 0, 0],
    alphaMode: 'opaque', doubleSided: false,
  };
}

function addTrack(project, clipId, track) {
  return editor.createNative3dTrack(project, clipId, track);
}

function translationTrack(nodeId, id, keys) {
  return keyedTrack(id, {
    id: `binding:${id}`, target: { kind: 'node-id', nodeId },
    path: 'transform.translation', valueType: 'vec3', valueSize: 3,
  }, keys);
}

function cameraTrack(id, keys) {
  return keyedTrack(id, {
    id: 'binding:camera-fov', target: { kind: 'node-id', nodeId: 'camera' },
    path: 'property', component: 'camera3d', property: 'fovYRadians', valueType: 'scalar', valueSize: 1,
  }, keys);
}

function materialTrack(id, keys) {
  return keyedTrack(id, {
    id: 'binding:material-color', target: { kind: 'slot', slot: 'material:hero' },
    path: 'property', component: 'material3d', property: 'baseColorFactor', valueType: 'vec4', valueSize: 4,
  }, keys);
}

function keyedTrack(id, binding, keys) {
  return {
    id, name: id, binding, interpolation: 'linear',
    keyframes: keys.map(([time, value], index) => ({ id: `${id}:key:${index}`, time, value })),
  };
}

function fakeScene() {
  return {
    roots: [], camera: null,
    add(entity) { this.roots.push(entity); return this; },
    setCamera(entity) { this.camera = entity; return this; },
  };
}

function findEntity(root, name) {
  if (root.name === name) return root;
  for (const child of root.children) {
    const match = findEntity(child, name);
    if (match) return match;
  }
  return null;
}

function requireEntity(root, name) {
  const entity = findEntity(root, name);
  assert.ok(entity, `Expected entity "${name}"`);
  return entity;
}

function requireGeometry(root, nodeName) {
  const node = requireEntity(root, nodeName);
  const primitive = node.children.find(child => child.getComponent(entry.Mesh3D));
  const mesh = primitive?.getComponent(entry.Mesh3D);
  assert.ok(mesh, `Expected mesh below "${nodeName}"`);
  return mesh.geometry;
}

function assertArrayClose(actual, expected, epsilon = 1e-5) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index++) {
    const delta = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0));
    assert.ok(delta <= epsilon, `value ${index}: ${actual[index]} differs from ${expected[index]} by ${delta}`);
  }
}
