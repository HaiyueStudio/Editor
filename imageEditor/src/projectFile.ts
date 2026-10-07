import { MAX_PSD_RESOURCES, resourceBlocks } from './psdResources.js';
import { allLayers, checkSize, IMAGE_LIMITS, validateState, uid, type Bitmap, type ImageLayer, type ImageState } from './document.js';

const MAX_TEXT = Math.ceil((IMAGE_LIMITS.bytes + MAX_PSD_RESOURCES + IMAGE_LIMITS.pixels) * 1.4) + 1024 * 1024;
function encode(data: Uint8ClampedArray | Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += 24576) chunks.push(btoa(String.fromCharCode(...data.subarray(i, i + 24576))));
  return chunks.join('');
}
export function serializeProject(state: ImageState): string {
  const layer = (item: ImageLayer): unknown => ({ ...item, ...(item.mask?{mask:{...item.mask,data:encode(item.mask.data)}}:{}), bitmap: item.bitmap ? { width: item.bitmap.width, height: item.bitmap.height, rgba: encode(item.bitmap.data) } : null, children: item.children.map(layer) });
  return JSON.stringify({ format: 'haiyue-image', version: allLayers(state.layers).some(l=>l.content||l.mask||!['normal','multiply','screen'].includes(l.blend)) ? 3 : state.selection?.mask ? 2 : 1, document: { ...state, selection: state.selection ? { ...state.selection, mask: state.selection.mask ? encode(state.selection.mask) : undefined } : null, layers: state.layers.map(layer), psdOrigin: state.psdOrigin ? { ...state.psdOrigin, resources: encode(state.psdOrigin.resources) } : undefined } });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工程数据结构无效。');
  return value as Record<string, unknown>;
}
function text(value: unknown) { if (typeof value !== 'string') throw new Error('工程文本字段无效。'); return value; }
function number(value: unknown) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('工程数值无效。'); return value; }
function bool(value: unknown) { if (typeof value !== 'boolean') throw new Error('工程开关字段无效。'); return value; }
export function deserializeProject(source: string, newIdentity = false): ImageState {
  if (source.length > MAX_TEXT) throw new Error('工程文件过大。');
  const payload = object(JSON.parse(source));
  if (payload.format !== 'haiyue-image' || ![1, 2, 3].includes(payload.version as number)) throw new Error('不支持的图像工程版本。');
  const doc = object(payload.document);
  const width = number(doc.width), height = number(doc.height); checkSize(width, height);
  let bytes = 0, count = 0;
  const decodeLayer = (value: unknown, depth: number): ImageLayer => {
    if (++count > IMAGE_LIMITS.layers || depth > IMAGE_LIMITS.depth) throw new Error('工程图层数量或嵌套超出限制。');
    const item = object(value);
    let bitmap: Bitmap | null = null;
    if (item.bitmap !== null) {
      const image = object(item.bitmap), w = number(image.width), h = number(image.height); checkSize(w, h);
      const length = w * h * 4; bytes += length;
      if (bytes > IMAGE_LIMITS.bytes) throw new Error('工程像素总量超出限制。');
      const rgba = text(image.rgba);
      if (rgba.length !== Math.ceil(length / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(rgba)) throw new Error('工程像素编码无效。');
      const raw = atob(rgba);
      if (raw.length !== length) throw new Error('工程像素数据不完整。');
      const data = new Uint8ClampedArray(length);
      for (let i = 0; i < length; i++) data[i] = raw.charCodeAt(i);
      bitmap = { width: w, height: h, data };
    }
    if (!Array.isArray(item.children)) throw new Error('工程图层树无效。');
    let extra: Partial<ImageLayer> = {};
    if(item.content!==undefined){if(payload.version!==3)throw new Error('内容图层需要工程版本 3。');extra={...extra,content:object(item.content) as unknown as ImageLayer['content'] & {}};}
    if(item.mask!==undefined){
      if(payload.version!==3)throw new Error('图层蒙版需要工程版本 3。');const mask=object(item.mask),w=number(mask.width),h=number(mask.height);checkSize(w,h);bytes+=w*h;if(bytes>IMAGE_LIMITS.bytes)throw new Error('工程像素总量超出限制。');
      const encoded=text(mask.data);if(encoded.length!==Math.ceil(w*h/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('蒙版编码无效。');const raw=atob(encoded);if(raw.length!==w*h)throw new Error('蒙版数据不完整。');
      extra={...extra,mask:{width:w,height:h,x:number(mask.x),y:number(mask.y),disabled:bool(mask.disabled),defaultColor:number(mask.defaultColor),data:Uint8Array.from(raw,c=>c.charCodeAt(0))}};
    }
    return { ...extra, id: text(item.id), name: text(item.name), kind: text(item.kind) as ImageLayer['kind'], visible: bool(item.visible), locked: bool(item.locked),
      opacity: number(item.opacity), blend: text(item.blend) as ImageLayer['blend'], x: number(item.x), y: number(item.y), bitmap,
      children: item.children.map(child => decodeLayer(child, depth + 1)) };
  };
  if (!Array.isArray(doc.layers)) throw new Error('工程缺少图层。');
  const id = newIdentity ? uid() : text(doc.id);
  if (!id || id.length > 80) throw new Error('文档 ID 无效。');
  const state: ImageState = { id, name: text(doc.name), width, height, layers: doc.layers.map(item => decodeLayer(item, 0)),
    selectedId: doc.selectedId === null ? null : text(doc.selectedId), revision: 1 };
  if (doc.selection !== undefined && doc.selection !== null) {
    const rect = object(doc.selection);
    const w = number(rect.width), h = number(rect.height); checkSize(w,h);
    let mask: Uint8Array | undefined;
    if (rect.mask !== undefined) {
      const encoded = text(rect.mask), length = w*h;
      if (![2,3].includes(payload.version as number) || encoded.length !== Math.ceil(length/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('选区蒙版编码无效。');
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
  validateState(state); return state;
}
export const MAX_PROJECT_BYTES = MAX_TEXT;
