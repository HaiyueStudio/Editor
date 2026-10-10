import test from 'node:test';
import assert from 'node:assert/strict';
import { writePsdUint8Array } from 'ag-psd';
import { importPsd } from '../dist/psdAdapter.js';
import { estimatePsdMemory } from '../dist/psdMemory.js';
import { psdTransferBuffers } from '../dist/psdTransfer.js';
import { IMAGE_LIMITS, ImageDocument } from '../dist/document.js';
import { readHighPsd, writeHighPsd } from '../dist/highDepthPsd.js';
import { PsdJobs } from '../dist/psdJobs.js';

const merged = { width: 2, height: 1, data: new Uint8ClampedArray([12,34,56,255,78,90,123,255]) };
let large;
function largePsd(hasRealMergedData=true) {
  if (!large) {
    const data=new Uint8ClampedArray(2048*2048*4);for(let i=3;i<data.length;i+=4)data[i]=255;
    const children=Array.from({length:9},(_,i)=>({name:'layer '+i,imageData:{width:2048,height:2048,data}}));
    large={width:2,height:1,children,imageData:merged};
  }
  return writePsdUint8Array({...large,imageResources:{versionInfo:{hasRealMergedData,writerName:'test',readerName:'test',fileVersion:1}}},{compress:true,noBackground:true});
}

test('compressed over-budget PSD exposes exact merged pixels instead of throwing or decoding layers',()=>{
  const bytes=largePsd(),source=bytes.slice(),result=importPsd(bytes,'large.psd');
  assert(bytes.length<1024*1024);assert.deepEqual(bytes,source);
  assert.equal(result.layered,null);assert.equal(result.memory.layerPixelBytes,144*1024*1024);
  assert.equal(result.memory.compositeOnly,true);assert.match(result.blockers[0],/跳过图层解码/);
  assert.deepEqual(result.flattened.layers[0].bitmap.data,merged.data);
  assert.equal(result.flattened.psdOrigin.flattened,true);
  const doc=new ImageDocument(result.flattened);doc.rename('edited');assert.equal(doc.identity.name,'edited');doc.history.undo();assert.match(doc.identity.name,/合并副本/);doc.dispose();
  result.flattened.layers[0].bitmap.data[0]=240;
  assert.deepEqual(bytes,source,'adopting decoded pixels never aliases the source file');
});

test('over-budget PSD without a real merged image never silently imports a flattened document',()=>{
  const result=importPsd(largePsd(false),'no-preview.psd');
  assert.equal(result.layered,null);assert.equal(result.flattened,null);assert.match(result.notes.join(),/没有可用的合并预览/);
});

test('admission counts native working precision, masks, and off-canvas layers before decoding',()=>{
  const doc={width:4,height:4,children:[{left:-20,top:-20,right:12,bottom:12,mask:{left:0,top:0,right:8,bottom:8}}]};
  for(const [depth,cmyk,bpp] of [[8,false,4],[16,false,16],[32,false,16],[8,true,20],[16,true,32]]) {
    const memory=estimatePsdMemory(doc,42,depth,cmyk);assert.equal(memory.layerPixelBytes,(32*32+8*8)*bpp);assert.equal(memory.compositePixelBytes,16*bpp);assert.equal(memory.limitBytes,IMAGE_LIMITS.bytes);
  }
  assert.throws(()=>estimatePsdMemory({...doc,children:[{left:2,right:1,top:0,bottom:1}]},0,8,false),/范围/);
  assert.throws(()=>estimatePsdMemory({...doc,children:[{left:0,right:9000,top:0,bottom:1}]},0,8,false),/尺寸/);
  assert.throws(()=>estimatePsdMemory({...doc,children:Array.from({length:129},()=>({}))},0,8,false),/128/);
});

test('high-depth composite admission rejects before allocating an over-budget merged canvas',()=>{
  const bytes=writePsdUint8Array({width:2,height:1,imageData:merged},{compress:true});
  new DataView(bytes.buffer).setUint16(22,16);
  assert.throws(()=>readHighPsd(bytes,{metadata:{width:4096,height:4096},compositeOnly:true}),/合并图解码超过/);
});

test('worker result transfer deduplicates shared resources and preserves aliases and samples',()=>{
  const decoded=importPsd(writePsdUint8Array({width:2,height:1,children:[{imageData:merged}],imageData:merged},{compress:true}),'small.psd');
  assert(decoded.layered);const buffers=psdTransferBuffers(decoded);assert.equal(new Set(buffers).size,buffers.length);
  const copy=structuredClone(decoded,{transfer:buffers});assert(buffers.every(b=>b.byteLength===0));
  assert.deepEqual(copy.flattened.layers[0].bitmap.data,merged.data);assert.deepEqual(copy.layered.layers[0].bitmap.data,merged.data);
  assert.equal(copy.layered.psdOrigin.resources,copy.flattened.psdOrigin.resources);
});

test('input transfer is opt-in and never detaches caller-owned API or batch inputs',async()=>{
  const old=globalThis.Worker;
  class FakeWorker {
    postMessage(request,transfer){const input=structuredClone(request,{transfer});queueMicrotask(()=>this.onmessage({data:{ok:true,value:input.bytes.length}}));}
    terminate(){}
  }
  globalThis.Worker=FakeWorker;
  try {for(const transfer of [false,true]){const bytes=new Uint8Array([1,2,3]),jobs=new PsdJobs(()=>{});assert.equal(await jobs.import(bytes,'test.psd',transfer),3);assert.equal(bytes.byteLength,transfer?0:3);}}
  finally {globalThis.Worker=old;}
});

for(const [depth,cmyk] of [[16,false],[32,false],[8,true],[16,true]])test(`composite-only decoder preserves RGB/CMYK samples at ${depth} bits (CMYK=${cmyk})`,()=>{
  const image={...merged,data:depth===8?merged.data:Float32Array.from(merged.data),...(cmyk?{cmyk:new Float32Array([10,20,30,40,50,60,70,80])}:{})};
  const bytes=writeHighPsd({width:2,height:1,imageData:image,children:[{name:'pixels',imageData:image}]},depth,cmyk);
  const full=readHighPsd(bytes),flat=readHighPsd(bytes,{compositeOnly:true});
  assert(full.children[0].imageData);assert.equal(flat.children[0].imageData,undefined);
  assert.deepEqual(flat.imageData,full.imageData);
});
