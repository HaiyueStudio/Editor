import { BasicMaterial, Component, Entity, EngineError, EngineErrorCode, Geometry3D, Mesh3D, PbrMaterial } from '@haiyue/engine';
import { BlinnPhongMaterial, CssMaterial, DepthMaterial, Material, NormalMaterial, RadialShadowMaterial, ToonMaterial } from '@haiyue/engine/material';
import { ErrorDomain, ErrorRecovery } from '@haiyue/engine/core';
import { ScriptResource } from '@haiyue/engine/components';
import {
  coreComponentSerializationRegistry,
  type CoreSerializedComponent,
} from '@haiyue/engine/serialization';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import type {
  SerializedComponent,
  SerializedEditorScene,
  SerializedEntity,
  SerializedGeometry,
  SerializedMaterial,
  SerializedScript,
} from '../../export/runtimeScene';
import type { ResourcePool } from '../../resources/ResourcePool';
import type { ComponentDeserializationExtension, TextureSource } from '../../types';
import { PrefabInstanceComponent } from '../../scene/prefabInstance';
import { findModelCompatibilityReportError } from '../resource/modelCompatibility';
import { parseContentAuthoringBundle } from '../content/ContentAuthoringStore';
import { decodeFloat32Array, decodeIndexArray } from './typedArraySerialization';

export interface DeserializationResourceOptions {
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
}

export interface ComponentDeserializationOptions {
  deserializePrefabInstances?: boolean;
  extensions?: ComponentDeserializationExtension[];
}

function registerDeserializedResource(options: DeserializationResourceOptions | undefined, resource: object, name: string): void {
  options?.resourceDisplayNames.set(resource, name);
}

export function deserializeScriptResource(data: SerializedScript, options?: DeserializationResourceOptions): ScriptResource {
  const resource = new ScriptResource({
    name: data.name,
    scripts: data.scripts,
  });
  options?.resourceDisplayNames.set(resource, data.name);
  options?.resourcePool.registerScript(resource, {
    name: data.name,
    ...(data.fileName === undefined ? {} : { fileName: data.fileName }),
    ...(data.fileSize === undefined ? {} : { fileSize: data.fileSize }),
  });
  return resource;
}

export function remapSerializedEntityScriptIds(entity: SerializedEntity, scriptMap: Map<number, ScriptResource>): SerializedEntity {
  return {
    ...entity,
    components: entity.components.map(component => {
      if (component.type !== 'ScriptComponent' || component.scriptId == null) return component;
      return {
        ...component,
        scriptId: scriptMap.get(component.scriptId)?.id ?? component.scriptId,
      };
    }),
    children: entity.children.map(child => remapSerializedEntityScriptIds(child, scriptMap)),
  };
}

export function deserializeGeometry(data: SerializedGeometry, options?: DeserializationResourceOptions): Geometry3D {
  const geometry = new Geometry3D({
    positions: decodeFloat32Array(data.positions),
    ...(data.normals ? { normals: decodeFloat32Array(data.normals) } : {}),
    textureCoordinates: data.textureCoordinates.map(entry => ({
      set: entry.set,
      data: decodeFloat32Array(entry.data),
    })),
    textureCoordinateLayout: data.textureCoordinateLayout,
    ...(data.indices ? { indices: decodeIndexArray(data.indices, data.indexType) } : {}),
    ...(data.topology == null ? {} : { topology: data.topology }),
    ...(data.cullMode == null ? {} : { cullMode: data.cullMode }),
    ...(data.frontFace == null ? {} : { frontFace: data.frontFace }),
  });
  registerDeserializedResource(options, geometry, data.name);
  options?.resourcePool.registerGeometry(geometry, data.name);
  return geometry;
}

export function deserializeMaterial(
  data: SerializedMaterial,
  textureMap: Map<number, TextureSource>,
  options?: DeserializationResourceOptions,
): Material {
  let material: Material;
  if (data.type === 'CssMaterial') {
    material = new CssMaterial({
      text: data.text,
      style: data.style,
      color: data.color,
      blending: data.blending,
    });
  } else if (data.type === 'NormalMaterial') {
    material = new NormalMaterial({ space: data.space });
  } else if (data.type === 'DepthMaterial') {
    material = new DepthMaterial({
      near: data.near,
      far: data.far,
      isOrthographic: data.isOrthographic,
    });
  } else if (data.type === 'BlinnPhongMaterial') {
    material = new BlinnPhongMaterial({
      ambient: data.ambient,
      diffuse: data.diffuse,
      specular: data.specular,
      shininess: data.shininess,
      blending: data.blending,
    });
  } else if (data.type === 'PbrMaterial') {
    material = new PbrMaterial({
      baseColor: data.baseColor,
      metallic: data.metallic,
      roughness: data.roughness,
      baseColorTexture: data.baseColorTextureId === null ? null : textureMap.get(data.baseColorTextureId) ?? null,
      metallicRoughnessTexture: data.metallicRoughnessTextureId === null ? null : textureMap.get(data.metallicRoughnessTextureId) ?? null,
      normalTexture: data.normalTextureId === null ? null : textureMap.get(data.normalTextureId) ?? null,
      normalScale: data.normalScale,
      occlusionTexture: data.occlusionTextureId === null ? null : textureMap.get(data.occlusionTextureId) ?? null,
      occlusionStrength: data.occlusionStrength,
      emissiveTexture: data.emissiveTextureId === null ? null : textureMap.get(data.emissiveTextureId) ?? null,
      emissiveFactor: data.emissiveFactor,
      clearcoatFactor: data.clearcoatFactor,
      clearcoatTexture: data.clearcoatTextureId == null ? null : textureMap.get(data.clearcoatTextureId) ?? null,
      clearcoatRoughnessFactor: data.clearcoatRoughnessFactor,
      clearcoatRoughnessTexture: data.clearcoatRoughnessTextureId == null ? null : textureMap.get(data.clearcoatRoughnessTextureId) ?? null,
      clearcoatNormalTexture: data.clearcoatNormalTextureId == null ? null : textureMap.get(data.clearcoatNormalTextureId) ?? null,
      clearcoatNormalScale: data.clearcoatNormalScale,
      ior: data.ior ?? 1.5,
      specularFactor: data.specularFactor ?? 1,
      specularColorFactor: data.specularColorFactor ?? [1, 1, 1],
      specularTexture: data.specularTextureId == null ? null : textureMap.get(data.specularTextureId) ?? null,
      specularColorTexture: data.specularColorTextureId == null ? null : textureMap.get(data.specularColorTextureId) ?? null,
      sheenColorFactor: data.sheenColorFactor ?? [0, 0, 0],
      sheenRoughnessFactor: data.sheenRoughnessFactor ?? 0,
      sheenColorTexture: data.sheenColorTextureId == null ? null : textureMap.get(data.sheenColorTextureId) ?? null,
      sheenRoughnessTexture: data.sheenRoughnessTextureId == null ? null : textureMap.get(data.sheenRoughnessTextureId) ?? null,
      transmissionFactor: data.transmissionFactor ?? 0,
      transmissionTexture: data.transmissionTextureId == null ? null : textureMap.get(data.transmissionTextureId) ?? null,
      thicknessFactor: data.thicknessFactor ?? 0,
      thicknessTexture: data.thicknessTextureId == null ? null : textureMap.get(data.thicknessTextureId) ?? null,
      attenuationDistance: data.attenuationDistance ?? Infinity,
      attenuationColor: data.attenuationColor ?? [1, 1, 1],
      alphaMode: data.alphaMode,
      alphaCutoff: data.alphaCutoff,
      doubleSided: data.doubleSided,
    });
  } else if (data.type === 'ToonMaterial') {
    material = new ToonMaterial({
      baseColor: data.baseColor,
      bandSoftness: data.bandSoftness,
      layers: data.layers.map(layer => ({
        minLight: layer.minLight,
        color: layer.color,
        texture: layer.textureId == null ? null : textureMap.get(layer.textureId) ?? null,
        sampler: layer.sampler,
        textureMapping: layer.textureMapping,
      })),
      alphaMode: data.alphaMode,
      doubleSided: data.doubleSided,
    });
  } else if (data.type === 'RadialShadowMaterial') {
    material = new RadialShadowMaterial({
      color: data.color,
      opacity: data.opacity,
      innerRadius: data.innerRadius,
    });
  } else {
    material = new BasicMaterial({
      color: data.color,
      blending: data.blending,
      texture: data.textureId === null ? null : textureMap.get(data.textureId) ?? null,
    });
  }
  registerDeserializedResource(options, material, data.name);
  options?.resourcePool.registerMaterial(material, data.name);
  return material;
}

export function deserializeComponent(
  data: SerializedComponent,
  geometryMap: Map<number, Geometry3D>,
  materialMap: Map<number, Material>,
  scriptMap: Map<number, ScriptResource>,
  options: ComponentDeserializationOptions | ComponentDeserializationExtension[] = {},
): Component | null {
  const extensions = Array.isArray(options) ? options : options.extensions ?? [];
  const deserializePrefabInstances = Array.isArray(options) ? true : options.deserializePrefabInstances !== false;
  if (data.type !== 'PrefabInstance') {
    for (const extension of extensions) {
      const component = extension.deserializeComponent?.(data);
      if (component) return component;
    }
    const coreComponent = coreComponentSerializationRegistry.deserialize(data as CoreSerializedComponent, {
      decodeFloat32Array,
      decodeIndexArray,
      getGeometry: id => geometryMap.get(id),
      getMaterial: id => materialMap.get(id),
      getScript: id => scriptMap.get(id),
    });
    if (coreComponent) return coreComponent;
  }
  if (data.type === 'PrefabInstance') {
    return deserializePrefabInstances ? new PrefabInstanceComponent(data.prefabId, data.sourceRevision) : null;
  }
  return null;
}

export function deserializeEntity(
  data: SerializedEntity,
  geometryMap: Map<number, Geometry3D>,
  materialMap: Map<number, Material>,
  scriptMap: Map<number, ScriptResource>,
  options: ComponentDeserializationOptions | ComponentDeserializationExtension[] = {},
): Entity {
  const entity = new Entity(data.name || 'Untitled Entity');
  entity.disabled = Boolean(data.disabled);
  for (const componentData of data.components ?? []) {
    const component = deserializeComponent(componentData, geometryMap, materialMap, scriptMap, options);
    if (component) entity.addComponent(component);
  }
  const canvasText = entity.getComponent(CanvasTextComponent);
  const mesh = entity.getComponent(Mesh3D);
  if (canvasText && mesh?.material instanceof CssMaterial) {
    canvasText.material = mesh.material;
  }
  for (const childData of data.children ?? []) {
    entity.addChild(deserializeEntity(childData, geometryMap, materialMap, scriptMap, options));
  }
  return entity;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertArrayField(value: Record<string, unknown>, key: string, required = false): void {
  const field = value[key];
  if (field === undefined && !required) return;
  if (!Array.isArray(field)) throw sceneDataError(`Invalid scene: resources.${key} must be an array.`, `resources.${key}`);
  for (const [index, resource] of field.entries()) {
    const path = `resources.${key}[${index}]`;
    if (!isPlainRecord(resource)) throw sceneDataError(`Invalid scene: ${path} must be an object.`, path, { resourceType: key });
    if ('id' in resource && typeof resource.id !== 'number') {
      throw sceneDataError(`Invalid scene: ${path}.id must be a number.`, `${path}.id`, { resourceType: key, resourceId: resource.id });
    }
    if ('name' in resource && typeof resource.name !== 'string') {
      throw sceneDataError(`Invalid scene: ${path}.name must be a string.`, `${path}.name`, { resourceType: key, resourceId: resource.id });
    }
    if (key === 'models' && resource.compatibilityReport !== undefined) {
      const failure = findModelCompatibilityReportError(resource.compatibilityReport, `${path}.compatibilityReport`);
      if (failure) throw sceneDataError(`Invalid scene: ${failure.message}`, failure.path);
    }
  }
}

function validateSerializedEntityShape(value: unknown, path: string): void {
  if (!isPlainRecord(value)) throw sceneDataError(`Invalid scene: ${path} must be an object.`, path);
  if (typeof value.name !== 'string') throw sceneDataError(`Invalid scene: ${path}.name must be a string.`, `${path}.name`);
  if ('disabled' in value && typeof value.disabled !== 'boolean') throw sceneDataError(`Invalid scene: ${path}.disabled must be a boolean.`, `${path}.disabled`);
  if (!Array.isArray(value.components)) throw sceneDataError(`Invalid scene: ${path}.components must be an array.`, `${path}.components`);
  if (!Array.isArray(value.children)) throw sceneDataError(`Invalid scene: ${path}.children must be an array.`, `${path}.children`);
  for (const [index, component] of ((value.components as unknown[] | undefined) ?? []).entries()) {
    if (!isPlainRecord(component) || typeof component.type !== 'string') {
      throw sceneDataError(
        `Invalid scene: ${path}.components[${index}] must include a string type.`,
        `${path}.components[${index}].type`,
      );
    }
  }
  const children = (value.children as unknown[] | undefined) ?? [];
  for (let i = 0; i < children.length; i++) validateSerializedEntityShape(children[i], `${path}.children[${i}]`);
}

export function validateSerializedEditorScene(value: unknown): asserts value is SerializedEditorScene {
  if (!isPlainRecord(value)) throw sceneDataError('Invalid scene: root must be an object.', 'scene');
  if (value.version !== 1) throw sceneDataError('Unsupported editor scene version.', 'version', { actualVersion: value.version });
  if (typeof value.name !== 'string') throw sceneDataError('Invalid scene: name must be a string.', 'name');
  if (!isPlainRecord(value.globals)) throw sceneDataError('Invalid scene: globals must be an object.', 'globals');
  if (!Array.isArray(value.entities)) throw sceneDataError('Invalid scene: entities must be an array.', 'entities');
  if (!isPlainRecord(value.resources)) throw sceneDataError('Invalid scene: resources must be an object.', 'resources');
  if ('systems' in value && !Array.isArray(value.systems)) throw sceneDataError('Invalid scene: systems must be an array.', 'systems');
  if ('authoring' in value && value.authoring !== undefined) {
    try {
      parseContentAuthoringBundle(value.authoring);
    } catch (error) {
      throw sceneDataError(`Invalid scene authoring content: ${error instanceof Error ? error.message : String(error)}`, 'authoring');
    }
  }
  const resources = (isPlainRecord(value.resources) ? value.resources : {}) as Record<string, unknown>;
  assertArrayField(resources, 'geometries', true);
  assertArrayField(resources, 'materials', true);
  assertArrayField(resources, 'textures', true);
  assertArrayField(resources, 'models');
  assertArrayField(resources, 'prefabs', true);
  assertArrayField(resources, 'scripts', true);
  for (let i = 0; i < value.entities.length; i++) validateSerializedEntityShape(value.entities[i], `entities[${i}]`);
}

function sceneDataError(message: string, path: string, context: Record<string, unknown> = {}): EngineError {
  const entityMatch = /entities\[(\d+)\]/.exec(path);
  const componentMatch = /components\[(\d+)\]/.exec(path);
  const resourceMatch = /resources\.([^.[\]]+)(?:\[(\d+)\])?/.exec(path);
  const field = path.split('.').at(-1);
  return new EngineError(EngineErrorCode.SceneDataInvalid, message, {
    domain: ErrorDomain.Serialization,
    recovery: ErrorRecovery.TerminateRuntime,
    context: {
      ...context,
      ...(entityMatch === null ? {} : { entity: Number(entityMatch[1]) }),
      ...(componentMatch === null ? {} : { component: Number(componentMatch[1]) }),
      ...(resourceMatch === null ? {} : {
        resourceType: resourceMatch[1],
        ...(resourceMatch[2] === undefined ? {} : { resourceIndex: Number(resourceMatch[2]) }),
      }),
      ...(field === undefined ? {} : { field }),
    },
    path,
  });
}
