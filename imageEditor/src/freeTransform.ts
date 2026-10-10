import { snapMove } from './layout.js';
import type { Resampling } from './resampling.js';
import { smartTransform } from './smartObject.js';
import { ImageDocument, layerLocked, type ImageLayer, type ImageState } from './document.js';
import { CanvasView } from './canvasView.js';
import { parentOffset, replacePixel, transformBitmap, type Point } from './pixelTools.js';
export interface TransformValues { width: number; height: number; angle: number; dx: number; dy: number; flipX?: boolean; flipY?: boolean; resampling?:Resampling }
export function transformedLayer(state: ImageState, id: string, value: TransformValues): ImageLayer {
  const find = (layers: readonly ImageLayer[]): ImageLayer | undefined => { for (const layer of layers) { if (layer.id === id) return layer; const child = find(layer.children); if (child) return child; } };
  const layer = find(state.layers);
  if (!layer?.bitmap || layer.kind !== 'pixel' || layerLocked(state.layers, id,'position')) throw new Error('请选择未锁定的像素图层。');
  if(layer.filterMask)throw new Error('变换前请移除滤镜蒙版，或先栅格化智能对象以保留滤镜外观。');
  if (layer.content?.type !== 'smart' && layer.content || layer.mask) throw new Error('请先栅格化文字／形状，或应用图层蒙版后变换。');
  if (![value.dx, value.dy].every(n => Number.isInteger(n) && Math.abs(n) <= 32768)) throw new Error('移动距离无效。');
  if(layer.content?.type==='smart')return smartTransform(state,layer,value.width,value.height,value.angle,value.dx,value.dy,value.flipX,value.flipY,value.resampling);
  const bitmap = transformBitmap(layer.bitmap, value.width, value.height, value.angle, value.flipX ?? false, value.flipY ?? false,value.resampling);
  return { ...layer, bitmap, x: Math.round(layer.x + (layer.bitmap.width - bitmap.width) / 2 + value.dx), y: Math.round(layer.y + (layer.bitmap.height - bitmap.height) / 2 + value.dy) };
}
export function commitTransform(doc:ImageDocument,layer:ImageLayer,label='自由变换',revision=doc.revision) {
 if(layer.content?.type==='smart')doc.commitLayers(label,replacePixel(doc.state.layers,layer.id,layer),[layer.id],doc.selectedIds,revision,'transform');
 else doc.replaceLayerPixels(layer.id,layer,label,revision,undefined,'transform');
}
/** One immutable source for every preview, and one history entry on explicit confirmation. */
export class FreeTransform {
  private session: { doc: ImageDocument; before: ImageState; layer: ImageLayer; value: TransformValues; center: Point } | undefined;
  private drag: { pointer: number; handle: string; start: Point; value: TransformValues } | undefined;
  private frame: number | undefined;
  private abort = new AbortController();
  private box = document.createElement('div');
  constructor(private active: () => ImageDocument | undefined, private view: CanvasView, private notify: (message: string, error?: boolean) => void) {
    this.box.id = 'free-transform'; this.box.hidden = true; this.box.tabIndex = 0; this.box.setAttribute('aria-label', '自由变换：拖动移动，手柄缩放，顶部圆点旋转，Enter 确认，Esc 取消');
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate']) { const button = document.createElement('button'); button.type = 'button'; button.dataset.handle = handle; button.setAttribute('aria-label', handle === 'rotate' ? '旋转' : `缩放 ${handle}`); this.box.append(button); }
    document.getElementById('artboard')!.append(this.box);
    const signal = this.abort.signal;
    this.box.addEventListener('pointerdown', event => {
      if (event.button || !this.session) return;
      event.stopPropagation(); event.preventDefault(); this.box.focus();
      this.drag = { pointer: event.pointerId, handle: (event.target as HTMLElement).dataset.handle ?? 'move', start: view.point(event), value: { ...this.session.value } };
      this.box.setPointerCapture(event.pointerId);
    }, { signal });
    this.box.addEventListener('pointermove', event => { if (this.drag?.pointer === event.pointerId) this.guard(() => this.update(view.point(event),event.altKey)); }, { signal });
    this.box.addEventListener('pointerup', event => { if (this.drag?.pointer !== event.pointerId) return; this.guard(() => this.update(view.point(event),event.altKey)); this.drag = undefined; if (this.box.hasPointerCapture(event.pointerId)) this.box.releasePointerCapture(event.pointerId); }, { signal });
    this.box.addEventListener('lostpointercapture', event => { if (this.drag?.pointer === event.pointerId) this.cancel(); }, { signal });
    this.box.addEventListener('pointercancel', () => this.cancel(), { signal });
    window.addEventListener('blur', () => this.cancel(), { signal });
    document.addEventListener('keydown', event => {
      if (!this.session || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); this.guard(() => event.key === 'Enter' ? this.commit() : this.cancel()); }
    }, { signal, capture: true });
  }
  get busy() { return Boolean(this.session); }
  start() {
    this.cancel(); const doc = this.active(), layer = doc?.selected;
    if (!doc || !layer?.bitmap || doc.selectedIds.length !== 1) throw new Error('自由变换需要选择一个像素图层。');
    const value:TransformValues = layer.content?.type==='smart'?{...layer.content.transform,dx:0,dy:0}:{ width: layer.bitmap.width, height: layer.bitmap.height, angle: 0, dx: 0, dy: 0 };
    value.resampling=(document.getElementById('resampling-method') as HTMLSelectElement).value as Resampling;
    // Validate before entering the interactive mode.
    transformedLayer(doc.state, layer.id, value);
    const parent = parentOffset(doc.state.layers, layer.id)!;
    this.session = { doc, before: doc.state, layer, value, center: { x: parent.x + layer.x + layer.bitmap.width / 2, y: parent.y + layer.y + layer.bitmap.height / 2 } };
    this.draw(); this.box.focus(); this.notify('自由变换：拖动移动 · 手柄缩放 · 顶部圆点旋转 · Enter 确认 / Esc 取消');
  }
  sync() { if (this.session && (this.active() !== this.session.doc || this.session.doc.state !== this.session.before)) this.cancel(); }
  private guard(action: () => void) { try { action(); } catch (error) { this.cancel(); this.notify(error instanceof Error ? error.message : String(error), true); } }
  private update(point: Point,bypass=false) {
    const s = this.session!, d = this.drag!, v = { ...d.value }, dx = point.x - d.start.x, dy = point.y - d.start.y;
    if (d.handle === 'move') { v.dx += Math.round(dx); v.dy += Math.round(dy);if(!bypass){const delta=snapMove(s.before,[s.layer.id],{x:v.dx,y:v.dy},this.view.scale);v.dx=delta.x;v.dy=delta.y;} }
    else if (d.handle === 'rotate') {
      const cx = s.center.x + v.dx, cy = s.center.y + v.dy;
      v.angle = ((v.angle + (Math.atan2(point.y - cy, point.x - cx) - Math.atan2(d.start.y - cy, d.start.x - cx)) * 180 / Math.PI + 540) % 360) - 180;
    } else {
      const angle = v.angle * Math.PI / 180, x = dx * Math.cos(angle) + dy * Math.sin(angle), y = -dx * Math.sin(angle) + dy * Math.cos(angle);
      if (/[ew]/.test(d.handle)) v.width = Math.max(1, Math.min(8192, Math.round(v.width + (d.handle.includes('e') ? 2 : -2) * x)));
      if (/[ns]/.test(d.handle)) v.height = Math.max(1, Math.min(8192, Math.round(v.height + (d.handle.includes('s') ? 2 : -2) * y)));
    }
    s.value = v; this.draw();
    if (this.frame === undefined) this.frame = requestAnimationFrame(() => { this.frame = undefined; this.guard(() => this.preview()); });
  }
  private draw() {
    const s = this.session!; this.box.hidden = false;
    Object.assign(this.box.style, { left: `${s.center.x + s.value.dx - s.value.width / 2}px`, top: `${s.center.y + s.value.dy - s.value.height / 2}px`, width: `${s.value.width}px`, height: `${s.value.height}px`, transform: `rotate(${s.value.angle}deg)` });
  }
  private preview() { const s = this.session; if (s) this.view.preview({ ...s.before, layers: replacePixel(s.before.layers, s.layer.id, transformedLayer(s.before, s.layer.id, s.value)) }); }
  commit() {
    const s = this.session; if (!s) return;
    if (this.active() !== s.doc || s.doc.state !== s.before) { this.cancel(); throw new Error('文档已变化，变换已取消。'); }
    const layer = transformedLayer(s.before, s.layer.id, s.value); this.cancel();
    const initial=s.layer.content?.type==='smart'?s.layer.content.transform:{width:s.layer.bitmap!.width,height:s.layer.bitmap!.height,angle:0,flipX:false,flipY:false};
    if (s.value.dx || s.value.dy || (['width','height','angle','flipX','flipY'] as const).some(k=>(s.value[k]??false)!==initial[k])) commitTransform(s.doc, layer, '自由变换', s.before.revision);
  }
  cancel() { if (this.frame !== undefined) cancelAnimationFrame(this.frame); this.frame = undefined; const pointer = this.drag?.pointer; this.drag = undefined; const had = this.session; this.session = undefined; this.box.hidden = true; if (pointer !== undefined && this.box.hasPointerCapture(pointer)) this.box.releasePointerCapture(pointer); if (had) this.view.preview(); }
  dispose() { this.cancel(); this.abort.abort(); this.box.remove(); }
}
