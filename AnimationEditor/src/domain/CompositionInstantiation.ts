import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorKeyframe,
  type AnimationEditorProject,
  type AnimationEditorTrack,
  type AnimationEditorTrackTarget,
  type DeepMutable,
  type JsonValue,
} from './AnimationEditorProject';
import { parseAnimationEditorProject } from '../persistence/ProjectCodec';
import { parseNative3dProject } from './native3d/Native3dProjectCodec';
import {
  ReusableCompositionError,
  assertReusableCompositionWorkspace,
  type CompositionDiagnostic,
  type CompositionLibraryAsset,
  type CompositionTiming,
  type ReusableCompositionInstance,
  type ReusableCompositionSource,
  type ReusableCompositionWorkspace,
} from './ReusableComposition';
import type { Native3dProject } from './native3d/Native3dProject';

export type CompositionInstantiationResult =
  | Readonly<{
      readonly family: '2d';
      readonly project: AnimationEditorProject;
      readonly diagnostics: readonly CompositionDiagnostic[];
    }>
  | Readonly<{
      readonly family: '3d';
      readonly project: Native3dProject;
      readonly diagnostics: readonly CompositionDiagnostic[];
    }>;

export interface CompositionTimeSample {
  readonly active: boolean;
  readonly localTime: number;
  readonly traversal: number;
  readonly reversed: boolean;
}

/** Canonical host -> local timing contract used by preview and deterministic lowering. */
export function sampleCompositionInstanceTime(
  timing: CompositionTiming,
  hostTime: number,
): CompositionTimeSample {
  const span = timing.localOut - timing.localIn;
  const elapsed = (hostTime - timing.startTime) * timing.timeScale + timing.timeOffset;
  const total = span * timing.loop.count;
  if (!Number.isFinite(elapsed) || elapsed < -1e-9 || elapsed > total + 1e-9) {
    return Object.freeze({ active: false, localTime: timing.localIn, traversal: -1, reversed: false });
  }
  const bounded = Math.max(0, Math.min(total, elapsed));
  const atEnd = Math.abs(bounded - total) <= 1e-9;
  const traversal = atEnd ? timing.loop.count - 1 : Math.floor(bounded / span);
  const phase = atEnd ? span : bounded - traversal * span;
  const reversed = timing.loop.mode === 'ping-pong' && traversal % 2 === 1;
  return Object.freeze({
    active: true,
    localTime: reversed ? timing.localOut - phase : timing.localIn + phase,
    traversal,
    reversed,
  });
}

export function instantiateReusableComposition(
  workspace: ReusableCompositionWorkspace,
): CompositionInstantiationResult {
  // Cycles, dangling references and depth are rejected before any project data
  // is cloned or handed to a preview/runtime adapter.
  assertReusableCompositionWorkspace(workspace);
  const sources = new Map(workspace.sources.map(source => [source.id, source]));
  const root = sources.get(workspace.rootSourceId)!;
  assertReachableAssetsAvailable(workspace, root.id, sources);
  if (workspace.family === '3d') {
    const nested = reachableSources(root.id, sources).some(source => source.instances.length > 0);
    if (nested) throw new ReusableCompositionError([issue(
      'E_COMPOSITION_3D_ADAPTER_REQUIRED', 'error', '$.sources',
      'Nested 3D composition lowering requires the G06/G09 Animation3D adapter; the reusable contract remains source-neutral.',
      'unsupported',
    )]);
    return Object.freeze({
      family: '3d',
      project: parseNative3dProject(root.project),
      diagnostics: Object.freeze([...workspace.diagnostics, ...root.diagnostics]),
    });
  }
  if (root.family !== '2d') throw new ReusableCompositionError([issue(
    'E_COMPOSITION_MIXED_FAMILY', 'error', '$.rootSourceId', '2D workspace root must be a 2D source.',
  )]);
  return instantiate2d(workspace, root, sources);
}

function instantiate2d(
  workspace: ReusableCompositionWorkspace,
  root: Extract<ReusableCompositionSource, { readonly family: '2d' }>,
  sources: ReadonlyMap<string, ReusableCompositionSource>,
): Extract<CompositionInstantiationResult, { readonly family: '2d' }> {
  const project = cloneAnimationEditorProject(root.project);
  project.id = workspace.id;
  project.name = workspace.name;
  project.assets = [];
  project.nodes = [];
  project.timeline = { tracks: [], clips: [] };
  project.stateMachine = null;
  const diagnostics: CompositionDiagnostic[] = [...workspace.diagnostics, ...root.diagnostics];
  if (root.project.stateMachine !== null || root.project.timeline.clips.length > 0) diagnostics.push(issue(
    'W_COMPOSITION_CONTROLLER_METADATA_NOT_INSTANTIATED', 'warning', `$.sources.${root.id}.project.stateMachine`,
    'Reusable composition lowering retains animation channels but not source controller/clip authoring metadata.', 'fidelity', root.id,
  ));
  const assetIds = new Map<string, string>();
  const rootContext: TimeContext = Object.freeze({
    map: (rootTime: number) => rootTime >= 0 && rootTime <= project.composition.duration + 1e-9
      ? { active: true, localTime: rootTime }
      : { active: false, localTime: 0 },
    transformed: false,
  });
  emitSource(root, [root.id], rootContext, undefined, undefined, new Map(), project, workspace, sources, assetIds, diagnostics);
  return Object.freeze({
    family: '2d',
    project: freezeAnimationEditorProject(parseAnimationEditorProject(project)),
    diagnostics: Object.freeze(dedupeDiagnostics(diagnostics)),
  });
}

function emitSource(
  source: Extract<ReusableCompositionSource, { readonly family: '2d' }>,
  path: readonly string[],
  context: TimeContext,
  containerId: string | undefined,
  instance: ReusableCompositionInstance | undefined,
  inheritedAssetOverrides: ReadonlyMap<string, string>,
  output: DeepMutable<AnimationEditorProject>,
  workspace: ReusableCompositionWorkspace,
  sources: ReadonlyMap<string, ReusableCompositionSource>,
  assetIds: Map<string, string>,
  diagnostics: CompositionDiagnostic[],
): void {
  const nodeIds = new Map(source.project.nodes.map(node => [node.id, qualifiedId(path, 'node', node.id)]));
  const componentIds = new Map<string, string>();
  const partIds = new Map<string, string>();
  const effectIds = new Map<string, string>();
  const compositeIds = new Map<string, string>();
  const localOverrides = new Map(inheritedAssetOverrides);
  for (const override of instance?.overrides ?? []) {
    if (override.kind === 'asset') localOverrides.set(override.sourceAssetId, override.replacementAssetId);
  }
  const sourceAssetMap = new Map<string, string>();
  for (const asset of source.project.assets) {
    const libraryId = localOverrides.get(asset.id) ?? libraryAssetFor(workspace, source.id, asset.id).id;
    const libraryAsset = workspace.assets.find(candidate => candidate.id === libraryId)!;
    let outputId = assetIds.get(libraryId);
    if (!outputId) {
      outputId = qualifiedAssetId(libraryId);
      assetIds.set(libraryId, outputId);
      output.assets.push({ ...structuredClone(libraryAsset.asset), id: outputId } as DeepMutable<typeof output.assets[number]>);
    }
    sourceAssetMap.set(asset.id, outputId);
  }

  for (const node of source.project.nodes) {
    const range = activeRange(context, output.composition.duration, output.composition.frameRate, node.start, node.duration);
    if (!range) continue;
    const transformedNode = instance?.overrides.find(override => (
      override.kind === 'node-transform-2d' && override.sourceNodeId === node.id
    ));
    const components = node.components.map(record => {
      const componentId = qualifiedId(path, 'component', `${node.id}:${record.id}`);
      componentIds.set(`${node.id}\u0000${record.id}`, componentId);
      const parts = record.parts?.map(part => {
        const partId = qualifiedId(path, 'part', `${node.id}:${record.id}:${part.id}`);
        partIds.set(`${node.id}\u0000${record.id}\u0000${part.id}`, partId);
        return { ...structuredClone(part), id: partId };
      });
      return {
        ...structuredClone(record),
        id: componentId,
        component: remapAssetReferences(structuredClone(record.component), sourceAssetMap),
        ...(parts === undefined ? {} : { parts }),
      };
    });
    const effects = node.effects.map(record => {
      const id = qualifiedId(path, 'effect', `${node.id}:${record.id}`);
      effectIds.set(`${node.id}\u0000${record.id}`, id);
      return { ...structuredClone(record), id };
    });
    const compositeLayers = node.compositeLayers.map(layer => {
      const id = qualifiedId(path, 'composite', `${node.id}:${layer.id}`);
      compositeIds.set(`${node.id}\u0000${layer.id}`, id);
      return { ...structuredClone(layer), id, sourceNodeId: nodeIds.get(layer.sourceNodeId)! };
    });
    const outputNode = {
      ...structuredClone(node),
      id: nodeIds.get(node.id)!,
      ...(node.parent === undefined
        ? (containerId === undefined ? {} : { parent: containerId })
        : { parent: nodeIds.get(node.parent)! }),
      start: range.start,
      duration: range.duration,
      transform: transformedNode?.kind === 'node-transform-2d'
        ? { ...structuredClone(node.transform), ...structuredClone(transformedNode.transform) }
        : structuredClone(node.transform),
      components,
      effects,
      compositeLayers,
    } as unknown as DeepMutable<typeof output.nodes[number]>;
    output.nodes.push(outputNode);
  }
  for (const track of source.project.timeline.tracks) {
    const target = remapTrackTarget(track.target, nodeIds, componentIds, partIds, effectIds, compositeIds);
    if (!target) continue;
    const lowered = context.transformed
      ? bakeTrackThroughContext(track, context, output.composition.duration, output.composition.frameRate, path)
      : copyTrackInRootTime(track, path);
    if (!lowered) continue;
    lowered.target = target;
    output.timeline.tracks.push(lowered);
  }
  if (context.transformed && source.project.timeline.tracks.length > 0) diagnostics.push(issue(
    'W_COMPOSITION_TIME_MAPPING_BAKED', 'warning', `$.sources.${source.id}.project.timeline.tracks`,
    `Instance time scale/offset/loop channels were deterministically sampled at ${output.composition.frameRate} fps.`,
    'fidelity', source.id,
  ));

  for (const child of source.instances) {
    const childSource = sources.get(child.sourceId);
    if (!childSource || childSource.family !== '2d') continue;
    const childPath = [...path, child.id];
    const childContext = composeTimeContext(context, child.timing);
    const range = activeRange(childContext, output.composition.duration, output.composition.frameRate);
    if (!range) continue;
    const childContainerId = qualifiedId(childPath, 'instance', child.id);
    const transform = child.parent.family === '2d' ? child.parent.transform : {};
    const opacity = (transform.opacity ?? 1) * child.parent.opacity;
    const containerNode = {
      id: childContainerId,
      name: child.name,
      ...(child.parentNodeId === undefined ? (containerId ? { parent: containerId } : {}) : { parent: nodeIds.get(child.parentNodeId)! }),
      start: range.start,
      duration: range.duration,
      transform: { ...structuredClone(transform), opacity },
      components: [],
      effects: [],
      compositeLayers: [],
    } as unknown as DeepMutable<typeof output.nodes[number]>;
    output.nodes.push(containerNode);
    emitSource(
      childSource, childPath, childContext, childContainerId, child, new Map(),
      output, workspace, sources, assetIds, diagnostics,
    );
  }
}

function composeTimeContext(parent: TimeContext, timing: CompositionTiming): TimeContext {
  return Object.freeze({
    transformed: true,
    map(rootTime: number): TimeContextSample {
      const parentSample = parent.map(rootTime);
      if (!parentSample.active) return { active: false, localTime: timing.localIn };
      const sample = sampleCompositionInstanceTime(timing, parentSample.localTime);
      return { active: sample.active, localTime: sample.localTime };
    },
  });
}

function activeRange(
  context: TimeContext,
  duration: number,
  frameRate: number,
  localStart = 0,
  localDuration?: number,
): { readonly start: number; readonly duration: number } | null {
  const localEnd = localStart + (localDuration ?? Number.POSITIVE_INFINITY);
  const active: number[] = [];
  const frameCount = Math.ceil(duration * frameRate);
  for (let frame = 0; frame <= frameCount; frame++) {
    const time = Math.min(duration, frame / frameRate);
    const sample = context.map(time);
    if (sample.active && sample.localTime + 1e-9 >= localStart && sample.localTime <= localEnd + 1e-9) active.push(time);
  }
  if (active.length === 0) return null;
  const start = active[0]!;
  const end = active[active.length - 1]!;
  const safeDuration = Math.max(1 / frameRate, end - start);
  return { start, duration: Math.min(duration - start, safeDuration) };
}

function copyTrackInRootTime(
  track: AnimationEditorTrack,
  path: readonly string[],
): DeepMutable<AnimationEditorTrack> {
  const clone = structuredClone(track) as DeepMutable<AnimationEditorTrack>;
  clone.id = qualifiedId(path, 'track', track.id);
  clone.keyframes = clone.keyframes.map((keyframe, index) => ({
    ...keyframe,
    id: `${clone.id}:key:${index}`,
  }));
  return clone;
}

function bakeTrackThroughContext(
  track: AnimationEditorTrack,
  context: TimeContext,
  duration: number,
  frameRate: number,
  path: readonly string[],
): DeepMutable<AnimationEditorTrack> | null {
  const id = qualifiedId(path, 'track', track.id);
  const keyframes: DeepMutable<AnimationEditorKeyframe>[] = [];
  const frameCount = Math.ceil(duration * frameRate);
  for (let frame = 0; frame <= frameCount; frame++) {
    const time = Math.min(duration, frame / frameRate);
    const sample = context.map(time);
    if (!sample.active) continue;
    keyframes.push({
      id: `${id}:key:${frame}`,
      time,
      value: sampleTrack(track, sample.localTime),
      interpolation: track.keyframes[0]!.interpolation === 'step' ? 'step' : 'linear',
    });
  }
  if (keyframes.length === 0) return null;
  return {
    ...structuredClone(track),
    id,
    keyframes,
  } as DeepMutable<AnimationEditorTrack>;
}

function sampleTrack(track: AnimationEditorTrack, time: number): number[] {
  const keyframes = track.keyframes;
  if (time <= keyframes[0]!.time) return [...keyframes[0]!.value];
  if (time >= keyframes[keyframes.length - 1]!.time) return [...keyframes[keyframes.length - 1]!.value];
  let index = 0;
  while (index + 1 < keyframes.length && time >= keyframes[index + 1]!.time) index++;
  const start = keyframes[index]!;
  const end = keyframes[index + 1]!;
  if (start.interpolation === 'step') return [...start.value];
  const linear = (time - start.time) / (end.time - start.time);
  const progress = start.interpolation === 'cubic-bezier'
    ? cubicBezierProgress(linear, start.easing ?? [0, 0, 1, 1])
    : linear;
  if (track.target.kind === 'node-transform' && track.target.property === 'position'
    && (start.spatialOut !== undefined || end.spatialIn !== undefined)) {
    return sampleSpatial(start, end, progress);
  }
  return start.value.map((value, component) => value + (end.value[component]! - value) * progress);
}

function sampleSpatial(start: AnimationEditorKeyframe, end: AnimationEditorKeyframe, progress: number): number[] {
  const inverse = 1 - progress;
  const outgoing = start.spatialOut ?? [0, 0];
  const incoming = end.spatialIn ?? [0, 0];
  return [0, 1].map(component => {
    const first = start.value[component]!;
    const second = first + outgoing[component]!;
    const fourth = end.value[component]!;
    const third = fourth + incoming[component]!;
    return inverse ** 3 * first + 3 * inverse ** 2 * progress * second
      + 3 * inverse * progress ** 2 * third + progress ** 3 * fourth;
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

function remapTrackTarget(
  target: AnimationEditorTrackTarget,
  nodes: ReadonlyMap<string, string>,
  components: ReadonlyMap<string, string>,
  parts: ReadonlyMap<string, string>,
  effects: ReadonlyMap<string, string>,
  composites: ReadonlyMap<string, string>,
): DeepMutable<AnimationEditorTrackTarget> | null {
  const nodeId = nodes.get(target.nodeId);
  if (!nodeId) return null;
  if (target.kind === 'node-transform') return { ...structuredClone(target), nodeId };
  if (target.kind === 'component-property') {
    const componentId = components.get(`${target.nodeId}\u0000${target.componentId}`);
    if (!componentId) return null;
    const partId = target.partId === undefined ? undefined : parts.get(`${target.nodeId}\u0000${target.componentId}\u0000${target.partId}`);
    return { ...structuredClone(target), nodeId, componentId, ...(partId ? { partId } : {}) };
  }
  if (target.kind === 'effect-property') {
    const effectId = effects.get(`${target.nodeId}\u0000${target.effectId}`);
    return effectId ? { ...structuredClone(target), nodeId, effectId } : null;
  }
  const compositeLayerId = composites.get(`${target.nodeId}\u0000${target.compositeLayerId}`);
  return compositeLayerId ? { ...structuredClone(target), nodeId, compositeLayerId } : null;
}

function remapAssetReferences<T extends JsonValue>(value: T, assets: ReadonlyMap<string, string>, key = ''): T {
  if (Array.isArray(value)) return value.map(child => remapAssetReferences(child, assets)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey, remapAssetReferences(child, assets, childKey),
    ])) as T;
  }
  if (typeof value === 'string' && (key === 'resource' || key === 'fontResource') && assets.has(value)) return assets.get(value)! as T;
  return value;
}

function libraryAssetFor(
  workspace: ReusableCompositionWorkspace,
  sourceId: string,
  sourceAssetId: string,
): CompositionLibraryAsset {
  const entry = workspace.assets.find(asset => asset.ownerSourceId === sourceId && asset.sourceAssetId === sourceAssetId);
  if (!entry) throw new ReusableCompositionError([issue(
    'E_COMPOSITION_DANGLING_REFERENCE', 'error', '$.assets', `No library entry for "${sourceId}/${sourceAssetId}".`,
  )]);
  return entry;
}

function assertReachableAssetsAvailable(
  workspace: ReusableCompositionWorkspace,
  rootId: string,
  sources: ReadonlyMap<string, ReusableCompositionSource>,
): void {
  const reachable = new Set(reachableSources(rootId, sources).map(source => source.id));
  const missing = workspace.assets.filter(asset => reachable.has(asset.ownerSourceId) && asset.availability === 'missing');
  if (missing.length > 0) throw new ReusableCompositionError(missing.map(asset => issue(
    'E_COMPOSITION_ASSET_MISSING', 'error', `$.assets.${asset.id}`, `Required asset "${asset.id}" is missing.`, 'missing-asset', asset.ownerSourceId,
  )));
}

function reachableSources(
  rootId: string,
  sources: ReadonlyMap<string, ReusableCompositionSource>,
): ReusableCompositionSource[] {
  const result: ReusableCompositionSource[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const source = sources.get(id);
    if (!source) return;
    result.push(source);
    source.instances.forEach(instance => visit(instance.sourceId));
  };
  visit(rootId);
  return result;
}

function qualifiedId(path: readonly string[], kind: string, sourceId: string): string {
  const readable = `${path.join('.')}:${kind}:${sourceId}`.replace(/[^A-Za-z0-9._:-]+/gu, '-');
  const prefix = /^[A-Za-z0-9]/u.test(readable) ? readable : `c:${readable}`;
  return prefix.length <= 220 ? prefix : `${prefix.slice(0, 200)}:${hashId(prefix)}`;
}

function qualifiedAssetId(libraryId: string): string {
  return `asset:${hashId(libraryId)}`;
}

function hashId(value: string): string {
  let first = 0x811c9dc5;
  let second = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second, 33) ^ code;
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function dedupeDiagnostics(diagnostics: readonly CompositionDiagnostic[]): CompositionDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter(diagnostic => {
    const key = `${diagnostic.code}\u0000${diagnostic.path}\u0000${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function issue(
  code: string,
  severity: 'warning' | 'error',
  path: string,
  message: string,
  risk?: CompositionDiagnostic['risk'],
  sourceId?: string,
): CompositionDiagnostic {
  return Object.freeze({ code, severity, path, message, ...(risk ? { risk } : {}), ...(sourceId ? { sourceId } : {}) });
}

interface TimeContextSample { readonly active: boolean; readonly localTime: number }
interface TimeContext {
  readonly transformed: boolean;
  readonly map: (rootTime: number) => TimeContextSample;
}
