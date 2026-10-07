import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImageDocument, makeLayer, IMAGE_LIMITS, validateState } from '../dist/document.js';
import { PixelStroke } from '../dist/pixelTools.js';
import { RecoveryCodec, decodeRecovery } from '../dist/recoveryCodec.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=resolve(root,'imageEditor/artifacts/p4');mkdirSync(output,{recursive:true});
if(!global.gc)throw new Error('Run with node --expose-gc to verify release and reconstruction.');
const collect=async()=>{await new Promise(resolve=>setImmediate(resolve));global.gc();await new Promise(resolve=>setImmediate(resolve));global.gc();};
const timing=async action=>{const start=performance.now();const value=await action();return {ms:performance.now()-start,value};};
const cases=[];
for(const [size,count] of [[2048,20],[4096,50]]){
 await collect();const baseline=process.memoryUsage();const start=performance.now();
 let doc=ImageDocument.create(`${size} stress`,size,size,true);
 // Raster layers are cropped sprites; report their exact allocation rather than claiming full-canvas stacks.
 const layers=[doc.selected,...Array.from({length:count-1},(_,i)=>({...makeLayer('sprite '+i,{width:64,height:64,data:new Uint8ClampedArray(64*64*4).fill(i+1)}),x:(i*73)%(size-64),y:(i*97)%(size-64)}))];
 doc=new ImageDocument({...doc.state,layers});const layerId=layers[0].id;doc.select(layerId);
 const opened=performance.now()-start, samples=[], snapshots=[];let peak=process.memoryUsage();
 for(let i=0;i<24;i++){
  snapshots.push(new WeakRef(doc.state));
  const t=performance.now();let stroke=new PixelStroke(doc.state,layerId,16,.8,[20+i,80,150]);stroke.point({x:100+i*2,y:100});stroke.point({x:120+i*2,y:120});
  doc.replaceLayerPixels(layerId,stroke.layer,'stress stroke',doc.revision,stroke.changedBounds);stroke=undefined;samples.push(performance.now()-t);
  const memory=process.memoryUsage();for(const k of Object.keys(peak))peak[k]=Math.max(peak[k],memory[k]);
  await collect(); // Old WeakRef targets must be gone: undo below exercises actual XOR reconstruction.
 }
 assert.equal(snapshots.filter(ref=>ref.deref()).length,0,'history must release all old dense state objects');
 assert.equal(doc.history.snapshot().entries.length,24);const history=doc.history.snapshot().estimatedBytes;assert(history<64*1024*1024,'local strokes must not retain 24 dense frames');
 const afterHash=createHash('sha256').update(doc.selected.bitmap.data).digest('hex');
 const undo=await timing(async()=>{for(let i=0;i<24;i++)doc.history.undo();});
 assert(doc.selected.bitmap.data.every(v=>v===255));
 await collect();const redo=await timing(async()=>{for(let i=0;i<24;i++)doc.history.redo();});
 assert.equal(createHash('sha256').update(doc.selected.bitmap.data).digest('hex'),afterHash);
 let codec=new RecoveryCodec();const encoded=await timing(()=>codec.encode({version:2,activeId:doc.identity.id,documents:[{state:doc.state,dirty:true}]},new Set()));
 const decoded=await timing(()=>decodeRecovery(encoded.value.session,encoded.value.chunks));assert.deepEqual(decoded.value.documents[0].state.layers,doc.state.layers);
 const unchanged=await timing(()=>codec.encode({version:2,activeId:doc.identity.id,documents:[{state:doc.state,dirty:true}]},encoded.value.used));assert.equal(unchanged.value.chunks.size,0);
 // Validate the original proposed full-canvas workload as an explicit admission failure.
 const fullLayers=Array.from({length:count},(_,i)=>({...layers[0],id:'full-'+i}));assert.throws(()=>validateState({...doc.state,layers:fullLayers,selectedId:'full-0'}),/128 MiB/);
 samples.sort((a,b)=>a-b);
 cases.push({canvas:[size,size],layers:count,layout:'one full canvas plus cropped 64x64 raster sprites',pixelBytes:size*size*4+(count-1)*64*64*4,openMs:opened,stroke:{samples:24,p50Ms:samples[12],p95Ms:samples[22],maxMs:samples[23]},undo24Ms:undo.ms,redo24Ms:redo.ms,historyBytes:history,recovery:{firstMs:encoded.ms,unchangedMs:unchanged.ms,decodeMs:decoded.ms,storedChunkBytes:[...encoded.value.chunks.values()].reduce((n,b)=>n+b.length,0),unchangedChunkWrites:0},peakProcessMemory:peak,baselineProcessMemory:baseline,fullCanvasStack:{requiredBytes:size*size*4*count,status:'rejected-by-existing-128MiB-budget'}});
 doc.dispose();assert.equal(doc.state.layers.length,0);assert.equal(doc.history.snapshot().estimatedBytes,0);
}
// Repeated creation/disposal must return typed-array allocations to baseline after GC.
await collect();const before=process.memoryUsage().arrayBuffers;
for(let i=0;i<20;i++){const doc=ImageDocument.create('release',2048,2048,true);doc.dispose();}
await collect();const residual=process.memoryUsage().arrayBuffers-before;assert(residual<4*1024*1024,`Residual pixel storage ${residual}`);
const files=[...readdirSync(resolve(root,'imageEditor/src')).map(f=>'imageEditor/src/'+f),'imageEditor/scripts/run-p4-performance.mjs','imageEditor/package.json','package-lock.json'];
const report={schemaVersion:1,status:'passed',classification:'local CPU diagnostic; not a cross-device performance release gate',generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),runner:{node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,memoryBytes:totalmem()},limits:IMAGE_LIMITS,cases,release:{cycles:20,residualArrayBufferBytes:residual},sourceFingerprints:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]))};
writeFileSync(resolve(output,'performance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:cases.map(c=>({canvas:c.canvas,p95:c.stroke.p95Ms,historyBytes:c.historyBytes})),residual}));
