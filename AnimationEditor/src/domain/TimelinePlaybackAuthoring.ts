import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorProject,
  type DeepMutable,
} from './AnimationEditorProject';
import {
  createCoreTransformTrack,
  createTimelineKeyframe,
  sampleAnimationEditorTrack,
  snapTimelineTime,
} from './TimelineAuthoring';
import type {
  TimelineAutoKeyEdit,
  TimelineAutoKeyResult,
  TimelineMarker,
  TimelineWorkArea,
} from './TimelineProductionTypes';

export function applyTimelineAutoKey(
  project: AnimationEditorProject,
  edit: TimelineAutoKeyEdit,
): TimelineAutoKeyResult {
  const draft = cloneAnimationEditorProject(project);
  const node = draft.nodes.find(candidate => candidate.id === edit.nodeId);
  if (!node) throw new Error(`Unknown node "${edit.nodeId}".`);
  const expectedSize = edit.property === 'position' || edit.property === 'scale' ? 2 : 1;
  if (edit.value.length !== expectedSize || edit.value.some(value => !Number.isFinite(value))) {
    throw new Error(`${edit.property} requires ${expectedSize} finite value(s).`);
  }
  let track = draft.timeline.tracks.find(candidate => candidate.target.kind === 'node-transform'
    && candidate.target.nodeId === edit.nodeId && candidate.target.property === edit.property);
  if (!edit.enabled) {
    assignStaticTransform(node, edit.property, edit.value);
    const sampledValue = track ? sampleAnimationEditorTrack(track, edit.time) : [...edit.value];
    return Object.freeze({
      project: freezeAnimationEditorProject(draft as AnimationEditorProject),
      keyframe: null,
      sampledValue: Object.freeze(sampledValue),
      animatedTrackId: track?.id ?? null,
    });
  }
  if (!track) {
    track = createCoreTransformTrack(draft, edit.nodeId, edit.property, edit.time);
    draft.timeline.tracks.push(track);
  }
  const keyframe = createTimelineKeyframe(draft, track.id, edit.time, edit.value);
  const frozen = freezeAnimationEditorProject(draft as AnimationEditorProject);
  return Object.freeze({
    project: frozen,
    keyframe: Object.freeze({ trackId: track.id, keyframeId: keyframe.id }),
    sampledValue: Object.freeze([...keyframe.value]),
    animatedTrackId: track.id,
  });
}

export function sampleTimelineCurrentValues(
  project: AnimationEditorProject,
  time: number,
): Readonly<Record<string, readonly number[]>> {
  const normalized = snapTimelineTime(time, project.composition.frameRate, project.composition.duration);
  return Object.freeze(Object.fromEntries(project.timeline.tracks.map(track => [
    track.id,
    Object.freeze(sampleAnimationEditorTrack(track, normalized)),
  ])));
}

export class TimelinePlaybackController {
  private readonly _duration: number;
  private readonly _frameRate: number;
  private _time: number;
  private _workArea: TimelineWorkArea;
  private _loop = false;
  private readonly _markers = new Map<string, TimelineMarker>();

  constructor(duration: number, frameRate: number, time = 0) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Timeline duration must be positive.');
    if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error('Timeline frame rate must be positive.');
    this._duration = duration;
    this._frameRate = frameRate;
    this._time = this._snap(time);
    this._workArea = Object.freeze({ start: 0, end: this._snap(duration) });
  }

  get time(): number { return this._time; }
  get workArea(): TimelineWorkArea { return this._workArea; }
  get loop(): boolean { return this._loop; }
  get markers(): readonly TimelineMarker[] { return Object.freeze([...this._markers.values()].sort((a, b) => a.time - b.time)); }

  setLoop(loop: boolean): void { this._loop = loop; }

  setWorkArea(start: number, end: number): TimelineWorkArea {
    const first = this._snap(Math.min(start, end));
    const last = this._snap(Math.max(start, end));
    if (last - first < 1 / this._frameRate - 1e-9) throw new Error('Work area must span at least one frame.');
    this._workArea = Object.freeze({ start: first, end: last });
    this._time = Math.max(first, Math.min(last, this._time));
    return this._workArea;
  }

  seek(time: number): number {
    this._time = this._snap(time);
    return this._time;
  }

  advance(seconds: number): number {
    if (!Number.isFinite(seconds)) return this._time;
    const { start, end } = this._workArea;
    let next = this._time + seconds;
    if (this._loop) {
      const span = end - start;
      if (span > 0) next = start + modulo(next - start, span);
    } else next = Math.max(start, Math.min(end, next));
    this._time = this._snap(next);
    return this._time;
  }

  addMarker(marker: Omit<TimelineMarker, 'time'> & { readonly time: number }): TimelineMarker {
    const id = marker.id.trim();
    if (!id) throw new Error('Timeline marker id is required.');
    if (this._markers.has(id)) throw new Error(`Timeline marker "${id}" already exists.`);
    const value = Object.freeze({ ...marker, id, name: marker.name.trim() || id, time: this._snap(marker.time) });
    this._markers.set(id, value);
    return value;
  }

  moveMarker(id: string, time: number): TimelineMarker {
    const marker = this._markers.get(id);
    if (!marker) throw new Error(`Unknown timeline marker "${id}".`);
    const next = Object.freeze({ ...marker, time: this._snap(time) });
    this._markers.set(id, next);
    return next;
  }

  removeMarker(id: string): boolean { return this._markers.delete(id); }

  private _snap(time: number): number { return snapTimelineTime(time, this._frameRate, this._duration); }
}

export function setTimelineClipRange(
  project: AnimationEditorProject,
  clipId: string,
  start: number,
  duration: number,
): AnimationEditorProject {
  const draft = cloneAnimationEditorProject(project);
  const clip = draft.timeline.clips.find(candidate => candidate.id === clipId);
  if (!clip) throw new Error(`Unknown clip "${clipId}".`);
  const frame = 1 / draft.composition.frameRate;
  const nextStart = snapTimelineTime(start, draft.composition.frameRate, draft.composition.duration);
  const requestedEnd = snapTimelineTime(nextStart + Math.max(frame, duration), draft.composition.frameRate, draft.composition.duration);
  clip.start = Math.min(nextStart, Math.max(0, draft.composition.duration - frame));
  clip.duration = Math.max(frame, requestedEnd - clip.start);
  if (clip.start + clip.duration > draft.composition.duration) clip.duration = draft.composition.duration - clip.start;
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

function assignStaticTransform(
  node: DeepMutable<AnimationEditorProject>['nodes'][number],
  property: TimelineAutoKeyEdit['property'],
  value: readonly number[],
): void {
  if (property === 'position') node.transform.position = [value[0]!, value[1]!];
  else if (property === 'scale') node.transform.scale = [value[0]!, value[1]!];
  else if (property === 'rotation') node.transform.rotation = value[0]!;
  else node.transform.opacity = value[0]!;
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
