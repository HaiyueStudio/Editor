import {
  animationEditorProjectSnapshotKey,
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorKeyframe,
  type AnimationEditorProject,
  type AnimationEditorTrack,
  type DeepMutable,
} from './AnimationEditorProject';
import { AnimationEditorStore } from './AnimationEditorStore';
import { CommandHistory, type EditorCommand } from './CommandHistory';
import { snapTimelineTime, type TimelineKeyframeReference } from './TimelineAuthoring';
import type {
  TimelineBatchOperation,
  TimelineCollision,
  TimelineEditPlan,
  TimelineEditTarget,
  TimelineRect,
  TimelineSelectionMode,
  TimelineSnapOptions,
  TimelineSnapPoint,
  TimelineSnapResult,
  TimelineViewportWindow,
  VisibleTimelineKeyframe,
} from './TimelineProductionTypes';

export function computeVisibleTimelineKeyframes(
  project: AnimationEditorProject,
  viewport: TimelineViewportWindow,
): readonly VisibleTimelineKeyframe[] {
  const frameRate = project.composition.frameRate;
  const overscan = Math.max(0, viewport.overscanFrames ?? 1) / frameRate;
  const start = Math.max(0, viewport.timeStart - overscan);
  const end = Math.min(project.composition.duration, viewport.timeEnd + overscan);
  const trackStart = clampInteger(viewport.trackStart, 0, project.timeline.tracks.length);
  const trackEnd = clampInteger(viewport.trackEnd, trackStart, project.timeline.tracks.length);
  const duration = Math.max(Number.EPSILON, viewport.timeEnd - viewport.timeStart);
  const result: VisibleTimelineKeyframe[] = [];
  for (let trackIndex = trackStart; trackIndex < trackEnd; trackIndex++) {
    const track = project.timeline.tracks[trackIndex]!;
    const first = lowerBound(track.keyframes, start);
    const afterLast = upperBound(track.keyframes, end);
    for (let index = first; index < afterLast; index++) {
      const keyframe = track.keyframes[index]!;
      result.push(Object.freeze({
        trackId: track.id,
        keyframeId: keyframe.id,
        trackIndex,
        time: keyframe.time,
        x: (keyframe.time - viewport.timeStart) / duration * viewport.width,
        y: (trackIndex - viewport.trackStart + 0.5) * viewport.laneHeight,
      }));
    }
  }
  return Object.freeze(result);
}

export function selectTimelineKeyframesInRect(
  project: AnimationEditorProject,
  viewport: TimelineViewportWindow,
  rect: TimelineRect,
  current: readonly TimelineKeyframeReference[] = [],
  mode: TimelineSelectionMode = 'replace',
): readonly TimelineKeyframeReference[] {
  const normalized = normalizeRect(rect);
  const hits = computeVisibleTimelineKeyframes(project, viewport)
    .filter(keyframe => keyframe.x >= normalized.left && keyframe.x <= normalized.right
      && keyframe.y >= normalized.top && keyframe.y <= normalized.bottom)
    .map(keyframe => Object.freeze({ trackId: keyframe.trackId, keyframeId: keyframe.keyframeId }));
  const keyed = new Map(current.map(reference => [referenceKey(reference), Object.freeze({ ...reference })]));
  if (mode === 'replace') return Object.freeze(hits);
  for (const hit of hits) {
    const key = referenceKey(hit);
    if (mode === 'toggle' && keyed.has(key)) keyed.delete(key);
    else keyed.set(key, hit);
  }
  return Object.freeze([...keyed.values()]);
}

export function planTimelineEdit(
  project: AnimationEditorProject,
  references: readonly TimelineKeyframeReference[],
  operation: TimelineBatchOperation,
): TimelineEditPlan {
  const selected = resolveKeyframes(project, references);
  const frameRate = project.composition.frameRate;
  const targets = targetTimes(selected, operation).map(target => Object.freeze({
    trackId: target.track.id,
    keyframeId: target.keyframe.id,
    sourceTime: target.keyframe.time,
    targetTime: snapTimelineTime(target.time, frameRate, project.composition.duration),
  }));
  const selectedIds = new Set(selected.map(entry => referenceKey({
    trackId: entry.track.id,
    keyframeId: entry.keyframe.id,
  })));
  const collisions = detectTimelineCollisions(project, targets, selectedIds, operation.kind === 'copy');
  if (collisions.length > 0) {
    return Object.freeze({
      valid: false,
      project,
      targets: Object.freeze(targets),
      selection: Object.freeze([...references]),
      collisions,
      operation,
    });
  }

  const draft = cloneAnimationEditorProject(project);
  const nextSelection: TimelineKeyframeReference[] = [];
  if (operation.kind === 'copy') {
    for (const target of targets) {
      const track = requiredMutableTrack(draft, target.trackId);
      const source = requiredMutableKeyframe(track, target.keyframeId);
      const id = uniqueKeyframeId(track, `${source.id}-copy`);
      track.keyframes.push({ ...structuredClone(source), id, time: target.targetTime });
      nextSelection.push(Object.freeze({ trackId: track.id, keyframeId: id }));
    }
  } else {
    for (const target of targets) {
      const track = requiredMutableTrack(draft, target.trackId);
      requiredMutableKeyframe(track, target.keyframeId).time = target.targetTime;
      nextSelection.push(Object.freeze({ trackId: track.id, keyframeId: target.keyframeId }));
    }
  }
  for (const track of draft.timeline.tracks) track.keyframes.sort(compareKeyframes);
  return Object.freeze({
    valid: true,
    project: freezeAnimationEditorProject(draft as AnimationEditorProject),
    targets: Object.freeze(targets),
    selection: Object.freeze(nextSelection),
    collisions: Object.freeze([]),
    operation,
  });
}

export class TimelineGestureTransaction {
  private readonly _before: AnimationEditorProject;
  private readonly _references: readonly TimelineKeyframeReference[];
  private _plan: TimelineEditPlan | null = null;
  private _state: 'active' | 'committed' | 'cancelled' = 'active';

  constructor(project: AnimationEditorProject, references: readonly TimelineKeyframeReference[]) {
    this._before = freezeAnimationEditorProject(project);
    this._references = Object.freeze(references.map(reference => Object.freeze({ ...reference })));
  }

  get state(): 'active' | 'committed' | 'cancelled' { return this._state; }
  get before(): AnimationEditorProject { return this._before; }
  get plan(): TimelineEditPlan | null { return this._plan; }

  preview(operation: TimelineBatchOperation): TimelineEditPlan {
    this._assertActive();
    this._plan = planTimelineEdit(this._before, this._references, operation);
    return this._plan;
  }

  complete(currentProject?: AnimationEditorProject): AnimationEditorProject | null {
    this._assertActive();
    if (currentProject && !sameProject(currentProject, this._before)) {
      this._state = 'cancelled';
      this._plan = null;
      return null;
    }
    if (!this._plan?.valid) return null;
    this._state = 'committed';
    return this._plan.project;
  }

  commit(store: AnimationEditorStore, history: CommandHistory, label: string): boolean {
    this._assertActive();
    if (!this._plan?.valid || !sameProject(store.project, this._before)) return false;
    const after = this._plan.project;
    const before = this._before;
    const estimatedBytes = (animationEditorProjectSnapshotKey(before).length
      + animationEditorProjectSnapshotKey(after).length) * 2;
    const command: EditorCommand = Object.freeze({
      label,
      estimatedBytes,
      execute: () => store.replaceProject(after, { reason: label }),
      undo: () => { store.replaceProject(before, { reason: `undo:${label}` }); },
    });
    const committed = history.execute(command);
    if (committed) this._state = 'committed';
    return committed;
  }

  cancel(): AnimationEditorProject {
    this._assertActive();
    this._state = 'cancelled';
    this._plan = null;
    return this._before;
  }

  private _assertActive(): void {
    if (this._state !== 'active') throw new Error(`Timeline gesture is already ${this._state}.`);
  }
}

export function resolveTimelineSnap(
  project: AnimationEditorProject,
  proposedTime: number,
  options: TimelineSnapOptions,
): TimelineSnapResult {
  if (!Number.isFinite(options.pixelsPerSecond) || options.pixelsPerSecond <= 0) {
    throw new Error('Timeline snap requires positive pixelsPerSecond.');
  }
  const snappedFrame = snapTimelineTime(proposedTime, project.composition.frameRate, project.composition.duration);
  const threshold = Math.max(0, options.thresholdPixels ?? 8);
  const excluded = new Set((options.exclude ?? []).map(referenceKey));
  const points: TimelineSnapPoint[] = [{ kind: 'frame', time: snappedFrame, label: 'Frame grid' }];
  for (const marker of options.markers ?? []) points.push({ kind: 'marker', time: marker.time, id: marker.id, label: marker.name });
  if (options.workArea) {
    points.push({ kind: 'work-start', time: options.workArea.start, label: 'Work area start' });
    points.push({ kind: 'work-end', time: options.workArea.end, label: 'Work area end' });
  }
  for (const clip of project.timeline.clips) {
    points.push({ kind: 'clip-start', time: clip.start, id: clip.id, label: clip.name });
    points.push({ kind: 'clip-end', time: clip.start + clip.duration, id: clip.id, label: clip.name });
  }
  for (const track of project.timeline.tracks) {
    for (const keyframe of track.keyframes) {
      if (!excluded.has(referenceKey({ trackId: track.id, keyframeId: keyframe.id }))) {
        points.push({ kind: 'keyframe', time: keyframe.time, id: `${track.id}:${keyframe.id}` });
      }
    }
  }
  let best: TimelineSnapPoint = points[0]!;
  let bestPixels = Math.abs(proposedTime - best.time) * options.pixelsPerSecond;
  for (const point of points.slice(1)) {
    const normalized = snapTimelineTime(point.time, project.composition.frameRate, project.composition.duration);
    const distancePixels = Math.abs(proposedTime - normalized) * options.pixelsPerSecond;
    if (distancePixels < bestPixels || (Math.abs(distancePixels - bestPixels) <= 1e-9 && point.kind !== 'frame')) {
      best = { ...point, time: normalized };
      bestPixels = distancePixels;
    }
  }
  if (bestPixels > threshold) {
    best = points[0]!;
    bestPixels = Math.abs(proposedTime - best.time) * options.pixelsPerSecond;
  }
  return Object.freeze({ time: best.time, point: Object.freeze(best), distancePixels: bestPixels });
}

interface ResolvedKeyframe {
  readonly track: AnimationEditorTrack;
  readonly keyframe: AnimationEditorKeyframe;
}

function targetTimes(
  selected: readonly ResolvedKeyframe[],
  operation: TimelineBatchOperation,
): readonly (ResolvedKeyframe & { readonly time: number })[] {
  if (selected.length === 0) return [];
  if (operation.kind === 'distribute') {
    const ordered = [...selected].sort((left, right) => left.keyframe.time - right.keyframe.time
      || left.track.id.localeCompare(right.track.id) || left.keyframe.id.localeCompare(right.keyframe.id));
    const start = operation.startTime ?? ordered[0]!.keyframe.time;
    const end = operation.endTime ?? ordered.at(-1)!.keyframe.time;
    return ordered.map((entry, index) => ({
      ...entry,
      time: ordered.length === 1 ? start : start + index / (ordered.length - 1) * (end - start),
    }));
  }
  return selected.map(entry => ({
    ...entry,
    time: operation.kind === 'move' || operation.kind === 'copy'
      ? entry.keyframe.time + operation.deltaTime
      : operation.kind === 'scale'
        ? operation.anchorTime + (entry.keyframe.time - operation.anchorTime) * operation.scale
        : operation.time,
  }));
}

function resolveKeyframes(
  project: AnimationEditorProject,
  references: readonly TimelineKeyframeReference[],
): readonly ResolvedKeyframe[] {
  const unique = new Set<string>();
  const result: ResolvedKeyframe[] = [];
  for (const reference of references) {
    const key = referenceKey(reference);
    if (unique.has(key)) continue;
    unique.add(key);
    const track = project.timeline.tracks.find(candidate => candidate.id === reference.trackId);
    const keyframe = track?.keyframes.find(candidate => candidate.id === reference.keyframeId);
    if (!track || !keyframe) throw new Error(`Unknown timeline keyframe "${reference.trackId}/${reference.keyframeId}".`);
    result.push({ track, keyframe });
  }
  return Object.freeze(result);
}

function detectTimelineCollisions(
  project: AnimationEditorProject,
  targets: readonly TimelineEditTarget[],
  selected: ReadonlySet<string>,
  copying: boolean,
): readonly TimelineCollision[] {
  const byTrackFrame = new Map<string, TimelineEditTarget[]>();
  const frameRate = project.composition.frameRate;
  for (const target of targets) {
    const frame = frameForTime(target.targetTime, frameRate);
    const key = `${target.trackId}\u0000${frame}`;
    const values = byTrackFrame.get(key) ?? [];
    values.push(target);
    byTrackFrame.set(key, values);
  }
  const collisions: TimelineCollision[] = [];
  for (const targetsAtFrame of byTrackFrame.values()) {
    const target = targetsAtFrame[0]!;
    const frame = frameForTime(target.targetTime, frameRate);
    const track = project.timeline.tracks.find(candidate => candidate.id === target.trackId)!;
    const occupied = track.keyframes.find(keyframe => frameForTime(keyframe.time, frameRate) === frame
      && (copying || !selected.has(referenceKey({ trackId: track.id, keyframeId: keyframe.id }))));
    if (targetsAtFrame.length > 1 || occupied) {
      collisions.push(Object.freeze({
        trackId: track.id,
        frame,
        time: target.targetTime,
        keyframeIds: Object.freeze(targetsAtFrame.map(entry => entry.keyframeId)),
        ...(occupied ? { occupiedBy: occupied.id } : {}),
      }));
    }
  }
  return Object.freeze(collisions);
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

function uniqueKeyframeId(track: DeepMutable<AnimationEditorTrack>, requested: string): string {
  const ids = new Set(track.keyframes.map(keyframe => keyframe.id));
  if (!ids.has(requested)) return requested;
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix++) {
    const candidate = `${requested}-${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  throw new Error('Unable to allocate copied keyframe id.');
}

function lowerBound(keyframes: readonly AnimationEditorKeyframe[], time: number): number {
  let low = 0;
  let high = keyframes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keyframes[middle]!.time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(keyframes: readonly AnimationEditorKeyframe[], time: number): number {
  let low = 0;
  let high = keyframes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keyframes[middle]!.time <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function normalizeRect(rect: TimelineRect): TimelineRect {
  return Object.freeze({
    left: Math.min(rect.left, rect.right),
    top: Math.min(rect.top, rect.bottom),
    right: Math.max(rect.left, rect.right),
    bottom: Math.max(rect.top, rect.bottom),
  });
}

function sameProject(left: AnimationEditorProject, right: AnimationEditorProject): boolean {
  return animationEditorProjectSnapshotKey(left) === animationEditorProjectSnapshotKey(right);
}

function referenceKey(reference: TimelineKeyframeReference): string { return `${reference.trackId}\u0000${reference.keyframeId}`; }
function frameForTime(time: number, frameRate: number): number { return Math.round(time * frameRate); }

function compareKeyframes(left: AnimationEditorKeyframe, right: AnimationEditorKeyframe): number {
  return left.time - right.time || left.id.localeCompare(right.id);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
