import { GpuImageRenderer } from './gpuImageRenderer.js';
import { forEachCompositeTileAsync, bitmapRegionAsync } from './diskCompositor.js';
import { hasDiskPixels } from './pagedPixels.js';
import { bitmapRegion, isPaged, PAGE_SIZE } from './pagedPixels.js';
import { documentDamage } from './renderDamage.js';
import { invalidateFilterStack } from './liveEffects.js';
import { HdrDisplay } from './hdrDisplay.js';
import { colorDisplay } from './iccEngine.js';
import { displayBitmap, depthOf, pixelArray, withPixels } from './pixelFormat.js';
import { forEachCompositeTile, hasAdvancedComposite, type CompositeRect } from './compositor.js';
import type { Bitmap, ImageLayer, ImageState } from './document.js';

export function paintDocument(canvas: HTMLCanvasElement, state: ImageState, dirty?:CompositeRect) {
  if(canvas.width!==state.width||canvas.height!==state.height)dirty=undefined;
  const region=dirty??{x:0,y:0,width:state.width,height:state.height};
  if(!region.width||!region.height)return;
  if(canvas.width!==state.width)canvas.width=state.width;if(canvas.height!==state.height)canvas.height=state.height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建 2D 画布。');
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.clearRect(region.x,region.y,region.width,region.height);
  if(state.colorMode==='cmyk'||state.icc||state.psdOrigin||(state.bitDepth??8)!==8||hasAdvancedComposite(state.layers)){forEachCompositeTile(state,(image,rect)=>ctx.putImageData(new ImageData(colorDisplay(image,state).data as Uint8ClampedArray<ArrayBuffer>,image.width,image.height),rect.x,rect.y),256,region);return;}
  const draw = (context: CanvasRenderingContext2D, layers: readonly ImageLayer[], x = 0, y = 0) => {
    for (const layer of layers) {
      if (!layer.visible || layer.opacity === 0) continue;
      let source: HTMLCanvasElement | null = null;
      if (layer.kind === 'group') {
        source = document.createElement('canvas'); source.width = state.width; source.height = state.height;
        draw(source.getContext('2d')!, layer.children, x + layer.x, y + layer.y);
      } else if (layer.bitmap) source = bitmapCanvas(layer.bitmap);
      if (source) {
        context.save(); context.globalAlpha = layer.opacity;
        context.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
        context.drawImage(source, layer.kind === 'group' ? 0 : x + layer.x, layer.kind === 'group' ? 0 : y + layer.y); context.restore();
        if (layer.kind === 'group'||layer.bitmap&&!bitmapCache.has(layer.bitmap)) { source.width = 1; source.height = 1; }
      }
    }
  };
  ctx.save();try{ctx.beginPath();ctx.rect(region.x,region.y,region.width,region.height);ctx.clip();draw(ctx, state.layers);}finally{ctx.restore();}
}
export async function paintDocumentAsync(canvas:HTMLCanvasElement,state:ImageState,dirty?:CompositeRect,signal?:AbortSignal){
 if(!hasDiskPixels(state)){paintDocument(canvas,state,dirty);return;}
 if(canvas.width!==state.width||canvas.height!==state.height)dirty=undefined;
 const region=dirty??{x:0,y:0,width:state.width,height:state.height};if(!region.width||!region.height)return;
 const stage=document.createElement('canvas');stage.width=region.width;stage.height=region.height;const ctx=stage.getContext('2d')!;
 try{await forEachCompositeTileAsync(state,(image,rect)=>{signal?.throwIfAborted();ctx.putImageData(new ImageData(colorDisplay(image,state).data as Uint8ClampedArray<ArrayBuffer>,image.width,image.height),rect.x-region.x,rect.y-region.y);},signal,256,region);
 signal?.throwIfAborted();if(canvas.width!==state.width)canvas.width=state.width;if(canvas.height!==state.height)canvas.height=state.height;
 const target=canvas.getContext('2d')!;target.clearRect(region.x,region.y,region.width,region.height);target.drawImage(stage,region.x,region.y);
 }finally{stage.width=stage.height=1;}
}
const diskThumbnails=new WeakMap<Bitmap,Promise<HTMLCanvasElement>>();
export async function paintThumbnail(canvas:HTMLCanvasElement,b:Bitmap,signal?:AbortSignal){
 if(!hasDiskPixels(b))return paintThumbnailTiles(canvas,b,signal);
 let job=diskThumbnails.get(b);if(!job){const preview=document.createElement('canvas');preview.width=preview.height=62;job=paintThumbnailTiles(preview,b).then(()=>preview);diskThumbnails.set(b,job);void job.catch(()=>diskThumbnails.delete(b));}
 const preview=await job;signal?.throwIfAborted();canvas.getContext('2d')!.drawImage(preview,0,0,canvas.width,canvas.height);
}
async function paintThumbnailTiles(canvas:HTMLCanvasElement,b:Bitmap,signal?:AbortSignal){
 if(!hasDiskPixels(b)){const source=bitmapThumbnail(b),scale=Math.min(canvas.width/b.width,canvas.height/b.height);canvas.getContext('2d')!.drawImage(source,(canvas.width-b.width*scale)/2,(canvas.height-b.height*scale)/2,b.width*scale,b.height*scale);return;}
 const ctx=canvas.getContext('2d')!,scale=Math.min(canvas.width/b.width,canvas.height/b.height),ox=(canvas.width-b.width*scale)/2,oy=(canvas.height-b.height*scale)/2,temp=document.createElement('canvas');
 for(let y=0;y<b.height;y+=PAGE_SIZE)for(let x=0;x<b.width;x+=PAGE_SIZE){signal?.throwIfAborted();const part=await bitmapRegionAsync(b,{x,y,width:Math.min(PAGE_SIZE,b.width-x),height:Math.min(PAGE_SIZE,b.height-y)},signal);temp.width=part.width;temp.height=part.height;temp.getContext('2d')!.putImageData(new ImageData(displayBitmap(part).data as Uint8ClampedArray<ArrayBuffer>,part.width,part.height),0,0);ctx.drawImage(temp,ox+x*scale,oy+y*scale,part.width*scale,part.height*scale);}temp.width=temp.height=1;
}
const CACHE_BUDGET = 64 * 1024 * 1024;
const bitmapCache = new Map<Bitmap, HTMLCanvasElement>();
let cacheBytes = 0;
export function clearBitmapCache() {
  for (const canvas of bitmapCache.values()) canvas.width = canvas.height = 1;
  bitmapCache.clear(); cacheBytes = 0;
}
export function bitmapCacheStats() { return { entries: bitmapCache.size, bytes: cacheBytes, budget: CACHE_BUDGET }; }
export function bitmapCanvas(bitmap: Bitmap): HTMLCanvasElement {
  const cached = bitmapCache.get(bitmap); if (cached) { bitmapCache.delete(bitmap); bitmapCache.set(bitmap, cached); return cached; }
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const image = new ImageData(displayBitmap(bitmap).data as Uint8ClampedArray<ArrayBuffer>, bitmap.width, bitmap.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0); if(bitmap.data.byteLength>CACHE_BUDGET)return canvas;while (cacheBytes + bitmap.data.byteLength > CACHE_BUDGET && bitmapCache.size) {
    const [key, old] = bitmapCache.entries().next().value!; old.width = old.height = 1; bitmapCache.delete(key); cacheBytes -= key.width*key.height*((key.depth??8)===8?4:16);
  }
  bitmapCache.set(bitmap, canvas); cacheBytes += bitmap.data.byteLength; return canvas;
}
const thumbnailCache=new WeakMap<Bitmap,HTMLCanvasElement>();
/** Build small layer previews without materializing a full paged layer. */
export function bitmapThumbnail(bitmap:Bitmap):HTMLCanvasElement {
  if(!isPaged(bitmap))return bitmapCanvas(bitmap);
  const cached=thumbnailCache.get(bitmap);if(cached)return cached;
  const scale=Math.min(1,62/bitmap.width,62/bitmap.height),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d')!,part=document.createElement('canvas');
  for(let y=0;y<bitmap.height;y+=PAGE_SIZE)for(let x=0;x<bitmap.width;x+=PAGE_SIZE){
    const b=bitmapRegion(bitmap,x,y,Math.min(PAGE_SIZE,bitmap.width-x),Math.min(PAGE_SIZE,bitmap.height-y));
    part.width=b.width;part.height=b.height;part.getContext('2d')!.putImageData(new ImageData(b.data as Uint8ClampedArray<ArrayBuffer>,b.width,b.height),0,0);
    const left=Math.round(x*canvas.width/bitmap.width),top=Math.round(y*canvas.height/bitmap.height),right=Math.round((x+b.width)*canvas.width/bitmap.width),bottom=Math.round((y+b.height)*canvas.height/bitmap.height);
    if(right>left&&bottom>top)ctx.drawImage(part,left,top,right-left,bottom-top);
  }
  part.width=part.height=1;thumbnailCache.set(bitmap,canvas);return canvas;
}
export function refreshBitmap(bitmap: Bitmap, rect: { x: number; y: number; width: number; height: number } | undefined) {
  if(rect)invalidateFilterStack(bitmap);
  const canvas = bitmapCache.get(bitmap); if (!canvas || !rect) return;
  const x=Math.max(0,rect.x),y=Math.max(0,rect.y),w=Math.min(bitmap.width,rect.x+rect.width)-x,h=Math.min(bitmap.height,rect.y+rect.height)-y;if(w<=0||h<=0)return;
  const data=pixelArray(w*h*4,bitmap);for(let row=0;row<h;row++){const start=((y+row)*bitmap.width+x)*4;data.set(bitmap.data.subarray(start,start+w*4),row*w*4);}
  const part=displayBitmap(withPixels(w,h,data,bitmap));canvas.getContext('2d')!.putImageData(new ImageData(part.data as Uint8ClampedArray<ArrayBuffer>,w,h),x,y);
}
function sameLayers(a: readonly ImageLayer[], b: readonly ImageLayer[]): boolean {
  return a.length === b.length && a.every((layer, i) => {
    const other = b[i]!;
    return layer.id === other.id && layer.visible === other.visible && layer.opacity === other.opacity && layer.blend === other.blend && layer.passThrough===other.passThrough && layer.x === other.x && layer.y === other.y && layer.bitmap === other.bitmap && layer.mask === other.mask && layer.clipping===other.clipping && layer.styles===other.styles && layer.smartFilters===other.smartFilters && layer.filterMask===other.filterMask && layer.blendIf===other.blendIf && layer.content === other.content && sameLayers(layer.children, other.children);
  });
}
interface Camera { zoom: number; x: number; y: number }
export class CanvasView {
  canPan = (event: PointerEvent) => event.button === 0;
  private hdr:HdrDisplay;
  private painting:AbortController|undefined;
  private gpu:GpuImageRenderer;
  private fallbackValid=false;
  get displayCanvas(){return this.gpu.canvas.hidden?this.canvas:this.gpu.canvas;}
  private paint(state:ImageState,dirty?:CompositeRect,mutable=false){
    if(dirty?.width===0&&this.canvas.dataset.painting==='true')return;
    // Damage is relative to the previous request. If it was canceled, rebuild from the complete state.
    if(this.canvas.dataset.painting==='true')dirty=undefined;
    this.painting?.abort();this.painting=new AbortController();const signal=this.painting.signal;
    this.canvas.dataset.painting="true";
    void (async()=>{
      const gpu=await this.gpu.render(state,dirty,signal,mutable);signal.throwIfAborted();
      if(!gpu){await paintDocumentAsync(this.canvas,state,this.fallbackValid?dirty:undefined,signal);signal.throwIfAborted();this.gpu.hide();this.fallbackValid=true;}else this.fallbackValid=false;
      this.canvas.dataset.painting="false";this.viewport.dispatchEvent(new CustomEvent("image-painted"));this.hdr.render(state);
    })().catch(error=>{if(!signal.aborted){this.canvas.dataset.painting="error";this.viewport.dispatchEvent(new CustomEvent("image-render-error",{detail:String(error)}));}});
  }

  private cameras = new Map<string, Camera>();
  private state: ImageState | undefined;
  private renderedKey = '';
  private abort = new AbortController();
  private resize: ResizeObserver;
  constructor(readonly viewport: HTMLElement, readonly artboard: HTMLElement, readonly canvas: HTMLCanvasElement, private readonly changed: (zoom: number) => void) {
    this.gpu=new GpuImageRenderer(canvas,()=>{if(this.state)this.paint(this.state);});
    this.hdr=new HdrDisplay(canvas);
    window.addEventListener('haiyue-hdr-status',((event:CustomEvent)=>{this.gpu.canvas.style.visibility=event.detail.active?'hidden':'';}) as EventListener,{signal:this.abort.signal});
    const options = { signal: this.abort.signal };
    viewport.addEventListener('wheel', event => {
      if (!this.state) return; event.preventDefault();
      const box = viewport.getBoundingClientRect();
      this.zoom(this.camera.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2);
    }, { ...options, passive: false });
    let drag: { pointerId: number; x: number; y: number; cameraX: number; cameraY: number } | undefined;
    viewport.addEventListener('pointerdown', event => {
      if (!this.state || !this.canPan(event) || (event.target as HTMLElement).closest('button, hy-button')) return;
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cameraX: this.camera.x, cameraY: this.camera.y };
      viewport.setPointerCapture(event.pointerId); viewport.classList.add('panning');
    }, options);
    viewport.addEventListener('pointermove', event => {
      if (!drag || !this.state || event.pointerId !== drag.pointerId) return;
      this.camera.x = drag.cameraX + event.clientX - drag.x; this.camera.y = drag.cameraY + event.clientY - drag.y; this.transform();
    }, options);
    const end = () => { drag = undefined; viewport.classList.remove('panning'); };
    viewport.addEventListener('pointerup', end, options); viewport.addEventListener('pointercancel', end, options); viewport.addEventListener('lostpointercapture', end, options);
    this.resize = new ResizeObserver(() => { if (this.state) this.transform(); }); this.resize.observe(viewport);
  }
  private get camera() { return this.cameras.get(this.state!.id)!; }
  setDocument(state: ImageState | undefined) {
    const previous = this.state;
    const samePixels = previous && state && previous.id === state.id && previous.width === state.width && previous.height === state.height && previous.bitDepth===state.bitDepth && previous.display===state.display && previous.icc===state.icc && previous.psdOrigin===state.psdOrigin && sameLayers(previous.layers, state.layers);
    if (this.state?.id !== state?.id) clearBitmapCache();
    this.state = state; this.artboard.hidden = !state;
    if (!state) { this.painting?.abort();this.gpu.reset();this.fallbackValid=false;this.hdr.hide();clearBitmapCache(); this.canvas.width = 1; this.canvas.height = 1; this.renderedKey = ''; return; }
    if (!this.cameras.has(state.id)) { this.cameras.set(state.id, { zoom: 1, x: 0, y: 0 }); this.fit(); }
    const key = `${state.id}:${state.revision}`;
    if (this.renderedKey !== key) { if (!samePixels){this.paint(state,previous?documentDamage(previous,state):undefined);} this.renderedKey = key; }
    this.artboard.style.width = `${state.width}px`; this.artboard.style.height = `${state.height}px`; this.transform();
  }
  get scale(){return this.state?this.camera.zoom:1;}
  point(event: { clientX: number; clientY: number }) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / this.camera.zoom, y: (event.clientY - rect.top) / this.camera.zoom };
  }
  preview(state?: ImageState,dirty?:CompositeRect,mutable=false) { const value=state??this.state;if(value){this.paint(value,dirty,mutable);} }
  forget(id: string) { this.cameras.delete(id); clearBitmapCache(); }
  fit() {
    if (!this.state) return;
    this.camera.zoom = Math.max(0.05, Math.min(1, (this.viewport.clientWidth - 120) / this.state.width, (this.viewport.clientHeight - 120) / this.state.height));
    this.camera.x = 0; this.camera.y = 0; this.transform();
  }
  zoom(value: number, x = 0, y = 0) {
    if (!this.state) return;
    const camera = this.camera, next = Math.max(0.05, Math.min(8, value));
    camera.x = x - (x - camera.x) * next / camera.zoom; camera.y = y - (y - camera.y) * next / camera.zoom; camera.zoom = next; this.transform();
  }
  private transform() {
    const { zoom, x, y } = this.camera;
    this.artboard.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${zoom})`;
    this.changed(zoom);
  }
  dispose() { this.painting?.abort();this.gpu.dispose();this.hdr.dispose();this.state = undefined; clearBitmapCache(); this.abort.abort(); this.resize.disconnect(); this.cameras.clear(); this.canvas.width = 1; this.canvas.height = 1; }
}
