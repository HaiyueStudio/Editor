import {tiledRetouch} from './tiledRetouch.js';
import {brushUiValues} from './brushPanel.js';
import { tiledColorSelection } from './tiledSelection.js';
import { tiledCmykFill, tiledCmykStroke, tiledCopy, tiledEditing, tiledStroke, tiledFill, tiledGradient, sampleRegion } from './tiledEditing.js';
import { tiledTransform } from './tiledTransform.js';
import { editTiledMask } from './tiledMasks.js';
import { selectionWeight } from './selection.js';
import { checkDenseAllocation, needsTiledView } from './imageLimits.js';
import { withDiskPages } from './diskPager.js';
import { hasDiskPixels } from './pagedPixels.js';
import { isControlFocused } from './uiFocus.js';
import { compositeDamage } from './compositor.js';
import { exportRaster } from './rasterExport.js';
import { CmykStroke,fillCmyk } from './cmykEditing.js';
import { nativeInkEnabled,inkSettings,setInkValues } from './cmykPanel.js';
import { compositeCmyk } from './cmyk.js';
import { sampleHex } from './pixelFormat.js';
import { snapMove, snapPoint } from './layout.js';
import type { Resampling } from './resampling.js';
import { retouchSampler } from './retouch.js';
import { copyPixels, pastePixels, sampleColor as pickColor, gradientPixels, selectedRoots, moveLayers, type PixelCopy } from './dailyEditing.js';
import { FreeTransform, transformedLayer, commitTransform } from './freeTransform.js';
import { maskStrokeState, maskFromStroke } from './maskTools.js';
import { combineSelection, invertSelection, ellipseSelection, polygonSelection, colorSelection, modifySelection, selectionCount, type Selection, type SelectionMode } from './selection.js';
import { ImageDocument, makeLayer, checkSize, layerLocked, findLayer, type ImageState, type ImageLayer } from './document.js';
import { CanvasView, paintDocument, bitmapCanvas, refreshBitmap } from './canvasView.js';
import { PixelStroke, fillPixels, hexColor, parentOffset, replacePixel, selectionRect, transformBitmap, type Point, type Rect } from './pixelTools.js';

export type Tool = 'hand' | 'move' | 'brush' | 'eraser' | 'select' | 'ellipse' | 'lasso' | 'polygon' | 'wand' | 'range' | 'crop' | 'eyedropper' | 'gradient' | 'clone' | 'heal' | 'path';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const names: Record<Tool, string> = { path:'贝塞尔路径',clone:'仿制图章',heal:'修复画笔',eyedropper: '吸管', gradient: '渐变', hand: '画布浏览', move: '移动图层', brush: '画笔', eraser: '橡皮擦', select: '矩形选区', ellipse:'椭圆选区', lasso:'套索', polygon:'多边形套索', wand:'魔术棒', range:'颜色范围', crop: '裁剪画布' };
const hints: Record<Tool, string> = { path:'单击加锚点 · 拖出控制柄 · Enter 应用 / Esc 取消',clone:'Alt 单击取样 · 拖动仿制 · Esc 取消',heal:'Alt 单击取样 · 保留纹理并匹配局部色调',eyedropper: '点击画布设置前景色 · 全部可见图层取样', gradient: '拖动绘制渐变 · Esc 取消', hand: '拖动平移 · 滚轮缩放', move: '拖动选中图层 · 方向键微调', brush: '拖动绘制 · Esc 取消笔画', eraser: '拖动擦除 · Esc 取消笔画', select: '拖动选择 · Shift 加选 / Alt 减选', ellipse:'拖动选择 · Shift 加选 / Alt 减选', lasso:'自由绘制闭合区域 · Esc 取消', polygon:'逐点单击 · Enter / 双击闭合 · 退格撤点', wand:'点击相近颜色 · 可选连续区域', range:'点击取样，选择全图相近颜色', crop: '拖动裁剪区域 · Enter 确认' };
interface Gesture { tiledPoints?:import('./pixelTools.js').BrushPoint[]; retouch?:{sourceId:string;offset:Point;kind:'clone'|'heal';radius:number}; tiledSettings?:import('./brushDynamics.js').ExtendedBrush & {size:number;opacity:number;color:readonly [number,number,number];erase:boolean;hardness:number;pressure:'none';target?:'layer'|'filter';ink?:import('./cmykEditing.js').InkPaint}; doc: ImageDocument; before: ImageState; start: Point; pointer: number; layer?: ImageLayer; gradient?: ImageLayer; end?: Point; stroke?: PixelStroke|CmykStroke; maskLayer?: ImageLayer; maskTarget?:'layer'|'filter'; rect?: Rect | null; delta?: Point; points?: Point[]; mode?: SelectionMode }
export class EditingTools {
  tool: Tool = 'hand';
  readonly freeTransform: FreeTransform;
  private clipboard: PixelCopy | undefined;
  private retouchSource:{docId:string;layerId:string;x:number;y:number;offset?:Point}|undefined;
  private pressure(event:PointerEvent){return event.pointerType==='pen'?event.pressure:1;}
  previewSelection(selection:Selection|null){this.showRect(selection);}
  async copy() { this.cancel(); const doc = this.active(); if (!doc) return; this.clipboard = tiledEditing(doc.state)?await tiledCopy(doc.state,doc.selected?.id):copyPixels(doc.state, doc.selected?.id); this.notify('已复制当前图层的选区像素，可跨文档粘贴。'); }
  paste() { this.cancel(); const doc = this.active(); if (!doc || !this.clipboard) throw new Error('请先在编辑器中复制像素。'); pastePixels(doc, this.clipboard); }
  startTransform() { this.cancel(); this.freeTransform.start(); }
  maskEditing = false; maskTarget:'layer'|'filter'='layer';
  setMaskEditing(value:boolean,target:'layer'|'filter'='layer'){this.cancel();this.maskEditing=value;this.maskTarget=target;if(value)this.setTool('brush');this.sync();}
  private gesture: Gesture | undefined;
  private polygon: {doc:ImageDocument;before:ImageState;points:Point[];mode:SelectionMode}|undefined;
  private shown:Selection|null|undefined;
  private abort = new AbortController();
  private space = false;
  private activeId: string | undefined;
  private tiledPreviewAbort:AbortController|undefined;
  private tiledPreviewTimer:ReturnType<typeof setTimeout>|undefined;
  private previewFrame: number | undefined;
  constructor(private active: () => ImageDocument | undefined, private view: CanvasView, private notify: (message: string, error?: boolean) => void) {
    this.freeTransform = new FreeTransform(active, view, notify);
    const signal = this.abort.signal, viewport = view.viewport;
    view.canPan = event => event.button === 1 || event.button === 0 && (this.tool === 'hand' || this.space);
    viewport.addEventListener('pointerdown', event => {
      if(hasDiskPixels(this.active()?.state)&&event.button===0&&!(event.target as HTMLElement).closest('button, hy-button')){viewport.focus({preventScroll:true});viewport.setPointerCapture(event.pointerId);}
      this.guard(() => this.begin(event));
    }, { signal });
    viewport.addEventListener('pointermove', event => this.guard(() => this.update(event)), { signal });
    viewport.addEventListener('pointerup', event => this.guard(() => this.finish(event)), { signal });
    viewport.addEventListener('pointercancel', event => {
      this.guard(() => { if (this.gesture?.pointer === event.pointerId) this.cancel(); });
    }, { signal });
    viewport.addEventListener('lostpointercapture', event => {
      // Descendants can release implicit touch capture, and a completed pointer
      // can release capture after another gesture has started. Neither cancels it.
      this.guard(() => { if (event.target === viewport && this.gesture?.pointer === event.pointerId && !viewport.hasPointerCapture(event.pointerId)) this.cancel(); });
    }, { signal });
    window.addEventListener('blur', () => { this.space = false; this.cancel(); }, { signal });
    document.addEventListener('keydown', event => {
      if (this.isInput() || (['Enter', ' '].includes(event.key) && document.activeElement?.matches('button, hy-button'))) return;
      if ((event.metaKey || event.ctrlKey) && ['c', 'v', 't'].includes(event.key.toLowerCase())) { event.preventDefault(); this.guard(() => event.key.toLowerCase() === 'c' ? this.copy() : event.key.toLowerCase() === 'v' ? this.paste() : this.startTransform()); return; }
      if (this.freeTransform.busy) return;
      if (event.code === 'Space') { this.space = true; event.preventDefault(); }
      if (event.key === 'Escape') { event.preventDefault(); if (this.gesture || this.polygon) this.cancel(); else this.active()?.setSelection(null); }
      if (this.polygon && (event.key === 'Enter' || event.key === 'Backspace')) { event.preventDefault(); this.guard(() => { if(event.key === 'Enter')this.finishPolygon();else {this.polygon!.points.pop();this.showPath(this.polygon!.points);} }); return; }
      if (this.gesture) return;
      if (event.key === 'Enter' && this.tool === 'crop') { event.preventDefault(); this.guard(() => this.crop()); }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tool = ({ i: 'eyedropper', g: 'gradient', h: 'hand', v: 'move', b: 'brush', e: 'eraser', m: 'select', l:'lasso', w:'wand', c: 'crop' } as Record<string, Tool>)[event.key.toLowerCase()];
      if (tool) { event.preventDefault(); this.setTool(tool); }
      if (this.tool === 'move' && event.target === viewport && event.key.startsWith('Arrow')) {
        event.preventDefault(); this.guard(() => {
          const doc = this.active(), layer = doc?.selected, amount = event.shiftKey ? 10 : 1;
          if (doc && layer) moveLayers(doc, doc.selectedIds, event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0);
        });
      }
    }, { signal });
    document.addEventListener('keyup', event => { if (event.code === 'Space') this.space = false; }, { signal });
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.addEventListener('click', () => this.setTool(button.dataset.tool as Tool), { signal }));
    viewport.addEventListener('dblclick', event=>{if(this.tool==='polygon'){event.preventDefault();this.guard(()=>this.finishPolygon());}}, {signal});
    this.setTool('hand');
  }
  private isInput() { return Boolean(document.querySelector('dialog[open]')) || isControlFocused(); }
  private diskInput:Promise<void>=Promise.resolve();
  private guard(action: () => void | Promise<void>) {const doc=this.active();if(doc&&hasDiskPixels(doc.state)){
    const state=doc.state;this.diskInput=this.diskInput.then(async()=>{if(this.active()!==doc)return;if(tiledEditing(state)){await action();return;}if(doc.state!==state)return;await withDiskPages(this.tool==='crop'||this.tool==='eyedropper'?state:[doc.selected,...((this.tool==='clone'||this.tool==='heal')&&this.retouchSource?.docId===doc.identity.id?[findLayer(state.layers,this.retouchSource.layerId)]:[])],()=>{if(this.active()===doc&&doc.state===state)return action();},this.abort.signal);}).catch(error=>{this.cancel();this.notify(error instanceof Error?error.message:String(error),true);});return;
  }try { const result=action();if(result)void result.catch(error=>{this.cancel();this.notify(String(error),true);}); } catch (error) { this.cancel(); this.notify(error instanceof Error ? error.message : String(error), true); } }
  get busy() { return Boolean(this.gesture || this.polygon || this.freeTransform.busy); }
  get color() { return hexColor($<HTMLInputElement>('paint-color').value); }
  get opacity() { return Number($<HTMLInputElement>('paint-opacity').value) / 100; }
  setTool(tool: Tool) {
    this.cancel(); this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => { const selected = button.dataset.tool === tool; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
    $('tool-name').textContent = names[tool]; $('tool-hint').textContent = hints[tool];
    $('paint-settings').hidden = !['brush', 'eraser', 'gradient', 'clone', 'heal'].includes(tool); $('gradient-settings').hidden = tool !== 'gradient'; $('selection-settings').hidden = !['select','ellipse','lasso','polygon','wand','range','crop'].includes(tool);
    $('color-settings').hidden = tool !== 'wand' && tool !== 'range';
    $('apply-crop').hidden = tool !== 'crop'; this.view.viewport.dataset.tool = tool;this.view.viewport.dispatchEvent(new CustomEvent('image-tool-change'));
  }
  sync() {
    this.freeTransform.sync();
    const doc = this.active();
    if (this.polygon && (this.polygon.doc !== doc || this.polygon.before !== doc?.state)) this.cancel();
    if (this.gesture && (this.gesture.doc !== doc || this.gesture.before !== doc?.state)) this.cancel();
    if (this.maskEditing && !(this.maskTarget==='filter'?doc?.selected?.filterMask:doc?.selected?.mask)) this.maskEditing=false;
    const indicator=document.getElementById('mask-editing-status');if(indicator)indicator.textContent=this.maskEditing?`正在绘制${this.maskTarget==='filter'?'滤镜':'图层'}蒙版 · 白色显示／黑色隐藏`:'正在编辑图层像素';
    if (this.activeId !== doc?.identity.id) { this.maskEditing=false; this.cancel(); this.activeId = doc?.identity.id; }
    // A save/status refresh must not paint the previous selection over a live drag.
    if (!this.gesture && !this.polygon) this.showRect(doc?.state.selection ?? null);
    for (const element of document.querySelectorAll<HTMLButtonElement>('[data-needs-selection]')) element.toggleAttribute('disabled', !doc?.state.selection);
  }
  private showRect(rect: Selection | null) {
    if (this.shown === rect) return; this.shown = rect;
    const overlay = $('selection-outline'); overlay.hidden = !rect;
    if (rect) { Object.assign(overlay.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); $('selection-info').textContent = `${selectionCount(rect).toLocaleString()} px · ${rect.width} × ${rect.height}`; }
    else { $('selection-info').textContent = '无选区'; const mask = $<HTMLCanvasElement>('selection-mask'); mask.width = mask.height = 1; }
    const canvas=$<HTMLCanvasElement>('selection-mask');canvas.hidden=!(rect?.mask||rect?.runs);overlay.classList.toggle('masked',Boolean(rect?.mask||rect?.runs));
    if(rect&&(rect.mask||rect.runs)){const scale=Math.min(1,2048/Math.max(rect.width,rect.height));canvas.width=Math.max(1,Math.ceil(rect.width*scale));canvas.height=Math.max(1,Math.ceil(rect.height*scale));const ctx=canvas.getContext('2d')!,image=ctx.createImageData(canvas.width,canvas.height),sample=(x:number,y:number)=>selectionWeight(rect,rect.x+Math.floor(x/scale),rect.y+Math.floor(y/scale))*255;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const v=sample(x,y);if(!v)continue;const edge=v>=128&&(x===0||y===0||x===canvas.width-1||y===canvas.height-1||sample(x-1,y)<128||sample(x+1,y)<128||sample(x,y-1)<128||sample(x,y+1)<128);image.data.set(edge?[255,255,255,235]:[244,160,108,Math.round(v*.23)],(y*canvas.width+x)*4);}ctx.putImageData(image,0,0);
    }
  }
  private async begin(event: PointerEvent) {
    const doc = this.active(); if (!doc || this.freeTransform.busy || this.gesture || this.view.canPan(event) || event.button !== 0 || (event.target as HTMLElement).closest('button, hy-button')) return;
    const point = this.view.point(event);
    if (point.x < 0 || point.y < 0 || point.x >= doc.state.width || point.y >= doc.state.height) return;
    // Focus commits pending property inputs synchronously. Capture the gesture's
    // document snapshot only afterwards, otherwise that commit cancels this drag.
    this.view.viewport.focus({ preventScroll: true });
    if (this.active() !== doc) return;
    if(this.tool==='path')return;
    if((this.tool==='clone'||this.tool==='heal')&&event.altKey){if(!doc.selected?.bitmap)throw new Error('请选择含像素的取样图层。');this.retouchSource={docId:doc.identity.id,layerId:doc.selected.id,x:point.x,y:point.y};this.notify(`取样点 ${Math.round(point.x)}, ${Math.round(point.y)} · ${doc.selected.name}`);event.preventDefault();return;}
    if (this.tool === 'eyedropper') { if(tiledEditing(doc.state)){const before=doc.state,b=await sampleRegion(before,{x:Math.floor(point.x),y:Math.floor(point.y),width:1,height:1});if(doc.state!==before)return;if(before.colorMode==='cmyk'&&nativeInkEnabled()){setInkValues(Array.from(b.cmyk!));return;}$<HTMLInputElement>('paint-color').value=sampleHex(Array.from(b.data),before);return;} if(doc.state.colorMode==='cmyk'&&nativeInkEnabled()){const b=compositeCmyk(doc.state,{x:Math.floor(point.x),y:Math.floor(point.y),width:1,height:1});setInkValues(Array.from(b.cmyk!));this.notify('原生 CMYK (%)：'+Array.from(b.cmyk!,v=>v.toFixed(2)).join(', '));return;} const color = pickColor(doc.state, Math.floor(point.x), Math.floor(point.y)); $<HTMLInputElement>('paint-color').value = sampleHex(color,doc.state); this.notify(`取色 RGBA(${color.join(', ')})`); return; }
    if (this.tool === 'gradient' && (!doc.selected || this.maskEditing)) throw new Error('请选择像素图层并退出蒙版绘制。');
    const mode=this.selectionMode(event);
    if(this.tool==='wand'||this.tool==='range'){await this.sampleColor(point,this.tool==='wand'&&$<HTMLInputElement>('wand-contiguous').checked,mode);return;}
    if(this.tool==='polygon') {if(!this.polygon)this.polygon={doc,before:doc.state,points:[],mode};if(this.polygon.points.length>=8192)throw new Error('套索顶点过多，请完成当前选区。');this.polygon.points.push(point);this.showPath(this.polygon.points);this.view.viewport.focus({preventScroll:true});event.preventDefault();return;}
    const gesture: Gesture = { doc, before: doc.state, start: point, pointer: event.pointerId,mode, ...(this.tool==='lasso'?{points:[point]}:{}) };
    if (['brush','eraser','clone','heal'].includes(this.tool)) {
      if (!doc.selected) throw new Error('请先选择像素图层。');
      if(tiledEditing(doc.state)){
       if(this.tool==='clone'||this.tool==='heal'){if(this.maskEditing)throw Error('仿制／修复前请退出蒙版绘制。');const s=this.retouchSource;if(!s||s.docId!==doc.identity.id)throw Error('请先 Alt 单击取样。');if(!s.offset||!$<HTMLInputElement>('clone-aligned').checked)s.offset={x:s.x-point.x,y:s.y-point.y};gesture.retouch={sourceId:s.layerId,offset:{...s.offset},kind:this.tool,radius:Number($<HTMLInputElement>('heal-radius').value)};}const tone=this.tool==='eraser'?0:Number($<HTMLSelectElement>('mask-paint-tone').value);gesture.tiledPoints=[{...point,pressure:this.pressure(event)}];gesture.tiledSettings={...brushUiValues(),size:Number($<HTMLInputElement>('brush-size').value),opacity:this.opacity,color:this.maskEditing?[tone,tone,tone]:this.color,erase:!this.maskEditing&&this.tool==='eraser',hardness:Number($<HTMLInputElement>('brush-hardness').value)/100,pressure:$<HTMLSelectElement>('brush-pressure').value as 'none',...(this.maskEditing?{target:this.maskTarget}:doc.state.colorMode==='cmyk'&&(this.tool==='eraser'||nativeInkEnabled())?{ink:{...inkSettings(),opacity:this.opacity,erase:this.tool==='eraser'}}:{})};}
      else {
      const source=this.maskEditing?maskStrokeState(doc.state,doc.selected.id,this.maskTarget):doc.state;
      if(this.maskEditing){gesture.maskLayer=doc.selected;gesture.maskTarget=this.maskTarget;}
      const tone=this.tool==='eraser'?0:Number($<HTMLSelectElement>('mask-paint-tone').value);
      let sample:ReturnType<typeof retouchSampler>|undefined;if(this.tool==='clone'||this.tool==='heal'){if(this.maskEditing)throw new Error('仿制／修复前请退出蒙版绘制。');const s=this.retouchSource;if(!s||s.docId!==doc.identity.id)throw new Error('请先 Alt 单击源图取样。');if(!s.offset||!$<HTMLInputElement>('clone-aligned').checked)s.offset={x:s.x-point.x,y:s.y-point.y};sample=retouchSampler(doc.state,doc.selected.id,s.layerId,s.offset,this.tool,Number($<HTMLInputElement>('heal-radius').value));}
      gesture.stroke = !this.maskEditing&&source.colorMode==='cmyk'&&(this.tool==='eraser'||this.tool==='brush'&&nativeInkEnabled())?new CmykStroke(source,doc.selected.id,Number($<HTMLInputElement>('brush-size').value),{...inkSettings(),opacity:this.opacity,erase:this.tool==='eraser'},{...brushUiValues(),hardness:Number($<HTMLInputElement>('brush-hardness')?.value??100)/100,pressure:($<HTMLSelectElement>('brush-pressure')?.value??'none') as 'none'}):new PixelStroke(source, doc.selected.id, Number($<HTMLInputElement>('brush-size').value), this.opacity, this.maskEditing?[tone,tone,tone]:this.color, !this.maskEditing&&this.tool === 'eraser',{...brushUiValues(),hardness:Number($<HTMLInputElement>('brush-hardness')?.value??100)/100,pressure:($<HTMLSelectElement>('brush-pressure')?.value??'none') as 'none',...(sample?{sample}:{})});
      gesture.stroke.point({...point,pressure:this.pressure(event)});
      }
    } else if (this.tool === 'move') {
      if (!doc.selected) throw new Error('请先选择图层。');
      if (selectedRoots(doc.state, doc.selectedIds).some(layer => layerLocked(doc.state.layers, layer.id,'position'))) throw new Error('图层或上级图层组已锁定。');
      gesture.layer = doc.selected;
    }
    this.gesture = gesture; this.view.viewport.focus({ preventScroll: true }); try{this.view.viewport.setPointerCapture(event.pointerId);}catch{/* Pointer may have ended while its working set loaded; queued events still finish it. */}event.preventDefault();this.preview();
  }
  private update(event: PointerEvent) {
    const gesture = this.gesture; if (!gesture || gesture.pointer !== event.pointerId) return;
    if (gesture.doc !== this.active() || gesture.doc.state !== gesture.before) { this.cancel(); return; }
    const point = this.view.point(event);
    if (this.tool === 'gradient') gesture.end = point;
    else if(gesture.tiledPoints){if(gesture.tiledPoints.length<8192)gesture.tiledPoints.push({...point,pressure:this.pressure(event)});}
    else if (gesture.stroke){const coalesced=event.getCoalescedEvents?.()??[];for(const p of coalesced.length?coalesced:[event])gesture.stroke.point({...this.view.point(p),pressure:this.pressure(p)});}
    else if (gesture.layer) {const delta={x:Math.round(point.x-gesture.start.x),y:Math.round(point.y-gesture.start.y)};gesture.delta=event.altKey?delta:snapMove(gesture.before,gesture.doc.selectedIds,delta,this.view.scale);}
    else if(gesture.points){if(gesture.points.length<8192&&Math.hypot(point.x-gesture.points.at(-1)!.x,point.y-gesture.points.at(-1)!.y)>=.5)gesture.points.push(point);}
    else gesture.rect = selectionRect(gesture.start, event.altKey?point:snapPoint(gesture.before,point,this.view.scale), gesture.before.width, gesture.before.height);
    this.preview();
  }
  private preview() {
    if (this.previewFrame !== undefined) return;
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = undefined; const g = this.gesture; if (!g) return;
      if(g.tiledPoints){this.showPath(g.tiledPoints);this.tiledPreviewAbort?.abort();clearTimeout(this.tiledPreviewTimer);const controller=new AbortController();this.tiledPreviewAbort=controller;const points=g.tiledPoints.slice(),v=g.tiledSettings!;this.tiledPreviewTimer=setTimeout(()=>{void (async()=>{let layer:ImageLayer;if(v.target){const mask=await editTiledMask(g.before,g.before.selectedId!,v.target,v.color,v.opacity,{points,size:v.size,dynamics:{...v,hardness:v.hardness,pressure:v.pressure}},controller.signal);const original=findLayer(g.before.layers,g.before.selectedId!)!;layer={...original,[v.target==='filter'?'filterMask':'mask']:mask};}else layer=v.ink?await tiledCmykStroke(g.before,g.before.selectedId!,points,v.size,v.ink,{...v,hardness:v.hardness,pressure:v.pressure},controller.signal):await tiledStroke(g.before,g.before.selectedId!,points,v.size,v.opacity,v.color,v.erase,{...v,hardness:v.hardness,pressure:v.pressure},controller.signal);if(this.gesture===g&&!controller.signal.aborted)this.view.preview({...g.before,layers:replacePixel(g.before.layers,layer.id,layer)});})().catch(error=>{if(!controller.signal.aborted)this.notify(String(error),true);});},80);return;}
      if(this.tool==='gradient'&&tiledEditing(g.before)){this.showPath([g.start,g.end??g.start]);return;}
      if (this.tool === 'gradient') { if (g.end && Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) >= .5) this.guard(() => { g.gradient = this.gradientLayer(g); this.view.preview({ ...g.before, layers: replacePixel(g.before.layers, g.gradient.id, g.gradient) }); }); return; }
      if (g.layer) { let layers = g.before.layers; for (const layer of selectedRoots(g.before, g.before.selectedIds ?? [g.layer.id])) layers = replacePixel(layers, layer.id, { ...layer, x: layer.x + (g.delta?.x ?? 0), y: layer.y + (g.delta?.y ?? 0) }); this.view.preview({ ...g.before, layers }); return; }
      const dirty=g.stroke?.takeDirty();if(g.stroke){if(!dirty)return;refreshBitmap(g.stroke.layer.bitmap!,dirty);}
      const layer = g.stroke ? g.maskLayer?{...g.maskLayer,[g.maskTarget==='filter'?'filterMask':'mask']:maskFromStroke(g.maskLayer,g.stroke.layer,g.maskTarget)}:g.stroke.layer : undefined;
      if (layer) {const state={ ...g.before, layers: replacePixel(g.before.layers, layer.id, layer) };this.view.preview(state,!g.maskLayer&&dirty?compositeDamage(state,layer.id,dirty):undefined,true);}
      else if(g.points)this.showPath(g.points);
      else this.showRect(g.rect ?? null);
    });
  }
  private async finish(event: PointerEvent) {
    const g = this.gesture; if (!g || g.pointer !== event.pointerId) return;
    this.update(event); if (this.gesture !== g) return;
    this.tiledPreviewAbort?.abort();clearTimeout(this.tiledPreviewTimer);this.gesture = undefined; if (this.previewFrame !== undefined) cancelAnimationFrame(this.previewFrame); this.previewFrame = undefined;
    if (this.view.viewport.hasPointerCapture(event.pointerId)) this.view.viewport.releasePointerCapture(event.pointerId);
    if(g.stroke)refreshBitmap(g.stroke.layer.bitmap!,g.stroke.takeDirty());
    try {
    if(g.tiledPoints){const v=g.tiledSettings!;this.notify('正在提交分块笔画…');if(v.target){const mask=await editTiledMask(g.before,g.before.selectedId!,v.target,v.color,v.opacity,{points:g.tiledPoints,size:v.size,dynamics:{...v,hardness:v.hardness,pressure:v.pressure}});if(g.doc.state!==g.before)throw Error('文档已变化，笔画已取消。');g.doc.setMask(g.before.selectedId!,mask,v.target);}else{const layer=g.retouch?await tiledRetouch(g.before,g.before.selectedId!,g.retouch.sourceId,g.retouch.offset,g.retouch.kind,g.tiledPoints,v.size,v.opacity,{...v,hardness:v.hardness,pressure:v.pressure},g.retouch.radius):v.ink?await tiledCmykStroke(g.before,g.before.selectedId!,g.tiledPoints,v.size,v.ink,{...v,hardness:v.hardness,pressure:v.pressure}):await tiledStroke(g.before,g.before.selectedId!,g.tiledPoints,v.size,v.opacity,v.color,v.erase,{...v,hardness:v.hardness,pressure:v.pressure});g.doc.replaceLayerPixels(layer.id,layer,'分块笔画',g.before.revision);}this.showRect(g.doc.state.selection??null);}
    else if(this.tool==='gradient'&&tiledEditing(g.before)){if(g.end){const layer=await tiledGradient(g.before,g.before.selectedId!,g.start,g.end,this.color,hexColor($<HTMLInputElement>('gradient-color').value),$<HTMLSelectElement>('gradient-kind').value as 'linear'|'radial',this.opacity);g.doc.replaceLayerPixels(layer.id,layer,'渐变',g.before.revision);}this.showRect(g.doc.state.selection??null);}
    else if (this.tool === 'gradient') { if (g.end && Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) >= .5) { const layer = this.gradientLayer(g); g.doc.replaceLayerPixels(layer.id, layer, '渐变', g.before.revision); } }
    else if(g.stroke?.changed&&g.maskLayer)g.doc.setMask(g.maskLayer.id,maskFromStroke(g.maskLayer,g.stroke.layer,g.maskTarget),g.maskTarget);
    else if (g.stroke?.changed) g.doc.replaceLayerPixels(g.stroke.layer.id, g.stroke.layer, this.tool === 'eraser' ? '橡皮擦笔画' : this.tool==='clone'?'仿制笔画':this.tool==='heal'?'修复笔画':'画笔笔画', g.before.revision, g.stroke.changedBounds);
    else if (g.layer && g.delta) moveLayers(g.doc, g.doc.selectedIds, g.delta.x, g.delta.y);
    else if (!g.stroke && !g.layer) {
      const selected=g.points?polygonSelection(g.points,g.before.width,g.before.height):g.rect?(this.tool==='ellipse'?ellipseSelection(g.rect):g.rect):null;
      if(selected)g.doc.setSelection(combineSelection(g.before.selection,selected,this.tool==='crop'?'replace':g.mode!,g.before.width,g.before.height));
      else if(g.mode==='replace')g.doc.setSelection(null);
    }
    }finally{if(g.doc.state===g.before&&(g.stroke||g.layer||this.tool==='gradient'))this.view.preview();}
    this.sync();
  }
  private gradientLayer(g: Gesture) { return gradientPixels(g.before, g.before.selectedId!, g.start, g.end!, this.color, hexColor($<HTMLInputElement>('gradient-color').value), $<HTMLSelectElement>('gradient-kind').value as 'linear' | 'radial', this.opacity); }
  cancel() {
    this.tiledPreviewAbort?.abort();clearTimeout(this.tiledPreviewTimer);
    this.freeTransform?.cancel();
    const g = this.gesture; this.gesture = undefined; this.polygon=undefined; this.shown=undefined;
    if (this.previewFrame !== undefined) cancelAnimationFrame(this.previewFrame); this.previewFrame = undefined;
    if (g) { if (this.view.viewport.hasPointerCapture(g.pointer)) this.view.viewport.releasePointerCapture(g.pointer); const dirty=g.stroke?.changedBounds;const local=!g.maskLayer&&dirty&&this.active()===g.doc&&g.doc.state===g.before?compositeDamage({...g.before,layers:replacePixel(g.before.layers,g.stroke!.layer.id,g.stroke!.layer)},g.stroke!.layer.id,dirty):undefined;if(g.stroke||g.tiledPoints||g.layer||this.tool==='gradient')this.view.preview(undefined,local); }
    this.showRect(this.active()?.state.selection ?? null);
  }
  private selectionMode(event?:PointerEvent):SelectionMode {return event?.shiftKey&&event.altKey?'intersect':event?.shiftKey?'add':event?.altKey?'subtract':$<HTMLSelectElement>('selection-mode').value as SelectionMode;}
  private showPath(points:readonly Point[]){
    const doc=this.active();if(!doc)return;this.shown=undefined;const overlay=$('selection-outline'),canvas=$<HTMLCanvasElement>('selection-mask');overlay.hidden=false;overlay.classList.add('masked');Object.assign(overlay.style,{left:'0px',top:'0px',width:doc.state.width+'px',height:doc.state.height+'px'});canvas.hidden=false;const scale=Math.min(1,2048/Math.max(doc.state.width,doc.state.height));canvas.width=Math.ceil(doc.state.width*scale);canvas.height=Math.ceil(doc.state.height*scale);const ctx=canvas.getContext('2d')!;ctx.scale(scale,scale);ctx.strokeStyle='#ffffff';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();$('selection-info').textContent=points.length+' 个套索点';
  }
  private finishPolygon(){const p=this.polygon;if(!p)return;if(p.points.length<3)throw new Error('多边形套索至少需要 3 个点。');this.polygon=undefined;p.doc.setSelection(combineSelection(p.before.selection,polygonSelection(p.points,p.before.width,p.before.height),p.mode,p.before.width,p.before.height));this.sync();}
  private sampleBitmap(){const doc=this.active();if(!doc)throw new Error('请先打开文档。');if(needsTiledView(doc.state))throw Error('大图颜色选区尚需分块区域接口。');checkDenseAllocation(doc.state.width,doc.state.height);const canvas=document.createElement('canvas');const scale=Math.min(1,2048/Math.max(doc.state.width,doc.state.height));canvas.width=Math.ceil(doc.state.width*scale);canvas.height=Math.ceil(doc.state.height*scale);const ctx=canvas.getContext('2d')!;ctx.scale(scale,scale);
    if($<HTMLSelectElement>('selection-source').value==='merged')ctx.drawImage(this.view.canvas,0,0);
    else {const layer=doc.selected;if(!layer||layer.kind!=='pixel')throw new Error('请先选择像素图层，或改为全部可见图层取样。');if(layer.bitmap){const offset=parentOffset(doc.state.layers,layer.id)!;ctx.drawImage(bitmapCanvas(layer.bitmap),layer.x+offset.x,layer.y+offset.y);}}
    const image=ctx.getImageData(0,0,canvas.width,canvas.height);canvas.width=canvas.height=1;return image;
  }
  private async sampleColor(point:Point,contiguous:boolean,mode:SelectionMode){const doc=this.active();if(!doc)return;if(tiledEditing(doc.state)){const before=doc.state,id=$<HTMLSelectElement>('selection-source').value==='merged'?undefined:doc.selected?.id,b=await sampleRegion(before,{x:Math.floor(point.x),y:Math.floor(point.y),width:1,height:1},id),color=Array.from(b.data) as [number,number,number,number],selected=await tiledColorSelection(before,color,Number($<HTMLInputElement>('selection-tolerance').value),contiguous?point:undefined,id);if(doc.state!==before)throw Error('文档已变化，选区已取消。');doc.setSelection(combineSelection(before.selection,selected,mode,before.width,before.height));return;}const bitmap=this.sampleBitmap(),x=Math.floor(point.x),y=Math.floor(point.y),i=(y*bitmap.width+x)*4,color=Array.from(bitmap.data.slice(i,i+4)) as [number,number,number,number];
    $<HTMLInputElement>('range-color').value=sampleHex(color,doc.state);
    const selected=colorSelection(bitmap,color,Number($<HTMLInputElement>('selection-tolerance').value),contiguous?point:undefined);doc.setSelection(combineSelection(doc.state.selection,selected,mode,doc.state.width,doc.state.height));this.view.viewport.focus({preventScroll:true});
  }
  async selectColor(){this.cancel();const doc=this.active();if(!doc)return;if(tiledEditing(doc.state)){const before=doc.state,id=$<HTMLSelectElement>('selection-source').value==='merged'?undefined:doc.selected?.id,selected=await tiledColorSelection(before,hexColor($<HTMLInputElement>('range-color').value),Number($<HTMLInputElement>('selection-tolerance').value),undefined,id);if(doc.state!==before)throw Error('文档已变化，选区已取消。');doc.setSelection(combineSelection(before.selection,selected,this.selectionMode(),before.width,before.height));return;}const selected=colorSelection(this.sampleBitmap(),hexColor($<HTMLInputElement>('range-color').value),Number($<HTMLInputElement>('selection-tolerance').value));doc.setSelection(combineSelection(doc.state.selection,selected,this.selectionMode(),doc.state.width,doc.state.height));}
  invert(){this.cancel();const doc=this.active();if(doc)doc.setSelection(invertSelection(doc.state.selection,doc.state.width,doc.state.height));}
  modify(kind:'feather'|'expand'|'contract'){this.cancel();const doc=this.active();if(!doc?.state.selection)throw new Error('请先创建选区。');doc.setSelection(modifySelection(doc.state.selection,doc.state.width,doc.state.height,kind,Number($<HTMLInputElement>('selection-radius').value)));}
  selectAll() { this.cancel(); const doc = this.active(); if (doc) doc.setSelection({ x: 0, y: 0, width: doc.state.width, height: doc.state.height }); }
  deselect() { this.cancel(); this.active()?.setSelection(null); }
  async fill(clear = false) {
    this.cancel(); const doc = this.active(); if (!doc?.selected) return;
    if(tiledEditing(doc.state)){const before=doc.state,id=doc.selected.id;if(this.maskEditing){const tone=clear?0:Number($<HTMLSelectElement>('mask-paint-tone').value),mask=await editTiledMask(before,id,this.maskTarget,[tone,tone,tone],clear?1:this.opacity);if(doc.state!==before)throw Error('文档已变化，填充已取消。');doc.setMask(id,mask,this.maskTarget);}else{const layer=before.colorMode==='cmyk'&&(clear||nativeInkEnabled())?await tiledCmykFill(before,id,{...inkSettings(),opacity:clear?1:this.opacity,erase:clear}):await tiledFill(before,id,clear?null:this.color,clear?1:this.opacity);doc.replaceLayerPixels(id,layer,'分块填充',before.revision);}return;}
    if(this.maskEditing){const source=maskStrokeState(doc.state,doc.selected.id,this.maskTarget),tone=clear?0:Number($<HTMLSelectElement>('mask-paint-tone').value);doc.setMask(doc.selected.id,maskFromStroke(doc.selected,fillPixels(source,doc.selected.id,[tone,tone,tone],clear?1:this.opacity),this.maskTarget),this.maskTarget);return;}
    if(doc.state.colorMode==='cmyk'&&(clear||nativeInkEnabled())){doc.replaceLayerPixels(doc.selected.id,fillCmyk(doc.state,doc.selected.id,{...inkSettings(),opacity:clear?1:this.opacity,erase:clear}),clear?'清除选区像素':'填充 CMYK 通道');return;}
    doc.replaceLayerPixels(doc.selected.id, fillPixels(doc.state, doc.selected.id, clear ? null : this.color, clear ? 1 : this.opacity), clear ? '清除选区像素' : '填充前景色');
  }
  crop() { this.cancel(); this.active()?.cropToSelection(); this.view.fit(); }
  async transform(width: number, height: number, angle: number, flipX: boolean, flipY: boolean, resampling:Resampling='bicubic') {
    this.cancel(); const doc = this.active(), layer = doc?.selected; if (!doc || !layer?.bitmap) throw new Error('请选择含像素的图层。');
    if(tiledEditing(doc.state)){const before=doc.state,result=await tiledTransform(before,layer.id,{width,height,angle,dx:0,dy:0,flipX,flipY,resampling});commitTransform(doc,result,'变换图层',before.revision);return;}
    commitTransform(doc, transformedLayer(doc.state, layer.id, {width,height,angle,dx:0,dy:0,flipX,flipY,resampling}), '变换图层');
  }
  addText(text: string, size: number) {
    this.cancel(); const doc = this.active(); if (!doc) return;
    if (!text.trim() || text.length > 2000 || !Number.isInteger(size) || size < 6 || size > 512) throw new Error('文字需为 1–2000 字，字号为 6–512。');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!, lines = text.split('\n'), font = `${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.font = font; const width = Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width)) + size), height = Math.ceil(lines.length * size * 1.4 + size * 0.4); checkSize(width, height);
    canvas.width = width; canvas.height = height; ctx.font = font; ctx.textBaseline = 'top'; ctx.fillStyle = $<HTMLInputElement>('paint-color').value;
    lines.forEach((line, i) => ctx.fillText(line, size / 2, size * 0.2 + i * size * 1.4));
    const data = ctx.getImageData(0, 0, width, height).data, selected = doc.selected;
    const parent = selected ? parentOffset(doc.state.layers, selected.id)! : { x: 0, y: 0 };
    if (selected?.kind === 'group') { parent.x += selected.x; parent.y += selected.y; }
    doc.addLayer({ ...makeLayer(text.trim().split('\n')[0]!.slice(0, 150) + ' · 文字', { width, height, data }), x: Math.round((doc.state.width - width) / 2) - parent.x, y: Math.round((doc.state.height - height) / 2) - parent.y });
    canvas.width = canvas.height = 1;
  }
  async export(format:'png'|'jpeg',quality:number,embedProfile=true):Promise<Blob>{
    this.cancel();const doc=this.active();if(!doc)throw Error('请先打开文档。');if(!Number.isFinite(quality)||quality<.1||quality>1)throw Error('JPEG 质量应为 10–100。');
    return new Blob([(await exportRaster(doc.state,format,quality,embedProfile)).slice().buffer],{type:'image/'+format});
  }
  dispose() { this.cancel(); this.abort.abort(); this.freeTransform.dispose(); this.clipboard = undefined; }
}
