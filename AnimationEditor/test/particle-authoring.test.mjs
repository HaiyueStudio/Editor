import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  createBasicAnimationNode,
  createEmptyAnimationEditorProject,
  freezeAnimationEditorProject,
  parseAnimationEditorProject,
  serializeAnimationEditorProject,
} from '../dist-test/testing.js';

const domain = await import('../dist-test/particle-authoring.js');
const preview = await import('../dist-test/particle-preview.js');
const resource = await import('../dist-test/particle-resource.js');
const runtime = await import('../dist-test/particle-runtime.js');

test('Particle2D authoring covers the frozen descriptor and survives project/HYA round trips', () => {
  let project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({
    id: 'particle-project', name: 'Particle Project', width: 320, height: 240, duration: 3, frameRate: 30,
  }));
  project.composition.endBehavior = 'loop';
  project.assets.push({
    id: 'spark', name: 'Spark', type: 'image',
    source: { kind: 'external', uri: 'spark.png' },
    delivery: { uri: 'spark.png', mimeType: 'image/png', width: 32, height: 32, colorSpace: 'srgb' },
  });
  const node = createBasicAnimationNode(project, 'rectangle');
  project.nodes.push(node);
  project = freezeAnimationEditorProject(project);
  project = domain.addParticle2DComponent(project, node.id, 'sparks');
  project = domain.editParticle2DDescriptor(project, node.id, 'sparks', {
    maxParticles: 4096,
    emissionRate: 180,
    burst: 48,
    duration: 2.5,
    loop: true,
    seed: 1732584193,
    lifetime: [0.35, 1.2],
    speed: [30, 140],
    angle: [-2.6, -0.55],
    gravity: [8, 120],
    startSize: [12, 24],
    endSize: [0, 5],
    startColor: [1, 0.85, 0.25, 0.95],
    endColor: [1, 0.08, 0.01, 0],
    shape: 'circle',
    shapeSize: [40, 20],
    shapeRadius: 18,
    blendMode: 'additive',
    radial: true,
  });
  project = domain.setParticle2DTextureResource(project, node.id, 'sparks', 'spark');
  project = domain.setParticle2DTextureResource(project, node.id, 'sparks', null);
  assert.equal(domain.readParticle2DDescriptor(project, node.id, 'sparks').resource, undefined);
  project = domain.setParticle2DTextureResource(project, node.id, 'sparks', 'spark');

  const descriptor = domain.readParticle2DDescriptor(project, node.id, 'sparks');
  assert.equal(descriptor.resource, 'spark');
  assert.deepEqual(domain.particle2DLifetimeProfile(descriptor), {
    interpolation: 'linear',
    size: { from: [12, 24], to: [0, 5] },
    color: { from: [1, 0.85, 0.25, 0.95], to: [1, 0.08, 0.01, 0] },
    opacity: { from: 0.95, to: 0 },
    rotation: { dimension: '2d', mode: 'align-velocity', initialVelocityAngle: [-2.6, -0.55] },
  });

  const reopened = parseAnimationEditorProject(JSON.parse(serializeAnimationEditorProject(project)));
  const compilation = compileAnimationEditorProject(reopened);
  const delivered = compilation.document.nodes.flatMap(candidate => candidate.components).find(component => component.type === 'particle2d');
  assert.deepEqual(delivered, descriptor);
  const reparsed = compilation.parsed.nodes.flatMap(candidate => candidate.components).find(component => component.type === 'particle2d');
  assert.deepEqual(reparsed, descriptor);
  assert.equal(compilation.parsed.source, 'binary');
});

test('engine-backed scrub rebuild is deterministic across repeat, loop and reverse seeks', () => {
  const descriptor = particleDescriptor({
    maxParticles: 256, emissionRate: 90, burst: 12, duration: 2, loop: true, seed: 777,
    lifetime: [0.4, 1.4], speed: [25, 110], angle: [-2.8, -0.3], gravity: [0, 90],
  });
  const first = new preview.Particle2DPreviewSession(descriptor, { duration: 2, loop: true });
  const second = new preview.Particle2DPreviewSession(structuredClone(descriptor), { duration: 2, loop: true });
  for (const time of [0.25, 0.9, 1.65]) {
    const a = first.scrub(time);
    const b = second.scrub(time);
    assert.equal(a.fingerprint, b.fingerprint, `same seed/time descriptor at ${time}s`);
    assert.deepEqual(a.instanceData, b.instanceData);
    assert.equal(first.scrub(time).fingerprint, a.fingerprint, `repeat seek at ${time}s`);
  }
  const looped = first.scrub(2.9);
  const direct = second.scrub(0.9);
  assert.equal(looped.canonicalTime.toFixed(6), '0.900000');
  assert.equal(looped.fingerprint, direct.fingerprint);
  const later = first.scrub(1.4);
  const reversed = first.scrub(0.4);
  assert.notEqual(later.fingerprint, reversed.fingerprint);
  assert.equal(reversed.fingerprint, second.scrub(0.4).fingerprint);
  assert.ok(first.statistics().reverseScrubs >= 1);
  first.dispose();
  second.dispose();
});

test('capacity pressure reports deterministic spawn/drop and production budgets', () => {
  const descriptor = particleDescriptor({
    maxParticles: 8, emissionRate: 960, burst: 8, lifetime: [10, 10], speed: [0, 0], angle: [0, 0],
  });
  const session = new preview.Particle2DPreviewSession(descriptor, { duration: 1, loop: false });
  session.scrub(0.2);
  const stats = session.statistics();
  assert.equal(stats.alive, 8);
  assert.equal(stats.spawned, 8);
  assert.ok(stats.dropped > 0);
  assert.equal(stats.drawCalls, 1);
  assert.equal(stats.uploadedBytes, 8 * 32);
  assert.ok(stats.diagnostics.some(item => item.code === 'W_PARTICLE_CAPACITY_PRESSURE'));

  const overBudget = domain.diagnoseParticle2DProduction(particleDescriptor({ maxParticles: 140_000 }));
  assert.ok(overBudget.some(item => item.code === 'E_PARTICLE_CAPACITY_PREVIEW_LIMIT' && item.severity === 'error'));
  assert.throws(
    () => new preview.Particle2DPreviewSession(particleDescriptor({ maxParticles: 140_000 }), { duration: 1, loop: false }),
    error => error.code === 'E_PARTICLE_CAPACITY',
  );
  session.dispose();
});

test('Particle3D authoring descriptor stays field-for-field compatible with engine options and shared lifetime semantics', () => {
  const descriptor = { ...domain.DEFAULT_PARTICLE_3D_DESCRIPTOR, textureResource: 'spark-3d' };
  const validated = domain.validateParticle3DDescriptor(descriptor);
  const options = domain.particle3DDescriptorToEngineOptions(validated);
  for (const field of [
    'maxParticles', 'emissionRate', 'burst', 'duration', 'loop', 'seed', 'lifetime', 'speed',
    'direction', 'spread', 'gravity', 'startSize', 'endSize', 'rotation', 'angularVelocity',
    'startColor', 'endColor', 'shape', 'shapeSize', 'shapeRadius', 'blendMode', 'radial',
    'opacity', 'depthTest', 'depthWrite', 'sortMode',
  ]) assert.deepEqual(options[field], validated[field], field);
  assert.equal('textureResource' in options, false, 'resource id remains delivery data, not a GPUTexture');
  assert.deepEqual(domain.particle3DLifetimeProfile(validated).rotation, {
    dimension: '3d', initial: validated.rotation, angularVelocity: validated.angularVelocity,
  });
});

test('texture replacement is latest-wins and abort/dispose release every decoded owner exactly once', async () => {
  const requests = [];
  const loader = {
    load(source, signal) {
      const pending = deferred();
      requests.push({ source, signal, ...pending });
      return pending.promise;
    },
  };
  const session = new resource.ParticleTextureResourceSession(loader);
  const first = session.replace('first');
  const second = session.replace('second');
  assert.equal(requests[0].signal.aborted, true);
  const a = fakeTexture('a');
  requests[0].resolve(a);
  assert.equal(await first, null);
  assert.equal(a.closed, 1);
  const b = fakeTexture('b');
  requests[1].resolve(b);
  assert.equal(await second, b);
  const third = session.replace('third');
  const c = fakeTexture('c');
  requests[2].resolve(c);
  assert.equal(await third, c);
  assert.equal(b.closed, 1);
  assert.equal(session.metrics.liveTextures, 1);
  assert.equal(session.metrics.peakLiveTextures, 1);
  session.dispose();
  session.dispose();
  assert.equal(c.closed, 1);
  assert.equal(session.metrics.liveTextures, 0);
  assert.equal(session.metrics.disposedTextures, 3);
});

test('extension runtime rebuilds particles for explicit small forward seeks and zero restart', () => {
  const animation = particleAnimationFixture();
  const world = new runtime.World('Particle seek');
  const player = new runtime.Animation2DComponent(animation, { autoplay: false });
  const owner = new runtime.Entity('Player').addComponent(new runtime.Transform2D()).addComponent(player);
  world.addEntity(owner);
  world.addSystem(new runtime.Animation2DSystem());
  world.update(0, 0);

  player.seek(0.2);
  world.update(1, 0);
  const emitter = findComponent(owner, runtime.ParticleEmitter2D);
  assert.ok(emitter && emitter.activeParticles > 0);
  emitter.emit(emitter.maxParticles - emitter.activeParticles);
  assert.equal(emitter.activeParticles, emitter.maxParticles);

  player.seek(0.21);
  world.update(2, 0);
  assert.ok(emitter.activeParticles < emitter.maxParticles, 'small forward explicit seek rebuilt engine state');
  player.seek(0);
  assert.equal(player._forceParticleSeek, true);
  world.update(3, 0);
  assert.equal(player._forceParticleSeek, false);
  assert.equal(emitter.activeParticles, 0, 'zero seek clears prior particle state and restores pending burst');
  world.destroy();
});

function particleDescriptor(overrides = {}) {
  return {
    type: 'particle2d', maxParticles: 128, emissionRate: 60, burst: 8, duration: 2, loop: true, seed: 17,
    lifetime: [0.5, 1.2], speed: [20, 80], angle: [-Math.PI, 0], gravity: [0, 60],
    startSize: [8, 16], endSize: [0, 3],
    startColor: [1, 0.8, 0.2, 1], endColor: [1, 0.1, 0, 0],
    shape: 'circle', shapeSize: [0, 0], shapeRadius: 8, blendMode: 'additive', radial: true,
    ...overrides,
  };
}

function particleAnimationFixture() {
  return {
    format: 'haiyue-animation', version: '1.0',
    canvas: { width: 200, height: 100, coordinateSystem: 'screen-y-down' },
    duration: 1, endBehavior: 'loop', resources: [], tracks: [],
    nodes: [{ id: 'sparks', components: [particleDescriptor({ maxParticles: 32, emissionRate: 20, burst: 4 })] }],
  };
}

function findComponent(entity, Component) {
  const found = entity.getComponent(Component);
  if (found) return found;
  for (const child of entity.children) {
    const nested = findComponent(child, Component);
    if (nested) return nested;
  }
  return undefined;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => { resolve = resolveValue; reject = rejectValue; });
  return { promise, resolve, reject };
}

function fakeTexture(id) {
  return { id, source: {}, width: 8, height: 8, closed: 0, close() { this.closed++; } };
}
