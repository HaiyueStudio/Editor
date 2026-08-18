import { ANIMATION_VECTOR_SHAPE_EXTENSION_ID } from '@haiyue/animation-spec';
import type {
  AnimationEditorComponentProperty,
  AnimationEditorEffectProperty,
  AnimationEditorNode,
  AnimationEditorProject,
  AnimationEditorTrack,
  AnimationEditorTrackTarget,
  DeepMutable,
  JsonObject,
  JsonValue,
} from './AnimationEditorProject';

export type AdvancedEffectKind = AnimationEditorNode['effects'][number]['effect']['kind'];

export interface AdvancedPropertyBinding {
  readonly key: string;
  readonly label: string;
  readonly target: Exclude<AnimationEditorTrackTarget, { readonly kind: 'node-transform' }>;
  readonly valueSize: number;
  readonly initialValue: readonly number[];
  readonly color: string;
  readonly stepOnly?: boolean;
}

const COMPONENT_DEFINITIONS: Readonly<Record<AnimationEditorComponentProperty, Readonly<{
  label: string;
  size: number | 'morph' | 'stops';
  color: string;
  stepOnly?: boolean;
}>>> = Object.freeze({
  'sprite.uv-rect': { label: 'Sprite · UV Rect', size: 4, color: '#fb7185', stepOnly: true },
  'vector.morph': { label: 'Vector · Morph', size: 'morph', color: '#22d3ee' },
  'vector.fill.color': { label: 'Vector Fill · Color', size: 4, color: '#41d89b' },
  'vector.fill.opacity': { label: 'Vector Fill · Opacity', size: 1, color: '#3fb950' },
  'vector.gradient.start': { label: 'Gradient · Start', size: 2, color: '#2dd4bf' },
  'vector.gradient.end': { label: 'Gradient · End', size: 2, color: '#14b8a6' },
  'vector.gradient.stops': { label: 'Gradient · Stops', size: 'stops', color: '#0d9488' },
  'vector.stroke.color': { label: 'Vector Stroke · Color', size: 4, color: '#fbbf24' },
  'vector.stroke.opacity': { label: 'Vector Stroke · Opacity', size: 1, color: '#f59e0b' },
  'vector.stroke.width': { label: 'Vector Stroke · Width', size: 1, color: '#f0883e' },
  'vector.stroke.dash-offset': { label: 'Vector Stroke · Dash Offset', size: 1, color: '#ea580c' },
  'vector.modifier.trim-start': { label: 'Trim Path · Start', size: 1, color: '#c084fc' },
  'vector.modifier.trim-end': { label: 'Trim Path · End', size: 1, color: '#a855f7' },
  'vector.modifier.trim-offset': { label: 'Trim Path · Offset', size: 1, color: '#9333ea' },
  'vector.modifier.round-radius': { label: 'Round Corners · Radius', size: 1, color: '#7c3aed' },
  'text.selector.start': { label: 'Text Selector · Start', size: 1, color: '#67e8f9' },
  'text.selector.end': { label: 'Text Selector · End', size: 1, color: '#22d3ee' },
  'text.selector.offset': { label: 'Text Selector · Offset', size: 1, color: '#06b6d4' },
  'text.selector.amount': { label: 'Text Selector · Amount', size: 1, color: '#0891b2' },
  'text.animator.position': { label: 'Text Animator · Position', size: 2, color: '#38bdf8' },
  'text.animator.scale': { label: 'Text Animator · Scale', size: 2, color: '#818cf8' },
  'text.animator.rotation': { label: 'Text Animator · Rotation', size: 1, color: '#a78bfa' },
  'text.animator.opacity': { label: 'Text Animator · Opacity', size: 1, color: '#c084fc' },
  'text.animator.fill-color': { label: 'Text Animator · Fill Color', size: 4, color: '#e879f9' },
  'text.animator.tracking': { label: 'Text Animator · Tracking', size: 1, color: '#f472b6' },
});

const EFFECT_DEFINITIONS: Readonly<Record<AnimationEditorEffectProperty, Readonly<{
  label: string;
  size: number;
  field: string;
  color: string;
}>>> = Object.freeze({
  'tint.black': { label: 'Tint · Black', size: 3, field: 'black', color: '#64748b' },
  'tint.white': { label: 'Tint · White', size: 3, field: 'white', color: '#e2e8f0' },
  'tint.amount': { label: 'Tint · Amount', size: 1, field: 'amount', color: '#94a3b8' },
  'fill.color': { label: 'Fill Effect · Color', size: 4, field: 'color', color: '#fb7185' },
  'fill.opacity': { label: 'Fill Effect · Opacity', size: 1, field: 'opacity', color: '#f43f5e' },
  'opacity.value': { label: 'Opacity Effect · Value', size: 1, field: 'opacity', color: '#3fb950' },
  'color-matrix.matrix': { label: 'Color Matrix', size: 20, field: 'matrix', color: '#8b5cf6' },
  'blur.radius': { label: 'Blur · Radius', size: 2, field: 'radius', color: '#60a5fa' },
  'drop-shadow.color': { label: 'Shadow · Color', size: 4, field: 'color', color: '#334155' },
  'drop-shadow.opacity': { label: 'Shadow · Opacity', size: 1, field: 'opacity', color: '#475569' },
  'drop-shadow.offset': { label: 'Shadow · Offset', size: 2, field: 'offset', color: '#64748b' },
  'drop-shadow.blur': { label: 'Shadow · Blur', size: 1, field: 'blur', color: '#94a3b8' },
});

export function createAdvancedVectorComponent(id: string): DeepMutable<AnimationEditorNode['components'][number]> {
  return {
    id,
    name: 'Vector Shape',
    component: {
      type: ANIMATION_VECTOR_SHAPE_EXTENSION_ID,
      commands: 'MLLZ',
      values: [0, -70, 72, 58, -72, 58],
      fill: { kind: 'solid', color: [0.18, 0.78, 0.63, 1], opacity: 1 },
      stroke: {
        color: [0.98, 0.74, 0.16, 1], width: 5, opacity: 1,
        lineCap: 'round', lineJoin: 'round', miterLimit: 4, dash: [18, 8], dashOffset: 0,
      },
      modifiers: [
        { kind: 'trim-path', start: 0, end: 1, offset: 0, mode: 'simultaneous' },
        { kind: 'round-corners', radius: 8 },
      ],
      fillRule: 'nonzero',
      tolerance: 0.35,
    },
    parts: [
      { id: `${id}-fill`, role: 'fill' },
      { id: `${id}-stroke`, role: 'stroke' },
      { id: `${id}-trim`, role: 'modifier', index: 0 },
      { id: `${id}-round`, role: 'modifier', index: 1 },
    ],
  };
}

export function createTextAnimatorParts(componentId: string): Readonly<{
  readonly parts: DeepMutable<NonNullable<AnimationEditorNode['components'][number]['parts']>>;
  readonly animators: DeepMutable<JsonValue>;
}> {
  return {
    parts: [
      { id: `${componentId}-selector`, role: 'text-selector', index: 0 },
      { id: `${componentId}-animator`, role: 'text-animator', index: 0 },
    ],
    animators: [{
      selector: { start: 0, end: 100, offset: 0, units: 'percent', amount: 1, shape: 'smooth' },
      position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1, fillColor: [1, 1, 1, 1], tracking: 0,
    }],
  };
}

export function createAdvancedEffect(
  project: AnimationEditorProject,
  nodeId: string,
  kind: AdvancedEffectKind,
): DeepMutable<AnimationEditorNode['effects'][number]> {
  const node = requiredNode(project, nodeId);
  if (node.effects.length >= 8) throw new Error('A node can contain at most eight effects.');
  const id = uniqueId(`${node.id}-${kind}`, new Set(node.effects.map(effect => effect.id)));
  const payloads: Record<AdvancedEffectKind, JsonObject> = {
    tint: { kind: 'tint', black: [0, 0, 0], white: [1, 1, 1], amount: 1 },
    fill: { kind: 'fill', color: [0.15, 0.65, 1, 1], opacity: 1 },
    opacity: { kind: 'opacity', opacity: 1 },
    'color-matrix': { kind: 'color-matrix', matrix: identityColorMatrix() },
    blur: { kind: 'blur', radius: [6, 6] },
    'drop-shadow': { kind: 'drop-shadow', color: [0, 0, 0, 1], opacity: 0.65, offset: [8, 10], blur: 12 },
  };
  return { id, name: effectKindLabel(kind), effect: payloads[kind] as DeepMutable<AnimationEditorNode['effects'][number]['effect']> };
}

export function createCompositeLayer(
  project: AnimationEditorProject,
  nodeId: string,
  sourceNodeId?: string,
): DeepMutable<AnimationEditorNode['compositeLayers'][number]> {
  const node = requiredNode(project, nodeId);
  if (node.compositeLayers.length >= 8) throw new Error('A node can contain at most eight composite layers.');
  const source = sourceNodeId
    ? project.nodes.find(candidate => candidate.id === sourceNodeId && candidate.id !== nodeId)
    : project.nodes.find(candidate => candidate.id !== nodeId);
  if (!source) throw new Error('Create another node before adding a mask or matte.');
  return {
    id: uniqueId(`${node.id}-mask`, new Set(node.compositeLayers.map(layer => layer.id))),
    kind: 'mask',
    sourceNodeId: source.id,
    mode: 'alpha',
    operation: 'add',
    feather: [0, 0],
    expansion: 0,
  };
}

export function availableAdvancedPropertyBindings(
  project: AnimationEditorProject,
  nodeId: string,
): readonly AdvancedPropertyBinding[] {
  const node = requiredNode(project, nodeId);
  const result: AdvancedPropertyBinding[] = [];
  for (const record of node.components) collectComponentBindings(record, nodeId, result);
  for (const record of node.effects) {
    for (const property of effectProperties(record.effect.kind)) {
      const definition = EFFECT_DEFINITIONS[property];
      const value = numericArray(record.effect[definition.field], definition.size);
      if (!value) continue;
      result.push(binding(definition.label, {
        kind: 'effect-property', nodeId, effectId: record.id, property,
      }, definition.size, value, definition.color));
    }
  }
  for (const layer of node.compositeLayers) {
    result.push(binding('Composite · Expansion', {
      kind: 'composite-property', nodeId, compositeLayerId: layer.id, property: 'expansion',
    }, 1, [layer.expansion ?? 0], '#f97316'));
  }
  const active = new Set(project.timeline.tracks.filter(track => track.enabled !== false).map(track => targetKey(track.target)));
  return Object.freeze(result.filter(candidate => !active.has(candidate.key)));
}

export function createAdvancedPropertyTrack(
  project: AnimationEditorProject,
  nodeId: string,
  key: string,
  time = project.editor?.timeline?.playhead ?? 0,
): DeepMutable<AnimationEditorTrack> {
  const node = requiredNode(project, nodeId);
  const definition = availableAdvancedPropertyBindings(project, nodeId).find(candidate => candidate.key === key);
  if (!definition) throw new Error('The selected advanced property is unavailable or already animated.');
  const id = uniqueId(`${node.id}-${propertySlug(definition.target)}`, new Set(project.timeline.tracks.map(track => track.id)));
  return {
    id,
    name: `${node.name} · ${definition.label}`,
    target: structuredClone(definition.target),
    valueSize: definition.valueSize,
    enabled: true,
    color: definition.color,
    keyframes: [{
      id: `${id}-key`,
      time: snapAdvancedTimelineTime(time, project.composition.frameRate, project.composition.duration),
      value: [...definition.initialValue],
      interpolation: definition.stepOnly ? 'step' : 'linear',
    }],
  };
}

export function advancedBindingForTrack(
  project: AnimationEditorProject,
  track: AnimationEditorTrack,
): AdvancedPropertyBinding | null {
  if (track.target.kind === 'node-transform') return null;
  const node = project.nodes.find(candidate => candidate.id === track.target.nodeId);
  if (!node) return null;
  const allTracks = project.timeline.tracks.filter(candidate => candidate.id !== track.id);
  return availableAdvancedPropertyBindings({ ...project, timeline: { ...project.timeline, tracks: allTracks } }, node.id)
    .find(candidate => candidate.key === targetKey(track.target)) ?? null;
}

export function advancedTrackExpectedValueSize(
  project: AnimationEditorProject,
  target: Exclude<AnimationEditorTrackTarget, { readonly kind: 'node-transform' }>,
): number | null {
  const node = project.nodes.find(candidate => candidate.id === target.nodeId);
  if (!node) return null;
  const result: AdvancedPropertyBinding[] = [];
  for (const record of node.components) collectComponentBindings(record, node.id, result);
  for (const record of node.effects) {
    for (const property of effectProperties(record.effect.kind)) {
      const definition = EFFECT_DEFINITIONS[property];
      result.push(binding(definition.label, { kind: 'effect-property', nodeId: node.id, effectId: record.id, property }, definition.size, [], definition.color));
    }
  }
  for (const layer of node.compositeLayers) {
    result.push(binding('Composite · Expansion', { kind: 'composite-property', nodeId: node.id, compositeLayerId: layer.id, property: 'expansion' }, 1, [], '#f97316'));
  }
  return result.find(candidate => candidate.key === targetKey(target))?.valueSize ?? null;
}

export function advancedTrackValueLabels(track: AnimationEditorTrack): readonly string[] | null {
  if (track.target.kind === 'node-transform') return null;
  const property = track.target.property;
  if (property.endsWith('.color') || property === 'fill.color' || property === 'drop-shadow.color') return ['R', 'G', 'B', 'A'].slice(0, track.valueSize);
  if (property === 'tint.black' || property === 'tint.white') return ['R', 'G', 'B'];
  if (property.endsWith('.position') || property.endsWith('.scale') || property.endsWith('.start')
    || property.endsWith('.end') || property.endsWith('.offset') || property === 'blur.radius') return ['X', 'Y'].slice(0, track.valueSize);
  if (property === 'sprite.uv-rect') return ['U', 'V', 'Width', 'Height'];
  return Array.from({ length: track.valueSize }, (_unused, index) => track.valueSize === 1 ? 'Value' : `Value ${index + 1}`);
}

export function isStepOnlyAdvancedTrack(track: AnimationEditorTrack): boolean {
  return track.target.kind === 'component-property' && track.target.property === 'sprite.uv-rect';
}

function collectComponentBindings(
  record: AnimationEditorNode['components'][number],
  nodeId: string,
  output: AdvancedPropertyBinding[],
): void {
  const component = record.component;
  if (component.type === 'sprite2d') {
    output.push(componentBinding(record.id, nodeId, 'sprite.uv-rect', numericArray(component.uvRect, 4) ?? [0, 0, 1, 1]));
    return;
  }
  if (component.type === ANIMATION_VECTOR_SHAPE_EXTENSION_ID) {
    const values = numericArray(component.values);
    if (values?.length) output.push(componentBinding(record.id, nodeId, 'vector.morph', values));
    const fill = objectValue(component.fill);
    if (fill?.kind === 'solid') {
      output.push(componentBinding(record.id, nodeId, 'vector.fill.color', numericArray(fill.color, 4) ?? [1, 1, 1, 1]));
      output.push(componentBinding(record.id, nodeId, 'vector.fill.opacity', [finite(fill.opacity, 1)]));
    } else if (fill?.kind === 'linear-gradient' || fill?.kind === 'radial-gradient') {
      output.push(componentBinding(record.id, nodeId, 'vector.gradient.start', numericArray(fill.start, 2) ?? [0, 0]));
      output.push(componentBinding(record.id, nodeId, 'vector.gradient.end', numericArray(fill.end, 2) ?? [100, 0]));
      const stops = numericArray(fill.stops);
      if (stops?.length) output.push(componentBinding(record.id, nodeId, 'vector.gradient.stops', stops));
      output.push(componentBinding(record.id, nodeId, 'vector.fill.opacity', [finite(fill.opacity, 1)]));
    }
    const stroke = objectValue(component.stroke);
    if (stroke) {
      output.push(componentBinding(record.id, nodeId, 'vector.stroke.color', numericArray(stroke.color, 4) ?? [1, 1, 1, 1]));
      output.push(componentBinding(record.id, nodeId, 'vector.stroke.opacity', [finite(stroke.opacity, 1)]));
      output.push(componentBinding(record.id, nodeId, 'vector.stroke.width', [finite(stroke.width, 1)]));
      output.push(componentBinding(record.id, nodeId, 'vector.stroke.dash-offset', [finite(stroke.dashOffset, 0)]));
    }
    const modifiers = arrayValue(component.modifiers);
    for (const part of record.parts ?? []) {
      if (part.role !== 'modifier' || part.index === undefined) continue;
      const modifier = objectValue(modifiers[part.index]);
      if (modifier?.kind === 'trim-path') {
        for (const property of ['vector.modifier.trim-start', 'vector.modifier.trim-end', 'vector.modifier.trim-offset'] as const) {
          const field = property.replace('vector.modifier.trim-', '');
          output.push(componentBinding(record.id, nodeId, property, [finite(modifier[field], field === 'end' ? 1 : 0)], part.id));
        }
      } else if (modifier?.kind === 'round-corners') {
        output.push(componentBinding(record.id, nodeId, 'vector.modifier.round-radius', [finite(modifier.radius, 0)], part.id));
      }
    }
    return;
  }
  if (component.type !== 'text2d') return;
  const animators = arrayValue(component.animators);
  for (const part of record.parts ?? []) {
    if ((part.role !== 'text-selector' && part.role !== 'text-animator') || part.index === undefined) continue;
    const animator = objectValue(animators[part.index]);
    if (!animator) continue;
    if (part.role === 'text-selector') {
      const selector = objectValue(animator.selector);
      if (!selector) continue;
      for (const property of ['text.selector.start', 'text.selector.end', 'text.selector.offset', 'text.selector.amount'] as const) {
        const field = property.replace('text.selector.', '');
        output.push(componentBinding(record.id, nodeId, property, [finite(selector[field], field === 'end' ? 100 : field === 'amount' ? 1 : 0)], part.id));
      }
    } else {
      const values: Readonly<Record<string, readonly number[]>> = {
        'text.animator.position': numericArray(animator.position, 2) ?? [0, 0],
        'text.animator.scale': numericArray(animator.scale, 2) ?? [1, 1],
        'text.animator.rotation': [finite(animator.rotation, 0)],
        'text.animator.opacity': [finite(animator.opacity, 1)],
        'text.animator.fill-color': numericArray(animator.fillColor, 4) ?? [1, 1, 1, 1],
        'text.animator.tracking': [finite(animator.tracking, 0)],
      };
      for (const [property, value] of Object.entries(values) as [AnimationEditorComponentProperty, readonly number[]][]) {
        output.push(componentBinding(record.id, nodeId, property, value, part.id));
      }
    }
  }
}

function componentBinding(
  componentId: string,
  nodeId: string,
  property: AnimationEditorComponentProperty,
  value: readonly number[],
  partId?: string,
): AdvancedPropertyBinding {
  const definition = COMPONENT_DEFINITIONS[property];
  const target = { kind: 'component-property' as const, nodeId, componentId, ...(partId ? { partId } : {}), property };
  return binding(definition.label, target, value.length, value, definition.color, definition.stepOnly);
}

function binding(
  label: string,
  target: Exclude<AnimationEditorTrackTarget, { readonly kind: 'node-transform' }>,
  valueSize: number,
  initialValue: readonly number[],
  color: string,
  stepOnly?: boolean,
): AdvancedPropertyBinding {
  return Object.freeze({ key: targetKey(target), label, target, valueSize, initialValue, color, ...(stepOnly ? { stepOnly } : {}) });
}

function effectProperties(kind: AdvancedEffectKind): readonly AnimationEditorEffectProperty[] {
  return ({
    tint: ['tint.black', 'tint.white', 'tint.amount'],
    fill: ['fill.color', 'fill.opacity'],
    opacity: ['opacity.value'],
    'color-matrix': ['color-matrix.matrix'],
    blur: ['blur.radius'],
    'drop-shadow': ['drop-shadow.color', 'drop-shadow.opacity', 'drop-shadow.offset', 'drop-shadow.blur'],
  } as const)[kind];
}

function targetKey(target: AnimationEditorTrackTarget): string {
  if (target.kind === 'component-property') return `component:${target.componentId}:${target.partId ?? ''}:${target.property}`;
  if (target.kind === 'effect-property') return `effect:${target.effectId}:${target.property}`;
  if (target.kind === 'composite-property') return `composite:${target.compositeLayerId}:${target.property}`;
  return `transform:${target.property}`;
}

function propertySlug(target: Exclude<AnimationEditorTrackTarget, { readonly kind: 'node-transform' }>): string {
  const property = target.property.replaceAll('.', '-');
  if (target.kind === 'component-property') return `${target.componentId}-${target.partId ?? 'root'}-${property}`;
  if (target.kind === 'effect-property') return `${target.effectId}-${property}`;
  return `${target.compositeLayerId}-${property}`;
}

function requiredNode(project: AnimationEditorProject, nodeId: string): AnimationEditorNode {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown node "${nodeId}".`);
  return node;
}

function objectValue(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function arrayValue(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function numericArray(value: JsonValue | undefined, size?: number): number[] | null {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'number' && Number.isFinite(item))) return null;
  if (size !== undefined && value.length !== size) return null;
  return value.map(Number);
}

function finite(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function identityColorMatrix(): number[] {
  return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
}

function effectKindLabel(kind: AdvancedEffectKind): string {
  return ({ tint: 'Tint', fill: 'Fill', opacity: 'Opacity', 'color-matrix': 'Color Matrix', blur: 'Blur', 'drop-shadow': 'Drop Shadow' })[kind];
}

function uniqueId(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

function snapAdvancedTimelineTime(time: number, frameRate: number, duration: number): number {
  const safe = Number.isFinite(time) ? time : 0;
  return Math.min(duration, Math.round(Math.max(0, Math.min(duration, safe)) * frameRate) / frameRate);
}
