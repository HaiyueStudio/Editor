import {
  cloneNative3dProject,
  type Native3dBinding,
  type Native3dClip,
  type Native3dEvent,
  type Native3dKeyframe,
  type Native3dProject,
  type Native3dTrack,
} from './Native3dProject';
import { parseNative3dProject } from './Native3dProjectCodec';

export interface Native3dImportedAnimationClip {
  readonly format: 'haiyue-animation3d-clip@1';
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly Readonly<{
    id: string;
    binding: Native3dBinding;
    interpolation: 'step' | 'linear' | 'cubic-spline';
    times: ArrayLike<number>;
    values: ArrayLike<number>;
  }>[];
  readonly events: readonly Native3dEvent[];
}

export interface ImportNative3dGltfClipsOptions {
  readonly clipId?: (clip: Native3dImportedAnimationClip, index: number) => string;
  readonly extendComposition?: boolean;
}

/**
 * Lowers clips produced by the existing glTF Animation3D adapter into
 * editable keyframes. Samplers, interpolation and binding ids are preserved.
 */
export function importNative3dGltfClips(
  project: Native3dProject,
  modelNodeId: string,
  clips: readonly Native3dImportedAnimationClip[],
  options: ImportNative3dGltfClipsOptions = {},
): Native3dProject {
  const modelNode = project.nodes.find(node => node.id === modelNodeId
    && node.components.some(component => component.kind === 'model3d'));
  if (!modelNode) throw new RangeError(`Node "${modelNodeId}" is not a model3d node.`);
  const draft = cloneNative3dProject(project) as MutableProject;
  const existing = new Set(draft.timeline.clips.map(clip => clip.id));
  let maximumDuration = draft.composition.duration;
  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const source = clips[clipIndex]!;
    const id = options.clipId?.(source, clipIndex) ?? `gltf:${modelNodeId}:${clipIndex}`;
    if (existing.has(id)) throw new RangeError(`Clip id "${id}" already exists.`);
    existing.add(id);
    const tracks = source.tracks.map((track, trackIndex) => lowerTrack(modelNodeId, id, track, trackIndex));
    const clip: Mutable<Native3dClip> = {
      id,
      name: source.name || `glTF 动画 ${clipIndex + 1}`,
      duration: source.duration,
      tracks,
      events: structuredClone(source.events) as Mutable<Native3dEvent[]>,
    };
    draft.timeline.clips.push(clip);
    maximumDuration = Math.max(maximumDuration, source.duration);
  }
  if (options.extendComposition === true) draft.composition.duration = maximumDuration;
  draft.editor ??= {};
  const lastClip = draft.timeline.clips[draft.timeline.clips.length - 1];
  if (lastClip) draft.editor.activeClipId = lastClip.id;
  return parseNative3dProject(draft);
}

function lowerTrack(
  modelNodeId: string,
  clipId: string,
  track: Native3dImportedAnimationClip['tracks'][number],
  trackIndex: number,
): Mutable<Native3dTrack> {
  const valueSize = track.binding.valueSize;
  const cubic = track.interpolation === 'cubic-spline';
  const stride = valueSize * (cubic ? 3 : 1);
  if (track.values.length !== track.times.length * stride) throw new RangeError(`Imported track "${track.id}" has invalid sampler width.`);
  const keyframes: Mutable<Native3dKeyframe>[] = [];
  for (let index = 0; index < track.times.length; index++) {
    const offset = index * stride;
    keyframes.push({
      id: `${clipId}:key:${trackIndex}:${index}`,
      time: finiteAt(track.times, index, 'time'),
      value: valuesAt(track.values, offset + (cubic ? valueSize : 0), valueSize),
      ...(cubic ? {
        inTangent: valuesAt(track.values, offset, valueSize),
        outTangent: valuesAt(track.values, offset + valueSize * 2, valueSize),
      } : {}),
    });
  }
  return {
    id: `${clipId}:track:${trackIndex}`,
    name: track.binding.path,
    binding: prefixBindingTarget(track.binding, modelNodeId) as Mutable<Native3dBinding>,
    interpolation: track.interpolation,
    keyframes,
  };
}

function prefixBindingTarget(binding: Native3dBinding, modelNodeId: string): Native3dBinding {
  const target = binding.target;
  const prefixed = target.kind === 'node-path'
    ? { kind: 'node-path' as const, segments: target.segments[0] === modelNodeId ? [...target.segments] : [modelNodeId, ...target.segments] }
    : target.kind === 'node-id'
      ? { kind: 'node-path' as const, segments: [modelNodeId, target.nodeId] }
      : { kind: 'slot' as const, slot: target.slot.startsWith(`${modelNodeId}:`) ? target.slot : `${modelNodeId}:${target.slot}` };
  return { ...binding, target: prefixed } as Native3dBinding;
}

function valuesAt(values: ArrayLike<number>, offset: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => finiteAt(values, offset + index, 'value'));
}

function finiteAt(values: ArrayLike<number>, index: number, label: string): number {
  const value = values[index];
  if (value === undefined || !Number.isFinite(value)) throw new RangeError(`Imported Animation3D ${label} ${index} must be finite.`);
  return value;
}

type Mutable<T> = T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
type MutableProject = Mutable<Native3dProject>;
