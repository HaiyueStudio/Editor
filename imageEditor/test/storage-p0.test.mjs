import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {deflate} from 'pako';
import {diskPager,diskRefs} from '../dist/diskPager.js';
import {ImageDocument,makeLayer} from '../dist/document.js';
import {pagedBitmap,clearPagedPixelCache} from '../dist/pagedPixels.js';
import {bitmapRegionAsync} from '../dist/diskCompositor.js';
import {streamProject,readProject} from '../dist/streamingProject.js';
import {serializeProject} from '../dist/projectFile.js';
import {serializeDiskProject,spillState} from '../dist/diskImage.js';
import {ImageWorkspace} from '../dist/workspace.js';
const files=new Map();diskPager.store.read=async key=>files.get(key);diskPager.store.write=async(key,b)=>files.set(key,b);
const source=b=>({size:b.length,async read(at,n){assert(at>=0&&at+n<=b.length);return b.slice(at,at+n);}});
const small=()=>{const l=makeLayer('pixels',{width:3,height:2,data:Uint8ClampedArray.from({length:24},(_,i)=>i%4===3?255:i*7)});return new ImageDocument({id:'project-p0',name:'P0',width:3,height:2,layers:[l],selectedId:l.id,revision:1});};
async function encoded(state){const parts=[];await streamProject(state,b=>parts.push(b.slice()));return new Uint8Array(Buffer.concat(parts));}
const rehash=async b=>{const v=new DataView(b.buffer,b.byteOffset,b.length),n=v.getUint32(12,true);b.set(new Uint8Array(await crypto.subtle.digest('SHA-256',b.subarray(64,64+n))),32);};

test('binary project preserves pixels, masks, artboards, spots, and legacy reads',async()=>{
 const d=small();await spillState(d.state);d.setProductivity({artboards:[{id:'a',name:'board',x:0,y:0,width:2,height:2}],spotChannels:[{id:'s',name:'spot',color:'#aa3344',solidity:.5,mask:{width:3,height:2,x:0,y:0,disabled:false,defaultColor:0,data:new Float32Array(6).fill(123.45),precision:'float32'}}]});const expected=await bitmapRegionAsync(d.selected.bitmap,{x:0,y:0,width:3,height:2});const b=await encoded(d.state);assert.equal(new TextDecoder().decode(b.subarray(0,8)),'HYIMG01\n');
 files.clear();diskPager.clear();clearPagedPixelCache();const restored=await readProject(source(b),true);assert.notEqual(restored.id,d.identity.id);assert.deepEqual(restored.artboards,d.state.artboards);assert.deepEqual(restored.spotChannels,d.state.spotChannels);assert.deepEqual((await bitmapRegionAsync(restored.layers[0].bitmap,{x:0,y:0,width:3,height:2})).data,expected.data);
 const legacy=await serializeDiskProject(restored);assert.equal((await readProject(source(new TextEncoder().encode(legacy)))).name,'P0');const dense=small();assert.equal((await readProject(source(new TextEncoder().encode(serializeProject(dense.state))))).width,3);dense.dispose();d.dispose();
});

test('streamed project rejects altered metadata, payload, footer, missing pages and truncation',async()=>{
 const d=small(),original=await encoded(d.state),v=new DataView(original.buffer),length=v.getUint32(12,true);
 for(const at of [64,64+length,original.length-1]){const b=original.slice();b[at]^=1;await assert.rejects(readProject(source(b)),/校验|完整/);}
 await assert.rejects(readProject(source(original.subarray(0,-10))),/头部|版本|完整/);
 const changed=original.slice(),manifest=JSON.parse(new TextDecoder().decode(changed.subarray(64,64+length)));manifest.pages[0].key='page:'+'0'.repeat(64);const json=new TextEncoder().encode(JSON.stringify(manifest));assert.equal(json.length,length);changed.set(json,64);await rehash(changed);await assert.rejects(readProject(source(changed)),/目录/);
 const unsupported=original.slice();new DataView(unsupported.buffer).setUint32(8,99,true);await assert.rejects(readProject(source(unsupported)),/版本/);d.dispose();
});

test('cancellation and sink failure never finish a project or change the document',async()=>{
 const d=small(),before=d.state,a=new AbortController();let calls=0,last;await assert.rejects(streamProject(d.state,b=>{last=b;calls++;if(calls===2)a.abort();},a.signal),e=>e.name==='AbortError');assert.equal(d.state,before);assert.notEqual(new TextDecoder().decode(last),'HYEND01\n');await assert.rejects(streamProject(d.state,()=>{throw Error('disk full');}),/disk full/);
 const b=await encoded(d.state),c=new AbortController();await assert.rejects(readProject(source(b),true,c.signal,()=>c.abort()),e=>e.name==='AbortError');assert.equal(d.state,before);d.dispose();
});

test('public project spool export/import supports progress, rollback and unchanged legacy resource export',async()=>{
 const w=new ImageWorkspace();await w.start();const d=small();w.add(d);let seq=0;const call=async(id,params={},doc=true)=>{const r=await w.api.execute({apiVersion:'1',requestId:'p0-'+(++seq),operation:'image.'+id,params,...(doc?{documentId:d.identity.id,expectedRevision:d.revision}:{})});assert.equal(r.status,'completed',JSON.stringify(r));return r.value;};
 const legacy=await call('document.export',{format:'project'});assert.equal(JSON.parse(new TextDecoder().decode(w.platform.resources.read(legacy.resourceId))).format,'haiyue-image');
 const out=await call('export.prepare',{format:'project'}),chunk=await call('export.read',{exportId:out.exportId,offset:0,length:4194304});assert(chunk.done);const upload=await call('import.begin',{format:'project',name:'binary.hyimage',size:out.bytes},false);await call('import.write',{importId:upload.importId,resourceId:chunk.resourceId,offset:0},false);const loaded=await call('import.finish',{importId:upload.importId},false);assert.equal(w.documents.find(d=>d.identity.id===loaded.documentId).state.name,'P0');await call('import.close',{importId:upload.importId},false);await call('export.close',{exportId:out.exportId});
 const malformed=w.platform.resources.put(new Uint8Array(64));const count=w.documents.length,active=w.active.identity.id;const bad=await w.api.execute({apiVersion:'1',requestId:'bad',operation:'image.document.open',params:{format:'project',name:'bad.hyimage',resourceId:malformed.resourceId}});assert.notEqual(bad.status,'completed');assert.equal(w.documents.length,count);assert.equal(w.active.identity.id,active);await w.dispose();
});

test('a real project over 128 MiB saves to file and reopens through bounded reads',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hyimage-p0-'));let handle;
 try{const tiles=[];for(let i=0;i<528;i++){const raw=new Uint8Array(256*256*4);let x=i+1;for(let j=0;j<raw.length;j++){x=(Math.imul(x,1664525)+1013904223)>>>0;raw[j]=x>>>24;}tiles.push(await diskPager.write(deflate(raw,{level:0})));}const bitmap=pagedBitmap(6144,5632,{kind:'disk',tiles}),layer=makeLayer('large',bitmap),d=new ImageDocument({id:'large-binary',name:'large',width:6144,height:5632,layers:[layer],selectedId:layer.id,revision:1});const expected=(await bitmapRegionAsync(d.selected.bitmap,{x:6143,y:5631,width:1,height:1})).data.slice();assert(diskRefs(d.state).reduce((n,r)=>n+r.bytes,0)>128*1024*1024);await assert.rejects(serializeDiskProject(d.state),/128 MiB/);
 handle=await open(join(dir,'large.hyimage'),'w+');let written=0;await streamProject(d.state,async b=>{const {bytesWritten}=await handle.write(b,0,b.length,written);assert.equal(bytesWritten,b.length);written+=b.length;});assert(written>128*1024*1024);files.clear();diskPager.clear();clearPagedPixelCache();let maxRead=0,totalRead=0;const restored=await readProject({size:written,async read(at,n){maxRead=Math.max(maxRead,n);totalRead+=n;const b=new Uint8Array(n);assert.equal((await handle.read(b,0,n,at)).bytesRead,n);return b;}});assert(maxRead<1024*1024);assert(totalRead<written+128);assert.deepEqual((await bitmapRegionAsync(restored.layers[0].bitmap,{x:6143,y:5631,width:1,height:1})).data,expected);d.dispose();
 }finally{await handle?.close();await rm(dir,{recursive:true,force:true});files.clear();diskPager.clear();clearPagedPixelCache();}
});

test('garbage collection retains history/shared snapshots and releases orphan and closed spool pages',()=>{
 const script=`
 import assert from 'node:assert/strict';import {deflate} from 'pako';import {diskPager} from './dist/diskPager.js';import {ImageDocument,makeLayer} from './dist/document.js';import {pagedBitmap,clearPagedPixelCache} from './dist/pagedPixels.js';import {bitmapRegionAsync} from './dist/diskCompositor.js';import {ImportSpools} from './dist/importSpools.js';
 const files=new Map();diskPager.store.read=async k=>files.get(k);diskPager.store.write=async(k,b)=>files.set(k,b);diskPager.store.collect=async live=>{let deletedPages=0,deletedBytes=0;for(const [k,b]of files)if(!live.has(k)){files.delete(k);deletedPages++;deletedBytes+=b.length;}return {status:'collected',deletedPages,deletedBytes,retainedPages:files.size};};
 const turn=()=>new Promise(r=>setImmediate(r));async function gc(){for(let i=0;i<4;i++){await turn();global.gc();}await turn();return diskPager.collect();}
 async function bitmap(n){return pagedBitmap(1,1,{kind:'disk',tiles:[await diskPager.write(deflate(new Uint8Array([n,0,0,255])))]});}
 async function make(){const l=makeLayer('x',await bitmap(12)),d=new ImageDocument({id:'gc',name:'gc',width:1,height:1,layers:[l],selectedId:l.id,revision:1});d.replaceLayerPixels(l.id,{...d.selected,bitmap:await bitmap(34)},'paint');return d;}
 const d=await make();await diskPager.write(new Uint8Array([88]));assert.equal((await gc()).deletedPages,1);d.history.undo();clearPagedPixelCache();assert.equal((await bitmapRegionAsync(d.selected.bitmap,{x:0,y:0,width:1,height:1})).data[0],12);d.history.redo();let peer=new ImageDocument(structuredClone(d.state));d.dispose();await gc();assert.equal(files.size,1);peer.dispose();peer=null;await gc();assert.equal(files.size,0);
 const uploads=new ImportSpools(),up=uploads.begin('x','project',8);await uploads.write(up.importId,0,new Uint8Array(8).fill(123));await gc();assert.equal(files.size,1);uploads.close(up.importId);await gc();assert.equal(files.size,0);uploads.clear();
 `;execFileSync(process.execPath,['--expose-gc','--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),timeout:30000,stdio:'pipe'});
});

test('native RGB16/HDR32 and CMYK16 samples survive binary paging without quantization',async()=>{
 for(const mode of ['rgb16','hdr32','cmyk16']){const depth=mode==='hdr32'?32:16,data=Float32Array.from({length:16},(_,i)=>i%4===3?128.25:mode==='hdr32'?[-25.5,510,1020][i%4]:33.333+i/13),bitmap={width:2,height:2,depth,data,...(mode==='cmyk16'?{cmyk:Float32Array.from({length:16},(_,i)=>i/7)}:{})},layer=makeLayer(mode,bitmap),d=new ImageDocument({id:mode,name:mode,width:2,height:2,bitDepth:depth,...(mode==='cmyk16'?{colorMode:'cmyk'}:{}),layers:[layer],selectedId:layer.id,revision:1});await spillState(d.state);const before=await bitmapRegionAsync(d.selected.bitmap,{x:0,y:0,width:2,height:2}),b=await encoded(d.state);files.clear();diskPager.clear();clearPagedPixelCache();const loaded=await readProject(source(b)),after=await bitmapRegionAsync(loaded.layers[0].bitmap,{x:0,y:0,width:2,height:2});assert.equal(loaded.bitDepth,depth);assert.deepEqual(after.data,before.data);assert.deepEqual(after.cmyk,before.cmyk);d.dispose();}
});
