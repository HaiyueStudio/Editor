import type { AnimationEditorProject } from './AnimationEditorProject';
import type { TimelineKeyframeReference } from './TimelineAuthoring';
import {
  buildTimelineMotionPath,
  moveTimelineMotionPathKey,
  setTimelineSpatialHandle,
} from './TimelineViewportAuthoring';
import {
  PathAuthoringError,
  type PathMotionOverlay,
  type PathMotionSelection,
  type PathPoint,
  type PathTangentMode,
} from './PathAuthoringTypes';

export function buildPathMotionOverlay(
  project: AnimationEditorProject,
  trackId: string,
  selection: readonly PathMotionSelection[] = [],
): PathMotionOverlay {
  const track = requiredPositionTrack(project, trackId);
  const motion = buildTimelineMotionPath(track, project.composition.frameRate, 0, project.composition.duration, 2);
  const selected = new Set(selection.filter(item => item.trackId === trackId).map(item => item.keyframeId));
  return Object.freeze({
    trackId,
    selectedKeyframeIds: selected,
    points: motion.points,
    keys: motion.keys,
  });
}

export function normalizePathMotionSelection(
  project: AnimationEditorProject,
  selection: readonly PathMotionSelection[],
  trackId: string,
): readonly PathMotionSelection[] {
  const track = requiredPositionTrack(project, trackId);
  const keys = new Set(track.keyframes.map(keyframe => keyframe.id));
  const unique = new Map<string, PathMotionSelection>();
  for (const item of selection) {
    if (item.trackId !== trackId || !keys.has(item.keyframeId)) continue;
    unique.set(`${item.keyframeId}:${item.handle ?? 'key'}`, Object.freeze({ ...item }));
  }
  return Object.freeze([...unique.values()]);
}

export function movePathMotionKey(
  project: AnimationEditorProject,
  selection: PathMotionSelection,
  position: PathPoint,
): AnimationEditorProject {
  requiredPositionTrack(project, selection.trackId);
  return moveTimelineMotionPathKey(project, reference(selection), position);
}

export function movePathMotionHandle(
  project: AnimationEditorProject,
  selection: Required<PathMotionSelection>,
  value: PathPoint,
  mode: PathTangentMode,
): AnimationEditorProject {
  requiredPositionTrack(project, selection.trackId);
  return setTimelineSpatialHandle(project, reference(selection), selection.handle, value, mode);
}

function requiredPositionTrack(project: AnimationEditorProject, trackId: string) {
  const track = project.timeline.tracks.find(candidate => candidate.id === trackId);
  if (!track || track.target.kind !== 'node-transform' || track.target.property !== 'position' || track.valueSize !== 2) {
    throw new PathAuthoringError(
      'E_PATH_TRACK', `$.timeline.tracks.${trackId}`, `Motion path requires a 2D position track "${trackId}".`,
    );
  }
  return track;
}

function reference(selection: PathMotionSelection): TimelineKeyframeReference {
  return Object.freeze({ trackId: selection.trackId, keyframeId: selection.keyframeId });
}
