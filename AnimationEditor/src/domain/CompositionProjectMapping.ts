import type {
  AnimationDocument,
  AnimationInterpolation,
  AnimationTrack,
  AnimationVectorValueTrack,
  ParsedAnimation,
} from '@haiyue/animation-spec';
import {
  ANIMATION_EDITOR_PROJECT_FORMAT,
  ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION,
  type AnimationEditorComponentPartRole,
  type AnimationEditorComponentProperty,
  type AnimationEditorEffectProperty,
  type AnimationEditorKeyframe,
  type AnimationEditorProject,
  type AnimationEditorTrack,
  type JsonObject,
  type JsonValue,
} from './AnimationEditorProject';
import { parseAnimationEditorProject } from '../persistence/ProjectCodec';

export interface CompositionProjectMappingOptions {
  readonly projectId: string;
  readonly name?: string;
}

/**
 * Maps runtime/delivery data to the editable 2D project shape. The mapping is
 * intentionally source-neutral: provenance and the fact that HYA is delivery
 * data live in the G07 workspace rather than pretending to be project fields.
 */
export function mapAnimationDocumentToEditorProject(
  document: AnimationDocument | ParsedAnimation,
  options: CompositionProjectMappingOptions,
): AnimationEditorProject {
  const advancedTracks: AnimationEditorTrack[] = [];
  const nodeIdMap = stableIdMap(document.nodes.map(node => node.id), 'node');
  const assetIdMap = stableIdMap((document.resources ?? []).map(resource => resource.id), 'asset');
  const nodes = document.nodes.map((node, nodeIndex) => {
    const nodeId = nodeIdMap.get(node.id)!;
    const components = (node.components ?? []).map((component, componentIndex) => {
      const id = `${nodeId}:component:${componentIndex}`;
      const payload = remapResourceReferences(jsonObject(component), assetIdMap);
      const parts = componentParts(payload, id);
      collectComponentTracks(payload, nodeId, id, parts, advancedTracks);
      return {
        id,
        name: typeof payload.type === 'string' ? payload.type : `Component ${componentIndex + 1}`,
        component: payload as AnimationEditorProject['nodes'][number]['components'][number]['component'],
        ...(parts.length > 0 ? { parts } : {}),
      };
    });
    const effects = (node.effects ?? []).map((effect, effectIndex) => {
      const id = `${nodeId}:effect:${effectIndex}`;
      const payload = jsonObject(effect);
      collectEffectTracks(payload, nodeId, id, advancedTracks);
      return {
        id,
        name: typeof payload.kind === 'string' ? payload.kind : `Effect ${effectIndex + 1}`,
        effect: payload as AnimationEditorProject['nodes'][number]['effects'][number]['effect'],
      };
    });
    const compositeValues = node.composite === undefined
      ? []
      : 'layers' in node.composite ? node.composite.layers : [node.composite];
    const compositeLayers = compositeValues.map((layer, layerIndex) => {
      const id = `${nodeId}:composite:${layerIndex}`;
      if (layer.expansionTrack) {
        advancedTracks.push(editorTrackFromValueTrack(
          `${id}:expansion`,
          `${node.name ?? node.id} · Composite expansion`,
          {
            kind: 'composite-property', nodeId, compositeLayerId: id, property: 'expansion',
          },
          layer.expansionTrack,
        ));
      }
      return {
        id,
        kind: layer.kind,
        sourceNodeId: nodeIdMap.get(layer.source) ?? stableEditorId(layer.source, 'node'),
        mode: layer.mode,
        ...(layer.operation === undefined ? {} : { operation: layer.operation }),
        ...(layer.feather === undefined ? {} : { feather: [...layer.feather] as [number, number] }),
        ...(layer.expansion === undefined ? {} : { expansion: layer.expansion }),
      };
    });
    return {
      id: nodeId,
      name: node.name ?? `Layer ${nodeIndex + 1}`,
      ...(node.parent === undefined ? {} : { parent: nodeIdMap.get(node.parent) ?? stableEditorId(node.parent, 'node') }),
      ...(node.start === undefined ? {} : { start: node.start }),
      ...(node.duration === undefined ? {} : { duration: node.duration }),
      transform: jsonObject(node.transform ?? {}) as AnimationEditorProject['nodes'][number]['transform'],
      components,
      effects,
      compositeLayers,
      ...(node.extensions === undefined ? {} : { extensions: jsonObject(node.extensions) }),
    };
  });

  const tracks = (document.tracks ?? []).map((track, index) => editorTrackFromCoreTrack(track, index, nodeIdMap));
  const project: AnimationEditorProject = {
    format: ANIMATION_EDITOR_PROJECT_FORMAT,
    schemaVersion: ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION,
    id: options.projectId,
    name: options.name ?? document.name ?? 'Imported animation',
    composition: {
      canvas: {
        width: document.canvas.width,
        height: document.canvas.height,
        coordinateSystem: 'screen-y-down',
      },
      duration: document.duration,
      frameRate: document.frameRate ?? 60,
      endBehavior: document.endBehavior ?? 'hold',
    },
    assets: (document.resources ?? []).map(resource => {
      const embedded = /^data:([^;,]+)?;base64,([A-Za-z0-9+/=]+)$/u.exec(resource.uri);
      const mimeType = resource.mimeType ?? embedded?.[1] ?? undefined;
      return {
        id: assetIdMap.get(resource.id)!,
        name: resource.id,
        type: resource.type,
        source: embedded
          ? {
              kind: 'embedded' as const,
              fileName: resource.id,
              mimeType: mimeType ?? 'application/octet-stream',
              encoding: 'base64' as const,
              data: embedded[2]!,
            }
          : { kind: 'external' as const, uri: resource.uri },
        delivery: {
          uri: resource.uri,
          ...(mimeType === undefined ? {} : { mimeType }),
          ...(resource.integrity === undefined ? {} : { integrity: resource.integrity }),
          ...(resource.type !== 'image' || resource.width === undefined ? {} : { width: resource.width }),
          ...(resource.type !== 'image' || resource.height === undefined ? {} : { height: resource.height }),
          ...(resource.type !== 'image' || resource.colorSpace === undefined ? {} : { colorSpace: resource.colorSpace }),
        },
      };
    }),
    nodes,
    timeline: { tracks: [...tracks, ...advancedTracks], clips: [] },
    stateMachine: null,
    editor: {
      activePanel: 'timeline',
      viewport: {
        zoom: 1,
        center: [document.canvas.width / 2, document.canvas.height / 2],
        showGrid: true,
      },
      timeline: { playhead: 0, pixelsPerSecond: 240, scrollX: 0 },
    },
  };
  return parseAnimationEditorProject(project);
}

function editorTrackFromCoreTrack(
  track: AnimationTrack,
  index: number,
  nodeIds: ReadonlyMap<string, string>,
): AnimationEditorTrack {
  const nodeId = nodeIds.get(track.node) ?? stableEditorId(track.node, 'node');
  const size = track.property === 'position' || track.property === 'scale' ? 2 : 1;
  const valueTrack: AnimationVectorValueTrack = {
    times: track.times,
    values: track.values,
    valueSize: size,
    interpolation: track.interpolation,
    ...(track.easings === undefined ? {} : { easings: track.easings }),
  };
  const keyframes = editorKeyframes(valueTrack, `track:${nodeId}:${track.property}:${index}`);
  const tangents = track.spatialTangents === undefined ? [] : Array.from(track.spatialTangents);
  if (tangents.length > 0) {
    keyframes.forEach((keyframe, keyframeIndex) => {
      const previousOffset = (keyframeIndex - 1) * 4;
      const nextOffset = keyframeIndex * 4;
      if (keyframeIndex > 0) keyframe.spatialIn = [tangents[previousOffset + 2]!, tangents[previousOffset + 3]!];
      if (keyframeIndex + 1 < keyframes.length) keyframe.spatialOut = [tangents[nextOffset]!, tangents[nextOffset + 1]!];
    });
  }
  return {
    id: `track:${nodeId}:${track.property}:${index}`,
    name: `${track.node} · ${track.property}`,
    target: { kind: 'node-transform', nodeId, property: track.property },
    valueSize: size,
    enabled: true,
    keyframes,
  };
}

function editorTrackFromValueTrack(
  id: string,
  name: string,
  target: Exclude<AnimationEditorTrack['target'], { readonly kind: 'node-transform' }>,
  track: AnimationVectorValueTrack,
): AnimationEditorTrack {
  return {
    id,
    name,
    target,
    valueSize: track.valueSize,
    enabled: true,
    keyframes: editorKeyframes(track, id),
  };
}

function editorKeyframes(track: AnimationVectorValueTrack, id: string): Array<Mutable<AnimationEditorKeyframe>> {
  const times = Array.from(track.times);
  const values = Array.from(track.values);
  const easings = track.easings === undefined ? [] : Array.from(track.easings);
  return times.map((time, index) => ({
    id: `${id}:key:${index}`,
    time,
    value: values.slice(index * track.valueSize, (index + 1) * track.valueSize),
    interpolation: track.interpolation,
    ...(track.interpolation !== 'cubic-bezier' || index + 1 >= times.length ? {} : {
      easing: easings.length >= (index + 1) * 4
        ? easings.slice(index * 4, index * 4 + 4) as [number, number, number, number]
        : [0, 0, 1, 1] as [number, number, number, number],
    }),
  }));
}

function collectComponentTracks(
  component: MutableRecord,
  nodeId: string,
  componentId: string,
  parts: readonly MutablePart[],
  output: AnimationEditorTrack[],
): void {
  const add = (property: AnimationEditorComponentProperty, owner: MutableRecord, field: string, partId?: string): void => {
    const track = valueTrack(owner[field]);
    if (!track) return;
    delete owner[field];
    output.push(editorTrackFromValueTrack(
      `${componentId}:${property}${partId ? `:${partId}` : ''}`,
      `${nodeId} · ${property}`,
      { kind: 'component-property', nodeId, componentId, ...(partId ? { partId } : {}), property },
      track,
    ));
  };
  if (component.type === 'sprite2d') add('sprite.uv-rect', component, 'uvRectTrack');
  if (component.type === 'org.haiyue.vector-shape@1') {
    add('vector.morph', component, 'morph');
    const fill = record(component.fill);
    if (fill?.kind === 'solid') {
      add('vector.fill.color', fill, 'colorTrack');
      add('vector.fill.opacity', fill, 'opacityTrack');
    } else if (fill?.kind === 'linear-gradient' || fill?.kind === 'radial-gradient') {
      add('vector.gradient.start', fill, 'startTrack');
      add('vector.gradient.end', fill, 'endTrack');
      add('vector.gradient.stops', fill, 'stopsTrack');
      add('vector.fill.opacity', fill, 'opacityTrack');
    }
    const stroke = record(component.stroke);
    if (stroke) {
      add('vector.stroke.color', stroke, 'colorTrack');
      add('vector.stroke.opacity', stroke, 'opacityTrack');
      add('vector.stroke.width', stroke, 'widthTrack');
      add('vector.stroke.dash-offset', stroke, 'dashOffsetTrack');
    }
    const modifiers = Array.isArray(component.modifiers) ? component.modifiers : [];
    for (const part of parts.filter(candidate => candidate.role === 'modifier')) {
      const modifier = record(modifiers[part.index ?? -1]);
      if (!modifier) continue;
      if (modifier.kind === 'trim-path') {
        add('vector.modifier.trim-start', modifier, 'startTrack', part.id);
        add('vector.modifier.trim-end', modifier, 'endTrack', part.id);
        add('vector.modifier.trim-offset', modifier, 'offsetTrack', part.id);
      } else if (modifier.kind === 'round-corners') {
        add('vector.modifier.round-radius', modifier, 'radiusTrack', part.id);
      }
    }
  }
  if (component.type !== 'text2d' || !Array.isArray(component.animators)) return;
  for (const part of parts.filter(candidate => candidate.role === 'text-selector' || candidate.role === 'text-animator')) {
    const animator = record(component.animators[part.index ?? -1]);
    if (!animator) continue;
    if (part.role === 'text-selector') {
      const selector = record(animator.selector);
      if (!selector) continue;
      add('text.selector.start', selector, 'startTrack', part.id);
      add('text.selector.end', selector, 'endTrack', part.id);
      add('text.selector.offset', selector, 'offsetTrack', part.id);
      add('text.selector.amount', selector, 'amountTrack', part.id);
    } else {
      add('text.animator.position', animator, 'positionTrack', part.id);
      add('text.animator.scale', animator, 'scaleTrack', part.id);
      add('text.animator.rotation', animator, 'rotationTrack', part.id);
      add('text.animator.opacity', animator, 'opacityTrack', part.id);
      add('text.animator.fill-color', animator, 'fillColorTrack', part.id);
      add('text.animator.tracking', animator, 'trackingTrack', part.id);
    }
  }
}

function collectEffectTracks(
  effect: MutableRecord,
  nodeId: string,
  effectId: string,
  output: AnimationEditorTrack[],
): void {
  const definitions: Readonly<Record<string, readonly [AnimationEditorEffectProperty, string][]>> = {
    tint: [['tint.black', 'blackTrack'], ['tint.white', 'whiteTrack'], ['tint.amount', 'amountTrack']],
    fill: [['fill.color', 'colorTrack'], ['fill.opacity', 'opacityTrack']],
    opacity: [['opacity.value', 'opacityTrack']],
    'color-matrix': [['color-matrix.matrix', 'matrixTrack']],
    blur: [['blur.radius', 'radiusTrack']],
    'drop-shadow': [
      ['drop-shadow.color', 'colorTrack'], ['drop-shadow.opacity', 'opacityTrack'],
      ['drop-shadow.offset', 'offsetTrack'], ['drop-shadow.blur', 'blurTrack'],
    ],
  };
  for (const [property, field] of definitions[String(effect.kind)] ?? []) {
    const track = valueTrack(effect[field]);
    if (!track) continue;
    delete effect[field];
    output.push(editorTrackFromValueTrack(
      `${effectId}:${property}`,
      `${nodeId} · ${property}`,
      { kind: 'effect-property', nodeId, effectId, property },
      track,
    ));
  }
}

function componentParts(component: MutableRecord, id: string): MutablePart[] {
  const parts: MutablePart[] = [];
  if (component.type === 'org.haiyue.vector-shape@1') {
    if (component.fill !== undefined) parts.push({ id: `${id}:fill`, role: 'fill' });
    if (component.stroke !== undefined) parts.push({ id: `${id}:stroke`, role: 'stroke' });
    const modifiers = Array.isArray(component.modifiers) ? component.modifiers : [];
    modifiers.forEach((_modifier, index) => parts.push({ id: `${id}:modifier:${index}`, role: 'modifier', index }));
  }
  if (component.type === 'text2d' && Array.isArray(component.animators)) {
    component.animators.forEach((_animator, index) => {
      parts.push({ id: `${id}:selector:${index}`, role: 'text-selector', index });
      parts.push({ id: `${id}:animator:${index}`, role: 'text-animator', index });
    });
  }
  return parts;
}

function valueTrack(value: JsonValue | undefined): AnimationVectorValueTrack | null {
  const candidate = record(value);
  if (!candidate || !Array.isArray(candidate.times) || !Array.isArray(candidate.values)
    || typeof candidate.valueSize !== 'number'
    || !isInterpolation(candidate.interpolation)) return null;
  return {
    times: candidate.times as number[],
    values: candidate.values as number[],
    valueSize: candidate.valueSize,
    interpolation: candidate.interpolation,
    ...(Array.isArray(candidate.easings) ? { easings: candidate.easings as number[] } : {}),
  };
}

function isInterpolation(value: JsonValue | undefined): value is AnimationInterpolation {
  return value === 'step' || value === 'linear' || value === 'cubic-bezier';
}

function jsonObject(value: unknown): MutableRecord {
  const converted = jsonValue(value);
  if (!converted || Array.isArray(converted) || typeof converted !== 'object') return {};
  return converted as MutableRecord;
}

function remapResourceReferences(value: MutableRecord, assets: ReadonlyMap<string, string>): MutableRecord {
  const visit = (entry: JsonValue, key = ''): JsonValue => {
    if (Array.isArray(entry)) return entry.map(child => visit(child));
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry).map(([childKey, child]) => [childKey, visit(child, childKey)]));
    }
    if (typeof entry === 'string' && (key === 'resource' || key === 'fontResource')) return assets.get(entry) ?? entry;
    return entry;
  };
  return visit(value) as MutableRecord;
}

function stableIdMap(values: readonly string[], prefix: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const value of values) {
    let candidate = stableEditorId(value, prefix);
    let suffix = 2;
    while (used.has(candidate)) candidate = `${stableEditorId(value, prefix)}:${suffix++}`;
    used.add(candidate);
    result.set(value, candidate);
  }
  return result;
}

function stableEditorId(value: string, prefix: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._:-]+/gu, '-').replace(/^[^A-Za-z0-9]+/u, '');
  const readable = cleaned || prefix;
  const changed = readable !== value;
  const base = /^[A-Za-z0-9]/u.test(readable) ? readable : `${prefix}:${readable}`;
  const candidate = changed ? `${base}:${shortHash(value)}` : base;
  return candidate.length <= 240 ? candidate : `${candidate.slice(0, 220)}:${shortHash(candidate)}`;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(36);
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>).map(item => jsonValue(item));
  if (Array.isArray(value)) return value.filter(item => item !== undefined).map(item => jsonValue(item));
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) if (child !== undefined) output[key] = jsonValue(child);
    return output;
  }
  return null;
}

function record(value: JsonValue | undefined): MutableRecord | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value as MutableRecord
    : null;
}

interface MutablePart {
  id: string;
  role: AnimationEditorComponentPartRole;
  index?: number;
}

interface MutableRecord extends Record<string, JsonValue> {}
type Mutable<T> = { -readonly [Key in keyof T]: Mutable<T[Key]> };
