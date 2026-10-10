import { applyLayerComp, captureLayerComp, validateLayerComps, freezeLayerComps, type LayerComps } from './layerComps.js';
import { isLayerLocked, validateLocks, protectLayerChanges, type LayerLocks, type LockAction } from './layerLocks.js';
import { archiveBytes, hydrateArchive, validateDiskBlob, type DiskBacking } from './diskPager.js';
import { pageBuffers, hydratePixels, hydrateBitmap, pagedState, packLayers, pixelStorageBytes, isPaged, type PixelPages } from './pagedPixels.js';
import { synchronizeCmyk,validateCmyk } from './cmyk.js';
import { embeddedProfile,profileResource,srgbProfileBytes } from './colorManagement.js';
import { concatBytes } from './psdResources.js';
import { workingProfile,convertIccLayers,linearSrgbProfile,inspectIccBytes, type IccSettings } from './iccEngine.js';
import { type BitDepth, type PixelArray, type DisplaySettings, validateBitmap, normalizeLayers } from './pixelFormat.js';
import { freezeProductivity, validateProductivity, type AlphaChannel, type Layout, type ImageAction } from './productivityModel.js';
import { liveBitmap, validateSmartFilters, validateBlendIf, type SmartFilter, type BlendIf } from './liveEffects.js';
import { validateMask } from './maskEffects.js';
import { BLEND_MODES, maskWeight, validateContent, validateStyles, cloneContent, freezeContent, type LayerStyles, type BlendMode, type LayerMask, type LayerContent } from './layerFeatures.js';
import { pixelHistory } from './pixelHistory.js';
import { MAX_PSD_RESOURCES, resourceBlocks } from './psdResources.js';
import { selectionCount, type Selection } from './selection.js';
import { EditorHistoryService } from '@haiyue/editor-platform';
import type { EditorDocumentAdapter, EditorDisposable } from '@haiyue/editor-plugin-sdk';

export interface Bitmap { readonly width: number; readonly height: number; readonly data: PixelArray; readonly depth?:BitDepth; readonly cmyk?:Float32Array; readonly pages?:PixelPages }
export interface ImageLayer {
  readonly passThrough?:boolean; readonly nativePsd?:{id:number;contentKey:string;stylesKey:string};
  readonly id: string; readonly name: string; readonly visible: boolean; readonly locked: boolean; readonly locks?: LayerLocks;
  readonly opacity: number; readonly blend: BlendMode;
  readonly x: number; readonly y: number;
  readonly clipping?: boolean; readonly styles?: LayerStyles;
  readonly smartFilters?:readonly SmartFilter[]; readonly filterMask?:LayerMask; readonly blendIf?:BlendIf;
  readonly content?: LayerContent; readonly mask?: LayerMask;
  readonly kind: 'pixel' | 'group' | 'adjustment'; readonly bitmap: Bitmap | null; readonly children: readonly ImageLayer[];
}
export interface ImageState {
  readonly layerComps?:LayerComps;
  readonly paging?:{enabled:boolean}; readonly psdArchive?:Uint8Array; readonly psdArchiveStore?:DiskBacking;
  readonly colorMode?:'rgb'|'cmyk';readonly icc?:IccSettings; readonly bitDepth?:BitDepth; readonly display?:DisplaySettings;
  readonly channels?:readonly AlphaChannel[]; readonly layout?:Layout; readonly actions?:readonly ImageAction[];
  readonly id: string; readonly name: string; readonly width: number; readonly height: number;
  readonly colorManagement?:{readonly space:'srgb';readonly convertedFrom:string};
  readonly psdOrigin?: { readonly sourceName: string; readonly resources: Uint8Array; readonly flattened: boolean };
  readonly selection?: Selection | null;
  readonly selectedIds?: readonly string[];
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
export function pixelBytes(layers: readonly ImageLayer[]): number { return allLayers(layers).reduce((sum, layer) => sum + (layer.bitmap?pixelStorageBytes(layer.bitmap):0) + (layer.mask?.data.byteLength ?? 0) + (layer.filterMask?.data.byteLength ?? 0) + (layer.content?.type==='smart'?pixelStorageBytes(layer.content.source)+(layer.content.sourcePsd?.byteLength??0):0), 0); }
function retainedStateBytes(...states: ImageState[]) {
  if(states.length===2&&states.every(pagedState)) {
    const backing=(state:ImageState)=>{
      const buffers=new Set<ArrayBufferLike>();
      const collect=(value:unknown):void=>{if(ArrayBuffer.isView(value)){buffers.add(value.buffer);return;}if(value&&typeof value==='object')for(const child of Object.values(value))collect(child);};
      collect(state);return buffers;
    };
    const a=backing(states[0]!),b=backing(states[1]!);
    const metadata=states.reduce((n,s)=>n+JSON.stringify(s.actions??[]).length*2+JSON.stringify(s.layout??{}).length*2+JSON.stringify(s.layerComps??{}).length*2,4096);
    return [...new Set([...a,...b])].filter(v=>!a.has(v)||!b.has(v)).reduce((n,v)=>n+v.byteLength,0)+metadata;
  }

  const buffers = new Set<ArrayBufferLike>();
  for (const state of states) {
    if(state.psdArchive)buffers.add(state.psdArchive.buffer);
    for (const layer of allLayers(state.layers))  { if (layer.bitmap){if(isPaged(layer.bitmap)){for(const b of pageBuffers(layer.bitmap))buffers.add(b.buffer);}else buffers.add(layer.bitmap.data.buffer);if(layer.bitmap.cmyk)buffers.add(layer.bitmap.cmyk.buffer);} if(layer.mask)buffers.add(layer.mask.data.buffer); if(layer.filterMask)buffers.add(layer.filterMask.data.buffer); if(layer.content?.type==='smart'){if(isPaged(layer.content.source)){for(const b of pageBuffers(layer.content.source))buffers.add(b.buffer);}else buffers.add(layer.content.source.data.buffer);if(layer.content.sourcePsd)buffers.add(layer.content.sourcePsd.buffer);} }
    if(state.icc?.proofProfile)buffers.add(state.icc.proofProfile.buffer);if(state.icc?.monitorProfile)buffers.add(state.icc.monitorProfile.buffer);
    if (state.selection?.mask) buffers.add(state.selection.mask.buffer);
    for(const channel of state.channels??[])buffers.add(channel.data.buffer);
    if (state.psdOrigin) buffers.add(state.psdOrigin.resources.buffer);
  }
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0)+[...new Set(states.map(s=>s.actions))].reduce((n,a)=>n+(a?JSON.stringify(a).length*2:0),0)+[...new Set(states.map(s=>s.layout))].reduce((n,l)=>n+(l?JSON.stringify(l).length*2:0),0);
}
export function layerLocked(layers: readonly ImageLayer[], id: string, action:LockAction='all'): boolean { return isLayerLocked(layers,id,action); }

function replace(layers: readonly ImageLayer[], id: string, operation: (layer: ImageLayer) => ImageLayer): ImageLayer[] {
  return layers.map(layer => layer.id === id ? operation(layer) : layer.children.length ? { ...layer, children: replace(layer.children, id, operation) } : layer);
}
function siblings(layers: readonly ImageLayer[], id: string, operation: (items: readonly ImageLayer[], index: number) => readonly ImageLayer[]): readonly ImageLayer[] {
  const index = layers.findIndex(layer => layer.id === id);
  return index >= 0 ? operation(layers, index) : layers.map(layer => ({ ...layer, children: siblings(layer.children, id, operation) }));
}
function freezeState(state: ImageState): ImageState {
  const freeze = (layers: readonly ImageLayer[]): readonly ImageLayer[] => Object.freeze(layers.map(layer => Object.freeze({ ...layer, ...(layer.locks?{locks:Object.freeze({...layer.locks})}:{}), ...(layer.smartFilters?{smartFilters:Object.freeze(layer.smartFilters.map(f=>Object.freeze({...f,settings:Object.freeze({...f.settings})})))}:{}),...(layer.filterMask?{filterMask:Object.freeze({...layer.filterMask})}:{}),...(layer.blendIf?{blendIf:Object.freeze({...layer.blendIf,source:Object.freeze([...layer.blendIf.source]) as typeof layer.blendIf.source,underlying:Object.freeze([...layer.blendIf.underlying]) as typeof layer.blendIf.underlying})}:{}), ...(layer.styles?{styles:Object.freeze({...layer.styles,...(layer.styles.innerGlow?{innerGlow:Object.freeze({...layer.styles.innerGlow})}:{}),...(layer.styles.overlay?{overlay:Object.freeze({...layer.styles.overlay})}:{}),...(layer.styles.stroke?{stroke:Object.freeze({...layer.styles.stroke})}:{}),...(layer.styles.shadow?{shadow:Object.freeze({...layer.styles.shadow})}:{})})}:{}), ...(layer.content ? {content:freezeContent(layer.content)}:{}), ...(layer.mask?{mask:Object.freeze({...layer.mask})}:{}), children: freeze(layer.children) })));
  return Object.freeze(hydrateArchive({ ...state,...(state.layerComps?{layerComps:freezeLayerComps(state.layerComps)}:{}),paging:state.paging??{enabled:false}, ...(state.icc?{icc:Object.freeze({...state.icc})}:{}),...freezeProductivity(state), ...(state.colorManagement?{colorManagement:Object.freeze({...state.colorManagement})}:{}), selectedIds: Object.freeze((state.selectedId ? (state.selectedIds?.includes(state.selectedId) ? state.selectedIds : [state.selectedId]) : []).filter(id => Boolean(findLayer(state.layers, id)))), selection: state.selection ? Object.freeze({ ...state.selection }) : null, layers: freeze(state.layers) }));
}
export function validateState(state: ImageState) {
  hydratePixels(state);validateLayerComps(state.layerComps);
  if(state.psdArchiveStore?.disk)validateDiskBlob(state.psdArchiveStore.disk);
  else if(state.psdArchive&&(!(state.psdArchive instanceof Uint8Array)||state.psdArchive.length<26||state.psdArchive.length>IMAGE_LIMITS.bytes||new DataView(state.psdArchive.buffer,state.psdArchive.byteOffset).getUint32(0)!==0x38425053))throw Error('PSD 原生档案无效。');
  if(state.paging&&typeof state.paging.enabled!=='boolean')throw Error('换页策略无效。');
  checkSize(state.width, state.height);
  if(state.colorMode&&!['rgb','cmyk'].includes(state.colorMode))throw Error('文档颜色模式无效。');if(state.colorMode==='cmyk'&&state.bitDepth===32)throw Error('CMYK 仅支持 8／16 位。');
  if(![8,16,32].includes(state.bitDepth??8))throw new Error('文档位深无效。');if(state.display?.output&&!['auto','sdr','hdr'].includes(state.display.output))throw Error('显示输出模式无效。');
  if(state.display&&(!Number.isFinite(state.display.exposure)||Math.abs(state.display.exposure)>20||!['clip','reinhard','aces'].includes(state.display.operator)))throw new Error('HDR 预览参数无效。');
  if(state.colorManagement&&(state.colorManagement.space!=='srgb'||typeof state.colorManagement.convertedFrom!=='string'||state.colorManagement.convertedFrom.length>160))throw new Error('文档色彩管理信息无效。');
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
  let bytes = JSON.stringify(state.layerComps??{}).length*2+validateProductivity(state)+(state.psdArchiveStore?.disk?0:archiveBytes(state));if(state.icc){const c=state.icc;if(![0,1,2,3].includes(c.intent)||![0,1,2,3].includes(c.proofIntent)||typeof c.bpc!=='boolean'||typeof c.gamutWarning!=='boolean'||c.proofEnabled!==undefined&&typeof c.proofEnabled!=='boolean'||c.proofEnabled===true&&!c.proofProfile)throw new Error('ICC 设置无效。');for(const p of [c.proofProfile,c.monitorProfile])if(p){inspectIccBytes(p);bytes+=p.byteLength;}}
  const visit = (layers: readonly ImageLayer[], depth: number) => {
    if (depth > IMAGE_LIMITS.depth) throw new Error('图层组嵌套过深。');
    for (const layer of layers) {
      if(layer.passThrough!==undefined&&(typeof layer.passThrough!=='boolean'||layer.kind!=='group'))throw Error('穿透模式需要图层组。');
      if(layer.passThrough&&(layer.mask||layer.styles?.enabled||layer.blendIf?.enabled||layer.clipping))throw Error('穿透图层组的蒙版、样式或剪贴效果需要先关闭穿透模式。');
      if(layer.nativePsd&&(!archiveBytes(state)||!Number.isInteger(layer.nativePsd.id)||typeof layer.nativePsd.contentKey!=='string'||layer.nativePsd.contentKey.length>65536||typeof layer.nativePsd.stylesKey!=='string'||layer.nativePsd.stylesKey.length>65536))throw Error('PSD 原生图层引用无效。');
      if(state.colorMode==='cmyk'&&(layer.content||layer.styles?.enabled||layer.smartFilters?.length||layer.clipping||layer.blendIf?.enabled))throw Error('CMYK 参数化内容、剪贴和效果需先转换 RGB。');
      if (ids.has(layer.id) || !layer.id || layer.id.length > 80) throw new Error('图层 ID 无效或重复。');
      ids.add(layer.id);
      if (!layer.name.trim() || layer.name.length > 160) throw new Error('图层名称长度应为 1–160 个字符。');
      if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || !Object.hasOwn(BLEND_MODES, layer.blend)) throw new Error('图层合成参数无效。');
      if (![layer.x, layer.y].every(value => Number.isInteger(value) && Math.abs(value) <= 32768)) throw new Error('图层坐标必须是 -32768–32768 范围内的整数。');
      if(layer.locks!==undefined)validateLocks(layer.locks);
      if (typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') throw new Error('图层状态无效。');
      if (layer.kind !== 'group' && layer.children.length || layer.kind === 'group' && layer.bitmap) throw new Error('图层类型与内容不一致。');
      if (layer.kind !== 'pixel' && layer.kind !== 'group' && layer.kind !== 'adjustment') throw new Error('未知图层类型。');
      if(layer.clipping!==undefined&&typeof layer.clipping!=='boolean')throw new Error('剪贴关系无效。');
      if(layer.styles){validateStyles(layer.styles);if(layer.kind==='adjustment')throw new Error('调整图层不能设置像素样式。');}
      if(layer.content?.type==='smart')bytes+=pixelStorageBytes(layer.content.source)+(layer.content.sourcePsd?.byteLength??0);
      if (layer.content) {
        validateContent(layer.content);
        if(layer.content.type==='adjustment' ? layer.kind!=='adjustment'||Boolean(layer.bitmap) : layer.kind!=='pixel'||!layer.bitmap)throw new Error('图层内容与类型不一致。');
      }
      if(layer.kind==='adjustment'&&(!layer.content||layer.content.type!=='adjustment'))throw new Error('调整图层需要正常模式及有效参数。');
      if(layer.smartFilters!==undefined){validateSmartFilters(layer.smartFilters);if(layer.content?.type!=='smart')throw new Error('智能滤镜需要智能对象。');}
      if(layer.filterMask!==undefined&&layer.content?.type!=='smart')throw new Error('滤镜蒙版需要智能对象。');
      if(layer.blendIf!==undefined)validateBlendIf(layer.blendIf);
      for(const mask of [layer.mask,layer.filterMask])if(mask!==undefined){validateMask(mask);bytes+=mask.data.byteLength;}
      if (layer.bitmap) {
        checkSize(layer.bitmap.width, layer.bitmap.height);
        validateBitmap(layer.bitmap);if(layer.bitmap.pages?.kind==='disk'){if(!!layer.bitmap.pages.inks!==(state.colorMode==='cmyk'))throw Error('磁盘分色与文档颜色模式不符。');}else if(state.colorMode==='cmyk'){validateCmyk(layer.bitmap);bytes+=layer.bitmap.cmyk!.byteLength;}else if(layer.bitmap.cmyk)throw Error('RGB 图层不能携带原生 CMYK 通道。');if((layer.bitmap.depth??8)!==(state.bitDepth??8))throw new Error('图层与文档位深不一致。');
        bytes += pixelStorageBytes(layer.bitmap)-(layer.bitmap.pages?.kind==='disk'?0:layer.bitmap.cmyk?.byteLength??0);
      }
      visit(layer.children, depth + 1);
    }
  };
  visit(state.layers, 0);
  if (ids.size > IMAGE_LIMITS.layers || bytes > IMAGE_LIMITS.bytes) throw new Error('文档最多容纳 128 个图层和 128 MiB 像素。');
  if (state.selectedIds && (!Array.isArray(state.selectedIds) || state.selectedIds.length > IMAGE_LIMITS.layers || new Set(state.selectedIds).size !== state.selectedIds.length || state.selectedIds.some(id => typeof id !== 'string' || !ids.has(id)))) throw new Error('选中图层列表无效。');
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
    hydratePixels(state);
    state=synchronizeCmyk({...state,layers:normalizeLayers(state.layers,state.bitDepth??8)});validateState(state); this.current = freezeState(state); this.nextRevision = state.revision;
    if (saved) this.saved = state.revision;
  }
  static create(name: string, width: number, height: number, white = false) {
    checkSize(width, height);
    const bitmap = white ? { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) } : null;
    const layer = makeLayer(white ? '背景' : '图层 1', bitmap);
    return new ImageDocument({ id: uid(), name, width, height, layers: [layer], selectedId: layer.id, revision: 1 });
  }
  runAtomic<T>(operation: () => T): T {
    const before = this.current, saved = this.saved, nextRevision = this.nextRevision;
    try { return this.history.runAtomic(operation); }
    catch (error) {
      this.current = before; this.saved = saved; this.nextRevision = nextRevision;
      for (const listener of this.listeners) { try { listener(); } catch { /* Keep the original failure. */ } }
      throw error;
    }
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
  get selectedIds(): readonly string[] { return this.current.selectedIds?.includes(this.current.selectedId ?? '') ? this.current.selectedIds : this.current.selectedId ? [this.current.selectedId] : []; }
  selectMany(ids: readonly string[]) {
    if (ids.length > IMAGE_LIMITS.layers || new Set(ids).size !== ids.length || ids.some(id => !findLayer(this.current.layers, id))) throw new Error('选中图层无效。');
    this.current = Object.freeze({ ...this.current, selectedId: ids.at(-1) ?? null, selectedIds: Object.freeze([...ids]) }); this.emit();
  }
  /** Product-domain commit; input trees are prepared off-document and validated before history admission. */
  commitLayers(label: string, layers: readonly ImageLayer[], affectedIds: readonly string[], selectedIds = this.selectedIds, expectedRevision = this.revision, mode:'edit'|'pixels'|'transform'|'validated'='edit') {
    if (expectedRevision !== this.revision) throw new Error('文档已变化，请重新操作。');
    for (const id of affectedIds) if (!findLayer(this.current.layers, id) || layerLocked(this.current.layers, id)) throw new Error('图层不存在或已锁定。');
    const own = (items: readonly ImageLayer[]): ImageLayer[] => items.map(layer => {
      const old = findLayer(this.current.layers, layer.id);
      // Transform metadata may reuse an already-owned immutable smart source. New/replaced sources still copy.
      const content=layer.content?.type==='smart'&&old?.content?.type==='smart'&&layer.content.source===old.content.source&&layer.content.sourcePsd===old.content.sourcePsd?{...layer.content,transform:{...layer.content.transform}}:layer.content&&layer.content!==old?.content?cloneContent(layer.content):layer.content;
      return { ...layer, ...(content?{content}:{}), ...(layer.styles?{styles:structuredClone(layer.styles)}:{}), bitmap: layer.bitmap && layer.bitmap !== old?.bitmap ? { ...layer.bitmap, data: layer.bitmap.data.slice() } : layer.bitmap,
        ...(layer.smartFilters&&layer.smartFilters!==old?.smartFilters?{smartFilters:structuredClone(layer.smartFilters)}:{}),...(layer.blendIf&&layer.blendIf!==old?.blendIf?{blendIf:structuredClone(layer.blendIf)}:{}),...(layer.filterMask&&layer.filterMask!==old?.filterMask?{filterMask:{...layer.filterMask,data:layer.filterMask.data.slice()}}:{}),
        ...(layer.mask && layer.mask !== old?.mask ? { mask: { ...layer.mask, data: layer.mask.data.slice() } } : {}), children: own(layer.children) };
    });
    this.edit(label, state => ({ ...state, layers: own(layers), selectedIds: [...selectedIds], selectedId: selectedIds.at(-1) ?? null }),undefined,undefined,mode);
  }
  select(id: string | null) {
    if (id && !findLayer(this.current.layers, id)) throw new Error('图层不存在。');
    this.current = Object.freeze({ ...this.current, selectedId: id, selectedIds: Object.freeze(id ? [id] : []) }); this.emit();
  }
  private edit(label: string, change: (before: ImageState) => ImageState, pixelId?: string, bounds?: { x: number; y: number; width: number; height: number }, mode:'edit'|'pixels'|'transform'|'validated'='edit') {
    if (this.disposed) throw new Error('文档已关闭。');
    const before = this.current;
    const proposed=change(before);
    let changed = hydratePixels({...proposed,layers:mode==='validated'?proposed.layers:protectLayerChanges(before,proposed.layers,mode)});
    if(pagedState(before)&&(changed.bitDepth??8)===8&&changed.colorMode!=='cmyk')changed={...changed,layers:packLayers(changed.layers,before.layers,pixelId,bounds)};
    const candidate = synchronizeCmyk({...changed,layers:normalizeLayers(changed.layers,changed.bitDepth??8)},before);
    const after = freezeState({ ...candidate, revision: this.nextRevision + 1 });
    validateState(after);
    const delta = pixelId&&!pagedState(before)&&after.colorMode!=='cmyk'&&(after.bitDepth??8)===8 ? pixelHistory(label, before, after, pixelId, this.readHistoryState, this.writeHistoryState, bounds) : undefined;
    if (delta) {
      // Recording performs budget validation before publication; redo applies the reversible tiles.
      this.history.recordApplied(delta); this.current = after; this.emit();
    } else this.history.execute({ label, estimatedBytes: retainedStateBytes(before, after) + 1024,
      execute: () => { this.current = after; this.emit(); }, undo: () => { this.current = before; this.emit(); } });
    this.nextRevision++;
  }
  commitColor(layers:readonly ImageLayer[],resources:Uint8Array,convertedFrom:string,expectedRevision=this.revision){
    if(expectedRevision!==this.revision)throw new Error('文档已变化，颜色转换已取消。');
    if(allLayers(this.state.layers).some(l=>layerLocked(this.state.layers,l.id)))throw new Error('颜色转换前请解除图层锁定。');
    if(allLayers(layers).map(l=>l.id).join()!==allLayers(this.state.layers).map(l=>l.id).join())throw new Error('颜色转换不能改变图层结构。');
    const owned=structuredClone(layers),profile=resources.slice();
    this.edit('转换到 sRGB',state=>({...state,layers:owned,colorManagement:{space:'srgb',convertedFrom},psdOrigin:{sourceName:state.psdOrigin?.sourceName??state.name,flattened:state.psdOrigin?.flattened??false,resources:profile}}));
  }
  commitMode(state:ImageState){this.edit('转换文档颜色模式',()=>structuredClone(state));}
  setDepth(bitDepth:BitDepth,allowLoss=false){if(this.state.colorMode==='cmyk'&&bitDepth===32)throw Error('CMYK 仅支持 8／16 位。');if(![8,16,32].includes(bitDepth))throw new Error('位深无效。');if(bitDepth<(this.state.bitDepth??8)&&!allowLoss)throw new Error('降低位深需要 allowLoss 确认。');if(allLayers(this.state.layers).some(l=>layerLocked(this.state.layers,l.id)))throw new Error('请先解除图层锁定。');if(allLayers(this.state.layers).some(l=>l.content?.type==='smart'&&l.content.sourcePsd))throw new Error('请先栅格化多层智能对象，再转换位深。');this.edit('转换文档位深',s=>{const crossing=(s.bitDepth===32)!==(bitDepth===32),profile=embeddedProfile(s);if(!crossing||!profile)return {...s,bitDepth};const target=s.bitDepth===32?linearSrgbProfile():srgbProfileBytes(),layers=convertIccLayers(s.layers,workingProfile(s),target,s.icc??{}),resources=concatBytes([...resourceBlocks(s.psdOrigin!.resources).filter(b=>b.id!==1039).map(b=>b.bytes),profileResource(bitDepth===32?linearSrgbProfile():srgbProfileBytes())]);return {...s,bitDepth,layers,psdOrigin:{...s.psdOrigin!,resources}};});}
  setDisplay(display:DisplaySettings){this.edit('HDR 显示设置',s=>({...s,display:{...display}}));}
  commitIcc(resources:Uint8Array,icc:IccSettings,layers=this.state.layers){const owned=structuredClone(layers),settings=structuredClone(icc),data=resources.slice();this.edit('ICC 色彩管理',s=>({...s,layers:owned,icc:settings,psdOrigin:{sourceName:s.psdOrigin?.sourceName??s.name,flattened:s.psdOrigin?.flattened??false,resources:data}}));}
  applyComp(id:number){this.edit('应用图层复合',s=>applyLayerComp(s,id));}
  captureComp(name:string,id?:number,comment=''){this.edit(id===undefined?'新建图层复合':'更新图层复合',s=>({...s,layerComps:captureLayerComp(s,name,id,comment)}));}
  deleteComp(id:number){if(!this.state.layerComps?.list.some(c=>c.id===id))throw Error('图层复合不存在。');this.edit('删除图层复合',s=>({...s,layerComps:{list:s.layerComps!.list.filter(c=>c.id!==id),...(s.layerComps!.lastApplied!==undefined&&s.layerComps!.lastApplied!==id?{lastApplied:s.layerComps!.lastApplied}:{})}}));}
  setProductivity(patch:Partial<Pick<ImageState,'channels'|'layout'|'actions'>>,label='生产设置') {
    const owned=structuredClone(patch);validateProductivity({...this.state,...owned});this.edit(label,state=>({...state,...owned}));
  }
  setSelection(selection: Selection | null) {
    if (!selection && !this.current.selection) return;
    const owned = selection ? { ...selection, ...(selection.mask ? { mask: selection.mask.slice() } : {}) } : null;
    this.edit('修改选区', state => ({ ...state, selection: owned }));
  }
  replaceLayerPixels(id: string, value: ImageLayer, label: string, expectedRevision = this.revision, bounds?: { x: number; y: number; width: number; height: number }, mode:'edit'|'pixels'|'transform'='pixels') {
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
      let cmyk=owned.bitmap.cmyk;if(cmyk&&layer.bitmap.cmyk&&cmyk!==layer.bitmap.cmyk){const clipped=layer.bitmap.cmyk.slice();for(let y=region.y;y<region.y+region.height;y++){const start=(y*width+region.x)*4;clipped.set(cmyk.subarray(start,start+region.width*4),start);}cmyk=clipped;}owned.bitmap = { ...owned.bitmap, data,...(cmyk?{cmyk}:{}) };
    } else { region = undefined; if (bounds && owned.bitmap) owned.bitmap = { ...owned.bitmap, data: owned.bitmap.data.slice() }; }
    this.edit(label, state => ({ ...state, layers: replace(state.layers, id, () => owned) }), id, region,mode);
  }
  setClipping(id:string,clipping:boolean) {
    const layer=findLayer(this.state.layers,id);if(!layer||layerLocked(this.state.layers,id))throw new Error('图层不存在或已锁定。');
    if(typeof clipping!=='boolean')throw new Error('剪贴开关无效。');
    if(clipping){let base:ImageLayer|undefined;const visit=(items:readonly ImageLayer[])=>{const index=items.findIndex(l=>l.id===id);if(index>=0){let i=index-1;while(i>=0&&items[i]?.clipping)i--;base=items[i];}else for(const item of items)visit(item.children);};visit(this.state.layers);if(!base||base.kind==='adjustment')throw new Error('剪贴蒙版需要同组下方的像素图层或组作为基底。');}
    this.edit('剪贴蒙版',state=>({...state,layers:replace(state.layers,id,l=>({...l,clipping}))}));
  }
  setStyles(id:string,styles:LayerStyles|undefined) {
    const layer=findLayer(this.state.layers,id);if(!layer||layerLocked(this.state.layers,id))throw new Error('图层不存在或已锁定。');
    if(styles)validateStyles(styles);const owned=styles?structuredClone(styles):undefined;
    this.edit('图层样式',state=>({...state,layers:replace(state.layers,id,l=>{const {styles:old,...base}=l;return {...base,...(owned?{styles:owned}:{})};})}));
  }
  setMask(id:string,mask:LayerMask|undefined,target:'layer'|'filter'='layer') {
    if(layerLocked(this.state.layers,id))throw new Error('图层已锁定。');
    if(!findLayer(this.state.layers,id))throw new Error('图层不存在。');
    const previous=findLayer(this.state.layers,id)?.[target==='filter'?'filterMask':'mask'];
    const owned=mask?{...mask,data:mask.data.slice(),...(mask.vector?{vector:structuredClone(mask.vector)}:{})}:undefined;
    if(owned?.vector&&previous&&(mask!.data!==previous.data||mask!.x!==previous.x||mask!.y!==previous.y||mask!.defaultColor!==previous.defaultColor))delete owned.vector;
    const key=target==='filter'?'filterMask':'mask';
    this.edit('修改蒙版',state=>({...state,layers:replace(state.layers,id,layer=>{const rest={...layer};delete rest[key];return {...rest,...(owned?{[key]:owned}:{})};})}));
  }
  setLiveEffects(id:string,patch:{smartFilters?:readonly SmartFilter[]|null;blendIf?:BlendIf|null}) {
    const layer=findLayer(this.state.layers,id);if(!layer||layerLocked(this.state.layers,id))throw new Error('图层不存在或已锁定。');
    const owned=structuredClone(patch);
    this.edit('非破坏性效果',state=>({...state,layers:replace(state.layers,id,l=>{const result={...l};for(const key of ['smartFilters','blendIf'] as const)if(Object.hasOwn(owned,key)){delete result[key];if(owned[key]!==null)Object.assign(result,{[key]:owned[key]});}return result;})}));
  }
  setContent(id:string,content:LayerContent,bitmap:Bitmap|null) {
    if(layerLocked(this.state.layers,id))throw new Error('图层已锁定。');
    const layer=findLayer(this.state.layers,id);if(!layer||layer.kind==='group')throw new Error('请选择内容图层。');
    validateContent(content);const owned=bitmap?{...bitmap,data:bitmap.data.slice()}:null;
    this.edit('编辑图层内容',state=>({...state,layers:replace(state.layers,id,item=>{const result:ImageLayer={...item,kind:content.type==='adjustment'?'adjustment':'pixel',content:cloneContent(content),bitmap:owned};if(item.mask?.vector&&(item.content?.type==='shape'||item.content?.type==='path'))delete (result as {mask?:LayerMask}).mask;return result;})}));
  }
  rasterizeSelected() {
    const layer=this.selected;if(!layer?.content)return;if(layer.kind==='adjustment')throw new Error('调整图层请通过合并副本导出，或删除后撤销调整。');
    if(layerLocked(this.state.layers,layer.id))throw new Error('图层已锁定。');
    this.edit('栅格化图层',state=>({...state,layers:replace(state.layers,layer.id,item=>{const {content,smartFilters,filterMask,...rest}=item;return {...rest,bitmap:liveBitmap(item)};})}));
  }
  applySelectedMask() {
    const layer=this.selected;if(!layer?.mask||!layer.bitmap||layer.content)throw new Error('应用蒙版前请选择像素图层，并栅格化可编辑内容。');
    if(layerLocked(this.state.layers,layer.id,'pixels')||layerLocked(this.state.layers,layer.id,'transparency'))throw new Error('应用蒙版前请解除像素或透明像素锁定。');
    if(layer.mask.disabled)throw new Error('请先启用蒙版。');
    const data=layer.bitmap.data.slice();
    for(let y=0;y<layer.bitmap.height;y++)for(let x=0;x<layer.bitmap.width;x++)data[(y*layer.bitmap.width+x)*4+3]=Math.round(data[(y*layer.bitmap.width+x)*4+3]!*maskWeight(layer.mask,x,y));
    this.edit('应用图层蒙版',state=>({...state,layers:replace(state.layers,layer.id,item=>{const {mask,...rest}=item;return {...rest,bitmap:{...layer.bitmap!,data}};})}));
  }
  cropToSelection() {
    const rect = this.current.selection; if (!rect || !selectionCount(rect)) throw new Error('请先拖出非空裁剪区域。');
    if (allLayers(this.current.layers).some(layer => layerLocked(this.current.layers,layer.id,'position'))) throw new Error('裁剪会移动所有图层，请先解锁图层。');
    this.edit('裁剪画布', state => ({ ...state, ...(state.channels?{channels:state.channels.map(c=>({...c,data:Uint8Array.from({length:rect.width*rect.height},(_,i)=>c.data[(Math.floor(i/rect.width)+rect.y)*state.width+i%rect.width+rect.x]!)}))}:{}),...(state.layout?{layout:{...state.layout,guides:state.layout.guides.map(g=>({...g,position:g.position-(g.axis==='x'?rect.x:rect.y)}))}}:{}), width: rect.width, height: rect.height, selection: null,
      layers: state.layers.map(layer => ({ ...layer, x: layer.x - rect.x, y: layer.y - rect.y })) }));
  }
  rename(name: string) { if (name.trim() !== this.current.name) this.edit('重命名文档', state => ({ ...state, name: name.trim() })); }
  addLayer(layer: ImageLayer, intoSelection = true) {
    // Pixels become document-owned; caller mutations cannot change history or recovery snapshots.
    const clone = (item: ImageLayer): ImageLayer => ({ ...item, ...(item.smartFilters?{smartFilters:structuredClone(item.smartFilters)}:{}),...(item.blendIf?{blendIf:structuredClone(item.blendIf)}:{}),...(item.filterMask?{filterMask:{...item.filterMask,data:item.filterMask.data.slice()}}:{}),...(item.styles?{styles:structuredClone(item.styles)}:{}), ...(item.content?{content:cloneContent(item.content)}:{}), ...(item.mask?{mask:{...item.mask,data:item.mask.data.slice()}}:{}), bitmap: item.bitmap ? isPaged(item.bitmap)?hydrateBitmap({...item.bitmap} as Bitmap):{ ...item.bitmap, data: item.bitmap.data.slice() } : null, children: item.children.map(clone) });
    const owned = clone(layer);
    this.edit('添加图层', state => {
      const selected = intoSelection ? this.selected : undefined;
      if (selected && layerLocked(state.layers, selected.id)) throw new Error('请先解锁选中的图层或图层组。');
      const layers = selected?.kind === 'group' ? replace(state.layers, selected.id, group => ({ ...group, children: [...group.children, owned] }))
        : selected ? siblings(state.layers, selected.id, (items, i) => [...items.slice(0, i + 1), owned, ...items.slice(i + 1)]) : [...state.layers, owned];
      return { ...state, layers, selectedId: owned.id };
    });
  }
  updateLayer(id: string, patch: Partial<Pick<ImageLayer, 'name' | 'visible' | 'locked' | 'locks' | 'opacity' | 'blend' | 'x' | 'y' | 'passThrough'>>) {
    const existing = findLayer(this.current.layers, id);
    if (!existing) throw new Error('图层不存在。');
    if (Object.entries(patch).every(([key, value]) => existing[key as keyof ImageLayer] === value)) return;
    if (layerLocked(this.current.layers, id) && Object.keys(patch).some(key => key !== 'visible' && key !== 'locked' && key !== 'locks')) throw new Error('图层已锁定。');
    if(patch.locks!==undefined){validateLocks(patch.locks);patch={...patch,locks:{...existing.locks,...patch.locks}};}
    if(layerLocked(this.current.layers,id,'position')&&(patch.x!==undefined&&patch.x!==existing.x||patch.y!==undefined&&patch.y!==existing.y))throw Error('图层位置已锁定。');
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
    const duplicate = (layer: ImageLayer): ImageLayer => ({ ...layer, id: uid(), ...(layer.smartFilters?{smartFilters:structuredClone(layer.smartFilters)}:{}),...(layer.blendIf?{blendIf:structuredClone(layer.blendIf)}:{}),...(layer.filterMask?{filterMask:{...layer.filterMask,data:layer.filterMask.data.slice()}}:{}),...(layer.styles?{styles:structuredClone(layer.styles)}:{}), ...(layer.content?{content:cloneContent(layer.content)}:{}), ...(layer.mask?{mask:{...layer.mask,data:layer.mask.data.slice()}}:{}), bitmap: layer.bitmap ? isPaged(layer.bitmap)?hydrateBitmap({...layer.bitmap} as Bitmap):{ ...layer.bitmap, data: layer.bitmap.data.slice() } : null, children: layer.children.map(duplicate) });
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
  dispose() { if (this.disposed) return; this.disposed = true; this.history.dispose(); this.listeners.clear(); const { psdOrigin, channels, actions, layout, ...metadata } = this.current; this.current = Object.freeze({ ...metadata, layers: [], selectedId: null, selectedIds: [], selection: null }); }
  private emit() { for (const listener of this.listeners) listener(); }
}
