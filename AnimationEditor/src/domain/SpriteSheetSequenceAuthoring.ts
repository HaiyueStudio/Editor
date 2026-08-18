import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorProject,
  type DeepMutable,
} from './AnimationEditorProject';
import {
  availableAdvancedPropertyBindings,
  createAdvancedPropertyTrack,
} from './AdvancedContentAuthoring';
import { createTimelineKeyframe } from './TimelineAuthoring';
import {
  MAX_SPRITE_SHEET_FRAMES,
  SpriteSheetAuthoringError,
  type SpriteSheetFrameMap,
  type SpriteSheetFrameUpdate,
  type SpriteSheetGenerationResult,
  type SpriteSheetSchedule,
  type SpriteSheetScheduledFrame,
  type SpriteSheetSequence,
  type SpriteSheetSequenceFrame,
  type SpriteSheetSequenceOptions,
} from './SpriteSheetTypes';
import {
  createRegularSpriteSheetFrameMap,
  requiredSpriteSheetFrame,
  spriteSheetFrameUvRect,
} from './SpriteSheetGridAuthoring';

export function createSpriteSheetSequence(
  frameMap: SpriteSheetFrameMap,
  options: SpriteSheetSequenceOptions,
): SpriteSheetSequence {
  if (!Number.isSafeInteger(options.start) || !Number.isSafeInteger(options.end)
    || options.start < 0 || options.end < options.start || options.end >= frameMap.frames.length) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_SEQUENCE_RANGE', '$.sequence', 'SpriteSheet sequence start/end must select valid inclusive frames.',
    );
  }
  if (!Number.isFinite(options.fps) || options.fps <= 0 || options.fps > 240) {
    throw new SpriteSheetAuthoringError('E_SPRITESHEET_SEQUENCE_FPS', '$.sequence.fps', 'SpriteSheet FPS must be within (0, 240].');
  }
  const base = frameMap.frames.slice(options.start, options.end + 1).map((frame, index) => ({
    frame,
    duration: options.durations?.[index] ?? 1 / options.fps,
  }));
  if (options.durations && options.durations.length !== base.length) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_FRAME_DURATION', '$.sequence.durations', 'Per-frame durations must match the selected frame count.',
    );
  }
  if (base.some(entry => !Number.isFinite(entry.duration) || entry.duration <= 0)) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_FRAME_DURATION', '$.sequence.durations', 'Every SpriteSheet frame duration must be positive and finite.',
    );
  }
  const ordered = options.mode === 'reverse'
    ? [...base].reverse()
    : options.mode === 'ping-pong'
      ? [...base, ...(options.loop ? base.slice(1, -1) : base.slice(0, -1)).reverse()]
      : base;
  if (ordered.length === 0) {
    throw new SpriteSheetAuthoringError('E_SPRITESHEET_SEQUENCE_EMPTY', '$.sequence', 'SpriteSheet sequence cannot be empty.');
  }
  const occurrences = new Map<string, number>();
  const frames: SpriteSheetSequenceFrame[] = ordered.map(entry => {
    const occurrence = (occurrences.get(entry.frame.id) ?? 0) + 1;
    occurrences.set(entry.frame.id, occurrence);
    return Object.freeze({
      id: `${entry.frame.id}:occurrence:${occurrence}`,
      frameId: entry.frame.id,
      duration: entry.duration,
    });
  });
  const id = `sequence-${options.start + 1}-${options.end + 1}-${options.mode}-${options.loop ? 'loop' : 'once'}`;
  return Object.freeze({
    id,
    resourceId: frameMap.resourceId,
    fps: options.fps,
    loop: options.loop,
    mode: options.mode,
    frames: Object.freeze(frames),
  });
}

export function reorderSpriteSheetSequence(
  sequence: SpriteSheetSequence,
  fromIndex: number,
  toIndex: number,
): SpriteSheetSequence {
  if (!Number.isSafeInteger(fromIndex) || !Number.isSafeInteger(toIndex)
    || fromIndex < 0 || fromIndex >= sequence.frames.length || toIndex < 0 || toIndex >= sequence.frames.length) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_SEQUENCE_RANGE', '$.sequence.frames', 'SpriteSheet reorder indices are out of bounds.',
    );
  }
  const frames = [...sequence.frames];
  const [moved] = frames.splice(fromIndex, 1);
  frames.splice(toIndex, 0, moved!);
  return Object.freeze({ ...sequence, frames: Object.freeze(frames) });
}

export function buildSpriteSheetSchedule(
  sequence: SpriteSheetSequence,
  composition: AnimationEditorProject['composition'],
): SpriteSheetSchedule {
  if (sequence.frames.length === 0) {
    throw new SpriteSheetAuthoringError('E_SPRITESHEET_SEQUENCE_EMPTY', '$.sequence.frames', 'SpriteSheet sequence cannot be empty.');
  }
  const totalFrames = Math.max(1, Math.floor(composition.duration * composition.frameRate + 1e-9));
  const durationFrames = sequence.frames.map(frame => Math.max(1, Math.round(frame.duration * composition.frameRate)));
  const cycleFrames = durationFrames.reduce((sum, value) => sum + value, 0);
  if (!sequence.loop && cycleFrames > totalFrames) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_TIMELINE_BUDGET',
      '$.composition.duration',
      `图集序列需要 ${cycleFrames} 个时间帧，但当前合成只能容纳 ${totalFrames} 个不同时间帧。`,
    );
  }
  const scheduled: SpriteSheetScheduledFrame[] = [];
  let cursor = 0;
  let occurrence = 0;
  while (cursor < totalFrames) {
    for (let index = 0; index < sequence.frames.length && cursor < totalFrames; index++) {
      const frame = sequence.frames[index]!;
      scheduled.push(Object.freeze({
        ...frame,
        id: `${frame.id}:key:${occurrence + 1}`,
        sequenceFrameId: frame.id,
        sequenceIndex: index,
        time: cursor / composition.frameRate,
        durationFrames: durationFrames[index]!,
        occurrence,
      }));
      cursor += durationFrames[index]!;
      occurrence++;
      if (scheduled.length > MAX_SPRITE_SHEET_FRAMES) {
        throw new SpriteSheetAuthoringError(
          'E_SPRITESHEET_FRAME_BUDGET', '$.sequence', `Generated schedule exceeds ${MAX_SPRITE_SHEET_FRAMES} keys.`,
        );
      }
    }
    if (!sequence.loop) break;
  }
  return Object.freeze({
    sequenceId: sequence.id,
    frameRate: composition.frameRate,
    duration: composition.duration,
    loop: sequence.loop,
    frames: Object.freeze(scheduled),
  });
}

export function spriteSheetScheduledFrameAtTime(
  schedule: SpriteSheetSchedule,
  time: number,
): SpriteSheetScheduledFrame {
  if (schedule.frames.length === 0) {
    throw new SpriteSheetAuthoringError('E_SPRITESHEET_SEQUENCE_EMPTY', '$.schedule.frames', 'SpriteSheet schedule is empty.');
  }
  const normalized = schedule.loop
    ? modulo(time, schedule.duration)
    : Math.max(0, Math.min(schedule.duration, Number.isFinite(time) ? time : 0));
  let low = 0;
  let high = schedule.frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (schedule.frames[middle]!.time <= normalized) low = middle + 1;
    else high = middle;
  }
  return schedule.frames[Math.max(0, low - 1)]!;
}

export function generateSpriteSheetProjectAnimation(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  frameMap: SpriteSheetFrameMap,
  sequence: SpriteSheetSequence,
): SpriteSheetGenerationResult {
  const draft = cloneAnimationEditorProject(project);
  const record = requiredSprite(draft, nodeId, componentId);
  if (record.component.resource !== frameMap.resourceId || sequence.resourceId !== frameMap.resourceId) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_ASSET_REFERENCE',
      '$.frameMap.resourceId',
      'SpriteSheet frame map, sequence and sprite component must reference the same image asset.',
    );
  }
  for (const sequenceFrame of sequence.frames) {
    const frame = requiredSpriteSheetFrame(frameMap, sequenceFrame.frameId);
    if (frame.rotated) throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_FRAME_ROTATED', `$.frameMap.frames.${frame.id}`, 'Rotated atlas frames cannot lower to HYA uvRect.',
    );
    if (frame.trimmed) throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_FRAME_TRIMMED', `$.frameMap.frames.${frame.id}`, 'Trimmed atlas frames require a future sprite layout contract.',
    );
  }
  const schedule = buildSpriteSheetSchedule(sequence, draft.composition);
  const firstFrame = requiredSpriteSheetFrame(frameMap, schedule.frames[0]!.frameId);
  record.component.uvRect = [...firstFrame.uvRect];
  let track = spriteUvTrack(draft, nodeId, componentId);
  if (!track) {
    const binding = createAdvancedPropertyTrackBinding(draft, nodeId, componentId);
    track = createAdvancedPropertyTrack(draft, nodeId, binding, 0);
    draft.timeline.tracks.push(track);
  }
  const node = draft.nodes.find(candidate => candidate.id === nodeId)!;
  track.name = `${node.name} · SpriteSheet`;
  track.valueSize = 4;
  track.enabled = true;
  track.color = '#fb7185';
  track.keyframes = schedule.frames.map(entry => ({
    id: `${track!.id}-${entry.id}`,
    time: entry.time,
    value: [...requiredSpriteSheetFrame(frameMap, entry.frameId).uvRect],
    interpolation: 'step' as const,
  }));
  draft.composition.endBehavior = sequence.loop ? 'loop' : 'hold';
  const frozen = freezeAnimationEditorProject(draft as AnimationEditorProject);
  return Object.freeze({ project: frozen, trackId: track.id, schedule, resourceId: frameMap.resourceId });
}

/** Selects a static atlas frame, or records it at the playhead when a UV track already exists. */
export function setSpriteSheetFrame(
  project: DeepMutable<AnimationEditorProject>,
  nodeId: string,
  componentId: string,
  columns: number,
  rows: number,
  frame: number,
  time = project.editor?.timeline?.playhead ?? 0,
): SpriteSheetFrameUpdate {
  const record = requiredSprite(project, nodeId, componentId);
  const frameCount = columns * rows;
  const normalizedFrame = Math.max(0, Math.min(frameCount - 1, Math.round(frame)));
  const uvRect = spriteSheetFrameUvRect(normalizedFrame, columns, rows);
  record.component.uvRect = [...uvRect];
  const track = spriteUvTrack(project, nodeId, componentId);
  if (!track) return { frame: normalizedFrame, uvRect, trackId: null, keyframeId: null };
  const keyframe = createTimelineKeyframe(project, track.id, time, uvRect);
  keyframe.interpolation = 'step';
  return { frame: normalizedFrame, uvRect, trackId: track.id, keyframeId: keyframe.id };
}

/** Backward-compatible regular-grid helper implemented through the production sequence pipeline. */
export function generateSpriteSheetAnimation(
  project: DeepMutable<AnimationEditorProject>,
  nodeId: string,
  componentId: string,
  columns: number,
  rows: number,
): string {
  const record = requiredSprite(project, nodeId, componentId);
  const resourceId = String(record.component.resource);
  // The legacy Inspector helper historically authored normalized cells without
  // requiring source pixel metadata. Production callers use the explicit
  // frame-map API above when whole-pixel margin/spacing validation is needed.
  const frameMap = createRegularSpriteSheetFrameMap(resourceId, columns, rows, { columns, rows });
  const sequence = createSpriteSheetSequence(frameMap, {
    start: 0,
    end: frameMap.frames.length - 1,
    fps: frameMap.frames.length / project.composition.duration,
    loop: false,
    mode: 'forward',
  });
  const generated = generateSpriteSheetProjectAnimation(project as AnimationEditorProject, nodeId, componentId, frameMap, sequence);
  Object.assign(project, cloneAnimationEditorProject(generated.project));
  return generated.trackId;
}

function createAdvancedPropertyTrackBinding(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
): string {
  const binding = availableAdvancedPropertyBindings(project, nodeId).find(candidate => (
    candidate.target.kind === 'component-property'
    && candidate.target.componentId === componentId
    && candidate.target.property === 'sprite.uv-rect'
  ));
  if (!binding) throw new Error(`Sprite UV track is already active or unavailable for "${nodeId}/${componentId}".`);
  return binding.key;
}

function spriteUvTrack(project: DeepMutable<AnimationEditorProject>, nodeId: string, componentId: string) {
  return project.timeline.tracks.find(track => track.target.kind === 'component-property'
    && track.target.nodeId === nodeId
    && track.target.componentId === componentId
    && track.target.property === 'sprite.uv-rect');
}

function requiredSprite(project: DeepMutable<AnimationEditorProject>, nodeId: string, componentId: string) {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  const record = node?.components.find(candidate => candidate.id === componentId);
  if (!record || record.component.type !== 'sprite2d') {
    throw new Error(`Unknown sprite component "${nodeId}/${componentId}".`);
  }
  return record;
}

function modulo(value: number, modulus: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return ((finite % modulus) + modulus) % modulus;
}
