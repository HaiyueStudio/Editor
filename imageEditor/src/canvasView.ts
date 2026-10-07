import { compositeState, hasAdvancedComposite } from './compositor.js';
import type { Bitmap, ImageLayer, ImageState } from './document.js';

export function paintDocument(canvas: HTMLCanvasElement, state: ImageState) {
  canvas.width = state.width; canvas.height = state.height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建 2D 画布。');
  if(hasAdvancedComposite(state.layers)){const image=compositeState(state);ctx.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>,image.width,image.height),0,0);return;}
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
        if (layer.kind === 'group') { source.width = 1; source.height = 1; }
      }
    }
  };
  draw(ctx, state.layers);
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
  const image = new ImageData(bitmap.data as Uint8ClampedArray<ArrayBuffer>, bitmap.width, bitmap.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0); while (cacheBytes + bitmap.data.byteLength > CACHE_BUDGET && bitmapCache.size) {
    const [key, old] = bitmapCache.entries().next().value!; old.width = old.height = 1; bitmapCache.delete(key); cacheBytes -= key.data.byteLength;
  }
  bitmapCache.set(bitmap, canvas); cacheBytes += bitmap.data.byteLength; return canvas;
}
export function refreshBitmap(bitmap: Bitmap, rect: { x: number; y: number; width: number; height: number } | undefined) {
  const canvas = bitmapCache.get(bitmap); if (!canvas || !rect) return;
  canvas.getContext('2d')!.putImageData(new ImageData(bitmap.data as Uint8ClampedArray<ArrayBuffer>, bitmap.width, bitmap.height), 0, 0, rect.x, rect.y, rect.width, rect.height);
}
function sameLayers(a: readonly ImageLayer[], b: readonly ImageLayer[]): boolean {
  return a.length === b.length && a.every((layer, i) => {
    const other = b[i]!;
    return layer.id === other.id && layer.visible === other.visible && layer.opacity === other.opacity && layer.blend === other.blend && layer.x === other.x && layer.y === other.y && layer.bitmap === other.bitmap && layer.mask === other.mask && layer.content === other.content && sameLayers(layer.children, other.children);
  });
}
interface Camera { zoom: number; x: number; y: number }
export class CanvasView {
  canPan = (event: PointerEvent) => event.button === 0;
  private cameras = new Map<string, Camera>();
  private state: ImageState | undefined;
  private renderedKey = '';
  private abort = new AbortController();
  private resize: ResizeObserver;
  constructor(readonly viewport: HTMLElement, readonly artboard: HTMLElement, readonly canvas: HTMLCanvasElement, private readonly changed: (zoom: number) => void) {
    const options = { signal: this.abort.signal };
    viewport.addEventListener('wheel', event => {
      if (!this.state) return; event.preventDefault();
      const box = viewport.getBoundingClientRect();
      this.zoom(this.camera.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2);
    }, { ...options, passive: false });
    let drag: { pointerId: number; x: number; y: number; cameraX: number; cameraY: number } | undefined;
    viewport.addEventListener('pointerdown', event => {
      if (!this.state || !this.canPan(event) || (event.target as HTMLElement).closest('button')) return;
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
    const samePixels = previous && state && previous.id === state.id && previous.width === state.width && previous.height === state.height && sameLayers(previous.layers, state.layers);
    if (this.state?.id !== state?.id) clearBitmapCache();
    this.state = state; this.artboard.hidden = !state;
    if (!state) { clearBitmapCache(); this.canvas.width = 1; this.canvas.height = 1; this.renderedKey = ''; return; }
    if (!this.cameras.has(state.id)) { this.cameras.set(state.id, { zoom: 1, x: 0, y: 0 }); this.fit(); }
    const key = `${state.id}:${state.revision}`;
    if (this.renderedKey !== key) { if (!samePixels) paintDocument(this.canvas, state); this.renderedKey = key; }
    this.artboard.style.width = `${state.width}px`; this.artboard.style.height = `${state.height}px`; this.transform();
  }
  point(event: { clientX: number; clientY: number }) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / this.camera.zoom, y: (event.clientY - rect.top) / this.camera.zoom };
  }
  preview(state?: ImageState) { if (state ?? this.state) paintDocument(this.canvas, (state ?? this.state)!); }
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
  dispose() { this.state = undefined; clearBitmapCache(); this.abort.abort(); this.resize.disconnect(); this.cameras.clear(); this.canvas.width = 1; this.canvas.height = 1; }
}
