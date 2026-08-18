import { BasicMaterial, Entity, Mesh3D } from '@haiyue/engine';
import { Transform3D } from '@haiyue/engine/components';
import { toColorSRGB } from '@haiyue/engine/color';
import { isCompressedTextureSource } from '@haiyue/engine/assets';
import {
  disposeGltfModel,
  loadGltfModel,
  type GltfAssetStats,
  type GltfCompatibilityReport,
} from '@haiyue/extensions/gltf';
import { mat4 } from 'wgpu-matrix';
import { isGPUTexture } from './icons';
import { requiredItemAt, requiredNumberAt } from '../utils/arrayAccess';

export interface ModelPreviewData {
  previewUrl?: string;
  vertexCount: number;
  triangleCount: number;
  assetStats: GltfAssetStats;
  compatibilityReport: GltfCompatibilityReport;
}

interface ModelPreviewTriangle {
  points: Array<[number, number, number]>;
  depth: number;
  color: string;
}

interface TexturePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type UpdateWorldMatrix = (entity: Entity) => void;

const modelPreviewTextureCache = new Map<string, Promise<TexturePixels | null>>();

function transformPoint3D(matrix: Float32Array, x: number, y: number, z: number): [number, number, number] {
  return [
    requiredNumberAt(matrix, 0, 'model world matrix') * x
      + requiredNumberAt(matrix, 4, 'model world matrix') * y
      + requiredNumberAt(matrix, 8, 'model world matrix') * z
      + requiredNumberAt(matrix, 12, 'model world matrix'),
    requiredNumberAt(matrix, 1, 'model world matrix') * x
      + requiredNumberAt(matrix, 5, 'model world matrix') * y
      + requiredNumberAt(matrix, 9, 'model world matrix') * z
      + requiredNumberAt(matrix, 13, 'model world matrix'),
    requiredNumberAt(matrix, 2, 'model world matrix') * x
      + requiredNumberAt(matrix, 6, 'model world matrix') * y
      + requiredNumberAt(matrix, 10, 'model world matrix') * z
      + requiredNumberAt(matrix, 14, 'model world matrix'),
  ];
}

function projectModelPreviewPoint(point: [number, number, number]): [number, number, number] {
  const [x, y, z] = point;
  const yaw = -Math.PI / 5;
  const pitch = Math.PI / 8;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosX = Math.cos(pitch);
  const sinX = Math.sin(pitch);
  const rx = x * cosY - z * sinY;
  const rz = x * sinY + z * cosY;
  const ry = y * cosX - rz * sinX;
  const depth = y * sinX + rz * cosX;
  return [rx, ry, depth];
}

function getModelMeshBaseColor(mesh: Mesh3D): [number, number, number, number] {
  if (mesh.material instanceof BasicMaterial) {
    const color = toColorSRGB(mesh.material.color);
    return [color.r, color.g, color.b, Math.max(0.22, color.a)];
  }
  return [0.53, 0.72, 1, 0.62];
}

function colorTupleToCss(color: [number, number, number, number], shade = 1): string {
  return `rgba(${Math.round(Math.max(0, Math.min(1, color[0] * shade)) * 255)}, ${Math.round(Math.max(0, Math.min(1, color[1] * shade)) * 255)}, ${Math.round(Math.max(0, Math.min(1, color[2] * shade)) * 255)}, ${color[3]})`;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load model texture.'));
    image.src = src;
  });
}

async function getTexturePixels(source: BasicMaterial['texture']): Promise<TexturePixels | null> {
  if (!source || isGPUTexture(source)) return null;
  if (isCompressedTextureSource(source)) return null;
  if (source instanceof ImageBitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  }
  if (source instanceof HTMLCanvasElement) {
    const context = source.getContext('2d');
    if (!context) return null;
    return { width: source.width, height: source.height, data: context.getImageData(0, 0, source.width, source.height).data };
  }
  if (source instanceof HTMLImageElement) {
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const context = canvas.getContext('2d');
    if (!context || canvas.width <= 0 || canvas.height <= 0) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  }
  if (typeof source !== 'string') return null;
  let promise = modelPreviewTextureCache.get(source);
  if (!promise) {
    promise = loadImageElement(source).then(image => getTexturePixels(image)).catch(() => null);
    modelPreviewTextureCache.set(source, promise);
  }
  return promise;
}

function sampleTextureColor(texture: TexturePixels | null, u: number, v: number): [number, number, number, number] | null {
  if (!texture) return null;
  const wrappedU = ((u % 1) + 1) % 1;
  const wrappedV = ((v % 1) + 1) % 1;
  const x = Math.max(0, Math.min(texture.width - 1, Math.floor(wrappedU * texture.width)));
  const y = Math.max(0, Math.min(texture.height - 1, Math.floor((1 - wrappedV) * texture.height)));
  const offset = (y * texture.width + x) * 4;
  return [
    requiredNumberAt(texture.data, offset, 'model preview texture pixels') / 255,
    requiredNumberAt(texture.data, offset + 1, 'model preview texture pixels') / 255,
    requiredNumberAt(texture.data, offset + 2, 'model preview texture pixels') / 255,
    requiredNumberAt(texture.data, offset + 3, 'model preview texture pixels') / 255,
  ];
}

function multiplyColor(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2], Math.max(0.22, a[3] * b[3])];
}

async function createModelSnapshot(root: Entity, updateWorldMatrix: UpdateWorldMatrix): Promise<{ previewUrl: string | undefined; vertexCount: number; triangleCount: number }> {
  const width = 120;
  const height = 92;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return { previewUrl: undefined, vertexCount: 0, triangleCount: 0 };

  const triangles: ModelPreviewTriangle[] = [];
  let vertexCount = 0;
  let triangleCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = async (entity: Entity): Promise<void> => {
    const mesh = entity.getComponent(Mesh3D);
    if (mesh) {
      updateWorldMatrix(entity);
      const transform = entity.getComponent(Transform3D);
      const worldMatrix = transform?.worldMatrix ?? mat4.identity() as Float32Array;
      const geometry = mesh.geometry;
      const projected: Array<[number, number, number]> = [];
      const uvs = geometry.getTextureCoordinatesForChannel(0);
      for (let i = 0; i + 2 < geometry.positions.length; i += 3) {
        const point = projectModelPreviewPoint(transformPoint3D(
          worldMatrix,
          requiredNumberAt(geometry.positions, i, 'model positions'),
          requiredNumberAt(geometry.positions, i + 1, 'model positions'),
          requiredNumberAt(geometry.positions, i + 2, 'model positions'),
        ));
        projected.push(point);
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
      vertexCount += geometry.vertexCount;
      const indices = geometry.indices;
      const baseColor = getModelMeshBaseColor(mesh);
      const texture = mesh.material instanceof BasicMaterial ? await getTexturePixels(mesh.material.texture) : null;
      const getTriangleColor = (aIndex: number, bIndex: number, cIndex: number): string => {
        let color = baseColor;
        if (uvs && texture) {
          const u = (requiredNumberAt(uvs, aIndex * 2, 'model UVs')
            + requiredNumberAt(uvs, bIndex * 2, 'model UVs')
            + requiredNumberAt(uvs, cIndex * 2, 'model UVs')) / 3;
          const v = (requiredNumberAt(uvs, aIndex * 2 + 1, 'model UVs')
            + requiredNumberAt(uvs, bIndex * 2 + 1, 'model UVs')
            + requiredNumberAt(uvs, cIndex * 2 + 1, 'model UVs')) / 3;
          const texColor = sampleTextureColor(texture, u, v);
          if (texColor) color = multiplyColor(baseColor, texColor);
        }
        return colorTupleToCss(color);
      };
      if (indices) {
        triangleCount += Math.floor(indices.length / 3);
        for (let i = 0; i < indices.length - 2; i += 3) {
          const aIndex = requiredNumberAt(indices, i, 'model triangle indices');
          const bIndex = requiredNumberAt(indices, i + 1, 'model triangle indices');
          const cIndex = requiredNumberAt(indices, i + 2, 'model triangle indices');
          const a = projected[aIndex];
          const b = projected[bIndex];
          const c = projected[cIndex];
          if (!a || !b || !c) continue;
          triangles.push({ points: [a, b, c], depth: (a[2] + b[2] + c[2]) / 3, color: getTriangleColor(aIndex, bIndex, cIndex) });
        }
      } else {
        triangleCount += Math.floor(geometry.vertexCount / 3);
        for (let i = 0; i < projected.length - 2; i += 3) {
          const a = requiredItemAt(projected, i, 'projected model vertices');
          const b = requiredItemAt(projected, i + 1, 'projected model vertices');
          const c = requiredItemAt(projected, i + 2, 'projected model vertices');
          triangles.push({ points: [a, b, c], depth: (a[2] + b[2] + c[2]) / 3, color: getTriangleColor(i, i + 1, i + 2) });
        }
      }
    }
    for (const child of entity.children) await visit(child);
  };
  await visit(root);

  context.fillStyle = '#0b1018';
  context.fillRect(0, 0, width, height);
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || triangles.length === 0) {
    return { previewUrl: canvas.toDataURL('image/png'), vertexCount, triangleCount };
  }

  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((width - 20) / spanX, (height - 18) / spanY);
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;
  const toCanvasPoint = (point: [number, number, number]): [number, number] => [
    point[0] * scale + offsetX,
    height - (point[1] * scale + offsetY),
  ];

  triangles.sort((a, b) => a.depth - b.depth);
  context.lineWidth = 0.8;
  for (const triangle of triangles.slice(-1200)) {
    const a = toCanvasPoint(requiredItemAt(triangle.points, 0, 'model preview triangle'));
    const b = toCanvasPoint(requiredItemAt(triangle.points, 1, 'model preview triangle'));
    const c = toCanvasPoint(requiredItemAt(triangle.points, 2, 'model preview triangle'));
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.lineTo(c[0], c[1]);
    context.closePath();
    context.fillStyle = triangle.color;
    context.fill();
    context.strokeStyle = 'rgba(216, 226, 242, 0.18)';
    context.stroke();
  }
  return { previewUrl: canvas.toDataURL('image/png'), vertexCount, triangleCount };
}

export async function createModelPreviewData(src: string, updateWorldMatrix: UpdateWorldMatrix): Promise<ModelPreviewData> {
  const model = await loadGltfModel(src);
  try {
    const snapshot = await createModelSnapshot(model.root, updateWorldMatrix);
    return {
      ...(snapshot.previewUrl === undefined ? {} : { previewUrl: snapshot.previewUrl }),
      vertexCount: snapshot.vertexCount,
      triangleCount: snapshot.triangleCount,
      assetStats: model.assetStats,
      compatibilityReport: model.compatibilityReport,
    };
  } finally {
    disposeGltfModel(model);
  }
}
