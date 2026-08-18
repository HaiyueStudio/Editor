import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAnimationBinary } from '@haiyue/animation-spec';
import {
  ContentAuthoringStore,
  MaterialGraphCompilerClient,
  createAnimationAuthoringDocument,
  createBlendTreeMotion,
  deriveRenderDomainDiagnostics,
  prepareHyaAnimationAsset,
  sampleAnimationTimeline,
  validateAnimationAuthoringDocument,
} from '../dist-test/testing.js';

function hyaDocument() {
  return {
    format: 'haiyue-animation',
    version: '1.0',
    name: 'Editor Pulse',
    canvas: { width: 320, height: 180, coordinateSystem: 'screen-y-down' },
    duration: 2,
    frameRate: 60,
    endBehavior: 'loop',
    nodes: [{
      id: 'shape',
      components: [{ type: 'shape2d', shape: 'rect', size: [80, 30], fill: [0.1, 0.4, 1, 1] }],
    }],
    tracks: [{
      node: 'shape', property: 'opacity', interpolation: 'linear', times: [0, 2], values: [0, 1],
    }],
  };
}

class FakeMaterialGraphWorker {
  requests = [];
  listeners = { message: [], error: [] };
  terminated = false;
  postMessage(value) { this.requests.push(value); }
  terminate() { this.terminated = true; }
  addEventListener(type, listener) { this.listeners[type].push(listener); }
  respond(response) { for (const listener of this.listeners.message) listener({ data: response }); }
}

function animationDocument() {
  const document = structuredClone(createAnimationAuthoringDocument({ id: 'hero', name: 'Hero', dimension: 'mixed' }));
  document.sources.push(
    { id: 'idle-2d', name: 'Idle 2D', dimension: '2d', duration: 1 },
    { id: 'run-3d', name: 'Run 3D', dimension: '3d', duration: 2 },
  );
  document.timeline.duration = 2;
  document.timeline.clips.push(
    { id: 'idle-lane', sourceId: 'idle-2d', start: 0, duration: 1, sourceOffset: 0, speed: 1, lane: 0 },
    { id: 'run-lane', sourceId: 'run-3d', start: 0.5, duration: 1.5, sourceOffset: 0, speed: 1, lane: 1 },
  );
  document.timeline.tracks.push({
    id: 'weight', name: 'Weight', binding: 'root.opacity', property: 'opacity', valueSize: 1,
    keyframes: [
      { id: 'weight-0', time: 0, value: [0], interpolation: 'linear' },
      { id: 'weight-1', time: 2, value: [1], interpolation: 'linear' },
    ],
  });
  document.stateMachine.parameters.push(
    { name: 'speed', type: 'float', defaultValue: 0 },
    { name: 'direction', type: 'float', defaultValue: 0 },
  );
  document.stateMachine.layers.push({
    id: 'base', name: 'Base', initialStateId: 'locomotion', transitions: [],
    states: [{
      id: 'locomotion', name: 'Locomotion', loop: 'repeat',
      motion: createBlendTreeMotion('blend-2d', document.stateMachine.parameters, document.sources.map(source => source.id)),
    }],
  });
  return document;
}

test('shared animation authoring accepts 2D/3D sources, timeline and Blend Trees in one asset', () => {
  const document = animationDocument();
  assert.deepEqual(validateAnimationAuthoringDocument(document), []);
  const sample = sampleAnimationTimeline(document, 0.75);
  assert.deepEqual(sample.activeClips.map(clip => clip.dimension), ['2d', '3d']);
  assert.deepEqual(sample.values['root.opacity'], [0.375]);
  assert.equal(document.stateMachine.layers[0].states[0].motion.kind, 'blend-2d');
});

test('content authoring store round-trips animations and Material Graph assets', () => {
  const store = new ContentAuthoringStore();
  store.setAnimation(animationDocument());
  store.setMaterialGraph({
    id: 'hero-material', name: 'Hero Material',
    graph: {
      format: 'haiyue-shader-graph', version: 1, kind: 'material', profile: 'webgpu-portable',
      resources: [], nodes: [], outputs: { baseColor: { literal: { type: 'color3<f32>', value: [1, 0, 0], colorSpace: 'linear' } } },
    },
  });
  const copy = new ContentAuthoringStore();
  copy.load(store.snapshot());
  assert.equal(copy.animations[0].stateMachine.layers[0].states[0].motion.kind, 'blend-2d');
  assert.equal(copy.materialGraphs[0].graph.format, 'haiyue-shader-graph');
  assert.throws(() => copy.load({ ...store.snapshot(), materialGraphs: [{ id: 'bad', name: 'Bad', graph: {} }] }), /haiyue-shader-graph/);
  assert.equal(copy.animations[0].id, 'hero', 'failed loads are transactional');
});

test('HYA import validates real bytes, binds a source id and round-trips losslessly', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(hyaDocument()));
  const asset = await prepareHyaAnimationAsset({
    name: 'pulse.hya',
    type: 'application/vnd.haiyue.animation',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  assert.equal(asset.name, 'Editor Pulse');
  assert.equal(asset.metadata.source, 'json');
  assert.deepEqual(asset.metadata.canvas, { width: 320, height: 180 });
  assert.equal(asset.metadata.trackCount, 1);
  assert.equal(asset.byteLength, bytes.byteLength);

  const store = new ContentAuthoringStore();
  store.setHyaAnimation(asset);
  const document = structuredClone(createAnimationAuthoringDocument({ id: 'pulse-controller', name: 'Pulse' }));
  document.sources.push({ id: 'pulse', assetId: asset.id, name: asset.name, dimension: '2d', duration: asset.metadata.duration });
  store.setAnimation(document);

  const copy = new ContentAuthoringStore();
  copy.load(store.snapshot());
  assert.equal(copy.hyaAnimations[0].data, asset.data, 'original HYA bytes must not be normalized or re-encoded');
  assert.equal(copy.animations[0].sources[0].assetId, asset.id);
  assert.equal(copy.remove('hya-animation', asset.id), false, 'referenced HYA resources cannot be removed');

  const invalid = { ...store.snapshot(), hyaAnimations: [] };
  assert.throws(() => copy.load(invalid), /missing HYA asset/);
  assert.equal(copy.hyaAnimations[0].id, asset.id, 'failed HYA loads are transactional');
});

test('HYA import rejects wrong extensions and changed file sizes before committing', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(hyaDocument()));
  await assert.rejects(prepareHyaAnimationAsset({ name: 'pulse.json', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }), /Expected a \.hya/);
  await assert.rejects(prepareHyaAnimationAsset({ name: 'pulse.hya', size: bytes.byteLength + 1, arrayBuffer: async () => bytes.buffer }), /changed while/);
});

test('HYA import accepts the production binary container without normalizing it to JSON', async () => {
  const binary = encodeAnimationBinary(hyaDocument());
  const asset = await prepareHyaAnimationAsset({
    name: 'pulse.hya',
    size: binary.byteLength,
    arrayBuffer: async () => binary.slice(0),
  });
  assert.equal(asset.metadata.source, 'binary');
  assert.equal(asset.byteLength, binary.byteLength);
  assert.equal(asset.metadata.duration, 2);
  assert.equal(asset.metadata.nodeCount, 1);
});

test('Material Graph compiler client stays asynchronous and abort/dispose never fall back to main-thread work', async () => {
  const worker = new FakeMaterialGraphWorker();
  const client = new MaterialGraphCompilerClient(worker);
  const described = client.describe();
  const describeRequest = worker.requests[0];
  worker.respond({ protocol: describeRequest.protocol, requestId: describeRequest.requestId, ok: true, value: { catalog: [], surfaceSlots: ['baseColor'] } });
  assert.deepEqual(await described, { catalog: [], surfaceSlots: ['baseColor'] });

  const controller = new AbortController();
  const aborted = client.compile({
    format: 'haiyue-shader-graph', version: 1, kind: 'material', profile: 'webgpu-portable',
    resources: [], nodes: [], outputs: {},
  }, controller.signal);
  controller.abort();
  await assert.rejects(aborted, error => error.name === 'AbortError');

  const pending = client.describe();
  client.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(worker.terminated, true);
});

test('render diagnostics attribute lighting, shadows, AO, variants and GPU ownership', () => {
  const snapshot = deriveRenderDomainDiagnostics({
    lightCapacity: 2,
    directionalShadowCapacity: 1,
    components: [
      { lightType: 'directional', castShadow: true },
      { lightType: 'directional', castShadow: true },
      { lightType: 'point' },
    ],
    frame: {
      counters: { pipelineSwitches: 7 },
      gpu: { passes: [
        { label: 'ShadowMap.directional', durationMs: 0.8 },
        { label: 'GTAOPass.occlusionPass', durationMs: 1.2 },
        { label: 'GTAOPass.denoisePass', durationMs: 0.4 },
      ] },
    },
    resources: {
      resources: [
        { label: 'Haiyue.directional-shadow-map', type: 'texture', estimatedBytes: 1024 },
        { label: 'GTAOPass.occlusionTexture', type: 'texture', estimatedBytes: 512 },
      ],
      byType: {
        texture: { current: 2, estimatedBytes: 1536, peak: 3 },
        'render-pipeline': { current: 4, estimatedBytes: 0, peak: 5 },
      },
      caches: [{ label: 'PBR pipeline variants', entries: 3, hits: 9, misses: 1 }],
      owners: [{ owner: { label: 'Scene', kind: 'scene' }, resources: 6, usage: { estimatedBytes: 1536 } }],
      releasedOwnerResiduals: 0,
    },
  });
  assert.deepEqual(snapshot.lighting, { total: 3, active: 3, capacity: 2, clipped: 1, byType: { directional: 2, point: 1 } });
  assert.equal(snapshot.shadows.clipped, 1);
  assert.equal(snapshot.shadows.gpuMs, 0.8);
  assert.deepEqual(snapshot.ambientOcclusion.algorithms, ['gtao']);
  assert.equal(snapshot.ambientOcclusion.gpuMs, 1.6);
  assert.equal(snapshot.shaderVariants.cacheHitRate, 0.9);
  assert.equal(snapshot.gpuResources.estimatedBytes, 1536);
});
