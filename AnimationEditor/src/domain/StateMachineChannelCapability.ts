import {
  hyaStateMachineChannelCapability,
  type HyaStateMachineChannelCapability,
  type HyaStateMachineChannelId,
  type HyaStateMachineDefinition,
} from '@haiyue/animation-spec';
import type { AnimationEditorTrack } from './AnimationEditorProject';

export interface AnimationEditorStateMachineChannelAssessment {
  readonly channelId: HyaStateMachineChannelId;
  readonly capability: HyaStateMachineChannelCapability;
}

/** Maps every authorable timeline binding onto the canonical HYA registry. */
export function stateMachineTrackChannel(
  track: Pick<AnimationEditorTrack, 'target'>,
): AnimationEditorStateMachineChannelAssessment {
  let channelId: HyaStateMachineChannelId;
  if (track.target.kind === 'node-transform') channelId = 'core-transform';
  else if (track.target.kind === 'effect-property') channelId = 'visual-effect';
  else if (track.target.kind === 'composite-property') channelId = 'composite-expansion';
  else if (track.target.property === 'sprite.uv-rect') channelId = 'sprite-uv';
  else if (track.target.property === 'vector.morph') channelId = 'vector-morph';
  else if (track.target.property.startsWith('vector.')) channelId = 'vector-paint';
  else channelId = 'text-animator';
  return Object.freeze({
    channelId,
    capability: hyaStateMachineChannelCapability(channelId),
  });
}

export function stateMachineComponentChannel(
  componentType: string,
): AnimationEditorStateMachineChannelAssessment | null {
  const channelId = componentType === 'particle2d'
    ? 'particle-2d'
    : componentType === 'particle3d'
      ? 'particle-3d'
    : componentType === 'audio'
      ? 'audio'
      : componentType === 'org.haiyue.vector-path-morph@1'
        ? 'vector-morph'
        : null;
  return channelId === null ? null : Object.freeze({
    channelId,
    capability: hyaStateMachineChannelCapability(channelId),
  });
}

/** Mirrors the runtime's single-playhead/no-overlap audio rule for authoring diagnostics. */
export function stateMachineAudioUnmixablePath(
  definition: HyaStateMachineDefinition,
  basePath = '$.stateMachine',
): string | null {
  if (definition.layers.length !== 1) return `${basePath}.layers`;
  const layer = definition.layers[0]!;
  if ((layer.weight ?? 1) !== 1 || (layer.blendMode ?? 'override') !== 'override') {
    return `${basePath}.layers[0]`;
  }
  const blendState = layer.states.findIndex(state => state.motion.kind !== 'clip');
  if (blendState >= 0) return `${basePath}.layers[0].states[${blendState}].motion`;
  const fadingTransition = layer.transitions.findIndex(transition => transition.duration > 0);
  return fadingTransition < 0
    ? null
    : `${basePath}.layers[0].transitions[${fadingTransition}].duration`;
}
