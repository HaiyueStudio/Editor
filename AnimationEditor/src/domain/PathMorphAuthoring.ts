import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorProject,
} from './AnimationEditorProject';
import {
  availableAdvancedPropertyBindings,
  createAdvancedPropertyTrack,
} from './AdvancedContentAuthoring';
import { createTimelineKeyframe, sampleAnimationEditorTrack } from './TimelineAuthoring';
import {
  parseAuthoringPath,
  pathTopologySignature,
  serializeAuthoringPath,
} from './PathCommandAuthoring';
import { readProjectAuthoringPath, requiredPathRecord } from './PathProjectAuthoring';
import {
  PathAuthoringError,
  type AuthoringPath,
  type PathMorphCorrespondence,
  type PathMorphKeyframeResult,
  type PathPointPart,
  type PathTopologySignature,
} from './PathAuthoringTypes';

export function validatePathMorphTopology(
  base: AuthoringPath,
  candidate: AuthoringPath,
  path = '$.morph',
): PathTopologySignature {
  const left = pathTopologySignature(base);
  const right = pathTopologySignature(candidate);
  if (left.pointCount !== right.pointCount || left.valueCount !== right.valueCount) throw new PathAuthoringError(
    'E_PATH_MORPH_POINT_COUNT_MISMATCH', `${path}.values`,
    `Morph requires ${left.pointCount} authored points and ${left.valueCount} coordinate values; received ${right.pointCount} points and ${right.valueCount} values.`,
    { expected: left.valueCount, actual: right.valueCount },
  );
  if (left.commands !== right.commands) {
    const mismatch = firstMismatch(left.commands, right.commands);
    throw new PathAuthoringError(
      'E_PATH_MORPH_COMMAND_MISMATCH', `${path}.commands[${mismatch}]`,
      `Morph command ${mismatch + 1} must remain ${left.commands[mismatch] ?? 'absent'}, received ${right.commands[mismatch] ?? 'absent'}.`,
      { commandIndex: mismatch, expected: left.commands, actual: right.commands },
    );
  }
  return left;
}

export function pathMorphCorrespondence(
  base: AuthoringPath,
  candidate: AuthoringPath,
): readonly PathMorphCorrespondence[] {
  validatePathMorphTopology(base, candidate);
  const result: PathMorphCorrespondence[] = [];
  for (let index = 0; index < base.commands.length; index++) {
    const from = base.commands[index]!;
    const to = candidate.commands[index]!;
    for (const part of pointParts(from.kind)) {
      const left = commandPoint(from, part);
      const right = commandPoint(to, part);
      if (left && right) result.push(Object.freeze({ commandId: from.id, part, from: left, to: right }));
    }
  }
  return Object.freeze(result);
}

export function createPathMorphKeyframe(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  time: number,
  candidate: AuthoringPath,
  interpolation: 'step' | 'linear' | 'cubic-bezier' = 'linear',
): PathMorphKeyframeResult {
  const record = requiredPathRecord(project, nodeId, componentId);
  if (record.component.type !== 'org.haiyue.vector-shape@1') throw new PathAuthoringError(
    'E_PATH_COMPONENT', `$.nodes.${nodeId}.components.${componentId}`, 'Path morph requires a vector shape component.',
  );
  const base = readProjectAuthoringPath(project, nodeId, componentId);
  const topology = validatePathMorphTopology(base, candidate, `$.nodes.${nodeId}.components.${componentId}.morph`);
  const values = serializeAuthoringPath(candidate).values;
  const draft = cloneAnimationEditorProject(project);
  let track = draft.timeline.tracks.find(item => item.target.kind === 'component-property'
    && item.target.nodeId === nodeId && item.target.componentId === componentId && item.target.property === 'vector.morph');
  if (!track) {
    const binding = availableAdvancedPropertyBindings(project, nodeId).find(item => item.target.kind === 'component-property'
      && item.target.componentId === componentId && item.target.property === 'vector.morph');
    if (!binding) throw new PathAuthoringError(
      'E_PATH_TRACK', `$.nodes.${nodeId}.components.${componentId}`, 'Vector morph binding is unavailable or already active.',
    );
    track = createAdvancedPropertyTrack(draft, nodeId, binding.key, 0);
    draft.timeline.tracks.push(track);
  }
  if (track.valueSize !== topology.valueCount) throw new PathAuthoringError(
    'E_PATH_MORPH_POINT_COUNT_MISMATCH', `$.timeline.tracks.${track.id}.valueSize`,
    `Morph track valueSize must remain ${topology.valueCount}.`,
  );
  const keyframe = createTimelineKeyframe(draft, track.id, time, values);
  keyframe.interpolation = interpolation;
  const frozen = freezeAnimationEditorProject(draft as AnimationEditorProject);
  return Object.freeze({ project: frozen, trackId: track.id, keyframeId: keyframe.id, time: keyframe.time, topology });
}

export function sampleProjectMorphPath(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  time: number,
): AuthoringPath {
  const base = readProjectAuthoringPath(project, nodeId, componentId);
  const track = project.timeline.tracks.find(item => item.enabled !== false && item.target.kind === 'component-property'
    && item.target.nodeId === nodeId && item.target.componentId === componentId && item.target.property === 'vector.morph');
  if (!track) return base;
  const sampled = sampleAnimationEditorTrack(track, time);
  return parseAuthoringPath(base.id, pathTopologySignature(base).commands, sampled, base.geometryVersion + 1);
}

function firstMismatch(left: string, right: string): number {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index++) if (left[index] !== right[index]) return index;
  return count;
}

function pointParts(kind: string): readonly PathPointPart[] {
  if (kind === 'Q') return ['control', 'end'];
  if (kind === 'C') return ['control-out', 'control-in', 'end'];
  if (kind === 'M' || kind === 'L') return ['end'];
  return [];
}

function commandPoint(command: AuthoringPath['commands'][number], part: PathPointPart) {
  if (part === 'end' && command.kind !== 'Z') return command.end;
  if (part === 'control' && command.kind === 'Q') return command.control;
  if (part === 'control-out' && command.kind === 'C') return command.controlOut;
  if (part === 'control-in' && command.kind === 'C') return command.controlIn;
  return null;
}
