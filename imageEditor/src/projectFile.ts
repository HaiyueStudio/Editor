import { diskRefs } from './diskPager.js';
import { pagedState } from './pagedPixels.js';
import { encodePixelArchive, decodePixelArchive } from './pixelArchive.js';
import { maskBytes,decodeMaskBytes,depthOf, pixelBytesView, pixelsFromBytes, withPixels, type BitDepth } from './pixelFormat.js';
import { hasProductivity } from './productivityModel.js';
import { secondBatchLayer } from './liveEffects.js';
import { qualityContent } from './layerFeatures.js';
import { MAX_PSD_RESOURCES, resourceBlocks } from './psdResources.js';
import { allLayers, checkSize, IMAGE_LIMITS, validateState, uid, type Bitmap, type ImageLayer, type ImageState } from './document.js';

const MAX_TEXT = Math.ceil((IMAGE_LIMITS.bytes + MAX_PSD_RESOURCES + IMAGE_LIMITS.pixels) * 1.4) + 1024 * 1024;
function encode(data: Uint8ClampedArray | Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += 24576) chunks.push(btoa(String.fromCharCode(...data.subarray(i, i + 24576))));
  return chunks.join('');
}
export function serializeProject(state: ImageState, localReferences=false): string {
  if(!localReferences&&diskRefs(state).length)throw Error('磁盘文档请使用异步工程导出接口。');
  if(pagedState(state)||allLayers(state.layers).some(l=>l.content?.type==='smart'&&l.content.sourcePdf)){if(!localReferences&&diskRefs(state).length)throw Error('工程文件缺少便携磁盘页，请使用完整工程包。');validateState(state);const archive=encodePixelArchive(state);return JSON.stringify({format:'haiyue-image',version:allLayers(state.layers).some(l=>l.content?.type==='smart'&&l.content.sourcePdf)?16:state.layerComps||allLayers(state.layers).some(l=>l.content?.type==='path'&&l.content.contours||l.content?.type==='adjustment'&&l.content.filter==='hue-saturation')?15:allLayers(state.layers).some(l=>l.locks)?14:13,archive:{tree:archive.tree,buffers:archive.buffers.map(encode)}});}
  const layer = (item: ImageLayer): unknown => ({ ...item, ...(item.content?.type==='smart'?{content:{...item.content,...(item.content.sourcePsd?{sourcePsd:encode(item.content.sourcePsd)}:{}),source:{width:item.content.source.width,height:item.content.source.height,depth:depthOf(item.content.source),rgba:encode(pixelBytesView(item.content.source))}}}:{}), ...(item.mask?{mask:{...item.mask,data:encode(maskBytes(item.mask.data))}}:{}),...(item.filterMask?{filterMask:{...item.filterMask,data:encode(maskBytes(item.filterMask.data))}}:{}), bitmap: item.bitmap ? { width: item.bitmap.width, height: item.bitmap.height, depth:depthOf(item.bitmap),rgba: encode(pixelBytesView(item.bitmap)), ...(item.bitmap.cmyk?{cmyk:encode(maskBytes(item.bitmap.cmyk))}:{}) } : null, children: item.children.map(layer) });
  return JSON.stringify({ format: 'haiyue-image', version: state.layerComps||allLayers(state.layers).some(l=>l.content?.type==='path'&&l.content.contours||l.content?.type==='adjustment'&&l.content.filter==='hue-saturation')?15:allLayers(state.layers).some(l=>l.locks)?14:state.icc?.proofEnabled!==undefined?12:state.colorMode?11:state.bitDepth!==undefined||state.display||state.icc?10:allLayers(state.layers).some(l=>l.content?.type==='smart'&&l.content.sourcePsd)?9:hasProductivity(state)?8:allLayers(state.layers).some(secondBatchLayer)?7:allLayers(state.layers).some(l=>qualityContent(l.content))?6:state.colorManagement||allLayers(state.layers).some(l=>l.content?.type==='path'||l.content?.type==='text'&&(l.content.runs?.length||l.content.wrapWidth))?5:allLayers(state.layers).some(l=>l.clipping!==undefined||l.styles||l.content?.type==='smart'||l.content?.type==='adjustment'&&['levels','curves'].includes(l.content.filter))?4:allLayers(state.layers).some(l=>l.content||l.mask||!['normal','multiply','screen'].includes(l.blend)) ? 3 : state.selection?.mask ? 2 : 1, document: { ...state,paging:state.paging?.enabled?state.paging:undefined,...(state.icc?{icc:{...state.icc,...(state.icc.proofProfile?{proofProfile:encode(state.icc.proofProfile)}:{}),...(state.icc.monitorProfile?{monitorProfile:encode(state.icc.monitorProfile)}:{})}}:{}), ...(state.channels?{channels:state.channels.map(c=>({...c,data:encode(c.data)}))}:{}), selection: state.selection ? { ...state.selection, mask: state.selection.mask ? encode(state.selection.mask) : undefined } : null, layers: state.layers.map(layer), psdOrigin: state.psdOrigin ? { ...state.psdOrigin, resources: encode(state.psdOrigin.resources) } : undefined } });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工程数据结构无效。');
  return value as Record<string, unknown>;
}
function text(value: unknown) { if (typeof value !== 'string') throw new Error('工程文本字段无效。'); return value; }
function number(value: unknown) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('工程数值无效。'); return value; }
function bool(value: unknown) { if (typeof value !== 'boolean') throw new Error('工程开关字段无效。'); return value; }
export function deserializeProject(source: string, newIdentity = false, localReferences=false): ImageState {
  if (source.length > MAX_TEXT) throw new Error('工程文件过大。');
  const payload = object(JSON.parse(source));
  if (payload.format !== 'haiyue-image' || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(payload.version as number)) throw new Error('不支持的图像工程版本。');
  if(payload.version===13||(payload.version===14||payload.version===15||payload.version===16)&&payload.archive){const archive=object(payload.archive);if(!Array.isArray(archive.buffers))throw Error('分块工程缓冲目录无效。');let total=0;const buffers=archive.buffers.map(v=>{const encoded=text(v);total+=encoded.length;if(total>MAX_TEXT||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('分块工程编码超限或无效。');return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));});const state=decodePixelArchive<ImageState>(archive.tree,buffers);if(!localReferences&&diskRefs(state).length)throw Error('工程文件缺少便携磁盘页，请使用完整工程包。');validateState(state);return newIdentity?{...state,id:uid()}:state;}
  const doc = object(payload.document);
  const width = number(doc.width), height = number(doc.height); checkSize(width, height);
  const depth=(doc.bitDepth??8) as BitDepth;if(![8,16,32].includes(depth)||(doc.bitDepth!==undefined||doc.display||doc.icc)&&Number(payload.version)<10)throw new Error('高位深文档需要工程版本 10。');
  if(doc.colorMode!==undefined&&(Number(payload.version)<11||!['rgb','cmyk'].includes(String(doc.colorMode))))throw Error('颜色模式需要有效工程版本 11。');
  let bytes = 0, count = 0;
  let channels:ImageState['channels'];
  if(doc.channels!==undefined){if(!Array.isArray(doc.channels)||doc.channels.length>32)throw new Error('Alpha 通道数量无效。');channels=doc.channels.map(value=>{const c=object(value),encoded=text(c.data),length=width*height;bytes+=length;if(bytes>IMAGE_LIMITS.bytes||encoded.length!==Math.ceil(length/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('Alpha 通道编码或预算无效。');const raw=atob(encoded);if(raw.length!==length)throw new Error('Alpha 通道不完整。');return {id:text(c.id),name:text(c.name),data:Uint8Array.from(raw,c=>c.charCodeAt(0))};});}
  const decodeLayer = (value: unknown, nesting: number): ImageLayer => {
    if (++count > IMAGE_LIMITS.layers || nesting > IMAGE_LIMITS.depth) throw new Error('工程图层数量或嵌套超出限制。');
    const item = object(value);
    let bitmap: Bitmap | null = null;
    if (item.bitmap !== null) {
      const image = object(item.bitmap), w = number(image.width), h = number(image.height); checkSize(w, h);
      const imageDepth=(image.depth??8) as BitDepth;if(imageDepth!==depth)throw new Error('图层位深不一致。');const length = w * h * 4*(depth===8?1:4); bytes += length;
      if (bytes > IMAGE_LIMITS.bytes) throw new Error('工程像素总量超出限制。');
      const rgba = text(image.rgba);
      if (rgba.length !== Math.ceil(length / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(rgba)) throw new Error('工程像素编码无效。');
      const raw = atob(rgba);
      if (raw.length !== length) throw new Error('工程像素数据不完整。');
      const data = new Uint8Array(length);
      for (let i = 0; i < length; i++) data[i] = raw.charCodeAt(i);
      bitmap = withPixels(w,h,pixelsFromBytes(data,depth),depth);
      if(image.cmyk!==undefined){const n=w*h*16,e=text(image.cmyk);bytes+=n;if(Number(payload.version)<11||bytes>IMAGE_LIMITS.bytes||e.length!==Math.ceil(n/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e))throw Error('CMYK 编码或预算无效。');const raw=Uint8Array.from(atob(e),c=>c.charCodeAt(0));if(raw.length!==n)throw Error('CMYK 通道截断。');bitmap={...bitmap,cmyk:pixelsFromBytes(raw,16) as Float32Array};}
    }
    if (!Array.isArray(item.children)) throw new Error('工程图层树无效。');
    let extra: {-readonly [K in keyof ImageLayer]?: ImageLayer[K]} = {};
    if(item.clipping!==undefined||item.styles!==undefined){if(Number(payload.version)<4)throw new Error('非破坏性图层需要工程版本 4。');if(item.clipping!==undefined)extra.clipping=bool(item.clipping);if(item.styles!==undefined)extra.styles=object(item.styles) as unknown as NonNullable<ImageLayer['styles']>;}
    if(item.content!==undefined){if(Number(payload.version)<3)throw new Error('内容图层需要工程版本 3。');extra={...extra,content:object(item.content) as unknown as ImageLayer['content'] & {}};
      if(qualityContent(extra.content)&&Number(payload.version)<6)throw new Error('分通道调整／重采样需要工程版本 6。');
      if(extra.content?.type==='adjustment'&&['levels','curves'].includes(extra.content.filter)&&Number(payload.version)<4)throw new Error('曲线／色阶需要工程版本 4。');
      if((extra.content?.type==='path'||extra.content?.type==='text'&&(extra.content.runs?.length||extra.content.wrapWidth))&&Number(payload.version)<5)throw new Error('路径／富文本需要工程版本 5。');
      if(extra.content?.type==='smart'){
        if(Number(payload.version)<4)throw new Error('智能对象需要工程版本 4。');if(extra.content.sourcePsd!==undefined){if(Number(payload.version)<9)throw new Error('多层智能源需要工程版本 9。');const v=text(extra.content.sourcePsd);if(v.length>Math.ceil(32*1024*1024/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v))throw new Error('多层智能源编码无效。');const data=Uint8Array.from(atob(v),c=>c.charCodeAt(0));bytes+=data.length;if(bytes>IMAGE_LIMITS.bytes)throw new Error('工程像素总量超出限制。');extra.content={...extra.content,sourcePsd:data};}const raw=object(object(item.content).source),w=number(raw.width),h=number(raw.height);checkSize(w,h);const sourceDepth=(raw.depth??8) as BitDepth;if(sourceDepth!==depth)throw new Error('智能源位深不一致。');const length=w*h*4*(depth===8?1:4);bytes+=length;if(bytes>IMAGE_LIMITS.bytes)throw new Error('工程像素总量超出限制。');
        const encoded=text(raw.rgba);if(encoded.length!==Math.ceil(length/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('智能对象源编码无效。');const decoded=atob(encoded);if(decoded.length!==length)throw new Error('智能对象源不完整。');extra.content={...extra.content,source:withPixels(w,h,pixelsFromBytes(Uint8Array.from(decoded,c=>c.charCodeAt(0)),depth),depth)};
      }
    }
    for(const key of ['smartFilters','blendIf'] as const)if(item[key]!==undefined)Object.assign(extra,{[key]:item[key]});
    for(const key of ['mask','filterMask'] as const)if(item[key]!==undefined){
      if(Number(payload.version)<3)throw new Error('图层蒙版需要工程版本 3。');const mask=object(item[key]),w=number(mask.width),h=number(mask.height);checkSize(w,h);const float=mask.precision==='float32',length=w*h*(float?4:1);if(float&&Number(payload.version)<10)throw Error('浮点蒙版需要工程版本 10。');bytes+=length;if(bytes>IMAGE_LIMITS.bytes)throw new Error('工程像素总量超出限制。');
      const encoded=text(mask.data);if(encoded.length!==Math.ceil(length/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('蒙版编码无效。');const raw=atob(encoded);if(raw.length!==length)throw new Error('蒙版数据不完整。');
      extra={...extra,[key]:{...(mask.vector!==undefined?{vector:object(mask.vector)}:{}),...(mask.density!==undefined?{density:number(mask.density)}:{}),...(mask.feather!==undefined?{feather:number(mask.feather)}:{}),width:w,height:h,x:number(mask.x),y:number(mask.y),disabled:bool(mask.disabled),defaultColor:number(mask.defaultColor),...(float?{precision:'float32'}:{}),data:decodeMaskBytes(Uint8Array.from(raw,c=>c.charCodeAt(0)),float)}};
    }
    if(secondBatchLayer(extra as ImageLayer)&&Number(payload.version)<7)throw new Error('非破坏性效果需要工程版本 7。');
    return { ...extra,...(item.locks!==undefined?{locks:object(item.locks)}:{}), id: text(item.id), name: text(item.name), kind: text(item.kind) as ImageLayer['kind'], visible: bool(item.visible), locked: bool(item.locked),
      opacity: number(item.opacity), blend: text(item.blend) as ImageLayer['blend'], x: number(item.x), y: number(item.y), bitmap,
      children: item.children.map(child => decodeLayer(child, nesting + 1)) };
  };
  if (!Array.isArray(doc.layers)) throw new Error('工程缺少图层。');
  const id = newIdentity ? uid() : text(doc.id);
  if (!id || id.length > 80) throw new Error('文档 ID 无效。');
  const state: ImageState = { ...(doc.layerComps?{layerComps:doc.layerComps as NonNullable<ImageState['layerComps']>}:{}), ...(doc.colorMode?{colorMode:doc.colorMode as 'rgb'|'cmyk'}:{}), ...(doc.bitDepth!==undefined?{bitDepth:depth}:{}),...(doc.display?{display:doc.display as NonNullable<ImageState['display']>}:{}), ...(channels?{channels}:{}),...(doc.layout!==undefined?{layout:doc.layout as NonNullable<ImageState['layout']>}:{}),...(doc.actions!==undefined?{actions:doc.actions as NonNullable<ImageState['actions']>}:{}), id, name: text(doc.name), width, height, layers: doc.layers.map(item => decodeLayer(item, 0)),
    selectedId: doc.selectedId === null ? null : text(doc.selectedId), revision: 1 };
  if(hasProductivity(state)&&Number(payload.version)<8)throw new Error('生产能力需要工程版本 8。');
  if (doc.selectedIds !== undefined) {
    if (!Array.isArray(doc.selectedIds) || doc.selectedIds.length > IMAGE_LIMITS.layers) throw new Error('选中图层列表无效。');
    Object.assign(state, { selectedIds: doc.selectedIds.map(text) });
  }
  if (doc.selection !== undefined && doc.selection !== null) {
    const rect = object(doc.selection);
    const w = number(rect.width), h = number(rect.height); checkSize(w,h);
    let mask: Uint8Array | undefined;
    if (rect.mask !== undefined) {
      const encoded = text(rect.mask), length = w*h;
      if (Number(payload.version)<2 || encoded.length !== Math.ceil(length/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('选区蒙版编码无效。');
      const raw=atob(encoded); if(raw.length!==length)throw new Error('选区蒙版不完整。');
      mask=Uint8Array.from(raw,c=>c.charCodeAt(0));
    }
    Object.assign(state, { selection: { x: number(rect.x), y: number(rect.y), width: w, height: h, ...(mask ? {mask} : {}) } });
  }
  if (doc.psdOrigin !== undefined) {
    const origin = object(doc.psdOrigin), encoded = text(origin.resources);
    if (encoded.length > Math.ceil(MAX_PSD_RESOURCES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('PSD 资源编码无效。');
    const raw = atob(encoded), resources = Uint8Array.from(raw, c => c.charCodeAt(0)); resourceBlocks(resources);
    Object.assign(state, { psdOrigin: { sourceName: text(origin.sourceName), flattened: bool(origin.flattened), resources } });
  }
  if(doc.colorManagement!==undefined){if(Number(payload.version)<5)throw new Error('色彩管理需要工程版本 5。');Object.assign(state,{colorManagement:object(doc.colorManagement)});}
  if(doc.icc){const c=object(doc.icc),icc={...c};if(c.proofEnabled!==undefined&&Number(payload.version)<12)throw Error('打样开关需要工程版本 12。');for(const key of ['proofProfile','monitorProfile'])if(c[key]!==undefined){const e=text(c[key]);if(e.length>Math.ceil(4*1024*1024/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e))throw new Error('ICC 编码无效。');icc[key]=Uint8Array.from(atob(e),c=>c.charCodeAt(0));}Object.assign(state,{icc});}
  if(!localReferences&&diskRefs(state).length)throw Error('工程文件缺少便携磁盘页，请使用完整工程包。');validateState(state); return state;
}
export const MAX_PROJECT_BYTES = MAX_TEXT;
