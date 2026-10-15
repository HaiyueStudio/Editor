export {previewFingerprint,previewFingerprintStats} from './previewFingerprint.js';
import type {ImageLayer,ImageState} from './document.js';
const LIMIT=64*1024*1024;
export interface PreviewCache {read(key:string):Promise<Uint8Array|undefined>;write(key:string,bytes:Uint8Array):Promise<boolean>;readMany?(keys:readonly string[]):Promise<Map<string,Uint8Array|undefined>>;writeMany?(entries:readonly (readonly [string,Uint8Array])[]):Promise<boolean>}
/** Composition consumes cached layer pixels; embedded smart sources and PSD archives
 * are editable assets, not render inputs. Avoid cloning them into a preview Worker. */
export function previewState(state:ImageState):ImageState {
 const layer=(l:ImageLayer):ImageLayer=>{const {content,...rest}=l;return {...rest,children:l.children.map(layer),...(content?.type==='adjustment'?{content}:{})};};
 const {id,name,width,height}=state,result:ImageState={id,name,width,height,layers:state.layers.map(layer),selectedId:null,revision:1};
 for(const key of ['bitDepth','colorMode','icc','display','psdOrigin'] as const)if(state[key]!==undefined)Object.assign(result,{[key]:state[key]});return result;
}
/** Disposable pixels and LRU metadata live separately. Hits read pixels in readonly
 * transactions, then coalesce small timestamp records without rewriting images. */
export class PersistentPreviewCache implements PreviewCache {
 private static connection:Promise<IDBDatabase>|undefined;
 private static pending=new Map<string,number>();private static timer:ReturnType<typeof setTimeout>|undefined;private static flushing:Promise<void>|undefined;
 private static counters={reads:0,payloadWrites:0,accessWrites:0,accessBatches:0};
 constructor(private key:Promise<string>){void key.catch(()=>{});}
 stats(){return {...PersistentPreviewCache.counters,pendingAccess:PersistentPreviewCache.pending.size};}
 private db(){return PersistentPreviewCache.connection??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('haiyue.image-preview.v1',2);r.onupgradeneeded=()=>{for(const name of [...r.result.objectStoreNames])r.result.deleteObjectStore(name);r.result.createObjectStore('tiles');r.result.createObjectStore('access').createIndex('used','used');r.result.createObjectStore('meta');};r.onerror=()=>{PersistentPreviewCache.connection=undefined;reject(r.error);};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();PersistentPreviewCache.connection=undefined;};resolve(r.result);};});}
 private touch(key:string){const c=PersistentPreviewCache;c.pending.delete(key);c.pending.set(key,Date.now());if(c.pending.size>1024)c.pending.delete(c.pending.keys().next().value!);if(!c.timer)c.timer=setTimeout(()=>{c.timer=undefined;void this.flushAccess();},1000);}
 async flushAccess():Promise<void>{
  const c=PersistentPreviewCache;if(c.flushing){await c.flushing;return this.flushAccess();}if(c.timer){clearTimeout(c.timer);c.timer=undefined;}if(!c.pending.size)return;
  const entries=[...c.pending];c.pending.clear();
  const work=(async()=>{try{const db=await this.db();for(let start=0;start<entries.length;start+=256)await new Promise<void>((resolve,reject)=>{const tx=db.transaction('access','readwrite'),s=tx.objectStore('access');c.counters.accessBatches++;for(const [key,used] of entries.slice(start,start+256)){const r=s.get(key);r.onsuccess=()=>{if(r.result&&r.result.used<used){s.put({...r.result,used},key);c.counters.accessWrites++;}};}tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});}catch{/* LRU hints can be dropped; document data is independent. */}})();
  c.flushing=work;try{await work;}finally{if(c.flushing===work)c.flushing=undefined;}
 }
 async read(key:string){return (await this.readMany([key])).get(key);}
 async readMany(keys:readonly string[]){
  const result=new Map<string,Uint8Array|undefined>();try{const prefix=await this.key+'/',db=await this.db();for(let start=0;start<keys.length;start+=16){const batch=[...new Set(keys.slice(start,start+16))];await new Promise<void>((resolve,reject)=>{const tx=db.transaction('tiles','readonly'),s=tx.objectStore('tiles');PersistentPreviewCache.counters.reads++;for(const key of batch){const r=s.get(prefix+key);r.onsuccess=()=>result.set(key,r.result?.bytes);}tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});for(const key of batch)if(result.get(key))this.touch(prefix+key);}return result;}catch{return new Map<string,Uint8Array|undefined>();}
 }
 async write(key:string,bytes:Uint8Array){return this.writeMany([[key,bytes]]);}
 async writeMany(entries:readonly (readonly [string,Uint8Array])[]){
  try{const prefix=await this.key+'/',db=await this.db(),list=[...new Map(entries)];if(list.some(([,b])=>b.length>4*1024*1024))return false;await this.flushAccess();
   for(let start=0;start<list.length;){const batch:(readonly [string,Uint8Array])[]=[];let bytes=0;while(start<list.length&&batch.length<16&&(bytes+list[start]![1].length<=4*1024*1024||!batch.length)){const e=list[start++]!;batch.push(e);bytes+=e[1].length;}
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['tiles','access','meta'],'readwrite'),s=tx.objectStore('tiles'),a=tx.objectStore('access'),m=tx.objectStore('meta'),old=batch.map(([k])=>a.get(prefix+k)),total=m.get('bytes');total.onsuccess=()=>{let size=total.result??0;batch.forEach(([key,bytes],i)=>{size+=bytes.length-(old[i]!.result?.size??0);s.put({bytes},prefix+key);a.put({used:Date.now(),size:bytes.length},prefix+key);PersistentPreviewCache.counters.payloadWrites++;});const cursor=a.index('used').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(size>LIMIT&&c){size-=c.value.size;s.delete(c.primaryKey);c.delete();c.continue();}else m.put(size,'bytes');};};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});
   }return true;
  }catch{return false;}
 }
}
