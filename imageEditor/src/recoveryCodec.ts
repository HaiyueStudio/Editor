import { pagedState } from './pagedPixels.js';
import { encodePixelArchive, decodePixelArchive } from './pixelArchive.js';
import { maskBytes,decodeMaskBytes,depthOf, pixelBytesView, pixelsFromBytes, withPixels, type BitDepth } from './pixelFormat.js';
import { hasProductivity } from './productivityModel.js';
import { secondBatchLayer } from './liveEffects.js';
import { qualityContent } from './layerFeatures.js';
import type { LayerContent, SmartContent } from './layerFeatures.js';
import { allLayers, IMAGE_LIMITS, checkSize, validateState, type ImageState, type ImageLayer } from './document.js';
import { MAX_PSD_RESOURCES } from './psdResources.js';

export const RECOVERY_CHUNK_BYTES = 256 * 1024;
export interface BinarySession { version: 2; activeId: string | null; documents: { state: ImageState; dirty: boolean }[] }
interface Ref { bytes: number; chunks: string[] }
type StoredContent = Exclude<LayerContent, SmartContent> | (Omit<SmartContent,'source'|'sourcePsd'> & {sourcePsd?:Ref|undefined;source:{width:number;height:number;depth?:BitDepth;data:Ref}});
type StoredLayer = Omit<ImageLayer, 'bitmap' | 'children' | 'mask' | 'filterMask' | 'content'> & { content?:StoredContent; bitmap: { width: number; height: number; depth?:BitDepth; cmyk?:Ref; data: Ref } | null; children: StoredLayer[]; mask?: Omit<NonNullable<ImageLayer['mask']>,'data'> & {data:Ref}; filterMask?:Omit<NonNullable<ImageLayer['filterMask']>,'data'> & {data:Ref} };
type StoredIcc=Omit<NonNullable<ImageState['icc']>,'proofProfile'|'monitorProfile'> & {proofProfile?:Ref;monitorProfile?:Ref};
type StoredState = Omit<ImageState, 'layers' | 'selection' | 'psdOrigin' | 'channels' | 'icc'> & { icc?:StoredIcc; channels?:{id:string;name:string;data:Ref}[]; layers: StoredLayer[]; selection?: { x: number; y: number; width: number; height: number; mask?: Ref } | null; psdOrigin?: { sourceName: string; flattened: boolean; resources: Ref } };
export interface PagedStoredSession { version:14; archive:{tree:unknown;buffers:Ref[]} }
export interface StoredSession { version: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13; activeId: string | null; documents: { state: StoredState; dirty: boolean }[] }
export const chunkKey = (hash: string) => 'chunk:' + hash;
const hash = async (data: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)), n => n.toString(16).padStart(2, '0')).join('');

/** Immutable document buffers are fingerprinted once; chunks are independently deduplicated. */
export class RecoveryCodec {
  private refs = new WeakMap<object, Ref>();
  private archiveViews = new WeakMap<ArrayBufferLike, Map<string, Uint8Array>>();
  private stableView(view:Uint8Array){let ranges=this.archiveViews.get(view.buffer);if(!ranges){ranges=new Map();this.archiveViews.set(view.buffer,ranges);}const key=`${view.byteOffset}:${view.byteLength}`;let stable=ranges.get(key);if(!stable){stable=view;ranges.set(key,stable);}return stable;}
  async encode(session: BinarySession, existing: ReadonlySet<string>) {
    const chunks = new Map<string, Uint8Array>(), used = new Set<string>();
    const encode = async (data: Uint8Array | Uint8ClampedArray): Promise<Ref> => {
      let ref = this.refs.get(data);
      if (!ref) {
        ref = { bytes: data.byteLength, chunks: [] };
        for (let start = 0; start < data.length; start += RECOVERY_CHUNK_BYTES) {
          const part = new Uint8Array(data.slice(start, start + RECOVERY_CHUNK_BYTES));
          const key = chunkKey(await hash(part)); ref.chunks.push(key);
          if (!existing.has(key)) chunks.set(key, part);
        }
        this.refs.set(data, ref);
      }
      // A previous transaction may have failed or garbage-collected these chunks.
      for (let i = 0; i < ref.chunks.length; i++) {
        const key = ref.chunks[i]!; used.add(key);
        if (!existing.has(key) && !chunks.has(key)) chunks.set(key, new Uint8Array(data.slice(i * RECOVERY_CHUNK_BYTES, (i + 1) * RECOVERY_CHUNK_BYTES)));
      }
      return ref;
    };
    if(session.documents.some(d=>pagedState(d.state))){const archive=encodePixelArchive(session),refs:Ref[]=[];for(const buffer of archive.buffers)refs.push(await encode(this.stableView(buffer)));return {session:{version:14,archive:{tree:archive.tree,buffers:refs}} as PagedStoredSession,chunks,used};}
    const layer = async (item: ImageLayer): Promise<StoredLayer> => { const {mask,filterMask,content,...base}=item; return ({ ...base, ...(content?{content:content.type==='smart'?{...content,sourcePsd:content.sourcePsd?await encode(content.sourcePsd):undefined,source:{...content.source,data:await encode(pixelBytesView(content.source))}}:content}:{}), ...(item.mask?{mask:{...item.mask,data:await encode(maskBytes(item.mask.data))}}:{}),...(filterMask?{filterMask:{...filterMask,data:await encode(maskBytes(filterMask.data))}}:{}),
      bitmap: item.bitmap ? { width: item.bitmap.width, height: item.bitmap.height, ...(item.bitmap.depth?{depth:item.bitmap.depth}:{}), data: await encode(pixelBytesView(item.bitmap)),...(item.bitmap.cmyk?{cmyk:await encode(maskBytes(item.bitmap.cmyk))}:{}) } : null,
      children: await Promise.all(item.children.map(layer)) }); };
    const documents: StoredSession['documents'] = [];
    for (const item of session.documents) {
      const state = item.state; validateState(state);
      const { selection, psdOrigin, channels, icc, ...base } = state;
      const rect = selection ? { x: selection.x, y: selection.y, width: selection.width, height: selection.height } : null;
      documents.push({ dirty: item.dirty, state: { ...base,...(icc?{icc:{intent:icc.intent,bpc:icc.bpc,proofIntent:icc.proofIntent,gamutWarning:icc.gamutWarning,...(icc.proofEnabled!==undefined?{proofEnabled:icc.proofEnabled}:{}),...(icc.proofProfile?{proofProfile:await encode(icc.proofProfile)}:{}),...(icc.monitorProfile?{monitorProfile:await encode(icc.monitorProfile)}:{})}}:{}), ...(channels?{channels:await Promise.all(channels.map(async c=>({...c,data:await encode(c.data)})))}:{}), layers: await Promise.all(state.layers.map(layer)),
        selection: rect ? { ...rect, ...(selection?.mask ? { mask: await encode(selection.mask) } : {}) } : null,
        ...(psdOrigin ? { psdOrigin: { ...psdOrigin, resources: await encode(psdOrigin.resources) } } : {}) } });
    }
    return { session: { version: session.documents.some(d=>d.state.icc?.proofEnabled!==undefined)?13:session.documents.some(d=>d.state.colorMode)?12:session.documents.some(d=>d.state.bitDepth!==undefined||d.state.display||d.state.icc)?11:session.documents.some(d=>allLayers(d.state.layers).some(l=>l.content?.type==='smart'&&l.content.sourcePsd))?10:session.documents.some(d=>hasProductivity(d.state))?9:session.documents.some(d=>allLayers(d.state.layers).some(secondBatchLayer))?8:session.documents.some(d=>allLayers(d.state.layers).some(l=>qualityContent(l.content)))?7:session.documents.some(d=>d.state.colorManagement||allLayers(d.state.layers).some(l=>l.content?.type==='path'||l.content?.type==='text'&&(l.content.runs?.length||l.content.wrapWidth)))?6:session.documents.some(d=>allLayers(d.state.layers).some(l=>l.clipping!==undefined||l.styles||l.content?.type==='smart'||l.content?.type==='adjustment'&&['levels','curves'].includes(l.content.filter)))?5:session.documents.some(d=>allLayers(d.state.layers).some(l=>l.content||l.mask||!['normal','multiply','screen'].includes(l.blend)))?4:3, activeId: session.activeId, documents } as StoredSession, chunks, used };
  }
}
export async function decodeRecovery(value: StoredSession | PagedStoredSession, chunks: ReadonlyMap<string, unknown>): Promise<BinarySession> {
  if(value?.version===14){const buffers:Uint8Array[]=[];let total=0;if(!value.archive||!Array.isArray(value.archive.buffers))throw Error('分块恢复目录无效。');for(const ref of value.archive.buffers){if(!Number.isSafeInteger(ref.bytes)||ref.bytes<0||(total+=ref.bytes)>IMAGE_LIMITS.bytes||!Array.isArray(ref.chunks)||ref.chunks.length!==Math.ceil(ref.bytes/RECOVERY_CHUNK_BYTES))throw Error('分块恢复预算无效。');const buffer=new Uint8Array(ref.bytes);for(let i=0;i<ref.chunks.length;i++){const key=ref.chunks[i]!,part=chunks.get(key);if(!(part instanceof Uint8Array)||part.length!==Math.min(RECOVERY_CHUNK_BYTES,ref.bytes-i*RECOVERY_CHUNK_BYTES)||chunkKey(await hash(part))!==key)throw Error('分块恢复缺失或校验失败。');buffer.set(part,i*RECOVERY_CHUNK_BYTES);}buffers.push(buffer);}const session=decodePixelArchive<BinarySession>(value.archive.tree,buffers);if(session.version!==2||!Array.isArray(session.documents)||session.documents.length>IMAGE_LIMITS.documents)throw Error('分块恢复会话无效。');for(const d of session.documents){if(typeof d.dirty!=='boolean')throw Error('恢复文档状态无效。');validateState(d.state);}return session;}
  if(!value||![3,4,5,6,7,8,9,10,11,12,13].includes(value.version))throw new Error('恢复格式版本无效。');
  if (!Array.isArray(value.documents) || value.documents.length > IMAGE_LIMITS.documents) throw new Error('恢复文档数量无效。');
  const verified = new Set<string>();
  const decode = async (ref: Ref, expected: number): Promise<Uint8Array> => {
    if (!ref || ref.bytes !== expected || !Array.isArray(ref.chunks) || ref.chunks.length !== Math.ceil(expected / RECOVERY_CHUNK_BYTES)) throw new Error('恢复像素索引无效。');
    const data = new Uint8Array(expected);
    for (let i = 0; i < ref.chunks.length; i++) {
      const key = ref.chunks[i]!, part = chunks.get(key), length = Math.min(RECOVERY_CHUNK_BYTES, expected - i * RECOVERY_CHUNK_BYTES);
      if (typeof key !== 'string' || !/^chunk:[a-f0-9]{64}$/.test(key) || !(part instanceof Uint8Array) || part.length !== length) throw new Error('恢复像素分块缺失或损坏。');
      if (!verified.has(key)) { if (chunkKey(await hash(part)) !== key) throw new Error('恢复像素校验失败。'); verified.add(key); }
      data.set(part, i * RECOVERY_CHUNK_BYTES);
    }
    return data;
  };
  const documents: BinarySession['documents'] = [];
  for (const item of value.documents) {
    if (!item?.state || typeof item.dirty !== 'boolean') throw new Error('恢复文档无效。');
    const state = item.state; checkSize(state.width, state.height);
    if(state.icc?.proofEnabled!==undefined&&value.version<13)throw Error('打样开关恢复需要 v13。');if(state.colorMode!==undefined&&value.version<12)throw Error('CMYK 恢复需要 v12。');const depth=state.bitDepth??8;if(![8,16,32].includes(depth)||(state.bitDepth!==undefined||state.display||state.icc)&&value.version<11)throw new Error('高位深恢复需要 v11。');const bpp=depth===8?4:16;let bytes = 0, count = 0;
    let channels:ImageState['channels'];if(state.channels!==undefined){if(!Array.isArray(state.channels)||state.channels.length>32)throw new Error('恢复通道数量无效。');const decoded=[];for(const c of state.channels){bytes+=state.width*state.height;if(bytes>IMAGE_LIMITS.bytes)throw new Error('恢复通道超出预算。');decoded.push({...c,data:await decode(c.data,state.width*state.height)});}channels=decoded;}
    const layer = async (item: StoredLayer, nesting: number): Promise<ImageLayer> => {
      if (!item || ++count > IMAGE_LIMITS.layers || nesting > IMAGE_LIMITS.depth || !Array.isArray(item.children)) throw new Error('恢复图层树无效。');
      let bitmap = null;
      if (item.bitmap) {
        const { width, height } = item.bitmap; checkSize(width, height); if((item.bitmap.depth??8)!==depth)throw new Error('恢复位深不一致。');bytes += width * height * bpp;
        if (bytes > IMAGE_LIMITS.bytes) throw new Error('恢复像素超出预算。');
        bitmap = withPixels(width,height,pixelsFromBytes(await decode(item.bitmap.data,width*height*bpp),depth),depth);
        if(item.bitmap.cmyk){bytes+=width*height*16;if(value.version<12||bytes>IMAGE_LIMITS.bytes)throw Error('CMYK 恢复预算或版本无效。');bitmap={...bitmap,cmyk:pixelsFromBytes(await decode(item.bitmap.cmyk,width*height*16),16) as Float32Array};}
      }
      const children: ImageLayer[] = []; for (const child of item.children) children.push(await layer(child, nesting + 1));
      const {mask,filterMask,content,...base}=item;let decodedContent:LayerContent|undefined;
      if(content?.type==='smart'){const source=content.source;checkSize(source.width,source.height);if((source.depth??8)!==depth)throw new Error('智能源位深不一致。');bytes+=source.width*source.height*bpp;if(bytes>IMAGE_LIMITS.bytes)throw new Error('智能对象恢复超出预算。');let sourcePsd:Uint8Array|undefined;if(content.sourcePsd){if(value.version<10||!Number.isInteger(content.sourcePsd.bytes)||content.sourcePsd.bytes<26||content.sourcePsd.bytes>32*1024*1024)throw new Error('多层智能源需要恢复格式 v10，且不超过 32 MiB。');bytes+=content.sourcePsd.bytes;if(bytes>IMAGE_LIMITS.bytes)throw new Error('智能源恢复超出预算。');sourcePsd=await decode(content.sourcePsd,content.sourcePsd.bytes);}decodedContent={...content,sourcePsd,source:withPixels(source.width,source.height,pixelsFromBytes(await decode(source.data,source.width*source.height*bpp),depth),depth)};if(!sourcePsd)delete decodedContent.sourcePsd;}else decodedContent=content;
      let decodedMask:ImageLayer['mask'];
      if(mask){checkSize(mask.width,mask.height);const length=mask.width*mask.height*(mask.precision==='float32'?4:1);if(mask.precision&&value.version<11)throw Error('浮点蒙版需要 v11。');bytes+=length;if(bytes>IMAGE_LIMITS.bytes)throw new Error('恢复像素超出预算。');decodedMask={...mask,data:decodeMaskBytes(await decode(mask.data,length),mask.precision==='float32')};}
      let decodedFilter:ImageLayer['filterMask'];if(filterMask){checkSize(filterMask.width,filterMask.height);const length=filterMask.width*filterMask.height*(filterMask.precision==='float32'?4:1);if(filterMask.precision&&value.version<11)throw Error('浮点蒙版需要 v11。');bytes+=length;if(bytes>IMAGE_LIMITS.bytes)throw new Error('恢复像素超出预算。');decodedFilter={...filterMask,data:decodeMaskBytes(await decode(filterMask.data,length),filterMask.precision==='float32')};}
      return { ...base, ...(decodedFilter?{filterMask:decodedFilter}:{}), ...(decodedContent?{content:decodedContent}:{}), ...(decodedMask?{mask:decodedMask}:{}), bitmap, children };
    };
    if (!Array.isArray(state.layers)) throw new Error('恢复图层树无效。');
    const layers: ImageLayer[] = []; for (const item of state.layers) layers.push(await layer(item, 0));
    const rect = state.selection; if (rect) checkSize(rect.width, rect.height);
    if (state.psdOrigin && (!Number.isSafeInteger(state.psdOrigin.resources?.bytes) || state.psdOrigin.resources.bytes < 0 || state.psdOrigin.resources.bytes > MAX_PSD_RESOURCES)) throw new Error('恢复 PSD 资源无效。');
    const { selection, psdOrigin, channels:storedChannels, icc, ...base } = state;let settings:ImageState['icc'];if(icc){settings={intent:icc.intent,bpc:icc.bpc,proofIntent:icc.proofIntent,gamutWarning:icc.gamutWarning,...(icc.proofEnabled!==undefined?{proofEnabled:icc.proofEnabled}:{})};for(const key of ['proofProfile','monitorProfile'] as const)if(icc[key]){const ref=icc[key]!;if(!Number.isInteger(ref.bytes)||ref.bytes<132||ref.bytes>4*1024*1024)throw new Error('ICC 恢复长度无效。');settings[key]=await decode(ref,ref.bytes);}}
    const rectangle = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    const result: ImageState = { ...base,...(settings?{icc:settings}:{}), ...(channels?{channels}:{}), layers,
      selection: rectangle ? { ...rectangle, ...(rect?.mask ? { mask: await decode(rect.mask, rect.width * rect.height) } : {}) } : null,
      ...(psdOrigin ? { psdOrigin: { ...psdOrigin, resources: await decode(psdOrigin.resources, psdOrigin.resources.bytes) } } : {}) };
    if(value.version<9&&hasProductivity(result))throw new Error('生产能力需要恢复格式 v9。');
    if(value.version<8&&allLayers(layers).some(secondBatchLayer))throw new Error('非破坏性效果需要恢复格式 v8。');
    if(value.version<7&&allLayers(layers).some(l=>qualityContent(l.content)))throw new Error('分通道调整／重采样需要恢复格式 v7。');
    if(value.version<6&&(result.colorManagement||allLayers(layers).some(l=>l.content?.type==='path'||l.content?.type==='text'&&(l.content.runs?.length||l.content.wrapWidth))))throw new Error('专业内容需要恢复格式 v6。');
    validateState(result); documents.push({ state: result, dirty: item.dirty });
  }
  return { version: 2, activeId: value.activeId, documents };
}
