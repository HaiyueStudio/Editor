// Bundled by interaction-p2-browser.mjs to exercise the real composition kernels.
import {GpuRegionCompositor} from '../dist/gpuRegionCompositor.js';
import {compositeRegionAsync} from '../dist/diskCompositor.js';
import {makeLayer,ImageDocument} from '../dist/document.js';
import {residentGpuPlan} from '../dist/residentGpuPlan.js';
import {previewFingerprint,previewFingerprintStats} from '../dist/previewFingerprint.js';
import {PersistentPreviewCache} from '../dist/previewCache.js';
import {storeMaskTile} from '../dist/diskMasks.js';
export async function gpuCases(){
 const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const gpu=new GpuRegionCompositor(device),data=(width,height,seed=0)=>({width,height,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>{const x=Math.floor(i/4)%width,y=Math.floor(i/4/width);return [(x*3+seed*11)%256,(y*4+seed*17)%256,80+seed%150,(x+y+seed)%13===0?0:80+(x*7+y*3+seed)%176][i%4];})});
 const layer=(seed=0,w=257,h=259)=>({...makeLayer('layer',data(w,h,seed)),x:seed%5-2,y:seed%3-1,opacity:.4+(seed%4)*.15});
 const mask=(defaultColor=0,extra={})=>({width:101,height:51,x:10,y:6,data:Uint8Array.from({length:101*51},(_,i)=>(i*13)%256),disabled:false,defaultColor,...extra});
 const base={id:'p2',name:'test',width:9001,height:270,revision:1,selectedId:null};
 const cases=[
  {name:'40 overlapping / sparse layers',state:{...base,layers:Array.from({length:40},(_,i)=>({...layer(i),x:i<32?i%5-2:500+i*300,mask:i%3===0?mask(255):undefined,blend:['normal','multiply','screen','overlay','darken','lighten','hard-light','difference','exclusion'][i%9]}))}},
  {name:'mask offset density exterior',state:{...base,layers:[layer(1),{...layer(2),mask:mask(255,{density:.63})},{...layer(3),mask:mask(0)}]}},
  {name:'feather and disabled mask',state:{...base,layers:[layer(1),{...layer(2),mask:mask(0,{feather:1.2,density:.8})},{...layer(3),mask:mask(0,{disabled:true})}]}},
  {name:'clipped base opacity / many clipped layers',state:{...base,layers:[layer(1),{...layer(2),opacity:.63,mask:mask(0)},...Array.from({length:17},(_,i)=>({...layer(i+3),clipping:true,mask:i===5?mask(255,{density:.61}):undefined,blend:i%2?'multiply':'screen'})),{...layer(8),x:400,visible:false},{...layer(9),clipping:true}]}},
  {name:'pass-through offsets keep clipped boundary',state:{...base,layers:[layer(1),{...makeLayer('group'),kind:'group',passThrough:true,x:12,y:2,children:[layer(4),{...layer(5),clipping:true,mask:mask(255)}]}]}},
  {name:'point filters plus mask',state:{...base,layers:[layer(1),{...layer(2),mask:mask(255),smartFilters:[{id:'i',enabled:true,opacity:.6,blend:'normal',settings:{kind:'invert',amount:50}},{id:'b',enabled:true,opacity:.8,blend:'normal',settings:{kind:'brightness',amount:30}}]}]}},
  {name:'regional reference filter plus GPU blend',state:{...base,layers:[layer(1),{...layer(2),mask:mask(0),smartFilters:[{id:'blur',enabled:true,opacity:.7,blend:'normal',settings:{kind:'blur',amount:2}}]}]}},
  {name:'complex local blend fallback',state:{...base,layers:[layer(1),{...layer(2,70,55),blend:'color'}, {...layer(5),x:400}]}},
 ];
 const sample=Float32Array.from({length:101*51},(_,i)=>(i*.73)%255),blob=await storeMaskTile(sample);cases.push({name:'paged float mask',state:{...base,layers:[layer(1),{...layer(2),mask:mask(255,{data:new Uint8Array(),samples:{tiles:[blob]},precision:'float32',density:.7,feather:1})}]}});
 const result=[],rects=[{x:0,y:0,width:256,height:256},{x:256,y:0,width:256,height:256},{x:512,y:0,width:256,height:256}],texture=device.createTexture({size:[256,256],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),buffer=device.createBuffer({size:256*256*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 async function read(){const e=device.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer,bytesPerRow:1024},[256,256]);device.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();return bytes;}
 try{
  for(const {name,state} of cases){gpu.reset();const started=performance.now(),before=gpu.stats();let max=0,alphaError=0,premultipliedError=0;
   if(!residentGpuPlan(state))throw Error('missing plan '+name);
   for(const rect of rects){await gpu.compose(state,rect,texture);const actual=await read(),expected=(await compositeRegionAsync(state,rect)).data;
    for(let i=0;i<actual.length;i++){const a=i-i%4+3,err=Math.abs(actual[i]-expected[i]);if(i%4===3)alphaError=Math.max(alphaError,err);else{if(expected[a]>=16)max=Math.max(max,err);premultipliedError=Math.max(premultipliedError,Math.abs(actual[i]*actual[a]/255-expected[i]*expected[a]/255));}}
   }
   const after=gpu.stats();if(max>4||alphaError>2||premultipliedError>3)throw Error(JSON.stringify({name,max,alphaError,premultipliedError}));if(after.sources.bytes>after.sources.budget||after.maxBatchLayers>4)throw Error('working set');
   result.push({name,max,alphaError,premultipliedError,ms:performance.now()-started,passes:after.layerPasses-before.layerPasses,referenceTiles:after.referenceTiles-before.referenceTiles,referenceSources:after.referenceSources-before.referenceSources,stats:after});
  }
  const state=cases[1].state;gpu.reset();await gpu.compose(state,rects[0],texture);await read();const before=gpu.stats();await gpu.compose({...state,layers:state.layers.map(l=>({...l,opacity:.7}))},rects[0],texture);await read();const after=gpu.stats();if(after.uploadedBytes!==before.uploadedBytes||after.maskUploads!==before.maskUploads)throw Error('metadata edit reuploads pixels or masks');
  const controller=new AbortController();controller.abort();let aborted=false;try{await gpu.compose(state,rects[0],texture,controller.signal);}catch(e){aborted=e.name==='AbortError';}if(!aborted)throw Error('cancel ignored');
  await device.queue.onSubmittedWorkDone();if(errors.length)throw Error(JSON.stringify(errors));return {cases:result,warm:{uploadBytes:after.uploadedBytes-before.uploadedBytes,maskUploads:after.maskUploads-before.maskUploads},errors};
 }finally{texture.destroy();buffer.destroy();gpu.dispose();device.destroy();}
}
export async function cacheCases(){
 const databases=await indexedDB.databases();let migrated=false;
 if(!databases.some(d=>d.name==='haiyue.image-preview.v1')){await new Promise((resolve,reject)=>{const r=indexedDB.open('haiyue.image-preview.v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('tiles').createIndex('used','used');r.result.createObjectStore('meta');};r.onsuccess=()=>{const db=r.result,tx=db.transaction(['tiles','meta'],'readwrite');tx.objectStore('tiles').put({bytes:new Uint8Array(9),used:0},'old');tx.objectStore('meta').put(9,'bytes');tx.oncomplete=()=>{db.close();resolve();};};r.onerror=()=>reject(r.error);});migrated=true;}
 const a=new PersistentPreviewCache(Promise.resolve('p2')),b=new PersistentPreviewCache(Promise.resolve('p2'));
 await a.writeMany(Array.from({length:35},(_,i)=>['k'+i,new Uint8Array([i,128])]));await a.flushAccess();const baseline=a.stats();let payloadPuts=0,readonly=0;
 const put=IDBObjectStore.prototype.put,transaction=IDBDatabase.prototype.transaction;
 IDBObjectStore.prototype.put=function(...args){if(this.name==='tiles'&&this.transaction.db.name==='haiyue.image-preview.v1')payloadPuts++;return put.apply(this,args);};
 IDBDatabase.prototype.transaction=function(stores,mode,...args){if(stores==='tiles'&&mode==='readonly'&&this.name==='haiyue.image-preview.v1')readonly++;return transaction.call(this,stores,mode,...args);};
 try{
  for(let i=0;i<12;i++){const values=await b.readMany(['k0','k1','k2','missing']);if(values.get('k1')?.[0]!==1||values.get('missing'))throw Error('cache mismatch');}
  const beforeFlush=b.stats();await b.flushAccess();const after=b.stats();if(payloadPuts!==0||readonly!==12||after.accessBatches-baseline.accessBatches!==1||beforeFlush.pendingAccess!==3)throw Error(JSON.stringify({payloadPuts,readonly,beforeFlush,after,baseline}));
  await Promise.all([a.writeMany([['same',new Uint8Array(400)]]),b.writeMany([['same',new Uint8Array(700)]])]);
  // Eviction uses only tiny metadata rows, never clones all images into the cursor.
  await a.writeMany(Array.from({length:17},(_,i)=>['large'+i,new Uint8Array(4*1024*1024)]));await b.flushAccess();
  const db=await a.db(),stats=await new Promise((resolve,reject)=>{const tx=db.transaction(['tiles','access','meta']),tiles=tx.objectStore('tiles').getAll(),access=tx.objectStore('access').getAll(),total=tx.objectStore('meta').get('bytes');tx.oncomplete=()=>resolve({total:total.result,actual:tiles.result.reduce((n,v)=>n+v.bytes.length,0),metadata:access.result.reduce((n,v)=>n+v.size,0),tiles:tiles.result.length,rows:access.result.length});tx.onabort=()=>reject(tx.error);});
  if(stats.total!==stats.actual||stats.metadata!==stats.total||stats.total>64*1024*1024||stats.tiles!==stats.rows)throw Error(JSON.stringify(stats));
  return {migrated,readonly,payloadPutsDuringHits:0,accessBatches:after.accessBatches-baseline.accessBatches,coalescedTouches:beforeFlush.pendingAccess,...stats};
 }finally{IDBObjectStore.prototype.put=put;IDBDatabase.prototype.transaction=transaction;}
}

export async function fingerprintCases(){
 const layers=Array.from({length:40},(_,i)=>makeLayer('L'+i,{width:256,height:256,data:new Uint8ClampedArray(256*256*4).fill(i)})),s={id:'hash',name:'hash',width:9001,height:256,layers,selectedId:null,revision:1};
 const doc=new ImageDocument(s),start=performance.now(),key=await previewFingerprint(doc.state,'gpu'),coldMs=performance.now()-start,before=previewFingerprintStats();doc.updateLayer(doc.state.layers[7].id,{opacity:.5});const warmStart=performance.now();
 const changed=await previewFingerprint(doc.state,'gpu'),warmMs=performance.now()-warmStart,after=previewFingerprintStats();doc.dispose();
 if(key===changed||after.bufferBytes!==before.bufferBytes||after.layerHashes-before.layerHashes!==1)throw Error('incremental hash regression');
 return {layers:40,sourceBytes:40*256*256*4,coldMs,warmMs,rehashPixelBytes:after.bufferBytes-before.bufferBytes,changedLayerHashes:after.layerHashes-before.layerHashes};
}
