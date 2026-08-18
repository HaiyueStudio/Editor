import type {
  HyaStateMachineCondition,
  HyaStateMachineMotion,
  HyaStateMachineParameter,
  HyaStateMachineTransition,
} from '@haiyue/animation-spec';
import type {
  AnimationEditorProject,
  AnimationEditorState,
  AnimationEditorStateLayer,
  AnimationEditorStateMachine,
  DeepMutable,
} from './AnimationEditorProject';

export type StateMachineParameterType = HyaStateMachineParameter['type'];
export type StateMachineMotionKind = HyaStateMachineMotion['kind'];

export interface StateMachineReference {
  readonly kind: 'condition' | 'speed' | 'blend-tree' | 'state-motion';
  readonly layerId: string;
  readonly stateId?: string;
  readonly transitionId?: string;
}

export function createAnimationEditorStateMachine(
  project: AnimationEditorProject,
): DeepMutable<AnimationEditorStateMachine> {
  const clip = requireClip(project);
  const stateId = 'state';
  return {
    format: 'haiyue-animation-state-machine@1',
    id: stableId(`${project.id}-controller`, 'animation-controller'),
    name: `${project.name} Controller`,
    parameters: [],
    layers: [{
      id: 'base',
      name: 'Base Layer',
      initialStateId: stateId,
      blendMode: 'override',
      weight: 1,
      states: [{
        id: stateId,
        name: 'State 1',
        motion: { kind: 'clip', clipId: clip.id },
        loop: 'repeat',
        editorPosition: [100, 120],
      }],
      transitions: [],
    }],
  };
}

export function createStateMachineParameter(
  machine: AnimationEditorStateMachine,
  type: StateMachineParameterType,
): DeepMutable<HyaStateMachineParameter> {
  const names = new Set(machine.parameters.map(parameter => parameter.name));
  const name = uniqueId(type, names);
  if (type === 'float') return { name, type, defaultValue: 0 };
  if (type === 'integer') return { name, type, defaultValue: 0 };
  if (type === 'boolean') return { name, type, defaultValue: false };
  return { name, type };
}

export function renameStateMachineParameter(
  machine: DeepMutable<AnimationEditorStateMachine>,
  currentName: string,
  requestedName: string,
): string {
  const parameter = machine.parameters.find(candidate => candidate.name === currentName);
  if (!parameter) throw new Error(`Unknown state-machine parameter "${currentName}".`);
  const normalized = stableId(requestedName.trim(), currentName);
  if (normalized !== currentName && machine.parameters.some(candidate => candidate.name === normalized)) {
    throw new Error(`State-machine parameter "${normalized}" already exists.`);
  }
  if (normalized === currentName) return currentName;
  parameter.name = normalized;
  for (const layer of machine.layers) {
    for (const state of layer.states) {
      if (state.speedParameter === currentName) state.speedParameter = normalized;
      renameMotionParameter(state.motion, currentName, normalized);
    }
    for (const transition of layer.transitions) {
      for (const condition of transition.conditions) {
        if (condition.parameter === currentName) condition.parameter = normalized;
      }
    }
  }
  return normalized;
}

export function stateMachineParameterReferences(
  machine: AnimationEditorStateMachine,
  parameterName: string,
): readonly StateMachineReference[] {
  const result: StateMachineReference[] = [];
  for (const layer of machine.layers) {
    for (const state of layer.states) {
      if (state.speedParameter === parameterName) {
        result.push({ kind: 'speed', layerId: layer.id, stateId: state.id });
      }
      collectMotionParameterReferences(state.motion, parameterName, layer.id, state.id, result);
    }
    for (const transition of layer.transitions) {
      if (transition.conditions.some(condition => condition.parameter === parameterName)) {
        result.push({ kind: 'condition', layerId: layer.id, transitionId: transition.id });
      }
    }
  }
  return result;
}

export function deleteStateMachineParameter(
  machine: DeepMutable<AnimationEditorStateMachine>,
  parameterName: string,
): boolean {
  if (stateMachineParameterReferences(machine, parameterName).length > 0) return false;
  const previous = machine.parameters.length;
  machine.parameters = machine.parameters.filter(parameter => parameter.name !== parameterName);
  return machine.parameters.length !== previous;
}

export function stateMachineClipReferences(
  machine: AnimationEditorStateMachine | null,
  clipId: string,
): readonly Readonly<{ layerId: string; stateId: string }>[] {
  if (!machine) return [];
  const result: Array<{ layerId: string; stateId: string }> = [];
  for (const layer of machine.layers) {
    for (const state of layer.states) {
      if (motionReferencesClip(state.motion, clipId)) result.push({ layerId: layer.id, stateId: state.id });
    }
  }
  return result;
}

export function createStateMachineLayer(
  project: AnimationEditorProject,
  machine: AnimationEditorStateMachine,
): DeepMutable<AnimationEditorStateLayer> {
  const clip = requireClip(project);
  const id = uniqueId('layer', new Set(machine.layers.map(layer => layer.id)));
  const stateId = 'state';
  return {
    id,
    name: `Layer ${machine.layers.length + 1}`,
    initialStateId: stateId,
    blendMode: 'override',
    weight: 1,
    states: [{
      id: stateId,
      name: 'State 1',
      motion: { kind: 'clip', clipId: clip.id },
      loop: 'repeat',
      editorPosition: [100, 120],
    }],
    transitions: [],
  };
}

export function deleteStateMachineLayer(
  machine: DeepMutable<AnimationEditorStateMachine>,
  layerId: string,
): boolean {
  if (machine.layers.length <= 1) return false;
  const previous = machine.layers.length;
  machine.layers = machine.layers.filter(layer => layer.id !== layerId);
  return machine.layers.length !== previous;
}

export function createStateMachineState(
  project: AnimationEditorProject,
  layer: AnimationEditorStateLayer,
  position?: readonly [number, number],
): DeepMutable<AnimationEditorState> {
  const clip = requireClip(project);
  const id = uniqueId('state', new Set(layer.states.map(state => state.id)));
  const index = layer.states.length;
  return {
    id,
    name: `State ${index + 1}`,
    motion: { kind: 'clip', clipId: clip.id },
    loop: 'repeat',
    editorPosition: position
      ? [position[0], position[1]]
      : [100 + index % 4 * 190, 120 + Math.floor(index / 4) * 120],
  };
}

export function deleteStateMachineState(
  layer: DeepMutable<AnimationEditorStateLayer>,
  stateId: string,
): boolean {
  if (layer.states.length <= 1) return false;
  const previous = layer.states.length;
  layer.states = layer.states.filter(state => state.id !== stateId);
  if (layer.states.length === previous) return false;
  layer.transitions = layer.transitions.filter(transition => transition.from !== stateId && transition.to !== stateId);
  if (layer.initialStateId === stateId) layer.initialStateId = layer.states[0]!.id;
  return true;
}

export function createStateMachineTransition(
  layer: AnimationEditorStateLayer,
  from: string | '*',
  to: string,
): DeepMutable<HyaStateMachineTransition> {
  if (from !== '*' && !layer.states.some(state => state.id === from)) throw new Error(`Unknown state "${from}".`);
  if (!layer.states.some(state => state.id === to)) throw new Error(`Unknown state "${to}".`);
  if (from === to) throw new Error('A transition source and destination must differ.');
  const id = uniqueId('transition', new Set(layer.transitions.map(transition => transition.id)));
  return {
    id,
    from,
    to,
    conditions: [],
    duration: 0.2,
    hasExitTime: true,
    exitTime: 1,
    interruption: 'source-then-destination',
  };
}

export function deleteStateMachineTransition(
  layer: DeepMutable<AnimationEditorStateLayer>,
  transitionId: string,
): boolean {
  const previous = layer.transitions.length;
  layer.transitions = layer.transitions.filter(transition => transition.id !== transitionId);
  return layer.transitions.length !== previous;
}

export function createStateMachineCondition(
  parameter: HyaStateMachineParameter,
): DeepMutable<HyaStateMachineCondition> {
  if (parameter.type === 'float' || parameter.type === 'integer') {
    return { parameter: parameter.name, operator: 'greater', value: parameter.defaultValue };
  }
  if (parameter.type === 'boolean') return { parameter: parameter.name, operator: 'is-true' };
  return { parameter: parameter.name, operator: 'triggered' };
}

export function conditionOperatorsForParameter(
  parameter: HyaStateMachineParameter,
): readonly HyaStateMachineCondition['operator'][] {
  if (parameter.type === 'float' || parameter.type === 'integer') {
    return ['greater', 'greater-or-equal', 'less', 'less-or-equal', 'equal', 'not-equal'];
  }
  if (parameter.type === 'boolean') return ['is-true', 'is-false', 'equal', 'not-equal'];
  return ['triggered'];
}

export function createStateMachineMotion(
  project: AnimationEditorProject,
  kind: StateMachineMotionKind,
): DeepMutable<HyaStateMachineMotion> {
  const clip = requireClip(project);
  if (kind === 'clip') return { kind, clipId: clip.id };
  const numeric = project.stateMachine?.parameters.filter(parameter => (
    parameter.type === 'float' || parameter.type === 'integer'
  )) ?? [];
  if (numeric.length === 0) throw new Error('Blend Trees require at least one Float or Integer parameter.');
  const secondClip = project.timeline.clips[1] ?? clip;
  if (kind === 'blend-1d') {
    return {
      kind,
      parameter: numeric[0]!.name,
      children: [
        { threshold: 0, motion: { kind: 'clip', clipId: clip.id } },
        { threshold: 1, motion: { kind: 'clip', clipId: secondClip.id } },
      ],
    };
  }
  return {
    kind,
    algorithm: 'cartesian',
    parameterX: numeric[0]!.name,
    parameterY: (numeric[1] ?? numeric[0])!.name,
    children: [
      { position: [0, 0], motion: { kind: 'clip', clipId: clip.id } },
      { position: [1, 0], motion: { kind: 'clip', clipId: secondClip.id } },
    ],
  };
}

export function motionKindLabel(kind: StateMachineMotionKind): string {
  return kind === 'clip' ? 'Clip' : kind === 'blend-1d' ? '1D Blend Tree' : '2D Blend Tree';
}

function requireClip(project: AnimationEditorProject): AnimationEditorProject['timeline']['clips'][number] {
  const clip = project.timeline.clips[0];
  if (!clip) throw new Error('Create at least one named animation clip before authoring a state machine.');
  return clip;
}

function collectMotionParameterReferences(
  motion: HyaStateMachineMotion,
  parameterName: string,
  layerId: string,
  stateId: string,
  result: StateMachineReference[],
): void {
  if (motion.kind === 'clip') return;
  if (motion.kind === 'blend-1d' && motion.parameter === parameterName) {
    result.push({ kind: 'blend-tree', layerId, stateId });
  }
  if (motion.kind === 'blend-2d'
    && (motion.parameterX === parameterName || motion.parameterY === parameterName)) {
    result.push({ kind: 'blend-tree', layerId, stateId });
  }
  for (const child of motion.children) {
    collectMotionParameterReferences(child.motion, parameterName, layerId, stateId, result);
  }
}

function motionReferencesClip(motion: HyaStateMachineMotion, clipId: string): boolean {
  if (motion.kind === 'clip') return motion.clipId === clipId;
  return motion.children.some(child => motionReferencesClip(child.motion, clipId));
}

function renameMotionParameter(
  motion: DeepMutable<HyaStateMachineMotion>,
  currentName: string,
  nextName: string,
): void {
  if (motion.kind === 'clip') return;
  if (motion.kind === 'blend-1d' && motion.parameter === currentName) motion.parameter = nextName;
  if (motion.kind === 'blend-2d') {
    if (motion.parameterX === currentName) motion.parameterX = nextName;
    if (motion.parameterY === currentName) motion.parameterY = nextName;
  }
  for (const child of motion.children) renameMotionParameter(child.motion, currentName, nextName);
}

function stableId(value: string, fallback: string): string {
  return value.normalize('NFKD')
    .replace(/[^A-Za-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;
}

function uniqueId(base: string, existing: ReadonlySet<string>): string {
  const normalized = stableId(base, 'item');
  if (!existing.has(normalized)) return normalized;
  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index++) {
    const candidate = `${normalized}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate an id for "${base}".`);
}
