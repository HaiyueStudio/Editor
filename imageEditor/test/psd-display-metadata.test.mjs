import test from 'node:test';
import assert from 'node:assert/strict';
import {writeHighPsd,readPsdMetadata} from '../dist/highDepthPsd.js';
import {importPsd,exportPsd} from '../dist/psdAdapter.js';
import {ImageDocument} from '../dist/document.js';
import {serializeProject,deserializeProject} from '../dist/projectFile.js';
import {RecoveryCodec,decodeRecovery} from '../dist/recoveryCodec.js';
import {psdSections,concatBytes,additionalInfoKeys} from '../dist/psdResources.js';
const userMask={colorSpace:{r:255,g:0,b:0},opacity:50/255};
function fixture(depth){const image={width:2,height:1,data:Float32Array.from([depth===32?510:32767/257,32768/257,32769/257,255,10,11,12,255])};return writeHighPsd({width:2,height:1,userMask,imageData:image,children:[{id:19,name:'fish',effectsOpen:true,layerColor:'blue',referencePoint:{x:1.25,y:2.5},imageData:image}]},depth);}
for(const depth of [8,16,32])test(`${depth}-bit display metadata survives editing, undo, project/recovery and two PSD generations`,async()=>{
 const input=Buffer.from(fixture(depth)),result=importPsd(input,'display.psd');assert.deepEqual(result.blockers,[]);assert.deepEqual(result.warnings,[]);assert(result.layered);const original=result.layered.layers[0].bitmap.data.slice();input.fill(0);
 const restored=deserializeProject(serializeProject(result.layered));assert.deepEqual(restored.psdArchive,result.layered.psdArchive);assert.deepEqual(restored.layers[0].bitmap.data,original);
 const session={version:2,activeId:restored.id,documents:[{state:restored,dirty:true}]},encoded=await new RecoveryCodec().encode(session,new Set());assert.deepEqual((await decodeRecovery(encoded.session,encoded.chunks)).documents[0].state,restored);
 const d=new ImageDocument(restored),before=d.state;d.updateLayer(d.selected.id,{x:1,visible:false});let state=d.state;
 for(let i=0;i<2;i++){const out=exportPsd(state).bytes,p=readPsdMetadata(out);assert.equal(p.bitsPerChannel,depth);assert.deepEqual(p.userMask,userMask);assert.equal(p.children[0].effectsOpen,true);assert.equal(p.children[0].layerColor,'blue');assert.deepEqual(p.children[0].referencePoint,{x:1.25,y:2.5});const next=importPsd(out,'again.psd');assert.deepEqual(next.blockers,[]);state=next.layered;assert.equal(state.layers[0].visible,false);assert.equal(state.layers[0].x,1);assert.deepEqual(state.layers[0].bitmap.data,original);}
 d.history.undo();assert.equal(d.state,before);d.dispose();
});
test('high-depth archive preserves pattern blocks but still rejects unknown features',()=>{
 const bytes=fixture(16),s=psdSections(bytes),append=key=>{const block=new Uint8Array(12);block.set(new TextEncoder().encode('8BIM'+key));const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,s.layers.end-s.layers.data+block.length);return concatBytes([bytes.subarray(0,s.layers.start),length,bytes.subarray(s.layers.data,s.layers.end),block,bytes.subarray(s.composite)]);};
 let result=importPsd(append('Pat2'),'patterns.psd');assert(result.layered,result.blockers.join());for(let i=0;i<2;i++){const out=exportPsd(result.layered).bytes;assert(additionalInfoKeys(out).includes('Pat2'));result=importPsd(out,'again.psd');assert(result.layered,result.blockers.join());}
 assert(importPsd(append('zzzz'),'unknown.psd').blockers.some(b=>b.includes('zzzz')));
});
