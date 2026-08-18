import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  AnimationEditorStore,
  CommandHistory,
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  createBasicAnimationNode,
  createCoreTransformTrack,
  createEmptyAnimationEditorProject,
  createTimelineClip,
  createTimelineKeyframe,
  parseAnimationEditorProject,
  sampleAnimationEditorTrack,
  serializeAnimationEditorProject,
} from '../dist-test/testing.js';

const {
  TimelineGestureTransaction,
  TimelinePlaybackController,
  applyTimelineAutoKey,
  applyTimelineEasingPreset,
  applyTimelineViewportGizmo2D,
  applyTimelineViewportGizmo3D,
  buildTimelineMotionPath,
  buildTimelineValueCurve,
  computeVisibleTimelineKeyframes,
  moveTimelineMotionPathKey,
  planTimelineEdit,
  resolveTimelineSnap,
  sampleTimelineCurrentValues,
  selectTimelineKeyframesInRect,
  setTimelineClipRange,
  setTimelineEasingHandle,
  setTimelineKeyframeChannelValue,
  setTimelineSpatialHandle,
  timelineEasingHandles,
} = await import('../dist-test/timeline-production.js');

test('multi-track dope-sheet selection, move, copy, scale, align and distribute stay frame-normalized', () => {
  const project = multiTrackProject();
  const view = { timeStart: 0, timeEnd: 3, trackStart: 0, trackEnd: 2, width: 600, laneHeight: 30 };
  const marquee = selectTimelineKeyframesInRect(project, view, {
    left: 190, top: 0, right: 210, bottom: 60,
  });
  assert.deepEqual(marquee.map(reference => reference.keyframeId), ['position-1', 'opacity-1']);

  const moved = planTimelineEdit(project, marquee, { kind: 'move', deltaTime: 0.51 });
  assert.equal(moved.valid, true);
  assert.deepEqual(moved.targets.map(target => target.targetTime), [91 / 60, 91 / 60]);
  assert.deepEqual(moved.project.timeline.tracks.map(track => track.keyframes[1].time), [91 / 60, 91 / 60]);

  const copied = planTimelineEdit(project, marquee, { kind: 'copy', deltaTime: 0.51 });
  assert.equal(copied.valid, true);
  assert.deepEqual(copied.selection.map(reference => reference.keyframeId), ['position-1-copy', 'opacity-1-copy']);
  assert.deepEqual(copied.project.timeline.tracks.map(track => track.keyframes.length), [4, 4]);

  const scaled = planTimelineEdit(project, [
    { trackId: 'position', keyframeId: 'position-1' },
    { trackId: 'position', keyframeId: 'position-2' },
  ], { kind: 'scale', anchorTime: 0, scale: 0.5 });
  assert.equal(scaled.valid, true);
  assert.deepEqual(scaled.targets.map(target => target.targetTime), [0.5, 1]);

  const aligned = planTimelineEdit(project, marquee, { kind: 'align', time: 0.25 });
  assert.equal(aligned.valid, true);
  assert.deepEqual(aligned.targets.map(target => target.targetTime), [0.25, 0.25]);

  const distributed = planTimelineEdit(project, [
    { trackId: 'position', keyframeId: 'position-0' },
    { trackId: 'opacity', keyframeId: 'opacity-1' },
    { trackId: 'position', keyframeId: 'position-2' },
  ], { kind: 'distribute', startTime: 0, endTime: 3 });
  assert.equal(distributed.valid, true);
  assert.deepEqual(distributed.targets.map(target => target.targetTime), [0, 1.5, 3]);
  for (const target of distributed.targets) assert.equal(target.targetTime * project.composition.frameRate % 1, 0);
});

test('collision previews do not mutate projects and a gesture commits one undoable transaction', () => {
  const project = multiTrackProject();
  const reference = [{ trackId: 'position', keyframeId: 'position-1' }];
  const collision = planTimelineEdit(project, reference, { kind: 'move', deltaTime: 1 });
  assert.equal(collision.valid, false);
  assert.equal(collision.collisions[0].occupiedBy, 'position-2');
  assert.deepEqual(project.timeline.tracks[0].keyframes.map(keyframe => keyframe.time), [0, 1, 2]);

  const store = new AnimationEditorStore(project);
  const history = new CommandHistory();
  const gesture = new TimelineGestureTransaction(store.project, reference);
  gesture.preview({ kind: 'move', deltaTime: 0.25 });
  gesture.preview({ kind: 'move', deltaTime: 0.5 });
  assert.equal(store.revision, 0, 'pointer previews must not publish project revisions');
  assert.equal(gesture.commit(store, history, 'Move selected keys'), true);
  assert.equal(store.revision, 1);
  assert.equal(history.undoLabel, 'Move selected keys');
  assert.equal(store.project.timeline.tracks[0].keyframes[1].time, 1.5);
  assert.equal(history.undo(), 'Move selected keys');
  assert.equal(store.project.timeline.tracks[0].keyframes[1].time, 1);
  assert.equal(history.redo(), 'Move selected keys');
  assert.equal(store.project.timeline.tracks[0].keyframes[1].time, 1.5);

  const cancelled = new TimelineGestureTransaction(store.project, reference);
  cancelled.preview({ kind: 'move', deltaTime: -0.5 });
  const beforeCancel = store.project;
  assert.deepEqual(cancelled.cancel(), beforeCancel);
  assert.equal(store.project, beforeCancel);

  const stale = new TimelineGestureTransaction(store.project, reference);
  stale.preview({ kind: 'move', deltaTime: -0.25 });
  store.update('project-close-replacement', draft => { draft.name = 'Replacement'; });
  assert.equal(stale.commit(store, history, 'Stale edit'), false, 'late gestures cannot write into a replaced project');

  const detached = new TimelineGestureTransaction(store.project, reference);
  detached.preview({ kind: 'move', deltaTime: -0.25 });
  const replacement = { ...store.project, name: 'Second replacement' };
  assert.equal(detached.complete(replacement), null, 'adapter transactions also reject replaced projects');
  assert.equal(detached.state, 'cancelled');
});

test('snap candidates include frame, key, clip, marker and work-area boundaries', () => {
  const project = multiTrackProject();
  project.timeline.clips.push(createTimelineClip(project, 0.5));
  const marker = { id: 'beat', name: 'Beat', time: 1.25 };
  const result = resolveTimelineSnap(project, 1.249, {
    pixelsPerSecond: 200,
    thresholdPixels: 8,
    markers: [marker],
    workArea: { start: 0.25, end: 2.5 },
  });
  assert.equal(result.point.kind, 'marker');
  assert.equal(result.time, 1.25);
  assert.equal(resolveTimelineSnap(project, 2.499, {
    pixelsPerSecond: 200, thresholdPixels: 8, workArea: { start: 0.25, end: 2.5 },
  }).point.kind, 'work-end');
});

test('graph curves, easing presets, unified/broken handles and numeric values share the canonical sampler', () => {
  let project = multiTrackProject();
  const reference = { trackId: 'position', keyframeId: 'position-1' };
  project = applyTimelineEasingPreset(project, [reference], 'ease-in-out');
  assert.equal(project.timeline.tracks[0].keyframes[1].interpolation, 'cubic-bezier');
  project = setTimelineEasingHandle(project, reference, 'outgoing', [0.3, 0.2], 'unified');
  const handles = timelineEasingHandles(project.timeline.tracks[0], reference.keyframeId);
  assert.deepEqual(handles.outgoing, [0.3, 0.2]);
  assert.deepEqual(handles.incoming, [0.7, 0.8]);

  project = setTimelineEasingHandle(project, reference, 'outgoing', [0.4, 0.1], 'broken');
  assert.deepEqual(timelineEasingHandles(project.timeline.tracks[0], reference.keyframeId).incoming, [0.7, 0.8]);
  project = setTimelineKeyframeChannelValue(project, reference, 0, 125);
  const track = project.timeline.tracks[0];
  const view = { timeStart: 0, timeEnd: 3, valueMin: 0, valueMax: 300, width: 600, height: 300, samples: 121 };
  const curve = buildTimelineValueCurve(track, 0, view);
  const curveAtMidpoint = curve.points.find(point => Math.abs(point.time - 1.5) < 1e-8);
  assert.ok(curveAtMidpoint);
  assert.ok(Math.abs(curveAtMidpoint.value - sampleAnimationEditorTrack(track, 1.5)[0]) < 1e-9);
  assert.equal(curve.keyframes.find(keyframe => keyframe.keyframeId === reference.keyframeId).value, 125);
});

test('auto-key, sampled current values, work area, loop, markers and clip ranges use frame time', () => {
  let project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 3, frameRate: 30 }));
  const node = createBasicAnimationNode(project, 'rectangle');
  node.transform.position = [10, 20];
  project.nodes.push(node);

  const staticEdit = applyTimelineAutoKey(project, {
    nodeId: node.id, property: 'position', time: 0.48, value: [20, 30], enabled: false,
  });
  assert.equal(staticEdit.keyframe, null);
  assert.deepEqual(staticEdit.project.nodes[0].transform.position, [20, 30]);

  const first = applyTimelineAutoKey(staticEdit.project, {
    nodeId: node.id, property: 'position', time: 0.48, value: [30, 40], enabled: true,
  });
  assert.equal(first.project.timeline.tracks.length, 1);
  assert.equal(first.project.timeline.tracks[0].keyframes[0].time, 14 / 30);
  const second = applyTimelineAutoKey(first.project, {
    nodeId: node.id, property: 'position', time: 1.01, value: [90, 100], enabled: true,
  });
  assert.equal(second.project.timeline.tracks[0].keyframes[1].time, 1);
  const sampled = sampleTimelineCurrentValues(second.project, 0.73)[second.animatedTrackId];
  assert.ok(Math.abs(sampled[0] - 60) < 1e-9 && Math.abs(sampled[1] - 70) < 1e-9);

  const playback = new TimelinePlaybackController(3, 30, 0);
  assert.deepEqual(playback.setWorkArea(0.24, 1.26), { start: 7 / 30, end: 38 / 30 });
  playback.setLoop(true);
  playback.seek(37 / 30);
  assert.equal(playback.advance(2 / 30), 8 / 30);
  assert.equal(playback.addMarker({ id: 'beat', name: 'Beat', time: 0.49 }).time, 15 / 30);
  assert.equal(playback.moveMarker('beat', 0.76).time, 23 / 30);
  assert.equal(playback.removeMarker('beat'), true);

  project = second.project;
  project = cloneAnimationEditorProject(project);
  project.timeline.clips.push(createTimelineClip(project, 0));
  const ranged = setTimelineClipRange(project, project.timeline.clips[0].id, 0.26, 1.02);
  assert.deepEqual([ranged.timeline.clips[0].start, ranged.timeline.clips[0].duration], [8 / 30, 31 / 30]);
});

test('2D motion paths/spatial handles and G01-native 3D gizmos edit source-neutral transforms', () => {
  let project = multiTrackProject();
  let track = project.timeline.tracks[0];
  project = setTimelineSpatialHandle(project, { trackId: track.id, keyframeId: 'position-1' }, 'outgoing', [20, -10], 'unified');
  track = project.timeline.tracks[0];
  assert.deepEqual(track.keyframes[1].spatialOut, [20, -10]);
  assert.deepEqual(track.keyframes[1].spatialIn, [-20, 10]);
  const path = buildTimelineMotionPath(track, project.composition.frameRate, 0, 2, 2);
  assert.equal(path.points.length, 241);
  assert.ok(path.points.some(point => point.position[1] !== point.position[0]));

  project = moveTimelineMotionPathKey(project, { trackId: track.id, keyframeId: 'position-1' }, [150, 75]);
  assert.deepEqual(project.timeline.tracks[0].keyframes[1].value, [150, 75]);
  const moved2d = applyTimelineViewportGizmo2D(project, 'rectangle', 'translate', [10, 15], 1, true);
  assert.deepEqual(moved2d.project.timeline.tracks[0].keyframes[1].value, [160, 90]);

  const mode3d = { kind: '3d', handedness: 'right', upAxis: '+y', forwardAxis: '-z', unit: 'meter' };
  let transform = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
  transform = applyTimelineViewportGizmo3D(transform, mode3d, {
    tool: 'translate', axis: 'y', deltaPixels: [0, -100], pixelsPerUnit: 100,
  });
  assert.deepEqual(transform.translation, [0, 1, 0]);
  transform = applyTimelineViewportGizmo3D(transform, mode3d, {
    tool: 'rotate', axis: 'z', deltaPixels: [90, 0], radiansPerPixel: Math.PI / 180,
  });
  assert.ok(Math.abs(Math.hypot(...transform.rotation) - 1) < 1e-12);
  transform = applyTimelineViewportGizmo3D(transform, mode3d, {
    tool: 'scale', axis: 'uniform', deltaPixels: [20, -20],
  });
  assert.ok(transform.scale.every(value => value > 1));
});

test('Tween save/reopen/export preserves key identity and exact compiled key samples', () => {
  let project = multiTrackProject();
  const plan = planTimelineEdit(project, [
    { trackId: 'position', keyframeId: 'position-1' },
    { trackId: 'opacity', keyframeId: 'opacity-1' },
  ], { kind: 'move', deltaTime: 0.5 });
  assert.equal(plan.valid, true);
  project = plan.project;
  project = applyTimelineEasingPreset(project, [{ trackId: 'position', keyframeId: 'position-0' }], 'ease');
  const reopened = parseAnimationEditorProject(JSON.parse(serializeAnimationEditorProject(project)));
  assert.deepEqual(
    reopened.timeline.tracks.map(track => track.keyframes.map(keyframe => [keyframe.id, keyframe.time, keyframe.value])),
    project.timeline.tracks.map(track => track.keyframes.map(keyframe => [keyframe.id, keyframe.time, keyframe.value])),
  );
  const compilation = compileAnimationEditorProject(reopened);
  const source = reopened.timeline.tracks[0];
  const delivered = compilation.parsed.tracks.find(track => track.node === 'rectangle' && track.property === 'position');
  assert.ok(delivered);
  for (const keyframe of source.keyframes) {
    const index = [...delivered.times].findIndex(time => Math.abs(time - keyframe.time) < 1e-6);
    assert.notEqual(index, -1);
    assert.deepEqual([...delivered.values.slice(index * 2, index * 2 + 2)], keyframe.value);
    assert.deepEqual(sampleAnimationEditorTrack(source, keyframe.time), keyframe.value);
  }
});

test('10,000-key scrub, visible selection and drag planning remain below the 50 ms candidate budget', () => {
  const project = tenThousandKeyProject();
  const timings = {};
  let start = performance.now();
  const sampled = sampleTimelineCurrentValues(project, 83.333);
  timings.scrub = performance.now() - start;
  assert.equal(Object.keys(sampled).length, 1);

  const view = { timeStart: 80, timeEnd: 82, trackStart: 0, trackEnd: 1, width: 800, laneHeight: 30 };
  start = performance.now();
  const visible = computeVisibleTimelineKeyframes(project, view);
  const selection = selectTimelineKeyframesInRect(project, view, { left: 0, top: 0, right: 800, bottom: 30 });
  timings.selection = performance.now() - start;
  assert.ok(visible.length < 200, `virtualized surface rendered ${visible.length} keys`);
  assert.equal(selection.length, visible.filter(keyframe => keyframe.x >= 0 && keyframe.x <= 800).length);

  start = performance.now();
  const plan = planTimelineEdit(project, selection.slice(0, 60), { kind: 'move', deltaTime: 0.25 });
  timings.drag = performance.now() - start;
  assert.equal(plan.valid, false, 'dense-key drag exposes conflicts without mutating or compiling');
  const worst = Math.max(...Object.values(timings));
  console.log(`[g02-budget] 10k keys scrub=${timings.scrub.toFixed(2)}ms selection=${timings.selection.toFixed(2)}ms drag=${timings.drag.toFixed(2)}ms`);
  assert.ok(worst < 50, `candidate long-task budget exceeded: ${JSON.stringify(timings)}`);
});

function multiTrackProject() {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 3, frameRate: 60 }));
  const node = createBasicAnimationNode(project, 'rectangle');
  node.id = 'rectangle';
  node.name = 'Rectangle';
  node.transform.position = [0, 0];
  node.transform.opacity = 0;
  project.nodes.push(node);
  const position = createCoreTransformTrack(project, node.id, 'position', 0);
  position.id = 'position';
  position.keyframes[0].id = 'position-0';
  position.keyframes[0].value = [0, 0];
  position.keyframes.push(
    { id: 'position-1', time: 1, value: [100, 50], interpolation: 'linear' },
    { id: 'position-2', time: 2, value: [200, 200], interpolation: 'linear' },
  );
  project.timeline.tracks.push(position);
  const opacity = createCoreTransformTrack(project, node.id, 'opacity', 0);
  opacity.id = 'opacity';
  opacity.keyframes[0].id = 'opacity-0';
  opacity.keyframes[0].value = [0];
  opacity.keyframes.push(
    { id: 'opacity-1', time: 1, value: [0.5], interpolation: 'linear' },
    { id: 'opacity-2', time: 2, value: [1], interpolation: 'linear' },
  );
  project.timeline.tracks.push(opacity);
  return project;
}

function tenThousandKeyProject() {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 200, frameRate: 60 }));
  const node = createBasicAnimationNode(project, 'rectangle');
  node.id = 'rectangle';
  project.nodes.push(node);
  const track = createCoreTransformTrack(project, node.id, 'opacity', 0);
  track.id = 'opacity-10k';
  track.keyframes = Array.from({ length: 10_000 }, (_unused, index) => ({
    id: `key-${index}`,
    time: index / 60,
    value: [index / 10_000],
    interpolation: 'linear',
  }));
  project.timeline.tracks.push(track);
  return project;
}
