import { ScriptResource } from '@haiyue/engine/components';
import { isCompressedTextureSource } from '@haiyue/engine/assets';
import type {
  Geometry2DResourceItem,
  Geometry3DResourceItem,
  ModelResourceItem,
  PrefabResourceItem,
  PrefabVariantConflict,
  PrefabVariantOverride,
  ScriptResourceItem,
  TextureResourceItem,
} from '../../types';
import { countSerializedEntities } from '../../resources/icons';
import { t } from '../options/editorOptions';
import { presentModelCompatibility } from '../../domain/resource/modelCompatibility';
import {
  addDetailControl,
  addDetailRow,
  createDetailSelect,
  createNameInput,
  prepareDetailPanel,
  selectResource,
  setDetailTitle,
  type ResourceDetailDeps,
} from './ResourceDetailView';
import {
  showMaterial2DDetails,
  showMaterialDetails,
} from './MaterialResourceDetails';

export type { ResourceDetailDeps, ResourceDetailElements } from './ResourceDetailView';
export { showMaterial2DDetails, showMaterialDetails };

function formatVariantPath(path: readonly number[]): string {
  return path.length ? path.join('.') : 'root';
}

function formatVariantPathLabel(root: import('../../export/runtimeScene').SerializedEntity | null, path: readonly number[]): string {
  if (!root) return formatVariantPath(path);
  const names = [root.name || 'root'];
  let current = root;
  for (const index of path) {
    const child = current.children[index];
    if (!child) return formatVariantPath(path);
    current = child;
    names.push(current.name || `child ${index}`);
  }
  return `${names.join(' / ')} (${formatVariantPath(path)})`;
}

function getSerializedEntityAtPath(
  root: import('../../export/runtimeScene').SerializedEntity | null,
  path: readonly number[],
): import('../../export/runtimeScene').SerializedEntity | null {
  if (!root) return null;
  let current = root;
  for (const index of path) {
    const child = current.children[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

function getVariantOverrideFields(override: PrefabVariantOverride): string[] {
  const fields: string[] = [];
  if (override.name !== undefined) fields.push('name');
  if (override.disabled !== undefined) fields.push('disabled');
  if (override.components !== undefined) fields.push('components');
  if (override.children !== undefined) fields.push('children');
  return fields;
}

function getEntityFieldValue(
  entity: import('../../export/runtimeScene').SerializedEntity | null,
  field: string,
): unknown {
  if (!entity) return undefined;
  if (field === 'name') return entity.name;
  if (field === 'disabled') return entity.disabled;
  if (field === 'components') return entity.components;
  if (field === 'children') return entity.children;
  return undefined;
}

function getOverrideFieldValue(override: PrefabVariantOverride, field: string): unknown {
  if (field === 'name') return override.name;
  if (field === 'disabled') return override.disabled;
  if (field === 'components') return override.components;
  if (field === 'children') return override.children;
  return undefined;
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) return '-';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pathsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function createVariantDiffView(
  item: PrefabResourceItem,
  baseRoot: import('../../export/runtimeScene').SerializedEntity | null,
  conflicts: PrefabVariantConflict[],
  deps: ResourceDetailDeps,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'prefab-diff-list';
  const resolvedRoot = deps.resourcePool.resolvePrefabRoot(item);
  const overrides = item.variantOverrides ?? [];
  if (!overrides.length) {
    const empty = document.createElement('div');
    empty.className = 'prefab-diff-empty';
    empty.textContent = t('detail.noVariantOverrides');
    container.append(empty);
    return container;
  }

  for (const override of overrides) {
    const baseEntity = getSerializedEntityAtPath(baseRoot, override.path);
    const resolvedEntity = getSerializedEntityAtPath(resolvedRoot, override.path);
    const conflict = conflicts.find(candidate => pathsEqual(candidate.path, override.path));
    const card = document.createElement('div');
    card.className = 'prefab-diff-card';
    const title = document.createElement('div');
    title.className = 'prefab-diff-title';
    title.textContent = formatVariantPathLabel(baseRoot, override.path);
    card.append(title);

    for (const field of getVariantOverrideFields(override)) {
      const row = document.createElement('div');
      row.className = `prefab-diff-row${conflict?.fields.includes(field) ? ' conflict' : ''}`;
      const fieldEl = document.createElement('div');
      fieldEl.className = 'prefab-diff-field';
      fieldEl.textContent = field;
      const baseEl = createDiffCell(t('detail.diffBase'), formatDiffValue(getEntityFieldValue(baseEntity, field)));
      const overrideEl = createDiffCell(t('detail.diffOverride'), formatDiffValue(getOverrideFieldValue(override, field)));
      const resolvedEl = createDiffCell(t('detail.diffResolved'), formatDiffValue(getEntityFieldValue(resolvedEntity, field)));
      row.append(fieldEl, baseEl, overrideEl, resolvedEl);
      if (conflict?.fields.includes(field)) {
        const actions = createVariantConflictActions(item, override.path, field, deps.resolvePrefabVariantFieldConflict);
        actions.classList.add('prefab-diff-actions');
        row.append(actions);
      }
      card.append(row);
    }
    container.append(card);
  }
  return container;
}

function createDiffCell(label: string, value: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'prefab-diff-cell';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('code');
  valueEl.textContent = value;
  cell.append(labelEl, valueEl);
  return cell;
}

function createVariantOverrideEditor(
  item: PrefabResourceItem,
  index: number,
  override: PrefabVariantOverride,
  onChange: ResourceDetailDeps['updatePrefabVariantOverride'],
): HTMLTextAreaElement {
  const input = document.createElement('textarea');
  input.className = 'detail-input';
  input.rows = 6;
  input.value = JSON.stringify({
    name: override.name,
    disabled: override.disabled,
    components: override.components,
    children: override.children,
  }, null, 2);
  input.addEventListener('change', () => {
    try {
      const value = JSON.parse(input.value || '{}') as Partial<import('../../types').PrefabVariantOverride>;
      input.setCustomValidity('');
      onChange(item, index, {
        path: [...override.path],
        ...(value.name === undefined ? {} : { name: value.name }),
        ...(value.disabled === undefined ? {} : { disabled: value.disabled }),
        ...(value.components === undefined ? {} : { components: value.components }),
        ...(value.children === undefined ? {} : { children: value.children }),
      });
    } catch (error) {
      input.setCustomValidity(error instanceof Error ? error.message : 'Invalid JSON');
      input.reportValidity();
    }
  });
  return input;
}

function createVariantConflictActions(
  item: PrefabResourceItem,
  path: number[],
  field: string,
  onResolve: ResourceDetailDeps['resolvePrefabVariantFieldConflict'],
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'detail-actions';
  const acceptButton = document.createElement('button');
  acceptButton.className = 'detail-action';
  acceptButton.type = 'button';
  acceptButton.textContent = t('detail.acceptBase');
  acceptButton.addEventListener('click', () => onResolve(item, path, field, 'accept-base'));

  const keepButton = document.createElement('button');
  keepButton.className = 'detail-action';
  keepButton.type = 'button';
  keepButton.textContent = t('detail.keepOverride');
  keepButton.addEventListener('click', () => onResolve(item, path, field, 'keep-override'));

  row.append(acceptButton, keepButton);
  return row;
}

export function showGeometryDetails(deps: ResourceDetailDeps, item: Geometry3DResourceItem): void {
  selectResource(deps, { selectedGeometryId: item.resource.id });
  prepareDetailPanel(deps, item.name);

  const geometry = item.resource;
  const triangleCount = geometry.indices ? Math.floor(geometry.indices.length / 3) : Math.floor(geometry.vertexCount / 3);
  const bbox = geometry.getBoundingBox();
  addDetailRow(deps, t('detail.type'), geometry.constructor.name);
  addDetailRow(deps, t('field.id'), geometry.id);

  const nameInput = createNameInput(item.name, (name) => {
    item.name = name || `Geometry ${geometry.id}`;
    deps.resourceDisplayNames.set(geometry, item.name);
    setDetailTitle(deps, item.name);
    deps.renderResourcePool();
    return item.name;
  });
  addDetailControl(deps, t('field.name'), nameInput);

  addDetailRow(deps, t('detail.vertices'), geometry.vertexCount);
  addDetailRow(deps, t('detail.triangles'), triangleCount);
  addDetailRow(deps, t('detail.indices'), geometry.indexCount);
  addDetailControl(
    deps,
    t('detail.topology'),
    createDetailSelect<GPUPrimitiveTopology>(
      geometry.topology ?? '',
      [
        { label: t('detail.rendererDefault'), value: '' },
        { label: 'point-list', value: 'point-list' },
        { label: 'line-list', value: 'line-list' },
        { label: 'line-strip', value: 'line-strip' },
        { label: 'triangle-list', value: 'triangle-list' },
        { label: 'triangle-strip', value: 'triangle-strip' },
      ],
      value => {
        geometry.topology = value || null;
      },
    ),
  );
  addDetailControl(
    deps,
    t('detail.cullMode'),
    createDetailSelect<GPUCullMode>(
      geometry.cullMode ?? '',
      [
        { label: t('detail.rendererDefault'), value: '' },
        { label: 'none', value: 'none' },
        { label: 'front', value: 'front' },
        { label: 'back', value: 'back' },
      ],
      value => {
        geometry.cullMode = value || null;
      },
    ),
  );
  addDetailControl(
    deps,
    t('detail.frontFace'),
    createDetailSelect<GPUFrontFace>(
      geometry.frontFace ?? '',
      [
        { label: t('detail.rendererDefault'), value: '' },
        { label: 'ccw', value: 'ccw' },
        { label: 'cw', value: 'cw' },
      ],
      value => {
        geometry.frontFace = value || null;
      },
    ),
  );
  addDetailRow(deps, t('detail.references'), item.refs);
  addDetailRow(deps, t('detail.hasNormals'), geometry.normals ? t('common.yes') : t('common.no'));
  addDetailRow(deps, t('detail.hasUvs'), geometry.textureCoordinates.size > 0 ? t('common.yes') : t('common.no'));
  addDetailRow(deps, t('detail.aabbMin'), Array.from(bbox.min).map(deps.formatNumber).join(', '));
  addDetailRow(deps, t('detail.aabbMax'), Array.from(bbox.max).map(deps.formatNumber).join(', '));
}

export function showGeometry2DDetails(deps: ResourceDetailDeps, item: Geometry2DResourceItem): void {
  selectResource(deps, { selectedGeometry2DId: item.resource.id });
  prepareDetailPanel(deps, item.name);

  const geometry = item.resource;
  const triangleCount = geometry.indices ? Math.floor(geometry.indices.length / 3) : Math.floor(geometry.vertexCount / 3);
  addDetailRow(deps, t('detail.type'), 'Geometry2D');
  addDetailRow(deps, t('field.id'), geometry.id);

  const nameInput = createNameInput(item.name, (name) => {
    item.name = name || `Geometry2D ${geometry.id}`;
    deps.resourceDisplayNames.set(geometry, item.name);
    setDetailTitle(deps, item.name);
    deps.renderResourcePool();
    return item.name;
  });
  addDetailControl(deps, t('field.name'), nameInput);

  addDetailRow(deps, t('detail.vertices'), geometry.vertexCount);
  addDetailRow(deps, t('detail.triangles'), triangleCount);
  addDetailRow(deps, t('detail.indices'), geometry.indexCount);
  addDetailControl(
    deps,
    t('detail.topology'),
    createDetailSelect<GPUPrimitiveTopology>(
      geometry.topology ?? '',
      [
        { label: t('detail.rendererDefault'), value: '' },
        { label: 'point-list', value: 'point-list' },
        { label: 'line-list', value: 'line-list' },
        { label: 'line-strip', value: 'line-strip' },
        { label: 'triangle-list', value: 'triangle-list' },
        { label: 'triangle-strip', value: 'triangle-strip' },
      ],
      value => {
        geometry.topology = value || null;
        deps.renderResourcePool();
      },
    ),
  );
  addDetailRow(deps, t('detail.references'), item.refs);
}

export function showTextureDetails(deps: ResourceDetailDeps, item: TextureResourceItem): void {
  selectResource(deps, { selectedTextureId: item.id });
  prepareDetailPanel(deps, item.name);

  addDetailRow(deps, t('detail.type'), 'Texture');
  addDetailRow(deps, t('field.id'), item.id);
  addDetailRow(deps, t('detail.assetKey'), item.assetKey);
  addDetailRow(deps, t('detail.status'), item.status);
  addDetailRow(deps, t('detail.gpuAsset'), item.gpuAssetKey ?? '-');
  addDetailRow(deps, t('detail.source'), formatTextureSource(item));
  addDetailRow(deps, t('detail.mipmapSource'), item.compressedInfo ? 'source-provided' : 'base-level-only');
  addDetailRow(deps, t('detail.references'), item.refs);
  addDetailRow(deps, t('detail.size'), item.width && item.height ? `${item.width} x ${item.height}` : '-');
  addDetailRow(deps, t('detail.fileType'), item.fileType ?? '-');
  addDetailRow(deps, t('detail.fileSize'), item.fileSize ? `${Math.round(item.fileSize / 1024)} KB` : '-');
  if (item.compressedInfo) {
    addDetailRow(deps, t('detail.textureContainer'), item.compressedInfo.container.toUpperCase());
    addDetailRow(deps, t('detail.textureDimension'), item.compressedInfo.dimension ?? '-');
    addDetailRow(deps, t('detail.textureSupercompression'), item.compressedInfo.supercompression ?? '-');
    addDetailRow(deps, t('detail.textureGpuFormat'), item.compressedInfo.gpuFormat ?? '-');
    addDetailRow(deps, t('detail.textureRequiredFeature'), item.compressedInfo.requiredFeature ?? '-');
    addDetailRow(deps, t('detail.textureUploadPath'), item.compressedInfo.uploadPath ?? '-');
    addDetailRow(deps, t('detail.textureLayers'), formatCompressedTextureLayers(item));
    if (item.compressedInfo.unsupportedReason) addDetailRow(deps, t('detail.textureSupport'), item.compressedInfo.unsupportedReason);
  }
  if (item.previewError) addDetailRow(deps, t('detail.preview'), item.previewError);
  if (item.assetError) addDetailRow(deps, t('detail.assetError'), item.assetError);

  const nameInput = createNameInput(item.name, (name) => {
    item.name = name || `Texture ${item.id}`;
    setDetailTitle(deps, item.name);
    deps.renderResourcePool();
    return item.name;
  });
  addDetailControl(deps, t('field.name'), nameInput);
}

function formatTextureSource(item: TextureResourceItem): string {
  if (isCompressedTextureSource(item.resource)) return item.resource.type;
  return typeof item.resource === 'string' ? 'URL' : item.resource.constructor.name;
}

function formatCompressedTextureLayers(item: TextureResourceItem): string {
  const info = item.compressedInfo;
  if (!info) return '-';
  const parts = [
    info.depth ? `depth ${info.depth}` : undefined,
    info.layers ? `layers ${info.layers}` : undefined,
    info.faces ? `faces ${info.faces}` : undefined,
    info.levels ? `mips ${info.levels}` : undefined,
  ].filter(Boolean);
  return parts.join(', ') || '-';
}

export function showModelDetails(deps: ResourceDetailDeps, item: ModelResourceItem): void {
  if ((!item.previewUrl || item.vertexCount === undefined || item.triangleCount === undefined || !item.assetStats || !item.compatibilityReport) && !item.previewError) {
    void deps.enrichModelResource(item);
  }
  selectResource(deps, { selectedModelId: item.id });
  prepareDetailPanel(deps, item.name);

  addDetailRow(deps, t('detail.type'), 'glTF Model');
  addDetailRow(deps, t('field.id'), item.id);
  addDetailRow(deps, t('detail.assetKey'), item.assetKey);
  addDetailRow(deps, t('detail.status'), item.status);
  addDetailRow(deps, t('detail.references'), item.refs);
  addDetailRow(deps, t('detail.vertices'), item.vertexCount ?? '-');
  addDetailRow(deps, t('detail.triangles'), item.triangleCount ?? '-');
  addDetailRow(deps, t('detail.meshes'), item.assetStats?.meshCount ?? '-');
  addDetailRow(deps, t('detail.primitives'), item.assetStats?.primitiveCount ?? '-');
  addDetailRow(deps, t('detail.materials'), item.assetStats?.materialCount ?? '-');
  addDetailRow(deps, t('detail.textures'), item.assetStats?.textureCount ?? '-');
  addDetailRow(deps, t('detail.images'), item.assetStats?.imageCount ?? '-');
  addDetailRow(deps, t('detail.animations'), item.assetStats?.animationCount ?? '-');
  if (item.compatibilityReport) {
    const compatibility = presentModelCompatibility(item.compatibilityReport);
    addDetailRow(deps, t('detail.compatibility'), t(compatibility.status === 'compatible' ? 'detail.compatible' : 'detail.degraded'));
    addDetailRow(deps, t('detail.extensionCompatibility'), compatibility.extensions);
    addDetailRow(deps, t('detail.mipmapSource'), compatibility.mipmaps);
    addDetailRow(deps, t('detail.boundsCompatibility'), compatibility.bounds);
    addDetailRow(deps, t('detail.uvSemanticCompatibility'), compatibility.uvSemantics);
    addDetailRow(deps, t('detail.modelLoadPerformance'), compatibility.performance);
    compatibility.issues.forEach((issue, index) => {
      addDetailRow(deps, `${t('detail.compatibilityIssue')} ${index + 1}`, issue);
    });
  }
  addDetailRow(deps, t('detail.file'), item.fileName ?? '-');
  addDetailRow(deps, t('detail.fileType'), item.fileType ?? '-');
  addDetailRow(deps, t('detail.fileSize'), item.fileSize ? `${Math.round(item.fileSize / 1024)} KB` : '-');
  if (item.previewError) addDetailRow(deps, t('detail.preview'), item.previewError);

  const nameInput = createNameInput(item.name, (name) => {
    item.name = name || `Model ${item.id}`;
    setDetailTitle(deps, item.name);
    deps.renderResourcePool();
    return item.name;
  });
  addDetailControl(deps, t('field.name'), nameInput);

  const instantiateButton = document.createElement('button');
  instantiateButton.className = 'detail-action';
  instantiateButton.type = 'button';
  instantiateButton.textContent = t('detail.addToScene');
  instantiateButton.addEventListener('click', () => deps.instantiateModel(item));
  addDetailControl(deps, t('detail.action'), instantiateButton);

  const prefabButton = document.createElement('button');
  prefabButton.className = 'detail-action';
  prefabButton.type = 'button';
  prefabButton.textContent = t('resource.createPrefab');
  prefabButton.addEventListener('click', () => deps.createPrefabFromModel(item));
  addDetailControl(deps, t('detail.prefab'), prefabButton);
}

export function showPrefabDetails(deps: ResourceDetailDeps, item: PrefabResourceItem): void {
  selectResource(deps, { selectedPrefabId: item.id });
  prepareDetailPanel(deps, item.name);

  addDetailRow(deps, t('detail.type'), 'Prefab');
  addDetailRow(deps, t('field.id'), item.id);
  addDetailRow(deps, t('detail.assetKey'), item.assetKey);
  addDetailRow(deps, t('detail.status'), item.status);
  addDetailRow(deps, t('detail.root'), item.root.name || 'Untitled Entity');
  addDetailRow(deps, t('detail.entities'), countSerializedEntities(item.root));
  addDetailRow(deps, t('detail.references'), item.refs);
  addDetailRow(deps, t('detail.revision'), item.revision);
  if (item.basePrefabId !== undefined) {
    const base = deps.resourcePool.prefabs.get(item.basePrefabId);
    const baseRoot = base ? deps.resourcePool.resolvePrefabRoot(base) : null;
    addDetailRow(deps, t('detail.variant'), t('common.yes'));
    addDetailRow(deps, t('detail.basePrefab'), base ? `${base.name} (#${base.id})` : item.basePrefabId);
    addDetailRow(deps, t('detail.baseRevision'), item.baseRevision ?? '-');
    const conflicts = deps.resourcePool.getPrefabVariantConflicts(item);
    addDetailRow(deps, t('detail.variantOverrides'), item.variantOverrides?.length ?? 0);
    addDetailRow(deps, t('detail.variantConflicts'), conflicts.length);
    addDetailControl(deps, t('detail.variantDiff'), createVariantDiffView(item, baseRoot, conflicts, deps));
    item.variantOverrides?.forEach((override, index) => {
      addDetailControl(
        deps,
        `${t('detail.variantOverride')} ${formatVariantPath(override.path)}`,
        createVariantOverrideEditor(item, index, override, deps.updatePrefabVariantOverride),
      );
    });
    const rebaseButton = document.createElement('button');
    rebaseButton.className = 'detail-action';
    rebaseButton.type = 'button';
    rebaseButton.textContent = t('detail.rebaseVariant');
    rebaseButton.addEventListener('click', () => deps.rebasePrefabVariant(item));
    addDetailControl(deps, t('detail.variant'), rebaseButton);

    const captureButton = document.createElement('button');
    captureButton.className = 'detail-action';
    captureButton.type = 'button';
    captureButton.textContent = t('detail.captureVariantOverrides');
    captureButton.addEventListener('click', () => deps.capturePrefabVariantOverrides(item));
    addDetailControl(deps, t('detail.variant'), captureButton);
  }

  const nameInput = createNameInput(item.name, (name) => {
    item.name = name || `Prefab ${item.id}`;
    setDetailTitle(deps, item.name);
    deps.renderResourcePool();
    deps.refreshSceneTree();
    return item.name;
  });
  addDetailControl(deps, t('field.name'), nameInput);

  const syncButton = document.createElement('button');
  syncButton.className = 'detail-action';
  syncButton.type = 'button';
  syncButton.textContent = t('detail.syncInstances');
  syncButton.addEventListener('click', () => deps.syncPrefabInstances(item));
  addDetailControl(deps, t('detail.action'), syncButton);

  const syncSelectedButton = document.createElement('button');
  syncSelectedButton.className = 'detail-action';
  syncSelectedButton.type = 'button';
  syncSelectedButton.textContent = t('detail.syncSelectedInstances');
  syncSelectedButton.addEventListener('click', () => deps.syncSelectedPrefabInstances(item));
  addDetailControl(deps, t('detail.action'), syncSelectedButton);

  const variantButton = document.createElement('button');
  variantButton.className = 'detail-action';
  variantButton.type = 'button';
  variantButton.textContent = t('detail.createVariant');
  variantButton.addEventListener('click', () => deps.createPrefabVariant(item));
  addDetailControl(deps, t('detail.variant'), variantButton);
}

export function showScriptResourceDetails(deps: ResourceDetailDeps, item: ScriptResourceItem): void {
  selectResource(deps, { activeScriptResourceId: item.resource.id }, item.resource);
  prepareDetailPanel(deps, item.name);

  addDetailRow(deps, t('detail.type'), 'Script');
  addDetailRow(deps, t('field.id'), item.id);
  addDetailRow(deps, t('detail.references'), item.refs);
  addDetailRow(deps, t('detail.file'), item.fileName ?? '-');
  addDetailRow(deps, t('detail.fileSize'), item.fileSize ? `${Math.round(item.fileSize / 1024)} KB` : '-');

  const nameInput = createNameInput(item.name, (name) => {
    item.name = name || `Script ${item.id}`;
    item.resource.name = item.name;
    deps.resourceDisplayNames.set(item.resource, item.name);
    setDetailTitle(deps, item.name);
    deps.renderResourcePool();
    return item.name;
  });
  addDetailControl(deps, t('field.name'), nameInput);
}
