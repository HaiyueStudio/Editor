import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorKeyframe,
  type AnimationEditorProject,
  type AnimationEditorTrack,
  type DeepMutable,
} from './AnimationEditorProject';
import { sampleAnimationEditorTrack, type TimelineKeyframeReference } from './TimelineAuthoring';
import type {
  TimelineCurvePoint,
  TimelineCurveView,
  TimelineEasingHandles,
  TimelineTangentMode,
  TimelineValueCurve,
} from './TimelineProductionTypes';

export const TIMELINE_EASING_PRESETS = Object.freeze({
  linear: Object.freeze([0, 0, 1, 1] as const),
  ease: Object.freeze([0.25, 0.1, 0.25, 1] as const),
  'ease-in': Object.freeze([0.42, 0, 1, 1] as const),
  'ease-out': Object.freeze([0, 0, 0.58, 1] as const),
  'ease-in-out': Object.freeze([0.42, 0, 0.58, 1] as const),
});

export type TimelineEasingPreset = keyof typeof TIMELINE_EASING_PRESETS;

export function applyTimelineEasingPreset(
  project: AnimationEditorProject,
  references: readonly TimelineKeyframeReference[],
  preset: TimelineEasingPreset,
): AnimationEditorProject {
  const easing = TIMELINE_EASING_PRESETS[preset];
  const draft = cloneAnimationEditorProject(project);
  for (const reference of references) {
    const track = requiredMutableTrack(draft, reference.trackId);
    const keyframe = requiredMutableKeyframe(track, reference.keyframeId);
    if (preset === 'linear') {
      keyframe.interpolation = 'linear';
      delete keyframe.easing;
    } else {
      keyframe.interpolation = 'cubic-bezier';
      keyframe.easing = [...easing];
    }
  }
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function setTimelineEasingHandle(
  project: AnimationEditorProject,
  reference: TimelineKeyframeReference,
  handle: 'incoming' | 'outgoing',
  point: readonly [number, number],
  mode: TimelineTangentMode,
): AnimationEditorProject {
  const draft = cloneAnimationEditorProject(project);
  const track = requiredMutableTrack(draft, reference.trackId);
  const index = track.keyframes.findIndex(keyframe => keyframe.id === reference.keyframeId);
  if (index < 0) throw new Error(`Unknown keyframe "${reference.keyframeId}".`);
  const value = [clampUnit(point[0]), clampUnit(point[1])] as [number, number];
  if (handle === 'outgoing') {
    if (index >= track.keyframes.length - 1) throw new Error('The final keyframe has no outgoing easing handle.');
    const current = track.keyframes[index]!;
    const easing = current.easing ?? [0.25, 0.1, 0.25, 1];
    current.interpolation = 'cubic-bezier';
    current.easing = [value[0], value[1], easing[2], easing[3]];
    if (mode === 'unified' && index > 0) {
      const previous = track.keyframes[index - 1]!;
      const previousEasing = previous.easing ?? [0.25, 0.1, 0.25, 1];
      previous.interpolation = 'cubic-bezier';
      previous.easing = [previousEasing[0], previousEasing[1], 1 - value[0], 1 - value[1]];
    }
  } else {
    if (index === 0) throw new Error('The first keyframe has no incoming easing handle.');
    const previous = track.keyframes[index - 1]!;
    const previousEasing = previous.easing ?? [0.25, 0.1, 0.25, 1];
    previous.interpolation = 'cubic-bezier';
    previous.easing = [previousEasing[0], previousEasing[1], value[0], value[1]];
    if (mode === 'unified' && index < track.keyframes.length - 1) {
      const current = track.keyframes[index]!;
      const currentEasing = current.easing ?? [0.25, 0.1, 0.25, 1];
      current.interpolation = 'cubic-bezier';
      current.easing = [1 - value[0], 1 - value[1], currentEasing[2], currentEasing[3]];
    }
  }
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function timelineEasingHandles(
  track: AnimationEditorTrack,
  keyframeId: string,
): TimelineEasingHandles {
  const index = track.keyframes.findIndex(keyframe => keyframe.id === keyframeId);
  if (index < 0) throw new Error(`Unknown keyframe "${keyframeId}".`);
  const previous = index > 0 ? track.keyframes[index - 1] : undefined;
  const current = track.keyframes[index];
  return Object.freeze({
    keyframeId,
    incoming: previous?.interpolation === 'cubic-bezier'
      ? Object.freeze([previous.easing?.[2] ?? 1, previous.easing?.[3] ?? 1] as const)
      : null,
    outgoing: index < track.keyframes.length - 1 && current?.interpolation === 'cubic-bezier'
      ? Object.freeze([current.easing?.[0] ?? 0, current.easing?.[1] ?? 0] as const)
      : null,
  });
}

export function setTimelineKeyframeChannelValue(
  project: AnimationEditorProject,
  reference: TimelineKeyframeReference,
  channel: number,
  value: number,
): AnimationEditorProject {
  if (!Number.isFinite(value)) throw new Error('Timeline channel value must be finite.');
  const draft = cloneAnimationEditorProject(project);
  const track = requiredMutableTrack(draft, reference.trackId);
  if (!Number.isSafeInteger(channel) || channel < 0 || channel >= track.valueSize) {
    throw new Error(`Channel ${channel} is outside valueSize ${track.valueSize}.`);
  }
  requiredMutableKeyframe(track, reference.keyframeId).value[channel] = value;
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function buildTimelineValueCurve(
  track: AnimationEditorTrack,
  channel: number,
  view: TimelineCurveView,
): TimelineValueCurve {
  if (!Number.isSafeInteger(channel) || channel < 0 || channel >= track.valueSize) {
    throw new Error(`Channel ${channel} is outside valueSize ${track.valueSize}.`);
  }
  const timeSpan = Math.max(Number.EPSILON, view.timeEnd - view.timeStart);
  const valueSpan = Math.max(Number.EPSILON, view.valueMax - view.valueMin);
  const samples = clampInteger(view.samples ?? Math.ceil(view.width / 3), 2, 4096);
  const point = (time: number, value: number): TimelineCurvePoint => Object.freeze({
    time,
    value,
    x: (time - view.timeStart) / timeSpan * view.width,
    y: view.height - (value - view.valueMin) / valueSpan * view.height,
  });
  const points: TimelineCurvePoint[] = [];
  for (let index = 0; index < samples; index++) {
    const time = view.timeStart + index / (samples - 1) * timeSpan;
    points.push(point(time, sampleAnimationEditorTrack(track, time)[channel]!));
  }
  const keyframes = track.keyframes
    .filter(keyframe => keyframe.time >= view.timeStart && keyframe.time <= view.timeEnd)
    .map(keyframe => Object.freeze({
      ...point(keyframe.time, keyframe.value[channel]!),
      keyframeId: keyframe.id,
    }));
  return Object.freeze({
    trackId: track.id,
    channel,
    points: Object.freeze(points),
    keyframes: Object.freeze(keyframes),
  });
}

function requiredMutableTrack(
  project: DeepMutable<AnimationEditorProject>,
  trackId: string,
): DeepMutable<AnimationEditorTrack> {
  const track = project.timeline.tracks.find(candidate => candidate.id === trackId);
  if (!track) throw new Error(`Unknown track "${trackId}".`);
  return track;
}

function requiredMutableKeyframe(
  track: DeepMutable<AnimationEditorTrack>,
  keyframeId: string,
): DeepMutable<AnimationEditorKeyframe> {
  const keyframe = track.keyframes.find(candidate => candidate.id === keyframeId);
  if (!keyframe) throw new Error(`Unknown keyframe "${keyframeId}".`);
  return keyframe;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
