import {
  animationPlaybackRange,
  evaluateAnimationInstance,
  normalizeAnimationFps,
  normalizeAnimationFrame,
  normalizeAnimationFrameCount,
  normalizedAnimationKeyframe,
} from './animation';
import type { VoxelAnimationClip, VoxelAnimationKeyframe, VoxelModuleInstance } from './model';

export type AnimationSettingsPatch = Partial<Pick<
  VoxelAnimationClip,
  'name' | 'fps' | 'frameCount' | 'loop' | 'playbackStart' | 'playbackEnd'
>>;

export function updatedAnimationClip(clip: Readonly<VoxelAnimationClip>, patch: AnimationSettingsPatch): VoxelAnimationClip | null {
  const frameCount = patch.frameCount === undefined ? clip.frameCount : normalizeAnimationFrameCount(patch.frameCount);
  const previousRange = animationPlaybackRange(clip);
  const playbackStart = normalizeAnimationFrame(patch.playbackStart ?? previousRange.start, frameCount);
  const playbackEnd = normalizeAnimationFrame(patch.playbackEnd ?? previousRange.end, frameCount);
  const range = playbackStart <= playbackEnd
    ? { start: playbackStart, end: playbackEnd }
    : { start: playbackEnd, end: playbackStart };
  const next: VoxelAnimationClip = {
    ...clip,
    name: patch.name === undefined ? clip.name : patch.name.trim() || clip.name,
    fps: patch.fps === undefined ? clip.fps : normalizeAnimationFps(patch.fps),
    frameCount,
    loop: patch.loop ?? clip.loop,
    playbackStart: range.start,
    playbackEnd: range.end,
    tracks: clip.tracks.map(track => ({
      instanceId: track.instanceId,
      keyframes: track.keyframes.filter(keyframe => keyframe.frame < frameCount).map(cloneKeyframe),
    })).filter(track => track.keyframes.length > 0),
  };
  return JSON.stringify(next) === JSON.stringify(clip) ? null : next;
}

export function upsertAnimationKeyframe(
  clip: VoxelAnimationClip,
  base: Readonly<VoxelModuleInstance>,
  frame: number,
  state?: Readonly<Pick<VoxelModuleInstance, 'moduleId' | 'position' | 'rotation' | 'scale' | 'visible'>>,
): { changed: boolean; moduleId: string } {
  const source = state ?? evaluateAnimationInstance(base, clip, frame);
  const keyframe = normalizedAnimationKeyframe(frame, source, clip.frameCount);
  let track = clip.tracks.find(candidate => candidate.instanceId === base.id);
  if (!track) {
    track = { instanceId: base.id, keyframes: [] };
    clip.tracks.push(track);
  }
  const index = track.keyframes.findIndex(candidate => candidate.frame === keyframe.frame);
  if (index >= 0 && JSON.stringify(track.keyframes[index]) === JSON.stringify(keyframe)) {
    return { changed: false, moduleId: source.moduleId };
  }
  if (index >= 0) track.keyframes[index] = keyframe;
  else track.keyframes.push(keyframe);
  track.keyframes.sort((a, b) => a.frame - b.frame);
  return { changed: true, moduleId: source.moduleId };
}

export function removeAnimationKeyframeState(clip: VoxelAnimationClip, instanceId: string, frame: number): boolean {
  const track = clip.tracks.find(candidate => candidate.instanceId === instanceId);
  if (!track) return false;
  const normalizedFrame = normalizeAnimationFrame(frame, clip.frameCount);
  const index = track.keyframes.findIndex(keyframe => keyframe.frame === normalizedFrame);
  if (index < 0) return false;
  track.keyframes.splice(index, 1);
  if (track.keyframes.length === 0) clip.tracks.splice(clip.tracks.indexOf(track), 1);
  return true;
}

export function animationKeyframeAt(
  clip: Readonly<VoxelAnimationClip> | undefined,
  instanceId: string,
  frame: number,
): VoxelAnimationKeyframe | null {
  const normalizedFrame = clip ? normalizeAnimationFrame(frame, clip.frameCount) : 0;
  const keyframe = clip?.tracks.find(track => track.instanceId === instanceId)?.keyframes
    .find(candidate => candidate.frame === normalizedFrame);
  return keyframe ? cloneKeyframe(keyframe) : null;
}

function cloneKeyframe(keyframe: Readonly<VoxelAnimationKeyframe>): VoxelAnimationKeyframe {
  return {
    ...keyframe,
    position: { ...keyframe.position },
    rotation: { ...keyframe.rotation },
    scale: { ...keyframe.scale },
  };
}
