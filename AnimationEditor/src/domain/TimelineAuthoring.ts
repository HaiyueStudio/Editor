import type {
  AnimationEditorClip,
  AnimationEditorKeyframe,
  AnimationEditorNode,
  AnimationEditorProject,
  AnimationEditorTrack,
  DeepMutable,
} from './AnimationEditorProject';
import { advancedTrackValueLabels, isStepOnlyAdvancedTrack } from './AdvancedContentAuthoring';

export type CoreTransformProperty = 'position' | 'rotation' | 'scale' | 'opacity';

export interface TimelineKeyframeReference {
  readonly trackId: string;
  readonly keyframeId: string;
}

const PROPERTY_DEFINITIONS: Readonly<Record<CoreTransformProperty, Readonly<{
  label: string;
  valueSize: 1 | 2;
  color: string;
}>>> = Object.freeze({
  position: { label: 'Position', valueSize: 2, color: '#58a6ff' },
  rotation: { label: 'Rotation', valueSize: 1, color: '#f0883e' },
  scale: { label: 'Scale', valueSize: 2, color: '#a371f7' },
  opacity: { label: 'Opacity', valueSize: 1, color: '#3fb950' },
});

export const CORE_TRANSFORM_PROPERTIES = Object.freeze(
  Object.keys(PROPERTY_DEFINITIONS) as CoreTransformProperty[],
);

export function coreTransformPropertyLabel(property: CoreTransformProperty): string {
  return PROPERTY_DEFINITIONS[property].label;
}

export function availableCoreTransformProperties(
  project: AnimationEditorProject,
  nodeId: string,
): readonly CoreTransformProperty[] {
  const used = new Set(project.timeline.tracks.flatMap(track => (
    track.target.kind === 'node-transform' && track.target.nodeId === nodeId
      ? [track.target.property]
      : []
  )));
  return CORE_TRANSFORM_PROPERTIES.filter(property => !used.has(property));
}

export function createCoreTransformTrack(
  project: AnimationEditorProject,
  nodeId: string,
  property: CoreTransformProperty,
  time = project.editor?.timeline?.playhead ?? 0,
): DeepMutable<AnimationEditorTrack> {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown node "${nodeId}".`);
  if (!availableCoreTransformProperties(project, nodeId).includes(property)) {
    throw new Error(`${node.name} already has a ${PROPERTY_DEFINITIONS[property].label} track.`);
  }
  const definition = PROPERTY_DEFINITIONS[property];
  const id = uniqueId(
    `${node.id}-${property}`,
    new Set(project.timeline.tracks.map(track => track.id)),
  );
  const keyframeId = uniqueId(`${id}-key`, new Set());
  return {
    id,
    name: `${node.name} · ${definition.label}`,
    target: { kind: 'node-transform', nodeId, property },
    valueSize: definition.valueSize,
    enabled: true,
    color: definition.color,
    keyframes: [{
      id: keyframeId,
      time: snapTimelineTime(time, project.composition.frameRate, project.composition.duration),
      value: staticTransformValue(node, property),
      interpolation: 'linear',
    }],
  };
}

/** Inserts a keyframe sampled from the current curve. An existing key at the same frame is reused. */
export function createTimelineKeyframe(
  project: DeepMutable<AnimationEditorProject>,
  trackId: string,
  time: number,
  value?: readonly number[],
): DeepMutable<AnimationEditorKeyframe> {
  const track = findTrack(project, trackId);
  const snapped = snapTimelineTime(time, project.composition.frameRate, project.composition.duration);
  const existing = track.keyframes.find(keyframe => sameFrame(
    keyframe.time,
    snapped,
    project.composition.frameRate,
  ));
  if (existing) {
    if (value) existing.value = normalizeValue(value, track.valueSize);
    return existing;
  }
  const sampled = value
    ? normalizeValue(value, track.valueSize)
    : sampleAnimationEditorTrack(track, snapped);
  const keyframe: DeepMutable<AnimationEditorKeyframe> = {
    id: uniqueId(`${track.id}-key`, new Set(track.keyframes.map(candidate => candidate.id))),
    time: snapped,
    value: sampled,
    interpolation: isStepOnlyAdvancedTrack(track) ? 'step' : 'linear',
  };
  track.keyframes.push(keyframe);
  track.keyframes.sort((left, right) => left.time - right.time);
  return keyframe;
}

export function moveTimelineKeyframe(
  project: DeepMutable<AnimationEditorProject>,
  trackId: string,
  keyframeId: string,
  time: number,
): boolean {
  const track = findTrack(project, trackId);
  const keyframe = track.keyframes.find(candidate => candidate.id === keyframeId);
  if (!keyframe) throw new Error(`Unknown keyframe "${keyframeId}".`);
  const snapped = snapTimelineTime(time, project.composition.frameRate, project.composition.duration);
  if (track.keyframes.some(candidate => (
    candidate.id !== keyframeId
    && sameFrame(candidate.time, snapped, project.composition.frameRate)
  ))) return false;
  if (keyframe.time === snapped) return false;
  keyframe.time = snapped;
  track.keyframes.sort((left, right) => left.time - right.time);
  return true;
}

export function deleteTimelineKeyframes(
  project: DeepMutable<AnimationEditorProject>,
  references: readonly TimelineKeyframeReference[],
): number {
  const byTrack = new Map<string, Set<string>>();
  for (const reference of references) {
    const ids = byTrack.get(reference.trackId) ?? new Set<string>();
    ids.add(reference.keyframeId);
    byTrack.set(reference.trackId, ids);
  }
  let deleted = 0;
  for (const track of project.timeline.tracks) {
    const ids = byTrack.get(track.id);
    if (!ids) continue;
    const next = track.keyframes.filter(keyframe => !ids.has(keyframe.id));
    // A project track always owns at least one keyframe. Delete the track explicitly
    // when its final keyframe is no longer needed.
    if (next.length === 0) continue;
    deleted += track.keyframes.length - next.length;
    track.keyframes = next;
  }
  return deleted;
}

export function deleteTimelineTracks(
  project: DeepMutable<AnimationEditorProject>,
  trackIds: readonly string[],
): number {
  const ids = new Set(trackIds);
  const previous = project.timeline.tracks.length;
  project.timeline.tracks = project.timeline.tracks.filter(track => !ids.has(track.id));
  return previous - project.timeline.tracks.length;
}

export function createTimelineClip(
  project: AnimationEditorProject,
  time = project.editor?.timeline?.playhead ?? 0,
): DeepMutable<AnimationEditorClip> {
  const frame = Math.min(project.composition.duration, 1 / project.composition.frameRate);
  let start = snapTimelineTime(time, project.composition.frameRate, project.composition.duration);
  if (start >= project.composition.duration) start = Math.max(0, project.composition.duration - frame);
  const duration = Math.max(frame, project.composition.duration - start);
  const existing = new Set(project.timeline.clips.map(clip => clip.id));
  const id = uniqueId('clip', existing);
  const index = project.timeline.clips.length;
  const palette = ['#3fb950', '#58a6ff', '#a371f7', '#f0883e'] as const;
  return {
    id,
    name: `Clip ${index + 1}`,
    start,
    duration: Math.min(duration, project.composition.duration - start),
    color: palette[index % palette.length]!,
  };
}

export function deleteTimelineClips(
  project: DeepMutable<AnimationEditorProject>,
  clipIds: readonly string[],
): number {
  const ids = new Set(clipIds);
  const previous = project.timeline.clips.length;
  project.timeline.clips = project.timeline.clips.filter(clip => !ids.has(clip.id));
  return previous - project.timeline.clips.length;
}

export function sampleAnimationEditorTrack(
  track: AnimationEditorTrack,
  time: number,
): number[] {
  const keyframes = track.keyframes;
  if (time <= keyframes[0]!.time) return [...keyframes[0]!.value];
  if (time >= keyframes[keyframes.length - 1]!.time) return [...keyframes[keyframes.length - 1]!.value];
  let index = 0;
  while (index + 1 < keyframes.length && time >= keyframes[index + 1]!.time) index++;
  const start = keyframes[index]!;
  const end = keyframes[index + 1]!;
  if (start.interpolation === 'step') return [...start.value];
  const linearProgress = (time - start.time) / (end.time - start.time);
  const progress = start.interpolation === 'cubic-bezier'
    ? cubicBezierProgress(linearProgress, start.easing ?? [0, 0, 1, 1])
    : linearProgress;
  if (track.target.kind === 'node-transform'
    && track.target.property === 'position'
    && track.valueSize === 2
    && (start.spatialOut || end.spatialIn)) {
    const startValue = start.value as readonly [number, number];
    const endValue = end.value as readonly [number, number];
    const outgoing = start.spatialOut ?? [0, 0];
    const incoming = end.spatialIn ?? [0, 0];
    return [0, 1].map(component => cubicPoint(
      startValue[component]!,
      startValue[component]! + outgoing[component]!,
      endValue[component]! + incoming[component]!,
      endValue[component]!,
      progress,
    ));
  }
  return start.value.map((value, component) => (
    value + (end.value[component]! - value) * progress
  ));
}

export function snapTimelineTime(time: number, frameRate: number, duration: number): number {
  const safe = Number.isFinite(time) ? time : 0;
  const snapped = Math.round(Math.max(0, Math.min(duration, safe)) * frameRate) / frameRate;
  return Math.min(duration, snapped);
}

export function timelineTrackValueLabels(track: AnimationEditorTrack): readonly string[] {
  if (track.target.kind === 'node-transform') {
    if (track.target.property === 'position' || track.target.property === 'scale') return ['X', 'Y'];
    if (track.target.property === 'rotation') return ['Degrees'];
    if (track.target.property === 'opacity') return ['Value'];
  }
  const advanced = advancedTrackValueLabels(track);
  if (advanced) return advanced;
  return Array.from({ length: track.valueSize }, (_unused, index) => `Value ${index + 1}`);
}

function staticTransformValue(node: AnimationEditorNode, property: CoreTransformProperty): number[] {
  if (property === 'position') return [...(node.transform.position ?? [0, 0])];
  if (property === 'scale') return [...(node.transform.scale ?? [1, 1])];
  if (property === 'rotation') return [node.transform.rotation ?? 0];
  return [node.transform.opacity ?? 1];
}

function findTrack(
  project: DeepMutable<AnimationEditorProject>,
  trackId: string,
): DeepMutable<AnimationEditorTrack> {
  const track = project.timeline.tracks.find(candidate => candidate.id === trackId);
  if (!track) throw new Error(`Unknown track "${trackId}".`);
  return track;
}

function normalizeValue(value: readonly number[], size: number): number[] {
  if (value.length !== size || value.some(component => !Number.isFinite(component))) {
    throw new Error(`Keyframe value must contain ${size} finite number(s).`);
  }
  return [...value];
}

function sameFrame(left: number, right: number, frameRate: number): boolean {
  return Math.round(left * frameRate) === Math.round(right * frameRate);
}

function uniqueId(base: string, existing: ReadonlySet<string>): string {
  const normalized = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'timeline-item';
  if (!existing.has(normalized)) return normalized;
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix++) {
    const candidate = `${normalized}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate an id for "${normalized}".`);
}

function cubicPoint(start: number, control1: number, control2: number, end: number, time: number): number {
  const inverse = 1 - time;
  return inverse ** 3 * start
    + 3 * inverse ** 2 * time * control1
    + 3 * inverse * time ** 2 * control2
    + time ** 3 * end;
}

function cubicBezierProgress(time: number, easing: readonly [number, number, number, number]): number {
  const [x1, y1, x2, y2] = easing;
  let lower = 0;
  let upper = 1;
  let parameter = time;
  for (let iteration = 0; iteration < 18; iteration++) {
    parameter = (lower + upper) / 2;
    const x = cubicPoint(0, x1, x2, 1, parameter);
    if (x < time) lower = parameter;
    else upper = parameter;
  }
  return cubicPoint(0, y1, y2, 1, parameter);
}
