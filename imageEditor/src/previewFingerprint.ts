import {RENDER_LAYER_KEYS,renderContent} from './renderInputs.js';
import {pixelStorageEpoch} from './pagedPixels.js';
import type {ImageLayer,ImageState} from './document.js';
const text=new TextEncoder();
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),n=>n.toString(16).padStart(2,'0')).join('');
let objects=new WeakMap<object,Promise<string>>(),layers=new WeakMap<ImageLayer,Promise<string>>(),epoch=-1;
const buffers=new WeakMap<ArrayBufferLike,Map<string,Promise<string>>>();
const counts={bufferBytes:0,bufferHashes:0,objectHashes:0,layerHashes:0,hits:0};
export const previewFingerprintStats=()=>({...counts});
/** Committed data is immutable. Backing-storage conversions invalidate structural
 * memoization, while hashes of the original byte ranges remain safe to reuse. */
function node(value:unknown,depth=0):Promise<string>{
 if(depth>80)throw Error('预览指纹结构过深。');
 if(!value||typeof value!=='object')return Promise.resolve(JSON.stringify(value)??'undefined');
 if(ArrayBuffer.isView(value)){
  let ranges=buffers.get(value.buffer);if(!ranges){ranges=new Map();buffers.set(value.buffer,ranges);}
  const key=`${value.byteOffset}/${value.byteLength}`,found=ranges.get(key);if(found){counts.hits++;return found.then(h=>`${value.constructor.name}:${h}`);}
  counts.bufferBytes+=value.byteLength;counts.bufferHashes++;const result=digest(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));ranges.set(key,result);void result.catch(()=>ranges!.delete(key));return result.then(h=>`${value.constructor.name}:${h}`);
 }
 const found=objects.get(value);if(found){counts.hits++;return found;}
 counts.objectHashes++;
 const result=(async()=>{
  const tree=Array.isArray(value)?await Promise.all(value.map(v=>node(v,depth+1))):await Promise.all(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(async([k,v])=>[k,await node(v,depth+1)]));
  return digest(text.encode(JSON.stringify([Array.isArray(value)?'array':'object',tree])));
 })();objects.set(value,result);void result.catch(()=>objects.delete(value));return result;
}
function layer(l:ImageLayer):Promise<string>{
 const found=layers.get(l);if(found){counts.hits++;return found;}counts.layerHashes++;
 const result=(async()=>node({...Object.fromEntries(RENDER_LAYER_KEYS.map(k=>[k,l[k]])),bitmap:l.bitmap,content:renderContent(l),children:await Promise.all(l.children.map(layer))}))();layers.set(l,result);void result.catch(()=>layers.delete(l));return result;
}
/** Merkle-style fingerprints recompute only changed layer paths, and never clone
 * or materialize pixels. Exact view ranges avoid hashing unrelated pooled bytes. */
export async function previewFingerprint(s:ImageState,mode:string):Promise<string>{
 if(epoch!==pixelStorageEpoch){epoch=pixelStorageEpoch;objects=new WeakMap();layers=new WeakMap();}
 const generation=epoch,result=await node({version:3,mode,width:s.width,height:s.height,bitDepth:s.bitDepth??8,colorMode:s.colorMode??'rgb',icc:s.icc,display:s.display,resources:s.psdOrigin?.resources,layers:await Promise.all(s.layers.map(layer))});
 // A concurrent paging commit must not publish a mixed old/new storage key.
 return generation===pixelStorageEpoch?result:previewFingerprint(s,mode);
}
