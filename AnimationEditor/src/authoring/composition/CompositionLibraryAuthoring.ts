import type { AnimationEditorAsset, AnimationEditorProject } from '../../domain/AnimationEditorProject';
import {
  type Native3dAsset,
  type Native3dProject,
} from '../../domain/native3d/Native3dProject';
import {
  ReusableCompositionError,
  compositionLibraryAssetId,
  parseReusableCompositionWorkspace,
  sourceLibraryAssets,
  validateReusableCompositionWorkspace,
  type CompositionDiagnostic,
  type CompositionInstanceOverride,
  type CompositionLibraryAsset,
  type CompositionProvenance,
  type CompositionTemplate,
  type ReusableCompositionInstance,
  type ReusableCompositionSource,
  type ReusableCompositionWorkspace,
} from '../../domain/ReusableComposition';

export function addCompositionSource(
  workspace: ReusableCompositionWorkspace,
  source: ReusableCompositionSource,
): ReusableCompositionWorkspace {
  return update(workspace, draft => {
    draft.sources.push(structuredClone(source) as MutableSource);
    draft.assets.push(...structuredClone(sourceLibraryAssets(source)) as MutableLibraryAsset[]);
    draft.diagnostics.push(...structuredClone(source.diagnostics));
  });
}

export function setCompositionSourceInstances(
  workspace: ReusableCompositionWorkspace,
  sourceId: string,
  instances: readonly ReusableCompositionInstance[],
): ReusableCompositionWorkspace {
  return update(workspace, draft => {
    const source = requiredSource(draft, sourceId);
    source.instances = structuredClone(instances) as ReusableCompositionInstance[];
  });
}

export function addCompositionInstance(
  workspace: ReusableCompositionWorkspace,
  ownerSourceId: string,
  instance: ReusableCompositionInstance,
): ReusableCompositionWorkspace {
  return update(workspace, draft => {
    requiredSource(draft, ownerSourceId).instances.push(structuredClone(instance) as ReusableCompositionInstance);
  });
}

export function removeCompositionInstance(
  workspace: ReusableCompositionWorkspace,
  ownerSourceId: string,
  instanceId: string,
): ReusableCompositionWorkspace {
  return update(workspace, draft => {
    const source = requiredSource(draft, ownerSourceId);
    const before = source.instances.length;
    source.instances = source.instances.filter(instance => instance.id !== instanceId);
    if (source.instances.length === before) fail('E_COMPOSITION_DANGLING_REFERENCE', `$.sources.${ownerSourceId}.instances`, `Unknown instance "${instanceId}".`);
  });
}

export function addCompositionTemplate(
  workspace: ReusableCompositionWorkspace,
  template: CompositionTemplate,
): ReusableCompositionWorkspace {
  return update(workspace, draft => draft.templates.push(structuredClone(template) as CompositionTemplate));
}

export function removeCompositionTemplate(
  workspace: ReusableCompositionWorkspace,
  templateId: string,
): ReusableCompositionWorkspace {
  return update(workspace, draft => {
    const before = draft.templates.length;
    draft.templates = draft.templates.filter(template => template.id !== templateId);
    if (before === draft.templates.length) fail('E_COMPOSITION_DANGLING_REFERENCE', '$.templates', `Unknown template "${templateId}".`);
  });
}

export function createCompositionInstanceFromTemplate(
  workspace: ReusableCompositionWorkspace,
  templateId: string,
  options: Omit<ReusableCompositionInstance, 'sourceId'>,
): ReusableCompositionInstance {
  const template = workspace.templates.find(candidate => candidate.id === templateId);
  if (!template) fail('E_COMPOSITION_DANGLING_REFERENCE', '$.templates', `Unknown template "${templateId}".`);
  return Object.freeze({ ...structuredClone(options), sourceId: template.sourceId });
}

/**
 * Replaces asset bytes/URI while preserving the library and source asset ids.
 * References therefore remain stable, and validation happens before the new
 * immutable workspace is returned.
 */
export function relinkCompositionAsset(
  workspace: ReusableCompositionWorkspace,
  libraryAssetId: string,
  replacement: AnimationEditorAsset | Native3dAsset,
  hash: string,
  provenance: CompositionProvenance,
): ReusableCompositionWorkspace {
  return update(workspace, draft => {
    const index = draft.assets.findIndex(asset => asset.id === libraryAssetId);
    if (index < 0) fail('E_COMPOSITION_DANGLING_REFERENCE', '$.assets', `Unknown library asset "${libraryAssetId}".`);
    const current = draft.assets[index]!;
    const owner = requiredSource(draft, current.ownerSourceId);
    if (current.family !== owner.family) fail('E_COMPOSITION_MIXED_FAMILY', `$.assets[${index}].family`, 'Asset family and owner source differ.');
    if (!hash.trim()) fail('E_COMPOSITION_INVALID_VALUE', `$.assets[${index}].hash`, 'Replacement hash is required.');
    const preserved = { ...structuredClone(replacement), id: current.sourceAssetId };
    const projectAssetIndex = owner.project.assets.findIndex(asset => asset.id === current.sourceAssetId);
    if (projectAssetIndex < 0) fail('E_COMPOSITION_DANGLING_REFERENCE', `$.assets[${index}].sourceAssetId`, 'Owner source asset is missing.');
    if (owner.family === '2d' && current.family === '2d') {
      if (preserved.type === 'model' || !('fileName' in preserved.source || preserved.source.kind === 'external')) {
        fail('E_COMPOSITION_MIXED_FAMILY', `$.assets[${index}].asset`, 'A 2D library asset requires a 2D asset payload.');
      }
      const nextAsset = preserved as AnimationEditorAsset;
      owner.project = {
        ...owner.project,
        assets: owner.project.assets.map((asset, assetIndex) => assetIndex === projectAssetIndex ? nextAsset : asset),
      };
      draft.assets[index] = { ...current, asset: nextAsset, hash, provenance: structuredClone(provenance), availability: 'available' };
    } else if (owner.family === '3d' && current.family === '3d') {
      const nextAsset = preserved as Native3dAsset;
      owner.project = {
        ...owner.project,
        assets: owner.project.assets.map((asset, assetIndex) => assetIndex === projectAssetIndex ? nextAsset : asset),
      };
      draft.assets[index] = { ...current, asset: nextAsset, hash, provenance: structuredClone(provenance), availability: 'available' };
    } else fail('E_COMPOSITION_MIXED_FAMILY', `$.assets[${index}].family`, 'Replacement asset family differs from the owner source.');
  });
}

export function markCompositionAssetMissing(
  workspace: ReusableCompositionWorkspace,
  libraryAssetId: string,
): ReusableCompositionWorkspace {
  return update(workspace, draft => {
    const index = draft.assets.findIndex(asset => asset.id === libraryAssetId);
    if (index < 0) fail('E_COMPOSITION_DANGLING_REFERENCE', '$.assets', `Unknown library asset "${libraryAssetId}".`);
    draft.assets[index]!.availability = 'missing';
  });
}

/** Deletes only unreferenced data. A failed delete leaves the original workspace untouched. */
export function deleteCompositionAsset(
  workspace: ReusableCompositionWorkspace,
  libraryAssetId: string,
): ReusableCompositionWorkspace {
  return update(workspace, draft => {
    const index = draft.assets.findIndex(asset => asset.id === libraryAssetId);
    if (index < 0) fail('E_COMPOSITION_DANGLING_REFERENCE', '$.assets', `Unknown library asset "${libraryAssetId}".`);
    const entry = draft.assets[index]!;
    const owner = requiredSource(draft, entry.ownerSourceId);
    const references = compositionAssetReferences(draft, libraryAssetId);
    if (references.length > 0) fail(
      'E_COMPOSITION_ASSET_REFERENCED', `$.assets[${index}]`,
      `Asset "${libraryAssetId}" is still referenced by ${references.join(', ')}.`,
    );
    owner.project = { ...owner.project, assets: owner.project.assets.filter(asset => asset.id !== entry.sourceAssetId) } as typeof owner.project;
    draft.assets.splice(index, 1);
  });
}

export function compositionAssetReferences(
  workspace: ReusableCompositionWorkspace,
  libraryAssetId: string,
): readonly string[] {
  const entry = workspace.assets.find(asset => asset.id === libraryAssetId);
  if (!entry) return Object.freeze([]);
  const references: string[] = [];
  const owner = workspace.sources.find(source => source.id === entry.ownerSourceId);
  if (owner) {
    const assetId = entry.sourceAssetId;
    scan(owner.project.nodes, '$.nodes', (path, value) => {
      if (value === assetId) references.push(`${owner.id}:${path}`);
    });
    if (owner.family === '3d') {
      scan(owner.project.materials, '$.materials', (path, value) => {
        if (value === assetId) references.push(`${owner.id}:${path}`);
      });
      for (let index = 0; index < owner.project.assets.length; index++) {
        if (owner.project.assets[index]!.dependencyAssetIds?.includes(assetId)) references.push(`${owner.id}:$.assets[${index}].dependencyAssetIds`);
      }
    }
  }
  workspace.sources.forEach((source, sourceIndex) => source.instances.forEach((instance, instanceIndex) => (
    instance.overrides.forEach((override, overrideIndex) => {
      if (override.kind === 'asset' && override.replacementAssetId === libraryAssetId) {
        references.push(`$.sources[${sourceIndex}].instances[${instanceIndex}].overrides[${overrideIndex}]`);
      }
    })
  )));
  return Object.freeze([...new Set(references)]);
}

export function compositionLibraryDiagnostics(
  workspace: ReusableCompositionWorkspace,
): readonly CompositionDiagnostic[] {
  return validateReusableCompositionWorkspace(workspace).filter(diagnostic => (
    diagnostic.code === 'E_COMPOSITION_ASSET_MISSING'
    || diagnostic.risk === 'missing-asset'
  ));
}

export function defaultCompositionAssetOverride(
  id: string,
  sourceAssetId: string,
  replacementOwnerSourceId: string,
  replacementSourceAssetId: string,
): CompositionInstanceOverride {
  return Object.freeze({
    id,
    kind: 'asset',
    sourceAssetId,
    replacementAssetId: compositionLibraryAssetId(replacementOwnerSourceId, replacementSourceAssetId),
  });
}

function update(
  workspace: ReusableCompositionWorkspace,
  operation: (draft: MutableWorkspace) => void,
): ReusableCompositionWorkspace {
  const draft = structuredClone(workspace) as unknown as MutableWorkspace;
  operation(draft);
  return parseReusableCompositionWorkspace(draft as unknown as ReusableCompositionWorkspace);
}

function requiredSource(draft: MutableWorkspace, id: string): MutableSource {
  const source = draft.sources.find(candidate => candidate.id === id);
  if (!source) fail('E_COMPOSITION_DANGLING_REFERENCE', '$.sources', `Unknown source "${id}".`);
  return source;
}

function scan(value: unknown, path: string, visitor: (path: string, value: unknown) => void): void {
  visitor(path, value);
  if (Array.isArray(value)) value.forEach((child, index) => scan(child, `${path}[${index}]`, visitor));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`, visitor);
  }
}

function fail(code: string, path: string, message: string): never {
  throw new ReusableCompositionError([Object.freeze({ code, severity: 'error', path, message })]);
}

type MutableSource =
  | Omit<Extract<ReusableCompositionSource, { readonly family: '2d' }>, 'project' | 'instances'> & {
      project: AnimationEditorProject;
      instances: ReusableCompositionInstance[];
    }
  | Omit<Extract<ReusableCompositionSource, { readonly family: '3d' }>, 'project' | 'instances'> & {
      project: Native3dProject;
      instances: ReusableCompositionInstance[];
    };
type MutableLibraryAsset =
  | Omit<Extract<CompositionLibraryAsset, { readonly family: '2d' }>, 'availability'> & { availability: 'available' | 'missing' }
  | Omit<Extract<CompositionLibraryAsset, { readonly family: '3d' }>, 'availability'> & { availability: 'available' | 'missing' };
interface MutableWorkspace {
  readonly format: ReusableCompositionWorkspace['format'];
  readonly version: ReusableCompositionWorkspace['version'];
  readonly id: string;
  readonly name: string;
  readonly family: ReusableCompositionWorkspace['family'];
  readonly rootSourceId: string;
  sources: MutableSource[];
  assets: MutableLibraryAsset[];
  templates: CompositionTemplate[];
  diagnostics: CompositionDiagnostic[];
}
