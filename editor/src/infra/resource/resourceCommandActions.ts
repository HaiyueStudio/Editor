import { GltfModelComponent } from '@haiyue/extensions/gltf';
import { BasicMaterial, CartesianTransform3D, ColorSRGB, Entity, Geometry2D, createBox3D, createPlane3D, createSphere3D, type Geometry3D, type HaiyueEngine } from '@haiyue/engine';
import { BlinnPhongMaterial, CssMaterial, DepthMaterial, NormalMaterial, RadialShadowMaterial, ToonMaterial, type CssMaterialStyle, type Material } from '@haiyue/engine/material';
import { ScriptResource, type ScriptComponent, type ScriptLifecycleName } from '@haiyue/engine/components';
import { createCircle2D, createCone3D, createCylinder3D, createIcosahedron3D, createPolygon2D, createRect2D, createRoundedBox3D, createTorus3D, createTriangle2D } from '@haiyue/engine/geometry';
import {
  inspectKtx2Texture,
  type Ktx2TextureInfo,
} from '../../engine-adapter/EditorAssetProtocol';
import type { CommandBus } from '../../commands/CommandBus';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type { EditorRuntimeContext } from '../../domain/store/RuntimeState';
import { serializeEntity } from '../../domain/scene/serialization';
import type { ModelPreviewData } from '../../resources/modelPreview';
import type { ResourcePool } from '../../resources/ResourcePool';
import type {
  Geometry2DResourceItem,
  Geometry3DResourceItem,
  MaterialResourceItem,
  ModelResourceItem,
  PrefabResourceItem,
  ScriptResourceItem,
  TextureResourceItem,
  PreparedResourceImport,
} from '../../types';
import { createImportedGltfSource } from '../file/importedGltfSource';
import { blobToDataUrl } from '../texture/textureSerialization';
import type { WorkflowPrepareContext } from '../../domain/workflows/CoreWorkflowCoordinator';

const MAX_TEXTURE_FILES_PER_IMPORT = 32;
const MAX_TEXTURE_FILE_BYTES = 32 * 1024 * 1024;

export interface ResourceCommandActionDeps {
  getCommandBus: () => CommandBus | null;
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  componentLibraries: EditorComponentLibrary[];
  getDefaultCanvasTextStyle: () => CssMaterialStyle;
  getScriptLifecycleExample: (lifecycle: ScriptLifecycleName) => string;
  getUniqueGeometryName: (baseName: string) => string;
  getUniqueMaterialName: (baseName: string) => string;
  getUniqueScriptName: (baseName: string) => string;
  createModelPreviewData: (src: string) => Promise<ModelPreviewData>;
  bindScriptResourceToActiveScriptComponent: (
    resource: ScriptResource,
  ) => { entity: Entity; component: ScriptComponent; previousResource: ScriptResource | null } | null;
  getActiveScriptResource: () => ScriptResource | null;
  setActiveScriptResource: (resource: ScriptResource | null) => void;
  getRuntimeContext: () => EditorRuntimeContext | null;
  clearGeometrySelectionIf: (id: number) => void;
  clearGeometry2DSelectionIf: (id: number) => void;
  clearMaterialSelectionIf: (id: number) => void;
  clearModelSelectionIf: (id: number) => void;
  clearPrefabSelectionIf: (id: number) => void;
  renderResourcePool: () => void;
  renderActiveInspector: () => void;
  showGeometryDetails: (item: Geometry3DResourceItem) => void;
  showGeometry2DDetails: (item: Geometry2DResourceItem) => void;
  showMaterialDetails: (item: MaterialResourceItem) => void;
  showScriptResourceDetails: (item: ScriptResourceItem) => void;
  showTextureDetails: (item: TextureResourceItem) => void;
  showModelDetails: (item: ModelResourceItem) => void;
  showPrefabDetails: (item: PrefabResourceItem) => void;
  reportError: (message: string, error?: unknown) => void;
}

const rgba = (r: number, g: number, b: number, a = 1) => new ColorSRGB(r, g, b, a);

export function createBasicGeometry(deps: ResourceCommandActionDeps, kind: string): { name: string; resource: Geometry3D } {
  if (kind === 'rounded-box') {
    const resource = createRoundedBox3D({ width: 1.2, height: 1.2, depth: 1.2, radius: 0.18, segments: 4 });
    const name = deps.getUniqueGeometryName('Rounded Box');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'sphere') {
    const resource = createSphere3D({ radius: 0.75, widthSegments: 32, heightSegments: 16 });
    const name = deps.getUniqueGeometryName('Sphere');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'cone') {
    const resource = createCone3D({ radius: 0.75, height: 1.5, radialSegments: 32 });
    const name = deps.getUniqueGeometryName('Cone');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'cylinder') {
    const resource = createCylinder3D({ radiusTop: 0.6, radiusBottom: 0.6, height: 1.4, radialSegments: 32 });
    const name = deps.getUniqueGeometryName('Cylinder');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'torus') {
    const resource = createTorus3D({ radius: 0.55, tube: 0.18, radialSegments: 16, tubularSegments: 48 });
    const name = deps.getUniqueGeometryName('Torus');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'icosahedron') {
    const resource = createIcosahedron3D({ radius: 0.75, detail: 1 });
    const name = deps.getUniqueGeometryName('Icosahedron');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'plane') {
    const resource = createPlane3D({ width: 1.5, height: 1.5 });
    const name = deps.getUniqueGeometryName('Plane');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }

  const resource = createBox3D({ width: 1.2, height: 1.2, depth: 1.2 });
  const name = deps.getUniqueGeometryName('Box');
  deps.resourceDisplayNames.set(resource, name);
  return { name, resource };
}

export function createBasicGeometry2D(deps: ResourceCommandActionDeps, kind: string): { name: string; resource: Geometry2D } {
  if (kind === '2d-circle') {
    const resource = createCircle2D({ radius: 60, segments: 48 });
    const name = deps.getUniqueGeometryName('Circle2D');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === '2d-triangle') {
    const resource = createTriangle2D({ p1: [0, 70], p2: [-70, -55], p3: [70, -55] });
    const name = deps.getUniqueGeometryName('Triangle2D');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === '2d-hexagon') {
    const resource = createPolygon2D({ sides: 6, radius: 70, rotation: Math.PI / 6 });
    const name = deps.getUniqueGeometryName('Hexagon2D');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === '2d-star') {
    const resource = createStar2D(5, 72, 34);
    const name = deps.getUniqueGeometryName('Star2D');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }

  const resource = createRect2D({ width: 120, height: 80 });
  const name = deps.getUniqueGeometryName('Rect2D');
  deps.resourceDisplayNames.set(resource, name);
  return { name, resource };
}

export function addGeometryResource(deps: ResourceCommandActionDeps, kind: string): void {
  if (kind.startsWith('2d-')) {
    const item = createBasicGeometry2D(deps, kind);
    deps.getCommandBus()?.execute({
      label: 'Create Geometry2D',
      execute: () => {
        deps.resourcePool.registerGeometry2D(item.resource, item.name);
        deps.renderResourcePool();
        deps.showGeometry2DDetails({ ...item, refs: 0 });
      },
      undo: () => {
        deps.clearGeometry2DSelectionIf(item.resource.id);
        deps.resourcePool.unregisterGeometry2D(item.resource);
        deps.renderResourcePool();
        deps.renderActiveInspector();
      },
    });
    return;
  }

  const item = createBasicGeometry(deps, kind);
  deps.getCommandBus()?.execute({
    label: 'Create Geometry',
    execute: () => {
      deps.resourcePool.registerGeometry(item.resource, item.name);
      deps.renderResourcePool();
      deps.showGeometryDetails({ ...item, refs: 0 });
    },
    undo: () => {
      deps.clearGeometrySelectionIf(item.resource.id);
      deps.resourcePool.unregisterGeometry(item.resource);
      deps.renderResourcePool();
      deps.renderActiveInspector();
    },
  });
}

function createStar2D(points: number, outerRadius: number, innerRadius: number): Geometry2D {
  const vertexCount = points * 2;
  const positions = new Float32Array((vertexCount + 1) * 2);
  const indices = new Uint16Array(vertexCount * 3);
  positions[0] = 0;
  positions[1] = 0;

  for (let i = 0; i < vertexCount; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (i / vertexCount) * Math.PI * 2;
    positions[(i + 1) * 2] = Math.cos(angle) * radius;
    positions[(i + 1) * 2 + 1] = Math.sin(angle) * radius;
    indices[i * 3] = 0;
    indices[i * 3 + 1] = i + 1;
    indices[i * 3 + 2] = i + 2 > vertexCount ? 1 : i + 2;
  }

  return new Geometry2D(positions, indices);
}

export function createEngineMaterial(deps: ResourceCommandActionDeps, kind: string): { name: string; resource: Material } {
  if (kind === 'css') {
    const resource = new CssMaterial({ text: 'Text', style: deps.getDefaultCanvasTextStyle() });
    const name = deps.getUniqueMaterialName('Css');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'normal') {
    const resource = new NormalMaterial({ space: 'view' });
    const name = deps.getUniqueMaterialName('Normal');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'depth') {
    const resource = new DepthMaterial();
    const name = deps.getUniqueMaterialName('Depth');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'blinn-phong') {
    const resource = new BlinnPhongMaterial({
      ambient: [0.08, 0.08, 0.09, 1],
      diffuse: [0.74, 0.78, 0.84, 1],
      specular: [1, 1, 1, 1],
      shininess: 32,
    });
    const name = deps.getUniqueMaterialName('BlinnPhong');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'radial-shadow') {
    const resource = new RadialShadowMaterial({ color: [0, 0, 0], opacity: 0.28, innerRadius: 0.18 });
    const name = deps.getUniqueMaterialName('RadialShadow');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }
  if (kind === 'toon') {
    const resource = new ToonMaterial();
    const name = deps.getUniqueMaterialName('Toon');
    deps.resourceDisplayNames.set(resource, name);
    return { name, resource };
  }

  const resource = new BasicMaterial({ color: rgba(0.72, 0.78, 0.86) });
  const name = deps.getUniqueMaterialName('Basic');
  deps.resourceDisplayNames.set(resource, name);
  return { name, resource };
}

export function addMaterialResource(deps: ResourceCommandActionDeps, kind: string): void {
  const item = createEngineMaterial(deps, kind);
  deps.getCommandBus()?.execute({
    label: 'Create Material',
    execute: () => {
      deps.resourcePool.registerMaterial(item.resource, item.name);
      deps.renderResourcePool();
      deps.showMaterialDetails({ ...item, refs: 0 });
      deps.renderActiveInspector();
    },
    undo: () => {
      deps.clearMaterialSelectionIf(item.resource.id);
      deps.resourcePool.unregisterMaterial(item.resource);
      deps.renderResourcePool();
      deps.renderActiveInspector();
    },
  });
}

export function addScriptResource(deps: ResourceCommandActionDeps): void {
  const name = deps.getUniqueScriptName('Script');
  const resource = new ScriptResource({
    name,
    scripts: { onUpdate: deps.getScriptLifecycleExample('onUpdate') },
  });
  let item: ScriptResourceItem | null = null;
  let binding: { entity: Entity; component: ScriptComponent; previousResource: ScriptResource | null } | null = null;
  const execute = () => {
    item = deps.resourcePool.registerScript(resource, { name: item?.name ?? resource.name });
    binding = deps.bindScriptResourceToActiveScriptComponent(resource);
    deps.renderResourcePool();
    deps.showScriptResourceDetails(item);
  };
  const undo = () => {
    if (binding) binding.component.resource = binding.previousResource;
    deps.setActiveScriptResource(deps.getActiveScriptResource() === resource ? null : deps.getActiveScriptResource());
    deps.resourcePool.unregisterScript(resource.id);
    deps.renderResourcePool();
    deps.renderActiveInspector();
  };
  const commandBus = deps.getCommandBus();
  if (!commandBus) {
    execute();
    return;
  }
  commandBus.execute({
    label: 'Create Script Resource',
    execute,
    undo,
  });
}

export async function prepareModelFiles(
  deps: ResourceCommandActionDeps,
  files: FileList | File[],
  context: WorkflowPrepareContext,
): Promise<PreparedResourceImport> {
  context.reportProgress({ current: 0, total: 2, message: 'Reading model' });
  const imported = await createImportedGltfSource(files, context.signal);
  context.signal.throwIfAborted();
  let previewData: ModelPreviewData | null = null;
  let previewError: string | undefined;
  try {
    context.reportProgress({ current: 1, total: 2, message: 'Building model preview' });
    previewData = await deps.createModelPreviewData(imported.src);
  } catch (error) {
    previewError = error instanceof Error ? error.message : String(error);
  }
  context.signal.throwIfAborted();
  let item: ModelResourceItem | null = null;
  const execute = () => {
    item = deps.resourcePool.registerModel(imported.src, {
      ...(item === null ? {} : { id: item.id }),
      name: item?.name ?? deps.resourcePool.getUniqueModelName(imported.name),
      fileName: imported.fileName,
      fileType: imported.fileType,
      fileSize: imported.fileSize,
      previewUrl: previewData?.previewUrl,
      vertexCount: previewData?.vertexCount,
      triangleCount: previewData?.triangleCount,
      assetStats: previewData?.assetStats,
      compatibilityReport: previewData?.compatibilityReport,
      previewError,
    });
    deps.renderResourcePool();
    deps.showModelDetails(item);
  };
  const undo = () => {
    if (!item) return;
    deps.clearModelSelectionIf(item.id);
    item.refs = 0;
    deps.resourcePool.unregisterModel(item.id);
    deps.renderResourcePool();
    deps.renderActiveInspector();
  };
  return Object.freeze({
    resourceCount: 1,
    commit() {
      const commandBus = deps.getCommandBus();
      if (commandBus) commandBus.execute({ label: 'Import Model', execute, undo });
      else execute();
    },
    dispose() {},
  });
}

export async function prepareTextureFiles(
  deps: ResourceCommandActionDeps,
  files: FileList | File[],
  context: WorkflowPrepareContext,
): Promise<PreparedResourceImport> {
  const textureFiles: File[] = [];
  let unsupportedCount = 0;
  const oversizedFiles: string[] = [];
  for (const file of Array.from(files)) {
    const isKtx2 = isKtx2File(file);
    if (!file.type.startsWith('image/') && !isKtx2) {
      unsupportedCount++;
      continue;
    }
    if (file.size > MAX_TEXTURE_FILE_BYTES) {
      oversizedFiles.push(file.name);
      continue;
    }
    textureFiles.push(file);
  }
  const importFiles = textureFiles.slice(0, MAX_TEXTURE_FILES_PER_IMPORT);
  const skippedForCount = Math.max(0, textureFiles.length - importFiles.length);
  let skippedMessage: string | undefined;
  const preparationErrors: Array<{ message: string; error: unknown }> = [];
  if (unsupportedCount || oversizedFiles.length || skippedForCount) {
    const parts: string[] = [];
    if (unsupportedCount) parts.push(`${unsupportedCount} unsupported file(s)`);
    if (oversizedFiles.length) parts.push(`${oversizedFiles.length} file(s) over ${Math.round(MAX_TEXTURE_FILE_BYTES / 1024 / 1024)}MiB`);
    if (skippedForCount) parts.push(`${skippedForCount} file(s) over the ${MAX_TEXTURE_FILES_PER_IMPORT} file import limit`);
    skippedMessage = `Some texture files were skipped: ${parts.join(', ')}.`;
  }
  const prepared: Array<
    | {
      kind: 'source';
      resource: Parameters<ResourcePool['registerTexture']>[0];
      options: Parameters<ResourcePool['registerTexture']>[1];
    }
    | {
      kind: 'blob';
      file: File;
      options: Parameters<ResourcePool['registerTexture']>[1];
    }
  > = [];
  for (let index = 0; index < importFiles.length; index++) {
    const file = importFiles[index]!;
    context.signal.throwIfAborted();
    context.reportProgress({ current: index, total: importFiles.length, message: file.name });
    if (isKtx2File(file)) {
      const buffer = await file.arrayBuffer();
      context.signal.throwIfAborted();
      const src = await blobToDataUrl(file, context.signal);
      let info: Ktx2TextureInfo | undefined;
      try {
        info = inspectKtx2Texture(buffer, file.name);
      } catch (error) {
        preparationErrors.push({ message: `Failed to inspect KTX2 texture "${file.name}".`, error });
        continue;
      }
      let preview: { previewUrl?: string; width?: number; height?: number } = {};
      let previewError: string | undefined;
      try {
        const { createKtx2PreviewUrl } = await import('../texture/ktx2Preview');
        preview = await createKtx2PreviewUrl(deps.getRuntimeContext()?.viewportEngine ?? null, buffer, file.name);
      } catch (error) {
        previewError = error instanceof Error ? error.message : String(error);
        preview = {};
      }
      context.signal.throwIfAborted();
      const resource = {
        kind: 'compressed-texture' as const,
        type: 'texture/ktx2',
        src,
      };
      prepared.push({ kind: 'source', resource, options: {
        name: file.name,
        previewUrl: preview.previewUrl,
        width: preview.width ?? info.width,
        height: preview.height ?? info.height,
        fileType: file.type || 'image/ktx2',
        fileSize: file.size,
        compressedInfo: {
          container: 'ktx2',
          vkFormat: info.vkFormat,
          dimension: info.dimension,
          supercompression: info.supercompression,
          gpuFormat: info.gpuFormat,
          ...(info.requiredFeature === undefined ? {} : { requiredFeature: info.requiredFeature }),
          uploadPath: info.uploadPath,
          supportedByBuiltInLoader: info.supportedByBuiltInLoader,
          ...(info.unsupportedReason === undefined ? {} : { unsupportedReason: info.unsupportedReason }),
          depth: info.depth,
          layers: info.layers,
          faces: info.faces,
          levels: info.levels,
        },
        previewError,
        status: 'loading',
      } });
      continue;
    }
    let width: number | undefined;
    let height: number | undefined;
    try {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      width = undefined;
      height = undefined;
    }
    context.signal.throwIfAborted();
    prepared.push({ kind: 'blob', file, options: {
      name: file.name,
      width,
      height,
      fileType: file.type,
      fileSize: file.size,
    } });
  }
  context.reportProgress({ current: importFiles.length, total: importFiles.length });
  const registered: TextureResourceItem[] = [];
  const execute = () => {
    if (skippedMessage) deps.reportError(skippedMessage);
    for (const entry of preparationErrors) deps.reportError(entry.message, entry.error);
    for (const entry of prepared) {
      if (entry.kind === 'source') {
        registered.push(deps.resourcePool.registerTexture(entry.resource, entry.options));
        continue;
      }
      const url = URL.createObjectURL(entry.file);
      registered.push(deps.resourcePool.registerTexture(url, {
        ...entry.options,
        previewUrl: url,
        ownedObjectUrl: url,
      }));
    }
    deps.renderResourcePool();
    const last = registered.at(-1);
    if (last) deps.showTextureDetails(last);
  };
  const undo = () => {
    for (const item of registered.slice().reverse()) deps.resourcePool.unregisterTexture(item.id);
    registered.length = 0;
    deps.renderResourcePool();
    deps.renderActiveInspector();
  };
  return Object.freeze({
    resourceCount: prepared.length,
    commit() {
      const commandBus = deps.getCommandBus();
      if (commandBus) commandBus.execute({ label: 'Import Textures', execute, undo });
      else execute();
    },
    dispose() {},
  });
}

function isKtx2File(file: File): boolean {
  return file.name.toLowerCase().endsWith('.ktx2') || file.type === 'image/ktx2' || file.type === 'application/ktx2';
}

export async function prepareScriptFiles(
  deps: ResourceCommandActionDeps,
  files: FileList | File[],
  context: WorkflowPrepareContext,
): Promise<PreparedResourceImport> {
  const scriptFiles = Array.from(files).filter(file => file.name.toLowerCase().endsWith('.js') || file.type.includes('javascript'));
  const prepared: Array<{ resource: ScriptResource; file: File }> = [];
  for (let index = 0; index < scriptFiles.length; index++) {
    const file = scriptFiles[index]!;
    context.signal.throwIfAborted();
    context.reportProgress({ current: index, total: scriptFiles.length, message: file.name });
    const code = await file.text();
    context.signal.throwIfAborted();
    const name = file.name.replace(/\.js$/i, '') || file.name;
    const resource = new ScriptResource({
      name,
      scripts: { onUpdate: code },
    });
    prepared.push({ resource, file });
  }
  const registered: ScriptResourceItem[] = [];
  const execute = () => {
    for (const { resource, file } of prepared) {
      const item = deps.resourcePool.registerScript(resource, {
        name: resource.name,
        fileName: file.name,
        fileSize: file.size,
      });
      registered.push(item);
      deps.bindScriptResourceToActiveScriptComponent(resource);
    }
    deps.renderResourcePool();
    const last = registered.at(-1);
    if (last) deps.showScriptResourceDetails(last);
  };
  const undo = () => {
    for (const item of registered.slice().reverse()) deps.resourcePool.unregisterScript(item.id);
    registered.length = 0;
    deps.renderResourcePool();
    deps.renderActiveInspector();
  };
  return Object.freeze({
    resourceCount: prepared.length,
    commit() {
      const commandBus = deps.getCommandBus();
      if (commandBus) commandBus.execute({ label: 'Import Scripts', execute, undo });
      else execute();
    },
    dispose() {},
  });
}

export function createPrefabFromModel(deps: ResourceCommandActionDeps, model: ModelResourceItem): void {
  const prefabName = deps.resourcePool.getUniquePrefabName(model.name || 'Model Prefab');
  const entity = new Entity(model.name || 'glTF Model');
  entity.addComponent(new CartesianTransform3D());
  entity.addComponent(new GltfModelComponent({ src: model.src, autoLoad: true, clearPrevious: true }));
  const snapshot = serializeEntity(entity, { includePrefabInstance: false }, deps.componentLibraries);
  let prefabItem: PrefabResourceItem | null = null;
  const execute = () => {
    prefabItem = deps.resourcePool.registerPrefab(snapshot, prefabName, prefabItem?.id);
    deps.renderResourcePool();
    deps.showPrefabDetails(prefabItem);
  };
  const undo = () => {
    if (!prefabItem) return;
    prefabItem.refs = 0;
    deps.resourcePool.unregisterPrefab(prefabItem.id);
    deps.clearPrefabSelectionIf(prefabItem.id);
    deps.renderResourcePool();
    deps.showModelDetails(model);
  };
  const commandBus = deps.getCommandBus();
  if (!commandBus) {
    execute();
    return;
  }
  commandBus.execute({ label: 'Create Model Prefab', execute, undo });
}
