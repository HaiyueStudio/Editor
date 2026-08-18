import { ANIMATION_VECTOR_SHAPE_EXTENSION_ID } from '@haiyue/animation-spec';
import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorProject,
} from './AnimationEditorProject';
import { flattenAuthoringPath } from './PathCommandAuthoring';
import { requiredPathRecord } from './PathProjectAuthoring';
import { sampleAnimationEditorTrack } from './TimelineAuthoring';
import {
  PathAuthoringError,
  type AuthoringPath,
  type FlattenedPath,
  type PathGradientFillStyle,
  type PathModifierStyle,
  type PathOverlayContour,
  type PathPoint,
  type PathSolidFillStyle,
  type PathStrokeStyle,
  type PathVectorStyle,
  type PathVectorStyleEdit,
} from './PathAuthoringTypes';

type JsonRecord = Record<string, unknown>;

/** Resolve the same static and animated paint fields that the HYA compiler consumes. */
export function resolveProjectPathVectorStyle(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  time: number,
): PathVectorStyle {
  const record = requiredPathRecord(project, nodeId, componentId);
  const component = record.component as JsonRecord;
  if (component.type === 'path2d') {
    const color = rgba(component.fill, '$.component.fill');
    return Object.freeze({
      fill: Object.freeze({ kind: 'solid', color, opacity: 1 }), stroke: null, modifiers: Object.freeze([]),
      fillRule: component.fillRule === 'evenodd' ? 'evenodd' : 'nonzero', tolerance: positive(component.tolerance, 0.35),
    });
  }
  const fill = fillStyle(object(component.fill), '$.component.fill');
  const stroke = strokeStyle(object(component.stroke), '$.component.stroke');
  const modifiers = modifierStyles(array(component.modifiers), '$.component.modifiers');
  const sampledFill = fill ? sampleFill(project, nodeId, componentId, time, fill) : null;
  const sampledStroke = stroke ? sampleStroke(project, nodeId, componentId, time, stroke) : null;
  return Object.freeze({
    fill: sampledFill,
    stroke: sampledStroke,
    modifiers: Object.freeze(modifiers.map((modifier, index) => sampleModifier(
      project, nodeId, componentId, record.parts?.find(part => part.role === 'modifier' && part.index === index)?.id,
      time, modifier,
    ))),
    fillRule: component.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    tolerance: positive(component.tolerance, 0.35),
  });
}

/** Persistent inspector/canvas style edit with stable modifier part identities. */
export function editProjectPathVectorStyle(
  project: AnimationEditorProject,
  nodeId: string,
  componentId: string,
  edit: PathVectorStyleEdit,
): AnimationEditorProject {
  const source = requiredPathRecord(project, nodeId, componentId);
  if (source.component.type !== ANIMATION_VECTOR_SHAPE_EXTENSION_ID) throw new PathAuthoringError(
    'E_PATH_COMPONENT', `$.nodes.${nodeId}.components.${componentId}`,
    'Paint, stroke, and modifier editing requires a vector shape component.',
  );
  const draft = cloneAnimationEditorProject(project);
  const node = draft.nodes.find(candidate => candidate.id === nodeId)!;
  const record = node.components.find(candidate => candidate.id === componentId)!;
  const component = record.component as JsonRecord;
  if (edit.kind === 'fill-solid') component.fill = solidPayload(edit.color, edit.opacity);
  else if (edit.kind === 'fill-gradient') component.fill = gradientPayload(edit);
  else if (edit.kind === 'remove-fill') delete component.fill;
  else if (edit.kind === 'stroke') component.stroke = strokePayload(edit.value);
  else if (edit.kind === 'remove-stroke') delete component.stroke;
  else {
    const modifiers = array(component.modifiers).map(item => ({ ...object(item) }));
    const kind = edit.kind === 'trim' ? 'trim-path' : 'round-corners';
    let index = modifiers.findIndex(item => item.kind === kind);
    const value = edit.kind === 'trim'
      ? { kind, start: finite(edit.value.start, '$.trim.start'), end: finite(edit.value.end, '$.trim.end'),
          offset: finite(edit.value.offset, '$.trim.offset'), mode: edit.value.mode }
      : { kind, radius: nonNegative(edit.radius, '$.round.radius') };
    if (index < 0) {
      index = modifiers.length;
      modifiers.push(value);
      const id = uniquePartId(record.parts?.map(part => part.id) ?? [], `${componentId}-${edit.kind}`);
      record.parts = [...(record.parts ?? []), { id, role: 'modifier', index }];
    } else modifiers[index] = value;
    component.modifiers = modifiers;
  }
  if (component.fill === undefined && component.stroke === undefined) throw new PathAuthoringError(
    'E_PATH_COMPONENT', `$.nodes.${nodeId}.components.${componentId}`,
    'Vector path requires at least one fill or stroke.',
  );
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

/** Deterministic overlay contours; runtime remains authoritative for exact pixels. */
export function buildPathOverlayContours(
  path: AuthoringPath,
  modifiers: readonly PathModifierStyle[],
  tolerance = 0.35,
  flattenedPath?: FlattenedPath,
): readonly PathOverlayContour[] {
  const flattened = flattenedPath ?? flattenAuthoringPath(path, tolerance);
  if (flattened.pathId !== path.id || flattened.geometryVersion !== path.geometryVersion) throw new PathAuthoringError(
    'E_PATH_CACHE_BUDGET', '$.pathOverlay.flattenedPath', 'Cached path geometry does not match the authoring path version.',
  );
  let contours: PathOverlayContour[] = flattened.contours.map(contour => ({
    points: contour.points.map(point => point.position), closed: contour.closed,
  }));
  for (const modifier of modifiers) {
    contours = modifier.kind === 'round-corners'
      ? contours.map(contour => roundContour(contour, modifier.radius))
      : trimContours(contours, modifier.start, modifier.end, modifier.offset, modifier.mode);
  }
  return Object.freeze(contours.map(contour => Object.freeze({
    points: Object.freeze(contour.points.map(point => Object.freeze([...point] as PathPoint))), closed: contour.closed,
  })));
}

function sampleFill(
  project: AnimationEditorProject, nodeId: string, componentId: string, time: number,
  fill: PathSolidFillStyle | PathGradientFillStyle,
): PathSolidFillStyle | PathGradientFillStyle {
  const opacity = sampleProperty(project, nodeId, componentId, undefined, 'vector.fill.opacity', time)?.[0] ?? fill.opacity;
  if (fill.kind === 'solid') return Object.freeze({
    ...fill, color: rgba(sampleProperty(project, nodeId, componentId, undefined, 'vector.fill.color', time) ?? fill.color), opacity,
  });
  return Object.freeze({
    ...fill,
    start: vec2(sampleProperty(project, nodeId, componentId, undefined, 'vector.gradient.start', time) ?? fill.start),
    end: vec2(sampleProperty(project, nodeId, componentId, undefined, 'vector.gradient.end', time) ?? fill.end),
    stops: Object.freeze([...(sampleProperty(project, nodeId, componentId, undefined, 'vector.gradient.stops', time) ?? fill.stops)]),
    opacity,
  });
}

function sampleStroke(
  project: AnimationEditorProject, nodeId: string, componentId: string, time: number, stroke: PathStrokeStyle,
): PathStrokeStyle {
  return Object.freeze({
    ...stroke,
    color: rgba(sampleProperty(project, nodeId, componentId, undefined, 'vector.stroke.color', time) ?? stroke.color),
    opacity: sampleProperty(project, nodeId, componentId, undefined, 'vector.stroke.opacity', time)?.[0] ?? stroke.opacity,
    width: sampleProperty(project, nodeId, componentId, undefined, 'vector.stroke.width', time)?.[0] ?? stroke.width,
    dashOffset: sampleProperty(project, nodeId, componentId, undefined, 'vector.stroke.dash-offset', time)?.[0] ?? stroke.dashOffset,
  });
}

function sampleModifier(
  project: AnimationEditorProject, nodeId: string, componentId: string, partId: string | undefined,
  time: number, modifier: PathModifierStyle,
): PathModifierStyle {
  if (modifier.kind === 'round-corners') return Object.freeze({
    ...modifier,
    radius: sampleProperty(project, nodeId, componentId, partId, 'vector.modifier.round-radius', time)?.[0] ?? modifier.radius,
  });
  return Object.freeze({
    ...modifier,
    start: sampleProperty(project, nodeId, componentId, partId, 'vector.modifier.trim-start', time)?.[0] ?? modifier.start,
    end: sampleProperty(project, nodeId, componentId, partId, 'vector.modifier.trim-end', time)?.[0] ?? modifier.end,
    offset: sampleProperty(project, nodeId, componentId, partId, 'vector.modifier.trim-offset', time)?.[0] ?? modifier.offset,
  });
}

function sampleProperty(
  project: AnimationEditorProject, nodeId: string, componentId: string, partId: string | undefined,
  property: string, time: number,
): readonly number[] | null {
  const track = project.timeline.tracks.find(item => item.enabled !== false && item.target.kind === 'component-property'
    && item.target.nodeId === nodeId && item.target.componentId === componentId
    && item.target.partId === partId && item.target.property === property);
  return track ? sampleAnimationEditorTrack(track, time) : null;
}

function roundContour(contour: PathOverlayContour, radius: number): PathOverlayContour {
  if (radius <= 0 || contour.points.length < 3) return contour;
  const points: PathPoint[] = [];
  const count = contour.points.length;
  const start = contour.closed ? 0 : 1;
  if (!contour.closed) points.push(contour.points[0]!);
  for (let index = start; index < (contour.closed ? count : count - 1); index++) {
    const previous = contour.points[(index - 1 + count) % count]!;
    const current = contour.points[index]!;
    const next = contour.points[(index + 1) % count]!;
    const distance = Math.min(radius, length(previous, current) / 2, length(current, next) / 2);
    const incoming = toward(current, previous, distance);
    const outgoing = toward(current, next, distance);
    points.push(incoming);
    for (let step = 1; step <= 3; step++) {
      const t = step / 3;
      points.push(quadratic(incoming, current, outgoing, t));
    }
  }
  if (!contour.closed) points.push(contour.points[count - 1]!);
  return { points, closed: contour.closed };
}

function trimContours(
  contours: readonly PathOverlayContour[], start: number, end: number, offset: number,
  mode: 'simultaneous' | 'individual',
): PathOverlayContour[] {
  if (mode === 'individual') return contours.flatMap(contour => trimContour(contour, start, end, offset));
  const lengths = contours.map(contourLength);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  const ranges = normalizedRanges(start + offset, end + offset);
  const output: PathOverlayContour[] = [];
  let preceding = 0;
  contours.forEach((contour, index) => {
    const contourStart = preceding / total;
    preceding += lengths[index]!;
    const contourEnd = preceding / total;
    for (const range of ranges) {
      const left = Math.max(range[0], contourStart);
      const right = Math.min(range[1], contourEnd);
      if (right > left) output.push(...trimContour(contour,
        (left - contourStart) / Math.max(Number.EPSILON, contourEnd - contourStart),
        (right - contourStart) / Math.max(Number.EPSILON, contourEnd - contourStart), 0));
    }
  });
  return output;
}

function trimContour(contour: PathOverlayContour, start: number, end: number, offset: number): PathOverlayContour[] {
  const ranges = normalizedRanges(start + offset, end + offset);
  const segments = pathSegments(contour);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= 0) return [];
  return ranges.map(range => {
    const points: PathPoint[] = [];
    let position = 0;
    for (const segment of segments) {
      const left = position / total;
      const right = (position + segment.length) / total;
      const overlapStart = Math.max(left, range[0]);
      const overlapEnd = Math.min(right, range[1]);
      if (overlapEnd > overlapStart) {
        const from = lerp(segment.from, segment.to, (overlapStart - left) / Math.max(Number.EPSILON, right - left));
        const to = lerp(segment.from, segment.to, (overlapEnd - left) / Math.max(Number.EPSILON, right - left));
        if (!points.length || length(points[points.length - 1]!, from) > 1e-6) points.push(from);
        points.push(to);
      }
      position += segment.length;
    }
    return { points, closed: false };
  }).filter(contour => contour.points.length > 1);
}

function normalizedRanges(start: number, end: number): readonly (readonly [number, number])[] {
  const span = end - start;
  if (Math.abs(span) >= 1 - 1e-9) return [[0, 1]];
  if (Math.abs(span) < 1e-9) return [];
  const left = modulo(start);
  const right = modulo(end);
  return span > 0
    ? left <= right ? [[left, right]] : [[left, 1], [0, right]]
    : right <= left ? [[right, left]] : [[right, 1], [0, left]];
}

function pathSegments(contour: PathOverlayContour) {
  const output: { from: PathPoint; to: PathPoint; length: number }[] = [];
  for (let index = 1; index < contour.points.length; index++) {
    const from = contour.points[index - 1]!; const to = contour.points[index]!;
    output.push({ from, to, length: length(from, to) });
  }
  if (contour.closed && contour.points.length > 1) {
    const from = contour.points[contour.points.length - 1]!; const to = contour.points[0]!;
    output.push({ from, to, length: length(from, to) });
  }
  return output;
}

function contourLength(contour: PathOverlayContour): number {
  return pathSegments(contour).reduce((sum, segment) => sum + segment.length, 0);
}

function fillStyle(value: JsonRecord, path: string): PathSolidFillStyle | PathGradientFillStyle | null {
  if (!Object.keys(value).length) return null;
  const opacity = unit(value.opacity ?? 1, `${path}.opacity`);
  if (value.kind === 'solid') return Object.freeze({ kind: 'solid', color: rgba(value.color, `${path}.color`), opacity });
  if (value.kind === 'linear-gradient' || value.kind === 'radial-gradient') return Object.freeze({
    kind: value.kind, start: vec2(value.start, `${path}.start`), end: vec2(value.end, `${path}.end`),
    stops: gradientStops(value.stops, `${path}.stops`), opacity,
  });
  throw new PathAuthoringError('E_PATH_COMPONENT', `${path}.kind`, 'Unknown vector fill kind.');
}

function strokeStyle(value: JsonRecord, path: string): PathStrokeStyle | null {
  if (!Object.keys(value).length) return null;
  const lineCap = value.lineCap === 'butt' || value.lineCap === 'square' ? value.lineCap : 'round';
  const lineJoin = value.lineJoin === 'miter' || value.lineJoin === 'bevel' ? value.lineJoin : 'round';
  return Object.freeze({
    color: rgba(value.color, `${path}.color`), width: nonNegative(value.width ?? 1, `${path}.width`),
    opacity: unit(value.opacity ?? 1, `${path}.opacity`), lineCap, lineJoin,
    miterLimit: positive(value.miterLimit, 4), dash: Object.freeze(array(value.dash).map((item, index) => nonNegative(item, `${path}.dash[${index}]`))),
    dashOffset: finite(value.dashOffset ?? 0, `${path}.dashOffset`),
  });
}

function modifierStyles(values: readonly unknown[], path: string): PathModifierStyle[] {
  return values.map((item, index) => {
    const value = object(item); const itemPath = `${path}[${index}]`;
    if (value.kind === 'round-corners') return Object.freeze({
      kind: 'round-corners', radius: nonNegative(value.radius, `${itemPath}.radius`),
    });
    if (value.kind === 'trim-path') return Object.freeze({
      kind: 'trim-path', start: finite(value.start, `${itemPath}.start`), end: finite(value.end, `${itemPath}.end`),
      offset: finite(value.offset, `${itemPath}.offset`), mode: value.mode === 'individual' ? 'individual' : 'simultaneous',
    });
    throw new PathAuthoringError('E_PATH_COMPONENT', `${itemPath}.kind`, 'Unknown path modifier kind.');
  });
}

function solidPayload(color: readonly [number, number, number, number], opacity: number) {
  return { kind: 'solid', color: [...rgba(color)], opacity: unit(opacity, '$.fill.opacity') };
}

function gradientPayload(edit: Extract<PathVectorStyleEdit, { kind: 'fill-gradient' }>) {
  return {
    kind: edit.gradientKind, start: [...vec2(edit.start)], end: [...vec2(edit.end)],
    stops: [...gradientStops(edit.stops, '$.fill.stops')], opacity: unit(edit.opacity, '$.fill.opacity'),
  };
}

function strokePayload(value: PathStrokeStyle) {
  return {
    color: [...rgba(value.color)], width: nonNegative(value.width, '$.stroke.width'), opacity: unit(value.opacity, '$.stroke.opacity'),
    lineCap: value.lineCap, lineJoin: value.lineJoin, miterLimit: positive(value.miterLimit, 4),
    dash: value.dash.map((item, index) => nonNegative(item, `$.stroke.dash[${index}]`)),
    dashOffset: finite(value.dashOffset, '$.stroke.dashOffset'),
  };
}

function gradientStops(value: unknown, path: string): readonly number[] {
  const stops = array(value);
  if (stops.length < 10 || stops.length > 40 || stops.length % 5 !== 0) throw new PathAuthoringError(
    'E_PATH_COMPONENT', path, 'Gradient stops require 2–8 offset,r,g,b,a tuples.',
  );
  let previous = -1;
  return Object.freeze(stops.map((item, index) => {
    const normalized = unit(item, `${path}[${index}]`);
    if (index % 5 === 0 && normalized < previous) throw new PathAuthoringError(
      'E_PATH_COMPONENT', `${path}[${index}]`, 'Gradient offsets must be non-decreasing.',
    );
    if (index % 5 === 0) previous = normalized;
    return normalized;
  }));
}

function uniquePartId(existing: readonly string[], base: string): string {
  let id = base; let suffix = 2;
  while (existing.includes(id)) id = `${base}-${suffix++}`;
  return id;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new PathAuthoringError('E_PATH_COMPONENT', path, 'Value must be finite.');
  return value;
}
function positive(value: unknown, fallback: number): number {
  const result = value === undefined ? fallback : finite(value, '$.tolerance');
  if (result <= 0) throw new PathAuthoringError('E_PATH_COMPONENT', '$.tolerance', 'Value must be positive.');
  return result;
}
function nonNegative(value: unknown, path: string): number {
  const result = finite(value, path); if (result < 0) throw new PathAuthoringError('E_PATH_COMPONENT', path, 'Value must be non-negative.'); return result;
}
function unit(value: unknown, path: string): number {
  const result = finite(value, path); if (result < 0 || result > 1) throw new PathAuthoringError('E_PATH_COMPONENT', path, 'Value must be in [0, 1].'); return result;
}
function rgba(value: unknown, path = '$.color'): readonly [number, number, number, number] {
  const values = array(value); if (values.length !== 4) throw new PathAuthoringError('E_PATH_COMPONENT', path, 'RGBA color requires four values.');
  return Object.freeze(values.map((item, index) => unit(item, `${path}[${index}]`)) as [number, number, number, number]);
}
function vec2(value: unknown, path = '$.point'): PathPoint {
  const values = array(value); if (values.length !== 2) throw new PathAuthoringError('E_PATH_COMPONENT', path, 'Point requires two values.');
  return Object.freeze([finite(values[0], `${path}[0]`), finite(values[1], `${path}[1]`)]);
}
function length(left: PathPoint, right: PathPoint): number { return Math.hypot(right[0] - left[0], right[1] - left[1]); }
function toward(from: PathPoint, to: PathPoint, distance: number): PathPoint {
  const total = length(from, to); return total <= 0 ? from : lerp(from, to, distance / total);
}
function lerp(left: PathPoint, right: PathPoint, t: number): PathPoint {
  return Object.freeze([left[0] + (right[0] - left[0]) * t, left[1] + (right[1] - left[1]) * t]);
}
function quadratic(from: PathPoint, control: PathPoint, to: PathPoint, t: number): PathPoint {
  const inverse = 1 - t; return Object.freeze([
    inverse * inverse * from[0] + 2 * inverse * t * control[0] + t * t * to[0],
    inverse * inverse * from[1] + 2 * inverse * t * control[1] + t * t * to[1],
  ]);
}
function modulo(value: number): number { return ((value % 1) + 1) % 1; }
