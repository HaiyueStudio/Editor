import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeIcc,colorDisplay} from '../dist/iccEngine.js';
import {earlyPsdPreview} from '../dist/earlyPsdPreview.js';
import {largePsd} from './large-fixture.mjs';
import {psdSections} from '../dist/psdResources.js';
import {workerTask} from '../dist/workerTask.js';
import {TiledStrokeSession,incrementalStrokeFits} from '../dist/tiledStrokeSession.js';
import {PixelStroke} from '../dist/pixelTools.js';
import {cmykBitmap} from '../dist/cmyk.js';
import {CmykStroke} from '../dist/cmykEditing.js';
import {makeLayer,ImageDocument} from '../dist/document.js';
import {diskPager} from '../dist/diskPager.js';
import {spillBitmap,pagedPixelStats} from '../dist/pagedPixels.js';
import {bitmapRegionAsync} from '../dist/diskCompositor.js';
import {previewMatrix,prepareTransformPreview} from '../dist/transformPreview.js';
import {rememberRasterPreview} from '../dist/rasterPreviews.js';
import {profileResource} from '../dist/colorManagement.js';
import {builtinIcc} from '../dist/iccWorkflow.js';
await initializeIcc(new Uint8Array(readFileSync(new URL('../../node_modules/lcms-wasm/dist/lcms.wasm',import.meta.url))));
const pages=new Map();diskPager.store.read=async k=>pages.get(k);diskPager.store.write=async(k,b)=>pages.set(k,b.slice());
const source=bytes=>({size:bytes.length,reads:[],async read(at,n,signal){signal?.throwIfAborted();this.reads.push([at,n]);if(at<0||at+n>bytes.length)throw Error('truncated');return bytes.slice(at,at+n);}});
const read=b=>bitmapRegionAsync(b,{x:0,y:0,width:b.width,height:b.height});
test('early PSD preview seeks past all layer pixels and does not write disk pages',async()=>{
 const bytes=new Uint8Array(largePsd(9001,1900)),s=source(bytes),sections=psdSections(bytes),writes=diskPager.stats().writes,preview=await earlyPsdPreview(s);
 assert.equal(preview.width,512);assert.deepEqual(Array.from(preview.data.slice(0,4)),[40,130,210,255]);assert(s.reads.every(([at])=>at<=sections.layers.start||at>=sections.composite));assert.equal(diskPager.stats().writes,writes);
 assert.equal(await earlyPsdPreview(source(new Uint8Array(7))),undefined);const cancel=new AbortController();cancel.abort();await assert.rejects(()=>earlyPsdPreview(s,cancel.signal),{name:'AbortError'});
});
test('early preview converts embedded ICC and skips placeholder merged data',async()=>{
 const bytes=new Uint8Array(largePsd(19,13)),icc=builtinIcc('display-p3'),resource=profileResource(icc),size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,resource.length);
 const tagged=new Uint8Array(Buffer.concat([bytes.slice(0,30),size,resource,bytes.slice(34)])),preview=await earlyPsdPreview(source(tagged)),expected=colorDisplay({width:1,height:1,data:new Uint8ClampedArray([40,130,210,255])},{psdOrigin:{resources:resource}});
 assert.deepEqual(preview.data.slice(0,4),expected.data);
 const block=Buffer.alloc(18);block.write('8BIM');block.writeUInt16BE(1057,4);block.writeUInt32BE(5,8);block.writeUInt32BE(1,12);const n=Buffer.alloc(4);n.writeUInt32BE(block.length);assert.equal(await earlyPsdPreview(source(new Uint8Array(Buffer.concat([bytes.slice(0,30),n,block,bytes.slice(34)])))),undefined);
});
test('Worker preview is an intermediate event; cancel rejects and ignores late completion',async()=>{
 let terminated=0,preview=0;const w={postMessage(){},terminate(){terminated++;}},c=new AbortController();let done=false;
 const p=workerTask(w,{}, {signal:c.signal,preview(){preview++;}}).then(()=>{done=true;},e=>e),handler=w.onmessage;
 handler({data:{kind:'preview',bitmap:{width:1,height:1,data:new Uint8ClampedArray(4)}}});await Promise.resolve();assert.equal(preview,1);assert.equal(done,false);c.abort();handler({data:{ok:true,value:17}});assert.equal((await p).name,'AbortError');assert.equal(done,false);assert.equal(terminated,1);
 const ignored={postMessage(){},terminate(){}};const ordinary=workerTask(ignored,{});ignored.onmessage({data:{kind:'preview',bitmap:{}}});ignored.onmessage({data:{ok:true,value:42}});assert.equal(await ordinary,42);
});
function state(depth=8,ink=false,lock=false){const width=779,height=19,data=(depth===8?Uint8ClampedArray:Float32Array).from({length:width*height*4},(_,i)=>i%4===3?i%7?255:123:(i*31)%255+(depth===32?77.125:.125)),cmyk=ink?Float32Array.from(data,(_,i)=>i%80+.125):undefined,b=cmyk?cmykBitmap(width,height,cmyk,Float32Array.from({length:width*height},(_,i)=>data[i*4+3]),depth):{width,height,depth,data},l={...makeLayer('paint',b),...(lock?{locks:{transparency:true}}:{})};return {id:'stroke',name:'stroke',width,height,bitDepth:depth,colorMode:ink?'cmyk':'rgb',layers:[l],selectedId:l.id,revision:1};}
const points=[{x:240,y:8,pressure:.2},{x:272,y:12,pressure:.8},{x:501,y:6,pressure:1},{x:240,y:8,pressure:.3},{x:517,y:8,pressure:.6}],settings={size:13,opacity:.65,color:[230,25,110],erase:false,hardness:.35,pressure:'both',spacing:.12,scatter:.3,smoothing:.15,flow:.32,texture:.3};
for(const [depth,ink,lock,erase] of [[8,false,false,false],[16,false,false,false],[32,false,false,false],[8,false,true,false],[16,false,false,true],[8,true,false,false],[16,true,true,false],[16,true,false,true]])test(`incremental brush equals one-shot: depth=${depth}, CMYK=${ink}, lock=${lock}, erase=${erase}`,async()=>{
 const s=state(depth,ink,lock),v={...settings,erase,...(ink?{ink:{ink:[12.125,30.5,50,70],channels:[0,3],opacity:.65,erase}}:{})};
 const expected=ink?new CmykStroke(s,s.selectedId,v.size,v.ink,v):new PixelStroke(s,s.selectedId,v.size,v.opacity,v.color,v.erase,v);for(const p of points)expected.point(p);
 await spillBitmap(s.layers[0].bitmap);const before=pagedPixelStats().materializations,session=new TiledStrokeSession(s,s.selectedId,v);
 const first=await session.update(points.slice(0,2)),last=await session.update(points),again=await session.update(points);assert.equal(again,last);assert.equal(session.stats().points,points.length);assert(session.stats().tileEdits<=6);assert.equal(last.bitmap.pages.tiles[3],s.layers[0].bitmap.pages.tiles[3]);
 const actual=await read(last.bitmap);for(let i=0;i<actual.data.length;i++)assert.equal(actual.data[i],expected.layer.bitmap.data[i],'RGBA sample '+i);if(ink)for(let i=0;i<actual.cmyk.length;i++)assert.equal(actual.cmyk[i],expected.layer.bitmap.cmyk[i],'CMYK sample '+i);assert.equal(pagedPixelStats().materializations,before);assert.notEqual(first.bitmap,last.bitmap);
 const d=new ImageDocument(s);d.replaceLayerPixels(last.id,last,'stroke',s.revision);d.history.undo();assert.equal(d.selected.bitmap,s.layers[0].bitmap);d.history.redo();assert.equal(d.selected.bitmap,last.bitmap);session.cancel();await assert.rejects(()=>session.update([...points,{x:1,y:1}]),{name:'AbortError'});
});
test('stroke snapshots remain immutable after another batch; canceled output cannot publish',async()=>{const s=state(),session=new TiledStrokeSession(s,s.selectedId,settings),first=await session.update(points.slice(0,2)),pixels=(await read(first.bitmap)).data.slice();await session.update(points);assert.deepEqual((await read(first.bitmap)).data,pixels);const stop=new TiledStrokeSession(s,s.selectedId,settings),job=stop.update(points);stop.cancel();await assert.rejects(()=>job,{name:'AbortError'});assert.equal(s.revision,1);});
test('empty 20k canvas shares blank pages; growing layers retain off-canvas source pixels',async()=>{
 const empty=makeLayer('empty'),s={id:'empty',name:'empty',width:20000,height:12000,layers:[empty],selectedId:empty.id,revision:1},writes=diskPager.stats().writes,session=new TiledStrokeSession(s,empty.id,settings),l=await session.update([{x:100,y:100}]);
 assert(diskPager.stats().writes-writes<=6);assert.equal(l.bitmap.width,20000);assert.equal(l.bitmap.height,12000);assert.equal(l.bitmap.pages.tiles[2],l.bitmap.pages.tiles[3]);assert.equal((await bitmapRegionAsync(l.bitmap,{x:19999,y:11999,width:1,height:1})).data[3],0);session.cancel();
 const off=state();off.width=30000;off.layers[0]={...off.layers[0],x:-1};assert.equal(incrementalStrokeFits(off,off.selectedId),false);
 const original=state();original.layers[0]={...original.layers[0],x:-13,y:-2};const v={...settings,flow:1},expected=new PixelStroke(original,original.selectedId,v.size,v.opacity,v.color,false,v);for(const p of points)expected.point(p);await spillBitmap(original.layers[0].bitmap);const growing=new TiledStrokeSession(original,original.selectedId,v);await growing.update(points.slice(0,2));const next=await growing.update(points);assert.equal(next.x,-13);assert.equal(next.y,-2);const actual=await read(next.bitmap);for(let i=0;i<actual.data.length;i++)assert.equal(actual.data[i],expected.layer.bitmap.data[i],'expanded sample '+i);growing.cancel();
});
test('weighted selection holes skip empty tiles and retain stroke continuity',async()=>{
 const s=state(),mask=Uint8Array.from({length:s.width*s.height},(_,i)=>i%s.width>=256&&i%s.width<512?0:i%3?123:255);s.selection={x:0,y:0,width:s.width,height:s.height,mask};
 const v={...settings,smoothing:0,scatter:0},expected=new PixelStroke(s,s.selectedId,v.size,v.opacity,v.color,false,v);for(const p of points)expected.point(p);await spillBitmap(s.layers[0].bitmap);const session=new TiledStrokeSession(s,s.selectedId,v);await session.update(points.slice(0,3));const layer=await session.update(points),actual=await read(layer.bitmap);for(let i=0;i<actual.data.length;i++)assert.equal(actual.data[i],expected.layer.bitmap.data[i],'selection sample '+i);assert.equal(layer.bitmap.pages.tiles[1],s.layers[0].bitmap.pages.tiles[1]);session.cancel();
});
test('early RGBA merged preview un-mattes alpha and rejects extra/missing planes',async()=>{
 const bytes=new Uint8Array(44),v=new DataView(bytes.buffer);bytes.set([56,66,80,83]);v.setUint16(4,1);v.setUint16(12,4);v.setUint32(14,1);v.setUint32(18,1);v.setUint16(22,8);v.setUint16(24,3);bytes.set([177,152,127,128],40);
 const p=await earlyPsdPreview(source(bytes));assert.deepEqual(Array.from(p.data),[100,50,0,128]);assert.equal(await earlyPsdPreview(source(bytes.slice(0,43))),undefined);v.setUint16(12,5);assert.equal(await earlyPsdPreview(source(bytes)),undefined);
});
test('GPU proxy inverse maps rotated/flipped corners and keeps layer order, native source and revision',async()=>{
 const s=state(),b=s.layers[0].bitmap;rememberRasterPreview(b,[{width:78,height:2,data:new Uint8ClampedArray(78*2*4)}]);const upper={...makeLayer('above',{width:2,height:2,data:new Uint8ClampedArray(16)}),x:3,y:4,opacity:.5};s.layers.push(upper);const preview=await prepareTransformPreview(s,[s.selectedId],{x:b.width/2,y:b.height/2},false,new AbortController().signal);assert(preview);assert.deepEqual(preview.state.layers.map(l=>l.id),s.layers.map(l=>l.id));assert.equal(s.layers[0].bitmap,b);assert.equal(s.revision,1);
 const t={width:7,height:5,data:new Uint8ClampedArray(140)},m=previewMatrix({x:80,y:20},{x:80,y:120},{x:30,y:20},t,{x:200,y:200},{x:100,y:100});const map=(x,y)=>[m[0]*x+m[1]*y+m[2],m[4]*x+m[5]*y+m[6]];for(const [p,want] of [[[40,10],[0,0]],[[40,60],[7,0]],[[15,10],[0,5]]])map(...p).forEach((v,i)=>assert(Math.abs(v-want[i])<1e-5));
 assert.equal(await prepareTransformPreview({...s,bitDepth:32},[s.selectedId],{x:0,y:0},false,new AbortController().signal),undefined);
});
