import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorKeyframe,
  type AnimationEditorProject,
  type AnimationEditorTrack,
  type DeepMutable,
} from './AnimationEditorProject';
import { sampleAnimationEditorTrack, type TimelineKeyframeReference } from './TimelineAuthoring';
import { applyTimelineAutoKey } from './TimelinePlaybackAuthoring';
import type {
  TimelineAutoKeyResult,
  TimelineGizmo3DOperation,
  TimelineMotionPath,
  TimelineMotionPathKey,
  TimelineMotionPathPoint,
  TimelineTangentMode,
  TimelineTransform3D,
  TimelineViewportCoordinateMode,
} from './TimelineProductionTypes';

export function buildTimelineMotionPath(
  track: AnimationEditorTrack,
  frameRate: number,
  start = track.keyframes[0]?.time ?? 0,
  end = track.keyframes.at(-1)?.time ?? start,
  samplesPerFrame = 1,
): TimelineMotionPath {
  if (track.target.kind !== 'node-transform' || track.target.property !== 'position' || track.valueSize !== 2) {
    throw new Error('Motion paths require a 2D position track.');
  }
  const first = Math.min(start, end);
  const last = Math.max(start, end);
  const sampleCount = clampInteger(Math.ceil((last - first) * frameRate * Math.max(1, samplesPerFrame)) + 1, 1, 4096);
  const points: TimelineMotionPathPoint[] = [];
  for (let index = 0; index < sampleCount; index++) {
    const time = sampleCount === 1 ? first : first + index / (sampleCount - 1) * (last - first);
    const value = sampleAnimationEditorTrack(track, time);
    points.push(Object.freeze({ time, position: Object.freeze([value[0]!, value[1]!] as const) }));
  }
  const keys: TimelineMotionPathKey[] = track.keyframes.map(keyframe => Object.freeze({
    keyframeId: keyframe.id,
    time: keyframe.time,
    position: Object.freeze([keyframe.value[0]!, keyframe.value[1]!] as const),
    spatialIn: keyframe.spatialIn ? Object.freeze([...keyframe.spatialIn] as [number, number]) : null,
    spatialOut: keyframe.spatialOut ? Object.freeze([...keyframe.spatialOut] as [number, number]) : null,
  }));
  return Object.freeze({ trackId: track.id, points: Object.freeze(points), keys: Object.freeze(keys) });
}

export function setTimelineSpatialHandle(
  project: AnimationEditorProject,
  reference: TimelineKeyframeReference,
  handle: 'incoming' | 'outgoing',
  value: readonly [number, number],
  mode: TimelineTangentMode,
): AnimationEditorProject {
  if (value.some(component => !Number.isFinite(component))) throw new Error('Spatial handle values must be finite.');
  const draft = cloneAnimationEditorProject(project);
  const track = requiredMutableTrack(draft, reference.trackId);
  if (track.target.kind !== 'node-transform' || track.target.property !== 'position' || track.valueSize !== 2) {
    throw new Error('Spatial handles require a 2D position track.');
  }
  const keyframe = requiredMutableKeyframe(track, reference.keyframeId);
  if (handle === 'incoming') {
    keyframe.spatialIn = [...value];
    if (mode === 'unified') keyframe.spatialOut = [-value[0], -value[1]];
  } else {
    keyframe.spatialOut = [...value];
    if (mode === 'unified') keyframe.spatialIn = [-value[0], -value[1]];
  }
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function moveTimelineMotionPathKey(
  project: AnimationEditorProject,
  reference: TimelineKeyframeReference,
  position: readonly [number, number],
): AnimationEditorProject {
  if (position.some(component => !Number.isFinite(component))) throw new Error('Motion path position must be finite.');
  const draft = cloneAnimationEditorProject(project);
  const track = requiredMutableTrack(draft, reference.trackId);
  if (track.target.kind !== 'node-transform' || track.target.property !== 'position' || track.valueSize !== 2) {
    throw new Error('Motion path keys require a 2D position track.');
  }
  requiredMutableKeyframe(track, reference.keyframeId).value = [...position];
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function applyTimelineViewportGizmo2D(
  project: AnimationEditorProject,
  nodeId: string,
  tool: 'translate' | 'rotate' | 'scale',
  delta: readonly [number, number],
  time: number,
  autoKey: boolean,
): TimelineAutoKeyResult {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown node "${nodeId}".`);
  if (tool === 'translate') {
    const track = project.timeline.tracks.find(candidate => candidate.target.kind === 'node-transform'
      && candidate.target.nodeId === nodeId && candidate.target.property === 'position');
    const current = track ? sampleAnimationEditorTrack(track, time) : [...(node.transform.position ?? [0, 0])];
    return applyTimelineAutoKey(project, {
      nodeId, property: 'position', time, enabled: autoKey,
      value: [current[0]! + delta[0], current[1]! + delta[1]],
    });
  }
  if (tool === 'rotate') {
    const track = project.timeline.tracks.find(candidate => candidate.target.kind === 'node-transform'
      && candidate.target.nodeId === nodeId && candidate.target.property === 'rotation');
    const current = track ? sampleAnimationEditorTrack(track, time)[0]! : node.transform.rotation ?? 0;
    return applyTimelineAutoKey(project, {
      nodeId, property: 'rotation', time, enabled: autoKey, value: [current + delta[0]],
    });
  }
  const track = project.timeline.tracks.find(candidate => candidate.target.kind === 'node-transform'
    && candidate.target.nodeId === nodeId && candidate.target.property === 'scale');
  const current = track ? sampleAnimationEditorTrack(track, time) : [...(node.transform.scale ?? [1, 1])];
  const multiplier = Math.exp((delta[0] - delta[1]) / 200);
  return applyTimelineAutoKey(project, {
    nodeId, property: 'scale', time, enabled: autoKey,
    value: [Math.max(1e-6, current[0]! * multiplier), Math.max(1e-6, current[1]! * multiplier)],
  });
}

export function applyTimelineViewportGizmo3D(
  transform: TimelineTransform3D,
  mode: TimelineViewportCoordinateMode,
  operation: TimelineGizmo3DOperation,
): TimelineTransform3D {
  if (mode.kind !== '3d' || mode.handedness !== 'right' || mode.upAxis !== '+y'
    || mode.forwardAxis !== '-z' || mode.unit !== 'meter') {
    throw new Error('Native 3D gizmos require the G01 right-handed +Y-up -Z-forward meter contract.');
  }
  const [dx, dy] = operation.deltaPixels;
  const translation = [...transform.translation] as [number, number, number];
  const rotation = [...transform.rotation] as [number, number, number, number];
  const scale = [...transform.scale] as [number, number, number];
  if (operation.tool === 'translate') {
    const distance = operation.axis === 'x' ? dx : -dy;
    const amount = distance / Math.max(1e-6, operation.pixelsPerUnit ?? 100);
    if (operation.axis === 'x') translation[0] += amount;
    else if (operation.axis === 'y') translation[1] += amount;
    else if (operation.axis === 'z') translation[2] -= amount;
    else {
      translation[0] += dx / Math.max(1e-6, operation.pixelsPerUnit ?? 100);
      translation[1] -= dy / Math.max(1e-6, operation.pixelsPerUnit ?? 100);
    }
  } else if (operation.tool === 'scale') {
    const multiplier = Math.exp((dx - dy) / 200);
    const indices = operation.axis === 'uniform' ? [0, 1, 2] : [{ x: 0, y: 1, z: 2 }[operation.axis]];
    for (const index of indices) scale[index] = Math.max(1e-6, scale[index]! * multiplier);
  } else {
    const axis = operation.axis === 'uniform' ? 'y' : operation.axis;
    const angle = (dx - dy) * (operation.radiansPerPixel ?? Math.PI / 360);
    const half = angle / 2;
    const sine = Math.sin(half);
    const delta: [number, number, number, number] = [
      axis === 'x' ? sine : 0,
      axis === 'y' ? sine : 0,
      axis === 'z' ? sine : 0,
      Math.cos(half),
    ];
    const combined = operation.space === 'world'
      ? multiplyQuaternion(delta, rotation)
      : multiplyQuaternion(rotation, delta);
    rotation.splice(0, 4, ...normalizeQuaternion(combined));
  }
  return Object.freeze({
    translation: Object.freeze(translation),
    rotation: Object.freeze(rotation),
    scale: Object.freeze(scale),
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

function multiplyQuaternion(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): [number, number, number, number] {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
}

function normalizeQuaternion(value: readonly [number, number, number, number]): [number, number, number, number] {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length <= 1e-8) return [0, 0, 0, 1];
  return value.map(component => component / length) as [number, number, number, number];
}
