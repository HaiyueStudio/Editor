import { pixelStorageBytes } from './pagedPixels.js';
import { mapCmykGeometry } from './cmykGeometry.js';
import { pixelColor, pixelArray, withPixels, type PixelArray } from './pixelFormat.js';
import { resizeBitmap, rotateBitmap, validateResampling, type Resampling } from './resampling.js';
import { selectionWeight, type Selection } from './selection.js';
import { IMAGE_LIMITS, pixelBytes, checkSize, findLayer, layerLocked, type Bitmap, type ImageLayer, type ImageState } from './document.js';

export interface Point { x: number; y: number }
export interface BrushPoint extends Point { pressure?:number }
export interface BrushDynamics { coverageOnly?:boolean; hardness?:number; pressure?:'none'|'size'|'opacity'|'both'; sample?:(x:number,y:number)=>readonly [number,number,number,number]|undefined }
/** Sparse 128px tiles: a small mark on a large canvas needs only touched coverage tiles. */
class StrokeCoverage {
 private tiles=new Map<number,Uint8Array>();
 constructor(private width:number){}
 get bytes(){return this.tiles.size*16384;}
 increase(x:number,y:number,value:number){const columns=Math.ceil(this.width/128),key=Math.floor(y/128)*columns+Math.floor(x/128),i=(y%128)*128+x%128;let tile=this.tiles.get(key);if(!tile){if(!value)return false;tile=new Uint8Array(16384);this.tiles.set(key,tile);}if(value<=tile[i]!)return false;tile[i]=value;return true;}
}
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
  if (layerLocked(state.layers, id,'pixels')) throw new Error('图层或上级图层组已锁定。');
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
  private readonly original: PixelArray;
  private readonly alphaLocked:boolean;
  private readonly coverage: StrokeCoverage;
  get coverageBytes(){return this.coverage.bytes;}
  private readonly bounds: Rect;
  private readonly selection: Selection | null | undefined;
  private readonly origin: Point;
  private previous: BrushPoint | undefined;
  changed = false;
  private dirty: Rect | undefined;
  changedBounds: Rect | undefined;
  takeDirty() { const rect = this.dirty; this.dirty = undefined; return rect; }
  constructor(state: ImageState, id: string, private size: number, private opacity: number, private color: Color, private erase = false, private dynamics:BrushDynamics = {}) {
    if (!Number.isFinite(size) || size < 1 || size > 512 || !Number.isFinite(opacity) || opacity <= 0 || opacity > 1) throw new Error('画笔大小或不透明度无效。');
    if(!Number.isFinite(dynamics.hardness??1)||(dynamics.hardness??1)<0||(dynamics.hardness??1)>1||!['none','size','opacity','both'].includes(dynamics.pressure??'none'))throw new Error('画笔硬度或笔压模式无效。');
    this.color=pixelColor(color,state.bitDepth??8) as unknown as Color;
    const layer = editablePixel(state, id), parent = parentOffset(state.layers, id)!;
    this.alphaLocked=!dynamics.coverageOnly&&layerLocked(state.layers,id,'transparency');
    this.selection = state.selection;
    this.bounds = state.selection ?? { x: 0, y: 0, width: state.width, height: state.height };
    // Include existing off-canvas pixels; painting must never flatten or discard them.
    const left = Math.min(layer.x, this.bounds.x - parent.x), top = Math.min(layer.y, this.bounds.y - parent.y);
    const right = Math.max(layer.x + (layer.bitmap?.width ?? 0), this.bounds.x + this.bounds.width - parent.x);
    const bottom = Math.max(layer.y + (layer.bitmap?.height ?? 0), this.bounds.y + this.bounds.height - parent.y);
    const width = right - left, height = bottom - top; checkSize(width, height);
    if (pixelBytes(state.layers) - (layer.bitmap?pixelStorageBytes(layer.bitmap):0) + width * height * ((state.bitDepth??8)===8?4:16) > IMAGE_LIMITS.bytes) throw new Error('绘图超出文档像素预算，请缩小选区。');
    const data = pixelArray(width * height * 4,state.bitDepth??8);
    if (layer.bitmap) for (let y = 0; y < layer.bitmap.height; y++) {
      const offset = ((y + layer.y - top) * width + layer.x - left) * 4;
      data.set(layer.bitmap.data.subarray(y * layer.bitmap.width * 4, (y + 1) * layer.bitmap.width * 4), offset);
    }
    this.layer = { ...layer, x: left, y: top, bitmap: withPixels(width,height,data,state.bitDepth??8) };
    this.original = layer.bitmap && layer.bitmap.width === width && layer.bitmap.height === height && layer.x === left && layer.y === top ? layer.bitmap.data : data.slice(); this.coverage = new StrokeCoverage(width); this.origin = { x: left + parent.x, y: top + parent.y };
  }
  point(point: BrushPoint) {
    if (![point.x, point.y].every(Number.isFinite)||!Number.isFinite(point.pressure??1)||(point.pressure??1)<0||(point.pressure??1)>1) throw new Error('画笔坐标或笔压无效。');
    const a=this.previous??point,b={...point};this.previous=b;
    // Short segments avoid scanning the empty bounding rectangle of long diagonal strokes.
    const pieces=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/Math.max(8,this.size/2)));
    for(let k=0;k<pieces;k++){const at=(t:number):BrushPoint=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,pressure:(a.pressure??1)+((b.pressure??1)-(a.pressure??1))*t});this.segment(at(k/pieces),at((k+1)/pieces));}
  }
  private segment(a:BrushPoint,b:BrushPoint) {
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
      const pressure=(a.pressure??1)+((b.pressure??1)-(a.pressure??1))*t,mode=this.dynamics.pressure??'none',radius=r*(mode==='size'||mode==='both'?pressure:1),distance=Math.hypot(x+.5-a.x-t*dx,y+.5-a.y-t*dy),hardness=this.dynamics.hardness??1;
      if((mode==='size'||mode==='both')&&pressure===0)continue;
      const edge=Math.max(0,Math.min(1,radius+.5-distance)),soft=hardness===1?1:Math.max(0,Math.min(1,(radius-Math.max(0,distance-.5))/Math.max(.5,radius*(1-hardness))));
      const coverage=Math.round(selectionWeight(this.selection,x,y)*edge*soft*(mode==='opacity'||mode==='both'?pressure:1)*255);
      if(!coverage)continue;
      const localX=x-this.origin.x,localY=y-this.origin.y,p=localY*bitmap.width+localX,sample=this.dynamics.sample?.(x,y);
      if(this.dynamics.sample&&!sample||!this.coverage.increase(localX,localY,coverage))continue;
      const i=p*4,sourceAlpha=coverage/255*this.opacity*(sample?sample[3]/255:1),oldAlpha=this.original[i+3]!/255,tone=sample??this.color;
      if(!sourceAlpha)continue;
      if(this.alphaLocked){if(!oldAlpha||this.erase)continue;for(let c=0;c<3;c++)bitmap.data[i+c]=tone[c]!*sourceAlpha+this.original[i+c]!*(1-sourceAlpha);}
      else if (this.erase) bitmap.data[i + 3] = oldAlpha * (1 - sourceAlpha) * 255;
      else {
        const alpha = sourceAlpha + oldAlpha * (1 - sourceAlpha);
        for (let c = 0; c < 3; c++) bitmap.data[i + c] = (tone[c]! * sourceAlpha + this.original[i + c]! * oldAlpha * (1 - sourceAlpha)) / alpha;
        bitmap.data[i + 3] = alpha * 255;
      }
      for (let c = 0; c < 4; c++) if (bitmap.data[i + c] !== this.original[i + c]) this.changed = true;
    }
  }
}
export function fillPixels(state: ImageState, id: string, color: Color | null, opacity = 1): ImageLayer {
  const stroke = new PixelStroke(state, id, 1, opacity, color ?? [0, 0, 0], color === null);
  if(color)color=pixelColor(color,state.bitDepth??8) as unknown as Color;
  const layer = stroke.layer, bitmap = layer.bitmap!, offset = parentOffset(state.layers, id)!;
  const bounds = state.selection ?? { x: 0, y: 0, width: state.width, height: state.height };
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const i = ((y - layer.y - offset.y) * bitmap.width + x - layer.x - offset.x) * 4;
    const strength = opacity * selectionWeight(state.selection,x,y); if (!strength) continue;
    if(layerLocked(state.layers,id,'transparency')){if(!bitmap.data[i+3]||color===null)continue;for(let c=0;c<3;c++)bitmap.data[i+c]=color[c]!*strength+bitmap.data[i+c]!*(1-strength);}
    else if (color === null) bitmap.data[i + 3] = bitmap.data[i + 3]! * (1-strength);
    else {
      const alpha = bitmap.data[i + 3]! / 255, out = strength + alpha * (1 - strength);
      for (let c = 0; c < 3; c++) bitmap.data[i + c] = (color[c]! * strength + bitmap.data[i + c]! * alpha * (1 - strength)) / out;
      bitmap.data[i + 3] = out * 255;
    }
  }
  return layer;
}
/** Explicit resampling; nearest remains available for pixel art. */
export function transformBitmap(source: Bitmap, width: number, height: number, angle: number, flipX = false, flipY = false, resampling:Resampling = 'bicubic'): Bitmap {
  checkSize(width, height);
  if (!Number.isFinite(angle) || Math.abs(angle) > 360) throw new Error('旋转角度应在 -360°–360° 内。');
  validateResampling(resampling);
  if(source.cmyk)return mapCmykGeometry(source,b=>transformBitmap(b,width,height,angle,flipX,flipY,resampling));
  if(resampling!=='nearest'){const scaled=resizeBitmap(source,width,height,resampling);return angle===0&&!flipX&&!flipY?scaled:rotateBitmap(scaled,angle,flipX,flipY,resampling);}
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const w = Math.ceil(Math.abs(width * cos) + Math.abs(height * sin) - 1e-8), h = Math.ceil(Math.abs(width * sin) + Math.abs(height * cos) - 1e-8); checkSize(w, h);
  const data = pixelArray(w * h * 4,source);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = x + 0.5 - w / 2, cy = y + 0.5 - h / 2;
    let sx = (cx * cos + cy * sin) / width + 0.5, sy = (-cx * sin + cy * cos) / height + 0.5;
    if (flipX) sx = 1 - sx; if (flipY) sy = 1 - sy;
    if (sx < 0 || sx >= 1 || sy < 0 || sy >= 1) continue;
    const from = (Math.floor(sy * source.height) * source.width + Math.floor(sx * source.width)) * 4;
    data.set(source.data.subarray(from, from + 4), (y * w + x) * 4);
  }
  return withPixels(w,h,data,source);
}
