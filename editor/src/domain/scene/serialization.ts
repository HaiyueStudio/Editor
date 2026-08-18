import { BasicMaterial, Component, Entity, Geometry3D, PbrMaterial, World } from '@haiyue/engine';
import { BlinnPhongMaterial, CssMaterial, DepthMaterial, Material, NormalMaterial, RadialShadowMaterial, ToonMaterial } from '@haiyue/engine/material';
import { MeshHelper } from '@haiyue/engine/components';
import { coreComponentSerializationRegistry } from '@haiyue/engine/serialization';
import type {
  SerializedComponent,
  SerializedEditorScene,
  SerializedEntity,
  SerializedGeometry,
  SerializedGlobalSettings,
  SerializedMaterial,
  SerializedSystem,
  SerializedTexture,
} from '../../export/runtimeScene';
import type { ResourcePool } from '../../resources/ResourcePool';
import type { ComponentSerializationExtension, SerializeEntityOptions, TextureResourceItem, TextureSource } from '../../types';
import { PrefabInstanceComponent } from '../../scene/prefabInstance';
import { colorToTuple, colorToVec3, toVec3 } from './tupleUtils';
import { encodeTypedArray } from './typedArraySerialization';
import { measureHierarchyStage } from './hierarchyTransactionMetrics';
import type { ContentAuthoringBundle } from '../content/ContentAuthoringStore';

export interface SerializeEditorSceneOptions {
  resourcePool: ResourcePool;
  globals: SerializedGlobalSettings;
  systems: SerializedSystem[];
  componentExtensions?: ComponentSerializationExtension[];
  cloneGlobalSettings: (settings: SerializedGlobalSettings) => SerializedGlobalSettings;
  cloneSystemConfig: (config: SerializedSystem) => SerializedSystem;
  textureSourceToSerializableUrl: (source: TextureSource) => Promise<SerializedTexture['src']>;
  signal?: AbortSignal;
  authoring?: ContentAuthoringBundle;
}

function isSelectionHelper(component: MeshHelper): boolean {
  const color = colorToTuple(component.color);
  return component.mode === 'aabb'
    && color[0] === 0.25
    && color[1] === 0.75
    && color[2] === 1
    && color[3] === 1;
}

export async function serializeTextureItem(
  item: TextureResourceItem,
  options: Pick<SerializeEditorSceneOptions, 'textureSourceToSerializableUrl' | 'signal'>,
): Promise<SerializedTexture> {
  options.signal?.throwIfAborted();
  const metadata = {
    id: item.id,
    name: item.name,
    previewUrl: item.previewUrl,
    width: item.width,
    height: item.height,
    fileType: item.fileType,
    fileSize: item.fileSize,
    compressedInfo: item.compressedInfo,
    previewError: item.previewError,
  };
  const src = await options.textureSourceToSerializableUrl(item.resource);
  options.signal?.throwIfAborted();
  const previewUrl = typeof src === 'string' ? src : metadata.previewUrl;
  return {
    id: metadata.id,
    name: metadata.name,
    src,
    ...(previewUrl === undefined ? {} : { previewUrl }),
    ...(metadata.width === undefined ? {} : { width: metadata.width }),
    ...(metadata.height === undefined ? {} : { height: metadata.height }),
    ...(metadata.fileType === undefined ? {} : { fileType: metadata.fileType }),
    ...(metadata.fileSize === undefined ? {} : { fileSize: metadata.fileSize }),
    ...(metadata.compressedInfo === undefined ? {} : { compressedInfo: metadata.compressedInfo }),
    ...(metadata.previewError === undefined ? {} : { previewError: metadata.previewError }),
  };
}

export function serializeGeometry(item: { name: string; resource: Geometry3D }): SerializedGeometry {
  const geometry = item.resource;
  return {
    id: geometry.id,
    name: item.name,
    positions: encodeTypedArray(geometry.positions),
    normals: geometry.normals ? encodeTypedArray(geometry.normals) : null,
    textureCoordinates: [...geometry.textureCoordinates].map(([set, data]) => ({
      set,
      data: encodeTypedArray(data),
    })),
    textureCoordinateLayout: [...geometry.textureCoordinateLayout],
    indices: geometry.indices ? encodeTypedArray(geometry.indices) : null,
    indexType: geometry.indices instanceof Uint32Array ? 'uint32' : geometry.indices instanceof Uint16Array ? 'uint16' : null,
    topology: geometry.topology,
    cullMode: geometry.cullMode,
    frontFace: geometry.frontFace,
  };
}

export function serializeMaterial(item: { name: string; resource: Material }, resourcePool: ResourcePool): SerializedMaterial | null {
  const material = item.resource;
  if (material instanceof CssMaterial) {
    return {
      id: material.id,
      name: item.name,
      type: 'CssMaterial',
      text: material.text,
      style: { ...material.style },
      color: colorToTuple(material.color),
      blending: material.blending,
    };
  }
  if (material instanceof BasicMaterial) {
    const textureId = material.texture ? resourcePool.findTextureByResource(material.texture)?.id ?? null : null;
    return {
      id: material.id,
      name: item.name,
      type: 'BasicMaterial',
      color: colorToTuple(material.color),
      blending: material.blending,
      textureId,
    };
  }
  if (material instanceof NormalMaterial) {
    return {
      id: material.id,
      name: item.name,
      type: 'NormalMaterial',
      space: material.space,
    };
  }
  if (material instanceof PbrMaterial) {
    const textureId = (source: PbrMaterial['baseColorTexture']) => source
      ? resourcePool.findTextureByResource(source)?.id ?? null
      : null;
    return {
      id: material.id,
      name: item.name,
      type: 'PbrMaterial',
      baseColor: colorToTuple(material.baseColor),
      metallic: material.metallic,
      roughness: material.roughness,
      baseColorTextureId: textureId(material.baseColorTexture),
      metallicRoughnessTextureId: textureId(material.metallicRoughnessTexture),
      normalTextureId: textureId(material.normalTexture),
      normalScale: material.normalScale,
      occlusionTextureId: textureId(material.occlusionTexture),
      occlusionStrength: material.occlusionStrength,
      emissiveTextureId: textureId(material.emissiveTexture),
      emissiveFactor: [...material.emissiveFactor],
      clearcoatFactor: material.clearcoatFactor,
      clearcoatTextureId: textureId(material.clearcoatTexture),
      clearcoatRoughnessFactor: material.clearcoatRoughnessFactor,
      clearcoatRoughnessTextureId: textureId(material.clearcoatRoughnessTexture),
      clearcoatNormalTextureId: textureId(material.clearcoatNormalTexture),
      clearcoatNormalScale: material.clearcoatNormalScale,
      ior: material.ior,
      specularFactor: material.specularFactor,
      specularColorFactor: [...material.specularColorFactor],
      specularTextureId: textureId(material.specularTexture),
      specularColorTextureId: textureId(material.specularColorTexture),
      sheenColorFactor: [...material.sheenColorFactor],
      sheenRoughnessFactor: material.sheenRoughnessFactor,
      sheenColorTextureId: textureId(material.sheenColorTexture),
      sheenRoughnessTextureId: textureId(material.sheenRoughnessTexture),
      transmissionFactor: material.transmissionFactor,
      transmissionTextureId: textureId(material.transmissionTexture),
      thicknessFactor: material.thicknessFactor,
      thicknessTextureId: textureId(material.thicknessTexture),
      attenuationDistance: Number.isFinite(material.attenuationDistance) ? material.attenuationDistance : null,
      attenuationColor: [...material.attenuationColor],
      alphaMode: material.alphaMode,
      alphaCutoff: material.alphaCutoff,
      doubleSided: material.doubleSided,
    };
  }
  if (material instanceof DepthMaterial) {
    return {
      id: material.id,
      name: item.name,
      type: 'DepthMaterial',
      near: material.near,
      far: material.far,
      isOrthographic: material.isOrthographic,
    };
  }
  if (material instanceof BlinnPhongMaterial) {
    return {
      id: material.id,
      name: item.name,
      type: 'BlinnPhongMaterial',
      ambient: colorToTuple(material.ambient),
      diffuse: colorToTuple(material.diffuse),
      specular: colorToTuple(material.specular),
      shininess: material.shininess,
      blending: material.blending,
    };
  }
  if (material instanceof ToonMaterial) {
    return {
      id: material.id,
      name: item.name,
      type: 'ToonMaterial',
      baseColor: colorToTuple(material.baseColor),
      bandSoftness: material.bandSoftness,
      layers: material.layers.map(layer => ({
        minLight: layer.minLight,
        color: colorToTuple(layer.color),
        textureId: layer.texture ? resourcePool.findTextureByResource(layer.texture)?.id ?? null : null,
        sampler: layer.sampler,
        textureMapping: layer.textureMapping,
      })),
      alphaMode: material.alphaMode,
      doubleSided: material.doubleSided,
    };
  }
  if (material instanceof RadialShadowMaterial) {
    return {
      id: material.id,
      name: item.name,
      type: 'RadialShadowMaterial',
      color: colorToVec3(material.color),
      opacity: material.opacity,
      innerRadius: material.innerRadius,
    };
  }
  return null;
}

export function serializeComponent(
  component: Component,
  options: SerializeEntityOptions = {},
  extensions: ComponentSerializationExtension[] = [],
): SerializedComponent | null {
  if (component instanceof PrefabInstanceComponent) {
    if (options.includePrefabInstance === false) return null;
    return {
      type: 'PrefabInstance',
      prefabId: component.prefabId,
      ...(component.sourceRevision === undefined ? {} : { sourceRevision: component.sourceRevision }),
    };
  }
  if (component instanceof MeshHelper && isSelectionHelper(component)) return null;
  for (const extension of extensions) {
    const serialized = extension.serializeComponent?.(component, options);
    if (serialized) return serialized;
  }
  const coreSerialized = coreComponentSerializationRegistry.serialize(component, {
    encodeFloat32Array: encodeTypedArray,
    encodeIndexArray: encodeTypedArray,
    getGeometryId: geometry => geometry.id,
    getMaterialId: material => material.id,
    getScriptId: script => script.id,
  });
  if (coreSerialized) return coreSerialized as SerializedComponent;
  return null;
}

export function serializeEntity(
  entity: Entity,
  options: SerializeEntityOptions = {},
  extensions: ComponentSerializationExtension[] = [],
): SerializedEntity {
  const ignoredChildren = new Set<Entity>();
  for (const extension of extensions) {
    for (const child of extension.getIgnoredEntityChildren?.(entity) ?? []) {
      ignoredChildren.add(child);
    }
  }
  const skipPrefabInstance = options.excludePrefabInstanceForEntityIds?.has(entity.id) === true;
  return {
    name: entity.name,
    disabled: entity.disabled,
    components: [...entity.components.values()]
      .filter(component => !(skipPrefabInstance && component instanceof PrefabInstanceComponent))
      .map(component => serializeComponent(component, options, extensions))
      .filter((component): component is SerializedComponent => component !== null),
    children: entity.children
      .filter(child => !ignoredChildren.has(child))
      .map(child => serializeEntity(child, options, extensions)),
  };
}

export async function serializeEditorScene(world: World, options: SerializeEditorSceneOptions): Promise<SerializedEditorScene> {
  options.signal?.throwIfAborted();
  // Capture every synchronous field before texture conversion yields, preventing mixed-revision snapshots.
  const texturePromises = [...options.resourcePool.textures.values()].map(item => serializeTextureItem(item, options));
  const captured: SerializedEditorScene = {
    version: 1,
    name: world.name,
    globals: options.cloneGlobalSettings(options.globals),
    systems: options.systems.map(options.cloneSystemConfig),
    resources: {
      geometries: [...options.resourcePool.geometries.values()].map(serializeGeometry),
      materials: [...options.resourcePool.materials.values()]
        .map(item => serializeMaterial(item, options.resourcePool))
        .filter((item): item is SerializedMaterial => item !== null),
      textures: [] as SerializedTexture[],
      models: [...options.resourcePool.models.values()].map(item => ({
        id: item.id,
        name: item.name,
        src: item.src,
        ...(item.fileName === undefined ? {} : { fileName: item.fileName }),
        ...(item.fileType === undefined ? {} : { fileType: item.fileType }),
        ...(item.fileSize === undefined ? {} : { fileSize: item.fileSize }),
        ...(item.previewUrl === undefined ? {} : { previewUrl: item.previewUrl }),
        ...(item.vertexCount === undefined ? {} : { vertexCount: item.vertexCount }),
        ...(item.triangleCount === undefined ? {} : { triangleCount: item.triangleCount }),
        ...(item.assetStats === undefined ? {} : { assetStats: item.assetStats }),
        ...(item.compatibilityReport === undefined ? {} : { compatibilityReport: item.compatibilityReport }),
        ...(item.previewError === undefined ? {} : { previewError: item.previewError }),
      })),
      prefabs: [...options.resourcePool.prefabs.values()].map(item => ({
        id: item.id,
        name: item.name,
        assetKey: item.assetKey,
        root: structuredClone(item.root),
        ...(item.sourceEntityId === undefined ? {} : { sourceEntityId: item.sourceEntityId }),
        revision: item.revision,
        ...(item.basePrefabId === undefined ? {} : { basePrefabId: item.basePrefabId }),
        ...(item.baseRevision === undefined ? {} : { baseRevision: item.baseRevision }),
        ...(item.variantOverrides === undefined ? {} : {
          variantOverrides: item.variantOverrides.map(override => structuredClone(override)),
        }),
      })),
      scripts: [...options.resourcePool.scripts.values()].map(item => ({
        id: item.id,
        name: item.name,
        scripts: { ...item.resource.scripts },
        ...(item.fileName === undefined ? {} : { fileName: item.fileName }),
        ...(item.fileSize === undefined ? {} : { fileSize: item.fileSize }),
      })),
    },
    ...(options.authoring === undefined ? {} : { authoring: structuredClone(options.authoring) }),
    entities: measureHierarchyStage(
      'serialization',
      () => world.rootEntityList.map(entity => serializeEntity(entity, {}, options.componentExtensions)),
    ),
  };
  const textures = await Promise.all(texturePromises);
  options.signal?.throwIfAborted();
  return { ...captured, resources: { ...captured.resources, textures } };
}
