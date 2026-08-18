import type { PbrPaletteMaterial, SceneSize, Voxel } from './model';
import { normalizeColor, voxelKey } from './model';

type Axis = 0 | 1 | 2;
type AxisSign = -1 | 1;

interface FaceDirection {
  axis: Axis;
  sign: AxisSign;
  uAxis: Axis;
  vAxis: Axis;
  normal: readonly [number, number, number];
}

interface MaterialIndexGroup {
  materialKey: string;
  indices: number[];
}

const FACE_DIRECTIONS: readonly FaceDirection[] = [
  { axis: 0, sign: 1, uAxis: 1, vAxis: 2, normal: [1, 0, 0] },
  { axis: 0, sign: -1, uAxis: 2, vAxis: 1, normal: [-1, 0, 0] },
  { axis: 1, sign: 1, uAxis: 2, vAxis: 0, normal: [0, 1, 0] },
  { axis: 1, sign: -1, uAxis: 0, vAxis: 2, normal: [0, -1, 0] },
  { axis: 2, sign: 1, uAxis: 0, vAxis: 1, normal: [0, 0, 1] },
  { axis: 2, sign: -1, uAxis: 1, vAxis: 0, normal: [0, 0, -1] },
];

export interface GltfExportResult {
  json: string;
  exposedFaceCount: number;
  vertexCount: number;
  triangleCount: number;
}

export interface GlbExportResult {
  data: Uint8Array<ArrayBuffer>;
  exposedFaceCount: number;
  vertexCount: number;
  triangleCount: number;
}

export type GltfExportProgress = (progress: number) => void;

export function exportVoxelsAsGltf(
  size: Readonly<SceneSize>,
  source: Iterable<Voxel>,
  palette: Iterable<PbrPaletteMaterial> = [],
): GltfExportResult {
  const built = buildGltfAsset(size, source, palette);
  const buffer = concatenateBinary(built.chunks, built.byteLength);
  const gltf = {
    ...built.gltf,
    buffers: [{ byteLength: built.byteLength, uri: `data:application/octet-stream;base64,${toBase64(buffer)}` }],
  };
  return {
    json: JSON.stringify(gltf),
    exposedFaceCount: built.exposedFaceCount,
    vertexCount: built.vertexCount,
    triangleCount: built.triangleCount,
  };
}

export function exportVoxelsAsGlb(
  size: Readonly<SceneSize>,
  source: Iterable<Voxel>,
  palette: Iterable<PbrPaletteMaterial> = [],
  onProgress?: GltfExportProgress,
): GlbExportResult {
  const built = buildGltfAsset(size, source, palette, onProgress);
  return encodeGltfAssetAsGlb(built, onProgress);
}

export function encodeGltfAssetAsGlb(
  built: Readonly<BuiltGltfAsset>,
  onProgress?: GltfExportProgress,
): GlbExportResult {
  const json = new TextEncoder().encode(JSON.stringify(built.gltf));
  const jsonLength = align4(json.byteLength);
  const binaryLength = align4(built.byteLength);
  const data = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, data.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  data.fill(0x20, 20, 20 + jsonLength);
  data.set(json, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  for (let index = 0; index < built.chunks.length; index += 1) {
    data.set(built.chunks[index]!, binaryHeader + 8 + (built.offsets[index] ?? 0));
  }
  onProgress?.(1);
  return {
    data,
    exposedFaceCount: built.exposedFaceCount,
    vertexCount: built.vertexCount,
    triangleCount: built.triangleCount,
  };
}

export interface BuiltGltfAsset {
  gltf: Record<string, unknown>;
  chunks: Uint8Array[];
  offsets: number[];
  byteLength: number;
  exposedFaceCount: number;
  vertexCount: number;
  triangleCount: number;
}

export function buildGltfAsset(
  size: Readonly<SceneSize>,
  source: Iterable<Voxel>,
  palette: Iterable<PbrPaletteMaterial>,
  onProgress?: GltfExportProgress,
  positionOffset: readonly [number, number, number] = [-size.x / 2, 0, -size.z / 2],
): BuiltGltfAsset {
  const voxels = Array.from(source);
  if (voxels.length === 0) throw new Error('场景中没有可导出的体素。');
  onProgress?.(0.04);
  const paletteList = Array.from(palette);
  const paletteById = new Map(paletteList.map(material => [material.id, material]));
  const paletteByColor = new Map(paletteList.map(material => [normalizeColor(material.color), material]));
  const surfaceMaterials = new Map<string, { color: string; material: PbrPaletteMaterial | null }>();
  const occupied = new Map<string, string>();
  for (const voxel of voxels) {
    const color = normalizeColor(voxel.color);
    const material = (voxel.materialId ? paletteById.get(voxel.materialId) : null) ?? paletteByColor.get(color) ?? null;
    const materialKey = material ? `material:${material.id}` : `color:${color}`;
    occupied.set(voxelKey(voxel.x, voxel.y, voxel.z), materialKey);
    surfaceMaterials.set(materialKey, { color, material });
  }
  onProgress?.(0.12);
  const positions: number[] = [];
  const normals: number[] = [];
  const indicesByColor = new Map<string, MaterialIndexGroup>();
  const exposedFaceCount = buildGreedySurfaceMesh(
    size,
    occupied,
    positions,
    normals,
    indicesByColor,
    progress => onProgress?.(0.12 + progress * 0.62),
    positionOffset,
  );

  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(normals);
  const colorGroups = Array.from(indicesByColor.values()).sort((a, b) => a.materialKey.localeCompare(b.materialKey));
  const indexArrays = colorGroups.map(group => new Uint32Array(group.indices));
  const chunks: Uint8Array[] = [
    new Uint8Array(positionArray.buffer),
    new Uint8Array(normalArray.buffer),
    ...indexArrays.map(indices => new Uint8Array(indices.buffer)),
  ];
  const offsets: number[] = [];
  let byteLength = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    offsets[index] = byteLength;
    const chunk = chunks[index];
    if (!chunk) continue;
    byteLength += chunk.byteLength;
  }
  onProgress?.(0.82);

  const bounds = calculateBounds(positionArray);
  const materials = colorGroups.map(group => {
    const surface = surfaceMaterials.get(group.materialKey)!;
    const linearColor = parseHexLinear(surface.color);
    const paletteMaterial = surface.material;
    return {
      name: paletteMaterial?.name || `Voxel ${surface.color.toUpperCase()}`,
      pbrMetallicRoughness: {
        baseColorFactor: [linearColor[0], linearColor[1], linearColor[2], 1],
        metallicFactor: paletteMaterial?.metallic ?? 0,
        roughnessFactor: paletteMaterial?.roughness ?? 0.82,
      },
      doubleSided: false,
      extras: {
        haiyueVoxelColor: surface.color,
        haiyueMaterialId: paletteMaterial?.id,
        haiyuePaletteMaterial: paletteMaterial ? {
          name: paletteMaterial.name,
          metallic: paletteMaterial.metallic,
          roughness: paletteMaterial.roughness,
        } : undefined,
        haiyueVoxMaterial: paletteMaterial?.vox ? {
          ...paletteMaterial.vox,
          properties: { ...paletteMaterial.vox.properties },
        } : undefined,
      },
    };
  });
  const primitives = colorGroups.map((_group, index) => ({
    attributes: { POSITION: 0, NORMAL: 1 },
    indices: index + 2,
    material: index,
    mode: 4,
  }));
  const bufferViews = [
    { buffer: 0, byteOffset: offsets[0] ?? 0, byteLength: chunks[0]?.byteLength ?? 0, target: 34962 },
    { buffer: 0, byteOffset: offsets[1] ?? 0, byteLength: chunks[1]?.byteLength ?? 0, target: 34962 },
    ...indexArrays.map((indices, index) => ({
      buffer: 0,
      byteOffset: offsets[index + 2] ?? 0,
      byteLength: indices.byteLength,
      target: 34963,
    })),
  ];
  const accessors = [
    { bufferView: 0, componentType: 5126, count: positionArray.length / 3, type: 'VEC3', min: bounds.min, max: bounds.max },
    { bufferView: 1, componentType: 5126, count: normalArray.length / 3, type: 'VEC3' },
    ...indexArrays.map((indices, index) => ({
      bufferView: index + 2,
      componentType: 5125,
      count: indices.length,
      type: 'SCALAR',
    })),
  ];
  const gltf = {
    asset: { version: '2.0', generator: 'Haiyue Voxel Editor' },
    scene: 0,
    scenes: [{ name: 'Voxel Scene', nodes: [0] }],
    nodes: [{ name: 'Voxel Model', mesh: 0 }],
    meshes: [{
      name: 'Voxel Mesh',
      primitives,
    }],
    materials,
    buffers: [{ byteLength }],
    bufferViews,
    accessors,
  };

  return {
    gltf,
    chunks,
    offsets,
    byteLength,
    exposedFaceCount,
    vertexCount: positionArray.length / 3,
    triangleCount: indexArrays.reduce((count, indices) => count + indices.length / 3, 0),
  };
}

function buildGreedySurfaceMesh(
  size: Readonly<SceneSize>,
  occupied: ReadonlyMap<string, string>,
  positions: number[],
  normals: number[],
  indicesByColor: Map<string, MaterialIndexGroup>,
  onProgress?: GltfExportProgress,
  positionOffset: readonly [number, number, number] = [-size.x / 2, 0, -size.z / 2],
): number {
  const dimensions: readonly [number, number, number] = [size.x, size.y, size.z];
  let mergedFaceCount = 0;
  const totalLayers = (size.x + size.y + size.z) * 2;
  let completedLayers = 0;

  for (const direction of FACE_DIRECTIONS) {
    const layerCount = dimensions[direction.axis];
    const uSize = dimensions[direction.uAxis];
    const vSize = dimensions[direction.vAxis];
    for (let layer = 0; layer < layerCount; layer += 1) {
      const mask = new Array<string | null>(uSize * vSize).fill(null);
      for (let v = 0; v < vSize; v += 1) {
        for (let u = 0; u < uSize; u += 1) {
          const cell: [number, number, number] = [0, 0, 0];
          cell[direction.axis] = layer;
          cell[direction.uAxis] = u;
          cell[direction.vAxis] = v;
          const color = occupied.get(voxelKey(cell[0], cell[1], cell[2]));
          if (!color) continue;
          const neighbor: [number, number, number] = [...cell];
          neighbor[direction.axis] += direction.sign;
          if (occupied.has(voxelKey(neighbor[0], neighbor[1], neighbor[2]))) continue;
          mask[v * uSize + u] = color;
        }
      }

      for (let v = 0; v < vSize; v += 1) {
        for (let u = 0; u < uSize;) {
          const color = mask[v * uSize + u];
          if (!color) {
            u += 1;
            continue;
          }
          let width = 1;
          while (u + width < uSize && mask[v * uSize + u + width] === color) width += 1;
          let height = 1;
          heightLoop: while (v + height < vSize) {
            for (let offset = 0; offset < width; offset += 1) {
              if (mask[(v + height) * uSize + u + offset] !== color) break heightLoop;
            }
            height += 1;
          }
          for (let clearV = 0; clearV < height; clearV += 1) {
            for (let clearU = 0; clearU < width; clearU += 1) {
              mask[(v + clearV) * uSize + u + clearU] = null;
            }
          }
          emitMergedFace(
            direction,
            layer,
            u,
            v,
            width,
            height,
            color,
            positions,
            normals,
            indicesByColor,
            positionOffset,
          );
          mergedFaceCount += 1;
          u += width;
        }
      }
      completedLayers += 1;
      onProgress?.(completedLayers / totalLayers);
    }
  }

  return mergedFaceCount;
}

function emitMergedFace(
  direction: FaceDirection,
  layer: number,
  u: number,
  v: number,
  width: number,
  height: number,
  color: string,
  positions: number[],
  normals: number[],
  indicesByColor: Map<string, MaterialIndexGroup>,
  offset: readonly [number, number, number],
): void {
  const base: [number, number, number] = [0, 0, 0];
  base[direction.axis] = layer + (direction.sign > 0 ? 1 : 0);
  base[direction.uAxis] = u;
  base[direction.vAxis] = v;
  const uVector: [number, number, number] = [0, 0, 0];
  const vVector: [number, number, number] = [0, 0, 0];
  uVector[direction.uAxis] = width;
  vVector[direction.vAxis] = height;
  const corners: readonly [number, number, number][] = [
    base,
    addVector(base, uVector),
    addVector(addVector(base, uVector), vVector),
    addVector(base, vVector),
  ];
  const start = positions.length / 3;
  for (const corner of corners) {
    positions.push(corner[0] + offset[0], corner[1] + offset[1], corner[2] + offset[2]);
    normals.push(...direction.normal);
  }
  let group = indicesByColor.get(color);
  if (!group) {
    group = { materialKey: color, indices: [] };
    indicesByColor.set(color, group);
  }
  group.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function addVector(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function parseHexLinear(value: string): [number, number, number] {
  const color = normalizeColor(value);
  return [
    toLinear(Number.parseInt(color.slice(1, 3), 16) / 255),
    toLinear(Number.parseInt(color.slice(3, 5), 16) / 255),
    toLinear(Number.parseInt(color.slice(5, 7), 16) / 255),
  ];
}

function toLinear(srgb: number): number {
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function calculateBounds(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (const axis of [0, 1, 2] as const) {
      const value = positions[index + axis] ?? 0;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function concatenateBinary(chunks: readonly Uint8Array[], byteLength: number): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
