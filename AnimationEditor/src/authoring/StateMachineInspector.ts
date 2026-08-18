import type {
  GECheckbox,
  GECheckboxChangeDetail,
  GEInput,
  GEInputChangeDetail,
  GESelect,
  GESelectChangeDetail,
  GESelectOption,
} from '@haiyue/ui';
import type {
  HyaStateMachineCondition,
  HyaStateMachineMotion,
  HyaStateMachineParameter,
} from '@haiyue/animation-spec';
import type {
  AnimationEditorProject,
  AnimationEditorState,
  AnimationEditorStateLayer,
  DeepMutable,
} from '../domain/AnimationEditorProject';
import type { AnimationEditorSelectionItem } from '../domain/SelectionStore';
import {
  conditionOperatorsForParameter,
  createStateMachineCondition,
  createStateMachineMotion,
  motionKindLabel,
} from '../domain/StateMachineAuthoring';
import { localizeLiteral } from '../localization';

export interface StateMachineInspectorActions {
  readonly commit: (
    label: string,
    mutation: (draft: DeepMutable<AnimationEditorProject>) => void,
  ) => boolean;
  readonly renameParameter: (currentName: string, requestedName: string) => void;
  readonly deleteParameter: (name: string) => void;
  readonly deleteLayer: (layerId: string) => void;
  readonly deleteState: (layerId: string, stateId: string) => void;
  readonly deleteTransition: (layerId: string, transitionId: string) => void;
}

export function renderStateMachineInspector(
  host: HTMLElement,
  project: AnimationEditorProject,
  primary: AnimationEditorSelectionItem | null,
  actions: StateMachineInspectorActions,
): boolean {
  if (!primary || !['parameter', 'layer', 'state', 'transition'].includes(primary.kind)) return false;
  host.replaceChildren();
  const machine = project.stateMachine;
  if (!machine) {
    host.append(emptyMessage('状态机不存在', '请先创建状态机'));
    return true;
  }
  if (primary.kind === 'parameter') {
    const parameter = machine.parameters.find(candidate => candidate.name === primary.id);
    if (parameter) renderParameter(host, parameter, actions);
    else host.append(emptyMessage('参数不存在', primary.id));
    return true;
  }
  if (primary.kind === 'layer') {
    const layer = machine.layers.find(candidate => candidate.id === primary.id);
    if (layer) renderLayer(host, project, layer, actions);
    else host.append(emptyMessage('层不存在', primary.id));
    return true;
  }
  const layer = machine.layers.find(candidate => candidate.id === primary.ownerId);
  if (!layer) {
    host.append(emptyMessage('状态机层不存在', primary.ownerId ?? ''));
    return true;
  }
  if (primary.kind === 'state') {
    const state = layer.states.find(candidate => candidate.id === primary.id);
    if (state) renderState(host, project, layer, state, actions);
    else host.append(emptyMessage('状态不存在', primary.id));
    return true;
  }
  const transition = layer.transitions.find(candidate => candidate.id === primary.id);
  if (transition) renderTransition(host, project, layer, transition, actions);
  else host.append(emptyMessage('转场不存在', primary.id));
  return true;
}

function renderParameter(
  host: HTMLElement,
  parameter: HyaStateMachineParameter,
  actions: StateMachineInspectorActions,
): void {
  const section = propertySection('Parameter', parameter.type);
  section.append(
    textField('名称', parameter.name, value => actions.renameParameter(parameter.name, value)),
    readOnlyRow('类型', parameter.type),
  );
  if (parameter.type === 'float' || parameter.type === 'integer') {
    section.append(numberField('默认值', parameter.defaultValue, value => actions.commit('Set Parameter Default', draft => {
      const target = draft.stateMachine?.parameters.find(candidate => candidate.name === parameter.name);
      if (target?.type === 'float') target.defaultValue = value;
      else if (target?.type === 'integer') target.defaultValue = Math.round(value);
    }), { step: parameter.type === 'integer' ? 1 : 0.1 }));
  } else if (parameter.type === 'boolean') {
    section.append(checkRow(checkbox('默认启用', parameter.defaultValue, value => actions.commit('Set Parameter Default', draft => {
      const target = draft.stateMachine?.parameters.find(candidate => candidate.name === parameter.name);
      if (target?.type === 'boolean') target.defaultValue = value;
    }))));
  } else {
    section.append(note('Trigger 没有持久默认值；运行时按钮会发送一次触发。'));
  }
  section.append(actionRow([
    actionButton('删除参数', () => actions.deleteParameter(parameter.name), 'danger'),
  ]));
  host.append(section);
}

function renderLayer(
  host: HTMLElement,
  project: AnimationEditorProject,
  layer: AnimationEditorStateLayer,
  actions: StateMachineInspectorActions,
): void {
  const section = propertySection('State Machine Layer', layer.blendMode ?? 'override');
  section.append(
    textField('名称', layer.name, value => actions.commit('Rename State Layer', draft => {
      const target = findLayer(draft, layer.id);
      if (target && value.trim()) target.name = value.trim();
    })),
    readOnlyRow('ID', layer.id),
    selectField('初始状态', layer.initialStateId, layer.states.map(state => ({
      label: state.name, value: state.id,
    })), value => actions.commit('Set Initial State', draft => {
      const target = findLayer(draft, layer.id);
      if (target) target.initialStateId = value;
    })),
    selectField('混合模式', layer.blendMode ?? 'override', [
      { label: 'Override', value: 'override' },
      { label: 'Additive', value: 'additive' },
    ], value => actions.commit('Set Layer Blend Mode', draft => {
      const target = findLayer(draft, layer.id);
      if (target) target.blendMode = value as 'override' | 'additive';
    })),
    numberField('权重', layer.weight ?? 1, value => actions.commit('Set Layer Weight', draft => {
      const target = findLayer(draft, layer.id);
      if (target) target.weight = clamp(value, 0, 1);
    }), { min: 0, max: 1, step: 0.01 }),
    readOnlyRow('状态', String(layer.states.length)),
    readOnlyRow('转场', String(layer.transitions.length)),
  );
  host.append(section);

  const mask = propertySection('Binding Mask');
  const mode = layer.mask?.include ? 'include' : layer.mask?.exclude ? 'exclude' : 'none';
  mask.append(selectField('模式', mode, [
    { label: '全部节点', value: 'none' },
    { label: '仅包含', value: 'include' },
    { label: '排除', value: 'exclude' },
  ], value => actions.commit('Set Layer Mask Mode', draft => {
    const target = findLayer(draft, layer.id);
    if (!target) return;
    if (value === 'none') delete target.mask;
    else target.mask = value === 'include' ? { include: [] } : { exclude: [] };
  })));
  if (mode !== 'none') {
    const selected = new Set(mode === 'include' ? layer.mask?.include : layer.mask?.exclude);
    const checks = document.createElement('div');
    checks.className = 'state-mask-list';
    for (const node of project.nodes) {
      checks.append(checkbox(node.name, selected.has(node.id), checked => actions.commit('Update Layer Mask', draft => {
        const target = findLayer(draft, layer.id);
        if (!target) return;
        target.mask ??= mode === 'include' ? { include: [] } : { exclude: [] };
        const values = new Set(mode === 'include' ? target.mask.include ?? [] : target.mask.exclude ?? []);
        if (checked) values.add(node.id);
        else values.delete(node.id);
        if (mode === 'include') target.mask = { include: [...values] };
        else target.mask = { exclude: [...values] };
      })));
    }
    mask.append(checks);
  }
  mask.append(actionRow([
    actionButton(
      '删除层',
      () => actions.deleteLayer(layer.id),
      'danger',
      project.stateMachine?.layers.length === 1,
    ),
  ]));
  host.append(mask);
}

function renderState(
  host: HTMLElement,
  project: AnimationEditorProject,
  layer: AnimationEditorStateLayer,
  state: AnimationEditorState,
  actions: StateMachineInspectorActions,
): void {
  const section = propertySection('State', layer.initialStateId === state.id ? 'initial' : motionKindLabel(state.motion.kind));
  const numericParameters = project.stateMachine?.parameters.filter(parameter => (
    parameter.type === 'float' || parameter.type === 'integer'
  )) ?? [];
  section.append(
    textField('名称', state.name, value => actions.commit('Rename State', draft => {
      const target = findState(draft, layer.id, state.id);
      if (target && value.trim()) target.name = value.trim();
    })),
    readOnlyRow('ID', state.id),
    selectField('循环', state.loop ?? 'repeat', [
      { label: 'Once', value: 'once' },
      { label: 'Repeat', value: 'repeat' },
      { label: 'Ping Pong', value: 'ping-pong' },
    ], value => actions.commit('Set State Loop', draft => {
      const target = findState(draft, layer.id, state.id);
      if (target) target.loop = value as 'once' | 'repeat' | 'ping-pong';
    })),
    numberField('速度', state.speed ?? 1, value => actions.commit('Set State Speed', draft => {
      const target = findState(draft, layer.id, state.id);
      if (target) target.speed = value;
    }), { step: 0.1 }),
    selectField('速度参数', state.speedParameter ?? '', [
      { label: '固定速度', value: '' },
      ...numericParameters.map(parameter => ({ label: parameter.name, value: parameter.name })),
    ], value => actions.commit('Set State Speed Parameter', draft => {
      const target = findState(draft, layer.id, state.id);
      if (!target) return;
      if (value) target.speedParameter = value;
      else delete target.speedParameter;
    })),
    selectField('Motion', state.motion.kind, [
      { label: 'Clip', value: 'clip' },
      { label: '1D Blend Tree', value: 'blend-1d', disabled: numericParameters.length === 0 },
      { label: '2D Blend Tree', value: 'blend-2d', disabled: numericParameters.length === 0 },
    ], value => actions.commit('Change State Motion', draft => {
      const target = findState(draft, layer.id, state.id);
      if (target) target.motion = createStateMachineMotion(draft, value as HyaStateMachineMotion['kind']);
    })),
  );
  if (layer.initialStateId !== state.id) {
    section.append(actionRow([
      actionButton('设为初始状态', () => actions.commit('Set Initial State', draft => {
        const target = findLayer(draft, layer.id);
        if (target) target.initialStateId = state.id;
      })),
    ]));
  }
  host.append(section);
  renderMotion(host, project, layer, state, actions);
  const stateActions = propertySection('Actions');
  stateActions.append(actionRow([
    actionButton(
      '删除状态',
      () => actions.deleteState(layer.id, state.id),
      'danger',
      layer.states.length === 1,
    ),
  ]));
  host.append(stateActions);
}

function renderMotion(
  host: HTMLElement,
  project: AnimationEditorProject,
  layer: AnimationEditorStateLayer,
  state: AnimationEditorState,
  actions: StateMachineInspectorActions,
): void {
  const motion = state.motion;
  const section = propertySection('Motion', motionKindLabel(motion.kind));
  const clips = project.timeline.clips.map(clip => ({ label: clip.name, value: clip.id }));
  const numeric = project.stateMachine?.parameters.filter(parameter => (
    parameter.type === 'float' || parameter.type === 'integer'
  )).map(parameter => ({ label: parameter.name, value: parameter.name })) ?? [];
  if (motion.kind === 'clip') {
    section.append(selectField('动画片段', motion.clipId, clips, value => actions.commit('Set State Clip', draft => {
      const target = findState(draft, layer.id, state.id);
      if (target?.motion.kind === 'clip') target.motion.clipId = value;
    })));
  } else if (motion.kind === 'blend-1d') {
    section.append(selectField('驱动参数', motion.parameter, numeric, value => actions.commit('Set Blend Parameter', draft => {
      const target = findState(draft, layer.id, state.id);
      if (target?.motion.kind === 'blend-1d') target.motion.parameter = value;
    })));
    motion.children.forEach((child, index) => {
      const childSection = document.createElement('div');
      childSection.className = 'blend-child';
      childSection.append(
        numberField(`阈值 ${index + 1}`, child.threshold, value => actions.commit('Set Blend Threshold', draft => {
          const target = findState(draft, layer.id, state.id);
          if (target?.motion.kind !== 'blend-1d') return;
          const previous = target.motion.children[index - 1]?.threshold;
          const next = target.motion.children[index + 1]?.threshold;
          const minimum = previous === undefined ? Number.NEGATIVE_INFINITY : previous + 0.0001;
          const maximum = next === undefined ? Number.POSITIVE_INFINITY : next - 0.0001;
          target.motion.children[index]!.threshold = Math.max(minimum, Math.min(maximum, value));
          target.motion.children.sort((left, right) => left.threshold - right.threshold);
        }), { step: 0.1 }),
        child.motion.kind === 'clip'
          ? selectField('片段', child.motion.clipId, clips, value => actions.commit('Set Blend Clip', draft => {
              const target = findState(draft, layer.id, state.id);
              const item = target?.motion.kind === 'blend-1d' ? target.motion.children[index] : undefined;
              if (item) item.motion = { kind: 'clip', clipId: value };
            }))
          : note('嵌套 Blend Tree 会被保留；当前检查器编辑根节点子项。'),
        actionRow([
          actionButton('移除子项', () => actions.commit('Remove Blend Child', draft => {
            const target = findState(draft, layer.id, state.id);
            if (target?.motion.kind === 'blend-1d' && target.motion.children.length > 1) {
              target.motion.children.splice(index, 1);
            }
          }), 'danger', motion.children.length <= 1),
        ]),
      );
      section.append(childSection);
    });
    section.append(actionRow([
      actionButton('添加子项', () => actions.commit('Add Blend Child', draft => {
        const target = findState(draft, layer.id, state.id);
        const clip = draft.timeline.clips[0];
        if (target?.motion.kind !== 'blend-1d' || !clip) return;
        const threshold = (target.motion.children.at(-1)?.threshold ?? -1) + 1;
        target.motion.children.push({ threshold, motion: { kind: 'clip', clipId: clip.id } });
      })),
    ]));
  } else {
    section.append(
      selectField('算法', motion.algorithm, [
        { label: 'Cartesian', value: 'cartesian' },
        { label: 'Directional', value: 'directional' },
      ], value => actions.commit('Set Blend Algorithm', draft => {
        const target = findState(draft, layer.id, state.id);
        if (target?.motion.kind === 'blend-2d') target.motion.algorithm = value as 'cartesian' | 'directional';
      })),
      selectField('参数 X', motion.parameterX, numeric, value => actions.commit('Set Blend Parameter X', draft => {
        const target = findState(draft, layer.id, state.id);
        if (target?.motion.kind === 'blend-2d') target.motion.parameterX = value;
      })),
      selectField('参数 Y', motion.parameterY, numeric, value => actions.commit('Set Blend Parameter Y', draft => {
        const target = findState(draft, layer.id, state.id);
        if (target?.motion.kind === 'blend-2d') target.motion.parameterY = value;
      })),
    );
    motion.children.forEach((child, index) => {
      const childSection = document.createElement('div');
      childSection.className = 'blend-child';
      childSection.append(
        vectorField(`位置 ${index + 1}`, child.position, (component, value) => actions.commit('Set Blend Position', draft => {
          const target = findState(draft, layer.id, state.id);
          if (target?.motion.kind !== 'blend-2d') return;
          target.motion.children[index]!.position[component] = value;
        })),
        child.motion.kind === 'clip'
          ? selectField('片段', child.motion.clipId, clips, value => actions.commit('Set Blend Clip', draft => {
              const target = findState(draft, layer.id, state.id);
              const item = target?.motion.kind === 'blend-2d' ? target.motion.children[index] : undefined;
              if (item) item.motion = { kind: 'clip', clipId: value };
            }))
          : note('嵌套 Blend Tree 会被保留；当前检查器编辑根节点子项。'),
        actionRow([
          actionButton('移除子项', () => actions.commit('Remove Blend Child', draft => {
            const target = findState(draft, layer.id, state.id);
            if (target?.motion.kind === 'blend-2d' && target.motion.children.length > 1) {
              target.motion.children.splice(index, 1);
            }
          }), 'danger', motion.children.length <= 1),
        ]),
      );
      section.append(childSection);
    });
    section.append(actionRow([
      actionButton('添加子项', () => actions.commit('Add Blend Child', draft => {
        const target = findState(draft, layer.id, state.id);
        const clip = draft.timeline.clips[0];
        if (target?.motion.kind !== 'blend-2d' || !clip) return;
        const position: [number, number] = [target.motion.children.length, 0];
        target.motion.children.push({ position, motion: { kind: 'clip', clipId: clip.id } });
      })),
    ]));
  }
  host.append(section);
}

function renderTransition(
  host: HTMLElement,
  project: AnimationEditorProject,
  layer: AnimationEditorStateLayer,
  transition: AnimationEditorStateLayer['transitions'][number],
  actions: StateMachineInspectorActions,
): void {
  const section = propertySection('Transition', transition.id);
  const states = layer.states.map(state => ({ label: state.name, value: state.id }));
  section.append(
    selectField('来源', transition.from, [
      { label: 'Any State', value: '*' }, ...states,
    ], value => actions.commit('Set Transition Source', draft => {
      const target = findTransition(draft, layer.id, transition.id);
      if (target && value !== target.to) target.from = value;
    })),
    selectField('目标', transition.to, states, value => actions.commit('Set Transition Destination', draft => {
      const target = findTransition(draft, layer.id, transition.id);
      if (target && value !== target.from) target.to = value;
    })),
    numberField('混合时长', transition.duration, value => actions.commit('Set Transition Duration', draft => {
      const target = findTransition(draft, layer.id, transition.id);
      if (target) target.duration = Math.max(0, value);
    }), { min: 0, step: 0.01 }),
    checkRow(checkbox('使用退出时间', transition.hasExitTime === true, checked => actions.commit('Toggle Exit Time', draft => {
      const target = findTransition(draft, layer.id, transition.id);
      if (!target) return;
      target.hasExitTime = checked;
      if (checked) target.exitTime ??= 1;
      else delete target.exitTime;
    }))),
  );
  if (transition.hasExitTime === true) {
    section.append(numberField('退出时间', transition.exitTime ?? 1, value => actions.commit('Set Exit Time', draft => {
      const target = findTransition(draft, layer.id, transition.id);
      if (target) target.exitTime = Math.max(0, value);
    }), { min: 0, step: 0.01 }));
  }
  section.append(
    numberField('目标偏移', transition.destinationOffset ?? 0, value => actions.commit('Set Destination Offset', draft => {
      const target = findTransition(draft, layer.id, transition.id);
      if (target) target.destinationOffset = Math.max(0, value);
    }), { min: 0, step: 0.01 }),
    selectField('中断', transition.interruption ?? 'none', [
      { label: 'None', value: 'none' },
      { label: 'Source', value: 'source' },
      { label: 'Destination', value: 'destination' },
      { label: 'Source → Destination', value: 'source-then-destination' },
      { label: 'Destination → Source', value: 'destination-then-source' },
    ], value => actions.commit('Set Transition Interruption', draft => {
      const target = findTransition(draft, layer.id, transition.id);
      if (target) target.interruption = value as NonNullable<typeof target.interruption>;
    })),
  );
  host.append(section);

  const conditions = propertySection('Conditions', String(transition.conditions.length));
  transition.conditions.forEach((condition, index) => {
    conditions.append(renderCondition(project, layer, transition.id, condition, index, actions));
  });
  const parameter = project.stateMachine?.parameters[0];
  conditions.append(actionRow([
    actionButton('添加条件', () => {
      if (!parameter) return;
      actions.commit('Add Transition Condition', draft => {
        const target = findTransition(draft, layer.id, transition.id);
        const source = draft.stateMachine?.parameters[0];
        if (target && source) target.conditions.push(createStateMachineCondition(source));
      });
    }, 'normal', !parameter),
    actionButton('删除转场', () => actions.deleteTransition(layer.id, transition.id), 'danger'),
  ]));
  if (!parameter) conditions.append(note('添加状态机参数后才能创建转场条件。'));
  host.append(conditions);
}

function renderCondition(
  project: AnimationEditorProject,
  layer: AnimationEditorStateLayer,
  transitionId: string,
  condition: HyaStateMachineCondition,
  conditionIndex: number,
  actions: StateMachineInspectorActions,
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'condition-block';
  const parameters = project.stateMachine?.parameters ?? [];
  const parameter = parameters.find(candidate => candidate.name === condition.parameter)!;
  block.append(
    selectField('参数', condition.parameter, parameters.map(candidate => ({
      label: `${candidate.name} · ${candidate.type}`, value: candidate.name,
    })), value => actions.commit('Set Condition Parameter', draft => {
      const target = findTransition(draft, layer.id, transitionId);
      const source = draft.stateMachine?.parameters.find(candidate => candidate.name === value);
      if (target && source) target.conditions[conditionIndex] = createStateMachineCondition(source);
    })),
    selectField('比较', condition.operator, conditionOperatorsForParameter(parameter).map(operator => ({
      label: operator, value: operator,
    })), value => actions.commit('Set Condition Operator', draft => {
      const target = findTransition(draft, layer.id, transitionId);
      const existing = target?.conditions[conditionIndex];
      const source = draft.stateMachine?.parameters.find(candidate => candidate.name === existing?.parameter);
      if (!target || !existing || !source) return;
      const next = createStateMachineCondition(source) as unknown as {
        parameter: string;
        operator: string;
        value?: number | boolean;
      };
      next.operator = value;
      if (conditionNeedsValue(source, next.operator)) {
        next.value = source.type === 'boolean'
          ? true
          : source.type === 'float' || source.type === 'integer'
            ? source.defaultValue
            : 0;
      } else delete next.value;
      target.conditions[conditionIndex] = next as DeepMutable<HyaStateMachineCondition>;
    })),
  );
  if ('value' in condition) {
    if (parameter.type === 'boolean') {
      block.append(checkRow(checkbox('比较值', Boolean(condition.value), checked => actions.commit('Set Condition Value', draft => {
        const target = findTransition(draft, layer.id, transitionId)?.conditions[conditionIndex];
        if (target && 'value' in target) target.value = checked;
      }))));
    } else {
      block.append(numberField('比较值', Number(condition.value), value => actions.commit('Set Condition Value', draft => {
        const target = findTransition(draft, layer.id, transitionId)?.conditions[conditionIndex];
        if (target && 'value' in target) target.value = parameter.type === 'integer' ? Math.round(value) : value;
      }), { step: parameter.type === 'integer' ? 1 : 0.1 }));
    }
  }
  block.append(actionRow([
    actionButton('移除条件', () => actions.commit('Remove Transition Condition', draft => {
      const target = findTransition(draft, layer.id, transitionId);
      if (target) target.conditions.splice(conditionIndex, 1);
    }), 'danger'),
  ]));
  return block;
}

function conditionNeedsValue(parameter: HyaStateMachineParameter, operator: string): boolean {
  if (parameter.type === 'float' || parameter.type === 'integer') return true;
  return parameter.type === 'boolean' && (operator === 'equal' || operator === 'not-equal');
}

function findLayer(project: DeepMutable<AnimationEditorProject>, id: string): DeepMutable<AnimationEditorStateLayer> | undefined {
  return project.stateMachine?.layers.find(candidate => candidate.id === id);
}

function findState(
  project: DeepMutable<AnimationEditorProject>,
  layerId: string,
  stateId: string,
): DeepMutable<AnimationEditorState> | undefined {
  return findLayer(project, layerId)?.states.find(candidate => candidate.id === stateId);
}

function findTransition(
  project: DeepMutable<AnimationEditorProject>,
  layerId: string,
  transitionId: string,
): DeepMutable<AnimationEditorStateLayer['transitions'][number]> | undefined {
  return findLayer(project, layerId)?.transitions.find(candidate => candidate.id === transitionId);
}

function propertySection(title: string, badge = ''): HTMLElement {
  const section = document.createElement('section');
  section.className = 'property-section';
  const heading = document.createElement('div');
  heading.className = 'property-section-heading';
  const name = document.createElement('h3');
  name.textContent = localizeLiteral(title);
  heading.append(name);
  if (badge) {
    const tag = document.createElement('span');
    tag.textContent = badge;
    heading.append(tag);
  }
  section.append(heading);
  return section;
}

function textField(label: string, value: string, commit: (value: string) => unknown): HTMLElement {
  const input = document.createElement('ge-input') as GEInput;
  input.type = 'text';
  input.value = value;
  input.setAttribute('aria-label', localizeLiteral(label));
  input.addEventListener('value-change', event => {
    const detail = (event as CustomEvent<GEInputChangeDetail>).detail;
    if (detail.valid && detail.value !== value) commit(detail.value);
  });
  return field(label, input);
}

function numberField(
  label: string,
  value: number,
  commit: (value: number) => unknown,
  options: { readonly min?: number; readonly max?: number; readonly step?: number } = {},
): HTMLElement {
  const input = document.createElement('ge-input') as GEInput;
  input.type = 'number';
  input.value = String(Number(value.toFixed(4)));
  input.setAttribute('aria-label', localizeLiteral(label));
  if (options.min !== undefined) input.setAttribute('min', String(options.min));
  if (options.max !== undefined) input.setAttribute('max', String(options.max));
  input.setAttribute('step', String(options.step ?? 0.1));
  input.addEventListener('value-change', event => {
    const detail = (event as CustomEvent<GEInputChangeDetail>).detail;
    if (detail.valid && detail.valueAsNumber !== null && detail.valueAsNumber !== value) commit(detail.valueAsNumber);
  });
  return field(label, input);
}

function vectorField(
  label: string,
  value: readonly [number, number],
  commit: (component: 0 | 1, value: number) => unknown,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'inspector-vector';
  for (const component of [0, 1] as const) {
    const input = numberField(`${label} ${component === 0 ? 'X' : 'Y'}`, value[component], next => commit(component, next));
    row.append(input.querySelector('ge-input')!);
  }
  return field(label, row);
}

function selectField(
  label: string,
  value: string,
  options: readonly GESelectOption[],
  commit: (value: string) => unknown,
): HTMLElement {
  const select = document.createElement('ge-select') as GESelect;
  select.options = options.map(option => ({ ...option, label: localizeLiteral(option.label) }));
  select.value = value;
  select.label = localizeLiteral(label);
  select.addEventListener('value-change', event => {
    const next = (event as CustomEvent<GESelectChangeDetail>).detail.value;
    if (next !== value) commit(next);
  });
  return field(label, select);
}

function checkbox(label: string, checked: boolean, commit: (checked: boolean) => unknown): GECheckbox {
  const input = document.createElement('ge-checkbox') as GECheckbox;
  input.label = localizeLiteral(label);
  input.checked = checked;
  input.addEventListener('checked-change', event => commit(
    (event as CustomEvent<GECheckboxChangeDetail>).detail.checked,
  ));
  return input;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('label');
  row.className = 'inspector-field';
  const text = document.createElement('span');
  text.textContent = localizeLiteral(label);
  row.append(text, control);
  return row;
}

function checkRow(control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'inspector-checks';
  row.append(control);
  return row;
}

function readOnlyRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'property-row';
  row.append(textElement('span', localizeLiteral(label)), textElement('span', value, 'property-value'));
  return row;
}

function actionRow(buttons: readonly HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'inspector-actions';
  row.append(...buttons);
  return row;
}

function actionButton(
  label: string,
  action: () => unknown,
  tone: 'normal' | 'danger' = 'normal',
  disabled = false,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = localizeLiteral(label);
  button.disabled = disabled;
  if (tone === 'danger') button.classList.add('inspector-error');
  button.addEventListener('click', action);
  return button;
}

function note(message: string): HTMLElement {
  const value = document.createElement('p');
  value.className = 'inspector-note';
  value.textContent = localizeLiteral(message);
  return value;
}

function emptyMessage(title: string, detail: string): HTMLElement {
  const value = document.createElement('div');
  value.className = 'empty-inspector';
  value.append(textElement('strong', localizeLiteral(title)), textElement('span', localizeLiteral(detail)));
  return value;
}

function textElement(tag: string, text: string, className = ''): HTMLElement {
  const value = document.createElement(tag);
  value.className = className;
  value.textContent = text;
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
