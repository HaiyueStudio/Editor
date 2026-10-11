import {encodePixelArchive} from './pixelArchive.js';
import {renderFingerprintInput} from './renderInputs.js';
import type {ImageLayer,ImageState} from './document.js';
const LIMIT=64*1024*1024;
export interface PreviewCache {read(key:string):Promise<Uint8Array|undefined>;write(key:string,bytes:Uint8Array):Promise<boolean>;readMany?(keys:readonly string[]):Promise<Map<string,Uint8Array|undefined>>;writeMany?(entries:readonly (readonly [string,Uint8Array])[]):Promise<boolean>}
const hash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b as Uint8Array<ArrayBuffer>)),n=>n.toString(16).padStart(2,'0')).join('');
/** Composition consumes cached layer pixels; embedded smart sources and PSD archives
 * are editable assets, not render inputs. Avoid cloning them into a preview Worker. */
export function previewState(state:ImageState):ImageState {
 const layer=(l:ImageLayer):ImageLayer=>{const {content,...rest}=l;return {...rest,children:l.children.map(layer),...(content?.type==='adjustment'?{content}:{})};};
 const {id,name,width,height}=state,result:ImageState={id,name,width,height,layers:state.layers.map(layer),selectedId:null,revision:1};
 for(const key of ['bitDepth','colorMode','icc','display','psdOrigin'] as const)if(state[key]!==undefined)Object.assign(result,{[key]:state[key]});return result;
}
/** Fingerprint actual render inputs, not document IDs/revisions (undo can branch). */
export async function previewFingerprint(input:ImageState,mode:string){const {tree,buffers}=encodePixelArchive(renderFingerprintInput(input));return hash(new TextEncoder().encode(JSON.stringify({version:2,mode,tree,buffers:await Promise.all(buffers.map(hash))})));}
/** Disposable cache owns its bytes in a separate database; document-page GC has no extra roots.
 * Every put/eviction/byte-account update commits atomically, including across tabs. */
export class PersistentPreviewCache implements PreviewCache {
 private static connection:Promise<IDBDatabase>|undefined;
 constructor(private key:Promise<string>){void key.catch(()=>{});}
 private db(){return PersistentPreviewCache.connection??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('haiyue.image-preview.v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('tiles').createIndex('used','used');r.result.createObjectStore('meta');};r.onerror=()=>{PersistentPreviewCache.connection=undefined;reject(r.error);};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();PersistentPreviewCache.connection=undefined;};resolve(r.result);};});}
 async read(key:string){return (await this.readMany([key])).get(key);}
 async readMany(keys:readonly string[]){
  const result=new Map<string,Uint8Array|undefined>();try{const prefix=await this.key+'/',db=await this.db();for(let start=0;start<keys.length;start+=16){const batch=[...new Set(keys.slice(start,start+16))];await new Promise<void>((resolve,reject)=>{const tx=db.transaction('tiles','readwrite'),store=tx.objectStore('tiles');for(const key of batch){const r=store.get(prefix+key);r.onsuccess=()=>{const bytes=r.result?.bytes;result.set(key,bytes);if(bytes)store.put({...r.result,used:Date.now()},prefix+key);};}tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});}return result;}catch{return new Map<string,Uint8Array|undefined>();}
 }
 async write(key:string,bytes:Uint8Array){return this.writeMany([[key,bytes]]);}
 async writeMany(entries:readonly (readonly [string,Uint8Array])[]){
  try{const prefix=await this.key+'/',db=await this.db(),list=[...new Map(entries)];if(list.some(([,b])=>b.length>4*1024*1024))return false;
   for(let start=0;start<list.length;){const batch:(readonly [string,Uint8Array])[]=[];let bytes=0;while(start<list.length&&batch.length<16&&(bytes+list[start]![1].length<=4*1024*1024||!batch.length)){const e=list[start++]!;batch.push(e);bytes+=e[1].length;}
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['tiles','meta'],'readwrite'),s=tx.objectStore('tiles'),m=tx.objectStore('meta'),old=batch.map(([k])=>s.get(prefix+k)),total=m.get('bytes');total.onsuccess=()=>{let size=total.result??0;batch.forEach(([key,bytes],i)=>{size+=bytes.length-(old[i]!.result?.bytes.length??0);s.put({bytes,used:Date.now()},prefix+key);});const cursor=s.index('used').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(size>LIMIT&&c){size-=c.value.bytes.length;c.delete();c.continue();}else m.put(size,'bytes');};};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});
   }return true;
  }catch{return false;}
 }
}
