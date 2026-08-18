import { Entity, Geometry3D, World } from '@haiyue/engine';
import { Material } from '@haiyue/engine/material';
import { ScriptResource } from '@haiyue/engine/components';
import type {
  RuntimeExportResult,
  SerializedEditorScene,
  SerializedEntity,
  SerializedGeometry,
  SerializedGlobalSettings,
  SerializedMaterial,
  SerializedModel,
  SerializedPrefab,
  SerializedScript,
  SerializedTexture,
  SerializedSystem,
} from '../../export/runtimeScene';
import { exportRuntimeSceneFromEditorScene } from '../../export/runtimeScene';
import type { ResourcePool } from '../../resources/ResourcePool';
import type { ComponentDeserializationExtension, ComponentSerializationExtension, TextureSource } from '../../types';
import { cloneGlobalSettings, normalizeGlobalSettings } from '../settings/globalSettings';
import { cloneSystemConfig, normalizeSystemConfigs } from '../../scene/systemConfig';
import { serializeEditorScene as serializeEditorSceneData } from './serialization';
import {
  deserializeEntity,
  deserializeGeometry,
  deserializeMaterial,
  deserializeScriptResource,
  remapSerializedEntityScriptIds,
  validateSerializedEditorScene,
} from './deserialization';
import type { ContentAuthoringBundle, ContentAuthoringStore } from '../content/ContentAuthoringStore';

export interface SerializeEditorSceneDeps {
  resourcePool: ResourcePool;
  globals: SerializedGlobalSettings;
  systems: SerializedSystem[];
  componentExtensions?: ComponentSerializationExtension[];
  refreshResourcePool: (world: World) => void;
  textureSourceToSerializableUrl: (source: TextureSource) => Promise<SerializedTexture['src']>;
  authoring?: Pick<ContentAuthoringStore, 'snapshot'>;
}

export interface SceneSerializationContext {
  readonly signal?: AbortSignal;
}

export interface PrepareEditorSceneContext extends SceneSerializationContext {
  readonly rootsPerYield?: number;
  readonly reportProgress?: (current: number, total: number) => void;
}

export interface LoadEditorSceneDeps {
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  componentExtensions?: ComponentDeserializationExtension[];
  refreshResourcePool: (world: World) => void;
  authoring?: Pick<ContentAuthoringStore, 'load'>;
}

export interface LoadedEditorScene {
  firstEntity: Entity | null;
  globals: SerializedGlobalSettings;
  systems: SerializedSystem[];
}

export interface PreparedEditorScene {
  readonly source: SerializedEditorScene;
  readonly globals: SerializedGlobalSettings;
  readonly systems: SerializedSystem[];
  readonly textures: ReadonlyArray<{ readonly data: SerializedTexture; readonly resource: TextureSource }>;
  readonly models: readonly SerializedModel[];
  readonly geometries: ReadonlyArray<{ readonly data: SerializedGeometry; readonly resource: Geometry3D }>;
  readonly materials: ReadonlyArray<{ readonly data: SerializedMaterial; readonly resource: Material }>;
  readonly scripts: ReadonlyArray<{ readonly data: SerializedScript; readonly resource: ScriptResource }>;
  readonly prefabs: ReadonlyArray<{ readonly data: SerializedPrefab; readonly root: SerializedEntity }>;
  readonly roots: readonly Entity[];
}

export async function serializeEditorScene(
  world: World,
  deps: SerializeEditorSceneDeps,
  context: SceneSerializationContext = {},
): Promise<SerializedEditorScene> {
  context.signal?.throwIfAborted();
  deps.refreshResourcePool(world);
  return serializeEditorSceneData(world, {
    resourcePool: deps.resourcePool,
    globals: deps.globals,
    systems: deps.systems,
    ...(deps.componentExtensions === undefined ? {} : { componentExtensions: deps.componentExtensions }),
    cloneGlobalSettings,
    cloneSystemConfig,
    textureSourceToSerializableUrl: deps.textureSourceToSerializableUrl,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(deps.authoring === undefined ? {} : { authoring: deps.authoring.snapshot() }),
  });
}

export async function exportRuntimeScene(
  world: World,
  deps: SerializeEditorSceneDeps,
  context: SceneSerializationContext = {},
): Promise<RuntimeExportResult> {
  const editorScene = await serializeEditorScene(world, deps, context);
  context.signal?.throwIfAborted();
  return exportRuntimeSceneFromEditorScene(editorScene);
}

export function prepareEditorScene(
  data: SerializedEditorScene,
  componentExtensions: ComponentDeserializationExtension[] = [],
): PreparedEditorScene {
  const resources = prepareEditorSceneResources(data);
  const roots = data.entities.map(entityData => deserializeEntity(
    entityData,
    resources.geometryMap,
    resources.materialMap,
    resources.scriptMap,
    componentExtensions,
  ));
  return finishPreparedEditorScene(data, resources, roots);
}

export async function prepareEditorSceneAsync(
  data: SerializedEditorScene,
  componentExtensions: ComponentDeserializationExtension[] = [],
  context: PrepareEditorSceneContext = {},
): Promise<PreparedEditorScene> {
  const resources = prepareEditorSceneResources(data);
  const roots: Entity[] = [];
  const rootsPerYield = Math.max(1, Math.floor(context.rootsPerYield ?? 8));
  for (let index = 0; index < data.entities.length; index++) {
    context.signal?.throwIfAborted();
    const entityData = data.entities[index];
    if (entityData) {
      roots.push(deserializeEntity(
        entityData,
        resources.geometryMap,
        resources.materialMap,
        resources.scriptMap,
        componentExtensions,
      ));
    }
    context.reportProgress?.(index + 1, data.entities.length);
    if ((index + 1) % rootsPerYield === 0 && index + 1 < data.entities.length) {
      await yieldEditorTask();
    }
  }
  context.signal?.throwIfAborted();
  return finishPreparedEditorScene(data, resources, roots);
}

export function loadPreparedEditorScene(
  world: World,
  prepared: PreparedEditorScene,
  deps: LoadEditorSceneDeps,
): LoadedEditorScene {
  const data = prepared.source;
  validateSerializedEditorScene(data);

  measureSceneLoadStage('clear-world', () => {
    for (const entity of [...world.rootEntityList]) world.removeEntity(entity);
  });
  world.name = data.name || 'Scene';
  deps.resourcePool.clear();
  deps.authoring?.load(data.authoring as ContentAuthoringBundle | undefined);

  for (const { data: textureData, resource } of prepared.textures) {
    const previewUrl = typeof resource === 'string'
      ? textureData.previewUrl ?? resource
      : textureData.previewUrl;
    deps.resourcePool.registerTexture(resource, {
      name: textureData.name,
      previewUrl,
      width: textureData.width,
      height: textureData.height,
      fileType: textureData.fileType,
      fileSize: textureData.fileSize,
      compressedInfo: textureData.compressedInfo,
      previewError: textureData.previewError,
    });
  }

  for (const modelData of prepared.models) {
    if (!modelData.src) continue;
    deps.resourcePool.registerModel(modelData.src, {
      id: modelData.id,
      name: modelData.name,
      fileName: modelData.fileName,
      fileType: modelData.fileType,
      fileSize: modelData.fileSize,
      previewUrl: modelData.previewUrl,
      vertexCount: modelData.vertexCount,
      triangleCount: modelData.triangleCount,
      assetStats: modelData.assetStats,
      compatibilityReport: modelData.compatibilityReport,
      previewError: modelData.previewError,
    });
  }

  for (const { data: geometryData, resource } of prepared.geometries) {
    deps.resourceDisplayNames.set(resource, geometryData.name);
    deps.resourcePool.registerGeometry(resource, geometryData.name);
  }

  for (const { data: materialData, resource } of prepared.materials) {
    deps.resourceDisplayNames.set(resource, materialData.name);
    deps.resourcePool.registerMaterial(resource, materialData.name);
  }

  for (const { data: scriptData, resource } of prepared.scripts) {
    deps.resourceDisplayNames.set(resource, scriptData.name);
    deps.resourcePool.registerScript(resource, {
      name: scriptData.name,
      ...(scriptData.fileName === undefined ? {} : { fileName: scriptData.fileName }),
      ...(scriptData.fileSize === undefined ? {} : { fileSize: scriptData.fileSize }),
    });
  }

  for (const { data: prefabData, root } of prepared.prefabs) {
    deps.resourcePool.registerPrefab(
      root,
      prefabData.name,
      prefabData.id,
      {
        ...(prefabData.sourceEntityId === undefined ? {} : { sourceEntityId: prefabData.sourceEntityId }),
        ...(prefabData.revision === undefined ? {} : { revision: prefabData.revision }),
        ...(prefabData.basePrefabId === undefined ? {} : { basePrefabId: prefabData.basePrefabId }),
        ...(prefabData.baseRevision === undefined ? {} : { baseRevision: prefabData.baseRevision }),
        ...(prefabData.variantOverrides === undefined ? {} : { variantOverrides: prefabData.variantOverrides }),
      },
    );
  }

  measureSceneLoadStage('attach-world', () => {
    for (const entity of prepared.roots) world.addEntity(entity);
  });
  measureSceneLoadStage('refresh-resources', () => deps.refreshResourcePool(world));

  return {
    firstEntity: world.rootEntityList[0] ?? null,
    globals: prepared.globals,
    systems: prepared.systems,
  };
}

export function loadEditorScene(world: World, data: SerializedEditorScene, deps: LoadEditorSceneDeps): LoadedEditorScene {
  return loadPreparedEditorScene(
    world,
    prepareEditorScene(data, deps.componentExtensions),
    deps,
  );
}

interface PreparedSceneResources {
  textures: Array<{ data: SerializedTexture; resource: TextureSource }>;
  models: SerializedModel[];
  geometries: Array<{ data: SerializedGeometry; resource: Geometry3D }>;
  materials: Array<{ data: SerializedMaterial; resource: Material }>;
  scripts: Array<{ data: SerializedScript; resource: ScriptResource }>;
  prefabs: Array<{ data: SerializedPrefab; root: SerializedEntity }>;
  geometryMap: Map<number, Geometry3D>;
  materialMap: Map<number, Material>;
  scriptMap: Map<number, ScriptResource>;
}

function prepareEditorSceneResources(data: SerializedEditorScene): PreparedSceneResources {
  validateSerializedEditorScene(data);
  const textures = (data.resources.textures ?? [])
    .filter((texture): texture is SerializedTexture & { src: TextureSource } => texture.src !== null)
    .map(texture => ({ data: texture, resource: texture.src }));
  const textureMap = new Map(textures.map(({ data: texture, resource }) => [texture.id, resource]));
  const geometries = data.resources.geometries.map(geometry => ({
    data: geometry,
    resource: deserializeGeometry(geometry),
  }));
  const geometryMap = new Map(geometries.map(({ data: geometry, resource }) => [geometry.id, resource]));
  const materials = data.resources.materials.map(material => ({
    data: material,
    resource: deserializeMaterial(material, textureMap),
  }));
  const materialMap = new Map(materials.map(({ data: material, resource }) => [material.id, resource]));
  const scripts = data.resources.scripts.map(script => ({
    data: script,
    resource: deserializeScriptResource(script),
  }));
  const scriptMap = new Map<number, ScriptResource>();
  for (const { data: script, resource } of scripts) {
    scriptMap.set(script.id, resource);
    scriptMap.set(resource.id, resource);
  }
  const prefabs = data.resources.prefabs.map(prefab => ({
    data: prefab,
    root: remapSerializedEntityScriptIds(prefab.root, scriptMap),
  }));
  return {
    textures,
    models: [...(data.resources.models ?? [])],
    geometries,
    materials,
    scripts,
    prefabs,
    geometryMap,
    materialMap,
    scriptMap,
  };
}

function finishPreparedEditorScene(
  source: SerializedEditorScene,
  resources: PreparedSceneResources,
  roots: Entity[],
): PreparedEditorScene {
  return Object.freeze({
    source,
    globals: normalizeGlobalSettings(source.globals),
    systems: normalizeSystemConfigs(source.systems),
    textures: resources.textures,
    models: resources.models,
    geometries: resources.geometries,
    materials: resources.materials,
    scripts: resources.scripts,
    prefabs: resources.prefabs,
    roots,
  });
}

async function yieldEditorTask(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

function measureSceneLoadStage<T>(stage: string, task: () => T): T {
  const startedAt = performance.now();
  try {
    return task();
  } finally {
    performance.measure(`editor.open.${stage}`, {
      start: startedAt,
      duration: performance.now() - startedAt,
    });
  }
}
