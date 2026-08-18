import {
  ANIMATION_FORMAT,
  ANIMATION_VECTOR_SHAPE_EXTENSION_ID,
  ANIMATION_VERSION,
  AnimationFormatError,
  HYA_STATE_MACHINE_EXTENSION_ID,
  encodeAnimationBinary,
  extensionIdFromComponentType,
  parseAnimation,
  type AnimationComponent,
  type AnimationDocument,
  type AnimationLayerEffect,
  type AnimationNode,
  type AnimationResource,
  type AnimationTrack,
  type AnimationVectorValueTrack,
  type ParsedAnimation,
} from '@haiyue/animation-spec';
import type {
  AnimationEditorKeyframe,
  AnimationEditorProject,
  AnimationEditorTrack,
  JsonValue,
} from '../domain/AnimationEditorProject';
import {
  AnimationEditorProjectFormatError,
  parseAnimationEditorProject,
} from '../persistence/ProjectCodec';
import {
  advancedTrackExpectedValueSize,
  isStepOnlyAdvancedTrack,
} from '../domain/AdvancedContentAuthoring';
import {
  stateMachineAudioUnmixablePath,
  stateMachineTrackChannel,
} from '../domain/StateMachineChannelCapability';

const BUILT_IN_EXTENSION_COMPONENTS = new Set([
  ANIMATION_VECTOR_SHAPE_EXTENSION_ID,
  'org.haiyue.vector-stroke@1',
  'org.haiyue.vector-path-morph@1',
]);
const MAX_DEFAULT_BAKED_KEYFRAMES = 1_000_000;

export type AnimationEditorCompileDiagnosticSeverity = 'warning' | 'error';

export type AnimationEditorCompileDiagnosticCode =
  | 'E_COMPILE_INVALID_PROJECT'
  | 'E_COMPILE_RUNTIME_VALIDATION'
  | 'E_COMPILE_UNSUPPORTED_TRACK_TARGET'
  | 'E_COMPILE_TRACK_VALUE_SIZE'
  | 'E_COMPILE_TRACK_INTERPOLATION'
  | 'E_COMPILE_EXTENSION_ADAPTER_REQUIRED'
  | 'E_COMPILE_NON_DEPLOYABLE_URI'
  | 'E_COMPILE_STATE_MACHINE_SIDE_EFFECT'
  | 'E_COMPILE_STATE_MACHINE_UNSUPPORTED_CHANNEL'
  | 'E_COMPILE_STATE_MACHINE_AUDIO_UNMIXABLE_RANGE'
  | 'E_COMPILE_BAKE_LIMIT'
  | 'W_TRACK_MIXED_INTERPOLATION_BAKED'
  | 'W_EMBEDDED_ASSET_EXTERNALIZED'
  | 'W_NAMED_CLIPS_NOT_EMITTED';

export interface AnimationEditorCompileDiagnostic {
  readonly code: AnimationEditorCompileDiagnosticCode;
  readonly severity: AnimationEditorCompileDiagnosticSeverity;
  readonly path: string;
  readonly message: string;
}

export interface AnimationEditorCompileOptions {
  readonly maxBakedKeyframes?: number;
}

export interface AnimationEditorCompilation {
  readonly document: AnimationDocument;
  readonly binary: ArrayBuffer;
  readonly parsed: ParsedAnimation;
  readonly diagnostics: readonly AnimationEditorCompileDiagnostic[];
}

export class AnimationEditorCompileError extends Error {
  readonly name = 'AnimationEditorCompileError';

  constructor(readonly diagnostics: readonly AnimationEditorCompileDiagnostic[]) {
    const first = diagnostics.find(diagnostic => diagnostic.severity === 'error') ?? diagnostics[0] ?? {
      code: 'E_COMPILE_INVALID_PROJECT' as const,
      severity: 'error' as const,
      path: '$',
      message: 'Animation project compilation failed.',
    };
    super(`${first.message} (${first.path})`);
  }
}

/** Pure project -> HYA compiler. Successful output has already survived binary round-trip parsing. */
export function compileAnimationEditorProject(
  source: AnimationEditorProject,
  options: AnimationEditorCompileOptions = {},
): AnimationEditorCompilation {
  let project: AnimationEditorProject;
  try {
    project = parseAnimationEditorProject(source);
  } catch (error) {
    if (error instanceof AnimationEditorProjectFormatError) {
      throw new AnimationEditorCompileError(error.diagnostics.map(diagnostic => ({
        code: 'E_COMPILE_INVALID_PROJECT',
        severity: 'error',
        path: diagnostic.path,
        message: `${diagnostic.code}: ${diagnostic.message}`,
      })));
    }
    throw error;
  }

  const diagnostics: AnimationEditorCompileDiagnostic[] = [];
  const runtimeTrackProjectIndices: number[] = [];
  const maxBakedKeyframes = positiveIntegerOr(options.maxBakedKeyframes, MAX_DEFAULT_BAKED_KEYFRAMES);
  const extensionsUsed = new Set<string>();
  const extensionsRequired = new Set<string>();

  const resources = project.assets.map((asset, index) => {
    if (asset.delivery.uri.startsWith('blob:')) {
      diagnostics.push(issue(
        'E_COMPILE_NON_DEPLOYABLE_URI',
        'error',
        `$.assets[${index}].delivery.uri`,
        'blob: URLs are temporary and cannot be delivered by a standalone HYA file.',
      ));
    }
    if (asset.source.kind === 'embedded' && !asset.delivery.uri.startsWith('data:')) {
      diagnostics.push(issue(
        'W_EMBEDDED_ASSET_EXTERNALIZED',
        'warning',
        `$.assets[${index}].source`,
        `Embedded source bytes are not copied into bare HYA; runtime delivery uses "${asset.delivery.uri}".`,
      ));
    }
    return lowerResource(asset);
  });

  const nodes = project.nodes.map((node, nodeIndex) => {
    const components = node.components.map((record, componentIndex) => {
      const component = cloneJson(record.component) as unknown as AnimationComponent;
      const extension = extensionIdFromComponentType(component.type);
      if (extension) {
        if (BUILT_IN_EXTENSION_COMPONENTS.has(extension)) extensionsUsed.add(extension);
        else diagnostics.push(issue(
          'E_COMPILE_EXTENSION_ADAPTER_REQUIRED',
          'error',
          `$.nodes[${nodeIndex}].components[${componentIndex}].component.type`,
          `Component extension "${extension}" needs an Animation Editor compiler/runtime adapter.`,
        ));
      }
      return component;
    });
    return lowerNode(node, components);
  });

  const tracks: AnimationTrack[] = [];
  project.timeline.tracks.forEach((track, index) => {
    if (track.enabled === false) return;
    if (track.target.kind !== 'node-transform') {
      const expectedValueSize = advancedTrackExpectedValueSize(project, track.target);
      if (expectedValueSize === null) {
        diagnostics.push(issue(
          'E_COMPILE_UNSUPPORTED_TRACK_TARGET',
          'error',
          `$.timeline.tracks[${index}].target`,
          `Track target "${track.target.kind}" does not match a compatible HYA component, part, effect, or composite layer.`,
        ));
        return;
      }
      if (track.valueSize !== expectedValueSize) {
        diagnostics.push(issue(
          'E_COMPILE_TRACK_VALUE_SIZE',
          'error',
          `$.timeline.tracks[${index}].valueSize`,
          `Typed property requires valueSize ${expectedValueSize}; received ${track.valueSize}.`,
        ));
        return;
      }
      if (isStepOnlyAdvancedTrack(track) && track.keyframes.some(keyframe => keyframe.interpolation !== 'step')) {
        diagnostics.push(issue(
          'E_COMPILE_TRACK_INTERPOLATION',
          'error',
          `$.timeline.tracks[${index}].keyframes`,
          'Sprite UV tracks require Step interpolation for deterministic atlas frame selection.',
        ));
        return;
      }
      const lowered = lowerInlineTrack(track, index, project.composition.frameRate, maxBakedKeyframes, diagnostics);
      if (lowered && !bindInlineTrack(project, nodes, track, lowered)) {
        diagnostics.push(issue(
          'E_COMPILE_UNSUPPORTED_TRACK_TARGET',
          'error',
          `$.timeline.tracks[${index}].target`,
          `Track target "${track.target.kind}" does not match a compatible HYA component, part, effect, or composite layer.`,
        ));
      }
      return;
    }
    const lowered = lowerCoreTrack(track, index, project.composition.frameRate, maxBakedKeyframes, diagnostics);
    if (lowered) {
      runtimeTrackProjectIndices.push(index);
      tracks.push(lowered);
    }
  });

  const extensions: Record<string, unknown> = {};
  if (project.stateMachine) {
    validateStateMachineCompatibility(project, diagnostics);
    extensionsUsed.add(HYA_STATE_MACHINE_EXTENSION_ID);
    extensionsRequired.add(HYA_STATE_MACHINE_EXTENSION_ID);
    extensions[HYA_STATE_MACHINE_EXTENSION_ID] = {
      clips: project.timeline.clips.map(clip => ({
        id: clip.id,
        name: clip.name,
        start: clip.start,
        duration: clip.duration,
      })),
      stateMachine: stripStateMachineEditorData(project.stateMachine),
    };
  } else if (project.timeline.clips.length > 0) {
    diagnostics.push(issue(
      'W_NAMED_CLIPS_NOT_EMITTED',
      'warning',
      '$.timeline.clips',
      'Named clips are emitted with the HYA state-machine extension; this project has no state machine.',
    ));
  }

  throwIfErrors(diagnostics);

  const document: AnimationDocument = {
    format: ANIMATION_FORMAT,
    version: ANIMATION_VERSION,
    name: project.name,
    canvas: cloneJson(project.composition.canvas),
    duration: project.composition.duration,
    frameRate: project.composition.frameRate,
    endBehavior: project.composition.endBehavior,
    resources,
    nodes,
    tracks,
    extensionsUsed: [...extensionsUsed].sort(),
    extensionsRequired: [...extensionsRequired].sort(),
    extensions,
  };

  try {
    const binary = encodeAnimationBinary(document);
    const parsed = parseAnimation(binary);
    return Object.freeze({
      document: Object.freeze(document),
      binary,
      parsed,
      diagnostics: Object.freeze([...diagnostics]),
    });
  } catch (error) {
    if (error instanceof AnimationFormatError) {
      throw new AnimationEditorCompileError([
        issue(
          'E_COMPILE_RUNTIME_VALIDATION',
          'error',
          mapRuntimePathToProjectPath(error.path, runtimeTrackProjectIndices),
          error.message.replace(/ \([^()]+\)$/u, ''),
        ),
      ]);
    }
    throw error;
  }
}

function lowerInlineTrack(
  track: AnimationEditorTrack,
  projectIndex: number,
  frameRate: number,
  maxBakedKeyframes: number,
  diagnostics: AnimationEditorCompileDiagnostic[],
): AnimationVectorValueTrack | null {
  const segmentInterpolations = track.keyframes.slice(0, -1).map(keyframe => keyframe.interpolation);
  const interpolation = segmentInterpolations[0] ?? track.keyframes[0]!.interpolation;
  const mixed = segmentInterpolations.some(value => value !== interpolation);
  if (mixed) {
    diagnostics.push(issue(
      'W_TRACK_MIXED_INTERPOLATION_BAKED',
      'warning',
      `$.timeline.tracks[${projectIndex}].keyframes`,
      `Mixed per-segment interpolation was deterministically baked to linear samples at ${frameRate} fps.`,
    ));
    const baked = bakeTrack(track, frameRate, maxBakedKeyframes, projectIndex, diagnostics);
    return baked ? {
      times: baked.times,
      values: baked.values,
      valueSize: track.valueSize,
      interpolation: 'linear',
    } : null;
  }
  return {
    times: track.keyframes.map(keyframe => keyframe.time),
    values: track.keyframes.flatMap(keyframe => [...keyframe.value]),
    valueSize: track.valueSize,
    interpolation,
    ...(interpolation === 'cubic-bezier' ? {
      easings: track.keyframes.slice(0, -1).flatMap(keyframe => [...(keyframe.easing ?? [0, 0, 1, 1])]),
    } : {}),
  };
}

function bindInlineTrack(
  project: AnimationEditorProject,
  nodes: readonly AnimationNode[],
  track: AnimationEditorTrack,
  valueTrack: AnimationVectorValueTrack,
): boolean {
  const target = track.target;
  if (target.kind === 'node-transform') return false;
  const nodeIndex = project.nodes.findIndex(node => node.id === target.nodeId);
  if (nodeIndex < 0) return false;
  const sourceNode = project.nodes[nodeIndex]!;
  const runtimeNode = nodes[nodeIndex]! as unknown as MutableRecord;

  if (target.kind === 'component-property') {
    const componentIndex = sourceNode.components.findIndex(record => record.id === target.componentId);
    if (componentIndex < 0) return false;
    const components = runtimeNode.components as MutableRecord[] | undefined;
    const component = components?.[componentIndex];
    if (!component) return false;
    return bindComponentTrack(sourceNode.components[componentIndex]!, component, target, valueTrack);
  }
  if (target.kind === 'effect-property') {
    const effectIndex = sourceNode.effects.findIndex(record => record.id === target.effectId);
    if (effectIndex < 0) return false;
    const effects = runtimeNode.effects as MutableRecord[] | undefined;
    const effect = effects?.[effectIndex];
    if (!effect) return false;
    const fields: Readonly<Record<string, string>> = {
      'tint.black': 'blackTrack', 'tint.white': 'whiteTrack', 'tint.amount': 'amountTrack',
      'fill.color': 'colorTrack', 'fill.opacity': 'opacityTrack', 'opacity.value': 'opacityTrack',
      'color-matrix.matrix': 'matrixTrack', 'blur.radius': 'radiusTrack',
      'drop-shadow.color': 'colorTrack', 'drop-shadow.opacity': 'opacityTrack',
      'drop-shadow.offset': 'offsetTrack', 'drop-shadow.blur': 'blurTrack',
    };
    const field = fields[target.property];
    if (!field) return false;
    effect[field] = valueTrack;
    return true;
  }
  const layerIndex = sourceNode.compositeLayers.findIndex(layer => layer.id === target.compositeLayerId);
  const composite = runtimeNode.composite as MutableRecord | undefined;
  const layers = composite?.layers as MutableRecord[] | undefined;
  if (layerIndex < 0 || !layers?.[layerIndex]) return false;
  layers[layerIndex]!.expansionTrack = valueTrack;
  return true;
}

function bindComponentTrack(
  sourceRecord: AnimationEditorProject['nodes'][number]['components'][number],
  component: MutableRecord,
  target: Extract<AnimationEditorTrack['target'], { readonly kind: 'component-property' }>,
  valueTrack: AnimationVectorValueTrack,
): boolean {
  const property = target.property;
  if (property === 'sprite.uv-rect' && component.type === 'sprite2d') {
    component.uvRectTrack = valueTrack;
    return true;
  }
  if (property.startsWith('vector.') && component.type === ANIMATION_VECTOR_SHAPE_EXTENSION_ID) {
    if (property === 'vector.morph') component.morph = valueTrack;
    else if (property.startsWith('vector.fill.')) {
      const fill = component.fill as MutableRecord | undefined;
      if (!fill) return false;
      fill[property === 'vector.fill.color' ? 'colorTrack' : 'opacityTrack'] = valueTrack;
    } else if (property.startsWith('vector.gradient.')) {
      const fill = component.fill as MutableRecord | undefined;
      if (!fill || (fill.kind !== 'linear-gradient' && fill.kind !== 'radial-gradient')) return false;
      const fields = { 'vector.gradient.start': 'startTrack', 'vector.gradient.end': 'endTrack', 'vector.gradient.stops': 'stopsTrack' } as const;
      fill[fields[property as keyof typeof fields]] = valueTrack;
    } else if (property.startsWith('vector.stroke.')) {
      const stroke = component.stroke as MutableRecord | undefined;
      if (!stroke) return false;
      const fields = {
        'vector.stroke.color': 'colorTrack', 'vector.stroke.opacity': 'opacityTrack',
        'vector.stroke.width': 'widthTrack', 'vector.stroke.dash-offset': 'dashOffsetTrack',
      } as const;
      stroke[fields[property as keyof typeof fields]] = valueTrack;
    } else {
      const part = sourceRecord.parts?.find(candidate => candidate.id === target.partId && candidate.role === 'modifier');
      const modifiers = component.modifiers as MutableRecord[] | undefined;
      const modifier = part?.index === undefined ? undefined : modifiers?.[part.index];
      if (!modifier) return false;
      const fields = {
        'vector.modifier.trim-start': 'startTrack', 'vector.modifier.trim-end': 'endTrack',
        'vector.modifier.trim-offset': 'offsetTrack', 'vector.modifier.round-radius': 'radiusTrack',
      } as const;
      const field = fields[property as keyof typeof fields];
      if (!field) return false;
      modifier[field] = valueTrack;
    }
    return true;
  }
  if (!property.startsWith('text.') || component.type !== 'text2d') return false;
  const part = sourceRecord.parts?.find(candidate => candidate.id === target.partId);
  const animators = component.animators as MutableRecord[] | undefined;
  const animator = part?.index === undefined ? undefined : animators?.[part.index];
  if (!animator) return false;
  if (property.startsWith('text.selector.')) {
    const selector = animator.selector as MutableRecord | undefined;
    if (!selector) return false;
    const fields = {
      'text.selector.start': 'startTrack', 'text.selector.end': 'endTrack',
      'text.selector.offset': 'offsetTrack', 'text.selector.amount': 'amountTrack',
    } as const;
    selector[fields[property as keyof typeof fields]] = valueTrack;
  } else {
    const fields = {
      'text.animator.position': 'positionTrack', 'text.animator.scale': 'scaleTrack',
      'text.animator.rotation': 'rotationTrack', 'text.animator.opacity': 'opacityTrack',
      'text.animator.fill-color': 'fillColorTrack', 'text.animator.tracking': 'trackingTrack',
    } as const;
    const field = fields[property as keyof typeof fields];
    if (!field) return false;
    animator[field] = valueTrack;
  }
  return true;
}

interface MutableRecord { [key: string]: unknown }

function lowerResource(asset: AnimationEditorProject['assets'][number]): AnimationResource {
  const common = {
    id: asset.id,
    type: asset.type,
    uri: asset.delivery.uri,
    ...(asset.delivery.mimeType === undefined ? {} : { mimeType: asset.delivery.mimeType }),
    ...(asset.delivery.integrity === undefined ? {} : { integrity: asset.delivery.integrity }),
  };
  if (asset.type !== 'image') return common;
  return {
    ...common,
    type: 'image',
    ...(asset.delivery.width === undefined ? {} : { width: asset.delivery.width }),
    ...(asset.delivery.height === undefined ? {} : { height: asset.delivery.height }),
    ...(asset.delivery.colorSpace === undefined ? {} : { colorSpace: asset.delivery.colorSpace }),
  };
}

function lowerNode(
  node: AnimationEditorProject['nodes'][number],
  components: readonly AnimationComponent[],
): AnimationNode {
  return {
    id: node.id,
    ...(node.name ? { name: node.name } : {}),
    ...(node.parent === undefined ? {} : { parent: node.parent }),
    ...(node.start === undefined ? {} : { start: node.start }),
    ...(node.duration === undefined ? {} : { duration: node.duration }),
    transform: node.editor?.hidden
      ? { ...cloneJson(node.transform), opacity: 0 }
      : cloneJson(node.transform),
    ...(components.length === 0 ? {} : { components }),
    ...(node.effects.length === 0 ? {} : {
      effects: node.effects.map(record => cloneJson(record.effect) as unknown as AnimationLayerEffect),
    }),
    ...(node.compositeLayers.length === 0 ? {} : {
      composite: {
        layers: node.compositeLayers.map(layer => ({
          kind: layer.kind,
          source: layer.sourceNodeId,
          mode: layer.mode,
          ...(layer.operation === undefined ? {} : { operation: layer.operation }),
          ...(layer.feather === undefined ? {} : { feather: cloneJson(layer.feather) }),
          ...(layer.expansion === undefined ? {} : { expansion: layer.expansion }),
        })),
      },
    }),
    ...(node.extensions === undefined ? {} : { extensions: cloneJson(node.extensions) as Readonly<Record<string, unknown>> }),
  };
}

function lowerCoreTrack(
  track: AnimationEditorTrack,
  projectIndex: number,
  frameRate: number,
  maxBakedKeyframes: number,
  diagnostics: AnimationEditorCompileDiagnostic[],
): AnimationTrack | null {
  if (track.target.kind !== 'node-transform') return null;
  const segmentInterpolations = track.keyframes.slice(0, -1).map(keyframe => keyframe.interpolation);
  const interpolation = segmentInterpolations[0] ?? track.keyframes[0]!.interpolation;
  const mixed = segmentInterpolations.some(value => value !== interpolation);
  if (mixed) {
    diagnostics.push(issue(
      'W_TRACK_MIXED_INTERPOLATION_BAKED',
      'warning',
      `$.timeline.tracks[${projectIndex}].keyframes`,
      `Mixed per-segment interpolation was deterministically baked to linear samples at ${frameRate} fps.`,
    ));
    const baked = bakeTrack(track, frameRate, maxBakedKeyframes, projectIndex, diagnostics);
    return baked ? {
      node: track.target.nodeId,
      property: track.target.property,
      interpolation: 'linear',
      times: baked.times,
      values: baked.values,
    } : null;
  }

  const result: AnimationTrack = {
    node: track.target.nodeId,
    property: track.target.property,
    interpolation,
    times: track.keyframes.map(keyframe => keyframe.time),
    values: track.keyframes.flatMap(keyframe => [...keyframe.value]),
  };
  if (interpolation === 'cubic-bezier') {
    result.easings = track.keyframes.slice(0, -1).flatMap(keyframe => [...(keyframe.easing ?? [0, 0, 1, 1])]);
  }
  if (track.target.property === 'position'
    && track.keyframes.some(keyframe => keyframe.spatialIn !== undefined || keyframe.spatialOut !== undefined)) {
    result.spatialTangents = track.keyframes.slice(0, -1).flatMap((keyframe, index) => [
      ...(keyframe.spatialOut ?? [0, 0]),
      ...(track.keyframes[index + 1]!.spatialIn ?? [0, 0]),
    ]);
  }
  return result;
}

function bakeTrack(
  track: AnimationEditorTrack,
  frameRate: number,
  maxBakedKeyframes: number,
  projectIndex: number,
  diagnostics: AnimationEditorCompileDiagnostic[],
): { readonly times: number[]; readonly values: number[] } | null {
  const first = track.keyframes[0]!;
  const last = track.keyframes[track.keyframes.length - 1]!;
  const firstFrame = Math.ceil(first.time * frameRate);
  const lastFrame = Math.floor(last.time * frameRate);
  const frameSampleCount = lastFrame < firstFrame ? 0 : lastFrame - firstFrame + 1;
  if (!Number.isSafeInteger(firstFrame)
    || !Number.isSafeInteger(lastFrame)
    || !Number.isSafeInteger(frameSampleCount)
    || frameSampleCount > maxBakedKeyframes
    || track.keyframes.length > maxBakedKeyframes) {
    diagnostics.push(issue(
      'E_COMPILE_BAKE_LIMIT',
      'error',
      `$.timeline.tracks[${projectIndex}]`,
      `Baked track exceeds the ${maxBakedKeyframes} keyframe compilation budget.`,
    ));
    return null;
  }
  const samples = new Set<number>(track.keyframes.map(keyframe => keyframe.time));
  for (let frame = firstFrame; frame <= lastFrame; frame++) samples.add(frame / frameRate);
  const stepEpsilon = Math.max(1e-5, 1 / frameRate / 1024);
  for (let index = 0; index < track.keyframes.length - 1; index++) {
    const keyframe = track.keyframes[index]!;
    const next = track.keyframes[index + 1]!;
    if (keyframe.interpolation === 'step' && next.time - keyframe.time > stepEpsilon) {
      samples.add(next.time - stepEpsilon);
    }
  }
  const times = [...samples].sort((a, b) => a - b);
  if (times.length > maxBakedKeyframes) {
    diagnostics.push(issue(
      'E_COMPILE_BAKE_LIMIT',
      'error',
      `$.timeline.tracks[${projectIndex}]`,
      `Baked track needs ${times.length} keyframes, exceeding the ${maxBakedKeyframes} compilation budget.`,
    ));
    return null;
  }
  return {
    times,
    values: times.flatMap(time => sampleEditorTrack(track, time)),
  };
}

function sampleEditorTrack(track: AnimationEditorTrack, time: number): number[] {
  const keyframes = track.keyframes;
  if (time <= keyframes[0]!.time) return [...keyframes[0]!.value];
  if (time >= keyframes[keyframes.length - 1]!.time) return [...keyframes[keyframes.length - 1]!.value];
  let index = 0;
  while (index + 1 < keyframes.length && time >= keyframes[index + 1]!.time) index++;
  const start = keyframes[index]!;
  const end = keyframes[index + 1]!;
  if (start.interpolation === 'step') return [...start.value];
  const linearProgress = (time - start.time) / (end.time - start.time);
  const progress = start.interpolation === 'cubic-bezier'
    ? cubicBezierProgress(linearProgress, start.easing ?? [0, 0, 1, 1])
    : linearProgress;
  if (track.target.kind === 'node-transform' && track.target.property === 'position'
    && (start.spatialOut !== undefined || end.spatialIn !== undefined)) {
    return sampleSpatial(start, end, progress);
  }
  return start.value.map((value, component) => value + (end.value[component]! - value) * progress);
}

function sampleSpatial(start: AnimationEditorKeyframe, end: AnimationEditorKeyframe, progress: number): number[] {
  const inverse = 1 - progress;
  const out = start.spatialOut ?? [0, 0];
  const incoming = end.spatialIn ?? [0, 0];
  return [0, 1].map(component => {
    const p0 = start.value[component]!;
    const p1 = p0 + out[component]!;
    const p3 = end.value[component]!;
    const p2 = p3 + incoming[component]!;
    return inverse ** 3 * p0
      + 3 * inverse ** 2 * progress * p1
      + 3 * inverse * progress ** 2 * p2
      + progress ** 3 * p3;
  });
}

function cubicBezierProgress(progress: number, easing: readonly [number, number, number, number]): number {
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 16; iteration++) {
    const candidate = (lower + upper) / 2;
    if (cubicCoordinate(candidate, easing[0], easing[2]) < progress) lower = candidate;
    else upper = candidate;
  }
  return cubicCoordinate((lower + upper) / 2, easing[1], easing[3]);
}

function cubicCoordinate(time: number, first: number, second: number): number {
  const inverse = 1 - time;
  return 3 * inverse ** 2 * time * first + 3 * inverse * time ** 2 * second + time ** 3;
}

function validateStateMachineCompatibility(
  project: AnimationEditorProject,
  diagnostics: AnimationEditorCompileDiagnostic[],
): void {
  const hasAudio = project.nodes.some(node => node.components.some(record => record.component.type === 'audio'));
  if (hasAudio) {
    const path = stateMachineAudioUnmixablePath(project.stateMachine!);
    if (path) diagnostics.push(issue(
      'E_COMPILE_STATE_MACHINE_AUDIO_UNMIXABLE_RANGE',
      'error',
      path,
      'Audio owns one media playhead: Blend Trees, layered amplitude mixing, and non-zero transition ranges are unsupported.',
    ));
  }
  project.timeline.tracks.forEach((track, trackIndex) => {
    if (track.enabled === false) return;
    const assessment = stateMachineTrackChannel(track);
    if (assessment.capability.support !== 'unsupported') return;
    diagnostics.push(issue(
      'E_COMPILE_STATE_MACHINE_UNSUPPORTED_CHANNEL',
      'error',
      `$.timeline.tracks[${trackIndex}].target`,
      `${assessment.capability.diagnosticCode}: channel "${assessment.channelId}" is not yet writable from the shared state-machine pose buffer.`,
    ));
  });
}

function stripStateMachineEditorData(stateMachine: NonNullable<AnimationEditorProject['stateMachine']>): unknown {
  return {
    ...cloneJson(stateMachine),
    layers: stateMachine.layers.map(layer => ({
      ...cloneJson(layer),
      states: layer.states.map(state => {
        const { editorPosition: _editorPosition, ...runtimeState } = cloneJson(state);
        return runtimeState;
      }),
    })),
  };
}

function mapRuntimePathToProjectPath(path: string, runtimeTrackProjectIndices: readonly number[]): string {
  const trackMatch = /^\$\.tracks\[(\d+)\](.*)$/u.exec(path);
  if (trackMatch) {
    const runtimeIndex = Number(trackMatch[1]);
    const projectIndex = runtimeTrackProjectIndices[runtimeIndex];
    return projectIndex === undefined ? '$.timeline.tracks' : `$.timeline.tracks[${projectIndex}]${trackMatch[2]}`;
  }
  return path
    .replace(/^\$\.resources/u, '$.assets')
    .replace(/(\$\.nodes\[\d+\]\.components\[\d+\])/u, '$1.component')
    .replace(/(\$\.nodes\[\d+\]\.effects\[\d+\])/u, '$1.effect')
    .replace(`$.extensions.${HYA_STATE_MACHINE_EXTENSION_ID}.stateMachine`, '$.stateMachine')
    .replace(`$.extensions.${HYA_STATE_MACHINE_EXTENSION_ID}.clips`, '$.timeline.clips');
}

function issue(
  code: AnimationEditorCompileDiagnosticCode,
  severity: AnimationEditorCompileDiagnosticSeverity,
  path: string,
  message: string,
): AnimationEditorCompileDiagnostic {
  return Object.freeze({ code, severity, path, message });
}

function throwIfErrors(diagnostics: readonly AnimationEditorCompileDiagnostic[]): void {
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    throw new AnimationEditorCompileError(Object.freeze([...diagnostics]));
  }
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
