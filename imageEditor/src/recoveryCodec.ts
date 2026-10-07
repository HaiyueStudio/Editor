import { allLayers, IMAGE_LIMITS, checkSize, validateState, type ImageState, type ImageLayer } from './document.js';
import { MAX_PSD_RESOURCES } from './psdResources.js';

export const RECOVERY_CHUNK_BYTES = 256 * 1024;
export interface BinarySession { version: 2; activeId: string | null; documents: { state: ImageState; dirty: boolean }[] }
interface Ref { bytes: number; chunks: string[] }
type StoredLayer = Omit<ImageLayer, 'bitmap' | 'children' | 'mask'> & { bitmap: { width: number; height: number; data: Ref } | null; children: StoredLayer[]; mask?: Omit<NonNullable<ImageLayer['mask']>,'data'> & {data:Ref} };
type StoredState = Omit<ImageState, 'layers' | 'selection' | 'psdOrigin'> & { layers: StoredLayer[]; selection?: { x: number; y: number; width: number; height: number; mask?: Ref } | null; psdOrigin?: { sourceName: string; flattened: boolean; resources: Ref } };
export interface StoredSession { version: 3 | 4; activeId: string | null; documents: { state: StoredState; dirty: boolean }[] }
export const chunkKey = (hash: string) => 'chunk:' + hash;
const hash = async (data: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)), n => n.toString(16).padStart(2, '0')).join('');

/** Immutable document buffers are fingerprinted once; chunks are independently deduplicated. */
export class RecoveryCodec {
  private refs = new WeakMap<object, Ref>();
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
    const layer = async (item: ImageLayer): Promise<StoredLayer> => { const {mask,...base}=item; return ({ ...base, ...(item.mask?{mask:{...item.mask,data:await encode(item.mask.data)}}:{}),
      bitmap: item.bitmap ? { width: item.bitmap.width, height: item.bitmap.height, data: await encode(item.bitmap.data) } : null,
      children: await Promise.all(item.children.map(layer)) }); };
    const documents: StoredSession['documents'] = [];
    for (const item of session.documents) {
      const state = item.state; validateState(state);
      const { selection, psdOrigin, ...base } = state;
      const rect = selection ? { x: selection.x, y: selection.y, width: selection.width, height: selection.height } : null;
      documents.push({ dirty: item.dirty, state: { ...base, layers: await Promise.all(state.layers.map(layer)),
        selection: rect ? { ...rect, ...(selection?.mask ? { mask: await encode(selection.mask) } : {}) } : null,
        ...(psdOrigin ? { psdOrigin: { ...psdOrigin, resources: await encode(psdOrigin.resources) } } : {}) } });
    }
    return { session: { version: session.documents.some(d=>allLayers(d.state.layers).some(l=>l.content||l.mask||!['normal','multiply','screen'].includes(l.blend)))?4:3, activeId: session.activeId, documents } as StoredSession, chunks, used };
  }
}
export async function decodeRecovery(value: StoredSession, chunks: ReadonlyMap<string, unknown>): Promise<BinarySession> {
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
    let bytes = 0, count = 0;
    const layer = async (item: StoredLayer, depth: number): Promise<ImageLayer> => {
      if (!item || ++count > IMAGE_LIMITS.layers || depth > IMAGE_LIMITS.depth || !Array.isArray(item.children)) throw new Error('恢复图层树无效。');
      let bitmap = null;
      if (item.bitmap) {
        const { width, height } = item.bitmap; checkSize(width, height); bytes += width * height * 4;
        if (bytes > IMAGE_LIMITS.bytes) throw new Error('恢复像素超出预算。');
        bitmap = { width, height, data: new Uint8ClampedArray((await decode(item.bitmap.data, width * height * 4)).buffer) };
      }
      const children: ImageLayer[] = []; for (const child of item.children) children.push(await layer(child, depth + 1));
      const {mask,...base}=item;let decodedMask:ImageLayer['mask'];
      if(mask){checkSize(mask.width,mask.height);bytes+=mask.width*mask.height;if(bytes>IMAGE_LIMITS.bytes)throw new Error('恢复像素超出预算。');decodedMask={...mask,data:await decode(mask.data,mask.width*mask.height)};}
      return { ...base, ...(decodedMask?{mask:decodedMask}:{}), bitmap, children };
    };
    if (!Array.isArray(state.layers)) throw new Error('恢复图层树无效。');
    const layers: ImageLayer[] = []; for (const item of state.layers) layers.push(await layer(item, 0));
    const rect = state.selection; if (rect) checkSize(rect.width, rect.height);
    if (state.psdOrigin && (!Number.isSafeInteger(state.psdOrigin.resources?.bytes) || state.psdOrigin.resources.bytes < 0 || state.psdOrigin.resources.bytes > MAX_PSD_RESOURCES)) throw new Error('恢复 PSD 资源无效。');
    const { selection, psdOrigin, ...base } = state;
    const rectangle = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    const result: ImageState = { ...base, layers,
      selection: rectangle ? { ...rectangle, ...(rect?.mask ? { mask: await decode(rect.mask, rect.width * rect.height) } : {}) } : null,
      ...(psdOrigin ? { psdOrigin: { ...psdOrigin, resources: await decode(psdOrigin.resources, psdOrigin.resources.bytes) } } : {}) };
    validateState(result); documents.push({ state: result, dirty: item.dirty });
  }
  return { version: 2, activeId: value.activeId, documents };
}
