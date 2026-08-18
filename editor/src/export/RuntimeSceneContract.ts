import { BasicMaterial, Camera3D, EngineError, EngineErrorCode, Material2D } from '@haiyue/engine';
import { BlinnPhongMaterial, CssMaterialStyle, NormalMaterial, PbrAlphaMode, ToonMaterial } from '@haiyue/engine/material';
import { CompressedTextureSourceDescriptor } from '@haiyue/engine/assets';
import { ErrorDomain, ErrorRecovery } from '@haiyue/engine/core';
import { JsonObject, MeshHelper, ScriptLifecycleName } from '@haiyue/engine/components';
import type {
  Physics2DBody,
  Physics2DJoint,
  Physics2DTo3DTransformSync,
} from '@haiyue/engine/physics/components';
import type { GltfAssetStats, GltfCompatibilityReport } from '@haiyue/extensions/gltf';
import type { ContentAuthoringBundle } from '../domain/content/ContentAuthoringStore';

export type Vec3Tuple = [number, number, number];

export interface SerializedGlobalSettings {
  designWidth: number;
  designHeight: number;
  viewportMode?: 'expand' | 'fit' | 'fill' | 'fixed';
  clearColor: [number, number, number, number];
  reverseZ?: boolean;
  render2DLoadOp?: 'clear' | 'load';
  guiLoadOp?: 'clear' | 'load';
  parameters: Record<string, unknown>;
  inputMap: Record<string, string[]>;
}

export type SerializedPhysics2DSystem = {
  type: 'Physics2DSystem';
  gravity: [number, number];
  pixelsPerMeter: number;
  fixedTimeStep: number;
  maxSubSteps: number;
  velocityIterations: number;
  positionIterations: number;
  syncStaticBodiesFromTransform: boolean;
  priority: number;
  disabled?: boolean;
};

export type SerializedRadialShadowRenderFeature = {
  type: 'RadialShadowRenderFeature';
  loadOp: 'clear' | 'load';
  priority: number;
  disabled?: boolean;
};

export type SerializedSystem = SerializedPhysics2DSystem | SerializedRadialShadowRenderFeature;

export interface SerializedEditorScene {
  version: 1;
  name: string;
  globals: SerializedGlobalSettings;
  systems?: SerializedSystem[];
  resources: {
    geometries: SerializedGeometry[];
    materials: SerializedMaterial[];
    textures: SerializedTexture[];
    models?: SerializedModel[];
    prefabs: SerializedPrefab[];
    scripts: SerializedScript[];
  };
  /** Editor-only animation and Material Graph source documents; omitted from runtime export. */
  authoring?: ContentAuthoringBundle;
  entities: SerializedEntity[];
}

export interface RuntimeScene {
  version: 1;
  format: 'haiyue-runtime-scene';
  name: string;
  globals: SerializedGlobalSettings;
  systems?: SerializedSystem[];
  resources: {
    geometries: RuntimeGeometry[];
    materials: RuntimeMaterial[];
    textures: RuntimeTexture[];
    prefabs: RuntimePrefab[];
    scripts: RuntimeScript[];
  };
  entities: RuntimeEntity[];
}

export interface RuntimeExportManifest {
  version: 1;
  sceneName: string;
  precompile?: {
    enabled: boolean;
    sceneModule: string;
    debugJson: string;
    binaryAsset: string | null;
    geometryBufferCount: number;
    binaryBytes: number;
    jsonBytes: number;
    moduleBytes: number;
  };
  texturePipeline?: {
    enabled: boolean;
    atlasCount: number;
    atlasTextures: Array<{
      id: number;
      name: string;
      width: number;
      height: number;
      format: string;
      sourceTextureIds: number[];
    }>;
    packedTextureCount: number;
    skippedTextureCount: number;
    duplicatedGeometryCount: number;
    originalTextureBytes: number;
    atlasTextureBytes: number;
  };
  dependencies?: {
    componentTypes: string[];
    materialTypes: string[];
    engineImports: string[];
    runtimeImports: Array<{ from: string; names: string[] }>;
    systems: string[];
    features: Record<string, boolean>;
  };
  resources: {
    input: RuntimeResourceCounts;
    output: RuntimeResourceCounts;
    removed: RuntimeResourceCounts;
  };
  idMaps: {
    geometries: Record<number, number>;
    materials: Record<number, number>;
    textures: Record<number, number>;
    prefabs: Record<number, number>;
    scripts: Record<number, number>;
  };
  warnings: RuntimeExportWarning[];
}

export interface RuntimeExportResult {
  scene: RuntimeScene;
  manifest: RuntimeExportManifest;
}

export function validateRuntimeScene(value: unknown): asserts value is RuntimeScene {
  if (!isRecord(value)) throw runtimeSceneError('Runtime scene root must be an object.', 'runtimeScene');
  if (value.format !== 'haiyue-runtime-scene') throw runtimeSceneError('Runtime scene format is invalid.', 'runtimeScene.format');
  if (value.version !== 1) throw runtimeSceneError('Runtime scene version is unsupported.', 'runtimeScene.version');
  if (typeof value.name !== 'string') throw runtimeSceneError('Runtime scene name must be a string.', 'runtimeScene.name');
  if (!isRecord(value.resources)) throw runtimeSceneError('Runtime scene resources must be an object.', 'runtimeScene.resources');
  const resourceFields = ['geometries', 'materials', 'textures', 'prefabs', 'scripts'] as const;
  for (const field of resourceFields) {
    const resources = value.resources[field];
    if (!Array.isArray(resources)) throw runtimeSceneError(`Runtime scene resources.${field} must be an array.`, `runtimeScene.resources.${field}`);
    for (const [index, resource] of resources.entries()) {
      if (!isRecord(resource) || typeof resource.id !== 'number') {
        throw runtimeSceneError(
          `Runtime scene resources.${field}[${index}] must include a numeric id.`,
          `runtimeScene.resources.${field}[${index}].id`,
          { resourceType: field, resourceId: isRecord(resource) ? resource.id : undefined },
        );
      }
    }
  }
  if (!Array.isArray(value.entities)) throw runtimeSceneError('Runtime scene entities must be an array.', 'runtimeScene.entities');
  for (const [index, entity] of value.entities.entries()) validateRuntimeEntity(entity, `runtimeScene.entities[${index}]`);
}

function validateRuntimeEntity(value: unknown, path: string): void {
  if (!isRecord(value)) throw runtimeSceneError('Runtime entity must be an object.', path);
  if (!Array.isArray(value.components)) throw runtimeSceneError('Runtime entity components must be an array.', `${path}.components`);
  if (!Array.isArray(value.children)) throw runtimeSceneError('Runtime entity children must be an array.', `${path}.children`);
  for (const [index, component] of value.components.entries()) {
    if (!isRecord(component) || typeof component.type !== 'string') {
      throw runtimeSceneError('Runtime component must include a string type.', `${path}.components[${index}].type`);
    }
  }
  for (const [index, child] of value.children.entries()) validateRuntimeEntity(child, `${path}.children[${index}]`);
}

function runtimeSceneError(message: string, path: string, context: Record<string, unknown> = {}): EngineError {
  return new EngineError(EngineErrorCode.SceneDataInvalid, message, {
    domain: ErrorDomain.Serialization,
    recovery: ErrorRecovery.TerminateRuntime,
    context,
    path,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface RuntimeExportWarning {
  code: string;
  message: string;
  path?: string;
}

export interface RuntimeResourceCounts {
  geometries: number;
  materials: number;
  textures: number;
  prefabs: number;
  scripts: number;
}

export interface SerializedModel {
  id: number;
  name: string;
  src: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  previewUrl?: string;
  vertexCount?: number;
  triangleCount?: number;
  assetStats?: GltfAssetStats;
  compatibilityReport?: GltfCompatibilityReport;
  previewError?: string;
}

export interface SerializedTypedArray {
  encoding: 'base64';
  componentType: 'float32' | 'uint16' | 'uint32';
  length: number;
  data: string;
}

export interface SerializedGeometry {
  id: number;
  name: string;
  positions: number[] | SerializedTypedArray;
  normals: number[] | SerializedTypedArray | null;
  textureCoordinates: Array<{
    set: number;
    data: number[] | SerializedTypedArray;
  }>;
  textureCoordinateLayout: number[];
  indices: number[] | SerializedTypedArray | null;
  indexType: 'uint16' | 'uint32' | null;
  topology: GPUPrimitiveTopology | null;
  cullMode: GPUCullMode | null;
  frontFace: GPUFrontFace | null;
}

export type RuntimeGeometry = SerializedGeometry;

export type SerializedMaterial =
  | {
      id: number;
      name: string;
      type: 'PbrMaterial';
      baseColor: [number, number, number, number];
      metallic: number;
      roughness: number;
      baseColorTextureId: number | null;
      metallicRoughnessTextureId: number | null;
      normalTextureId: number | null;
      normalScale: number;
      occlusionTextureId: number | null;
      occlusionStrength: number;
      emissiveTextureId: number | null;
      emissiveFactor: [number, number, number];
      clearcoatFactor: number;
      clearcoatTextureId: number | null;
      clearcoatRoughnessFactor: number;
      clearcoatRoughnessTextureId: number | null;
      clearcoatNormalTextureId: number | null;
      clearcoatNormalScale: number;
      ior?: number;
      specularFactor?: number;
      specularColorFactor?: [number, number, number];
      specularTextureId?: number | null;
      specularColorTextureId?: number | null;
      sheenColorFactor?: [number, number, number];
      sheenRoughnessFactor?: number;
      sheenColorTextureId?: number | null;
      sheenRoughnessTextureId?: number | null;
      transmissionFactor?: number;
      transmissionTextureId?: number | null;
      thicknessFactor?: number;
      thicknessTextureId?: number | null;
      attenuationDistance?: number | null;
      attenuationColor?: [number, number, number];
      alphaMode: PbrAlphaMode;
      alphaCutoff: number;
      doubleSided: boolean;
    }
  | {
      id: number;
      name: string;
      type: 'CssMaterial';
      text: string;
      style: CssMaterialStyle;
      color: [number, number, number, number];
      blending: BasicMaterial['blending'];
    }
  | {
      id: number;
      name: string;
      type: 'BasicMaterial';
      color: [number, number, number, number];
      blending: BasicMaterial['blending'];
      textureId: number | null;
    }
  | {
      id: number;
      name: string;
      type: 'NormalMaterial';
      space: NormalMaterial['space'];
    }
  | {
      id: number;
      name: string;
      type: 'DepthMaterial';
      near: number;
      far: number;
      isOrthographic: boolean;
    }
  | {
      id: number;
      name: string;
      type: 'BlinnPhongMaterial';
      ambient: [number, number, number, number];
      diffuse: [number, number, number, number];
      specular: [number, number, number, number];
      shininess: number;
      blending: BlinnPhongMaterial['blending'];
    }
  | {
      id: number;
      name: string;
      type: 'ToonMaterial';
      baseColor: [number, number, number, number];
      bandSoftness: number;
      layers: Array<{
        minLight: number;
        color: [number, number, number, number];
        textureId: number | null;
        sampler: GPUSamplerDescriptor | null;
        textureMapping: {
          texCoord: 0 | 1;
          offset: readonly [number, number];
          rotation: number;
          scale: readonly [number, number];
        };
      }>;
      alphaMode: ToonMaterial['alphaMode'];
      doubleSided: boolean;
    }
  | {
      id: number;
      name: string;
      type: 'RadialShadowMaterial';
      color: Vec3Tuple;
      opacity: number;
      innerRadius: number;
    };

export type RuntimeMaterial = SerializedMaterial;

export interface SerializedTexture {
  id: number;
  name: string;
  src: string | CompressedTextureSourceDescriptor | null;
  previewUrl?: string;
  width?: number;
  height?: number;
  fileType?: string;
  fileSize?: number;
  compressedInfo?: import('../types').TextureCompressedInfo;
  previewError?: string;
}

export interface RuntimeTexture {
  id: number;
  name: string;
  src: string | CompressedTextureSourceDescriptor;
  width?: number;
  height?: number;
  fileType?: string;
}

export interface SerializedPrefab {
  id: number;
  name: string;
  assetKey?: string;
  root: SerializedEntity;
  sourceEntityId?: number;
  revision?: number;
  basePrefabId?: number;
  baseRevision?: number;
  variantOverrides?: PrefabVariantOverride[];
}

export interface PrefabVariantOverride {
  path: number[];
  name?: string;
  disabled?: boolean;
  components?: SerializedComponent[];
  children?: SerializedEntity[];
}

export interface RuntimePrefab {
  id: number;
  name: string;
  assetKey?: string;
  root: RuntimeEntity;
}

export interface SerializedScript {
  id: number;
  name: string;
  scripts: Record<ScriptLifecycleName, string>;
  fileName?: string;
  fileSize?: number;
}

export interface RuntimeScript {
  id: number;
  name: string;
  scripts: Record<ScriptLifecycleName, string>;
}

export interface SerializedEntity {
  name: string;
  disabled: boolean;
  components: SerializedComponent[];
  children: SerializedEntity[];
}

export type RuntimeEntity = SerializedEntity;

export type SerializedComponent =
  | { type: 'CartesianTransform3D'; position: Vec3Tuple; rotation: Vec3Tuple; scale: Vec3Tuple; anchor: Vec3Tuple }
  | { type: 'SphericalTransform3D'; radius: number; theta: number; phi: number; target: Vec3Tuple }
  | { type: 'BasisTransform3D'; coordinates: Vec3Tuple; basisX: Vec3Tuple; basisY: Vec3Tuple; basisZ: Vec3Tuple }
  | { type: 'Transform2D'; x: number; y: number; rotation: number; scaleX: number; scaleY: number }
  | { type: 'Camera3D'; projectionType: Camera3D['projectionType']; fov: number; aspect: number; near: number; far: number; orthoLeft: number; orthoRight: number; orthoTop: number; orthoBottom: number; reverseZ?: boolean }
  | { type: 'Camera2D'; width: number; height: number; near: number; far: number; zoom: number }
  | { type: 'DataComponent'; data: JsonObject }
  | { type: 'KeyboardComponent' }
  | {
      type: 'Physics2DBody';
      bodyType: Physics2DBody['type'];
      shape: Physics2DBody['shape'];
      width: number;
      height: number;
      radius: number;
      density: number;
      friction: number;
      restitution: number;
      fixedRotation: boolean;
      linearDamping: number;
      angularDamping: number;
      bullet: boolean;
      allowSleep: boolean;
      isSensor: boolean;
      categoryBits: number;
      maskBits: number;
      groupIndex: number;
      syncTransform: boolean;
    }
  | {
      type: 'Physics2DJoint';
      jointType: Physics2DJoint['type'];
      bodyA: string | number;
      bodyB: string | number;
      anchor: [number, number] | null;
      anchorA: [number, number] | null;
      anchorB: [number, number] | null;
      collideConnected: boolean;
      enableLimit: boolean;
      lowerAngle: number;
      upperAngle: number;
      enableMotor: boolean;
      motorSpeed: number;
      maxMotorTorque: number;
      length: number | null;
      frequencyHz: number;
      dampingRatio: number;
    }
  | {
      type: 'Physics2DTo3DTransformSync';
      sourceEntity: string | number | null;
      plane: Physics2DTo3DTransformSync['plane'];
      fixedAxisValue: number;
      offset: [number, number, number];
      syncRotation: boolean;
      rotationAxis: Physics2DTo3DTransformSync['rotationAxis'];
      rotationOffset: number;
    }
  | { type: 'CanvasTextComponent'; text: string; style: CssMaterialStyle }
  | { type: 'GltfModelComponent'; src: string; scene?: number | null; autoLoad?: boolean; clearPrevious?: boolean; baseColorFactor?: [number, number, number, number] }
  | { type: 'Grid2DComponent'; columns: number; rows: number; cellWidth: number; cellHeight: number; originX: number; originY: number }
  | { type: 'Spine2DComponent'; jsonUrl: string; atlasUrl?: string; imageUrl?: string; imageUrls?: Record<string, string>; skin?: string; animation?: string; loop?: boolean; timeScale?: number; scale?: number; premultipliedAlpha?: boolean }
  | { type: 'Tween2DComponent'; from?: Record<string, number>; to?: Record<string, number>; duration?: number; delay?: number; easing?: string; removeOnComplete?: boolean }
  | {
      type: 'Tilemap2DComponent';
      columns: number;
      rows: number;
      cellWidth: number;
      cellHeight: number;
      originX: number;
      originY: number;
      gap: number;
      cells: number[];
      palette: Array<[number, number, number, number]>;
    }
  | { type: 'Mesh3D'; geometryId: number; materialId: number }
  | {
      type: 'Mesh2D';
      positions: number[] | SerializedTypedArray;
      indices: number[] | SerializedTypedArray | null;
      indexType: 'uint16' | 'uint32' | null;
      topology: GPUPrimitiveTopology | null;
      color: [number, number, number, number];
      blending: Material2D['blending'];
    }
  | { type: 'PrefabInstance'; prefabId: number; sourceRevision?: number }
  | { type: 'MeshHelper'; mode: MeshHelper['mode']; color: [number, number, number, number] }
  | { type: 'ScriptComponent'; scriptId?: number | null; scripts: Partial<Record<ScriptLifecycleName, string>> }
  | { type: 'AmbientLight'; color: [number, number, number, number]; intensity: number }
  | { type: 'DirectionalLight'; color: [number, number, number, number]; intensity: number; direction: Vec3Tuple; castShadow: boolean; shadow: { mapSize: 512 | 1024 | 2048; extent: number; near: number; far: number; bias: number; normalBias: number } }
  | { type: 'EnvironmentLight'; intensity: number; rotation: number; diffuseColor: [number, number, number, number]; specularColor: [number, number, number, number] }
  | { type: 'Fog'; mode: 'distance' | 'height'; color: [number, number, number, number]; maxOpacity: number; distanceStart: number; distanceEnd: number; baseHeight: number; density: number; heightFalloff: number }
  | { type: 'PointLight'; color: [number, number, number, number]; intensity: number; range: number };
