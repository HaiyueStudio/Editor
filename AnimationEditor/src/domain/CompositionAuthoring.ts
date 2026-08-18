import type {
  AnimationEditorProject,
  DeepMutable,
} from './AnimationEditorProject';

const FRAME_EPSILON = 1e-9;

/** Returns the shortest frame-aligned duration that still contains authored timeline content. */
export function minimumCompositionDuration(project: AnimationEditorProject): number {
  const frameRate = project.composition.frameRate;
  let requiredEnd = 0;

  for (const node of project.nodes) {
    const start = node.start ?? 0;
    requiredEnd = Math.max(requiredEnd, start + (node.duration ?? 0));
  }
  for (const track of project.timeline.tracks) {
    for (const keyframe of track.keyframes) requiredEnd = Math.max(requiredEnd, keyframe.time);
  }
  for (const clip of project.timeline.clips) {
    requiredEnd = Math.max(requiredEnd, clip.start + clip.duration);
  }

  const requiredFrames = Math.ceil(Math.max(0, requiredEnd * frameRate - FRAME_EPSILON));
  return Math.max(1, requiredFrames) / frameRate;
}

/** Applies a frame-aligned duration without truncating existing authored content. */
export function setCompositionDuration(
  project: DeepMutable<AnimationEditorProject>,
  requestedDuration: number,
): number {
  const frameRate = project.composition.frameRate;
  const safeRequest = Number.isFinite(requestedDuration) ? requestedDuration : project.composition.duration;
  const requestedFrames = Math.ceil(Math.max(0, safeRequest * frameRate - FRAME_EPSILON));
  const nextDuration = Math.max(
    minimumCompositionDuration(project as AnimationEditorProject),
    Math.max(1, requestedFrames) / frameRate,
  );
  project.composition.duration = nextDuration;
  if (project.editor?.timeline) {
    project.editor.timeline.playhead = Math.min(project.editor.timeline.playhead, nextDuration);
  }
  return nextDuration;
}
