import { BasicMaterial, ColorSRGB, Geometry2D, Geometry3D, Material2D } from '@haiyue/engine';
import { Material, RadialShadowMaterial } from '@haiyue/engine/material';
import { isCompressedTextureSource } from '@haiyue/engine/assets';
import { toColorSRGB } from '@haiyue/engine/color';
import type { PrefabResourceItem } from '../types';
import type { SerializedEntity } from '../export/runtimeScene';
import { requiredNumberAt } from '../utils/arrayAccess';

export function isGPUTexture(value: unknown): value is GPUTexture {
  return typeof value === 'object' && value !== null && typeof (value as GPUTexture).createView === 'function';
}

export function getCanvasSourceSize(source: CanvasImageSource): { width: number; height: number } {
  if ('naturalWidth' in source) return { width: source.naturalWidth, height: source.naturalHeight };
  if ('displayWidth' in source) return { width: source.displayWidth, height: source.displayHeight };
  if ('videoWidth' in source) return { width: source.videoWidth, height: source.videoHeight };
  return { width: Number(source.width), height: Number(source.height) };
}

export function renderGeometryIcon(geometry: Geometry3D): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = 120;
  const height = 92;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0b1018';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#73b7ff';
  context.lineWidth = 1;

  const positions = geometry.positions;
  if (positions.length < 9) return canvas;

  const projected: Array<[number, number]> = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const angleY = -0.65;
  const angleX = 0.45;
  const cosY = Math.cos(angleY);
  const sinY = Math.sin(angleY);
  const cosX = Math.cos(angleX);
  const sinX = Math.sin(angleX);

  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x0 = requiredNumberAt(positions, i, '3D geometry positions');
    const y0 = requiredNumberAt(positions, i + 1, '3D geometry positions');
    const z0 = requiredNumberAt(positions, i + 2, '3D geometry positions');
    const x1 = x0 * cosY - z0 * sinY;
    const z1 = x0 * sinY + z0 * cosY;
    const y1 = y0 * cosX - z1 * sinX;
    const x = x1;
    const y = y1;
    projected.push([x, y]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((width - 24) / spanX, (height - 20) / spanY);
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;
  const drawPoint = (index: number): [number, number] => {
    const point = projected[index];
    if (!point) return [offsetX, height - offsetY];
    return [point[0] * scale + offsetX, height - (point[1] * scale + offsetY)];
  };

  const edges = new Set<string>();
  const addEdge = (a: number, b: number) => {
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    edges.add(`${min}:${max}`);
  };

  if (geometry.indices) {
    for (let i = 0; i + 2 < geometry.indices.length; i += 3) {
      const a = requiredNumberAt(geometry.indices, i, '3D geometry indices');
      const b = requiredNumberAt(geometry.indices, i + 1, '3D geometry indices');
      const c = requiredNumberAt(geometry.indices, i + 2, '3D geometry indices');
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }
  } else {
    for (let i = 0; i < projected.length; i += 3) {
      addEdge(i, i + 1);
      addEdge(i + 1, i + 2);
      addEdge(i + 2, i);
    }
  }

  context.beginPath();
  for (const edge of edges) {
    const edgeIndices = edge.split(':').map(Number);
    const a = requiredNumberAt(edgeIndices, 0, 'geometry edge');
    const b = requiredNumberAt(edgeIndices, 1, 'geometry edge');
    const pa = drawPoint(a);
    const pb = drawPoint(b);
    context.moveTo(pa[0], pa[1]);
    context.lineTo(pb[0], pb[1]);
  }
  context.stroke();
  return canvas;
}

export function renderGeometry2DIcon(geometry: Geometry2D): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = 120;
  const height = 92;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0b1018';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#8bdc7f';
  context.lineWidth = 1.4;

  const positions = geometry.positions;
  if (positions.length < 4) return canvas;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < positions.length; i += 2) {
    const x = requiredNumberAt(positions, i, '2D geometry positions');
    const y = requiredNumberAt(positions, i + 1, '2D geometry positions');
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((width - 24) / spanX, (height - 20) / spanY);
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;
  const drawPoint = (index: number): [number, number] => [
    requiredNumberAt(positions, index * 2, '2D geometry positions') * scale + offsetX,
    height - (requiredNumberAt(positions, index * 2 + 1, '2D geometry positions') * scale + offsetY),
  ];

  context.beginPath();
  const topology = geometry.topology ?? 'triangle-list';
  if (topology === 'point-list') {
    const indices = geometry.indices ?? new Uint16Array(Array.from({ length: geometry.vertexCount }, (_, index) => index));
    for (let i = 0; i < indices.length; i++) {
      const point = drawPoint(requiredNumberAt(indices, i, '2D point indices'));
      context.moveTo(point[0] + 2, point[1]);
      context.arc(point[0], point[1], 2, 0, Math.PI * 2);
    }
  } else if (topology === 'line-list' || topology === 'line-strip') {
    const indices = geometry.indices ?? new Uint16Array(Array.from({ length: geometry.vertexCount }, (_, index) => index));
    const step = topology === 'line-list' ? 2 : 1;
    const limit = topology === 'line-list' ? indices.length - 1 : indices.length - 1;
    for (let i = 0; i < limit; i += step) {
      const a = drawPoint(requiredNumberAt(indices, i, '2D line indices'));
      const b = drawPoint(requiredNumberAt(indices, i + 1, '2D line indices'));
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
    }
  } else if (geometry.indices) {
    for (let i = 0; i + 2 < geometry.indices.length; i += 3) {
      const a = drawPoint(requiredNumberAt(geometry.indices, i, '2D triangle indices'));
      const b = drawPoint(requiredNumberAt(geometry.indices, i + 1, '2D triangle indices'));
      const c = drawPoint(requiredNumberAt(geometry.indices, i + 2, '2D triangle indices'));
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.lineTo(c[0], c[1]);
      context.closePath();
    }
  } else {
    const count = geometry.vertexCount;
    const first = drawPoint(0);
    context.moveTo(first[0], first[1]);
    for (let i = 1; i < count; i++) {
      const point = drawPoint(i);
      context.lineTo(point[0], point[1]);
    }
    context.closePath();
  }
  context.stroke();
  return canvas;
}

function drawMaterialSphere(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: ColorSRGB,
  image?: CanvasImageSource,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const radius = 28;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0b1018';
  context.fillRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.clip();

  if (image) {
    const imageSize = getCanvasSourceSize(image);
    const scale = Math.max((radius * 2) / imageSize.width, (radius * 2) / imageSize.height);
    const drawWidth = imageSize.width * scale;
    const drawHeight = imageSize.height * scale;
    context.drawImage(image, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);
    context.fillStyle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${Math.max(0, 1 - color.a)})`;
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    const gradient = context.createRadialGradient(cx - 10, cy - 12, 4, cx, cy, radius);
    gradient.addColorStop(0, `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`);
    gradient.addColorStop(0.58, `rgba(${Math.round(color.r * 190)}, ${Math.round(color.g * 190)}, ${Math.round(color.b * 190)}, ${color.a})`);
    gradient.addColorStop(1, `rgba(${Math.round(color.r * 70)}, ${Math.round(color.g * 70)}, ${Math.round(color.b * 70)}, ${color.a})`);
    context.fillStyle = gradient;
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  const shade = context.createRadialGradient(cx - 11, cy - 13, 3, cx, cy, radius);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
  shade.addColorStop(0.42, 'rgba(255, 255, 255, 0.02)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  context.fillStyle = shade;
  context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  context.restore();

  context.strokeStyle = '#73b7ff';
  context.globalAlpha = 0.45;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 1;
}

export function renderMaterialIcon(material: Material): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = 120;
  const height = 92;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  if (material instanceof RadialShadowMaterial) {
    context.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const radius = 34;
    const gradient = context.createRadialGradient(cx, cy, Math.max(0, material.innerRadius) * radius, cx, cy, radius);
    const radialColor = toColorSRGB(material.color);
    const [r, g, b] = [radialColor.r, radialColor.g, radialColor.b]
      .map(value => Math.round(Math.max(0, Math.min(1, value)) * 255));
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, material.opacity))})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    context.fillStyle = gradient;
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    context.fillStyle = '#aebbd0';
    context.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    context.textAlign = 'center';
    context.fillText('shadow', width / 2, 78);
    return canvas;
  }

  const color = material instanceof BasicMaterial ? toColorSRGB(material.color) : new ColorSRGB(0.75, 0.82, 0.92, 1);
  drawMaterialSphere(context, width, height, color);

  if (!(material instanceof BasicMaterial) || !material.texture || isGPUTexture(material.texture) || isCompressedTextureSource(material.texture)) return canvas;

  if (material.texture instanceof ImageBitmap || material.texture instanceof HTMLCanvasElement) {
    drawMaterialSphere(context, width, height, color, material.texture);
  } else if (material.texture instanceof HTMLImageElement) {
    if (material.texture.complete) drawMaterialSphere(context, width, height, color, material.texture);
    else material.texture.addEventListener('load', () => drawMaterialSphere(context, width, height, color, material.texture as HTMLImageElement), { once: true });
  } else if (typeof material.texture === 'string') {
    const image = new Image();
    image.onload = () => drawMaterialSphere(context, width, height, color, image);
    image.src = material.texture;
  }
  return canvas;
}

export function renderMaterial2DIcon(material: Material2D): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = 120;
  const height = 92;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.fillStyle = '#0b1018';
  context.fillRect(0, 0, width, height);
  const color = toColorSRGB(material.color);
  context.fillStyle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
  context.fillRect(30, 22, 60, 42);
  context.strokeStyle = '#8bdc7f';
  context.lineWidth = 1.5;
  context.strokeRect(30, 22, 60, 42);
  context.fillStyle = '#aebbd0';
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.fillText('2D', width / 2, 78);
  return canvas;
}

export function renderModelIcon(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = 120;
  const height = 92;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.fillStyle = '#0b1018';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#9cc7ff';
  context.fillStyle = 'rgba(115, 183, 255, 0.12)';
  context.lineWidth = 1.8;
  context.beginPath();
  context.moveTo(60, 15);
  context.lineTo(88, 31);
  context.lineTo(88, 63);
  context.lineTo(60, 79);
  context.lineTo(32, 63);
  context.lineTo(32, 31);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(32, 31);
  context.lineTo(60, 47);
  context.lineTo(88, 31);
  context.moveTo(60, 47);
  context.lineTo(60, 79);
  context.stroke();
  context.fillStyle = '#d8e2f2';
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.fillText('glTF', width / 2, 12);
  return canvas;
}

export function renderPrefabIcon(item: PrefabResourceItem): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = 120;
  const height = 92;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.fillStyle = '#0b1018';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#73b7ff';
  context.fillStyle = 'rgba(115, 183, 255, 0.14)';
  context.lineWidth = 2;
  context.fillRect(34, 18, 52, 42);
  context.strokeRect(34, 18, 52, 42);
  context.strokeStyle = 'rgba(115, 183, 255, 0.68)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(60, 60);
  context.lineTo(60, 74);
  context.moveTo(36, 74);
  context.lineTo(84, 74);
  context.moveTo(36, 74);
  context.lineTo(36, 82);
  context.moveTo(60, 74);
  context.lineTo(60, 82);
  context.moveTo(84, 74);
  context.lineTo(84, 82);
  context.stroke();
  context.fillStyle = '#d8e2f2';
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.fillText(`${countSerializedEntities(item.root)} entities`, width / 2, 12);
  return canvas;
}

export function countSerializedEntities(entity: SerializedEntity): number {
  return 1 + entity.children.reduce((sum, child) => sum + countSerializedEntities(child), 0);
}
