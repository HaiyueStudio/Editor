import {
  AnimationFormatError,
  parseHyaStateMachineExtension,
} from '@haiyue/animation-spec';
import {
  ANIMATION_EDITOR_PROJECT_FORMAT,
  ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION,
  freezeAnimationEditorProject,
  type AnimationEditorNode,
  type AnimationEditorProject,
  type AnimationEditorTrack,
  type JsonValue,
} from '../domain/AnimationEditorProject';
import {
  advancedTrackExpectedValueSize,
  isStepOnlyAdvancedTrack,
} from '../domain/AdvancedContentAuthoring';

export const ANIMATION_EDITOR_PROJECT_FILE_SUFFIX = '.hya-project.json' as const;
export const ANIMATION_EDITOR_PROJECT_MIME_TYPE = 'application/vnd.haiyue.animation-project+json' as const;
export const MAX_PROJECT_FILE_BYTES = 64 * 1024 * 1024;

export type ProjectDiagnosticCode =
  | 'E_PROJECT_INVALID_JSON'
  | 'E_PROJECT_INVALID_FORMAT'
  | 'E_PROJECT_UNSUPPORTED_VERSION'
  | 'E_PROJECT_INVALID_VALUE'
  | 'E_PROJECT_UNKNOWN_FIELD'
  | 'E_PROJECT_DUPLICATE_ID'
  | 'E_PROJECT_UNKNOWN_REFERENCE'
  | 'E_PROJECT_CYCLE'
  | 'E_PROJECT_LIMIT_EXCEEDED';

export interface ProjectDiagnostic {
  readonly code: ProjectDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export interface ProjectDecodeResult {
  readonly project: AnimationEditorProject;
  readonly sourceSchemaVersion: number;
  readonly migrated: boolean;
}

export interface ProjectFileArtifact {
  readonly fileName: string;
  readonly mimeType: typeof ANIMATION_EDITOR_PROJECT_MIME_TYPE;
  readonly text: string;
  readonly bytes: number;
}

export class AnimationEditorProjectFormatError extends Error {
  readonly name = 'AnimationEditorProjectFormatError';

  constructor(readonly diagnostics: readonly ProjectDiagnostic[]) {
    const first = diagnostics[0] ?? {
      code: 'E_PROJECT_INVALID_VALUE' as const,
      path: '$',
      message: 'Invalid Animation Editor project.',
    };
    super(`${first.message} (${first.path})`);
  }
}

/** Parses a detached project, runs the migration boundary, and validates all references. */
export function decodeAnimationEditorProject(source: string | unknown): ProjectDecodeResult {
  let input: unknown = source;
  if (typeof source === 'string') {
    try {
      input = JSON.parse(source) as unknown;
    } catch (error) {
      invalid(
        'E_PROJECT_INVALID_JSON',
        error instanceof SyntaxError ? error.message : 'Project is not valid JSON.',
        '$',
      );
    }
  }
  let detached: unknown;
  try {
    detached = structuredClone(input);
  } catch {
    invalid('E_PROJECT_INVALID_VALUE', 'Project must contain only cloneable JSON values.', '$');
  }
  const root = record(detached, '$');
  const sourceSchemaVersion = safeInteger(root.schemaVersion, '$.schemaVersion');
  if (root.format !== ANIMATION_EDITOR_PROJECT_FORMAT) {
    invalid('E_PROJECT_INVALID_FORMAT', `Expected format "${ANIMATION_EDITOR_PROJECT_FORMAT}".`, '$.format');
  }
  if (sourceSchemaVersion !== ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION) {
    invalid(
      'E_PROJECT_UNSUPPORTED_VERSION',
      `Project schema ${sourceSchemaVersion} is unsupported; this editor supports schema ${ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION}.`,
      '$.schemaVersion',
    );
  }

  // stateMachine is optional in the JSON schema and canonicalized to an explicit null.
  if (!Object.prototype.hasOwnProperty.call(root, 'stateMachine')) root.stateMachine = null;
  validateProject(root);
  return {
    project: freezeAnimationEditorProject(root as unknown as AnimationEditorProject),
    sourceSchemaVersion,
    migrated: sourceSchemaVersion !== ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION,
  };
}

export function parseAnimationEditorProject(source: string | unknown): AnimationEditorProject {
  return decodeAnimationEditorProject(source).project;
}

/** Stable key ordering, stable indentation, and one trailing newline. Array order is authored order. */
export function serializeAnimationEditorProject(project: AnimationEditorProject): string {
  const validated = parseAnimationEditorProject(project);
  return `${JSON.stringify(canonicalize(validated), null, 2)}\n`;
}

export function createProjectFileArtifact(project: AnimationEditorProject): ProjectFileArtifact {
  const text = serializeAnimationEditorProject(project);
  return {
    fileName: projectFileName(project.name),
    mimeType: ANIMATION_EDITOR_PROJECT_MIME_TYPE,
    text,
    bytes: new TextEncoder().encode(text).byteLength,
  };
}

export function projectFileName(name: string): string {
  const stem = name
    .trim()
    .replace(/\.hya-project\.json$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .trim()
    .replace(/[. ]+$/g, '') || 'untitled-animation';
  return `${stem}${ANIMATION_EDITOR_PROJECT_FILE_SUFFIX}`;
}

export function projectNameFromFileName(fileName: string): string {
  return fileName.replace(/\.hya-project\.json$/i, '').trim() || 'Untitled Animation';
}

function validateProject(project: Record<string, unknown>): void {
  knownKeys(project, [
    'format', 'schemaVersion', 'id', 'name', 'composition', 'assets', 'nodes',
    'timeline', 'stateMachine', 'editor',
  ], '$');
  identifier(project.id, '$.id');
  text(project.name, '$.name', true);

  const composition = record(project.composition, '$.composition');
  knownKeys(composition, ['canvas', 'duration', 'frameRate', 'endBehavior'], '$.composition');
  const canvas = record(composition.canvas, '$.composition.canvas');
  knownKeys(canvas, ['width', 'height', 'coordinateSystem'], '$.composition.canvas');
  positive(canvas.width, '$.composition.canvas.width');
  positive(canvas.height, '$.composition.canvas.height');
  exact(canvas.coordinateSystem, 'screen-y-down', '$.composition.canvas.coordinateSystem');
  const duration = positive(composition.duration, '$.composition.duration');
  positive(composition.frameRate, '$.composition.frameRate');
  oneOf(composition.endBehavior, ['hold', 'loop', 'destroy'] as const, '$.composition.endBehavior');

  validateAssets(project.assets);
  const nodes = validateNodes(project.nodes, duration);
  const clips = validateTimeline(project.timeline, nodes, duration);
  validateAdvancedTimeline(project as unknown as AnimationEditorProject);
  validateStateMachine(project.stateMachine, clips, nodes, duration);
  if (project.editor !== undefined) validateEditorMetadata(project.editor, duration);
}

function validateAdvancedTimeline(project: AnimationEditorProject): void {
  project.timeline.tracks.forEach((track, index) => {
    if (track.target.kind === 'node-transform') return;
    const expected = advancedTrackExpectedValueSize(project, track.target);
    if (expected !== null && track.valueSize !== expected) {
      invalid(
        'E_PROJECT_INVALID_VALUE',
        `Typed property target requires valueSize ${expected}.`,
        `$.timeline.tracks[${index}].valueSize`,
      );
    }
    if (isStepOnlyAdvancedTrack(track) && track.keyframes.some(keyframe => keyframe.interpolation !== 'step')) {
      invalid(
        'E_PROJECT_INVALID_VALUE',
        'Sprite UV tracks require Step interpolation.',
        `$.timeline.tracks[${index}].keyframes`,
      );
    }
  });
}

function validateAssets(value: unknown): void {
  const ids = new Set<string>();
  array(value, '$.assets', 100_000).forEach((entry, index) => {
    const path = `$.assets[${index}]`;
    const asset = record(entry, path);
    knownKeys(asset, ['id', 'name', 'type', 'source', 'delivery'], path);
    unique(ids, identifier(asset.id, `${path}.id`), `${path}.id`, 'asset');
    text(asset.name, `${path}.name`, true);
    oneOf(asset.type, ['image', 'audio', 'binary'] as const, `${path}.type`);
    const source = record(asset.source, `${path}.source`);
    const sourceKind = oneOf(source.kind, ['external', 'embedded'] as const, `${path}.source.kind`);
    if (sourceKind === 'external') {
      knownKeys(source, ['kind', 'uri'], `${path}.source`);
      text(source.uri, `${path}.source.uri`, true);
    } else {
      knownKeys(source, ['kind', 'fileName', 'mimeType', 'encoding', 'data'], `${path}.source`);
      text(source.fileName, `${path}.source.fileName`, true);
      text(source.mimeType, `${path}.source.mimeType`, true);
      exact(source.encoding, 'base64', `${path}.source.encoding`);
      const data = text(source.data, `${path}.source.data`);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
        invalid('E_PROJECT_INVALID_VALUE', 'Embedded asset data must be valid base64.', `${path}.source.data`);
      }
    }
    const delivery = record(asset.delivery, `${path}.delivery`);
    knownKeys(delivery, ['uri', 'mimeType', 'integrity', 'width', 'height', 'colorSpace'], `${path}.delivery`);
    text(delivery.uri, `${path}.delivery.uri`, true);
    optionalText(delivery.mimeType, `${path}.delivery.mimeType`, true);
    optionalText(delivery.integrity, `${path}.delivery.integrity`, true);
    if (delivery.width !== undefined) positive(delivery.width, `${path}.delivery.width`);
    if (delivery.height !== undefined) positive(delivery.height, `${path}.delivery.height`);
    if (delivery.colorSpace !== undefined) oneOf(delivery.colorSpace, ['srgb', 'linear'] as const, `${path}.delivery.colorSpace`);
  });
}

function validateNodes(value: unknown, duration: number): Map<string, AnimationEditorNode> {
  const values = array(value, '$.nodes', 100_000);
  const ids = new Set<string>();
  const nodes = new Map<string, AnimationEditorNode>();
  values.forEach((entry, index) => {
    const path = `$.nodes[${index}]`;
    const node = record(entry, path);
    knownKeys(node, [
      'id', 'name', 'parent', 'start', 'duration', 'transform', 'components', 'effects',
      'compositeLayers', 'extensions', 'editor',
    ], path);
    const id = identifier(node.id, `${path}.id`);
    unique(ids, id, `${path}.id`, 'node');
    text(node.name, `${path}.name`);
    if (node.parent !== undefined) identifier(node.parent, `${path}.parent`);
    const start = node.start === undefined ? 0 : nonNegative(node.start, `${path}.start`);
    const nodeDuration = node.duration === undefined ? duration - start : positive(node.duration, `${path}.duration`);
    if (start + nodeDuration > duration + 1e-6) invalid('E_PROJECT_INVALID_VALUE', 'Node range exceeds the composition.', path);
    validateTransform(node.transform, `${path}.transform`);
    validateComponents(node.components, path);
    validateEffects(node.effects, path);
    validateComposites(node.compositeLayers, path);
    if (node.extensions !== undefined) jsonObject(node.extensions, `${path}.extensions`);
    if (node.editor !== undefined) {
      const editor = record(node.editor, `${path}.editor`);
      knownKeys(editor, ['hidden', 'locked', 'expanded', 'color'], `${path}.editor`);
      optionalBoolean(editor.hidden, `${path}.editor.hidden`);
      optionalBoolean(editor.locked, `${path}.editor.locked`);
      optionalBoolean(editor.expanded, `${path}.editor.expanded`);
      optionalText(editor.color, `${path}.editor.color`);
    }
    nodes.set(id, node as unknown as AnimationEditorNode);
  });

  for (const [id, node] of nodes) {
    if (node.parent !== undefined && !nodes.has(node.parent)) {
      invalid('E_PROJECT_UNKNOWN_REFERENCE', `Unknown parent node "${node.parent}".`, nodePath(values, id, 'parent'));
    }
    if (node.parent === id) invalid('E_PROJECT_CYCLE', 'A node cannot parent itself.', nodePath(values, id, 'parent'));
    for (const layer of node.compositeLayers) {
      if (!nodes.has(layer.sourceNodeId)) {
        invalid('E_PROJECT_UNKNOWN_REFERENCE', `Unknown composite source node "${layer.sourceNodeId}".`, nodePath(values, id, 'compositeLayers'));
      }
      if (layer.sourceNodeId === id) invalid('E_PROJECT_CYCLE', 'A node cannot composite itself.', nodePath(values, id, 'compositeLayers'));
    }
  }
  verifyNodeCycles(nodes, 'parent');
  verifyNodeCycles(nodes, 'composite');
  return nodes;
}

function validateTransform(value: unknown, path: string): void {
  const transform = record(value, path);
  knownKeys(transform, ['position', 'rotation', 'scale', 'anchor', 'opacity'], path);
  if (transform.position !== undefined) vector(transform.position, 2, `${path}.position`);
  if (transform.rotation !== undefined) finite(transform.rotation, `${path}.rotation`);
  if (transform.scale !== undefined) vector(transform.scale, 2, `${path}.scale`);
  if (transform.anchor !== undefined) vector(transform.anchor, 2, `${path}.anchor`);
  if (transform.opacity !== undefined) unit(transform.opacity, `${path}.opacity`);
}

function validateComponents(value: unknown, nodePathValue: string): void {
  const ids = new Set<string>();
  array(value, `${nodePathValue}.components`, 100_000).forEach((entry, index) => {
    const path = `${nodePathValue}.components[${index}]`;
    const component = record(entry, path);
    knownKeys(component, ['id', 'name', 'component', 'parts'], path);
    unique(ids, identifier(component.id, `${path}.id`), `${path}.id`, 'component');
    optionalText(component.name, `${path}.name`);
    const payload = jsonObject(component.component, `${path}.component`, true);
    text(payload.type, `${path}.component.type`, true);
    if (component.parts !== undefined) {
      const partIds = new Set<string>();
      array(component.parts, `${path}.parts`, 100_000).forEach((partValue, partIndex) => {
        const partPath = `${path}.parts[${partIndex}]`;
        const part = record(partValue, partPath);
        knownKeys(part, ['id', 'role', 'index'], partPath);
        unique(partIds, identifier(part.id, `${partPath}.id`), `${partPath}.id`, 'component part');
        oneOf(part.role, ['fill', 'stroke', 'gradient', 'modifier', 'text-animator', 'text-selector'] as const, `${partPath}.role`);
        if (part.index !== undefined) nonNegativeInteger(part.index, `${partPath}.index`);
      });
    }
  });
}

function validateEffects(value: unknown, nodePathValue: string): void {
  const ids = new Set<string>();
  array(value, `${nodePathValue}.effects`, 8).forEach((entry, index) => {
    const path = `${nodePathValue}.effects[${index}]`;
    const effect = record(entry, path);
    knownKeys(effect, ['id', 'name', 'effect'], path);
    unique(ids, identifier(effect.id, `${path}.id`), `${path}.id`, 'effect');
    optionalText(effect.name, `${path}.name`);
    const payload = jsonObject(effect.effect, `${path}.effect`, true);
    oneOf(payload.kind, ['tint', 'fill', 'opacity', 'color-matrix', 'blur', 'drop-shadow'] as const, `${path}.effect.kind`);
  });
}

function validateComposites(value: unknown, nodePathValue: string): void {
  const ids = new Set<string>();
  array(value, `${nodePathValue}.compositeLayers`, 8).forEach((entry, index) => {
    const path = `${nodePathValue}.compositeLayers[${index}]`;
    const layer = record(entry, path);
    knownKeys(layer, ['id', 'kind', 'sourceNodeId', 'mode', 'operation', 'feather', 'expansion'], path);
    unique(ids, identifier(layer.id, `${path}.id`), `${path}.id`, 'composite layer');
    oneOf(layer.kind, ['mask', 'matte'] as const, `${path}.kind`);
    identifier(layer.sourceNodeId, `${path}.sourceNodeId`);
    oneOf(layer.mode, ['alpha', 'alpha-inverted', 'luma', 'luma-inverted'] as const, `${path}.mode`);
    if (layer.operation !== undefined) oneOf(layer.operation, ['add', 'subtract', 'intersect', 'difference'] as const, `${path}.operation`);
    if (layer.feather !== undefined) vector(layer.feather, 2, `${path}.feather`);
    if (layer.expansion !== undefined) finite(layer.expansion, `${path}.expansion`);
  });
}

function validateTimeline(
  value: unknown,
  nodes: ReadonlyMap<string, AnimationEditorNode>,
  duration: number,
): Map<string, { readonly start: number; readonly duration: number }> {
  const timeline = record(value, '$.timeline');
  knownKeys(timeline, ['tracks', 'clips'], '$.timeline');
  const trackIds = new Set<string>();
  const enabledTargets = new Set<string>();
  array(timeline.tracks, '$.timeline.tracks', 100_000).forEach((entry, index) => {
    const path = `$.timeline.tracks[${index}]`;
    const track = record(entry, path);
    knownKeys(track, ['id', 'name', 'target', 'valueSize', 'enabled', 'color', 'keyframes'], path);
    unique(trackIds, identifier(track.id, `${path}.id`), `${path}.id`, 'track');
    text(track.name, `${path}.name`);
    const valueSize = positiveInteger(track.valueSize, `${path}.valueSize`, 4096);
    optionalBoolean(track.enabled, `${path}.enabled`);
    optionalText(track.color, `${path}.color`);
    const target = validateTrackTarget(track.target, nodes, path);
    const targetKey = JSON.stringify(canonicalize(target));
    if (track.enabled !== false) unique(enabledTargets, targetKey, `${path}.target`, 'enabled track target');
    const expected = target.kind === 'node-transform'
      ? ({ position: 2, scale: 2, rotation: 1, opacity: 1 } as const)[target.property]
      : undefined;
    if (expected !== undefined && valueSize !== expected) {
      invalid('E_PROJECT_INVALID_VALUE', `Core transform target requires valueSize ${expected}.`, `${path}.valueSize`);
    }
    const keyframeIds = new Set<string>();
    let previousTime = -Infinity;
    array(track.keyframes, `${path}.keyframes`, 1_000_000, 1).forEach((keyframeValue, keyframeIndex) => {
      const keyframePath = `${path}.keyframes[${keyframeIndex}]`;
      const keyframe = record(keyframeValue, keyframePath);
      knownKeys(keyframe, ['id', 'time', 'value', 'interpolation', 'easing', 'spatialIn', 'spatialOut'], keyframePath);
      unique(keyframeIds, identifier(keyframe.id, `${keyframePath}.id`), `${keyframePath}.id`, 'keyframe');
      const time = nonNegative(keyframe.time, `${keyframePath}.time`);
      if (time > duration) invalid('E_PROJECT_INVALID_VALUE', 'Keyframe is outside the composition.', `${keyframePath}.time`);
      if (time <= previousTime) invalid('E_PROJECT_INVALID_VALUE', 'Keyframe times must be strictly increasing.', `${keyframePath}.time`);
      previousTime = time;
      vector(keyframe.value, valueSize, `${keyframePath}.value`);
      const interpolation = oneOf(keyframe.interpolation, ['step', 'linear', 'cubic-bezier'] as const, `${keyframePath}.interpolation`);
      if (keyframe.easing !== undefined) {
        const easing = vector(keyframe.easing, 4, `${keyframePath}.easing`);
        if (interpolation !== 'cubic-bezier') invalid('E_PROJECT_INVALID_VALUE', 'Easing requires cubic-bezier interpolation.', `${keyframePath}.easing`);
        const x1 = easing[0]!;
        const x2 = easing[2]!;
        if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
          invalid('E_PROJECT_INVALID_VALUE', 'Easing x controls must be inside [0, 1].', `${keyframePath}.easing`);
        }
      }
      if (keyframe.spatialIn !== undefined) vector(keyframe.spatialIn, 2, `${keyframePath}.spatialIn`);
      if (keyframe.spatialOut !== undefined) vector(keyframe.spatialOut, 2, `${keyframePath}.spatialOut`);
      if ((keyframe.spatialIn !== undefined || keyframe.spatialOut !== undefined)
        && !(target.kind === 'node-transform' && target.property === 'position' && valueSize === 2)) {
        invalid('E_PROJECT_INVALID_VALUE', 'Spatial handles require a 2D position track.', keyframePath);
      }
    });
  });

  const clipIds = new Set<string>();
  const clips = new Map<string, { readonly start: number; readonly duration: number }>();
  array(timeline.clips, '$.timeline.clips', 10_000).forEach((entry, index) => {
    const path = `$.timeline.clips[${index}]`;
    const clip = record(entry, path);
    knownKeys(clip, ['id', 'name', 'start', 'duration', 'color'], path);
    const id = identifier(clip.id, `${path}.id`);
    unique(clipIds, id, `${path}.id`, 'clip');
    text(clip.name, `${path}.name`);
    const start = nonNegative(clip.start, `${path}.start`);
    const clipDuration = positive(clip.duration, `${path}.duration`);
    optionalText(clip.color, `${path}.color`);
    if (start + clipDuration > duration + 1e-6) invalid('E_PROJECT_INVALID_VALUE', 'Clip range exceeds the composition.', path);
    clips.set(id, { start, duration: clipDuration });
  });
  return clips;
}

function validateTrackTarget(
  value: unknown,
  nodes: ReadonlyMap<string, AnimationEditorNode>,
  trackPath: string,
): AnimationEditorTrack['target'] {
  const path = `${trackPath}.target`;
  const target = record(value, path);
  const kind = oneOf(target.kind, ['node-transform', 'component-property', 'effect-property', 'composite-property'] as const, `${path}.kind`);
  identifier(target.nodeId, `${path}.nodeId`);
  const node = nodes.get(target.nodeId as string);
  if (!node) invalid('E_PROJECT_UNKNOWN_REFERENCE', `Unknown target node "${String(target.nodeId)}".`, `${path}.nodeId`);
  if (kind === 'node-transform') {
    knownKeys(target, ['kind', 'nodeId', 'property'], path);
    oneOf(target.property, ['position', 'rotation', 'scale', 'opacity'] as const, `${path}.property`);
  } else if (kind === 'component-property') {
    knownKeys(target, ['kind', 'nodeId', 'componentId', 'partId', 'property'], path);
    const componentId = identifier(target.componentId, `${path}.componentId`);
    const component = node.components.find(item => item.id === componentId);
    if (!component) invalid('E_PROJECT_UNKNOWN_REFERENCE', `Unknown component "${componentId}".`, `${path}.componentId`);
    if (target.partId !== undefined) {
      const partId = identifier(target.partId, `${path}.partId`);
      if (!component.parts?.some(item => item.id === partId)) invalid('E_PROJECT_UNKNOWN_REFERENCE', `Unknown component part "${partId}".`, `${path}.partId`);
    }
    const property = oneOf(target.property, COMPONENT_PROPERTIES, `${path}.property`);
    if ((property.startsWith('vector.modifier.') || property.startsWith('text.')) && target.partId === undefined) {
      invalid('E_PROJECT_INVALID_VALUE', 'This component property requires partId.', `${path}.partId`);
    }
  } else if (kind === 'effect-property') {
    knownKeys(target, ['kind', 'nodeId', 'effectId', 'property'], path);
    const effectId = identifier(target.effectId, `${path}.effectId`);
    const effect = node.effects.find(item => item.id === effectId);
    if (!effect) invalid('E_PROJECT_UNKNOWN_REFERENCE', `Unknown effect "${effectId}".`, `${path}.effectId`);
    const property = oneOf(target.property, EFFECT_PROPERTIES, `${path}.property`);
    const prefix = property.split('.')[0];
    const expected = effect.effect.kind === 'opacity' ? 'opacity' : effect.effect.kind;
    if (prefix !== expected) invalid('E_PROJECT_INVALID_VALUE', `Effect property does not match ${effect.effect.kind}.`, `${path}.property`);
  } else {
    knownKeys(target, ['kind', 'nodeId', 'compositeLayerId', 'property'], path);
    const layerId = identifier(target.compositeLayerId, `${path}.compositeLayerId`);
    if (!node.compositeLayers.some(item => item.id === layerId)) invalid('E_PROJECT_UNKNOWN_REFERENCE', `Unknown composite layer "${layerId}".`, `${path}.compositeLayerId`);
    exact(target.property, 'expansion', `${path}.property`);
  }
  return target as unknown as AnimationEditorTrack['target'];
}

function validateStateMachine(
  value: unknown,
  clips: ReadonlyMap<string, { readonly start: number; readonly duration: number }>,
  nodes: ReadonlyMap<string, AnimationEditorNode>,
  duration: number,
): void {
  if (value === null) return;
  const machine = record(value, '$.stateMachine');
  const runtimeMachine = structuredClone(machine);
  const layers = Array.isArray(runtimeMachine.layers) ? runtimeMachine.layers : [];
  layers.forEach((layerValue, layerIndex) => {
    if (!isRecord(layerValue) || !Array.isArray(layerValue.states)) return;
    layerValue.states.forEach((stateValue, stateIndex) => {
      if (!isRecord(stateValue) || stateValue.editorPosition === undefined) return;
      vector(stateValue.editorPosition, 2, `$.stateMachine.layers[${layerIndex}].states[${stateIndex}].editorPosition`);
      delete stateValue.editorPosition;
    });
  });
  try {
    parseHyaStateMachineExtension({
      clips: [...clips].map(([id, clip]) => ({ id, ...clip })),
      stateMachine: runtimeMachine,
    }, duration, '$');
  } catch (error) {
    if (error instanceof AnimationFormatError) {
      invalid('E_PROJECT_INVALID_VALUE', error.message.replace(/ \([^()]+\)$/u, ''), error.path);
    }
    throw error;
  }
  for (const [layerIndex, layerValue] of array(machine.layers, '$.stateMachine.layers', 128, 1).entries()) {
    const layer = record(layerValue, `$.stateMachine.layers[${layerIndex}]`);
    if (layer.mask === undefined) continue;
    const mask = record(layer.mask, `$.stateMachine.layers[${layerIndex}].mask`);
    for (const key of ['include', 'exclude'] as const) {
      if (mask[key] === undefined) continue;
      array(mask[key], `$.stateMachine.layers[${layerIndex}].mask.${key}`, 100_000).forEach((nodeId, index) => {
        const id = identifier(nodeId, `$.stateMachine.layers[${layerIndex}].mask.${key}[${index}]`);
        if (!nodes.has(id)) invalid('E_PROJECT_UNKNOWN_REFERENCE', `Unknown binding-mask node "${id}".`, `$.stateMachine.layers[${layerIndex}].mask.${key}[${index}]`);
      });
    }
  }
}

function validateEditorMetadata(value: unknown, duration: number): void {
  const editor = record(value, '$.editor');
  knownKeys(editor, ['activePanel', 'viewport', 'timeline'], '$.editor');
  if (editor.activePanel !== undefined) oneOf(editor.activePanel, ['timeline', 'state-machine'] as const, '$.editor.activePanel');
  if (editor.viewport !== undefined) {
    const viewport = record(editor.viewport, '$.editor.viewport');
    knownKeys(viewport, ['zoom', 'center', 'showGrid'], '$.editor.viewport');
    positive(viewport.zoom, '$.editor.viewport.zoom');
    vector(viewport.center, 2, '$.editor.viewport.center');
    booleanValue(viewport.showGrid, '$.editor.viewport.showGrid');
  }
  if (editor.timeline !== undefined) {
    const timeline = record(editor.timeline, '$.editor.timeline');
    knownKeys(timeline, ['playhead', 'pixelsPerSecond', 'scrollX'], '$.editor.timeline');
    const playhead = nonNegative(timeline.playhead, '$.editor.timeline.playhead');
    if (playhead > duration) invalid('E_PROJECT_INVALID_VALUE', 'Playhead is outside the composition.', '$.editor.timeline.playhead');
    positive(timeline.pixelsPerSecond, '$.editor.timeline.pixelsPerSecond');
    nonNegative(timeline.scrollX, '$.editor.timeline.scrollX');
  }
}

function verifyNodeCycles(nodes: ReadonlyMap<string, AnimationEditorNode>, graph: 'parent' | 'composite'): void {
  const complete = new Set<string>();
  const visit = (id: string, active: Set<string>): void => {
    if (complete.has(id)) return;
    if (active.has(id)) invalid('E_PROJECT_CYCLE', `${graph === 'parent' ? 'Node parent' : 'Composite'} cycle includes "${id}".`, '$.nodes');
    active.add(id);
    const node = nodes.get(id);
    if (node) {
      const next = graph === 'parent'
        ? (node.parent === undefined ? [] : [node.parent])
        : node.compositeLayers.map(layer => layer.sourceNodeId);
      next.forEach(target => visit(target, active));
    }
    active.delete(id);
    complete.add(id);
  };
  nodes.forEach((_node, id) => visit(id, new Set()));
}

function nodePath(values: readonly unknown[], id: string, field: string): string {
  const index = values.findIndex(value => isRecord(value) && value.id === id);
  return `$.nodes[${Math.max(0, index)}].${field}`;
}

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(object).sort()) result[key] = canonicalize(object[key]);
  return result;
}

function jsonObject(value: unknown, path: string, rejectTracks = false): Record<string, unknown> {
  const object = record(value, path);
  jsonValue(object, path, rejectTracks, 0);
  return object;
}

function jsonValue(value: unknown, path: string, rejectTracks: boolean, depth: number): void {
  if (depth > 64) invalid('E_PROJECT_LIMIT_EXCEEDED', 'JSON nesting exceeds 64 levels.', path);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { finite(value, path); return; }
  if (Array.isArray(value)) {
    if (value.length > 1_000_000) invalid('E_PROJECT_LIMIT_EXCEEDED', 'JSON array is too large.', path);
    value.forEach((entry, index) => jsonValue(entry, `${path}[${index}]`, rejectTracks, depth + 1));
    return;
  }
  if (!isRecord(value)) invalid('E_PROJECT_INVALID_VALUE', 'Expected a JSON value.', path);
  for (const [key, entry] of Object.entries(value)) {
    if (rejectTracks && key.endsWith('Track')) invalid('E_PROJECT_INVALID_VALUE', 'Static payloads cannot contain inline *Track fields.', `${path}.${key}`);
    jsonValue(entry, `${path}.${key}`, rejectTracks, depth + 1);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid('E_PROJECT_INVALID_VALUE', 'Expected an object.', path);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function array(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value)) invalid('E_PROJECT_INVALID_VALUE', 'Expected an array.', path);
  if (value.length < min) invalid('E_PROJECT_INVALID_VALUE', `Expected at least ${min} item(s).`, path);
  if (value.length > max) invalid('E_PROJECT_LIMIT_EXCEEDED', `Array exceeds ${max} items.`, path);
  return value;
}

function knownKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key)) invalid('E_PROJECT_UNKNOWN_FIELD', `Unknown field "${key}".`, `${path}.${key}`);
    if (entry === undefined) invalid('E_PROJECT_INVALID_VALUE', 'JSON fields cannot be undefined.', `${path}.${key}`);
  }
}

function identifier(value: unknown, path: string): string {
  const result = text(value, path, true);
  if (result.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    invalid('E_PROJECT_INVALID_VALUE', 'Expected a stable identifier (letters, digits, dot, underscore, colon, or dash).', path);
  }
  return result;
}

function text(value: unknown, path: string, nonEmpty = false): string {
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
    invalid('E_PROJECT_INVALID_VALUE', nonEmpty ? 'Expected a non-empty string.' : 'Expected a string.', path);
  }
  return value;
}

function optionalText(value: unknown, path: string, nonEmpty = false): void {
  if (value !== undefined) text(value, path, nonEmpty);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid('E_PROJECT_INVALID_VALUE', 'Expected a finite number.', path);
  return value;
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result <= 0) invalid('E_PROJECT_INVALID_VALUE', 'Expected a positive number.', path);
  return result;
}

function nonNegative(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0) invalid('E_PROJECT_INVALID_VALUE', 'Expected a non-negative number.', path);
  return result;
}

function safeInteger(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isSafeInteger(result)) invalid('E_PROJECT_INVALID_VALUE', 'Expected a safe integer.', path);
  return result;
}

function positiveInteger(value: unknown, path: string, max: number): number {
  const result = safeInteger(value, path);
  if (result < 1 || result > max) invalid('E_PROJECT_INVALID_VALUE', `Expected an integer between 1 and ${max}.`, path);
  return result;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const result = safeInteger(value, path);
  if (result < 0) invalid('E_PROJECT_INVALID_VALUE', 'Expected a non-negative integer.', path);
  return result;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid('E_PROJECT_INVALID_VALUE', 'Expected a boolean.', path);
  return value;
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined) booleanValue(value, path);
}

function unit(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0 || result > 1) invalid('E_PROJECT_INVALID_VALUE', 'Expected a number inside [0, 1].', path);
  return result;
}

function vector(value: unknown, size: number, path: string): number[] {
  const result = array(value, path, size, size);
  if (result.length !== size) invalid('E_PROJECT_INVALID_VALUE', `Expected exactly ${size} values.`, path);
  return result.map((entry, index) => finite(entry, `${path}[${index}]`));
}

function exact<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) invalid('E_PROJECT_INVALID_VALUE', `Expected ${JSON.stringify(expected)}.`, path);
  return expected;
}

function oneOf<const T extends readonly (string | number)[]>(value: unknown, values: T, path: string): T[number] {
  if (!values.includes(value as never)) invalid('E_PROJECT_INVALID_VALUE', `Expected one of: ${values.join(', ')}.`, path);
  return value as T[number];
}

function unique(values: Set<string>, value: string, path: string, label: string): void {
  if (values.has(value)) invalid('E_PROJECT_DUPLICATE_ID', `Duplicate ${label} id "${value}".`, path);
  values.add(value);
}

function invalid(code: ProjectDiagnosticCode, message: string, path: string): never {
  throw new AnimationEditorProjectFormatError([{ code, message, path }]);
}

const COMPONENT_PROPERTIES = [
  'sprite.uv-rect', 'vector.morph', 'vector.fill.color', 'vector.fill.opacity',
  'vector.gradient.start', 'vector.gradient.end', 'vector.gradient.stops',
  'vector.stroke.color', 'vector.stroke.opacity', 'vector.stroke.width',
  'vector.stroke.dash-offset', 'vector.modifier.trim-start', 'vector.modifier.trim-end',
  'vector.modifier.trim-offset', 'vector.modifier.round-radius', 'text.selector.start',
  'text.selector.end', 'text.selector.offset', 'text.selector.amount', 'text.animator.position',
  'text.animator.scale', 'text.animator.rotation', 'text.animator.opacity',
  'text.animator.fill-color', 'text.animator.tracking',
] as const;

const EFFECT_PROPERTIES = [
  'tint.black', 'tint.white', 'tint.amount', 'fill.color', 'fill.opacity',
  'opacity.value', 'color-matrix.matrix', 'blur.radius', 'drop-shadow.color',
  'drop-shadow.opacity', 'drop-shadow.offset', 'drop-shadow.blur',
] as const;
