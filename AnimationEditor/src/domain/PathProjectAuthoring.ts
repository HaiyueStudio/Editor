import { ANIMATION_VECTOR_SHAPE_EXTENSION_ID } from '@haiyue/animation-spec';
import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorNode,
  type AnimationEditorProject,
  type DeepMutable,
} from './AnimationEditorProject';
import {
  parseAuthoringPath,
  serializeAuthoringPath,
  validateAuthoringPath,
} from './PathCommandAuthoring';
import {
  PathAuthoringError,
  type AuthoringPath,
  type PathGradientFillStyle,
  type PathSolidFillStyle,
  type PathStrokeStyle,
} from './PathAuthoringTypes';

export interface CreateAuthoredPathComponentOptions {
  readonly kind?: 'path2d' | 'vector';
  readonly fill?: PathSolidFillStyle | PathGradientFillStyle | null;
  readonly stroke?: PathStrokeStyle | null;
  readonly fillRule?: 'nonzero' | 'evenodd';
  readonly tolerance?: number;
}

export function createAuthoredPathComponent(
  componentId: string,
  path: AuthoringPath,
  options: CreateAuthoredPathComponentOptions = {},
): DeepMutable<AnimationEditorNode['components'][number]> {
  const kind = options.kind ?? 'vector';
  const fill = options.fill === undefined ? defaultPathFill() : options.fill;
  const stroke = options.stroke === undefined ? (kind === 'vector' ? defaultPathStroke() : null) : options.stroke;
  validateAuthoringPath(path, { requireClosed: fill !== null, requireDrawable: true });
  const serialized = serializeAuthoringPath(path);
  if (kind === 'path2d') {
    if (!fill || fill.kind !== 'solid') throw new PathAuthoringError(
      'E_PATH_COMPONENT', '$.fill', 'Core path2d requires a solid fill.',
    );
    return {
      id: componentId,
      name: 'Path',
      component: {
        type: 'path2d',
        commands: serialized.commands,
        values: [...serialized.values],
        fill: multiplyAlpha(fill.color, fill.opacity),
        fillRule: options.fillRule ?? 'nonzero',
        tolerance: positiveTolerance(options.tolerance ?? 0.35),
      },
    };
  }
  if (!fill && !stroke) throw new PathAuthoringError(
    'E_PATH_COMPONENT', '$.component', 'Vector path requires a fill or stroke.',
  );
  return {
    id: componentId,
    name: 'Vector Path',
    component: {
      type: ANIMATION_VECTOR_SHAPE_EXTENSION_ID,
      commands: serialized.commands,
      values: [...serialized.values],
      ...(fill ? { fill: authoringFillPayload(fill) } : {}),
      ...(stroke ? { stroke: authoringStrokePayload(stroke) } : {}),
      fillRule: options.fillRule ?? 'nonzero',
      tolerance: positiveTolerance(options.tolerance ?? 0.35),
    },
    parts: [
      ...(fill ? [{ id: `${componentId}-fill`, role: 'fill' as const }] : []),
      ...(stroke ? [{ id: `${componentId}-stroke`, role: 'stroke' as const }] : []),
    ],
  };
}

export function readProjectAuthoringPath(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
): AuthoringPath {
  const record = requiredPathRecord(project, nodeId, componentId);
  const commands = typeof record.component.commands === 'string' ? record.component.commands : '';
  const values = numericValues(record.component.values);
  return parseAuthoringPath(componentId, commands, values);
}

export function replacePathComponentGeometry(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  path: AuthoringPath,
): AnimationEditorProject {
  const sourceRecord = requiredPathRecord(project, nodeId, componentId);
  const fillRequired = sourceRecord.component.type === 'path2d' || sourceRecord.component.fill !== undefined;
  validateAuthoringPath(path, { requireClosed: fillRequired, requireDrawable: true });
  const serialized = serializeAuthoringPath(path);
  const morphTrack = project.timeline.tracks.find(track => track.target.kind === 'component-property'
    && track.target.nodeId === nodeId && track.target.componentId === componentId
    && track.target.property === 'vector.morph');
  if (morphTrack) {
    const currentCommands = String(sourceRecord.component.commands ?? '');
    if (currentCommands !== serialized.commands) throw new PathAuthoringError(
      'E_PATH_MORPH_COMMAND_MISMATCH', `$.timeline.tracks.${morphTrack.id}`,
      'Cannot change path commands while a topology-stable morph track is active.',
      { expected: currentCommands, actual: serialized.commands },
    );
    if (morphTrack.valueSize !== serialized.values.length) throw new PathAuthoringError(
      'E_PATH_MORPH_POINT_COUNT_MISMATCH', `$.timeline.tracks.${morphTrack.id}.valueSize`,
      'Cannot change path point count while a topology-stable morph track is active.',
      { expected: morphTrack.valueSize, actual: serialized.values.length },
    );
  }
  const draft = cloneAnimationEditorProject(project);
  const record = requiredMutablePathRecord(draft, nodeId, componentId);
  record.component.commands = serialized.commands;
  record.component.values = [...serialized.values];
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export type PathGestureState = 'active' | 'committed' | 'cancelled';

/** Detached project gesture: previews never publish and completion rejects stale project replacement. */
export class PathGestureTransaction {
  private _preview: AnimationEditorProject | null = null;
  private _state: PathGestureState = 'active';

  constructor(readonly before: AnimationEditorProject) {}

  get state(): PathGestureState { return this._state; }
  get previewProject(): AnimationEditorProject | null { return this._preview; }

  previewPath(nodeId: string, componentId: string, path: AuthoringPath): AnimationEditorProject {
    this._requireActive();
    this._preview = replacePathComponentGeometry(this.before, nodeId, componentId, path);
    return this._preview;
  }

  previewNextProject(project: AnimationEditorProject): AnimationEditorProject {
    this._requireActive();
    this._preview = project;
    return project;
  }

  complete(current: AnimationEditorProject): AnimationEditorProject | null {
    this._requireActive();
    if (current !== this.before) {
      this._state = 'cancelled';
      this._preview = null;
      return null;
    }
    this._state = 'committed';
    return this._preview ?? this.before;
  }

  cancel(): AnimationEditorProject {
    if (this._state === 'committed') throw new Error('A committed path gesture cannot be cancelled.');
    this._state = 'cancelled';
    this._preview = null;
    return this.before;
  }

  private _requireActive(): void {
    if (this._state !== 'active') throw new Error(`Path gesture is already ${this._state}.`);
  }
}

export function requiredPathRecord(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
): AnimationEditorProject['nodes'][number]['components'][number] {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  const record = node?.components.find(candidate => candidate.id === componentId);
  if (!record || (record.component.type !== 'path2d' && record.component.type !== ANIMATION_VECTOR_SHAPE_EXTENSION_ID)) {
    throw new PathAuthoringError(
      'E_PATH_COMPONENT', `$.nodes.${nodeId}.components.${componentId}`, `Unknown path/vector component "${nodeId}/${componentId}".`,
    );
  }
  return record;
}

function requiredMutablePathRecord(
  project: DeepMutable<AnimationEditorProject>,
  nodeId: string,
  componentId: string,
) {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  const record = node?.components.find(candidate => candidate.id === componentId);
  if (!record || (record.component.type !== 'path2d' && record.component.type !== ANIMATION_VECTOR_SHAPE_EXTENSION_ID)) {
    throw new PathAuthoringError(
      'E_PATH_COMPONENT', `$.nodes.${nodeId}.components.${componentId}`, `Unknown path/vector component "${nodeId}/${componentId}".`,
    );
  }
  return record;
}

function authoringFillPayload(fill: PathSolidFillStyle | PathGradientFillStyle) {
  return fill.kind === 'solid'
    ? { kind: fill.kind, color: [...fill.color], opacity: unit(fill.opacity) }
    : {
        kind: fill.kind,
        start: [...fill.start],
        end: [...fill.end],
        stops: validGradientStops(fill.stops),
        opacity: unit(fill.opacity),
      };
}

function authoringStrokePayload(stroke: PathStrokeStyle) {
  return {
    color: [...validColor(stroke.color)],
    width: nonNegative(stroke.width, '$.stroke.width'),
    opacity: unit(stroke.opacity),
    lineCap: stroke.lineCap,
    lineJoin: stroke.lineJoin,
    miterLimit: Math.max(1, finite(stroke.miterLimit, '$.stroke.miterLimit')),
    ...(stroke.dash.length ? { dash: stroke.dash.map((value, index) => nonNegative(value, `$.stroke.dash[${index}]`)) } : {}),
    dashOffset: finite(stroke.dashOffset, '$.stroke.dashOffset'),
  };
}

function defaultPathFill(): PathSolidFillStyle {
  return Object.freeze({
    kind: 'solid',
    color: Object.freeze([0.18, 0.78, 0.63, 1]) as readonly [number, number, number, number],
    opacity: 1,
  });
}

function defaultPathStroke(): PathStrokeStyle {
  return Object.freeze({
    color: Object.freeze([0.98, 0.74, 0.16, 1]) as readonly [number, number, number, number], width: 5, opacity: 1,
    lineCap: 'round', lineJoin: 'round', miterLimit: 4, dash: Object.freeze([]), dashOffset: 0,
  });
}

function multiplyAlpha(color: readonly [number, number, number, number], opacity: number) {
  const value = validColor(color);
  return [value[0], value[1], value[2], value[3] * unit(opacity)];
}

function validGradientStops(stops: readonly number[]): number[] {
  if (stops.length < 10 || stops.length > 40 || stops.length % 5 !== 0) throw new PathAuthoringError(
    'E_PATH_COMPONENT', '$.fill.stops', 'Gradient stops require 2–8 offset,r,g,b,a tuples.',
  );
  let previous = -1;
  return stops.map((value, index) => {
    const normalized = unit(value);
    if (index % 5 === 0) {
      if (normalized < previous) throw new PathAuthoringError(
        'E_PATH_COMPONENT', `$.fill.stops[${index}]`, 'Gradient offsets must be non-decreasing.',
      );
      previous = normalized;
    }
    return normalized;
  });
}

function validColor(value: readonly [number, number, number, number]) {
  return value.map(unit) as [number, number, number, number];
}

function numericValues(value: unknown): number[] {
  if (!Array.isArray(value) && !(value instanceof Float32Array)) throw new PathAuthoringError(
    'E_PATH_VALUE_COUNT', '$.component.values', 'Path component values must be a numeric array.',
  );
  const values = Array.from(value);
  if (values.some(item => typeof item !== 'number')) throw new PathAuthoringError(
    'E_PATH_COORDINATE', '$.component.values', 'Path component values must be numeric.',
  );
  return values as number[];
}

function positiveTolerance(value: number): number {
  const result = finite(value, '$.tolerance');
  if (result <= 0) throw new PathAuthoringError('E_PATH_COMPONENT', '$.tolerance', 'Path tolerance must be positive.');
  return result;
}

function unit(value: number): number {
  const result = finite(value, '$.color');
  if (result < 0 || result > 1) throw new PathAuthoringError('E_PATH_COMPONENT', '$.color', 'Color and opacity values must be in [0, 1].');
  return result;
}

function nonNegative(value: number, path: string): number {
  const result = finite(value, path);
  if (result < 0) throw new PathAuthoringError('E_PATH_COMPONENT', path, 'Value must be non-negative.');
  return result;
}

function finite(value: number, path: string): number {
  if (!Number.isFinite(value)) throw new PathAuthoringError('E_PATH_COMPONENT', path, 'Value must be finite.');
  return value;
}
