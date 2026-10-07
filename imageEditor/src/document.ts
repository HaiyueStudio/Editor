import { BLEND_MODES, maskWeight, validateContent, type BlendMode, type LayerMask, type LayerContent } from './layerFeatures.js';
import { pixelHistory } from './pixelHistory.js';
import { MAX_PSD_RESOURCES, resourceBlocks } from './psdResources.js';
import { selectionCount, type Selection } from './selection.js';
import { EditorHistoryService } from '@haiyue/editor-platform';
import type { EditorDocumentAdapter, EditorDisposable } from '@haiyue/editor-plugin-sdk';

export interface Bitmap { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }
export interface ImageLayer {
  readonly id: string; readonly name: string; readonly visible: boolean; readonly locked: boolean;
  readonly opacity: number; readonly blend: BlendMode;
  readonly x: number; readonly y: number;
  readonly content?: LayerContent; readonly mask?: LayerMask;
  readonly kind: 'pixel' | 'group' | 'adjustment'; readonly bitmap: Bitmap | null; readonly children: readonly ImageLayer[];
}
export interface ImageState {
  readonly id: string; readonly name: string; readonly width: number; readonly height: number;
  readonly psdOrigin?: { readonly sourceName: string; readonly resources: Uint8Array; readonly flattened: boolean };
  readonly selection?: Selection | null;
  readonly layers: readonly ImageLayer[]; readonly selectedId: string | null; readonly revision: number;
}
export const IMAGE_LIMITS = Object.freeze({ dimension: 8192, pixels: 16_777_216, bytes: 128 * 1024 * 1024, layers: 128, depth: 16, documents: 8 });
export const uid = () => crypto.randomUUID();
export function checkSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > IMAGE_LIMITS.dimension || height > IMAGE_LIMITS.dimension || width * height > IMAGE_LIMITS.pixels)
    throw new Error('画布或图片尺寸超出范围（边长 1–8192，最多 1677 万像素）。');
}
export function allLayers(layers: readonly ImageLayer[]): ImageLayer[] { return layers.flatMap(layer => [layer, ...allLayers(layer.children)]); }
export function findLayer(layers: readonly ImageLayer[], id: string | null): ImageLayer | undefined { return allLayers(layers).find(layer => layer.id === id); }
export function pixelBytes(layers: readonly ImageLayer[]): number { return allLayers(layers).reduce((sum, layer) => sum + (layer.bitmap?.data.byteLength ?? 0) + (layer.mask?.data.byteLength ?? 0), 0); }
function retainedStateBytes(...states: ImageState[]) {
  const buffers = new Set<ArrayBufferLike>();
  for (const state of states) {
    for (const layer of allLayers(state.layers))  { if (layer.bitmap) buffers.add(layer.bitmap.data.buffer); if(layer.mask)buffers.add(layer.mask.data.buffer); }
    if (state.selection?.mask) buffers.add(state.selection.mask.buffer);
    if (state.psdOrigin) buffers.add(state.psdOrigin.resources.buffer);
  }
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}
export function layerLocked(layers: readonly ImageLayer[], id: string, inherited = false): boolean {
  for (const layer of layers) {
    if (layer.id === id) return inherited || layer.locked;
    if (findLayer(layer.children, id)) return layerLocked(layer.children, id, inherited || layer.locked);
  }
  return false;
}
function replace(layers: readonly ImageLayer[], id: string, operation: (layer: ImageLayer) => ImageLayer): ImageLayer[] {
  return layers.map(layer => layer.id === id ? operation(layer) : layer.children.length ? { ...layer, children: replace(layer.children, id, operation) } : layer);
}
function siblings(layers: readonly ImageLayer[], id: string, operation: (items: readonly ImageLayer[], index: number) => readonly ImageLayer[]): readonly ImageLayer[] {
  const index = layers.findIndex(layer => layer.id === id);
  return index >= 0 ? operation(layers, index) : layers.map(layer => ({ ...layer, children: siblings(layer.children, id, operation) }));
}
function freezeState(state: ImageState): ImageState {
  const freeze = (layers: readonly ImageLayer[]): readonly ImageLayer[] => Object.freeze(layers.map(layer => Object.freeze({ ...layer, ...(layer.content ? {content:Object.freeze({...layer.content})}:{}), ...(layer.mask?{mask:Object.freeze({...layer.mask})}:{}), children: freeze(layer.children) })));
  return Object.freeze({ ...state, selection: state.selection ? Object.freeze({ ...state.selection }) : null, layers: freeze(state.layers) });
}
export function validateState(state: ImageState) {
  checkSize(state.width, state.height);
  if (state.psdOrigin) {
    const origin = state.psdOrigin;
    if (typeof origin.sourceName !== 'string' || origin.sourceName.length > 160 || typeof origin.flattened !== 'boolean' || !(origin.resources instanceof Uint8Array) || origin.resources.length > MAX_PSD_RESOURCES) throw new Error('PSD 来源数据无效。');
    resourceBlocks(origin.resources);
  }
  const rect = state.selection;
  if (rect && (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > state.width || rect.y + rect.height > state.height)) throw new Error('选区超出画布或无效。');
  if (rect?.mask && (!(rect.mask instanceof Uint8Array) || rect.mask.length !== rect.width * rect.height)) throw new Error('选区蒙版无效。');
  if (!state.name.trim() || state.name.length > 160) throw new Error('文档名称长度应为 1–160 个字符。');
  const ids = new Set<string>();
  let bytes = 0;
  const visit = (layers: readonly ImageLayer[], depth: number) => {
    if (depth > IMAGE_LIMITS.depth) throw new Error('图层组嵌套过深。');
    for (const layer of layers) {
      if (ids.has(layer.id) || !layer.id || layer.id.length > 80) throw new Error('图层 ID 无效或重复。');
      ids.add(layer.id);
      if (!layer.name.trim() || layer.name.length > 160) throw new Error('图层名称长度应为 1–160 个字符。');
      if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || !Object.hasOwn(BLEND_MODES, layer.blend)) throw new Error('图层合成参数无效。');
      if (![layer.x, layer.y].every(value => Number.isInteger(value) && Math.abs(value) <= 32768)) throw new Error('图层坐标必须是 -32768–32768 范围内的整数。');
      if (typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') throw new Error('图层状态无效。');
      if (layer.kind !== 'group' && layer.children.length || layer.kind === 'group' && layer.bitmap) throw new Error('图层类型与内容不一致。');
      if (layer.kind !== 'pixel' && layer.kind !== 'group' && layer.kind !== 'adjustment') throw new Error('未知图层类型。');
      if (layer.content) {
        validateContent(layer.content);
        if(layer.content.type==='adjustment' ? layer.kind!=='adjustment'||Boolean(layer.bitmap) : layer.kind!=='pixel'||!layer.bitmap)throw new Error('图层内容与类型不一致。');
      }
      if(layer.kind==='adjustment'&&(!layer.content||layer.content.type!=='adjustment'||layer.blend!=='normal'))throw new Error('调整图层需要正常模式及有效参数。');
      if(layer.mask){const mask=layer.mask;checkSize(mask.width,mask.height);if(!(mask.data instanceof Uint8Array)||mask.data.length!==mask.width*mask.height||![mask.x,mask.y].every(n=>Number.isInteger(n)&&Math.abs(n)<=32768)||typeof mask.disabled!=='boolean'||!Number.isInteger(mask.defaultColor)||mask.defaultColor<0||mask.defaultColor>255)throw new Error('图层蒙版无效。');bytes+=mask.data.byteLength;}
      if (layer.bitmap) {
        checkSize(layer.bitmap.width, layer.bitmap.height);
        if (!(layer.bitmap.data instanceof Uint8ClampedArray) || layer.bitmap.data.length !== layer.bitmap.width * layer.bitmap.height * 4) throw new Error('图层像素数据不完整。');
        bytes += layer.bitmap.data.byteLength;
      }
      visit(layer.children, depth + 1);
    }
  };
  visit(state.layers, 0);
  if (ids.size > IMAGE_LIMITS.layers || bytes > IMAGE_LIMITS.bytes) throw new Error('文档最多容纳 128 个图层和 128 MiB 像素。');
  if (state.selectedId && !ids.has(state.selectedId)) throw new Error('选中图层不存在。');
}
export function makeLayer(name: string, bitmap: Bitmap | null = null, kind: 'pixel' | 'group' = 'pixel'): ImageLayer {
  return { id: uid(), name, kind, bitmap, children: [], visible: true, locked: false, opacity: 1, blend: 'normal', x: 0, y: 0 };
}

export class ImageDocument implements EditorDocumentAdapter<ImageState> {
  readonly history = new EditorHistoryService({ byteBudget: 256 * 1024 * 1024, maxEntries: 100 });
  private listeners = new Set<() => void>();
  private current: ImageState;
  private nextRevision: number;
  private saved = 0;
  private disposed = false;
  // Create these outside edit(): its fallback closures retain dense before/after snapshots.
  private readHistoryState = () => this.current;
  private writeHistoryState = (state: ImageState) => { this.current = Object.isFrozen(state) ? state : freezeState(state); this.emit(); };
  constructor(state: ImageState, saved = false) {
    validateState(state); this.current = freezeState(state); this.nextRevision = state.revision;
    if (saved) this.saved = state.revision;
  }
  static create(name: string, width: number, height: number, white = false) {
    checkSize(width, height);
    const bitmap = white ? { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) } : null;
    const layer = makeLayer(white ? '背景' : '图层 1', bitmap);
    return new ImageDocument({ id: uid(), name, width, height, layers: [layer], selectedId: layer.id, revision: 1 });
  }
  get state() { return this.current; }
  get identity() { return { id: this.current.id, name: this.current.name, kind: 'haiyue.image' }; }
  get revision() { return this.current.revision; }
  get savedRevision() { return this.saved; }
  get dirty() { return this.revision !== this.saved; }
  get selected() { return findLayer(this.current.layers, this.current.selectedId); }
  serialize() { return this.current; }
  markSaved(revision = this.revision) { this.saved = revision; this.emit(); }
  subscribe(listener: () => void): EditorDisposable { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; }
  select(id: string | null) {
    if (id && !findLayer(this.current.layers, id)) throw new Error('图层不存在。');
    this.current = Object.freeze({ ...this.current, selectedId: id }); this.emit();
  }
  private edit(label: string, change: (before: ImageState) => ImageState, pixelId?: string, bounds?: { x: number; y: number; width: number; height: number }) {
    if (this.disposed) throw new Error('文档已关闭。');
    const before = this.current;
    const candidate = change(before);
    const after = freezeState({ ...candidate, revision: this.nextRevision + 1 });
    validateState(after);
    const delta = pixelId ? pixelHistory(label, before, after, pixelId, this.readHistoryState, this.writeHistoryState, bounds) : undefined;
    if (delta) {
      // Recording performs budget validation before publication; redo applies the reversible tiles.
      this.history.recordApplied(delta); this.current = after; this.emit();
    } else this.history.execute({ label, estimatedBytes: retainedStateBytes(before, after) + 1024,
      execute: () => { this.current = after; this.emit(); }, undo: () => { this.current = before; this.emit(); } });
    this.nextRevision++;
  }
  setSelection(selection: Selection | null) {
    if (!selection && !this.current.selection) return;
    const owned = selection ? { ...selection, ...(selection.mask ? { mask: selection.mask.slice() } : {}) } : null;
    this.edit('修改选区', state => ({ ...state, selection: owned }));
  }
  replaceLayerPixels(id: string, value: ImageLayer, label: string, expectedRevision = this.revision, bounds?: { x: number; y: number; width: number; height: number }) {
    const layer = findLayer(this.current.layers, id);
    if (this.revision !== expectedRevision) throw new Error('文档已变化，请重新操作。');
    if(layer?.content)throw new Error('请先栅格化文字或形状图层，再进行像素编辑。');
    if (!layer || layer.kind !== 'pixel' || value.kind !== 'pixel') throw new Error('请选择像素图层。');
    if (layerLocked(this.current.layers, id)) throw new Error('图层或上级图层组已锁定。');
    if (value.bitmap && value.bitmap.data.length !== value.bitmap.width * value.bitmap.height * 4) throw new Error('图层像素数据不完整。');
    const owned = { ...layer, x: value.x, y: value.y, bitmap: value.bitmap ? { ...value.bitmap, data: bounds ? value.bitmap.data : value.bitmap.data.slice() } : null };
    let region = bounds;
    if (region && owned.bitmap && layer.bitmap && owned.bitmap.width === layer.bitmap.width && owned.bitmap.height === layer.bitmap.height && value.x === layer.x && value.y === layer.y) {
      if (![region.x, region.y, region.width, region.height].every(Number.isInteger) || region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 || region.x + region.width > owned.bitmap.width || region.y + region.height > owned.bitmap.height) throw new Error('像素更新范围无效。');
      // Restrict the actual edit as well as its history diff: hints cannot hide changes outside the region.
      const data = layer.bitmap.data.slice(), width = layer.bitmap.width;
      for (let y = region.y; y < region.y + region.height; y++) {
        const start = (y * width + region.x) * 4; data.set(owned.bitmap.data.subarray(start, start + region.width * 4), start);
      }
      owned.bitmap = { ...owned.bitmap, data };
    } else { region = undefined; if (bounds && owned.bitmap) owned.bitmap = { ...owned.bitmap, data: owned.bitmap.data.slice() }; }
    this.edit(label, state => ({ ...state, layers: replace(state.layers, id, () => owned) }), id, region);
  }
  setMask(id:string,mask:LayerMask|undefined) {
    if(layerLocked(this.state.layers,id))throw new Error('图层已锁定。');
    if(!findLayer(this.state.layers,id))throw new Error('图层不存在。');
    const owned=mask?{...mask,data:mask.data.slice()}:undefined;
    this.edit('修改图层蒙版',state=>({...state,layers:replace(state.layers,id,layer=>{const {mask:old,...rest}=layer;return {...rest,...(owned?{mask:owned}:{})};})}));
  }
  setContent(id:string,content:LayerContent,bitmap:Bitmap|null) {
    if(layerLocked(this.state.layers,id))throw new Error('图层已锁定。');
    const layer=findLayer(this.state.layers,id);if(!layer||layer.kind==='group')throw new Error('请选择内容图层。');
    validateContent(content);const owned=bitmap?{...bitmap,data:bitmap.data.slice()}:null;
    this.edit('编辑图层内容',state=>({...state,layers:replace(state.layers,id,item=>({...item,kind:content.type==='adjustment'?'adjustment':'pixel',content:{...content},bitmap:owned}))}));
  }
  rasterizeSelected() {
    const layer=this.selected;if(!layer?.content)return;if(layer.kind==='adjustment')throw new Error('调整图层请通过合并副本导出，或删除后撤销调整。');
    if(layerLocked(this.state.layers,layer.id))throw new Error('图层已锁定。');
    this.edit('栅格化图层',state=>({...state,layers:replace(state.layers,layer.id,item=>{const {content,...rest}=item;return rest;})}));
  }
  applySelectedMask() {
    const layer=this.selected;if(!layer?.mask||!layer.bitmap||layer.content)throw new Error('应用蒙版前请选择像素图层，并栅格化可编辑内容。');
    if(layerLocked(this.state.layers,layer.id))throw new Error('图层已锁定。');
    if(layer.mask.disabled)throw new Error('请先启用蒙版。');
    const data=layer.bitmap.data.slice();
    for(let y=0;y<layer.bitmap.height;y++)for(let x=0;x<layer.bitmap.width;x++)data[(y*layer.bitmap.width+x)*4+3]=Math.round(data[(y*layer.bitmap.width+x)*4+3]!*maskWeight(layer.mask,x,y));
    this.edit('应用图层蒙版',state=>({...state,layers:replace(state.layers,layer.id,item=>{const {mask,...rest}=item;return {...rest,bitmap:{...layer.bitmap!,data}};})}));
  }
  cropToSelection() {
    const rect = this.current.selection; if (!rect || !selectionCount(rect)) throw new Error('请先拖出非空裁剪区域。');
    if (allLayers(this.current.layers).some(layer => layer.locked)) throw new Error('裁剪会移动所有图层，请先解锁图层。');
    this.edit('裁剪画布', state => ({ ...state, width: rect.width, height: rect.height, selection: null,
      layers: state.layers.map(layer => ({ ...layer, x: layer.x - rect.x, y: layer.y - rect.y })) }));
  }
  rename(name: string) { if (name.trim() !== this.current.name) this.edit('重命名文档', state => ({ ...state, name: name.trim() })); }
  addLayer(layer: ImageLayer, intoSelection = true) {
    // Pixels become document-owned; caller mutations cannot change history or recovery snapshots.
    const clone = (item: ImageLayer): ImageLayer => ({ ...item, ...(item.content?{content:{...item.content}}:{}), ...(item.mask?{mask:{...item.mask,data:item.mask.data.slice()}}:{}), bitmap: item.bitmap ? { ...item.bitmap, data: item.bitmap.data.slice() } : null, children: item.children.map(clone) });
    const owned = clone(layer);
    this.edit('添加图层', state => {
      const selected = intoSelection ? this.selected : undefined;
      if (selected && layerLocked(state.layers, selected.id)) throw new Error('请先解锁选中的图层或图层组。');
      const layers = selected?.kind === 'group' ? replace(state.layers, selected.id, group => ({ ...group, children: [...group.children, owned] }))
        : selected ? siblings(state.layers, selected.id, (items, i) => [...items.slice(0, i + 1), owned, ...items.slice(i + 1)]) : [...state.layers, owned];
      return { ...state, layers, selectedId: owned.id };
    });
  }
  updateLayer(id: string, patch: Partial<Pick<ImageLayer, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'x' | 'y'>>) {
    const existing = findLayer(this.current.layers, id);
    if (!existing) throw new Error('图层不存在。');
    if (Object.entries(patch).every(([key, value]) => existing[key as keyof ImageLayer] === value)) return;
    if (layerLocked(this.current.layers, id) && Object.keys(patch).some(key => key !== 'visible' && key !== 'locked')) throw new Error('图层已锁定。');
    this.edit('修改图层', state => ({ ...state, layers: replace(state.layers, id, layer => ({ ...layer, ...patch })) }));
  }
  deleteSelected() {
    const selected = this.selected; if (!selected) return;
    if (layerLocked(this.current.layers, selected.id)) throw new Error('图层已锁定。');
    this.edit('删除图层', state => {
      const layers = siblings(state.layers, selected.id, (items, i) => items.filter((_item, index) => index !== i));
      return { ...state, layers, selectedId: layers.at(-1)?.id ?? null };
    });
  }
  duplicateSelected() {
    const selected = this.selected; if (!selected) return;
    if (layerLocked(this.current.layers, selected.id)) throw new Error('图层已锁定。');
    const duplicate = (layer: ImageLayer): ImageLayer => ({ ...layer, id: uid(), ...(layer.content?{content:{...layer.content}}:{}), ...(layer.mask?{mask:{...layer.mask,data:layer.mask.data.slice()}}:{}), bitmap: layer.bitmap ? { ...layer.bitmap, data: layer.bitmap.data.slice() } : null, children: layer.children.map(duplicate) });
    const copy = { ...duplicate(selected), name: selected.name.slice(0, 156) + ' 副本' };
    this.edit('复制图层', state => ({ ...state, layers: siblings(state.layers, selected.id, (items, i) => [...items.slice(0, i + 1), copy, ...items.slice(i + 1)]), selectedId: copy.id }));
  }
  reorder(direction: -1 | 1) {
    const selected = this.selected; if (!selected) return;
    if (layerLocked(this.current.layers, selected.id)) throw new Error('图层已锁定。');
    let changed = false;
    const layers = siblings(this.current.layers, selected.id, (items, i) => {
      const other = i + direction; if (other < 0 || other >= items.length) return items;
      const next = [...items]; [next[i], next[other]] = [next[other]!, next[i]!]; changed = true; return next;
    });
    if (changed) this.edit('调整图层顺序', state => ({ ...state, layers }));
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.history.dispose(); this.listeners.clear(); const { psdOrigin, ...metadata } = this.current; this.current = Object.freeze({ ...metadata, layers: [], selectedId: null, selection: null }); }
  private emit() { for (const listener of this.listeners) listener(); }
}
