import {
  MAX_SCENE_AXIS,
  type SceneSize,
  type VoxelAnimationClip,
  type VoxelAnimationKeyframe,
  type VoxelModuleData,
  type VoxelModuleInstance,
} from '../model';

export interface AnimationKeyframeRef {
  instanceId: string;
  frame: number;
}

export function normalizeSceneSize(size: Readonly<SceneSize>): SceneSize {
  const axis = (value: number): number => Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_SCENE_AXIS, Math.round(value)))
    : 1;
  return { x: axis(size.x), y: axis(size.y), z: axis(size.z) };
}

export function sameSize(a: Readonly<SceneSize>, b: Readonly<SceneSize>): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function cloneModule(module: Readonly<VoxelModuleData>): VoxelModuleData {
  return {
    id: module.id,
    name: module.name,
    size: { ...module.size },
    voxels: module.voxels.map(voxel => ({ ...voxel })),
  };
}

export function cloneAnimation(clip: Readonly<VoxelAnimationClip>): VoxelAnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.map(track => ({
      instanceId: track.instanceId,
      keyframes: track.keyframes.map(keyframe => cloneKeyframe(keyframe)!),
    })),
  };
}

export function cloneKeyframe(
  keyframe: Readonly<VoxelAnimationKeyframe> | null,
): VoxelAnimationKeyframe | null {
  return keyframe ? {
    ...keyframe,
    position: { ...keyframe.position },
    rotation: { ...keyframe.rotation },
    scale: { ...keyframe.scale },
  } : null;
}

export function animationRefKey(instanceId: string, frame: number): string {
  return `${instanceId}\u0000${Math.round(frame)}`;
}

export function uniqueAnimationRefs(
  refs: Iterable<Readonly<AnimationKeyframeRef>>,
): AnimationKeyframeRef[] {
  const unique = new Map<string, AnimationKeyframeRef>();
  for (const ref of refs) {
    const normalized = { instanceId: ref.instanceId, frame: Math.round(ref.frame) };
    unique.set(animationRefKey(normalized.instanceId, normalized.frame), normalized);
  }
  return Array.from(unique.values());
}

export function sameKeyframe(
  a: Readonly<VoxelAnimationKeyframe> | null,
  b: Readonly<VoxelAnimationKeyframe> | null,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function cloneInstance(instance: VoxelModuleInstance): VoxelModuleInstance {
  return {
    ...instance,
    position: { ...instance.position },
    rotation: { ...instance.rotation },
    scale: { ...instance.scale },
  };
}
