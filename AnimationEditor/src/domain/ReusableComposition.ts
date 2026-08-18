import type { AnimationTransform2D } from '@haiyue/animation-spec';
import type { AnimationEditorAsset, AnimationEditorProject } from './AnimationEditorProject';
import type {
  Native3dAsset,
  Native3dProject,
  Native3dTransform,
} from './native3d/Native3dProject';
import { parseNative3dProject } from './native3d/Native3dProjectCodec';
import { parseAnimationEditorProject } from '../persistence/ProjectCodec';

export const REUSABLE_COMPOSITION_WORKSPACE_FORMAT = 'haiyue-animation-editor-composition-workspace@1' as const;
export const REUSABLE_COMPOSITION_WORKSPACE_VERSION = 1 as const;
export const DEFAULT_COMPOSITION_NESTING_LIMIT = 16;

export type CompositionFamily = '2d' | '3d';

export interface CompositionProvenance {
  readonly importer: 'lottie' | 'spritesheet' | 'gltf' | 'hya' | 'project' | 'template' | string;
  readonly sourceFormat: string;
  readonly sourceHash: string;
  readonly sourceUri?: string;
}

export interface CompositionDiagnostic {
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly path: string;
  readonly message: string;
  readonly risk?: 'unsupported' | 'fidelity' | 'missing-asset' | 'delivery-data';
  readonly sourceId?: string;
}

export interface CompositionTiming {
  /** Host-composition seconds at which the instance becomes active. */
  readonly startTime: number;
  /** Inclusive source-composition range start in source seconds. */
  readonly localIn: number;
  /** Exclusive source-composition range end in source seconds. */
  readonly localOut: number;
  /** Positive source-seconds advanced per host second. */
  readonly timeScale: number;
  /** Source-seconds skipped from the beginning of the loop stream. */
  readonly timeOffset: number;
  readonly loop: Readonly<{
    readonly mode: 'none' | 'repeat' | 'ping-pong';
    /** Number of traversals; `none` requires exactly one. */
    readonly count: number;
  }>;
}

export type CompositionParentTransform =
  | Readonly<{
      readonly family: '2d';
      readonly transform: Readonly<AnimationTransform2D>;
      /** Multiplied with transform.opacity and retained separately as an instance contract. */
      readonly opacity: number;
    }>
  | Readonly<{
      readonly family: '3d';
      readonly transform: Native3dTransform;
      /** 3D delivery adapters decide how this group opacity is lowered. */
      readonly opacity: number;
    }>;

export type CompositionInstanceOverride =
  | Readonly<{
      readonly id: string;
      readonly kind: 'asset';
      readonly sourceAssetId: string;
      readonly replacementAssetId: string;
    }>
  | Readonly<{
      readonly id: string;
      readonly kind: 'node-transform-2d';
      readonly sourceNodeId: string;
      readonly transform: Readonly<AnimationTransform2D>;
    }>
  | Readonly<{
      readonly id: string;
      readonly kind: 'node-transform-3d';
      readonly sourceNodeId: string;
      readonly transform: Native3dTransform;
    }>;

export interface ReusableCompositionInstance {
  readonly id: string;
  readonly name: string;
  readonly sourceId: string;
  /** Optional node in the owning source under which the instance container is parented. */
  readonly parentNodeId?: string;
  readonly parent: CompositionParentTransform;
  readonly timing: CompositionTiming;
  readonly overrides: readonly CompositionInstanceOverride[];
}

export type ReusableCompositionSource =
  | Readonly<{
      readonly id: string;
      readonly name: string;
      readonly family: '2d';
      readonly project: AnimationEditorProject;
      readonly instances: readonly ReusableCompositionInstance[];
      readonly provenance: CompositionProvenance;
      readonly diagnostics: readonly CompositionDiagnostic[];
      readonly authoring: 'full-project' | 'converted-source' | 'limited-delivery';
    }>
  | Readonly<{
      readonly id: string;
      readonly name: string;
      readonly family: '3d';
      readonly project: Native3dProject;
      readonly instances: readonly ReusableCompositionInstance[];
      readonly provenance: CompositionProvenance;
      readonly diagnostics: readonly CompositionDiagnostic[];
      readonly authoring: 'full-project' | 'converted-source' | 'limited-delivery';
    }>;

export type CompositionLibraryAsset =
  | Readonly<{
      readonly id: string;
      readonly family: '2d';
      readonly ownerSourceId: string;
      readonly sourceAssetId: string;
      readonly asset: AnimationEditorAsset;
      readonly hash: string;
      readonly provenance: CompositionProvenance;
      readonly availability: 'available' | 'missing';
    }>
  | Readonly<{
      readonly id: string;
      readonly family: '3d';
      readonly ownerSourceId: string;
      readonly sourceAssetId: string;
      readonly asset: Native3dAsset;
      readonly hash: string;
      readonly provenance: CompositionProvenance;
      readonly availability: 'available' | 'missing';
    }>;

export interface CompositionTemplate {
  readonly id: string;
  readonly name: string;
  readonly sourceId: string;
  readonly tags: readonly string[];
  readonly provenance: CompositionProvenance;
}

export interface ReusableCompositionWorkspace {
  readonly format: typeof REUSABLE_COMPOSITION_WORKSPACE_FORMAT;
  readonly version: typeof REUSABLE_COMPOSITION_WORKSPACE_VERSION;
  readonly id: string;
  readonly name: string;
  readonly family: CompositionFamily;
  readonly rootSourceId: string;
  readonly sources: readonly ReusableCompositionSource[];
  readonly assets: readonly CompositionLibraryAsset[];
  readonly templates: readonly CompositionTemplate[];
  readonly diagnostics: readonly CompositionDiagnostic[];
}

export class ReusableCompositionError extends Error {
  readonly name = 'ReusableCompositionError';

  constructor(readonly diagnostics: readonly CompositionDiagnostic[]) {
    const first = diagnostics.find(diagnostic => diagnostic.severity === 'error') ?? diagnostics[0];
    super(first ? `${first.message} (${first.path})` : 'Reusable composition is invalid.');
  }
}

export function createReusableCompositionWorkspace(
  options: Readonly<{ id: string; name: string; root: ReusableCompositionSource }>,
): ReusableCompositionWorkspace {
  const workspace: ReusableCompositionWorkspace = {
    format: REUSABLE_COMPOSITION_WORKSPACE_FORMAT,
    version: REUSABLE_COMPOSITION_WORKSPACE_VERSION,
    id: options.id,
    name: options.name,
    family: options.root.family,
    rootSourceId: options.root.id,
    sources: [options.root],
    assets: sourceLibraryAssets(options.root),
    templates: [],
    diagnostics: [...options.root.diagnostics],
  };
  return parseReusableCompositionWorkspace(workspace);
}

export function sourceLibraryAssets(source: ReusableCompositionSource): readonly CompositionLibraryAsset[] {
  return source.project.assets.map(asset => ({
    id: compositionLibraryAssetId(source.id, asset.id),
    family: source.family,
    ownerSourceId: source.id,
    sourceAssetId: asset.id,
    asset: structuredClone(asset),
    hash: asset.delivery.integrity ?? source.provenance.sourceHash,
    provenance: source.provenance,
    availability: asset.source.kind === 'external' && asset.source.uri.trim() === '' ? 'missing' as const : 'available' as const,
  })) as readonly CompositionLibraryAsset[];
}

export function compositionLibraryAssetId(sourceId: string, sourceAssetId: string): string {
  return `asset:${encodeURIComponent(sourceId)}:${encodeURIComponent(sourceAssetId)}`;
}

export function parseReusableCompositionWorkspace(source: string | unknown): ReusableCompositionWorkspace {
  let value: unknown = source;
  if (typeof source === 'string') {
    try {
      value = JSON.parse(source) as unknown;
    } catch (error) {
      throw new ReusableCompositionError([issue(
        'E_COMPOSITION_INVALID_JSON', 'error', '$', error instanceof Error ? error.message : 'Invalid JSON.',
      )]);
    }
  }
  const detached = structuredClone(value) as ReusableCompositionWorkspace;
  if (!detached || detached.format !== REUSABLE_COMPOSITION_WORKSPACE_FORMAT
    || detached.version !== REUSABLE_COMPOSITION_WORKSPACE_VERSION) {
    throw new ReusableCompositionError([issue(
      'E_COMPOSITION_INVALID_FORMAT', 'error', '$.format', `Expected ${REUSABLE_COMPOSITION_WORKSPACE_FORMAT}.`,
    )]);
  }
  if ((detached.family !== '2d' && detached.family !== '3d')
    || !Array.isArray(detached.sources) || !Array.isArray(detached.assets)
    || !Array.isArray(detached.templates) || !Array.isArray(detached.diagnostics)) {
    throw new ReusableCompositionError([issue(
      'E_COMPOSITION_INVALID_VALUE', 'error', '$', 'Workspace family and source/asset/template/diagnostic arrays are required.',
    )]);
  }
  const sources = (detached.sources ?? []).map(sourceEntry => sourceEntry.family === '3d'
    ? { ...sourceEntry, project: parseNative3dProject(sourceEntry.project) }
    : sourceEntry.family === '2d'
      ? { ...sourceEntry, project: parseAnimationEditorProject(sourceEntry.project) }
      : (() => { throw new ReusableCompositionError([issue(
          'E_COMPOSITION_MIXED_FAMILY', 'error', '$.sources.family', 'Source family must be 2d or 3d.',
        )]); })()) as ReusableCompositionSource[];
  const normalized = { ...detached, sources };
  assertReusableCompositionWorkspace(normalized);
  return deepFreeze(normalized);
}

export function serializeReusableCompositionWorkspace(workspace: ReusableCompositionWorkspace): string {
  const validated = parseReusableCompositionWorkspace(workspace);
  return `${JSON.stringify(canonicalize(validated), null, 2)}\n`;
}

export function assertReusableCompositionWorkspace(
  workspace: ReusableCompositionWorkspace,
  maximumDepth = DEFAULT_COMPOSITION_NESTING_LIMIT,
): void {
  const diagnostics = validateReusableCompositionWorkspace(workspace, maximumDepth);
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) throw new ReusableCompositionError(diagnostics);
}

export function validateReusableCompositionWorkspace(
  workspace: ReusableCompositionWorkspace,
  maximumDepth = DEFAULT_COMPOSITION_NESTING_LIMIT,
): readonly CompositionDiagnostic[] {
  const diagnostics: CompositionDiagnostic[] = [];
  if (!workspace.id?.trim()) diagnostics.push(issue('E_COMPOSITION_INVALID_ID', 'error', '$.id', 'Workspace id is required.'));
  if (!workspace.name?.trim()) diagnostics.push(issue('E_COMPOSITION_INVALID_VALUE', 'error', '$.name', 'Workspace name is required.'));
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1) {
    diagnostics.push(issue('E_COMPOSITION_INVALID_VALUE', 'error', '$.maximumDepth', 'Nesting limit must be a positive integer.'));
    return diagnostics;
  }
  const sourceIds = new Set<string>();
  const sources = new Map<string, ReusableCompositionSource>();
  const instanceIds = new Set<string>();
  const overrideIds = new Set<string>();
  for (let sourceIndex = 0; sourceIndex < (workspace.sources ?? []).length; sourceIndex++) {
    const source = workspace.sources[sourceIndex]!;
    const path = `$.sources[${sourceIndex}]`;
    if (!source.id?.trim()) diagnostics.push(issue('E_COMPOSITION_INVALID_ID', 'error', `${path}.id`, 'Source id is required.'));
    else if (sourceIds.has(source.id)) diagnostics.push(issue('E_COMPOSITION_DUPLICATE_ID', 'error', `${path}.id`, `Duplicate source id "${source.id}".`));
    else { sourceIds.add(source.id); sources.set(source.id, source); }
    if (source.family !== workspace.family) diagnostics.push(issue(
      'E_COMPOSITION_MIXED_FAMILY', 'error', `${path}.family`, '2D and 3D composition sources cannot be mixed.',
    ));
    if ((source.family === '2d' && source.project.format !== 'haiyue-animation-editor-project@1')
      || (source.family === '3d' && source.project.format !== 'haiyue-animation-editor-project-3d@1')) {
      diagnostics.push(issue('E_COMPOSITION_MIXED_FAMILY', 'error', `${path}.project.format`, 'Source project family does not match source family.'));
    }
    const ownNodes = new Set(source.project.nodes.map(node => node.id));
    source.instances.forEach((instance, instanceIndex) => {
      const instancePath = `${path}.instances[${instanceIndex}]`;
      if (!instance.id?.trim() || instanceIds.has(instance.id)) diagnostics.push(issue(
        instance.id?.trim() ? 'E_COMPOSITION_DUPLICATE_ID' : 'E_COMPOSITION_INVALID_ID',
        'error', `${instancePath}.id`, instance.id?.trim() ? `Duplicate instance id "${instance.id}".` : 'Instance id is required.',
      ));
      else instanceIds.add(instance.id);
      if (instance.parent.family !== source.family) diagnostics.push(issue(
        'E_COMPOSITION_MIXED_FAMILY', 'error', `${instancePath}.parent.family`, 'Instance parent transform must match its owning source.',
      ));
      if (instance.parentNodeId !== undefined && !ownNodes.has(instance.parentNodeId)) diagnostics.push(issue(
        'E_COMPOSITION_DANGLING_REFERENCE', 'error', `${instancePath}.parentNodeId`, `Unknown parent node "${instance.parentNodeId}".`,
      ));
      validateTiming(instance.timing, instancePath, diagnostics);
      instance.overrides.forEach((override, overrideIndex) => {
        const overridePath = `${instancePath}.overrides[${overrideIndex}]`;
        if (!override.id?.trim() || overrideIds.has(override.id)) diagnostics.push(issue(
          override.id?.trim() ? 'E_COMPOSITION_DUPLICATE_ID' : 'E_COMPOSITION_INVALID_ID',
          'error', `${overridePath}.id`, override.id?.trim() ? `Duplicate override id "${override.id}".` : 'Override id is required.',
        ));
        else overrideIds.add(override.id);
      });
    });
  }
  if (!sources.has(workspace.rootSourceId)) diagnostics.push(issue(
    'E_COMPOSITION_DANGLING_REFERENCE', 'error', '$.rootSourceId', `Unknown root source "${workspace.rootSourceId}".`,
  ));

  const assetIds = new Set<string>();
  const assetBindings = new Set<string>();
  for (let assetIndex = 0; assetIndex < (workspace.assets ?? []).length; assetIndex++) {
    const asset = workspace.assets[assetIndex]!;
    const path = `$.assets[${assetIndex}]`;
    if (!asset.id?.trim() || assetIds.has(asset.id)) diagnostics.push(issue(
      asset.id?.trim() ? 'E_COMPOSITION_DUPLICATE_ID' : 'E_COMPOSITION_INVALID_ID',
      'error', `${path}.id`, asset.id?.trim() ? `Duplicate asset id "${asset.id}".` : 'Asset id is required.',
    ));
    else assetIds.add(asset.id);
    const owner = sources.get(asset.ownerSourceId);
    if (!owner) diagnostics.push(issue('E_COMPOSITION_DANGLING_REFERENCE', 'error', `${path}.ownerSourceId`, `Unknown owner source "${asset.ownerSourceId}".`));
    else if (!owner.project.assets.some(candidate => candidate.id === asset.sourceAssetId)) diagnostics.push(issue(
      'E_COMPOSITION_DANGLING_REFERENCE', 'error', `${path}.sourceAssetId`, `Unknown source asset "${asset.sourceAssetId}".`,
    ));
    const binding = `${asset.ownerSourceId}\u0000${asset.sourceAssetId}`;
    if (assetBindings.has(binding)) diagnostics.push(issue(
      'E_COMPOSITION_DUPLICATE_ID', 'error', `${path}.sourceAssetId`, 'A source asset can have only one library entry.',
    ));
    else assetBindings.add(binding);
    if (asset.family !== workspace.family) diagnostics.push(issue('E_COMPOSITION_MIXED_FAMILY', 'error', `${path}.family`, 'Library asset family is incompatible.'));
    if (!asset.hash?.trim()) diagnostics.push(issue('E_COMPOSITION_INVALID_VALUE', 'error', `${path}.hash`, 'Asset hash is required.'));
    if (asset.availability === 'missing') diagnostics.push(issue(
      'E_COMPOSITION_ASSET_MISSING', 'warning', path, `Asset "${asset.id}" is missing.`, 'missing-asset', asset.ownerSourceId,
    ));
  }
  for (const [sourceId, source] of sources) {
    source.project.assets.forEach((asset, assetIndex) => {
      if (!assetBindings.has(`${sourceId}\u0000${asset.id}`)) diagnostics.push(issue(
        'E_COMPOSITION_DANGLING_REFERENCE', 'error', `$.sources.${sourceId}.project.assets[${assetIndex}]`,
        `Source asset "${asset.id}" has no library entry.`,
      ));
    });
  }

  for (const [sourceId, source] of sources) {
    source.instances.forEach((instance, instanceIndex) => {
      const path = `$.sources[${[...sources.keys()].indexOf(sourceId)}].instances[${instanceIndex}]`;
      const streamDuration = (instance.timing.localOut - instance.timing.localIn) * instance.timing.loop.count;
      const hostDuration = (streamDuration - instance.timing.timeOffset) / instance.timing.timeScale;
      if (Number.isFinite(hostDuration) && instance.timing.startTime + hostDuration > source.project.composition.duration + 1e-9) {
        diagnostics.push(issue(
          'E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing`,
          `Instance range ends at ${instance.timing.startTime + hostDuration}, beyond owner duration ${source.project.composition.duration}.`,
        ));
      }
      if (!Number.isFinite(instance.parent.opacity) || instance.parent.opacity < 0 || instance.parent.opacity > 1) diagnostics.push(issue(
        'E_COMPOSITION_INVALID_VALUE', 'error', `${path}.parent.opacity`, 'Instance opacity must be in [0, 1].',
      ));
      const target = sources.get(instance.sourceId);
      if (!target) diagnostics.push(issue('E_COMPOSITION_DANGLING_REFERENCE', 'error', `${path}.sourceId`, `Unknown source "${instance.sourceId}".`));
      else {
        const duration = target.project.composition.duration;
        if (instance.timing.localOut > duration + 1e-9) diagnostics.push(issue(
          'E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.localOut`, `Local out exceeds source duration ${duration}.`,
        ));
        const targetNodes = new Set(target.project.nodes.map(node => node.id));
        const targetAssets = new Set(target.project.assets.map(asset => asset.id));
        instance.overrides.forEach((override, overrideIndex) => {
          const overridePath = `${path}.overrides[${overrideIndex}]`;
          if (override.kind === 'asset') {
            if (!targetAssets.has(override.sourceAssetId)) diagnostics.push(issue(
              'E_COMPOSITION_DANGLING_REFERENCE', 'error', `${overridePath}.sourceAssetId`, `Unknown overridden source asset "${override.sourceAssetId}".`,
            ));
            if (!assetIds.has(override.replacementAssetId)) diagnostics.push(issue(
              'E_COMPOSITION_DANGLING_REFERENCE', 'error', `${overridePath}.replacementAssetId`, `Unknown replacement library asset "${override.replacementAssetId}".`,
            ));
          } else if (!targetNodes.has(override.sourceNodeId)) diagnostics.push(issue(
            'E_COMPOSITION_DANGLING_REFERENCE', 'error', `${overridePath}.sourceNodeId`, `Unknown overridden source node "${override.sourceNodeId}".`,
          ));
        });
      }
    });
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (sourceId: string, depth: number, path: string): void => {
    if (depth > maximumDepth) {
      diagnostics.push(issue(
        'E_COMPOSITION_DEPTH_LIMIT', 'error', path, `Composition nesting exceeds ${maximumDepth} levels.`,
      ));
      return;
    }
    if (visiting.has(sourceId)) {
      diagnostics.push(issue('E_COMPOSITION_CYCLE', 'error', path, `Composition cycle reaches "${sourceId}".`));
      return;
    }
    if (visited.has(sourceId)) return;
    const source = sources.get(sourceId);
    if (!source) return;
    visiting.add(sourceId);
    source.instances.forEach((instance, index) => walk(instance.sourceId, depth + 1, `${path}.instances[${index}].sourceId`));
    visiting.delete(sourceId);
    visited.add(sourceId);
  };
  for (const sourceId of sources.keys()) walk(sourceId, 1, `$.sources.${sourceId}`);

  const templateIds = new Set<string>();
  workspace.templates.forEach((template, index) => {
    if (!template.id?.trim() || templateIds.has(template.id)) diagnostics.push(issue(
      template.id?.trim() ? 'E_COMPOSITION_DUPLICATE_ID' : 'E_COMPOSITION_INVALID_ID',
      'error', `$.templates[${index}].id`, template.id?.trim() ? `Duplicate template id "${template.id}".` : 'Template id is required.',
    ));
    else templateIds.add(template.id);
    if (!sources.has(template.sourceId)) diagnostics.push(issue(
      'E_COMPOSITION_DANGLING_REFERENCE', 'error', `$.templates[${index}].sourceId`, `Unknown template source "${template.sourceId}".`,
    ));
  });
  return Object.freeze(diagnostics);
}

function validateTiming(timing: CompositionTiming, path: string, diagnostics: CompositionDiagnostic[]): void {
  if (!finiteNonNegative(timing.startTime)) diagnostics.push(issue('E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.startTime`, 'Start time must be finite and non-negative.'));
  if (!finiteNonNegative(timing.localIn)) diagnostics.push(issue('E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.localIn`, 'Local in must be finite and non-negative.'));
  if (!Number.isFinite(timing.localOut) || timing.localOut <= timing.localIn) diagnostics.push(issue('E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.localOut`, 'Local out must be greater than local in.'));
  if (!Number.isFinite(timing.timeScale) || timing.timeScale <= 0) diagnostics.push(issue('E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.timeScale`, 'Time scale must be positive.'));
  if (!finiteNonNegative(timing.timeOffset)) diagnostics.push(issue('E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.timeOffset`, 'Time offset must be finite and non-negative.'));
  if (!Number.isSafeInteger(timing.loop.count) || timing.loop.count < 1) diagnostics.push(issue('E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.loop.count`, 'Loop count must be a positive integer.'));
  if (timing.loop.mode === 'none' && timing.loop.count !== 1) diagnostics.push(issue('E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.loop`, 'Non-looping instances require count 1.'));
  const streamDuration = (timing.localOut - timing.localIn) * timing.loop.count;
  if (Number.isFinite(streamDuration) && timing.timeOffset >= streamDuration) diagnostics.push(issue(
    'E_COMPOSITION_TIMING_RANGE', 'error', `${path}.timing.timeOffset`, 'Time offset must be smaller than the loop stream duration.',
  ));
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

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalize(child)]));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
