// Generated runtime deserialization is the editor-owned dynamic data adapter.
// It narrows the versioned scene before constructing engine domain objects.
export const RUNTIME_DESERIALIZATION_TS = String.raw`__ENGINE_IMPORT_BLOCK____COMPONENT_IMPORT_BLOCK__
import { coreComponentSerializationRegistry } from '@haiyue/engine/serialization';

export interface CompressedTextureSourceDescriptor {
  kind: 'compressed-texture';
  type: 'texture/ktx2' | string;
  src: string;
}

export type TextureSource = string | ImageBitmap | HTMLCanvasElement | HTMLImageElement | GPUTexture | CompressedTextureSourceDescriptor;

export interface RuntimeScene {
  version: 1;
  format: 'haiyue-runtime-scene';
  name: string;
  globals: {
    designWidth?: number;
    designHeight?: number;
    viewportMode?: 'expand' | 'fit' | 'fill' | 'fixed';
    clearColor?: [number, number, number, number];
    reverseZ?: boolean;
    inputMap?: Record<string, string[]>;
    [key: string]: unknown;
  };
  systems?: any[];
  resources: {
    geometries: any[];
    materials: any[];
    textures: any[];
    prefabs: RuntimePrefab[];
    scripts: any[];
  };
  precompiled?: {
    binaryAsset?: string;
    binaryAssetUrl?: string;
    geometries?: Record<number, PrecompiledGeometryBuffers>;
  };
  entities: any[];
}

interface RuntimePrefab {
  id: number;
  name: string;
  root: any;
}

function getEngineDefaultsFromRuntimeGlobals(globals: RuntimeScene['globals']) {
  if (!globals) return undefined;
  const clearColorTuple = globals.clearColor ?? [0.04, 0.05, 0.07, 1];
  const clearColor = {
    r: clearColorTuple[0],
    g: clearColorTuple[1],
    b: clearColorTuple[2],
    a: clearColorTuple[3],
  };
  const reverseZ = globals.reverseZ === true;
  return {
    clearColor,
    reverseZ,
    scene: {
      clearColor,
      reverseZ,
      render3D: { reverseZ },
      render2D: { loadOp: globals.render2DLoadOp ?? 'load' },
      gui: { loadOp: globals.guiLoadOp ?? 'load' },
    },
  };
}

interface PrecompiledBufferView {
  byteOffset: number;
  byteLength: number;
  componentType: 'float32' | 'uint16' | 'uint32';
  count: number;
}

interface PrecompiledGeometryBuffers {
  positions?: PrecompiledBufferView;
  normals?: PrecompiledBufferView;
  textureCoordinates?: Record<number, PrecompiledBufferView>;
  indices?: PrecompiledBufferView;
}

export async function loadPrecompiledBinary(scene: RuntimeScene): Promise<ArrayBuffer | null> {
  const url = scene.precompiled?.binaryAssetUrl ?? scene.precompiled?.binaryAsset;
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to load precompiled scene binary.');
  return response.arrayBuffer();
}

export function deserializeGeometry(
  data: any,
  binaryBuffer: ArrayBuffer | null,
  precompiled?: PrecompiledGeometryBuffers,
): Geometry3D {
  return new Geometry3D({
    positions: precompiled?.positions && binaryBuffer
      ? readFloat32Array(binaryBuffer, precompiled.positions)
      : decodeFloat32Array(data.positions),
    normals: precompiled?.normals && binaryBuffer
      ? readFloat32Array(binaryBuffer, precompiled.normals)
      : data.normals ? decodeFloat32Array(data.normals) : undefined,
    textureCoordinates: data.textureCoordinates.map((entry: any) => {
      const precompiledView = precompiled?.textureCoordinates?.[entry.set];
      return {
        set: entry.set,
        data: precompiledView && binaryBuffer
          ? readFloat32Array(binaryBuffer, precompiledView)
          : decodeFloat32Array(entry.data),
      };
    }),
    textureCoordinateLayout: data.textureCoordinateLayout,
    indices: precompiled?.indices && binaryBuffer
      ? readIndexArray(binaryBuffer, precompiled.indices)
      : data.indices
        ? decodeIndexArray(data.indices, data.indexType)
      : undefined,
    topology: data.topology ?? undefined,
    cullMode: data.cullMode ?? undefined,
    frontFace: data.frontFace ?? undefined,
  });
}

function decodeFloat32Array(value: number[] | any): Float32Array {
  if (Array.isArray(value)) return new Float32Array(value);
  return decodeTypedArray(value, 'float32') as Float32Array;
}

function decodeIndexArray(value: number[] | any, indexType: 'uint16' | 'uint32' | null): Uint16Array | Uint32Array {
  if (Array.isArray(value)) return indexType === 'uint32' ? new Uint32Array(value) : new Uint16Array(value);
  return decodeTypedArray(value, indexType === 'uint32' ? 'uint32' : 'uint16') as Uint16Array | Uint32Array;
}

function decodeTypedArray(value: any, expectedType: 'float32' | 'uint16' | 'uint32'): Float32Array | Uint16Array | Uint32Array {
  if (!value || value.encoding !== 'base64' || value.componentType !== expectedType) {
    throw new Error('Invalid serialized typed array.');
  }
  const binary = atob(value.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (value.componentType === 'float32') return new Float32Array(buffer, 0, value.length);
  if (value.componentType === 'uint32') return new Uint32Array(buffer, 0, value.length);
  return new Uint16Array(buffer, 0, value.length);
}

function readFloat32Array(buffer: ArrayBuffer, view: PrecompiledBufferView): Float32Array {
  return new Float32Array(buffer, view.byteOffset, view.count);
}

function readIndexArray(buffer: ArrayBuffer, view: PrecompiledBufferView): Uint16Array | Uint32Array {
  if (view.componentType === 'uint32') return new Uint32Array(buffer, view.byteOffset, view.count);
  return new Uint16Array(buffer, view.byteOffset, view.count);
}

export function deserializeMaterial(data: any, textureMap: Map<number, TextureSource>): Material {
  if (data.type === 'CssMaterial') {
    return new CssMaterial({ text: data.text, style: data.style, color: data.color, blending: data.blending });
  }
  if (data.type === 'NormalMaterial') return new NormalMaterial({ space: data.space });
  if (data.type === 'DepthMaterial') {
    return new DepthMaterial({ near: data.near, far: data.far, isOrthographic: data.isOrthographic });
  }
  if (data.type === 'BlinnPhongMaterial') {
    return new BlinnPhongMaterial({
      ambient: data.ambient,
      diffuse: data.diffuse,
      specular: data.specular,
      shininess: data.shininess,
      blending: data.blending,
    });
  }
  if (data.type === 'PbrMaterial') {
    return new PbrMaterial({
      baseColor: data.baseColor,
      metallic: data.metallic,
      roughness: data.roughness,
      baseColorTexture: data.baseColorTextureId == null ? null : textureMap.get(data.baseColorTextureId) ?? null,
      metallicRoughnessTexture: data.metallicRoughnessTextureId == null ? null : textureMap.get(data.metallicRoughnessTextureId) ?? null,
      normalTexture: data.normalTextureId == null ? null : textureMap.get(data.normalTextureId) ?? null,
      normalScale: data.normalScale,
      occlusionTexture: data.occlusionTextureId == null ? null : textureMap.get(data.occlusionTextureId) ?? null,
      occlusionStrength: data.occlusionStrength,
      emissiveTexture: data.emissiveTextureId == null ? null : textureMap.get(data.emissiveTextureId) ?? null,
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
  }
  if (data.type === 'ToonMaterial') {
    return new ToonMaterial({
      baseColor: data.baseColor,
      bandSoftness: data.bandSoftness,
      layers: data.layers.map((layer: any) => ({
        minLight: layer.minLight,
        color: layer.color,
        texture: layer.textureId == null ? null : textureMap.get(layer.textureId) ?? null,
        sampler: layer.sampler,
        textureMapping: layer.textureMapping,
      })),
      alphaMode: data.alphaMode,
      doubleSided: data.doubleSided,
    });
  }
  if (data.type === 'RadialShadowMaterial') {
    return new RadialShadowMaterial({
      color: data.color,
      opacity: data.opacity,
      innerRadius: data.innerRadius,
    });
  }
  return new BasicMaterial({
    color: data.color,
    blending: data.blending,
    texture: data.textureId == null ? null : textureMap.get(data.textureId) ?? null,
  });
}

export function deserializeComponent(
  data: any,
  geometryMap: Map<number, Geometry3D>,
  materialMap: Map<number, Material>,
  scriptMap: Map<number, ScriptResource>,
): Component | null {
  const coreComponent = coreComponentSerializationRegistry.deserialize(data, {
    decodeFloat32Array,
    decodeIndexArray,
    getGeometry: id => geometryMap.get(id),
    getMaterial: id => materialMap.get(id),
    getScript: id => scriptMap.get(id),
  });
  if (coreComponent) return coreComponent;
  switch (data.type) {
__OPTIONAL_COMPONENT_CASES__
    case 'PrefabInstance':
      return null;
    default:
      return null;
  }
}

export function deserializeEntity(
  data: any,
  geometryMap: Map<number, Geometry3D>,
  materialMap: Map<number, Material>,
  scriptMap: Map<number, ScriptResource>,
): Entity {
  const entity = new Entity(data.name || 'Untitled Entity');
  entity.disabled = Boolean(data.disabled);
  for (const componentData of data.components ?? []) {
    const component = deserializeComponent(componentData, geometryMap, materialMap, scriptMap);
    if (component) entity.addComponent(component);
  }
__CANVAS_TEXT_BINDING__
  for (const childData of data.children ?? []) {
    entity.addChild(deserializeEntity(childData, geometryMap, materialMap, scriptMap));
  }
  return entity;
}

export function toVec2OrNull(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
}

export function normalizePhysicsJointTarget(target: string | number): string | number {
  if (typeof target === 'number') return target;
  const trimmed = target.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
`;
