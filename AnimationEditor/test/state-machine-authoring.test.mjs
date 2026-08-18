import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  conditionOperatorsForParameter,
  createAnimationEditorStateMachine,
  createBasicAnimationNode,
  createCoreTransformTrack,
  createEmptyAnimationEditorProject,
  createStateMachineCondition,
  createStateMachineLayer,
  createStateMachineMotion,
  createStateMachineParameter,
  createStateMachineState,
  createStateMachineTransition,
  deleteStateMachineLayer,
  deleteStateMachineParameter,
  deleteStateMachineState,
  deleteStateMachineTransition,
  parseAnimationEditorProject,
  renameStateMachineParameter,
  serializeAnimationEditorProject,
  stateMachineClipReferences,
  stateMachineParameterReferences,
} from '../dist-test/testing.js';

const EXTENSION_ID = 'org.haiyue.animation-state-machine@1';

test('state-machine factory requires a named clip and compiles editor-free graph data', () => {
  const empty = createEmptyAnimationEditorProject();
  assert.throws(() => createAnimationEditorStateMachine(empty), /named animation clip/i);

  const project = animationProject();
  project.stateMachine = createAnimationEditorStateMachine(project);
  const result = compileAnimationEditorProject(project);
  const extension = result.document.extensions[EXTENSION_ID];

  assert.deepEqual(result.parsed.extensionsRequired, [EXTENSION_ID]);
  assert.equal(extension.clips.length, 2);
  assert.equal(extension.stateMachine.layers[0].states[0].editorPosition, undefined);
  assert.deepEqual(project.stateMachine.layers[0].states[0].editorPosition, [100, 120]);
});

test('parameter factories produce typed defaults and protect referenced parameters', () => {
  const project = animationProject();
  const machine = createAnimationEditorStateMachine(project);
  project.stateMachine = machine;
  for (const type of ['float', 'integer', 'boolean', 'trigger']) {
    machine.parameters.push(createStateMachineParameter(machine, type));
  }
  assert.deepEqual(machine.parameters.map(parameter => parameter.name), ['float', 'integer', 'boolean', 'trigger']);
  assert.deepEqual(conditionOperatorsForParameter(machine.parameters[0]), [
    'greater', 'greater-or-equal', 'less', 'less-or-equal', 'equal', 'not-equal',
  ]);
  assert.deepEqual(createStateMachineCondition(machine.parameters[2]), {
    parameter: 'boolean', operator: 'is-true',
  });

  machine.layers[0].states[0].motion = createStateMachineMotion(project, 'blend-1d');
  machine.layers[0].states[0].speedParameter = 'float';
  assert.ok(stateMachineParameterReferences(machine, 'float').some(reference => reference.kind === 'blend-tree'));
  assert.equal(deleteStateMachineParameter(machine, 'float'), false);
  assert.equal(renameStateMachineParameter(machine, 'float', 'move-speed'), 'move-speed');
  assert.equal(machine.layers[0].states[0].speedParameter, 'move-speed');
  assert.equal(machine.layers[0].states[0].motion.parameter, 'move-speed');
  assert.throws(() => renameStateMachineParameter(machine, 'move-speed', 'boolean'), /already exists/);
  assert.equal(deleteStateMachineParameter(machine, 'integer'), true);
  assert.equal(machine.parameters.some(parameter => parameter.name === 'integer'), false);
});

test('layers, states and transitions keep graph references valid during deletion', () => {
  const project = animationProject();
  const machine = createAnimationEditorStateMachine(project);
  project.stateMachine = machine;
  const base = machine.layers[0];
  const second = createStateMachineState(project, base);
  base.states.push(second);
  const transition = createStateMachineTransition(base, base.states[0].id, second.id);
  base.transitions.push(transition);

  assert.equal(deleteStateMachineState(base, base.states[0].id), true);
  assert.equal(base.initialStateId, second.id);
  assert.equal(base.transitions.length, 0);
  assert.equal(deleteStateMachineState(base, second.id), false);

  const layer = createStateMachineLayer(project, machine);
  machine.layers.push(layer);
  assert.equal(deleteStateMachineLayer(machine, layer.id), true);
  assert.equal(deleteStateMachineLayer(machine, base.id), false);

  const third = createStateMachineState(project, base);
  base.states.push(third);
  const any = createStateMachineTransition(base, '*', third.id);
  base.transitions.push(any);
  assert.equal(deleteStateMachineTransition(base, any.id), true);
});

test('conditions and 1D/2D Blend Trees survive project validation and HYA compilation', () => {
  const project = animationProject();
  const machine = createAnimationEditorStateMachine(project);
  project.stateMachine = machine;
  const speed = createStateMachineParameter(machine, 'float');
  const moving = createStateMachineParameter(machine, 'boolean');
  machine.parameters.push(speed, moving);
  const layer = machine.layers[0];
  const second = createStateMachineState(project, layer);
  second.motion = createStateMachineMotion(project, 'blend-2d');
  layer.states[0].motion = createStateMachineMotion(project, 'blend-1d');
  layer.states.push(second);
  const transition = createStateMachineTransition(layer, layer.states[0].id, second.id);
  transition.conditions.push(createStateMachineCondition(moving));
  transition.hasExitTime = false;
  delete transition.exitTime;
  layer.transitions.push(transition);

  assert.deepEqual(stateMachineClipReferences(machine, 'idle').map(reference => reference.stateId), ['state', 'state-2']);
  const reopened = parseAnimationEditorProject(JSON.parse(serializeAnimationEditorProject(project)));
  const result = compileAnimationEditorProject(reopened);
  assert.equal(result.document.extensions[EXTENSION_ID].stateMachine.layers[0].states[0].motion.kind, 'blend-1d');
  assert.equal(result.document.extensions[EXTENSION_ID].stateMachine.layers[0].states[1].motion.kind, 'blend-2d');
});

function animationProject() {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2, frameRate: 30 }));
  const node = createBasicAnimationNode(project, 'rectangle');
  project.nodes.push(node);
  const track = createCoreTransformTrack(project, node.id, 'position', 0);
  track.keyframes.push({
    id: `${track.id}-key-2`, time: 2, value: [600, 250], interpolation: 'linear',
  });
  project.timeline.tracks.push(track);
  project.timeline.clips.push(
    { id: 'idle', name: 'Idle', start: 0, duration: 1, color: '#3fb950' },
    { id: 'move', name: 'Move', start: 1, duration: 1, color: '#58a6ff' },
  );
  return project;
}
