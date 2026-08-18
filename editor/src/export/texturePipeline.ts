import type {
  RuntimeEntity,
  RuntimeExportResult,
  RuntimeExportWarning,
  RuntimeGeometry,
  RuntimeMaterial,
  RuntimeTexture,
} from './RuntimeSceneContract';
import { decodeFloat32Array, encodeTypedArray } from '../domain/scene/typedArraySerialization';
import { isCompressedTextureSource } from '@haiyue/engine/assets';

export interface TexturePipelineOptions {
  enabled?: boolean;
  atlas?: {
    enabled?: boolean;
    maxSize?: number;
    padding?: number;
    minTextures?: number;
    outputType?: 'image/png' | 'image/webp';
    quality?: number;
  };
}

export interface TexturePipelineExecutionContext {
  readonly signal?: AbortSignal;
  readonly onProgress?: (current: number, total: number, message?: string) => void;
  /** Worker-owned inputs may be mutated in place to avoid another full-scene clone. */
  readonly mutateInput?: boolean;
}

type AtlasTexture = RuntimeTexture & { src: string };

interface LoadedTexture {
  texture: AtlasTexture;
  image: CanvasImageSource;
  width: number;
  height: number;
}

interface PackedTexture extends LoadedTexture {
  x: number;
  y: number;
}

interface AtlasBuildResult {
  src: string;
  width: number;
  height: number;
  byteLength: number;
  packed: PackedTexture[];
}

interface TextureUsage {
  materialIds: Set<number>;
  meshCount: number;
}

const DEFAULT_MAX_ATLAS_SIZE = 2048;
const DEFAULT_PADDING = 2;
const DEFAULT_MIN_TEXTURES = 2;

export async function optimizeRuntimeTextures(
  runtimeExport: RuntimeExportResult,
  options: TexturePipelineOptions = {},
  context: TexturePipelineExecutionContext = {},
): Promise<RuntimeExportResult> {
  context.signal?.throwIfAborted();
  if (options.enabled === false || options.atlas?.enabled === false) return runtimeExport;
  if (typeof document === 'undefined' && (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined')) return runtimeExport;

  const scene = context.mutateInput ? runtimeExport.scene : structuredClone(runtimeExport.scene);
  const manifest = context.mutateInput ? runtimeExport.manifest : structuredClone(runtimeExport.manifest);
  const warnings = manifest.warnings;
  const atlasOptions = {
    maxSize: options.atlas?.maxSize ?? DEFAULT_MAX_ATLAS_SIZE,
    padding: options.atlas?.padding ?? DEFAULT_PADDING,
    minTextures: options.atlas?.minTextures ?? DEFAULT_MIN_TEXTURES,
    outputType: options.atlas?.outputType ?? 'image/png' as const,
    quality: options.atlas?.quality ?? 0.92,
  };

  const materialById = new Map(scene.resources.materials.map(material => [material.id, material]));
  const textureById = new Map(scene.resources.textures.map(texture => [texture.id, texture]));
  const geometryById = new Map(scene.resources.geometries.map(geometry => [geometry.id, geometry]));
  const textureUsage = collectTextureUsage(scene.entities, materialById);
  for (const prefab of scene.resources.prefabs) collectTextureUsage([prefab.root], materialById, textureUsage);

  const candidates = filterCandidatesWithUvSupport(
    getAtlasCandidates(textureUsage, textureById, warnings),
    scene.entities,
    scene.resources.prefabs.map(prefab => prefab.root),
    materialById,
    geometryById,
    warnings,
  );
  if (candidates.length < atlasOptions.minTextures) {
    manifest.texturePipeline = createTexturePipelineReport({
      enabled: true,
      atlasTextures: [],
      packedTextureCount: 0,
      skippedTextureCount: textureUsage.size,
      duplicatedGeometryCount: 0,
      originalTextureBytes: candidates.reduce((sum, item) => sum + estimateDataUrlBytes(item.src), 0),
      atlasTextureBytes: 0,
    });
    return { scene, manifest };
  }

  const loaded = await loadAtlasTextures(candidates, atlasOptions.maxSize, warnings, context);
  context.signal?.throwIfAborted();
  if (loaded.length < atlasOptions.minTextures) {
    manifest.texturePipeline = createTexturePipelineReport({
      enabled: true,
      atlasTextures: [],
      packedTextureCount: 0,
      skippedTextureCount: textureUsage.size,
      duplicatedGeometryCount: 0,
      originalTextureBytes: loaded.reduce((sum, item) => sum + estimateDataUrlBytes(item.texture.src), 0),
      atlasTextureBytes: 0,
    });
    return { scene, manifest };
  }

  const atlas = await buildAtlas(loaded, atlasOptions.padding, atlasOptions.maxSize, atlasOptions.outputType, atlasOptions.quality, warnings);
  for (const item of loaded) {
    if (typeof ImageBitmap !== 'undefined' && item.image instanceof ImageBitmap) item.image.close();
  }
  if (!atlas) {
    manifest.texturePipeline = createTexturePipelineReport({
      enabled: true,
      atlasTextures: [],
      packedTextureCount: 0,
      skippedTextureCount: textureUsage.size,
      duplicatedGeometryCount: 0,
      originalTextureBytes: loaded.reduce((sum, item) => sum + estimateDataUrlBytes(item.texture.src), 0),
      atlasTextureBytes: 0,
    });
    return { scene, manifest };
  }

  const atlasTextureId = nextResourceId(scene.resources.textures);
  const atlasTexture: RuntimeTexture = {
    id: atlasTextureId,
    name: 'Atlas 1',
    src: atlas.src,
    width: atlas.width,
    height: atlas.height,
    fileType: atlasOptions.outputType,
  };
  const packedByTextureId = new Map(atlas.packed.map(item => [item.texture.id, item]));
  const atlasTextureIds = new Set(packedByTextureId.keys());
  const geometryRewriteCache = new Map<string, RuntimeGeometry>();
  let duplicatedGeometryCount = 0;

  duplicatedGeometryCount += rewriteEntityGeometryUvs(scene.entities, materialById, geometryById, packedByTextureId, geometryRewriteCache, atlas.width, atlas.height);
  for (const prefab of scene.resources.prefabs) {
    duplicatedGeometryCount += rewriteEntityGeometryUvs([prefab.root], materialById, geometryById, packedByTextureId, geometryRewriteCache, atlas.width, atlas.height);
  }

  for (const geometry of geometryRewriteCache.values()) scene.resources.geometries.push(geometry);
  for (const material of scene.resources.materials) {
    if (material.type === 'BasicMaterial' && material.textureId != null && atlasTextureIds.has(material.textureId)) {
      material.textureId = atlasTextureId;
    }
  }
  scene.resources.textures = [
    ...scene.resources.textures.filter(texture => !atlasTextureIds.has(texture.id)),
    atlasTexture,
  ].sort((a, b) => a.id - b.id);

  const originalTextureBytes = atlas.packed.reduce((sum, item) => sum + estimateDataUrlBytes(item.texture.src), 0);
  manifest.resources.output = countRuntimeResources(scene);
  manifest.resources.removed = {
    geometries: Math.max(0, manifest.resources.input.geometries - manifest.resources.output.geometries),
    materials: Math.max(0, manifest.resources.input.materials - manifest.resources.output.materials),
    textures: Math.max(0, manifest.resources.input.textures - manifest.resources.output.textures),
    prefabs: Math.max(0, manifest.resources.input.prefabs - manifest.resources.output.prefabs),
    scripts: Math.max(0, manifest.resources.input.scripts - manifest.resources.output.scripts),
  };
  manifest.texturePipeline = createTexturePipelineReport({
    enabled: true,
    atlasTextures: [{
      id: atlasTexture.id,
      name: atlasTexture.name,
      width: atlas.width,
      height: atlas.height,
      format: atlasOptions.outputType,
      sourceTextureIds: [...atlasTextureIds].sort((a, b) => a - b),
    }],
    packedTextureCount: atlas.packed.length,
    skippedTextureCount: Math.max(0, textureUsage.size - atlas.packed.length),
    duplicatedGeometryCount,
    originalTextureBytes,
    atlasTextureBytes: atlas.byteLength,
  });

  return { scene, manifest };
}

function collectTextureUsage(
  entities: RuntimeEntity[],
  materialById: Map<number, RuntimeMaterial>,
  usage = new Map<number, TextureUsage>(),
): Map<number, TextureUsage> {
  for (const entity of entities) {
    for (const component of entity.components) {
      if (component.type !== 'Mesh3D') continue;
      const material = materialById.get(component.materialId);
      if (material?.type !== 'BasicMaterial' || material.textureId == null) continue;
      let item = usage.get(material.textureId);
      if (!item) {
        item = { materialIds: new Set(), meshCount: 0 };
        usage.set(material.textureId, item);
      }
      item.materialIds.add(material.id);
      item.meshCount++;
    }
    collectTextureUsage(entity.children, materialById, usage);
  }
  return usage;
}

function getAtlasCandidates(
  textureUsage: Map<number, TextureUsage>,
  textureById: Map<number, RuntimeTexture>,
  warnings: RuntimeExportWarning[],
): AtlasTexture[] {
  const result: AtlasTexture[] = [];
  for (const textureId of textureUsage.keys()) {
    const texture = textureById.get(textureId);
    if (!texture) {
      warnings.push({ code: 'atlas-missing-texture', message: `Texture ${textureId} is referenced by BasicMaterial but missing from runtime resources.` });
      continue;
    }
    if (isCompressedTextureSource(texture.src)) {
      warnings.push({ code: 'atlas-compressed-texture', message: `Texture ${texture.name} was skipped because compressed textures cannot be packed into a 2D atlas.`, path: `texture:${texture.name}` });
      continue;
    }
    if (!isImageSourceAtlasEligible(texture.src)) {
      warnings.push({ code: 'atlas-ineligible-texture-source', message: `Texture ${texture.name} was skipped because its source is not a readable image/data URL.`, path: `texture:${texture.name}` });
      continue;
    }
    result.push(texture as AtlasTexture);
  }
  return result.sort((a, b) => a.id - b.id);
}

function filterCandidatesWithUvSupport(
  candidates: AtlasTexture[],
  entities: RuntimeEntity[],
  prefabRoots: RuntimeEntity[],
  materialById: Map<number, RuntimeMaterial>,
  geometryById: Map<number, RuntimeGeometry>,
  warnings: RuntimeExportWarning[],
): AtlasTexture[] {
  const candidateIds = new Set(candidates.map(texture => texture.id));
  const unsupported = new Set<number>();
  collectTexturesWithMissingUvs(entities, candidateIds, materialById, geometryById, unsupported);
  collectTexturesWithMissingUvs(prefabRoots, candidateIds, materialById, geometryById, unsupported);
  if (unsupported.size === 0) return candidates;
  for (const texture of candidates) {
    if (!unsupported.has(texture.id)) continue;
    warnings.push({
      code: 'atlas-missing-geometry-uvs',
      message: `Texture ${texture.name} was skipped because at least one mesh using it has no UVs to rewrite.`,
      path: `texture:${texture.name}`,
    });
  }
  return candidates.filter(texture => !unsupported.has(texture.id));
}

function collectTexturesWithMissingUvs(
  entities: RuntimeEntity[],
  candidateIds: Set<number>,
  materialById: Map<number, RuntimeMaterial>,
  geometryById: Map<number, RuntimeGeometry>,
  unsupported: Set<number>,
): void {
  for (const entity of entities) {
    for (const component of entity.components) {
      if (component.type !== 'Mesh3D') continue;
      const material = materialById.get(component.materialId);
      if (material?.type !== 'BasicMaterial' || material.textureId == null || !candidateIds.has(material.textureId)) continue;
      const geometry = geometryById.get(component.geometryId);
      const uvData = geometry ? getSerializedTextureCoordinateData(geometry, 0) : null;
      if (!uvData || getSerializedTypedArrayLength(uvData) === 0) unsupported.add(material.textureId);
    }
    collectTexturesWithMissingUvs(entity.children, candidateIds, materialById, geometryById, unsupported);
  }
}

async function loadAtlasTextures(
  textures: AtlasTexture[],
  maxSize: number,
  warnings: RuntimeExportWarning[],
  context: TexturePipelineExecutionContext,
): Promise<LoadedTexture[]> {
  const result: LoadedTexture[] = [];
  for (let index = 0; index < textures.length; index++) {
    const texture = textures[index]!;
    context.signal?.throwIfAborted();
    context.onProgress?.(index, textures.length, texture.name);
    try {
      const image = await loadImage(texture.src, context.signal);
      const width = image.width;
      const height = image.height;
      if (!width || !height || width > maxSize || height > maxSize) {
        warnings.push({ code: 'atlas-texture-too-large', message: `Texture ${texture.name} was skipped because its size exceeds atlas limits.`, path: `texture:${texture.name}` });
        continue;
      }
      result.push({ texture, image: image.source, width, height });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      warnings.push({ code: 'atlas-texture-load-failed', message: `Texture ${texture.name} could not be loaded for atlas packing.`, path: `texture:${texture.name}` });
    }
  }
  context.onProgress?.(textures.length, textures.length);
  return result;
}

async function buildAtlas(
  textures: LoadedTexture[],
  padding: number,
  maxSize: number,
  outputType: 'image/png' | 'image/webp',
  quality: number,
  warnings: RuntimeExportWarning[],
): Promise<AtlasBuildResult | null> {
  const sorted = [...textures].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height));
  const minSize = nextPowerOfTwo(Math.max(...sorted.map(item => Math.max(item.width, item.height))) + padding * 2);
  for (let size = minSize; size <= maxSize; size *= 2) {
    const packed = packShelf(sorted, size, padding);
    if (!packed) continue;
    const canvas = typeof document === 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.clearRect(0, 0, size, size);
    for (const item of packed) context.drawImage(item.image, item.x, item.y, item.width, item.height);
    try {
      const src = 'convertToBlob' in canvas
        ? await blobToDataUrl(await canvas.convertToBlob({ type: outputType, quality }))
        : canvas.toDataURL(outputType, quality);
      return { src, width: size, height: size, byteLength: estimateDataUrlBytes(src), packed };
    } catch {
      warnings.push({ code: 'atlas-canvas-export-failed', message: 'Atlas canvas export failed, likely because one or more images are cross-origin without CORS.' });
      return null;
    }
  }
  warnings.push({ code: 'atlas-pack-failed', message: `Could not pack ${textures.length} textures within ${maxSize}x${maxSize}.` });
  return null;
}

function packShelf(textures: LoadedTexture[], size: number, padding: number): PackedTexture[] | null {
  const result: PackedTexture[] = [];
  let x = padding;
  let y = padding;
  let shelfHeight = 0;
  for (const texture of textures) {
    const width = texture.width;
    const height = texture.height;
    if (width + padding * 2 > size || height + padding * 2 > size) return null;
    if (x + width + padding > size) {
      x = padding;
      y += shelfHeight + padding;
      shelfHeight = 0;
    }
    if (y + height + padding > size) return null;
    result.push({ ...texture, x, y });
    x += width + padding;
    shelfHeight = Math.max(shelfHeight, height);
  }
  return result;
}

function rewriteEntityGeometryUvs(
  entities: RuntimeEntity[],
  materialById: Map<number, RuntimeMaterial>,
  geometryById: Map<number, RuntimeGeometry>,
  packedByTextureId: Map<number, PackedTexture>,
  cache: Map<string, RuntimeGeometry>,
  atlasWidth: number,
  atlasHeight: number,
): number {
  let duplicated = 0;
  for (const entity of entities) {
    for (const component of entity.components) {
      if (component.type !== 'Mesh3D') continue;
      const material = materialById.get(component.materialId);
      if (material?.type !== 'BasicMaterial' || material.textureId == null) continue;
      const packed = packedByTextureId.get(material.textureId);
      if (!packed) continue;
      const key = `${component.geometryId}:${material.textureId}`;
      let geometry = cache.get(key);
      if (!geometry) {
        const source = geometryById.get(component.geometryId);
        if (!source) continue;
        const uvData = getSerializedTextureCoordinateData(source, 0);
        if (!uvData || getSerializedTypedArrayLength(uvData) === 0) continue;
        geometry = cloneGeometryWithAtlasUvs(source, nextGeometryId(geometryById, cache), packed, atlasWidth, atlasHeight);
        cache.set(key, geometry);
        duplicated++;
      }
      component.geometryId = geometry.id;
    }
    duplicated += rewriteEntityGeometryUvs(entity.children, materialById, geometryById, packedByTextureId, cache, atlasWidth, atlasHeight);
  }
  return duplicated;
}

function cloneGeometryWithAtlasUvs(
  geometry: RuntimeGeometry,
  id: number,
  packed: PackedTexture,
  atlasWidth: number,
  atlasHeight: number,
): RuntimeGeometry {
  const sourceUvData = getSerializedTextureCoordinateData(geometry, 0);
  const sourceUvs = sourceUvData ? decodeFloat32Array(sourceUvData) : null;
  const uvs = sourceUvs ? new Float32Array(sourceUvs.length) : null;
  if (sourceUvs && uvs) {
    for (let index = 0; index < sourceUvs.length; index++) {
      const value = sourceUvs[index];
      if (value === undefined) continue;
      uvs[index] = index % 2 === 0
        ? (packed.x + value * packed.width) / atlasWidth
        : (packed.y + value * packed.height) / atlasHeight;
    }
  }
  const textureCoordinates = geometry.textureCoordinates.filter(entry => entry.set !== 0).map(entry => ({ ...entry }));
  if (uvs) textureCoordinates.push({ set: 0, data: encodeTypedArray(uvs) });
  textureCoordinates.sort((a, b) => a.set - b.set);
  return {
    ...geometry,
    id,
    name: `${geometry.name} Atlas UV`,
    textureCoordinates,
  };
}

function getSerializedTextureCoordinateData(
  geometry: RuntimeGeometry,
  set: number,
): RuntimeGeometry['textureCoordinates'][number]['data'] | null {
  return geometry.textureCoordinates.find(entry => entry.set === set)?.data ?? null;
}

function getSerializedTypedArrayLength(value: number[] | { length: number }): number {
  return value.length;
}

function loadImage(src: string, signal?: AbortSignal): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof document === 'undefined') {
    return fetch(src, signal === undefined ? {} : { signal })
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load image: ${response.status}.`);
        return response.blob();
      })
      .then(blob => createImageBitmap(blob))
      .then(bitmap => ({ source: bitmap, width: bitmap.width, height: bitmap.height }));
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      image.src = '';
      cleanup();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    image.crossOrigin = 'anonymous';
    image.onload = () => { cleanup(); resolve({ source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }); };
    image.onerror = () => { cleanup(); reject(new Error('Failed to load image.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    image.src = src;
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(chunks.join(''))}`;
}

function isImageSourceAtlasEligible(src: string): boolean {
  return src.startsWith('data:image/') || src.startsWith('blob:') || /^https?:\/\//.test(src);
}

function nextGeometryId(geometryById: Map<number, RuntimeGeometry>, cache: Map<string, RuntimeGeometry>): number {
  let max = 0;
  for (const id of geometryById.keys()) max = Math.max(max, id);
  for (const geometry of cache.values()) max = Math.max(max, geometry.id);
  return max + 1;
}

function nextResourceId(resources: Array<{ id: number }>): number {
  return resources.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function estimateDataUrlBytes(src: string): number {
  const comma = src.indexOf(',');
  if (comma === -1) return new Blob([src]).size;
  const payload = src.slice(comma + 1);
  if (src.slice(0, comma).includes(';base64')) return Math.floor(payload.length * 0.75);
  return new Blob([decodeURIComponent(payload)]).size;
}

function countRuntimeResources(scene: RuntimeExportResult['scene']) {
  return {
    geometries: scene.resources.geometries.length,
    materials: scene.resources.materials.length,
    textures: scene.resources.textures.length,
    prefabs: scene.resources.prefabs.length,
    scripts: scene.resources.scripts.length,
  };
}

function createTexturePipelineReport(
  data: Omit<NonNullable<RuntimeExportResult['manifest']['texturePipeline']>, 'atlasCount'>,
): NonNullable<RuntimeExportResult['manifest']['texturePipeline']> {
  return {
    ...data,
    atlasCount: data.atlasTextures.length,
  };
}
