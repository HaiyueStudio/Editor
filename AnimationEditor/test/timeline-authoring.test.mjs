import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableCoreTransformProperties,
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  createBasicAnimationNode,
  createCoreTransformTrack,
  createEmptyAnimationEditorProject,
  createTimelineClip,
  createTimelineKeyframe,
  deleteTimelineClips,
  deleteTimelineKeyframes,
  deleteTimelineTracks,
  moveTimelineKeyframe,
  parseAnimationEditorProject,
  sampleAnimationEditorTrack,
  serializeAnimationEditorProject,
  snapTimelineTime,
} from '../dist-test/testing.js';

test('core transform tracks start from the selected node static value and compile to HYA', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2, frameRate: 30 }));
  const node = createBasicAnimationNode(project, 'rectangle');
  node.transform.position = [120, 80];
  project.nodes.push(node);

  const track = createCoreTransformTrack(project, node.id, 'position', 0.22);
  project.timeline.tracks.push(track);

  assert.equal(track.id, 'rectangle-position');
  assert.equal(track.keyframes[0].time, 7 / 30);
  assert.deepEqual(track.keyframes[0].value, [120, 80]);
  assert.deepEqual(availableCoreTransformProperties(project, node.id), ['rotation', 'scale', 'opacity']);
  const compilation = compileAnimationEditorProject(project);
  assert.equal(compilation.parsed.tracks[0].node, node.id);
  assert.deepEqual([...compilation.parsed.tracks[0].values], [120, 80]);
});

test('keyframes are sampled, frame-snapped, moved without collisions and kept in order', () => {
  const project = animatedProject();
  const track = project.timeline.tracks[0];
  track.keyframes[0].value = [0, 0];
  createTimelineKeyframe(project, track.id, 1, [100, 50]);
  const middle = createTimelineKeyframe(project, track.id, 0.5);

  assert.deepEqual(middle.value, [50, 25]);
  assert.deepEqual(track.keyframes.map(keyframe => keyframe.time), [0, 0.5, 1]);
  assert.equal(moveTimelineKeyframe(project, track.id, middle.id, 0.76), true);
  assert.equal(middle.time, 23 / 30);
  assert.equal(moveTimelineKeyframe(project, track.id, middle.id, 1), false);
  assert.equal(snapTimelineTime(0.049, 30, 2), 1 / 30);
});

test('step, temporal cubic and spatial curves sample using authoring semantics', () => {
  const project = animatedProject();
  const track = project.timeline.tracks[0];
  track.keyframes[0].value = [0, 0];
  track.keyframes[0].interpolation = 'step';
  createTimelineKeyframe(project, track.id, 1, [100, 100]);
  assert.deepEqual(sampleAnimationEditorTrack(track, 0.9), [0, 0]);

  track.keyframes[0].interpolation = 'cubic-bezier';
  track.keyframes[0].easing = [0.42, 0, 0.58, 1];
  track.keyframes[0].spatialOut = [0, 100];
  track.keyframes[1].spatialIn = [0, -100];
  const value = sampleAnimationEditorTrack(track, 0.5);
  assert.ok(Math.abs(value[0] - 50) < 0.01);
  assert.ok(value[1] > 49 && value[1] < 51);
});

test('track and keyframe deletion preserves the one-key invariant while explicit track deletion removes it', () => {
  const project = animatedProject();
  const track = project.timeline.tracks[0];
  const second = createTimelineKeyframe(project, track.id, 1, [20, 30]);

  assert.equal(deleteTimelineKeyframes(project, [{ trackId: track.id, keyframeId: second.id }]), 1);
  assert.equal(deleteTimelineKeyframes(project, [{ trackId: track.id, keyframeId: track.keyframes[0].id }]), 0);
  assert.equal(track.keyframes.length, 1);
  assert.equal(deleteTimelineTracks(project, [track.id]), 1);
  assert.equal(project.timeline.tracks.length, 0);
});

test('named clips are bounded, editable project data with stable ids', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2, frameRate: 30 }));
  const first = createTimelineClip(project, 0.5);
  project.timeline.clips.push(first);
  const second = createTimelineClip(project, 2);
  project.timeline.clips.push(second);

  assert.deepEqual([first.start, first.duration], [0.5, 1.5]);
  assert.equal(second.id, 'clip-2');
  assert.equal(second.start, 2 - 1 / 30);
  assert.ok(Math.abs(second.duration - 1 / 30) < 1e-12);
  assert.equal(deleteTimelineClips(project, [first.id]), 1);
  const reopened = parseAnimationEditorProject(JSON.parse(serializeAnimationEditorProject(project)));
  assert.equal(reopened.timeline.clips[0].id, second.id);
});

function animatedProject() {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2, frameRate: 30 }));
  const node = createBasicAnimationNode(project, 'rectangle');
  project.nodes.push(node);
  project.timeline.tracks.push(createCoreTransformTrack(project, node.id, 'position', 0));
  return project;
}
