import type { World } from '@haiyue/engine';
import type { ResourceAssetId, ResourcePool } from '../../resources/ResourcePool';
import type { EditorResourceImporter, EditorResourceImporterTarget } from '../../types';
import { t } from '../options/editorOptions';

export interface ResourcePanelElements {
  geometryResources: HTMLElement | null;
  materialResources: HTMLElement | null;
  textureResources: HTMLElement | null;
  modelResources: HTMLElement | null;
  prefabResources: HTMLElement | null;
  scriptResources: HTMLElement | null;
  resourceSearchInput?: HTMLInputElement | null;
}

export interface ResourceSelectionState {
  selectedGeometryId: number | null;
  selectedGeometry2DId: number | null;
  selectedMaterialId: number | null;
  selectedMaterial2DId: number | null;
  selectedTextureId: number | null;
  selectedModelId: number | null;
  selectedPrefabId: number | null;
  activeScriptResourceId: number | null;
}

export interface ResourceCardFactories {
  bindListEvents: (list: HTMLElement) => void;
  createImporterCard: (importer: EditorResourceImporter) => HTMLLIElement;
  createGeometryAddCard: () => HTMLLIElement;
  createGeometryCard: (item: ResourcePool['geometries'] extends Map<number, infer T> ? T : never) => HTMLLIElement;
  createGeometry2DCard: (item: ResourcePool['geometries2D'] extends Map<number, infer T> ? T : never) => HTMLLIElement;
  createMaterialAddCard: () => HTMLLIElement;
  createMaterialCard: (item: ResourcePool['materials'] extends Map<number, infer T> ? T : never) => HTMLLIElement;
  createMaterial2DCard: (item: ResourcePool['materials2D'] extends Map<number, infer T> ? T : never) => HTMLLIElement;
  createTextureAddCard: () => HTMLLIElement;
  createTextureCard: (item: ResourcePool['textures'] extends Map<number, infer T> ? T : never) => HTMLLIElement;
  createModelAddCard: () => HTMLLIElement;
  createModelCard: (item: ResourcePool['models'] extends Map<number, infer T> ? T : never) => HTMLLIElement;
  createPrefabCard: (item: ResourcePool['prefabs'] extends Map<number, infer T> ? T : never) => HTMLLIElement;
  createScriptAddCard: () => HTMLLIElement;
  createScriptCard: (item: ResourcePool['scripts'] extends Map<number, infer T> ? T : never) => HTMLLIElement;
}

export interface ResourceRendererDeps {
  elements: ResourcePanelElements;
  resourcePool: ResourcePool;
  resourceImporters: readonly EditorResourceImporter[];
  factories: ResourceCardFactories;
}

interface ResourceRowDescriptor {
  readonly key: string;
  readonly signature: string;
  create(): HTMLLIElement;
}

interface ResourceListState {
  readonly rows: Map<string, { signature: string; element: HTMLLIElement }>;
}

const RESOURCE_NATIVE_VIRTUALIZATION_THRESHOLD = 160;
const resourceListStates = new WeakMap<HTMLElement, ResourceListState>();

export function renderResourceList(
  list: HTMLElement | null,
  getDescriptors: () => readonly ResourceRowDescriptor[],
  emptyText: string,
  changedIds: ReadonlySet<string> = new Set(),
  bindListEvents: (list: HTMLElement) => void = () => {},
): void {
  if (!list || !isActiveResourceList(list)) return;
  bindListEvents(list);
  const descriptors = getDescriptors();
  let state = resourceListStates.get(list);
  if (!state) {
    state = { rows: new Map() };
    resourceListStates.set(list, state);
  }
  const desired = descriptors.length > 0 ? descriptors : [emptyDescriptor(emptyText)];
  const desiredKeys = new Set(desired.map(row => row.key));
  for (const [key, cached] of state.rows) {
    if (desiredKeys.has(key)) continue;
    cached.element.remove();
    state.rows.delete(key);
  }

  let cursor = list.firstChild;
  for (const descriptor of desired) {
    let cached = state.rows.get(descriptor.key);
    if (!cached || cached.signature !== descriptor.signature || changedIds.has(descriptor.key)) {
      const element = descriptor.create();
      element.dataset.resourceKey = descriptor.key;
      if (cached) {
        if (cached.element === cursor) cursor = cursor.nextSibling;
        cached.element.remove();
      }
      cached = { signature: descriptor.signature, element };
      state.rows.set(descriptor.key, cached);
    }
    const element = cached.element;
    if (element === cursor) cursor = cursor.nextSibling;
    else list.insertBefore(element, cursor);
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
  list.classList.toggle('resource-list-virtualized', desired.length >= RESOURCE_NATIVE_VIRTUALIZATION_THRESHOLD);
}

export function renderResourcePool(deps: ResourceRendererDeps): void {
  const { elements, factories, resourcePool, resourceImporters } = deps;
  const changes = resourcePool.consumeChanges();
  const changedIds = new Set<string>([
    ...changes.added,
    ...changes.updated,
    ...changes.removed,
    ...changes.referencesChanged,
  ]);
  const query = elements.resourceSearchInput?.value.trim().toLocaleLowerCase() ?? '';
  const searchable = (descriptors: ResourceRowDescriptor[]): ResourceRowDescriptor[] => query
    ? descriptors.filter(descriptor => !descriptor.key.startsWith('add:')
      && !descriptor.key.startsWith('importer:')
      && `${descriptor.key} ${descriptor.signature}`.toLocaleLowerCase().includes(query))
    : descriptors;
  const importerCards = (target: EditorResourceImporterTarget): ResourceRowDescriptor[] => resourceImporters
    .filter(importer => (importer.target ?? 'model') === target)
    .map(importer => ({
      key: `importer:${target}:${importer.name}`,
      signature: `${importer.label}|${importer.accept}`,
      create: () => factories.createImporterCard(importer),
    }));

  renderResourceList(
    elements.geometryResources,
    () => searchable([
      staticDescriptor('add:geometry', t('resource.create'), factories.createGeometryAddCard),
      ...importerCards('geometry'),
      ...[...resourcePool.geometries.values()].map(item => resourceDescriptor(
        `geometry3d:${item.resource.id}`,
        `${item.name}|${item.refs}|${resourceRevision(item.resource)}|${item.resource.topology}|${item.resource.cullMode}|${item.resource.frontFace}`,
        () => factories.createGeometryCard(item),
      )),
      ...[...resourcePool.geometries2D.values()].map(item => resourceDescriptor(
        `geometry2d:${item.resource.id}`,
        `${item.name}|${item.refs}|${resourceRevision(item.resource)}|${item.resource.topology}`,
        () => factories.createGeometry2DCard(item),
      )),
    ]),
    t('empty.geometriesInUse'),
    changedIds,
    factories.bindListEvents,
  );
  renderResourceList(
    elements.materialResources,
    () => searchable([
      staticDescriptor('add:material', t('resource.create'), factories.createMaterialAddCard),
      ...importerCards('material'),
      ...[...resourcePool.materials.values()].map(item => resourceDescriptor(
        `material3d:${item.resource.id}`,
        `${item.name}|${item.refs}|${resourceRevision(item.resource)}`,
        () => factories.createMaterialCard(item),
      )),
      ...[...resourcePool.materials2D.values()].map(item => resourceDescriptor(
        `material2d:${item.resource.id}`,
        `${item.name}|${item.refs}|${resourceRevision(item.resource)}`,
        () => factories.createMaterial2DCard(item),
      )),
    ]),
    t('empty.materialsInUse'),
    changedIds,
    factories.bindListEvents,
  );
  renderResourceList(
    elements.textureResources,
    () => searchable([
      staticDescriptor('add:texture', t('resource.importTexture'), factories.createTextureAddCard),
      ...importerCards('texture'),
      ...[...resourcePool.textures.values()].map(item => resourceDescriptor(
        `texture:${item.id}`,
        `${item.name}|${item.refs}|${item.status}|${item.previewUrl}|${item.width}|${item.height}|${item.previewError}`,
        () => factories.createTextureCard(item),
      )),
    ]),
    t('empty.texturesInUse'),
    changedIds,
    factories.bindListEvents,
  );
  renderResourceList(
    elements.modelResources,
    () => searchable([
      staticDescriptor('add:model', t('resource.importModel'), factories.createModelAddCard),
      ...importerCards('model'),
      ...[...resourcePool.models.values()].map(item => resourceDescriptor(
        `model:${item.id}`,
        `${item.name}|${item.refs}|${item.status}|${item.previewUrl}|${item.vertexCount}|${item.triangleCount}|${item.previewError}`,
        () => factories.createModelCard(item),
      )),
    ]),
    t('empty.modelsImported'),
    changedIds,
    factories.bindListEvents,
  );
  renderResourceList(
    elements.prefabResources,
    () => searchable([
      ...importerCards('prefab'),
      ...[...resourcePool.prefabs.values()].map(item => resourceDescriptor(
        `prefab:${item.id}`,
        `${item.name}|${item.refs}|${item.status}|${item.revision}|${item.baseRevision}`,
        () => factories.createPrefabCard(item),
      )),
    ]),
    t('empty.prefabsCreated'),
    changedIds,
    factories.bindListEvents,
  );
  renderResourceList(
    elements.scriptResources,
    () => searchable([
      staticDescriptor('add:script', t('resource.newScript'), factories.createScriptAddCard),
      ...importerCards('script'),
      ...[...resourcePool.scripts.values()].map(item => resourceDescriptor(
        `script:${item.id}`,
        `${item.name}|${item.refs}|${item.fileName}|${item.fileSize}`,
        () => factories.createScriptCard(item),
      )),
    ]),
    t('empty.dropJsFiles'),
    changedIds,
    factories.bindListEvents,
  );
}

function isActiveResourceList(list: HTMLElement): boolean {
  const slot = list.getAttribute('slot');
  const tabs = list.parentElement;
  return !slot || !tabs?.hasAttribute('value') || tabs.getAttribute('value') === slot;
}

function resourceDescriptor(key: ResourceAssetId, signature: string, create: () => HTMLLIElement): ResourceRowDescriptor {
  return { key, signature, create };
}

function staticDescriptor(key: string, signature: string, create: () => HTMLLIElement): ResourceRowDescriptor {
  return { key, signature, create };
}

function emptyDescriptor(text: string): ResourceRowDescriptor {
  return {
    key: 'empty',
    signature: text,
    create: () => {
      const empty = document.createElement('li');
      empty.className = 'resource-empty';
      empty.textContent = text;
      return empty;
    },
  };
}

function resourceRevision(resource: object): number {
  const value = resource as { version?: unknown; revision?: unknown };
  return typeof value.version === 'number' ? value.version : typeof value.revision === 'number' ? value.revision : 0;
}

export function refreshResourcePool(resourcePool: ResourcePool, world: World, render: () => void): void {
  resourcePool.syncWorld(world);
  render();
}

export function updateResourceSelectionStates(elements: ResourcePanelElements, state: ResourceSelectionState): void {
  elements.geometryResources?.querySelectorAll<HTMLElement>('[data-geometry-id]').forEach(card => {
    const is2D = card.dataset.geometryKind === '2d';
    const selected = is2D
      ? Number(card.dataset.geometryId) === state.selectedGeometry2DId
      : Number(card.dataset.geometryId) === state.selectedGeometryId;
    card.classList.toggle('selected', selected);
  });
  elements.materialResources?.querySelectorAll<HTMLElement>('[data-material-id]').forEach(card => {
    const is2D = card.dataset.materialKind === '2d';
    const selected = is2D
      ? Number(card.dataset.materialId) === state.selectedMaterial2DId
      : Number(card.dataset.materialId) === state.selectedMaterialId;
    card.classList.toggle('selected', selected);
  });
  elements.textureResources?.querySelectorAll<HTMLElement>('[data-texture-id]').forEach(card => {
    card.classList.toggle('selected', Number(card.dataset.textureId) === state.selectedTextureId);
  });
  elements.modelResources?.querySelectorAll<HTMLElement>('[data-model-id]').forEach(card => {
    card.classList.toggle('selected', Number(card.dataset.modelId) === state.selectedModelId);
  });
  elements.prefabResources?.querySelectorAll<HTMLElement>('[data-prefab-id]').forEach(card => {
    card.classList.toggle('selected', Number(card.dataset.prefabId) === state.selectedPrefabId);
  });
  elements.scriptResources?.querySelectorAll<HTMLElement>('[data-script-id]').forEach(card => {
    card.classList.toggle('selected', Number(card.dataset.scriptId) === state.activeScriptResourceId);
  });
}
