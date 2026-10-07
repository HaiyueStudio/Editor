import { selectionWeight, type Selection } from './selection.js';
import { IMAGE_LIMITS, pixelBytes, checkSize, findLayer, layerLocked, type Bitmap, type ImageLayer, type ImageState } from './document.js';

export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export type Color = readonly [number, number, number];
export function selectionRect(a: Point, b: Point, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.min(width, Math.floor(Math.min(a.x, b.x)))), y = Math.max(0, Math.min(height, Math.floor(Math.min(a.y, b.y))));
  const right = Math.max(0, Math.min(width, Math.ceil(Math.max(a.x, b.x)))), bottom = Math.max(0, Math.min(height, Math.ceil(Math.max(a.y, b.y))));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
export function parentOffset(layers: readonly ImageLayer[], id: string, x = 0, y = 0): Point | undefined {
  for (const layer of layers) {
    if (layer.id === id) return { x, y };
    const found = parentOffset(layer.children, id, x + layer.x, y + layer.y); if (found) return found;
  }
  return undefined;
}
export function editablePixel(state: ImageState, id: string): ImageLayer {
  const layer = findLayer(state.layers, id);
  if (!layer || layer.kind !== 'pixel') throw new Error('请先选择一个像素图层。');
  if(layer.content)throw new Error('请先栅格化文字或形状图层，再进行像素编辑。');
  if (layerLocked(state.layers, id)) throw new Error('图层或上级图层组已锁定。');
  return layer;
}
export function replacePixel(layers: readonly ImageLayer[], id: string, value: ImageLayer): readonly ImageLayer[] {
  return layers.map(layer => layer.id === id ? value : layer.children.length ? { ...layer, children: replacePixel(layer.children, id, value) } : layer);
}
export function hexColor(hex: string): Color {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('颜色无效。');
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
/** A stroke owns its buffers. Coverage is accumulated once, independent of pointer event frequency. */
export class PixelStroke {
  readonly layer: ImageLayer;
  private readonly original: Uint8ClampedArray;
  private readonly coverage: Uint8Array;
  private readonly bounds: Rect;
  private readonly selection: Selection | null | undefined;
  private readonly origin: Point;
  private previous: Point | undefined;
  changed = false;
  private dirty: Rect | undefined;
  changedBounds: Rect | undefined;
  takeDirty() { const rect = this.dirty; this.dirty = undefined; return rect; }
  constructor(state: ImageState, id: string, private size: number, private opacity: number, private color: Color, private erase = false) {
    if (!Number.isFinite(size) || size < 1 || size > 512 || !Number.isFinite(opacity) || opacity <= 0 || opacity > 1) throw new Error('画笔大小或不透明度无效。');
    const layer = editablePixel(state, id), parent = parentOffset(state.layers, id)!;
    this.selection = state.selection;
    this.bounds = state.selection ?? { x: 0, y: 0, width: state.width, height: state.height };
    // Include existing off-canvas pixels; painting must never flatten or discard them.
    const left = Math.min(layer.x, this.bounds.x - parent.x), top = Math.min(layer.y, this.bounds.y - parent.y);
    const right = Math.max(layer.x + (layer.bitmap?.width ?? 0), this.bounds.x + this.bounds.width - parent.x);
    const bottom = Math.max(layer.y + (layer.bitmap?.height ?? 0), this.bounds.y + this.bounds.height - parent.y);
    const width = right - left, height = bottom - top; checkSize(width, height);
    if (pixelBytes(state.layers) - (layer.bitmap?.data.byteLength ?? 0) + width * height * 4 > IMAGE_LIMITS.bytes) throw new Error('绘图超出文档像素预算，请缩小选区。');
    const data = new Uint8ClampedArray(width * height * 4);
    if (layer.bitmap) for (let y = 0; y < layer.bitmap.height; y++) {
      const offset = ((y + layer.y - top) * width + layer.x - left) * 4;
      data.set(layer.bitmap.data.subarray(y * layer.bitmap.width * 4, (y + 1) * layer.bitmap.width * 4), offset);
    }
    this.layer = { ...layer, x: left, y: top, bitmap: { width, height, data } };
    this.original = layer.bitmap && layer.bitmap.width === width && layer.bitmap.height === height && layer.x === left && layer.y === top ? layer.bitmap.data : data.slice(); this.coverage = new Uint8Array(width * height); this.origin = { x: left + parent.x, y: top + parent.y };
  }
  point(point: Point) {
    if (![point.x, point.y].every(Number.isFinite)) throw new Error('画笔坐标无效。');
    const a = this.previous ?? point, b = point; this.previous = point;
    const r = this.size / 2, bounds = this.bounds;
    const x0 = Math.max(bounds.x, Math.floor(Math.min(a.x, b.x) - r - 1)), x1 = Math.min(bounds.x + bounds.width, Math.ceil(Math.max(a.x, b.x) + r + 1));
    const y0 = Math.max(bounds.y, Math.floor(Math.min(a.y, b.y) - r - 1)), y1 = Math.min(bounds.y + bounds.height, Math.ceil(Math.max(a.y, b.y) + r + 1));
    if (x1 > x0 && y1 > y0) {
      const rect = { x: x0 - this.origin.x, y: y0 - this.origin.y, width: x1 - x0, height: y1 - y0 }, old = this.dirty;
      const left = Math.min(old?.x ?? rect.x, rect.x), top = Math.min(old?.y ?? rect.y, rect.y);
      this.dirty = { x: left, y: top, width: Math.max(old ? old.x + old.width : 0, rect.x + rect.width) - left, height: Math.max(old ? old.y + old.height : 0, rect.y + rect.height) - top };
    }
    if (this.dirty) {
      const a = this.changedBounds, b = this.dirty, x = Math.min(a?.x ?? b.x, b.x), y = Math.min(a?.y ?? b.y, b.y);
      this.changedBounds = { x, y, width: Math.max(a ? a.x + a.width : 0, b.x + b.width) - x, height: Math.max(a ? a.y + a.height : 0, b.y + b.height) - y };
    }
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy, bitmap = this.layer.bitmap!;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const t = length2 ? Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / length2)) : 0;
      const coverage = Math.round(selectionWeight(this.selection, x, y) * Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - a.x - t * dx, y + 0.5 - a.y - t * dy))) * 255);
      const p = (y - this.origin.y) * bitmap.width + x - this.origin.x;
      if (coverage <= this.coverage[p]!) continue; this.coverage[p] = coverage;
      const i = p * 4, sourceAlpha = coverage / 255 * this.opacity, oldAlpha = this.original[i + 3]! / 255;
      if (this.erase) bitmap.data[i + 3] = Math.round(oldAlpha * (1 - sourceAlpha) * 255);
      else {
        const alpha = sourceAlpha + oldAlpha * (1 - sourceAlpha);
        for (let c = 0; c < 3; c++) bitmap.data[i + c] = (this.color[c]! * sourceAlpha + this.original[i + c]! * oldAlpha * (1 - sourceAlpha)) / alpha;
        bitmap.data[i + 3] = alpha * 255;
      }
      for (let c = 0; c < 4; c++) if (bitmap.data[i + c] !== this.original[i + c]) this.changed = true;
    }
  }
}
export function fillPixels(state: ImageState, id: string, color: Color | null, opacity = 1): ImageLayer {
  const stroke = new PixelStroke(state, id, 1, opacity, color ?? [0, 0, 0], color === null);
  const layer = stroke.layer, bitmap = layer.bitmap!, offset = parentOffset(state.layers, id)!;
  const bounds = state.selection ?? { x: 0, y: 0, width: state.width, height: state.height };
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const i = ((y - layer.y - offset.y) * bitmap.width + x - layer.x - offset.x) * 4;
    const strength = opacity * selectionWeight(state.selection,x,y); if (!strength) continue;
    if (color === null) bitmap.data[i + 3] = bitmap.data[i + 3]! * (1-strength);
    else {
      const alpha = bitmap.data[i + 3]! / 255, out = strength + alpha * (1 - strength);
      for (let c = 0; c < 3; c++) bitmap.data[i + c] = (color[c]! * strength + bitmap.data[i + c]! * alpha * (1 - strength)) / out;
      bitmap.data[i + 3] = out * 255;
    }
  }
  return layer;
}
/** Deterministic nearest-neighbor resampling, including exact quarter-turns and flips. */
export function transformBitmap(source: Bitmap, width: number, height: number, angle: number, flipX = false, flipY = false): Bitmap {
  checkSize(width, height);
  if (!Number.isFinite(angle) || Math.abs(angle) > 360) throw new Error('旋转角度应在 -360°–360° 内。');
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const w = Math.ceil(Math.abs(width * cos) + Math.abs(height * sin) - 1e-8), h = Math.ceil(Math.abs(width * sin) + Math.abs(height * cos) - 1e-8); checkSize(w, h);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = x + 0.5 - w / 2, cy = y + 0.5 - h / 2;
    let sx = (cx * cos + cy * sin) / width + 0.5, sy = (-cx * sin + cy * cos) / height + 0.5;
    if (flipX) sx = 1 - sx; if (flipY) sy = 1 - sy;
    if (sx < 0 || sx >= 1 || sy < 0 || sy >= 1) continue;
    const from = (Math.floor(sy * source.height) * source.width + Math.floor(sx * source.width)) * 4;
    data.set(source.data.subarray(from, from + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}
