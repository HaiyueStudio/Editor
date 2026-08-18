import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  createBasicAnimationNode,
  createEmptyAnimationEditorProject,
  parseAnimationEditorProject,
  serializeAnimationEditorProject,
} from '../dist-test/testing.js';

const domain = await import('../dist-test/spritesheet-authoring.js');
const { SpriteSheetResourceSession } = await import('../dist-test/spritesheet-resource.js');

test('regular 5×5 slicing preserves whole-pixel margins, spacing, UVs and confirmable inference', () => {
  const frameMap = domain.createRegularSpriteSheetFrameMap('atlas', 92, 92, {
    columns: 5, rows: 5, margin: 2, spacing: 2,
  });
  assert.equal(frameMap.frames.length, 25);
  assert.deepEqual(frameMap.frames[0].rect, { x: 2, y: 2, width: 16, height: 16 });
  assert.deepEqual(frameMap.frames[12].rect, { x: 38, y: 38, width: 16, height: 16 });
  assert.deepEqual(frameMap.frames[24].rect, { x: 74, y: 74, width: 16, height: 16 });
  assert.deepEqual(frameMap.frames[24].uvRect, [74 / 92, 74 / 92, 16 / 92, 16 / 92]);

  const candidates = domain.inferSpriteSheetGridCandidates(92, 92, [0, 0, 0.2, 0.2]);
  assert.equal(candidates.requiresUserInput, true);
  assert.ok(candidates.candidates.length > 1, 'ambiguous image dimensions expose candidates');
  assert.ok(candidates.candidates.every(candidate => candidate.requiresConfirmation));
  assert.deepEqual(candidates.candidates[0], {
    id: '5x5', columns: 5, rows: 5, confidence: 0.95,
    reason: 'current-uv', requiresConfirmation: true,
  });
});

test('grid and atlas contracts reject budgets/bounds and diagnose unknown atlas fields', () => {
  assert.throws(
    () => domain.createRegularSpriteSheetFrameMap('atlas', 91, 92, { columns: 5, rows: 5, margin: 2, spacing: 2 }),
    error => error.code === 'E_SPRITESHEET_GRID_FRACTIONAL_CELL',
  );
  assert.throws(
    () => domain.createRegularSpriteSheetFrameMap('atlas', 8193, 16, { columns: 1, rows: 1 }),
    error => error.code === 'E_SPRITESHEET_IMAGE_BUDGET',
  );
  assert.throws(
    () => domain.createRegularSpriteSheetFrameMap('atlas', 256, 256, { columns: 65, rows: 65 }),
    error => error.code === 'E_SPRITESHEET_FRAME_BUDGET',
  );

  const parsed = domain.parseSpriteSheetAtlasJson({
    ignored: true,
    frames: {
      idle: { frame: { x: 2, y: 2, w: 16, h: 16 }, futureField: 42 },
      run: { frame: { x: 20, y: 2, w: 16, h: 16 }, rotated: false, trimmed: false },
    },
    meta: { image: 'atlas.png', size: { w: 92, h: 92 }, futureMeta: 'x' },
  }, 'atlas');
  assert.ok(parsed.frameMap);
  assert.equal(parsed.frameMap.source, 'atlas-json');
  assert.deepEqual(parsed.frameMap.frames.map(frame => frame.id), ['idle', 'run']);
  assert.deepEqual(
    parsed.diagnostics.filter(item => item.code === 'W_SPRITESHEET_ATLAS_UNKNOWN_FIELD').map(item => item.path),
    ['$.ignored', '$.meta.futureMeta', '$.frames.idle.futureField'],
  );

  const outside = domain.parseSpriteSheetAtlasJson({
    frames: [{ filename: 'bad', frame: { x: 90, y: 90, w: 16, h: 16 } }],
    meta: { size: { w: 92, h: 92 } },
  }, 'atlas');
  assert.equal(outside.frameMap, null);
  assert.ok(outside.diagnostics.some(item => item.code === 'E_SPRITESHEET_FRAME_BOUNDS'));
  assert.equal(domain.parseSpriteSheetAtlasJson({ frames: {}, meta: { size: { w: 92, h: 92 } } }, ' ').frameMap, null);
});

test('forward, reverse, ping-pong, duration, loop and reorder sequences are deterministic', () => {
  const frameMap = fiveByFive();
  const forward = domain.createSpriteSheetSequence(frameMap, {
    start: 0, end: 4, fps: 10, loop: false, mode: 'forward', durations: [0.1, 0.2, 0.1, 0.3, 0.1],
  });
  assert.deepEqual(forward.frames.map(frame => frame.frameId), ['frame-1', 'frame-2', 'frame-3', 'frame-4', 'frame-5']);
  assert.deepEqual(forward.frames.map(frame => frame.duration), [0.1, 0.2, 0.1, 0.3, 0.1]);

  const reverse = domain.createSpriteSheetSequence(frameMap, {
    start: 0, end: 4, fps: 10, loop: false, mode: 'reverse',
  });
  assert.deepEqual(reverse.frames.map(frame => frame.frameId), ['frame-5', 'frame-4', 'frame-3', 'frame-2', 'frame-1']);

  const pingPongOnce = domain.createSpriteSheetSequence(frameMap, {
    start: 0, end: 4, fps: 10, loop: false, mode: 'ping-pong',
  });
  assert.deepEqual(
    pingPongOnce.frames.map(frame => frame.frameId),
    ['frame-1', 'frame-2', 'frame-3', 'frame-4', 'frame-5', 'frame-4', 'frame-3', 'frame-2', 'frame-1'],
  );
  const pingPongLoop = domain.createSpriteSheetSequence(frameMap, {
    start: 0, end: 4, fps: 10, loop: true, mode: 'ping-pong',
  });
  assert.deepEqual(
    pingPongLoop.frames.map(frame => frame.frameId),
    ['frame-1', 'frame-2', 'frame-3', 'frame-4', 'frame-5', 'frame-4', 'frame-3', 'frame-2'],
    'loop avoids duplicating either cycle boundary',
  );
  const reordered = domain.reorderSpriteSheetSequence(forward, 4, 1);
  assert.deepEqual(reordered.frames.map(frame => frame.frameId), ['frame-1', 'frame-5', 'frame-2', 'frame-3', 'frame-4']);
  assert.deepEqual(forward.frames.map(frame => frame.frameId), ['frame-1', 'frame-2', 'frame-3', 'frame-4', 'frame-5']);
  const ranged = domain.createSpriteSheetSequence(frameMap, {
    start: 5, end: 9, fps: 10, loop: false, mode: 'forward',
  });
  assert.deepEqual(ranged.frames.map(frame => frame.frameId), ['frame-6', 'frame-7', 'frame-8', 'frame-9', 'frame-10']);
  assert.throws(
    () => domain.buildSpriteSheetSchedule(forward, { duration: 0.1, frameRate: 30 }),
    error => error.code === 'E_SPRITESHEET_TIMELINE_BUDGET',
  );
  assert.throws(
    () => domain.createSpriteSheetSequence(frameMap, {
      start: 0, end: 4, fps: 10, loop: false, mode: 'forward', durations: [0.1],
    }),
    error => error.code === 'E_SPRITESHEET_FRAME_DURATION',
  );
});

test('Step UV generation is frame-snapped, one-resource, save/reopen identity-stable and exact after compile', () => {
  const fixture = spriteProject({ duration: 2, frameRate: 30 });
  const frameMap = fiveByFive();
  const sequence = domain.createSpriteSheetSequence(frameMap, {
    start: 0, end: 24, fps: 12, loop: true, mode: 'forward',
  });
  const first = domain.generateSpriteSheetProjectAnimation(
    fixture.project, fixture.node.id, fixture.component.id, frameMap, sequence,
  );
  const track = first.project.timeline.tracks.find(candidate => candidate.id === first.trackId);
  assert.ok(track);
  assert.ok(track.keyframes.every(key => key.interpolation === 'step'));
  assert.ok(track.keyframes.every(key => Number.isInteger(key.time * 30)));
  assert.equal(first.project.composition.endBehavior, 'loop');

  const reopened = parseAnimationEditorProject(JSON.parse(serializeAnimationEditorProject(first.project)));
  const regenerated = domain.generateSpriteSheetProjectAnimation(
    reopened, fixture.node.id, fixture.component.id, frameMap, sequence,
  );
  const regeneratedTrack = regenerated.project.timeline.tracks.find(candidate => candidate.id === regenerated.trackId);
  assert.deepEqual(
    regeneratedTrack.keyframes.map(key => [key.id, key.time, key.value, key.interpolation]),
    track.keyframes.map(key => [key.id, key.time, key.value, key.interpolation]),
  );

  const compilation = compileAnimationEditorProject(regenerated.project);
  assert.equal(compilation.parsed.resources.length, 1);
  assert.equal(compilation.parsed.resources[0].id, 'atlas');
  const delivered = compilation.document.nodes[0].components[0].uvRectTrack;
  assert.equal(delivered.interpolation, 'step');
  assert.deepEqual(delivered.times, track.keyframes.map(key => key.time));
  assert.deepEqual(delivered.values, track.keyframes.flatMap(key => key.value));
});

test('rotated/trimmed atlas records stay source-neutral and fail explicitly when lowering to HYA', () => {
  const parsed = domain.parseSpriteSheetAtlasJson({
    frames: {
      rotated: { frame: { x: 0, y: 0, w: 16, h: 16 }, rotated: true },
      trimmed: {
        frame: { x: 16, y: 0, w: 12, h: 12 }, trimmed: true,
        spriteSourceSize: { x: 2, y: 2, w: 12, h: 12 }, sourceSize: { w: 16, h: 16 },
      },
    },
    meta: { size: { w: 32, h: 16 } },
  }, 'atlas');
  assert.ok(parsed.frameMap);
  assert.equal(parsed.frameMap.frames[0].rotated, true);
  assert.equal(parsed.frameMap.frames[1].trimmed, true);
  const fixture = spriteProject({ duration: 1, frameRate: 30, width: 32, height: 16 });
  const rotatedSequence = domain.createSpriteSheetSequence(parsed.frameMap, {
    start: 0, end: 0, fps: 10, loop: false, mode: 'forward',
  });
  assert.throws(
    () => domain.generateSpriteSheetProjectAnimation(
      fixture.project, fixture.node.id, fixture.component.id, parsed.frameMap, rotatedSequence,
    ),
    error => error.code === 'E_SPRITESHEET_FRAME_ROTATED',
  );
});

test('resource replacement/deletion preserve identity and reject broken references or frame bounds', () => {
  const fixture = spriteProject({ duration: 1, frameRate: 30 });
  const frameMap = fiveByFive();
  const replacement = imageAsset('replacement', 92, 92, 'replacement.png');
  const replaced = domain.replaceSpriteSheetImageAsset(fixture.project, 'atlas', replacement, frameMap);
  assert.equal(replaced.assets[0].id, 'atlas');
  assert.equal(replaced.assets[0].delivery.uri, 'replacement.png');
  assert.equal(fixture.project.assets[0].delivery.uri, 'atlas.png');
  assert.throws(
    () => domain.replaceSpriteSheetImageAsset(fixture.project, 'atlas', imageAsset('small', 32, 32, 'small.png'), frameMap),
    error => error.code === 'E_SPRITESHEET_FRAME_BOUNDS',
  );
  assert.deepEqual(domain.spriteSheetAssetReferences(fixture.project, 'atlas'), [
    { nodeId: fixture.node.id, componentId: fixture.component.id, field: 'resource' },
  ]);
  assert.throws(
    () => domain.deleteSpriteSheetImageAsset(fixture.project, 'atlas'),
    error => error.code === 'E_SPRITESHEET_ASSET_REFERENCE',
  );
  const detached = cloneAnimationEditorProject(fixture.project);
  detached.nodes.length = 0;
  assert.equal(domain.deleteSpriteSheetImageAsset(detached, 'atlas').assets.length, 0);
});

test('decoded atlas lifecycle rejects late replacement results and never creates per-frame resources', async () => {
  const pending = [];
  const closed = [];
  const session = new SpriteSheetResourceSession({
    load(source, signal) {
      return new Promise(resolve => pending.push({ source, signal, resolve }));
    },
  });
  const first = session.replace('first');
  const second = session.replace('second');
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(decoded('second', closed));
  assert.equal((await second).source, 'second');
  pending[0].resolve(decoded('first', closed));
  assert.equal(await first, null);
  assert.deepEqual(closed, ['first']);
  assert.deepEqual(session.metrics, {
    loadRequests: 2,
    successfulLoads: 1,
    abortedLoads: 1,
    staleLoads: 1,
    disposedImages: 1,
    liveImages: 1,
    peakLiveImages: 1,
    perFrameResources: 0,
  });
  const rejected = session.replace('wrong-size', image => {
    assert.equal(image.width, 32);
    throw new Error('dimension mismatch');
  });
  pending[2].resolve({ source: 'wrong-size', width: 32, height: 32, close: () => closed.push('wrong-size') });
  await assert.rejects(rejected, /dimension mismatch/);
  assert.equal(session.image.source, 'second', 'a rejected replacement keeps the previous decoded image active');
  assert.deepEqual(closed, ['first', 'wrong-size']);
  session.dispose();
  session.dispose();
  assert.deepEqual(closed, ['first', 'wrong-size', 'second']);
  assert.equal(session.metrics.liveImages, 0);
  assert.equal(session.metrics.disposedImages, 3);
});

function fiveByFive() {
  return domain.createRegularSpriteSheetFrameMap('atlas', 92, 92, {
    columns: 5, rows: 5, margin: 2, spacing: 2,
  });
}

function spriteProject({ duration, frameRate, width = 92, height = 92 }) {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration, frameRate }));
  project.assets.push(imageAsset('atlas', width, height, 'atlas.png'));
  const node = createBasicAnimationNode(project, 'sprite', { imageAssetId: 'atlas' });
  project.nodes.push(node);
  return { project, node, component: node.components[0] };
}

function imageAsset(id, width, height, uri) {
  return {
    id, name: `${id}.png`, type: 'image',
    source: { kind: 'external', uri },
    delivery: { uri, mimeType: 'image/png', width, height, colorSpace: 'srgb' },
  };
}

function decoded(name, closed) {
  return { source: name, width: 92, height: 92, close: () => closed.push(name) };
}
