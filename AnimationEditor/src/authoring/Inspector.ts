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
  AnimationEditorAsset,
  AnimationEditorClip,
  AnimationEditorKeyframe,
  AnimationEditorNode,
  AnimationEditorProject,
  AnimationEditorTrack,
  DeepMutable,
  JsonValue,
} from '../domain/AnimationEditorProject';
import type { AnimationEditorSelectionItem } from '../domain/SelectionStore';
import { minimumCompositionDuration } from '../domain/CompositionAuthoring';
import {
  MAX_SPRITE_SHEET_COLUMNS,
  MAX_SPRITE_SHEET_ROWS,
  inferSpriteSheetGrid,
  spriteSheetFrameIndex,
} from '../domain/SpriteSheetAuthoring';
import { animationNodeContentKind } from '../domain/SceneAuthoring';
import {
  moveTimelineKeyframe,
  timelineTrackValueLabels,
} from '../domain/TimelineAuthoring';
import { localizedText, localizeLiteral } from '../localization';
import {
  createAdvancedEffect,
  createCompositeLayer,
  isStepOnlyAdvancedTrack,
  type AdvancedEffectKind,
} from '../domain/AdvancedContentAuthoring';

export interface AnimationEditorInspectorActions {
  readonly commit: (
    label: string,
    mutation: (draft: DeepMutable<AnimationEditorProject>) => void,
  ) => boolean;
  readonly deleteAsset: (assetId: string) => void;
  readonly deleteNodes: (nodeIds: readonly string[]) => void;
  readonly addKeyframe: (trackId: string) => void;
  readonly deleteTracks: (trackIds: readonly string[]) => void;
  readonly deleteKeyframes: (references: readonly Readonly<{ trackId: string; keyframeId: string }>[]) => void;
  readonly deleteClips: (clipIds: readonly string[]) => void;
  readonly seek: (time: number) => void;
  readonly currentTime: () => number;
  readonly setCompositionDuration: (duration: number) => void;
  readonly setSpriteSheetFrame: (
    nodeId: string,
    componentId: string,
    columns: number,
    rows: number,
    frame: number,
  ) => void;
  readonly generateSpriteSheetAnimation: (
    nodeId: string,
    componentId: string,
    columns: number,
    rows: number,
  ) => void;
}

export function renderAnimationEditorInspector(
  host: HTMLElement,
  project: AnimationEditorProject,
  primary: AnimationEditorSelectionItem | null,
  actions: AnimationEditorInspectorActions,
): void {
  host.replaceChildren();
  if (!primary) {
    renderCompositionInspector(host, project, actions);
    return;
  }
  if (primary.kind === 'asset') {
    const asset = project.assets.find(candidate => candidate.id === primary.id);
    if (asset) renderAssetInspector(host, asset, actions);
    else host.append(emptyMessage('资源不存在', primary.id));
    return;
  }
  if (primary.kind === 'node') {
    const node = project.nodes.find(candidate => candidate.id === primary.id);
    if (node) renderNodeInspector(host, project, node, actions);
    else host.append(emptyMessage('节点不存在', primary.id));
    return;
  }
  if (primary.kind === 'track') {
    const track = project.timeline.tracks.find(candidate => candidate.id === primary.id);
    if (track) renderTrackInspector(host, project, track, actions);
    else host.append(emptyMessage('轨道不存在', primary.id));
    return;
  }
  if (primary.kind === 'keyframe') {
    const track = project.timeline.tracks.find(candidate => candidate.id === primary.ownerId);
    const keyframe = track?.keyframes.find(candidate => candidate.id === primary.id);
    if (track && keyframe) renderKeyframeInspector(host, project, track, keyframe, actions);
    else host.append(emptyMessage('关键帧不存在', primary.id));
    return;
  }
  if (primary.kind === 'clip') {
    const clip = project.timeline.clips.find(candidate => candidate.id === primary.id);
    if (clip) renderClipInspector(host, project, clip, actions);
    else host.append(emptyMessage('动画片段不存在', primary.id));
    return;
  }
  host.append(emptyMessage('暂不可编辑', `${primary.kind}:${primary.id}`));
}

function renderCompositionInspector(
  host: HTMLElement,
  project: AnimationEditorProject,
  actions: AnimationEditorInspectorActions,
): void {
  const minimumDuration = minimumCompositionDuration(project);
  const section = propertySection('合成设置', 'PROJECT');
  section.append(
    textField('工程名称', project.name, value => actions.commit('Rename Project', draft => {
      if (value.trim()) draft.name = value.trim();
    })),
    numberField('总时长（秒）', project.composition.duration, actions.setCompositionDuration, {
      min: minimumDuration,
      step: 1 / project.composition.frameRate,
    }),
    readOnlyRow('帧率', `${project.composition.frameRate} FPS`),
    readOnlyRow('画布', `${project.composition.canvas.width} × ${project.composition.canvas.height}`),
    selectField('结束行为', project.composition.endBehavior, [
      { label: '停留在末帧', value: 'hold' },
      { label: '循环播放', value: 'loop' },
      { label: '播放后销毁', value: 'destroy' },
    ], value => actions.commit('Set End Behavior', draft => {
      draft.composition.endBehavior = value as AnimationEditorProject['composition']['endBehavior'];
    })),
  );
  section.append(note(
    minimumDuration > 1 / project.composition.frameRate
      ? `当前内容需要至少 ${roundDisplay(minimumDuration)} 秒；缩短时不会裁掉关键帧、片段或节点。`
      : `时长按 ${project.composition.frameRate} FPS 对齐，修改后会同步时间轴与运行时预览。`,
  ));
  host.append(section);
}

function renderTrackInspector(
  host: HTMLElement,
  project: AnimationEditorProject,
  track: AnimationEditorTrack,
  actions: AnimationEditorInspectorActions,
): void {
  const node = project.nodes.find(candidate => candidate.id === track.target.nodeId);
  const section = propertySection('Timeline Track', track.target.kind);
  section.append(
    textField('名称', track.name, value => actions.commit('Rename Track', draft => {
      const target = draft.timeline.tracks.find(candidate => candidate.id === track.id);
      if (target && value.trim()) target.name = value.trim();
    })),
    readOnlyRow('ID', track.id),
    readOnlyRow('节点', node?.name ?? track.target.nodeId),
    readOnlyRow('绑定', trackTargetLabel(track)),
    hexColorField('颜色', track.color ?? '#58a6ff', value => actions.commit('Set Track Color', draft => {
      const target = draft.timeline.tracks.find(candidate => candidate.id === track.id);
      if (target) target.color = value;
    })),
  );
  const checks = document.createElement('div');
  checks.className = 'inspector-checks';
  checks.append(checkbox('启用轨道', track.enabled !== false, enabled => actions.commit('Toggle Track', draft => {
    const target = draft.timeline.tracks.find(candidate => candidate.id === track.id);
    if (target) target.enabled = enabled;
  })));
  section.append(checks, readOnlyRow('关键帧', String(track.keyframes.length)));
  section.append(actionRow([
    actionButton('在播放头添加关键帧', () => actions.addKeyframe(track.id)),
    actionButton('删除轨道', () => actions.deleteTracks([track.id]), 'danger'),
  ]));
  host.append(section);
}

function renderKeyframeInspector(
  host: HTMLElement,
  project: AnimationEditorProject,
  track: AnimationEditorTrack,
  keyframe: AnimationEditorKeyframe,
  actions: AnimationEditorInspectorActions,
): void {
  const section = propertySection('Keyframe', track.name);
  section.append(
    readOnlyRow('ID', keyframe.id),
    numberField('时间（秒）', keyframe.time, value => actions.commit('Move Keyframe', draft => {
      moveTimelineKeyframe(draft, track.id, keyframe.id, value);
    }), { min: 0, max: project.composition.duration, step: 1 / project.composition.frameRate }),
  );
  const labels = timelineTrackValueLabels(track);
  keyframe.value.forEach((component, index) => section.append(numberField(
    labels[index] ?? `Value ${index + 1}`,
    component,
    value => actions.commit('Set Keyframe Value', draft => {
      const target = findKeyframe(draft, track.id, keyframe.id);
      if (!target) return;
      target.value[index] = track.target.kind === 'node-transform'
        && track.target.property === 'opacity'
        ? clamp(value, 0, 1)
        : value;
    }),
    track.target.kind === 'node-transform' && track.target.property === 'opacity'
      ? { min: 0, max: 1, step: 0.01 }
      : { step: 0.1 },
  )));
  const interpolationOptions = isStepOnlyAdvancedTrack(track)
    ? [{ label: 'Step', value: 'step' }]
    : [
        { label: 'Step', value: 'step' },
        { label: 'Linear', value: 'linear' },
        { label: 'Cubic Bézier', value: 'cubic-bezier' },
      ];
  section.append(selectField('插值', keyframe.interpolation, interpolationOptions, value => actions.commit('Set Keyframe Interpolation', draft => {
    const target = findKeyframe(draft, track.id, keyframe.id);
    if (!target) return;
    target.interpolation = value as AnimationEditorKeyframe['interpolation'];
    if (value === 'cubic-bezier') target.easing ??= [0.25, 0.1, 0.25, 1];
    else delete target.easing;
  })));
  section.append(actionRow([
    actionButton('跳到此帧', () => actions.seek(keyframe.time)),
    actionButton(
      '删除关键帧',
      () => actions.deleteKeyframes([{ trackId: track.id, keyframeId: keyframe.id }]),
      'danger',
      track.keyframes.length <= 1,
    ),
  ]));
  host.append(section);

  if (keyframe.interpolation === 'cubic-bezier') {
    const easing = keyframe.easing ?? [0.25, 0.1, 0.25, 1];
    const easingSection = propertySection('Temporal Easing', 'cubic-bezier');
    ['X1', 'Y1', 'X2', 'Y2'].forEach((label, index) => easingSection.append(numberField(
      label,
      easing[index]!,
      value => actions.commit('Set Keyframe Easing', draft => {
        const target = findKeyframe(draft, track.id, keyframe.id);
        if (!target) return;
        const next = [...(target.easing ?? [0.25, 0.1, 0.25, 1])] as [number, number, number, number];
        next[index] = index === 0 || index === 2 ? clamp(value, 0, 1) : value;
        target.easing = next;
      }),
      index === 0 || index === 2 ? { min: 0, max: 1, step: 0.01 } : { step: 0.01 },
    )));
    host.append(easingSection);
  }

  if (track.target.kind === 'node-transform' && track.target.property === 'position') {
    const spatial = propertySection('Spatial Bézier', 'position');
    spatial.append(
      vectorField('进入手柄', keyframe.spatialIn ?? [0, 0], (index, value) => actions.commit('Set Spatial In', draft => {
        const target = findKeyframe(draft, track.id, keyframe.id);
        if (!target) return;
        const next = [...(target.spatialIn ?? [0, 0])] as [number, number];
        next[index] = value;
        target.spatialIn = next;
      })),
      vectorField('离开手柄', keyframe.spatialOut ?? [0, 0], (index, value) => actions.commit('Set Spatial Out', draft => {
        const target = findKeyframe(draft, track.id, keyframe.id);
        if (!target) return;
        const next = [...(target.spatialOut ?? [0, 0])] as [number, number];
        next[index] = value;
        target.spatialOut = next;
      })),
      actionRow([
        actionButton('清除空间手柄', () => actions.commit('Clear Spatial Handles', draft => {
          const target = findKeyframe(draft, track.id, keyframe.id);
          if (!target) return;
          delete target.spatialIn;
          delete target.spatialOut;
        })),
      ]),
    );
    host.append(spatial);
  }
}

function renderClipInspector(
  host: HTMLElement,
  project: AnimationEditorProject,
  clip: AnimationEditorClip,
  actions: AnimationEditorInspectorActions,
): void {
  const section = propertySection('Animation Clip', 'named range');
  section.append(
    textField('名称', clip.name, value => actions.commit('Rename Clip', draft => {
      const target = draft.timeline.clips.find(candidate => candidate.id === clip.id);
      if (target && value.trim()) target.name = value.trim();
    })),
    readOnlyRow('ID', clip.id),
    numberField('开始', clip.start, value => actions.commit('Set Clip Start', draft => {
      const target = draft.timeline.clips.find(candidate => candidate.id === clip.id);
      if (!target) return;
      target.start = clamp(value, 0, draft.composition.duration - 1 / draft.composition.frameRate);
      target.duration = Math.min(target.duration, draft.composition.duration - target.start);
    }), { min: 0, max: project.composition.duration, step: 1 / project.composition.frameRate }),
    numberField('时长', clip.duration, value => actions.commit('Set Clip Duration', draft => {
      const target = draft.timeline.clips.find(candidate => candidate.id === clip.id);
      if (target) target.duration = clamp(
        value,
        1 / draft.composition.frameRate,
        draft.composition.duration - target.start,
      );
    }), { min: 1 / project.composition.frameRate, max: project.composition.duration - clip.start, step: 1 / project.composition.frameRate }),
    hexColorField('颜色', clip.color ?? '#3fb950', value => actions.commit('Set Clip Color', draft => {
      const target = draft.timeline.clips.find(candidate => candidate.id === clip.id);
      if (target) target.color = value;
    })),
    actionRow([
      actionButton('跳到片段开始', () => actions.seek(clip.start)),
      actionButton('删除片段', () => actions.deleteClips([clip.id]), 'danger'),
    ]),
  );
  if (!project.stateMachine) {
    section.append(note('命名片段已保存在工程中；创建状态机后会写入 HYA 扩展。'));
  }
  host.append(section);
}

function renderAssetInspector(
  host: HTMLElement,
  asset: AnimationEditorAsset,
  actions: AnimationEditorInspectorActions,
): void {
  const section = propertySection('Asset', asset.type);
  section.append(
    textField('名称', asset.name, value => actions.commit('Rename Asset', draft => {
      const target = draft.assets.find(candidate => candidate.id === asset.id);
      if (target && value.trim()) target.name = value.trim();
    })),
    readOnlyRow('ID', asset.id),
    readOnlyRow('类型', asset.type),
    readOnlyRow('MIME', asset.delivery.mimeType ?? '—'),
  );
  if (asset.type === 'image') {
    section.append(readOnlyRow(
      '尺寸',
      asset.delivery.width && asset.delivery.height
        ? `${asset.delivery.width} × ${asset.delivery.height}`
        : '未知',
    ));
  }
  if (asset.source.kind === 'embedded') {
    section.append(readOnlyRow('工程数据', formatBytes(Math.floor(asset.source.data.length * 0.75))));
  }
  section.append(actionRow([
    actionButton('删除资源', () => actions.deleteAsset(asset.id), 'danger'),
  ]));
  host.append(section);
}

function renderNodeInspector(
  host: HTMLElement,
  project: AnimationEditorProject,
  node: AnimationEditorNode,
  actions: AnimationEditorInspectorActions,
): void {
  const locked = node.editor?.locked === true;
  const nodeSection = propertySection('Node', animationNodeContentKind(node));
  nodeSection.append(
    textField('名称', node.name, value => actions.commit('Rename Node', draft => {
      const target = findNode(draft, node.id);
      if (target && value.trim()) target.name = value.trim();
    }), { disabled: locked }),
    readOnlyRow('ID', node.id),
    selectField('父节点', node.parent ?? '', [
      { label: 'Composition Root', value: '' },
      ...project.nodes
        .filter(candidate => candidate.id !== node.id && !isDescendant(project.nodes, candidate.id, node.id))
        .map(candidate => ({ label: candidate.name, value: candidate.id })),
    ], value => actions.commit('Change Node Parent', draft => {
      const target = findNode(draft, node.id);
      if (!target) return;
      if (value) target.parent = value;
      else delete target.parent;
    }), { disabled: locked }),
  );
  const checks = document.createElement('div');
  checks.className = 'inspector-checks';
  checks.append(
    checkbox('锁定编辑', locked, checked => actions.commit('Toggle Node Lock', draft => {
      const target = findNode(draft, node.id);
      if (!target) return;
      target.editor ??= {};
      target.editor.locked = checked;
    })),
    checkbox('在预览中隐藏', node.editor?.hidden === true, checked => actions.commit('Toggle Node Visibility', draft => {
      const target = findNode(draft, node.id);
      if (!target) return;
      target.editor ??= {};
      target.editor.hidden = checked;
    })),
  );
  nodeSection.append(checks);

  const range = propertySection('Local Range');
  const start = node.start ?? 0;
  const duration = node.duration ?? project.composition.duration - start;
  range.append(
    numberField('开始', start, value => actions.commit('Set Node Start', draft => {
      const target = findNode(draft, node.id);
      if (!target) return;
      const safe = clamp(value, 0, Math.max(0, draft.composition.duration - 0.001));
      target.start = safe;
      const currentDuration = target.duration ?? draft.composition.duration - safe;
      target.duration = Math.min(currentDuration, draft.composition.duration - safe);
    }), { min: 0, max: project.composition.duration, step: 0.01, disabled: locked }),
    numberField('时长', duration, value => actions.commit('Set Node Duration', draft => {
      const target = findNode(draft, node.id);
      if (!target) return;
      const nodeStart = target.start ?? 0;
      target.duration = clamp(value, 0.001, draft.composition.duration - nodeStart);
    }), { min: 0.001, max: project.composition.duration - start, step: 0.01, disabled: locked }),
  );

  const transform = propertySection('Transform');
  const position = node.transform.position ?? [0, 0];
  const scale = node.transform.scale ?? [1, 1];
  const anchor = node.transform.anchor ?? [0, 0];
  transform.append(
    vectorField('位置', position, (component, value) => actions.commit('Set Node Position', draft => {
      const target = findNode(draft, node.id);
      if (!target) return;
      const next = [...(target.transform.position ?? [0, 0])] as [number, number];
      next[component] = value;
      target.transform.position = next;
    }), { disabled: locked }),
    numberField('旋转', node.transform.rotation ?? 0, value => actions.commit('Set Node Rotation', draft => {
      const target = findNode(draft, node.id);
      if (target) target.transform.rotation = value;
    }), { step: 0.1, disabled: locked }),
    vectorField('缩放', scale, (component, value) => actions.commit('Set Node Scale', draft => {
      const target = findNode(draft, node.id);
      if (!target) return;
      const next = [...(target.transform.scale ?? [1, 1])] as [number, number];
      next[component] = value;
      target.transform.scale = next;
    }), { step: 0.01, disabled: locked }),
    vectorField('锚点', anchor, (component, value) => actions.commit('Set Node Anchor', draft => {
      const target = findNode(draft, node.id);
      if (!target) return;
      const next = [...(target.transform.anchor ?? [0, 0])] as [number, number];
      next[component] = value;
      target.transform.anchor = next;
    }), { disabled: locked }),
    numberField('透明度', node.transform.opacity ?? 1, value => actions.commit('Set Node Opacity', draft => {
      const target = findNode(draft, node.id);
      if (target) target.transform.opacity = clamp(value, 0, 1);
    }), { min: 0, max: 1, step: 0.01, disabled: locked }),
  );

  host.append(nodeSection, range, transform);
  for (const component of node.components) {
    host.append(componentSection(project, node, component.id, actions, locked));
  }
  for (const effect of node.effects) {
    host.append(effectSection(node, effect.id, actions, locked));
  }
  for (const layer of node.compositeLayers) {
    host.append(compositeSection(project, node, layer.id, actions, locked));
  }
  const advanced = propertySection('Advanced Content', 'HYA 1.0');
  const effectKinds: readonly AdvancedEffectKind[] = ['tint', 'fill', 'opacity', 'color-matrix', 'blur', 'drop-shadow'];
  advanced.append(
    note('效果与合成层保持数组顺序；新增属性会立即出现在“＋轨道”菜单。'),
    actionRow(effectKinds.map(kind => actionButton(`＋ ${effectLabel(kind)}`, () => actions.commit('Add Effect', draft => {
      const target = findNode(draft, node.id);
      if (target) target.effects.push(createAdvancedEffect(project, node.id, kind));
    }), 'normal', locked || node.effects.length >= 8))),
    actionRow([
      actionButton('＋ Mask / Matte', () => actions.commit('Add Composite Layer', draft => {
        const target = findNode(draft, node.id);
        if (target) target.compositeLayers.push(createCompositeLayer(project, node.id));
      }), 'normal', locked || node.compositeLayers.length >= 8 || project.nodes.length < 2),
    ]),
  );
  host.append(advanced);
  const nodeActions = propertySection('Actions');
  nodeActions.append(actionRow([
    actionButton('删除节点', () => actions.deleteNodes([node.id]), 'danger', locked),
  ]));
  host.append(nodeActions);
}

function componentSection(
  project: AnimationEditorProject,
  node: AnimationEditorNode,
  componentId: string,
  actions: AnimationEditorInspectorActions,
  disabled: boolean,
): HTMLElement {
  const record = node.components.find(candidate => candidate.id === componentId)!;
  const component = record.component;
  const section = propertySection(record.name ?? 'Component', component.type);

  if (component.type === 'shape2d') {
    const size = numberPair(component.size, [100, 100]);
    const fill = colorValue(component.fill, [1, 1, 1, 1]);
    section.append(
      selectField('形状', String(component.shape ?? 'rect'), [
        { label: 'Rectangle', value: 'rect' },
        { label: 'Ellipse', value: 'ellipse' },
      ], value => updateComponent(actions, node.id, componentId, 'Change Shape Type', target => {
        target.shape = value;
      }), { disabled }),
      vectorField('尺寸', size, (index, value) => updateComponent(actions, node.id, componentId, 'Set Shape Size', target => {
        const next = numberPair(target.size, [100, 100]);
        next[index] = Math.max(0.001, value);
        target.size = next;
      }), { min: 0.001, disabled }),
      colorField('填充', fill, value => updateComponent(actions, node.id, componentId, 'Set Shape Fill', target => {
        const current = colorValue(target.fill, [1, 1, 1, 1]);
        target.fill = [...value, current[3]];
      }), { disabled }),
      numberField('填充 Alpha', fill[3], value => updateComponent(actions, node.id, componentId, 'Set Shape Alpha', target => {
        const current = colorValue(target.fill, [1, 1, 1, 1]);
        current[3] = clamp(value, 0, 1);
        target.fill = current;
      }), { min: 0, max: 1, step: 0.01, disabled }),
    );
  } else if (component.type === 'path2d') {
    const fill = colorValue(component.fill, [1, 1, 1, 1]);
    section.append(
      readOnlyRow('拓扑', String(component.commands ?? '—')),
      colorField('填充', fill, value => updateComponent(actions, node.id, componentId, 'Set Path Fill', target => {
        const current = colorValue(target.fill, [1, 1, 1, 1]);
        target.fill = [...value, current[3]];
      }), { disabled }),
      numberField('填充 Alpha', fill[3], value => updateComponent(actions, node.id, componentId, 'Set Path Alpha', target => {
        const current = colorValue(target.fill, [1, 1, 1, 1]);
        current[3] = clamp(value, 0, 1);
        target.fill = current;
      }), { min: 0, max: 1, step: 0.01, disabled }),
      note('基础 Path 使用单色填充；新建 Vector Shape 可编辑描边、Trim Path、圆角和 Morph 轨道。'),
    );
  } else if (component.type === 'org.haiyue.vector-shape@1') {
    const fillPayload = objectRecord(component.fill);
    const strokePayload = objectRecord(component.stroke);
    const modifiers = Array.isArray(component.modifiers) ? component.modifiers : [];
    const trim = objectRecord(modifiers[0]);
    const round = objectRecord(modifiers[1]);
    const fillKind = fillPayload?.kind === 'linear-gradient' || fillPayload?.kind === 'radial-gradient'
      ? fillPayload.kind
      : 'solid';
    const fill = colorValue(fillPayload?.color, [0.18, 0.78, 0.63, 1]);
    const stroke = colorValue(strokePayload?.color, [1, 1, 1, 1]);
    section.append(
      readOnlyRow('拓扑', String(component.commands ?? '—')),
      readOnlyRow('控制值', String(Array.isArray(component.values) ? component.values.length : 0)),
      selectField('填充类型', fillKind, [
        { label: 'Solid', value: 'solid' },
        { label: 'Linear Gradient', value: 'linear-gradient' },
        { label: 'Radial Gradient', value: 'radial-gradient' },
      ], value => updateNestedComponent(actions, node.id, componentId, 'Set Vector Fill Type', target => {
        const current = objectRecord(target.fill);
        const opacity = finiteValue(current?.opacity, 1);
        if (value === 'solid') target.fill = { kind: 'solid', color: [0.18, 0.78, 0.63, 1], opacity };
        else target.fill = {
          kind: value, start: [-72, 0], end: [72, 0],
          stops: [0, 0.18, 0.78, 0.63, 1, 1, 0.55, 0.35, 1, 1], opacity,
        };
      }), { disabled }),
      colorField('描边', stroke, value => updateNestedComponent(actions, node.id, componentId, 'Set Vector Stroke', target => {
        const paint = objectRecord(target.stroke);
        if (paint) paint.color = [...value, colorValue(paint.color, stroke)[3]];
      }), { disabled }),
      numberField('描边宽度', finiteValue(strokePayload?.width, 5), value => updateNestedComponent(actions, node.id, componentId, 'Set Stroke Width', target => {
        const paint = objectRecord(target.stroke);
        if (paint) paint.width = Math.max(0, value);
      }), { min: 0, step: 0.5, disabled }),
      numberField('Trim 开始', finiteValue(trim?.start, 0), value => updateModifier(actions, node.id, componentId, 0, 'Set Trim Start', modifier => {
        modifier.start = value;
      }), { step: 0.01, disabled }),
      numberField('Trim 结束', finiteValue(trim?.end, 1), value => updateModifier(actions, node.id, componentId, 0, 'Set Trim End', modifier => {
        modifier.end = value;
      }), { step: 0.01, disabled }),
      numberField('圆角半径', finiteValue(round?.radius, 8), value => updateModifier(actions, node.id, componentId, 1, 'Set Round Corners', modifier => {
        modifier.radius = Math.max(0, value);
      }), { min: 0, step: 0.5, disabled }),
    );
    if (fillKind === 'solid') {
      section.append(colorField('填充', fill, value => updateNestedComponent(actions, node.id, componentId, 'Set Vector Fill', target => {
        const paint = objectRecord(target.fill);
        if (paint) paint.color = [...value, colorValue(paint.color, fill)[3]];
      }), { disabled }));
    } else {
      const stops = numericVector(fillPayload?.stops, 10, [0, 0.18, 0.78, 0.63, 1, 1, 0.55, 0.35, 1, 1]);
      section.append(
        vectorField('渐变起点', numberPair(fillPayload?.start, [-72, 0]), (index, value) => updateGradient(actions, node.id, componentId, 'Set Gradient Start', paint => {
          const next = numberPair(paint.start, [-72, 0]); next[index] = value; paint.start = next;
        }), { disabled }),
        vectorField('渐变终点', numberPair(fillPayload?.end, [72, 0]), (index, value) => updateGradient(actions, node.id, componentId, 'Set Gradient End', paint => {
          const next = numberPair(paint.end, [72, 0]); next[index] = value; paint.end = next;
        }), { disabled }),
        colorField('色标 A', [stops[1]!, stops[2]!, stops[3]!, stops[4]!], value => updateGradientStop(actions, node.id, componentId, 0, value), { disabled }),
        colorField('色标 B', [stops[6]!, stops[7]!, stops[8]!, stops[9]!], value => updateGradientStop(actions, node.id, componentId, 1, value), { disabled }),
      );
    }
    section.append(note('Morph、填充/渐变、描边、Trim Path 与圆角都可从时间轴“＋轨道”菜单添加。'));
  } else if (component.type === 'text2d') {
    const size = numberPair(component.size, [240, 80]);
    const color = colorValue(component.color, [1, 1, 1, 1]);
    section.append(
      textField('文本', String(component.text ?? ''), value => updateComponent(actions, node.id, componentId, 'Set Text Content', target => {
        target.text = value;
        const documents = Array.isArray(target.documents) ? target.documents : [];
        const first = objectRecord(documents[0]);
        if (actions.currentTime() <= 0.5 / project.composition.frameRate
          && first && finiteValue(first.time, -1) === 0) first.text = value;
      }), { disabled }),
      vectorField('文本框', size, (index, value) => updateComponent(actions, node.id, componentId, 'Set Text Size', target => {
        const next = numberPair(target.size, [240, 80]);
        next[index] = Math.max(0.001, value);
        target.size = next;
      }), { min: 0.001, disabled }),
      colorField('颜色', color, value => updateComponent(actions, node.id, componentId, 'Set Text Color', target => {
        const current = colorValue(target.color, [1, 1, 1, 1]);
        target.color = [...value, current[3]];
      }), { disabled }),
      textField('字体', String(component.fontFamily ?? 'system-ui'), value => updateComponent(actions, node.id, componentId, 'Set Text Font', target => {
        if (value.trim()) target.fontFamily = value.trim();
      }), { disabled }),
      numberField('字号', finiteValue(component.fontSize, 32), value => updateComponent(actions, node.id, componentId, 'Set Font Size', target => {
        target.fontSize = Math.max(0.001, value);
      }), { min: 0.001, step: 1, disabled }),
      numberField('字重', finiteValue(component.fontWeight, 400), value => updateComponent(actions, node.id, componentId, 'Set Font Weight', target => {
        target.fontWeight = Math.round(clamp(value, 1, 1000));
      }), { min: 1, max: 1000, step: 1, disabled }),
      selectField('水平对齐', String(component.textAlign ?? 'left'), [
        { label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' },
      ], value => updateComponent(actions, node.id, componentId, 'Set Text Align', target => { target.textAlign = value; }), { disabled }),
      selectField('垂直对齐', String(component.verticalAlign ?? 'top'), [
        { label: 'Top', value: 'top' }, { label: 'Middle', value: 'middle' }, { label: 'Bottom', value: 'bottom' },
      ], value => updateComponent(actions, node.id, componentId, 'Set Text Vertical Align', target => { target.verticalAlign = value; }), { disabled }),
    );
    const animators = Array.isArray(component.animators) ? component.animators : [];
    const animator = objectRecord(animators[0]);
    const selector = objectRecord(animator?.selector);
    if (animator && selector) {
      section.append(
        numberField('选择器开始', finiteValue(selector.start, 0), value => updateTextAnimator(actions, node.id, componentId, 'Set Text Selector Start', target => {
          const range = objectRecord(target.selector); if (range) range.start = value;
        }), { step: 1, disabled }),
        numberField('选择器结束', finiteValue(selector.end, 100), value => updateTextAnimator(actions, node.id, componentId, 'Set Text Selector End', target => {
          const range = objectRecord(target.selector); if (range) range.end = value;
        }), { step: 1, disabled }),
        vectorField('字符位移', numberPair(animator.position, [0, 0]), (index, value) => updateTextAnimator(actions, node.id, componentId, 'Set Character Position', target => {
          const next = numberPair(target.position, [0, 0]); next[index] = value; target.position = next;
        }), { disabled }),
        numberField('字符旋转', finiteValue(animator.rotation, 0), value => updateTextAnimator(actions, node.id, componentId, 'Set Character Rotation', target => {
          target.rotation = value;
        }), { step: 0.5, disabled }),
        note('选择器与字符 Animator 属性可创建 typed 轨道；文档帧以 Step 语义切换。'),
      );
    }
    section.append(actionRow([
      actionButton('记录文本 Document', () => updateComponent(actions, node.id, componentId, 'Add Text Document', target => {
        const time = actions.currentTime();
        const documents = Array.isArray(target.documents) ? target.documents : [];
        const next = documents.filter(value => finiteValue(objectRecord(value)?.time, -1) !== time);
        next.push({ time, text: String(target.text ?? '') });
        next.sort((left, right) => finiteValue(objectRecord(left)?.time, 0) - finiteValue(objectRecord(right)?.time, 0));
        target.documents = next;
      }), 'normal', disabled),
    ]));
  } else if (component.type === 'sprite2d') {
    const size = numberPair(component.size, [160, 160]);
    const tint = colorValue(component.tint, [1, 1, 1, 1]);
    const images = project.assets.filter(asset => asset.type === 'image');
    const activeImage = images.find(asset => asset.id === component.resource);
    const uvRect = numericVector(component.uvRect, 4, [0, 0, 1, 1]);
    const spriteSheetGrid = inferSpriteSheetGrid(uvRect);
    const spriteSheetFrame = spriteSheetFrameIndex(
      uvRect,
      spriteSheetGrid.columns,
      spriteSheetGrid.rows,
    );
    section.append(
      selectField('图片资源', String(component.resource ?? ''), images.map(asset => ({ label: asset.name, value: asset.id })), value => (
        updateComponent(actions, node.id, componentId, 'Set Sprite Resource', target => { target.resource = value; })
      ), { disabled: disabled || images.length === 0 }),
      vectorField('尺寸', size, (index, value) => updateComponent(actions, node.id, componentId, 'Set Sprite Size', target => {
        const next = numberPair(target.size, [160, 160]);
        next[index] = Math.max(0.001, value);
        target.size = next;
      }), { min: 0.001, disabled }),
      colorField('Tint', tint, value => updateComponent(actions, node.id, componentId, 'Set Sprite Tint', target => {
        const current = colorValue(target.tint, [1, 1, 1, 1]);
        target.tint = [...value, current[3]];
      }), { disabled }),
      numberField('Tint Alpha', tint[3], value => updateComponent(actions, node.id, componentId, 'Set Sprite Alpha', target => {
        const current = colorValue(target.tint, [1, 1, 1, 1]);
        current[3] = clamp(value, 0, 1);
        target.tint = current;
      }), { min: 0, max: 1, step: 0.01, disabled }),
      vector4Field('UV Rect', uvRect, (index, value) => updateComponent(actions, node.id, componentId, 'Set Sprite UV', target => {
        const next = numericVector(target.uvRect, 4, [0, 0, 1, 1]);
        next[index] = value;
        target.uvRect = next;
      }), { min: 0, max: 1, step: 0.01, disabled }),
    );
    const spriteSheet = propertySubsection('Spritesheet', `${spriteSheetGrid.columns} × ${spriteSheetGrid.rows}`);
    spriteSheet.append(
      numberField('图集列数', spriteSheetGrid.columns, value => actions.setSpriteSheetFrame(
        node.id, componentId, value, spriteSheetGrid.rows, spriteSheetFrame,
      ), { min: 1, max: MAX_SPRITE_SHEET_COLUMNS, step: 1, disabled }),
      numberField('图集行数', spriteSheetGrid.rows, value => actions.setSpriteSheetFrame(
        node.id, componentId, spriteSheetGrid.columns, value, spriteSheetFrame,
      ), { min: 1, max: MAX_SPRITE_SHEET_ROWS, step: 1, disabled }),
      numberField('当前帧', spriteSheetFrame + 1, value => actions.setSpriteSheetFrame(
        node.id, componentId, spriteSheetGrid.columns, spriteSheetGrid.rows, value - 1,
      ), {
        min: 1,
        max: spriteSheetGrid.columns * spriteSheetGrid.rows,
        step: 1,
        disabled,
      }),
    );
    if (activeImage) spriteSheet.append(spriteSheetPicker(
      activeImage,
      spriteSheetGrid.columns,
      spriteSheetGrid.rows,
      spriteSheetFrame,
      frame => actions.setSpriteSheetFrame(
        node.id, componentId, spriteSheetGrid.columns, spriteSheetGrid.rows, frame,
      ),
      disabled,
    ));
    spriteSheet.append(
      actionRow([actionButton('生成整张图集动画', () => actions.generateSpriteSheetAnimation(
        node.id,
        componentId,
        spriteSheetGrid.columns,
        spriteSheetGrid.rows,
      ), 'normal', disabled)]),
      note('点击网格选择帧；已有 UV 轨道时会在当前播放头写入 Step 关键帧。一键生成会让全部帧均匀覆盖合成时长。'),
    );
    section.append(spriteSheet);
  } else if (component.type === 'particle2d') {
    section.append(
      numberField('最大粒子', finiteValue(component.maxParticles, 512), value => updateComponent(actions, node.id, componentId, 'Set Particle Capacity', target => {
        target.maxParticles = Math.max(1, Math.round(value));
      }), { min: 1, step: 1, disabled }),
      numberField('发射率', finiteValue(component.emissionRate, 48), value => updateComponent(actions, node.id, componentId, 'Set Emission Rate', target => {
        target.emissionRate = Math.max(0, value);
      }), { min: 0, step: 1, disabled }),
      numberField('Seed', finiteValue(component.seed, 1), value => updateComponent(actions, node.id, componentId, 'Set Particle Seed', target => {
        target.seed = Math.max(0, Math.round(value));
      }), { min: 0, step: 1, disabled }),
      note('Particle2D 是静态运行时负载；当前状态机共享实例策略禁止混合带副作用的粒子节点。'),
    );
  } else if (component.type === 'audio') {
    const audioAssets = project.assets.filter(asset => asset.type === 'audio');
    section.append(
      selectField('音频资源', String(component.resource ?? ''), audioAssets.map(asset => ({ label: asset.name, value: asset.id })), value => updateComponent(actions, node.id, componentId, 'Set Audio Resource', target => {
        target.resource = value;
      }), { disabled: disabled || audioAssets.length === 0 }),
      numberField('音量', finiteValue(component.volume, 1), value => updateComponent(actions, node.id, componentId, 'Set Audio Volume', target => {
        target.volume = clamp(value, 0, 1);
      }), { min: 0, max: 1, step: 0.01, disabled }),
      numberField('播放速率', finiteValue(component.playbackRate, 1), value => updateComponent(actions, node.id, componentId, 'Set Audio Rate', target => {
        target.playbackRate = Math.max(0.01, value);
      }), { min: 0.01, step: 0.01, disabled }),
      note('Timeline Audio 随合成时间播放；状态机工程会给出明确的共享实例限制诊断。'),
    );
  } else {
    section.append(note(`扩展组件 ${component.type} 的专用检查器尚未注册。`, 'error'));
  }
  section.append(actionRow([
    actionButton('移除组件', () => actions.commit('Remove Component', draft => {
      const target = findNode(draft, node.id);
      if (target) target.components = target.components.filter(candidate => candidate.id !== componentId);
      draft.timeline.tracks = draft.timeline.tracks.filter(track => !(
        track.target.kind === 'component-property'
        && track.target.nodeId === node.id
        && track.target.componentId === componentId
      ));
    }), 'danger', disabled),
  ]));
  return section;
}

function effectSection(
  node: AnimationEditorNode,
  effectId: string,
  actions: AnimationEditorInspectorActions,
  disabled: boolean,
): HTMLElement {
  const record = node.effects.find(candidate => candidate.id === effectId)!;
  const recordIndex = node.effects.findIndex(candidate => candidate.id === effectId);
  const effect = record.effect;
  const section = propertySection(record.name ?? effectLabel(effect.kind), effect.kind);
  if (effect.kind === 'tint') {
    const black = numericVector(effect.black, 3, [0, 0, 0]);
    const white = numericVector(effect.white, 3, [1, 1, 1]);
    section.append(
      colorField('黑点', [black[0]!, black[1]!, black[2]!, 1], value => updateEffect(actions, node.id, effectId, 'Set Tint Black', target => { target.black = value; }), { disabled }),
      colorField('白点', [white[0]!, white[1]!, white[2]!, 1], value => updateEffect(actions, node.id, effectId, 'Set Tint White', target => { target.white = value; }), { disabled }),
      numberField('强度', finiteValue(effect.amount, 1), value => updateEffect(actions, node.id, effectId, 'Set Tint Amount', target => { target.amount = clamp(value, 0, 1); }), { min: 0, max: 1, step: 0.01, disabled }),
    );
  } else if (effect.kind === 'fill') {
    section.append(
      colorField('颜色', colorValue(effect.color, [0.15, 0.65, 1, 1]), value => updateEffect(actions, node.id, effectId, 'Set Fill Effect Color', target => {
        target.color = [...value, colorValue(target.color, [1, 1, 1, 1])[3]];
      }), { disabled }),
      numberField('透明度', finiteValue(effect.opacity, 1), value => updateEffect(actions, node.id, effectId, 'Set Fill Effect Opacity', target => { target.opacity = clamp(value, 0, 1); }), { min: 0, max: 1, step: 0.01, disabled }),
    );
  } else if (effect.kind === 'opacity') {
    section.append(numberField('透明度', finiteValue(effect.opacity, 1), value => updateEffect(actions, node.id, effectId, 'Set Effect Opacity', target => { target.opacity = clamp(value, 0, 1); }), { min: 0, max: 1, step: 0.01, disabled }));
  } else if (effect.kind === 'color-matrix') {
    section.append(readOnlyRow('矩阵', '4 × 5'), note('20 个矩阵值可通过时间轴 Color Matrix typed 轨道逐项编辑。'));
  } else if (effect.kind === 'blur') {
    section.append(vectorField('半径', numberPair(effect.radius, [6, 6]), (index, value) => updateEffect(actions, node.id, effectId, 'Set Blur Radius', target => {
      const next = numberPair(target.radius, [6, 6]); next[index] = Math.max(0, value); target.radius = next;
    }), { min: 0, step: 0.5, disabled }));
  } else {
    section.append(
      colorField('颜色', colorValue(effect.color, [0, 0, 0, 1]), value => updateEffect(actions, node.id, effectId, 'Set Shadow Color', target => {
        target.color = [...value, colorValue(target.color, [0, 0, 0, 1])[3]];
      }), { disabled }),
      numberField('透明度', finiteValue(effect.opacity, 0.65), value => updateEffect(actions, node.id, effectId, 'Set Shadow Opacity', target => { target.opacity = clamp(value, 0, 1); }), { min: 0, max: 1, step: 0.01, disabled }),
      vectorField('偏移', numberPair(effect.offset, [8, 10]), (index, value) => updateEffect(actions, node.id, effectId, 'Set Shadow Offset', target => {
        const next = numberPair(target.offset, [8, 10]); next[index] = value; target.offset = next;
      }), { step: 0.5, disabled }),
      numberField('模糊', finiteValue(effect.blur, 12), value => updateEffect(actions, node.id, effectId, 'Set Shadow Blur', target => { target.blur = Math.max(0, value); }), { min: 0, step: 0.5, disabled }),
    );
  }
  section.append(actionRow([
    actionButton('↑', () => actions.commit('Move Effect Up', draft => {
      const effects = findNode(draft, node.id)?.effects;
      if (effects) moveArrayItem(effects, recordIndex, recordIndex - 1);
    }), 'normal', disabled || recordIndex <= 0),
    actionButton('↓', () => actions.commit('Move Effect Down', draft => {
      const effects = findNode(draft, node.id)?.effects;
      if (effects) moveArrayItem(effects, recordIndex, recordIndex + 1);
    }), 'normal', disabled || recordIndex >= node.effects.length - 1),
    actionButton('移除效果', () => actions.commit('Remove Effect', draft => {
      const target = findNode(draft, node.id);
      if (target) target.effects = target.effects.filter(candidate => candidate.id !== effectId);
      draft.timeline.tracks = draft.timeline.tracks.filter(track => !(
        track.target.kind === 'effect-property' && track.target.nodeId === node.id && track.target.effectId === effectId
      ));
    }), 'danger', disabled),
  ]));
  return section;
}

function compositeSection(
  project: AnimationEditorProject,
  node: AnimationEditorNode,
  layerId: string,
  actions: AnimationEditorInspectorActions,
  disabled: boolean,
): HTMLElement {
  const layer = node.compositeLayers.find(candidate => candidate.id === layerId)!;
  const layerIndex = node.compositeLayers.findIndex(candidate => candidate.id === layerId);
  const section = propertySection('Composite Layer', layer.kind);
  const sources = project.nodes.filter(candidate => candidate.id !== node.id).map(candidate => ({ label: candidate.name, value: candidate.id }));
  section.append(
    selectField('类型', layer.kind, [{ label: 'Mask', value: 'mask' }, { label: 'Matte', value: 'matte' }], value => updateComposite(actions, node.id, layerId, 'Set Composite Kind', target => { target.kind = value as typeof target.kind; }), { disabled }),
    selectField('来源节点', layer.sourceNodeId, sources, value => updateComposite(actions, node.id, layerId, 'Set Composite Source', target => { target.sourceNodeId = value; }), { disabled: disabled || sources.length === 0 }),
    selectField('模式', layer.mode, [
      { label: 'Alpha', value: 'alpha' }, { label: 'Alpha Inverted', value: 'alpha-inverted' },
      { label: 'Luma', value: 'luma' }, { label: 'Luma Inverted', value: 'luma-inverted' },
    ], value => updateComposite(actions, node.id, layerId, 'Set Composite Mode', target => { target.mode = value as typeof target.mode; }), { disabled }),
    selectField('操作', layer.operation ?? 'add', [
      { label: 'Add', value: 'add' }, { label: 'Subtract', value: 'subtract' },
      { label: 'Intersect', value: 'intersect' }, { label: 'Difference', value: 'difference' },
    ], value => updateComposite(actions, node.id, layerId, 'Set Composite Operation', target => { target.operation = value as NonNullable<typeof target.operation>; }), { disabled }),
    vectorField('羽化', layer.feather ?? [0, 0], (index, value) => updateComposite(actions, node.id, layerId, 'Set Composite Feather', target => {
      const next = [...(target.feather ?? [0, 0])] as [number, number]; next[index] = Math.max(0, value); target.feather = next;
    }), { min: 0, step: 0.5, disabled }),
    numberField('扩张', layer.expansion ?? 0, value => updateComposite(actions, node.id, layerId, 'Set Composite Expansion', target => { target.expansion = value; }), { step: 0.5, disabled }),
    actionRow([
      actionButton('↑', () => actions.commit('Move Composite Up', draft => {
        const layers = findNode(draft, node.id)?.compositeLayers;
        if (layers) moveArrayItem(layers, layerIndex, layerIndex - 1);
      }), 'normal', disabled || layerIndex <= 0),
      actionButton('↓', () => actions.commit('Move Composite Down', draft => {
        const layers = findNode(draft, node.id)?.compositeLayers;
        if (layers) moveArrayItem(layers, layerIndex, layerIndex + 1);
      }), 'normal', disabled || layerIndex >= node.compositeLayers.length - 1),
      actionButton('移除合成层', () => actions.commit('Remove Composite Layer', draft => {
        const target = findNode(draft, node.id);
        if (target) target.compositeLayers = target.compositeLayers.filter(candidate => candidate.id !== layerId);
        draft.timeline.tracks = draft.timeline.tracks.filter(track => !(
          track.target.kind === 'composite-property' && track.target.nodeId === node.id && track.target.compositeLayerId === layerId
        ));
      }), 'danger', disabled),
    ]),
  );
  return section;
}

function updateComponent(
  actions: AnimationEditorInspectorActions,
  nodeId: string,
  componentId: string,
  label: string,
  mutation: (component: Record<string, DeepMutable<JsonValue>>) => void,
): boolean {
  return actions.commit(label, draft => {
    const node = findNode(draft, nodeId);
    const component = node?.components.find(candidate => candidate.id === componentId)?.component;
    if (component) mutation(component);
  });
}

function updateNestedComponent(
  actions: AnimationEditorInspectorActions,
  nodeId: string,
  componentId: string,
  label: string,
  mutation: (component: Record<string, JsonValue>) => void,
): boolean {
  return updateComponent(actions, nodeId, componentId, label, mutation);
}

function updateModifier(
  actions: AnimationEditorInspectorActions,
  nodeId: string,
  componentId: string,
  index: number,
  label: string,
  mutation: (modifier: Record<string, JsonValue>) => void,
): boolean {
  return updateComponent(actions, nodeId, componentId, label, component => {
    const modifiers = Array.isArray(component.modifiers) ? component.modifiers : [];
    const modifier = objectRecord(modifiers[index]);
    if (modifier) mutation(modifier);
  });
}

function updateGradient(
  actions: AnimationEditorInspectorActions,
  nodeId: string,
  componentId: string,
  label: string,
  mutation: (paint: Record<string, JsonValue>) => void,
): boolean {
  return updateComponent(actions, nodeId, componentId, label, component => {
    const paint = objectRecord(component.fill);
    if (paint && (paint.kind === 'linear-gradient' || paint.kind === 'radial-gradient')) mutation(paint);
  });
}

function updateGradientStop(
  actions: AnimationEditorInspectorActions,
  nodeId: string,
  componentId: string,
  stopIndex: 0 | 1,
  value: readonly [number, number, number],
): boolean {
  return updateGradient(actions, nodeId, componentId, `Set Gradient Stop ${stopIndex + 1}`, paint => {
    const stops = numericVector(paint.stops, 10, [0, 0.18, 0.78, 0.63, 1, 1, 0.55, 0.35, 1, 1]);
    const offset = stopIndex * 5 + 1;
    stops[offset] = value[0];
    stops[offset + 1] = value[1];
    stops[offset + 2] = value[2];
    paint.stops = stops;
  });
}

function updateTextAnimator(
  actions: AnimationEditorInspectorActions,
  nodeId: string,
  componentId: string,
  label: string,
  mutation: (animator: Record<string, JsonValue>) => void,
): boolean {
  return updateComponent(actions, nodeId, componentId, label, component => {
    const animators = Array.isArray(component.animators) ? component.animators : [];
    const animator = objectRecord(animators[0]);
    if (animator) mutation(animator);
  });
}

function updateEffect(
  actions: AnimationEditorInspectorActions,
  nodeId: string,
  effectId: string,
  label: string,
  mutation: (effect: Record<string, JsonValue>) => void,
): boolean {
  return actions.commit(label, draft => {
    const effect = findNode(draft, nodeId)?.effects.find(candidate => candidate.id === effectId)?.effect;
    if (effect) mutation(effect);
  });
}

function updateComposite(
  actions: AnimationEditorInspectorActions,
  nodeId: string,
  layerId: string,
  label: string,
  mutation: (layer: DeepMutable<AnimationEditorNode['compositeLayers'][number]>) => void,
): boolean {
  return actions.commit(label, draft => {
    const layer = findNode(draft, nodeId)?.compositeLayers.find(candidate => candidate.id === layerId);
    if (layer) mutation(layer);
  });
}

function propertySection(title: string, badge = ''): HTMLElement {
  const section = document.createElement('section');
  section.className = 'property-section';
  const heading = document.createElement('div');
  heading.className = 'property-section-heading';
  const titleElement = document.createElement('h3');
  titleElement.textContent = localizeLiteral(title);
  heading.append(titleElement);
  if (badge) {
    const badgeElement = document.createElement('span');
    badgeElement.textContent = badge;
    heading.append(badgeElement);
  }
  section.append(heading);
  return section;
}

function propertySubsection(title: string, badge = ''): HTMLElement {
  const section = document.createElement('div');
  section.className = 'property-subsection';
  const heading = document.createElement('div');
  heading.className = 'property-subsection-heading';
  const titleElement = document.createElement('strong');
  titleElement.textContent = localizeLiteral(title);
  const badgeElement = document.createElement('span');
  badgeElement.textContent = badge;
  heading.append(titleElement, badgeElement);
  section.append(heading);
  return section;
}

function spriteSheetPicker(
  asset: AnimationEditorAsset,
  columns: number,
  rows: number,
  selectedFrame: number,
  selectFrame: (frame: number) => void,
  disabled: boolean,
): HTMLElement {
  const picker = document.createElement('div');
  picker.className = 'sprite-sheet-picker';
  picker.style.aspectRatio = `${asset.delivery.width ?? columns} / ${asset.delivery.height ?? rows}`;
  const image = document.createElement('img');
  image.src = asset.delivery.uri;
  image.alt = localizedText(`${asset.name} 精灵图集`, `${asset.name} sprite sheet`);
  image.draggable = false;
  const cells = document.createElement('div');
  cells.className = 'sprite-sheet-cells';
  cells.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  cells.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  for (let frame = 0; frame < columns * rows; frame++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'sprite-sheet-cell';
    cell.classList.toggle('selected', frame === selectedFrame);
    cell.dataset.frame = String(frame);
    cell.title = localizedText(`选择第 ${frame + 1} 帧`, `Select frame ${frame + 1}`);
    cell.setAttribute('aria-label', localizedText(`精灵图集第 ${frame + 1} 帧`, `Sprite sheet frame ${frame + 1}`));
    cell.disabled = disabled;
    cell.addEventListener('click', () => selectFrame(frame));
    cells.append(cell);
  }
  picker.append(image, cells);
  return picker;
}

function textField(
  label: string,
  value: string,
  commit: (value: string) => unknown,
  options: { readonly disabled?: boolean } = {},
): HTMLElement {
  const input = document.createElement('ge-input') as GEInput;
  input.type = 'text';
  input.value = value;
  input.disabled = options.disabled ?? false;
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
  options: {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly disabled?: boolean;
  } = {},
): HTMLElement {
  const input = numberInput(label, value, commit, options);
  return field(label, input);
}

function vectorField(
  label: string,
  value: readonly [number, number],
  commit: (component: 0 | 1, value: number) => unknown,
  options: {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly disabled?: boolean;
  } = {},
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'inspector-vector';
  wrap.append(
    numberInput(`${label} X`, value[0], next => commit(0, next), options),
    numberInput(`${label} Y`, value[1], next => commit(1, next), options),
  );
  return field(label, wrap);
}

function vector4Field(
  label: string,
  value: readonly number[],
  commit: (component: number, value: number) => unknown,
  options: {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly disabled?: boolean;
  } = {},
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'inspector-vector inspector-vector-four';
  ['X', 'Y', 'W', 'H'].forEach((suffix, index) => wrap.append(
    numberInput(`${label} ${suffix}`, value[index] ?? 0, next => commit(index, next), options),
  ));
  return field(label, wrap);
}

function colorField(
  label: string,
  value: readonly [number, number, number, number],
  commit: (rgb: readonly [number, number, number]) => unknown,
  options: { readonly disabled?: boolean } = {},
): HTMLElement {
  const input = document.createElement('ge-input') as GEInput;
  input.type = 'color';
  input.value = rgbToHex(value);
  input.disabled = options.disabled ?? false;
  input.setAttribute('aria-label', localizeLiteral(label));
  input.addEventListener('value-change', event => {
    const next = hexToRgb((event as CustomEvent<GEInputChangeDetail>).detail.value);
    if (next) commit(next);
  });
  return field(label, input);
}

function hexColorField(
  label: string,
  value: string,
  commit: (value: string) => unknown,
): HTMLElement {
  const input = document.createElement('ge-input') as GEInput;
  input.type = 'color';
  input.value = /^#[0-9a-f]{6}$/iu.test(value) ? value : '#58a6ff';
  input.setAttribute('aria-label', localizeLiteral(label));
  input.addEventListener('value-change', event => {
    const next = (event as CustomEvent<GEInputChangeDetail>).detail.value;
    if (next !== value) commit(next);
  });
  return field(label, input);
}

function selectField(
  label: string,
  value: string,
  options: readonly GESelectOption[],
  commit: (value: string) => unknown,
  state: { readonly disabled?: boolean } = {},
): HTMLElement {
  const select = document.createElement('ge-select') as GESelect;
  select.options = options.map(option => ({ ...option, label: localizeLiteral(option.label) }));
  select.value = value;
  select.disabled = state.disabled ?? false;
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
  input.addEventListener('checked-change', event => (
    commit((event as CustomEvent<GECheckboxChangeDetail>).detail.checked)
  ));
  return input;
}

function numberInput(
  label: string,
  value: number,
  commit: (value: number) => unknown,
  options: {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly disabled?: boolean;
  },
): GEInput {
  const input = document.createElement('ge-input') as GEInput;
  input.type = 'number';
  input.value = String(roundDisplay(value));
  input.disabled = options.disabled ?? false;
  input.setAttribute('aria-label', localizeLiteral(label));
  if (options.min !== undefined) input.setAttribute('min', String(options.min));
  if (options.max !== undefined) input.setAttribute('max', String(options.max));
  input.setAttribute('step', String(options.step ?? 0.1));
  input.addEventListener('value-change', event => {
    const detail = (event as CustomEvent<GEInputChangeDetail>).detail;
    if (detail.valid && detail.valueAsNumber !== null && detail.valueAsNumber !== value) commit(detail.valueAsNumber);
  });
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

function readOnlyRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'property-row';
  const labelElement = document.createElement('span');
  labelElement.textContent = localizeLiteral(label);
  const valueElement = document.createElement('span');
  valueElement.className = 'property-value';
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  return row;
}

function actionRow(actions: readonly HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'inspector-actions';
  row.append(...actions);
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

function note(message: string, tone: 'normal' | 'error' = 'normal'): HTMLElement {
  const element = document.createElement('p');
  element.className = `inspector-note${tone === 'error' ? ' inspector-error' : ''}`;
  element.textContent = localizeLiteral(message);
  return element;
}

function emptyMessage(title: string, detail: string): HTMLElement {
  const value = document.createElement('div');
  value.className = 'empty-inspector';
  const strong = document.createElement('strong');
  strong.textContent = localizeLiteral(title);
  const span = document.createElement('span');
  span.textContent = localizeLiteral(detail);
  value.append(strong, span);
  return value;
}

function findNode(
  project: DeepMutable<AnimationEditorProject>,
  id: string,
): DeepMutable<AnimationEditorNode> | undefined {
  return project.nodes.find(candidate => candidate.id === id);
}

function findKeyframe(
  project: DeepMutable<AnimationEditorProject>,
  trackId: string,
  keyframeId: string,
): DeepMutable<AnimationEditorKeyframe> | undefined {
  return project.timeline.tracks
    .find(candidate => candidate.id === trackId)
    ?.keyframes.find(candidate => candidate.id === keyframeId);
}

function trackTargetLabel(track: AnimationEditorTrack): string {
  const target = track.target;
  if (target.kind === 'node-transform') return `Transform.${target.property}`;
  if (target.kind === 'component-property') return `${target.componentId}.${target.property}`;
  if (target.kind === 'effect-property') return `${target.effectId}.${target.property}`;
  return `${target.compositeLayerId}.${target.property}`;
}

function isDescendant(nodes: readonly AnimationEditorNode[], id: string, ancestorId: string): boolean {
  const byId = new Map(nodes.map(node => [node.id, node]));
  let current = byId.get(id)?.parent;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = byId.get(current)?.parent;
  }
  return false;
}

function numberPair(value: JsonValue | undefined, fallback: readonly [number, number]): [number, number] {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === 'number' && typeof value[1] === 'number'
    ? [value[0], value[1]]
    : [...fallback];
}

function colorValue(
  value: JsonValue | undefined,
  fallback: readonly [number, number, number, number],
): [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(item => typeof item === 'number')
    ? [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])]
    : [...fallback];
}

function finiteValue(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numericVector(value: JsonValue | undefined, size: number, fallback: readonly number[]): number[] {
  return Array.isArray(value) && value.length === size && value.every(item => typeof item === 'number')
    ? value.map(Number)
    : [...fallback];
}

function objectRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;
}

function effectLabel(kind: AdvancedEffectKind): string {
  return ({
    tint: 'Tint', fill: 'Fill', opacity: 'Opacity', 'color-matrix': 'Color Matrix',
    blur: 'Blur', 'drop-shadow': 'Drop Shadow',
  } as const)[kind];
}

function moveArrayItem<T>(values: T[], from: number, to: number): void {
  if (from < 0 || from >= values.length || to < 0 || to >= values.length || from === to) return;
  const [value] = values.splice(from, 1);
  if (value !== undefined) values.splice(to, 0, value);
}

function rgbToHex(value: readonly [number, number, number, number]): string {
  return `#${value.slice(0, 3).map(channel => Math.round(clamp(channel, 0, 1) * 255)
    .toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(value: string): readonly [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(value);
  return match
    ? [Number.parseInt(match[1]!, 16) / 255, Number.parseInt(match[2]!, 16) / 255, Number.parseInt(match[3]!, 16) / 255]
    : null;
}

function roundDisplay(value: number): number {
  return Number(value.toFixed(4));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
