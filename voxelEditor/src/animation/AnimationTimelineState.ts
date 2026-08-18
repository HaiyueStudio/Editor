import type { VoxelAnimationClip } from '../model';

/** Animation/timeline state with no dependency on playback UI lifecycle. */
export class AnimationTimelineState {
  readonly clips = new Map<string, VoxelAnimationClip>();
  activeAnimationId: string | null = null;
  frame = 0;
  nextAnimationId = 1;
}
