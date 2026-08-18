import { isCompressedTextureSource } from '@haiyue/engine/assets';
import { type ScriptResource } from '@haiyue/engine/components';
import type {
  Geometry2DResourceItem,
  Geometry3DResourceItem,
  EditorResourceImporter,
  Material2DResourceItem,
  MaterialResourceItem,
  ModelResourceItem,
  PrefabResourceItem,
  ScriptResourceItem,
  TextureResourceItem,
} from '../../types';
import type { ResourceCardFactories, ResourceSelectionState } from './resourceRenderer';
import {
  renderGeometry2DIcon,
  renderGeometryIcon,
  renderMaterial2DIcon,
  renderMaterialIcon,
  renderModelIcon,
  renderPrefabIcon,
} from '../../resources/icons';
import { t } from '../options/editorOptions';

export const GEOMETRY_DRAG_MIME = 'application/x-haiyue-geometry-id';
export const GEOMETRY2D_DRAG_MIME = 'application/x-haiyue-geometry2d-id';
export const MESH_DRAG_MIME = 'application/x-haiyue-mesh-id';
export const MATERIAL_DRAG_MIME = 'application/x-haiyue-material-id';
export const MATERIAL2D_DRAG_MIME = 'application/x-haiyue-material2d-id';
export const TEXTURE_DRAG_MIME = 'application/x-haiyue-texture-id';
export const MODEL_DRAG_MIME = 'application/x-haiyue-model-id';
export const PREFAB_DRAG_MIME = 'application/x-haiyue-prefab-id';

export interface ResourceCardCallbacks {
  addGeometryResource: (kind: string) => void;
  showGeometryDetails: (item: Geometry3DResourceItem) => void;
  showGeometry2DDetails: (item: Geometry2DResourceItem) => void;
  addMaterialResource: (kind: string) => void;
  showMaterialDetails: (item: MaterialResourceItem) => void;
  showMaterial2DDetails: (item: Material2DResourceItem) => void;
  addTextureFiles: (files: FileList) => Promise<void>;
  showTextureDetails: (item: TextureResourceItem) => void;
  addModelFiles: (files: FileList) => Promise<void>;
  importResourceFiles: (importer: EditorResourceImporter, files: FileList | File[]) => Promise<void>;
  reportError: (message: string, error?: unknown) => void;
  showModelDetails: (item: ModelResourceItem) => void;
  instantiateModel: (item: ModelResourceItem) => void;
  showPrefabDetails: (item: PrefabResourceItem) => void;
  addScriptResource: () => void;
  showScriptResourceDetails: (item: ScriptResourceItem) => void;
  openScriptResource: (resource: ScriptResource) => void;
}

export interface ResourceCardFactoryDeps {
  getSelectionState: () => ResourceSelectionState;
  callbacks: ResourceCardCallbacks;
}

function createAddMenuCard(
  className: string,
  labelText: string,
  options: ReadonlyArray<readonly [string, string]>,
  onSelect: (kind: string) => void,
): HTMLLIElement {
  const row = document.createElement('li');
  const icon = document.createElement('div');
  const label = document.createElement('div');
  const menu = document.createElement('div');

  row.className = className;
  row.tabIndex = 0;
  icon.className = 'geometry-create-icon';
  icon.textContent = '+';
  label.className = 'resource-name';
  label.textContent = labelText;
  menu.className = 'geometry-create-menu';
  menu.hidden = true;

  for (const [kind, text] of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      row.classList.remove('open');
      onSelect(kind);
    });
    menu.append(button);
  }

  const toggleMenu = () => {
    menu.hidden = !menu.hidden;
    row.classList.toggle('open', !menu.hidden);
  };
  row.addEventListener('click', toggleMenu);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleMenu();
    }
    if (event.key === 'Escape') {
      menu.hidden = true;
      row.classList.remove('open');
    }
  });
  row.append(icon, label, menu);
  return row;
}

function setDragData(event: DragEvent, mimeType: string, id: number, label: string): void {
  event.dataTransfer?.setData(mimeType, String(id));
  if (mimeType === GEOMETRY_DRAG_MIME) event.dataTransfer?.setData(MESH_DRAG_MIME, String(id));
  event.dataTransfer?.setData('text/plain', label);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

interface ResourceCardOptions {
  className: string;
  name: string;
  preview: HTMLElement;
  selected: boolean;
  dataset: Record<string, string>;
  draggable?: boolean;
  drag?: {
    mimeType: string;
    id: number;
    label: string;
  };
  activate: () => void;
  doubleClick?: () => void;
  space?: () => void;
}

interface ResourceCardHandlers {
  activate: () => void;
  doubleClick?: () => void;
  space?: () => void;
  drag?: NonNullable<ResourceCardOptions['drag']>;
}

const resourceCardHandlers = new WeakMap<HTMLElement, ResourceCardHandlers>();
const delegatedResourceLists = new WeakSet<HTMLElement>();

function bindResourceListEvents(list: HTMLElement): void {
  if (delegatedResourceLists.has(list)) return;
  delegatedResourceLists.add(list);
  const getHandlers = (event: Event): ResourceCardHandlers | null => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('li') : null;
    return target ? resourceCardHandlers.get(target) ?? null : null;
  };
  list.addEventListener('click', event => getHandlers(event)?.activate());
  list.addEventListener('dblclick', event => getHandlers(event)?.doubleClick?.());
  list.addEventListener('dragstart', event => {
    const handlers = getHandlers(event);
    if (!handlers?.drag) return;
    setDragData(event, handlers.drag.mimeType, handlers.drag.id, handlers.drag.label);
  });
  list.addEventListener('keydown', event => {
    const handlers = getHandlers(event);
    if (!handlers) return;
    if (event.key === 'Enter') handlers.activate();
    if (event.key === ' ') {
      event.preventDefault();
      (handlers.space ?? handlers.activate)();
    }
  });
}

function createResourceCard(options: ResourceCardOptions): HTMLLIElement {
  const row = document.createElement('li');
  const name = document.createElement('div');
  row.className = options.className;
  row.classList.toggle('selected', options.selected);
  for (const [key, value] of Object.entries(options.dataset)) {
    row.dataset[key] = value;
  }
  row.draggable = options.draggable === true;
  row.tabIndex = 0;
  name.className = 'resource-name';
  name.textContent = options.name;
  row.append(options.preview, name);
  resourceCardHandlers.set(row, {
    activate: options.activate,
    ...(options.doubleClick === undefined ? {} : { doubleClick: options.doubleClick }),
    ...(options.space === undefined ? {} : { space: options.space }),
    ...(options.drag === undefined ? {} : { drag: options.drag }),
  });
  return row;
}

const IMPORTER_CARD_CLASS_BY_TARGET: Record<NonNullable<EditorResourceImporter['target']>, string> = {
  geometry: 'geometry-card',
  material: 'material-card',
  texture: 'texture-card',
  model: 'prefab-card model-card',
  prefab: 'prefab-card',
  script: 'prefab-card script-card',
};

function getImporterCardClass(importer: EditorResourceImporter): string {
  return `${IMPORTER_CARD_CLASS_BY_TARGET[importer.target ?? 'model']} geometry-create-card`;
}

function getImporterIcon(importer: EditorResourceImporter): string {
  return importer.name.trim().slice(0, 4).toUpperCase() || '+';
}

export function createResourceCardFactories(deps: ResourceCardFactoryDeps): ResourceCardFactories {
  const { callbacks, getSelectionState } = deps;

  return {
    bindListEvents: bindResourceListEvents,
    createImporterCard: (importer: EditorResourceImporter) => {
      const row = document.createElement('li');
      const icon = document.createElement('div');
      const label = document.createElement('div');
      const input = document.createElement('input');

      row.className = getImporterCardClass(importer);
      row.tabIndex = 0;
      icon.className = 'geometry-create-icon';
      icon.textContent = getImporterIcon(importer);
      label.className = 'resource-name';
      label.textContent = importer.label;
      input.type = 'file';
      input.accept = importer.accept;
      input.multiple = true;
      input.hidden = true;

      const openFilePicker = () => input.click();
      row.addEventListener('click', openFilePicker);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openFilePicker();
        }
      });
      input.addEventListener('click', event => event.stopPropagation());
      input.addEventListener('change', () => {
        if (input.files?.length) {
          void callbacks.importResourceFiles(importer, input.files).catch((error) => {
            callbacks.reportError(`Failed to import ${importer.label}.`, error);
          });
        }
        input.value = '';
      });

      row.append(icon, label, input);
      return row;
    },
    createGeometryAddCard: () => createAddMenuCard(
      'geometry-card geometry-create-card',
      t('resource.create'),
      [
        ['box', t('resource.box')],
        ['rounded-box', t('resource.roundedBox')],
        ['sphere', t('resource.sphere')],
        ['cone', t('resource.cone')],
        ['cylinder', t('resource.cylinder')],
        ['torus', t('resource.torus')],
        ['icosahedron', t('resource.icosahedron')],
        ['plane', t('resource.plane')],
        ['2d-rect', t('resource.rect2D')],
        ['2d-circle', t('resource.circle2D')],
        ['2d-triangle', t('resource.triangle2D')],
        ['2d-hexagon', t('resource.hexagon2D')],
        ['2d-star', t('resource.star2D')],
      ],
      callbacks.addGeometryResource,
    ),
    createGeometryCard: (item: Geometry3DResourceItem) => {
      return createResourceCard({
        className: 'geometry-card',
        name: item.name,
        preview: renderGeometryIcon(item.resource),
        selected: getSelectionState().selectedGeometryId === item.resource.id,
        dataset: { geometryId: String(item.resource.id), geometryKind: '3d' },
        draggable: true,
        drag: { mimeType: GEOMETRY_DRAG_MIME, id: item.resource.id, label: item.name },
        activate: () => callbacks.showGeometryDetails(item),
      });
    },
    createGeometry2DCard: (item: Geometry2DResourceItem) => {
      return createResourceCard({
        className: 'geometry-card',
        name: item.name,
        preview: renderGeometry2DIcon(item.resource),
        selected: getSelectionState().selectedGeometry2DId === item.resource.id,
        dataset: { geometryId: String(item.resource.id), geometryKind: '2d' },
        draggable: true,
        drag: { mimeType: GEOMETRY2D_DRAG_MIME, id: item.resource.id, label: item.name },
        activate: () => callbacks.showGeometry2DDetails(item),
      });
    },
    createMaterialAddCard: () => createAddMenuCard(
      'material-card geometry-create-card',
      t('resource.create'),
      [
        ['basic', t('resource.basic')],
        ['css', t('resource.css')],
        ['normal', t('resource.normal')],
        ['depth', t('resource.depth')],
        ['blinn-phong', t('resource.blinnPhong')],
        ['toon', t('resource.toon')],
        ['radial-shadow', t('resource.radialShadow')],
      ],
      callbacks.addMaterialResource,
    ),
    createMaterialCard: (item: MaterialResourceItem) => {
      return createResourceCard({
        className: 'material-card',
        name: item.name,
        preview: renderMaterialIcon(item.resource),
        selected: getSelectionState().selectedMaterialId === item.resource.id,
        dataset: { materialId: String(item.resource.id), materialKind: '3d' },
        draggable: true,
        drag: { mimeType: MATERIAL_DRAG_MIME, id: item.resource.id, label: item.name },
        activate: () => callbacks.showMaterialDetails(item),
      });
    },
    createMaterial2DCard: (item: Material2DResourceItem) => {
      return createResourceCard({
        className: 'material-card',
        name: item.name,
        preview: renderMaterial2DIcon(item.resource),
        selected: getSelectionState().selectedMaterial2DId === item.resource.id,
        dataset: { materialId: String(item.resource.id), materialKind: '2d' },
        draggable: true,
        drag: { mimeType: MATERIAL2D_DRAG_MIME, id: item.resource.id, label: item.name },
        activate: () => callbacks.showMaterial2DDetails(item),
      });
    },
    createTextureAddCard: () => {
      const row = document.createElement('li');
      const icon = document.createElement('div');
      const label = document.createElement('div');
      const input = document.createElement('input');

      row.className = 'texture-card geometry-create-card';
      row.tabIndex = 0;
      icon.className = 'geometry-create-icon';
      icon.textContent = '+';
      label.className = 'resource-name';
      label.textContent = t('resource.importTexture');
      input.type = 'file';
      input.accept = 'image/*,.ktx2,image/ktx2';
      input.multiple = true;
      input.hidden = true;

      const openFilePicker = () => input.click();
      row.addEventListener('click', openFilePicker);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openFilePicker();
        }
      });
      input.addEventListener('click', event => event.stopPropagation());
      input.addEventListener('change', () => {
        if (input.files?.length) void callbacks.addTextureFiles(input.files);
        input.value = '';
      });

      row.append(icon, label, input);
      return row;
    },
    createTextureCard: (item: TextureResourceItem) => {
      let preview: HTMLElement;
      if (isCompressedTextureSource(item.resource) && !item.previewUrl) {
        const icon = document.createElement('div');
        icon.className = 'geometry-create-icon';
        icon.textContent = formatCompressedTextureBadge(item);
        icon.title = formatCompressedTextureTitle(item);
        preview = icon;
      } else {
        const image = document.createElement('img');
        image.alt = item.name;
        image.src = item.previewUrl ?? (typeof item.resource === 'string' ? item.resource : '');
        preview = image;
      }
      return createResourceCard({
        className: 'texture-card',
        name: item.name,
        preview,
        selected: getSelectionState().selectedTextureId === item.id,
        dataset: { textureId: String(item.id) },
        draggable: true,
        drag: { mimeType: TEXTURE_DRAG_MIME, id: item.id, label: item.name },
        activate: () => callbacks.showTextureDetails(item),
      });
    },
    createModelAddCard: () => {
      const row = document.createElement('li');
      const icon = document.createElement('div');
      const label = document.createElement('div');
      const menu = document.createElement('div');
      const fileInput = document.createElement('input');
      const folderInput = document.createElement('input');

      row.className = 'prefab-card model-card geometry-create-card';
      row.tabIndex = 0;
      icon.className = 'geometry-create-icon';
      icon.textContent = '+';
      label.className = 'resource-name';
      label.textContent = t('resource.importModel');
      menu.className = 'geometry-create-menu';
      menu.hidden = true;

      for (const input of [fileInput, folderInput]) {
        input.type = 'file';
        input.accept = '.gltf,.glb,.bin,image/*,application/json,model/gltf+json,model/gltf-binary';
        input.multiple = true;
        input.hidden = true;
        input.addEventListener('click', event => event.stopPropagation());
        input.addEventListener('change', () => {
          if (input.files?.length) {
            void callbacks.addModelFiles(input.files).catch((error) => {
              callbacks.reportError('Failed to import model.', error);
            });
          }
          input.value = '';
        });
      }
      folderInput.setAttribute('webkitdirectory', '');
      folderInput.setAttribute('directory', '');

      const fileButton = document.createElement('button');
      fileButton.type = 'button';
      fileButton.textContent = t('resource.files');
      fileButton.addEventListener('click', (event) => {
        event.stopPropagation();
        menu.hidden = true;
        row.classList.remove('open');
        fileInput.click();
      });

      const folderButton = document.createElement('button');
      folderButton.type = 'button';
      folderButton.textContent = t('resource.folder');
      folderButton.addEventListener('click', (event) => {
        event.stopPropagation();
        menu.hidden = true;
        row.classList.remove('open');
        folderInput.click();
      });
      menu.append(fileButton, folderButton);

      const toggleMenu = () => {
        menu.hidden = !menu.hidden;
        row.classList.toggle('open', !menu.hidden);
      };
      row.addEventListener('click', toggleMenu);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleMenu();
        }
        if (event.key === 'Escape') {
          menu.hidden = true;
          row.classList.remove('open');
        }
      });

      row.append(icon, label, menu, fileInput, folderInput);
      return row;
    },
    createModelCard: (item: ModelResourceItem) => {
      const preview = item.previewUrl ? document.createElement('img') : renderModelIcon();
      if (preview instanceof HTMLImageElement) {
        preview.alt = item.name;
        preview.src = item.previewUrl!;
      }
      return createResourceCard({
        className: 'prefab-card model-card',
        name: item.name,
        preview,
        selected: getSelectionState().selectedModelId === item.id,
        dataset: { modelId: String(item.id) },
        draggable: true,
        drag: { mimeType: MODEL_DRAG_MIME, id: item.id, label: item.name },
        activate: () => callbacks.showModelDetails(item),
        doubleClick: () => callbacks.instantiateModel(item),
        space: () => callbacks.instantiateModel(item),
      });
    },
    createPrefabCard: (item: PrefabResourceItem) => {
      return createResourceCard({
        className: 'prefab-card',
        name: item.name,
        preview: renderPrefabIcon(item),
        selected: getSelectionState().selectedPrefabId === item.id,
        dataset: { prefabId: String(item.id) },
        draggable: true,
        drag: { mimeType: PREFAB_DRAG_MIME, id: item.id, label: item.name },
        activate: () => callbacks.showPrefabDetails(item),
      });
    },
    createScriptAddCard: () => {
      const row = document.createElement('li');
      const icon = document.createElement('div');
      const label = document.createElement('div');

      row.className = 'prefab-card script-card geometry-create-card';
      row.tabIndex = 0;
      icon.className = 'geometry-create-icon';
      icon.textContent = '+';
      label.className = 'resource-name';
      label.textContent = t('resource.newScript');

      row.addEventListener('click', callbacks.addScriptResource);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          callbacks.addScriptResource();
        }
      });
      row.append(icon, label);
      return row;
    },
    createScriptCard: (item: ScriptResourceItem) => {
      const icon = document.createElement('div');
      icon.className = 'geometry-create-icon';
      icon.textContent = 'JS';
      return createResourceCard({
        className: 'prefab-card script-card',
        name: item.name,
        preview: icon,
        selected: getSelectionState().activeScriptResourceId === item.resource.id,
        dataset: { scriptId: String(item.resource.id) },
        activate: () => callbacks.showScriptResourceDetails(item),
        doubleClick: () => callbacks.openScriptResource(item.resource),
        space: () => callbacks.openScriptResource(item.resource),
      });
    },
  };
}

function formatCompressedTextureBadge(item: TextureResourceItem): string {
  const info = item.compressedInfo;
  if (!info) return 'KTX2';
  const dimension = info.dimension && info.dimension !== '2d' ? ` ${info.dimension.toUpperCase()}` : '';
  return `${info.container.toUpperCase()}${dimension}`;
}

function formatCompressedTextureTitle(item: TextureResourceItem): string {
  const info = item.compressedInfo;
  if (!info) return item.name;
  const parts = [
    item.name,
    info.dimension,
    info.supercompression,
    info.gpuFormat ?? info.uploadPath,
    info.unsupportedReason,
    item.previewError ? `Preview: ${item.previewError}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}
