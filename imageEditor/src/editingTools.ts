import { maskStrokeState, maskFromStroke } from './maskTools.js';
import { combineSelection, invertSelection, ellipseSelection, polygonSelection, colorSelection, modifySelection, selectionCount, type Selection, type SelectionMode } from './selection.js';
import { ImageDocument, makeLayer, checkSize, layerLocked, type ImageState, type ImageLayer } from './document.js';
import { CanvasView, paintDocument, bitmapCanvas, refreshBitmap } from './canvasView.js';
import { PixelStroke, fillPixels, hexColor, parentOffset, replacePixel, selectionRect, transformBitmap, type Point, type Rect } from './pixelTools.js';

export type Tool = 'hand' | 'move' | 'brush' | 'eraser' | 'select' | 'ellipse' | 'lasso' | 'polygon' | 'wand' | 'range' | 'crop';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const names: Record<Tool, string> = { hand: '画布浏览', move: '移动图层', brush: '画笔', eraser: '橡皮擦', select: '矩形选区', ellipse:'椭圆选区', lasso:'套索', polygon:'多边形套索', wand:'魔术棒', range:'颜色范围', crop: '裁剪画布' };
const hints: Record<Tool, string> = { hand: '拖动平移 · 滚轮缩放', move: '拖动选中图层 · 方向键微调', brush: '拖动绘制 · Esc 取消笔画', eraser: '拖动擦除 · Esc 取消笔画', select: '拖动选择 · Shift 加选 / Alt 减选', ellipse:'拖动选择 · Shift 加选 / Alt 减选', lasso:'自由绘制闭合区域 · Esc 取消', polygon:'逐点单击 · Enter / 双击闭合 · 退格撤点', wand:'点击相近颜色 · 可选连续区域', range:'点击取样，选择全图相近颜色', crop: '拖动裁剪区域 · Enter 确认' };
interface Gesture { doc: ImageDocument; before: ImageState; start: Point; pointer: number; layer?: ImageLayer; stroke?: PixelStroke; maskLayer?: ImageLayer; rect?: Rect | null; delta?: Point; points?: Point[]; mode?: SelectionMode }
export class EditingTools {
  tool: Tool = 'hand';
  maskEditing = false;
  setMaskEditing(value:boolean){this.cancel();this.maskEditing=value;if(value)this.setTool('brush');this.sync();}
  private gesture: Gesture | undefined;
  private polygon: {doc:ImageDocument;before:ImageState;points:Point[];mode:SelectionMode}|undefined;
  private shown:Selection|null|undefined;
  private abort = new AbortController();
  private space = false;
  private activeId: string | undefined;
  private previewFrame: number | undefined;
  constructor(private active: () => ImageDocument | undefined, private view: CanvasView, private notify: (message: string, error?: boolean) => void) {
    const signal = this.abort.signal, viewport = view.viewport;
    view.canPan = event => event.button === 1 || event.button === 0 && (this.tool === 'hand' || this.space);
    viewport.addEventListener('pointerdown', event => this.guard(() => this.begin(event)), { signal });
    viewport.addEventListener('pointermove', event => this.guard(() => this.update(event)), { signal });
    viewport.addEventListener('pointerup', event => this.guard(() => this.finish(event)), { signal });
    viewport.addEventListener('pointercancel', event => {
      if (this.gesture?.pointer === event.pointerId) this.cancel();
    }, { signal });
    viewport.addEventListener('lostpointercapture', event => {
      // Descendants can release implicit touch capture, and a completed pointer
      // can release capture after another gesture has started. Neither cancels it.
      if (event.target === viewport && this.gesture?.pointer === event.pointerId && !viewport.hasPointerCapture(event.pointerId)) this.cancel();
    }, { signal });
    window.addEventListener('blur', () => { this.space = false; this.cancel(); }, { signal });
    document.addEventListener('keydown', event => {
      if (this.isInput()) return;
      if (event.code === 'Space') { this.space = true; event.preventDefault(); }
      if (event.key === 'Escape') { event.preventDefault(); if (this.gesture || this.polygon) this.cancel(); else this.active()?.setSelection(null); }
      if (this.polygon && (event.key === 'Enter' || event.key === 'Backspace')) { event.preventDefault(); this.guard(() => { if(event.key === 'Enter')this.finishPolygon();else {this.polygon!.points.pop();this.showPath(this.polygon!.points);} }); return; }
      if (this.gesture) return;
      if (event.key === 'Enter' && this.tool === 'crop') { event.preventDefault(); this.guard(() => this.crop()); }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tool = ({ h: 'hand', v: 'move', b: 'brush', e: 'eraser', m: 'select', l:'lasso', w:'wand', c: 'crop' } as Record<string, Tool>)[event.key.toLowerCase()];
      if (tool) { event.preventDefault(); this.setTool(tool); }
      if (this.tool === 'move' && event.target === viewport && event.key.startsWith('Arrow')) {
        event.preventDefault(); this.guard(() => {
          const doc = this.active(), layer = doc?.selected, amount = event.shiftKey ? 10 : 1;
          if (doc && layer) doc.updateLayer(layer.id, { x: layer.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), y: layer.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0) });
        });
      }
    }, { signal });
    document.addEventListener('keyup', event => { if (event.code === 'Space') this.space = false; }, { signal });
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.addEventListener('click', () => this.setTool(button.dataset.tool as Tool), { signal }));
    viewport.addEventListener('dblclick', event=>{if(this.tool==='polygon'){event.preventDefault();this.guard(()=>this.finishPolygon());}}, {signal});
    this.setTool('hand');
  }
  private isInput() { return Boolean(document.querySelector('dialog[open]')) || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? ''); }
  private guard(action: () => void) { try { action(); } catch (error) { this.cancel(); this.notify(error instanceof Error ? error.message : String(error), true); } }
  get busy() { return Boolean(this.gesture || this.polygon); }
  get color() { return hexColor($<HTMLInputElement>('paint-color').value); }
  get opacity() { return Number($<HTMLInputElement>('paint-opacity').value) / 100; }
  setTool(tool: Tool) {
    this.cancel(); this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => { const selected = button.dataset.tool === tool; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
    $('tool-name').textContent = names[tool]; $('tool-hint').textContent = hints[tool];
    $('paint-settings').hidden = tool !== 'brush' && tool !== 'eraser'; $('selection-settings').hidden = !['select','ellipse','lasso','polygon','wand','range','crop'].includes(tool);
    $('color-settings').hidden = tool !== 'wand' && tool !== 'range';
    $('apply-crop').hidden = tool !== 'crop'; this.view.viewport.dataset.tool = tool;
  }
  sync() {
    const doc = this.active();
    if (this.polygon && (this.polygon.doc !== doc || this.polygon.before !== doc?.state)) this.cancel();
    if (this.gesture && (this.gesture.doc !== doc || this.gesture.before !== doc?.state)) this.cancel();
    if (this.maskEditing && !doc?.selected?.mask) this.maskEditing=false;
    const indicator=document.getElementById('mask-editing-status');if(indicator)indicator.textContent=this.maskEditing?'正在绘制蒙版 · 白色显示／黑色隐藏':'正在编辑图层像素';
    if (this.activeId !== doc?.identity.id) { this.maskEditing=false; this.cancel(); this.activeId = doc?.identity.id; }
    // A save/status refresh must not paint the previous selection over a live drag.
    if (!this.gesture && !this.polygon) this.showRect(doc?.state.selection ?? null);
    for (const element of document.querySelectorAll<HTMLButtonElement>('[data-needs-selection]')) element.disabled = !doc?.state.selection;
  }
  private showRect(rect: Selection | null) {
    if (this.shown === rect) return; this.shown = rect;
    const overlay = $('selection-outline'); overlay.hidden = !rect;
    if (rect) { Object.assign(overlay.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); $('selection-info').textContent = `${selectionCount(rect).toLocaleString()} px · ${rect.width} × ${rect.height}`; }
    else { $('selection-info').textContent = '无选区'; const mask = $<HTMLCanvasElement>('selection-mask'); mask.width = mask.height = 1; }
    const canvas=$<HTMLCanvasElement>('selection-mask');canvas.hidden=!rect?.mask;overlay.classList.toggle('masked',Boolean(rect?.mask));
    if(rect?.mask){canvas.width=rect.width;canvas.height=rect.height;const ctx=canvas.getContext('2d')!,image=ctx.createImageData(rect.width,rect.height);
      for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){const p=y*rect.width+x,v=rect.mask[p]!;if(!v)continue;const edge=v>=128&&(x===0||y===0||x===rect.width-1||y===rect.height-1||rect.mask[p-1]!<128||rect.mask[p+1]!<128||rect.mask[p-rect.width]!<128||rect.mask[p+rect.width]!<128);image.data.set(edge?[255,255,255,235]:[244,160,108,Math.round(v*.23)],p*4);}ctx.putImageData(image,0,0);
    }
  }
  private begin(event: PointerEvent) {
    const doc = this.active(); if (!doc || this.gesture || this.view.canPan(event) || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const point = this.view.point(event);
    if (point.x < 0 || point.y < 0 || point.x >= doc.state.width || point.y >= doc.state.height) return;
    // Focus commits pending property inputs synchronously. Capture the gesture's
    // document snapshot only afterwards, otherwise that commit cancels this drag.
    this.view.viewport.focus({ preventScroll: true });
    if (this.active() !== doc) return;
    const mode=this.selectionMode(event);
    if(this.tool==='wand'||this.tool==='range'){this.sampleColor(point,this.tool==='wand'&&$<HTMLInputElement>('wand-contiguous').checked,mode);return;}
    if(this.tool==='polygon') {if(!this.polygon)this.polygon={doc,before:doc.state,points:[],mode};if(this.polygon.points.length>=8192)throw new Error('套索顶点过多，请完成当前选区。');this.polygon.points.push(point);this.showPath(this.polygon.points);this.view.viewport.focus({preventScroll:true});event.preventDefault();return;}
    const gesture: Gesture = { doc, before: doc.state, start: point, pointer: event.pointerId,mode, ...(this.tool==='lasso'?{points:[point]}:{}) };
    if (this.tool === 'brush' || this.tool === 'eraser') {
      if (!doc.selected) throw new Error('请先选择像素图层。');
      const source=this.maskEditing?maskStrokeState(doc.state,doc.selected.id):doc.state;
      if(this.maskEditing)gesture.maskLayer=doc.selected;
      const tone=this.tool==='eraser'?0:Number($<HTMLSelectElement>('mask-paint-tone').value);
      gesture.stroke = new PixelStroke(source, doc.selected.id, Number($<HTMLInputElement>('brush-size').value), this.opacity, this.maskEditing?[tone,tone,tone]:this.color, !this.maskEditing&&this.tool === 'eraser');
      gesture.stroke.point(point);
    } else if (this.tool === 'move') {
      if (!doc.selected) throw new Error('请先选择图层。');
      if (layerLocked(doc.state.layers, doc.selected.id)) throw new Error('图层或上级图层组已锁定。');
      gesture.layer = doc.selected;
    }
    this.gesture = gesture; this.view.viewport.focus({ preventScroll: true }); this.view.viewport.setPointerCapture(event.pointerId); event.preventDefault(); this.preview();
  }
  private update(event: PointerEvent) {
    const gesture = this.gesture; if (!gesture || gesture.pointer !== event.pointerId) return;
    if (gesture.doc !== this.active() || gesture.doc.state !== gesture.before) { this.cancel(); return; }
    const point = this.view.point(event);
    if (gesture.stroke) gesture.stroke.point(point);
    else if (gesture.layer) gesture.delta = { x: Math.round(point.x - gesture.start.x), y: Math.round(point.y - gesture.start.y) };
    else if(gesture.points){if(gesture.points.length<8192&&Math.hypot(point.x-gesture.points.at(-1)!.x,point.y-gesture.points.at(-1)!.y)>=.5)gesture.points.push(point);}
    else gesture.rect = selectionRect(gesture.start, point, gesture.before.width, gesture.before.height);
    this.preview();
  }
  private preview() {
    if (this.previewFrame !== undefined) return;
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = undefined; const g = this.gesture; if (!g) return;
      if (g.stroke) refreshBitmap(g.stroke.layer.bitmap!, g.stroke.takeDirty());
      const layer = g.stroke ? g.maskLayer?{...g.maskLayer,mask:maskFromStroke(g.maskLayer,g.stroke.layer)}:g.stroke.layer : g.layer && { ...g.layer, x: g.layer.x + (g.delta?.x ?? 0), y: g.layer.y + (g.delta?.y ?? 0) };
      if (layer) this.view.preview({ ...g.before, layers: replacePixel(g.before.layers, layer.id, layer) });
      else if(g.points)this.showPath(g.points);
      else this.showRect(g.rect ?? null);
    });
  }
  private finish(event: PointerEvent) {
    const g = this.gesture; if (!g || g.pointer !== event.pointerId) return;
    this.update(event); if (this.gesture !== g) return;
    this.gesture = undefined; if (this.previewFrame !== undefined) cancelAnimationFrame(this.previewFrame); this.previewFrame = undefined;
    if (this.view.viewport.hasPointerCapture(event.pointerId)) this.view.viewport.releasePointerCapture(event.pointerId);
    this.view.preview();
    if(g.stroke?.changed&&g.maskLayer)g.doc.setMask(g.maskLayer.id,maskFromStroke(g.maskLayer,g.stroke.layer));
    else if (g.stroke?.changed) g.doc.replaceLayerPixels(g.stroke.layer.id, g.stroke.layer, this.tool === 'eraser' ? '橡皮擦笔画' : '画笔笔画', g.before.revision, g.stroke.changedBounds);
    else if (g.layer && g.delta) g.doc.updateLayer(g.layer.id, { x: g.layer.x + g.delta.x, y: g.layer.y + g.delta.y });
    else if (!g.stroke && !g.layer) {
      const selected=g.points?polygonSelection(g.points,g.before.width,g.before.height):g.rect?(this.tool==='ellipse'?ellipseSelection(g.rect):g.rect):null;
      if(selected)g.doc.setSelection(combineSelection(g.before.selection,selected,this.tool==='crop'?'replace':g.mode!,g.before.width,g.before.height));
      else if(g.mode==='replace')g.doc.setSelection(null);
    }
    this.sync();
  }
  cancel() {
    const g = this.gesture; this.gesture = undefined; this.polygon=undefined; this.shown=undefined;
    if (this.previewFrame !== undefined) cancelAnimationFrame(this.previewFrame); this.previewFrame = undefined;
    if (g) { if (this.view.viewport.hasPointerCapture(g.pointer)) this.view.viewport.releasePointerCapture(g.pointer); this.view.preview(); }
    this.showRect(this.active()?.state.selection ?? null);
  }
  private selectionMode(event?:PointerEvent):SelectionMode {return event?.shiftKey&&event.altKey?'intersect':event?.shiftKey?'add':event?.altKey?'subtract':$<HTMLSelectElement>('selection-mode').value as SelectionMode;}
  private showPath(points:readonly Point[]){
    const doc=this.active();if(!doc)return;this.shown=undefined;const overlay=$('selection-outline'),canvas=$<HTMLCanvasElement>('selection-mask');overlay.hidden=false;overlay.classList.add('masked');Object.assign(overlay.style,{left:'0px',top:'0px',width:doc.state.width+'px',height:doc.state.height+'px'});canvas.hidden=false;canvas.width=doc.state.width;canvas.height=doc.state.height;const ctx=canvas.getContext('2d')!;ctx.strokeStyle='#ffffff';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();$('selection-info').textContent=points.length+' 个套索点';
  }
  private finishPolygon(){const p=this.polygon;if(!p)return;if(p.points.length<3)throw new Error('多边形套索至少需要 3 个点。');this.polygon=undefined;p.doc.setSelection(combineSelection(p.before.selection,polygonSelection(p.points,p.before.width,p.before.height),p.mode,p.before.width,p.before.height));this.sync();}
  private sampleBitmap(){const doc=this.active();if(!doc)throw new Error('请先打开文档。');const canvas=document.createElement('canvas');canvas.width=doc.state.width;canvas.height=doc.state.height;const ctx=canvas.getContext('2d')!;
    if($<HTMLSelectElement>('selection-source').value==='merged')ctx.drawImage(this.view.canvas,0,0);
    else {const layer=doc.selected;if(!layer||layer.kind!=='pixel')throw new Error('请先选择像素图层，或改为全部可见图层取样。');if(layer.bitmap){const offset=parentOffset(doc.state.layers,layer.id)!;ctx.drawImage(bitmapCanvas(layer.bitmap),layer.x+offset.x,layer.y+offset.y);}}
    const image=ctx.getImageData(0,0,canvas.width,canvas.height);canvas.width=canvas.height=1;return image;
  }
  private sampleColor(point:Point,contiguous:boolean,mode:SelectionMode){const doc=this.active();if(!doc)return;const bitmap=this.sampleBitmap(),x=Math.floor(point.x),y=Math.floor(point.y),i=(y*bitmap.width+x)*4,color=Array.from(bitmap.data.slice(i,i+4)) as [number,number,number,number];
    $<HTMLInputElement>('range-color').value='#'+color.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');
    const selected=colorSelection(bitmap,color,Number($<HTMLInputElement>('selection-tolerance').value),contiguous?point:undefined);doc.setSelection(combineSelection(doc.state.selection,selected,mode,doc.state.width,doc.state.height));this.view.viewport.focus({preventScroll:true});
  }
  selectColor(){this.cancel();const doc=this.active();if(!doc)return;const selected=colorSelection(this.sampleBitmap(),hexColor($<HTMLInputElement>('range-color').value),Number($<HTMLInputElement>('selection-tolerance').value));doc.setSelection(combineSelection(doc.state.selection,selected,this.selectionMode(),doc.state.width,doc.state.height));}
  invert(){this.cancel();const doc=this.active();if(doc)doc.setSelection(invertSelection(doc.state.selection,doc.state.width,doc.state.height));}
  modify(kind:'feather'|'expand'|'contract'){this.cancel();const doc=this.active();if(!doc?.state.selection)throw new Error('请先创建选区。');doc.setSelection(modifySelection(doc.state.selection,doc.state.width,doc.state.height,kind,Number($<HTMLInputElement>('selection-radius').value)));}
  selectAll() { this.cancel(); const doc = this.active(); if (doc) doc.setSelection({ x: 0, y: 0, width: doc.state.width, height: doc.state.height }); }
  deselect() { this.cancel(); this.active()?.setSelection(null); }
  fill(clear = false) {
    this.cancel(); const doc = this.active(); if (!doc?.selected) return;
    if(this.maskEditing){const source=maskStrokeState(doc.state,doc.selected.id),tone=clear?0:Number($<HTMLSelectElement>('mask-paint-tone').value);doc.setMask(doc.selected.id,maskFromStroke(doc.selected,fillPixels(source,doc.selected.id,[tone,tone,tone],clear?1:this.opacity)));return;}
    doc.replaceLayerPixels(doc.selected.id, fillPixels(doc.state, doc.selected.id, clear ? null : this.color, clear ? 1 : this.opacity), clear ? '清除选区像素' : '填充前景色');
  }
  crop() { this.cancel(); this.active()?.cropToSelection(); this.view.fit(); }
  transform(width: number, height: number, angle: number, flipX: boolean, flipY: boolean) {
    this.cancel(); const doc = this.active(), layer = doc?.selected; if (!doc || !layer?.bitmap) throw new Error('请选择含像素的图层。');
    if(layer.content||layer.mask)throw new Error('带可编辑内容或蒙版的图层请先栅格化／应用蒙版后变换。');
    const bitmap = transformBitmap(layer.bitmap, width, height, angle, flipX, flipY);
    doc.replaceLayerPixels(layer.id, { ...layer, bitmap, x: Math.round(layer.x + (layer.bitmap.width - bitmap.width) / 2), y: Math.round(layer.y + (layer.bitmap.height - bitmap.height) / 2) }, '变换图层');
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
  async export(format: 'png' | 'jpeg', quality: number): Promise<Blob> {
    this.cancel(); const doc = this.active(); if (!doc) throw new Error('请先打开文档。');
    if (!Number.isFinite(quality) || quality < 0.1 || quality > 1) throw new Error('JPEG 质量应为 10–100。');
    const canvas = document.createElement('canvas'); paintDocument(canvas, doc.state);
    if (format === 'jpeg') { const ctx = canvas.getContext('2d')!; ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    try { return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('导出失败。')), `image/${format}`, quality)); }
    finally { canvas.width = canvas.height = 1; }
  }
  dispose() { this.cancel(); this.abort.abort(); }
}
