import type {
  AnimationStateMachineDefinition,
} from '@haiyue/extensions/animation';
import { validateAnimationStateMachineDefinition } from '@haiyue/extensions/animation';

export type AnimationStateMachineMotionDefinition =
  AnimationStateMachineDefinition['layers'][number]['states'][number]['motion'];
export type AnimationStateMachineParameterDefinition =
  AnimationStateMachineDefinition['parameters'][number];

export const ANIMATION_AUTHORING_FORMAT = 'haiyue-animation-authoring@1' as const;

export type AnimationAuthoringDimension = '2d' | '3d';
export type AnimationTimelineInterpolation = 'step' | 'linear' | 'cubic';

export interface AnimationSourceReference {
  readonly id: string;
  readonly name: string;
  readonly dimension: AnimationAuthoringDimension;
  readonly duration: number;
  /** Persistent editor asset id when this source was imported from a HYA file. */
  readonly assetId?: string;
}

export interface AnimationTimelineKeyframe {
  readonly id: string;
  readonly time: number;
  readonly value: readonly number[];
  readonly interpolation: AnimationTimelineInterpolation;
}

export interface AnimationTimelineTrack {
  readonly id: string;
  readonly name: string;
  readonly binding: string;
  readonly property: 'position' | 'rotation' | 'scale' | 'opacity' | 'morph-weights' | 'custom';
  readonly valueSize: number;
  readonly keyframes: readonly AnimationTimelineKeyframe[];
}

export interface AnimationTimelineClip {
  readonly id: string;
  readonly sourceId: string;
  readonly start: number;
  readonly duration: number;
  readonly sourceOffset: number;
  readonly speed: number;
  readonly lane: number;
}

export interface AnimationTimelineDefinition {
  readonly duration: number;
  readonly frameRate: number;
  readonly clips: readonly AnimationTimelineClip[];
  readonly tracks: readonly AnimationTimelineTrack[];
}

export interface AnimationAuthoringDocument {
  readonly format: typeof ANIMATION_AUTHORING_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly dimension: AnimationAuthoringDimension | 'mixed';
  readonly sources: readonly AnimationSourceReference[];
  readonly timeline: AnimationTimelineDefinition;
  readonly stateMachine: AnimationStateMachineDefinition;
}

export interface AnimationAuthoringIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface AnimationTimelineSample {
  readonly time: number;
  readonly activeClips: readonly Readonly<{
    clipId: string;
    sourceId: string;
    dimension: AnimationAuthoringDimension;
    localTime: number;
    lane: number;
  }>[];
  readonly values: Readonly<Record<string, readonly number[]>>;
}

export function createAnimationAuthoringDocument(
  options: { id?: string; name?: string; dimension?: AnimationAuthoringDimension | 'mixed' } = {},
): AnimationAuthoringDocument {
  const id = options.id ?? 'animation-controller';
  const name = options.name ?? 'Animation Controller';
  return freezeDocument({
    format: ANIMATION_AUTHORING_FORMAT,
    id,
    name,
    dimension: options.dimension ?? 'mixed',
    sources: [],
    timeline: { duration: 1, frameRate: 60, clips: [], tracks: [] },
    stateMachine: {
      format: 'haiyue-animation-state-machine@1',
      id: `${id}:state-machine`,
      name,
      parameters: [],
      layers: [],
    },
  });
}

export function validateAnimationAuthoringDocument(
  asset: AnimationAuthoringDocument,
): readonly AnimationAuthoringIssue[] {
  const issues: AnimationAuthoringIssue[] = [];
  const sourceById = new Map<string, AnimationSourceReference>();
  if (asset.format !== ANIMATION_AUTHORING_FORMAT) issue('invalid-format', 'format', 'Unsupported animation authoring format.');
  if (!asset.id.trim()) issue('invalid-value', 'id', 'Asset id must not be empty.');
  if (!(asset.timeline.duration > 0) || !Number.isFinite(asset.timeline.duration)) issue('invalid-value', 'timeline.duration', 'Timeline duration must be positive and finite.');
  if (!(asset.timeline.frameRate > 0) || !Number.isFinite(asset.timeline.frameRate)) issue('invalid-value', 'timeline.frameRate', 'Timeline frame rate must be positive and finite.');
  asset.sources.forEach((source, index) => {
    if (!source.id.trim()) issue('invalid-value', `sources[${index}].id`, 'Source id must not be empty.');
    else if (sourceById.has(source.id)) issue('duplicate-id', `sources[${index}].id`, `Duplicate source id "${source.id}".`);
    else sourceById.set(source.id, source);
    if (!(source.duration > 0) || !Number.isFinite(source.duration)) issue('invalid-value', `sources[${index}].duration`, 'Source duration must be positive and finite.');
    if (source.assetId !== undefined && !source.assetId.trim()) issue('invalid-value', `sources[${index}].assetId`, 'HYA asset id must not be empty.');
    if (asset.dimension !== 'mixed' && source.dimension !== asset.dimension) issue('dimension-mismatch', `sources[${index}].dimension`, `${source.dimension.toUpperCase()} source cannot be used by a ${asset.dimension.toUpperCase()} asset.`);
  });
  const ids = new Set<string>();
  asset.timeline.clips.forEach((clip, index) => {
    if (ids.has(clip.id)) issue('duplicate-id', `timeline.clips[${index}].id`, `Duplicate clip id "${clip.id}".`);
    ids.add(clip.id);
    if (!sourceById.has(clip.sourceId)) issue('missing-reference', `timeline.clips[${index}].sourceId`, `Unknown animation source "${clip.sourceId}".`);
    if (![clip.start, clip.duration, clip.sourceOffset, clip.speed].every(Number.isFinite) || clip.start < 0 || clip.duration <= 0 || clip.sourceOffset < 0 || clip.speed <= 0) {
      issue('invalid-value', `timeline.clips[${index}]`, 'Clip timing and speed must be finite, with positive duration/speed and non-negative offsets.');
    }
    if (!Number.isSafeInteger(clip.lane) || clip.lane < 0) issue('invalid-value', `timeline.clips[${index}].lane`, 'Clip lane must be a non-negative integer.');
  });
  asset.timeline.tracks.forEach((track, trackIndex) => {
    if (track.valueSize < 1 || !Number.isSafeInteger(track.valueSize)) issue('invalid-value', `timeline.tracks[${trackIndex}].valueSize`, 'Track value size must be a positive integer.');
    let previous = -Infinity;
    track.keyframes.forEach((keyframe, frameIndex) => {
      if (!Number.isFinite(keyframe.time) || keyframe.time < 0 || keyframe.time > asset.timeline.duration || keyframe.time <= previous) {
        issue('invalid-time', `timeline.tracks[${trackIndex}].keyframes[${frameIndex}].time`, 'Keyframe times must be strictly increasing and inside the timeline.');
      }
      previous = keyframe.time;
      if (keyframe.value.length !== track.valueSize || !keyframe.value.every(Number.isFinite)) issue('invalid-value', `timeline.tracks[${trackIndex}].keyframes[${frameIndex}].value`, `Expected ${track.valueSize} finite values.`);
    });
  });
  for (const stateIssue of validateAnimationStateMachineDefinition(asset.stateMachine)) {
    issues.push(Object.freeze({ ...stateIssue, path: `stateMachine.${stateIssue.path}` }));
  }
  visitStateMachineMotions(asset.stateMachine, (motion, path) => {
    if (motion.kind === 'clip' && !sourceById.has(motion.clipId)) issue('missing-reference', `stateMachine.${path}.clipId`, `Unknown animation source "${motion.clipId}".`);
  });
  return Object.freeze(issues);

  function issue(code: string, path: string, message: string): void {
    issues.push(Object.freeze({ code, path, message }));
  }
}

export function sampleAnimationTimeline(
  asset: AnimationAuthoringDocument,
  requestedTime: number,
): AnimationTimelineSample {
  const time = Math.min(asset.timeline.duration, Math.max(0, Number.isFinite(requestedTime) ? requestedTime : 0));
  const sourceById = new Map(asset.sources.map(source => [source.id, source]));
  const activeClips = asset.timeline.clips.flatMap(clip => {
    const source = sourceById.get(clip.sourceId);
    if (!source || time < clip.start || time > clip.start + clip.duration) return [];
    const localTime = Math.min(source.duration, clip.sourceOffset + (time - clip.start) * clip.speed);
    return [Object.freeze({ clipId: clip.id, sourceId: clip.sourceId, dimension: source.dimension, localTime, lane: clip.lane })];
  }).sort((a, b) => a.lane - b.lane || a.clipId.localeCompare(b.clipId));
  const values = Object.fromEntries(asset.timeline.tracks.map(track => [track.binding, sampleTrack(track, time)]));
  return Object.freeze({ time, activeClips: Object.freeze(activeClips), values: Object.freeze(values) });
}

export function createBlendTreeMotion(
  kind: 'blend-1d' | 'blend-2d',
  parameters: readonly AnimationStateMachineParameterDefinition[],
  clipIds: readonly string[],
): AnimationStateMachineMotionDefinition {
  const numeric = parameters.filter(parameter => parameter.type === 'float' || parameter.type === 'integer');
  if (numeric.length === 0) throw new RangeError('Blend Trees require at least one float or integer parameter.');
  if (clipIds.length === 0) throw new RangeError('Blend Trees require at least one clip source.');
  if (kind === 'blend-1d') {
    const denominator = Math.max(1, clipIds.length - 1);
    return Object.freeze({
      kind,
      parameter: numeric[0]!.name,
      children: Object.freeze(clipIds.map((clipId, index) => Object.freeze({
        threshold: index / denominator,
        motion: Object.freeze({ kind: 'clip' as const, clipId }),
      }))),
    });
  }
  if (numeric.length < 2) throw new RangeError('2D Blend Trees require two float or integer parameters.');
  return Object.freeze({
    kind,
    algorithm: 'cartesian' as const,
    parameterX: numeric[0]!.name,
    parameterY: numeric[1]!.name,
    children: Object.freeze(clipIds.map((clipId, index) => {
      const angle = index * Math.PI * 2 / clipIds.length;
      return Object.freeze({
        position: Object.freeze([Math.cos(angle), Math.sin(angle)]) as readonly [number, number],
        motion: Object.freeze({ kind: 'clip' as const, clipId }),
      });
    })),
  });
}

export function parseAnimationAuthoringDocument(source: string | unknown): AnimationAuthoringDocument {
  const value = typeof source === 'string' ? JSON.parse(source) : source;
  if (!value || typeof value !== 'object') throw new TypeError('Animation authoring asset must be an object.');
  const asset = value as AnimationAuthoringDocument;
  const issues = validateAnimationAuthoringDocument(asset);
  if (issues.length > 0) throw new TypeError(`Invalid animation authoring asset: ${issues[0]!.message} (${issues[0]!.path})`);
  return freezeDocument(structuredClone(asset));
}

function sampleTrack(track: AnimationTimelineTrack, time: number): readonly number[] {
  const frames = track.keyframes;
  if (frames.length === 0) return Object.freeze(Array.from({ length: track.valueSize }, () => 0));
  if (time <= frames[0]!.time) return frames[0]!.value;
  if (time >= frames.at(-1)!.time) return frames.at(-1)!.value;
  let index = 0;
  while (index + 1 < frames.length && frames[index + 1]!.time <= time) index++;
  const from = frames[index]!;
  const to = frames[index + 1]!;
  if (from.interpolation === 'step') return from.value;
  const linear = (time - from.time) / Math.max(1e-8, to.time - from.time);
  const factor = from.interpolation === 'cubic' ? linear * linear * (3 - 2 * linear) : linear;
  return Object.freeze(from.value.map((value, offset) => value + ((to.value[offset] ?? value) - value) * factor));
}

function visitStateMachineMotions(
  definition: AnimationStateMachineDefinition,
  visitor: (motion: AnimationStateMachineMotionDefinition, path: string) => void,
): void {
  const visit = (motion: AnimationStateMachineMotionDefinition, path: string): void => {
    visitor(motion, path);
    if (motion.kind === 'clip') return;
    motion.children.forEach((child, index) => visit(child.motion, `${path}.children[${index}].motion`));
  };
  definition.layers.forEach((layer, layerIndex) => layer.states.forEach((state, stateIndex) => {
    visit(state.motion, `layers[${layerIndex}].states[${stateIndex}].motion`);
  }));
}

function freezeDocument(asset: AnimationAuthoringDocument): AnimationAuthoringDocument {
  return Object.freeze(asset);
}
