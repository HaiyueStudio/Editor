import type {
  VoxelAnimationClip,
  VoxelAnimationKeyframe,
  VoxelAnimationTrack,
  VoxelModuleInstance,
} from './model';
import { cloneModuleInstance, normalizeModuleScale, normalizeQuarterTurn } from './moduleTransform';

export const MAX_ANIMATION_FRAMES = 10_000;

export function normalizeAnimationFrame(value: number, frameCount: number): number {
  const count = normalizeAnimationFrameCount(frameCount);
  const frame = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(count - 1, frame));
}

export function normalizeAnimationFrameCount(value: number): number {
  const count = Number.isFinite(value) ? Math.round(value) : 1;
  return Math.max(1, Math.min(MAX_ANIMATION_FRAMES, count));
}

export function normalizeAnimationFps(value: number): number {
  const fps = Number.isFinite(value) ? value : 12;
  return Math.max(1, Math.min(60, Math.round(fps * 100) / 100));
}

export function animationPlaybackRange(
  clip: Readonly<Pick<VoxelAnimationClip, 'frameCount' | 'playbackStart' | 'playbackEnd'>>,
): { start: number; end: number } {
  const start = normalizeAnimationFrame(clip.playbackStart ?? 0, clip.frameCount);
  const end = normalizeAnimationFrame(clip.playbackEnd ?? clip.frameCount - 1, clip.frameCount);
  return start <= end ? { start, end } : { start: end, end: start };
}

export function cloneAnimationKeyframe(keyframe: Readonly<VoxelAnimationKeyframe>): VoxelAnimationKeyframe {
  return {
    frame: keyframe.frame,
    moduleId: keyframe.moduleId,
    position: { ...keyframe.position },
    rotation: { ...keyframe.rotation },
    scale: { ...keyframe.scale },
    visible: keyframe.visible,
  };
}

export function cloneAnimationTrack(track: Readonly<VoxelAnimationTrack>): VoxelAnimationTrack {
  return {
    instanceId: track.instanceId,
    keyframes: track.keyframes.map(cloneAnimationKeyframe),
  };
}

export function cloneAnimationClip(clip: Readonly<VoxelAnimationClip>): VoxelAnimationClip {
  const range = animationPlaybackRange(clip);
  return {
    id: clip.id,
    name: clip.name,
    fps: clip.fps,
    frameCount: clip.frameCount,
    loop: clip.loop,
    playbackStart: range.start,
    playbackEnd: range.end,
    tracks: clip.tracks.map(cloneAnimationTrack),
  };
}

/** Voxel animation is deliberately stepped: every frame keeps the latest keyframe. */
export function evaluateAnimationInstance(
  instance: Readonly<VoxelModuleInstance>,
  clip: Readonly<VoxelAnimationClip> | null,
  frame: number,
): VoxelModuleInstance {
  const result = cloneModuleInstance(instance);
  if (!clip) return result;
  const track = clip.tracks.find(candidate => candidate.instanceId === instance.id);
  if (!track || track.keyframes.length === 0) return result;
  const targetFrame = normalizeAnimationFrame(frame, clip.frameCount);
  let selected: VoxelAnimationKeyframe | undefined;
  for (const keyframe of track.keyframes) {
    if (keyframe.frame > targetFrame) break;
    selected = keyframe;
  }
  if (!selected) return result;
  result.moduleId = selected.moduleId;
  result.position = { ...selected.position };
  result.rotation = { ...selected.rotation };
  result.scale = { ...selected.scale };
  result.visible = selected.visible;
  return result;
}

export function normalizedAnimationKeyframe(
  frame: number,
  state: Readonly<Pick<VoxelModuleInstance, 'moduleId' | 'position' | 'rotation' | 'scale' | 'visible'>>,
  frameCount: number,
): VoxelAnimationKeyframe {
  return {
    frame: normalizeAnimationFrame(frame, frameCount),
    moduleId: state.moduleId,
    position: {
      x: roundedNumber(state.position.x),
      y: roundedNumber(state.position.y),
      z: roundedNumber(state.position.z),
    },
    rotation: {
      x: normalizeQuarterTurn(state.rotation.x),
      y: normalizeQuarterTurn(state.rotation.y),
      z: normalizeQuarterTurn(state.rotation.z),
    },
    scale: {
      x: normalizeModuleScale(state.scale.x),
      y: normalizeModuleScale(state.scale.y),
      z: normalizeModuleScale(state.scale.z),
    },
    visible: state.visible !== false,
  };
}

function roundedNumber(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}
