import test from 'node:test';
import assert from 'node:assert/strict';
import {readPsd} from 'ag-psd';
import {resizeBitmap} from '../dist/resampling.js';
import {transformBitmap} from '../dist/pixelTools.js';
import {filterBitmap} from '../dist/filters.js';
import {bitmapHistogram} from '../dist/histogram.js';
import {adjustmentBitmap} from '../dist/nonDestructiveRender.js';
import {validateContent} from '../dist/layerFeatures.js';
import {ImageDocument,makeLayer} from '../dist/document.js';
import {transformedLayer,commitTransform} from '../dist/freeTransform.js';
import {convertSmart,replaceSmart} from '../dist/smartObject.js';
import {serializeProject,deserializeProject} from '../dist/projectFile.js';
import {RecoveryCodec,decodeRecovery} from '../dist/recoveryCodec.js';
import {exportPsd,importPsd} from '../dist/psdAdapter.js';
import {compositeState} from '../dist/compositor.js';
import {batchBitmap} from '../dist/production.js';
import {ImageWorkspace} from '../dist/workspace.js';
import {operationClient} from '../../scripts/editor-e2e/operationWorkflow.mjs';
const image=(w,h,fn)=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>fn(Math.floor(i/4)%w,Math.floor(i/4/w))[i%4])});
const identity={black:0,white:255,gamma:1,outputBlack:0,outputWhite:255};
const curve=[{input:0,output:0},{input:128,output:180},{input:255,output:255}];
const base=()=>{const d=ImageDocument.create('quality',8,8);d.addLayer(makeLayer('source',image(8,8,(x,y)=>[x*30,y*30,100,255])));d.history.clear();return d;};
for(const method of ['bilinear','bicubic','lanczos'])test(method+' preserves constants, alpha and exact quarter turns; downsizing suppresses aliasing',()=>{
 const source=image(16,16,(x,y)=>[(x+y)%2?255:0,(x+y)%2?255:0,(x+y)%2?255:0,255]);const reduced=resizeBitmap(source,2,2,method);for(let i=0;i<reduced.data.length;i+=4)assert(Math.abs(reduced.data[i]-127.5)<12,`${method}: ${reduced.data[i]}`);
 const solid=image(4,4,()=>[80,130,190,123]);assert.deepEqual(resizeBitmap(solid,7,3,method),image(7,3,()=>[80,130,190,123]));assert.deepEqual(resizeBitmap(source,16,16,method),source);
 const alpha=image(2,1,x=>x?[0,255,0,0]:[255,0,0,255]),scaled=resizeBitmap(alpha,9,1,method);for(let i=0;i<scaled.data.length;i+=4)if(scaled.data[i+3])assert.deepEqual([...scaled.data.slice(i,i+3)],[255,0,0]);
 const turned=transformBitmap(alpha,2,1,90,false,false,method);assert.equal(turned.width,1);assert.deepEqual([...turned.data],[255,0,0,255,0,255,0,0]);
 const rotated=transformBitmap(solid,4,4,33,false,false,method);assert(rotated.data.some((v,i)=>i%4===3&&v>0&&v<123));assert.deepEqual(solid,image(4,4,()=>[80,130,190,123]));
});
test('nearest remains explicit; invalid sampling and dimensions reject',()=>{
 const source=image(2,1,x=>[x*255,20,30,x?0:255]);assert.deepEqual([...resizeBitmap(source,4,1,'nearest').data],[0,20,30,255,0,20,30,255,255,20,30,0,255,20,30,0]);assert.throws(()=>resizeBitmap(source,3,1,'unknown'));assert.throws(()=>transformBitmap(source,8192,8192,0));
});
test('Gaussian matches a normalized 2D reference, including hidden RGB and partial alpha',()=>{
 const b=image(5,4,(x,y)=>[x*45,y*60,210,(x+y)%3?123:0]),before=b.data.slice(),sigma=.7,r=3,k=Array.from({length:7},(_,i)=>Math.exp(-((i-r)**2)/(2*sigma*sigma))),sum=k.reduce((a,b)=>a+b);const actual=filterBitmap(b,{kind:'gaussian',amount:sigma});
 for(let y=0;y<4;y++)for(let x=0;x<5;x++){let a=0,colors=[0,0,0];for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const i=(Math.max(0,Math.min(3,y+dy))*5+Math.max(0,Math.min(4,x+dx)))*4,w=k[dx+r]*k[dy+r]/sum**2,alpha=b.data[i+3];a+=w*alpha;for(let c=0;c<3;c++)colors[c]+=w*alpha*b.data[i+c];}const p=(y*5+x)*4;assert(Math.abs(actual.data[p+3]-a)<=.51);for(let c=0;c<3;c++)assert(Math.abs(actual.data[p+c]-colors[c]/a)<=.51);}
 assert.deepEqual(b.data,before);const halo=filterBitmap(image(3,1,x=>x===1?[255,0,0,255]:[0,255,0,0]),{kind:'gaussian',amount:1});for(let i=0;i<12;i+=4)assert.deepEqual([...halo.data.slice(i,i+3)],[255,0,0]);
});
test('USM strength and threshold control detail without changing alpha or zero-strength pixels',()=>{
 const b=image(7,1,x=>[x===3?160:100,120,90,x===0?0:123]);const sharp=filterBitmap(b,{kind:'usm',amount:100,radius:1,threshold:5});assert(sharp.data[12]>160);assert(sharp.data[8]<100);for(let i=0;i<b.data.length;i++)if(i%4===3)assert.equal(sharp.data[i],b.data[i]);assert.deepEqual(filterBitmap(b,{kind:'usm',amount:0}).data,b.data);assert.deepEqual(filterBitmap(b,{kind:'usm',amount:100,threshold:255}).data,b.data);
 for(const settings of [{kind:'usm',amount:100,radius:0},{kind:'usm',amount:501},{kind:'usm',amount:50,threshold:1.5},{kind:'gaussian',amount:NaN},{kind:'gaussian',amount:1,radius:2},{kind:'blur',amount:.5}])assert.throws(()=>filterBitmap(b,settings));
});
test('histogram has 256 alpha/selection weighted bins and excludes transparent pixels',()=>{
 const b=image(3,1,x=>[[255,0,0,255],[0,255,0,128],[0,0,255,0]][x]),h=bitmapHistogram(b);assert.equal(h.red.length,256);assert.equal(h.pixels,2);assert.equal(h.red[255],1);assert.equal(h.green[255],128/255);assert.equal(h.blue[255],0);assert(Math.abs(h.weight-1-128/255)<1e-9);assert.equal(h.median,54);
 const selection={x:1,y:0,width:2,height:1,mask:Uint8Array.of(128,255)},selected=bitmapHistogram(b,selection);assert.equal(selected.pixels,1);assert.equal(selected.weight,(128/255)**2);assert.equal(selected.mean,182);assert.equal(selected.deviation,0);assert.equal(bitmapHistogram(image(1,1,()=>[255,255,255,0])).weight,0);
});
for(const filter of ['levels','curves'])test(filter+' independent channels persist through history/project/recovery/native PSD',async()=>{
 const d=base(),adjustment=filter==='levels'?{type:'adjustment',filter,amount:100,levels:identity,channels:{red:{levels:{...identity,black:30,gamma:1.2}},blue:{levels:{...identity,outputWhite:150}}}}:{type:'adjustment',filter,amount:100,curves:[{input:0,output:0},{input:255,output:255}],channels:{red:{curves:curve},blue:{curves:[{input:0,output:255},{input:255,output:0}]}}};
 const source=d.selected.bitmap,adjusted=adjustmentBitmap(source,adjustment);assert.equal(adjusted.data[5],source.data[5]);assert.notEqual(adjusted.data[6],source.data[6]);d.addLayer({...makeLayer(filter),kind:'adjustment',content:adjustment},false);const snapshot=d.state,expected=structuredClone(d.selected.content);assert(Object.isFrozen(d.selected.content.channels.red));d.history.undo();assert.equal(d.state.layers.length,2);d.history.redo();assert.equal(d.state,snapshot);
 const text=serializeProject(snapshot);assert.equal(JSON.parse(text).version,6);assert.deepEqual(deserializeProject(text).layers,snapshot.layers);const old=JSON.parse(text);old.version=5;assert.throws(()=>deserializeProject(JSON.stringify(old)),/版本 6/);
 const session={version:2,activeId:d.identity.id,documents:[{state:snapshot,dirty:true}]},stored=await new RecoveryCodec().encode(session,new Set());assert.equal(stored.session.version,7);assert.deepEqual(await decodeRecovery(stored.session,stored.chunks),session);
 const bytes=exportPsd(snapshot).bytes,raw=readPsd(bytes,{useImageData:true,skipThumbnail:true});assert(raw.children.at(-1).adjustment.red);assert(raw.children.at(-1).adjustment.blue);const reopened=importPsd(bytes,'channels.psd');assert(reopened.layered,reopened.blockers.join());assert.deepEqual(reopened.layered.layers.at(-1).content,expected);assert.deepEqual(compositeState(reopened.layered),compositeState(snapshot));assert(importPsd(exportPsd(reopened.layered).bytes,'again.psd').layered);d.dispose();
});
test('composite LUT precedes per-channel LUT; invalid channels reject without silent dropping',()=>{
 const c={type:'adjustment',filter:'curves',amount:100,curves:[{input:0,output:0},{input:255,output:128}],channels:{red:{curves:[{input:0,output:255},{input:255,output:0}]}}};assert.deepEqual([...adjustmentBitmap(image(1,1,()=>[100,100,100,123]),c).data],[205,50,50,123]);
 for(const channels of [{alpha:{}},{red:{levels:identity}},{red:{curves:[{input:0,output:0}]}},[],null])assert.throws(()=>validateContent({...c,channels}));
});
test('smart sampling survives source replace, project and recovery; old smart data keeps nearest semantics',async()=>{
 const d=base(),id=d.selected.id,original=d.selected.bitmap;convertSmart(d,id);commitTransform(d,transformedLayer(d.state,id,{width:3,height:3,angle:0,dx:0,dy:0,resampling:'lanczos'}));assert.equal(d.selected.content.transform.resampling,'lanczos');assert.deepEqual(d.selected.bitmap,resizeBitmap(original,3,3,'lanczos'));assert.equal(deserializeProject(serializeProject(d.state)).layers.at(-1).content.transform.resampling,'lanczos');replaceSmart(d,id,original,'replaced');assert.deepEqual(d.selected.bitmap,resizeBitmap(original,3,3,'lanczos'));d.history.undo();d.history.undo();assert.deepEqual(d.selected.bitmap,original);d.dispose();
});
test('public quality commands support undo, filters discovery, selection histogram and batch recipes',async()=>{
 const w=new ImageWorkspace();await w.start();try{const opened=await operationClient(w.platform)('image.document.create',{name:'quality api',width:8,height:8}),call=operationClient(w.platform,opened.documentId),d=w.active,id=d.selected.id;await call('image.pixels.fill',{layerId:id,color:'#4080c0'});
 assert((await call('image.filters.query')).some(f=>f.kind==='gaussian'));const revision=d.revision,h=await call('image.histogram.query');assert.equal(h.pixels,64);assert.equal(h.red[64],64);assert.equal(d.revision,revision);
 const before=serializeProject(d.state);await call('image.filter.apply',{layerId:id,kind:'gaussian',amount:.8});await call('image.history.undo');assert.equal(serializeProject(d.state),before);await call('image.layer.transform',{layerId:id,width:4,height:4,resampling:'lanczos'});assert.equal(d.selected.bitmap.width,4);await call('image.history.undo');
 const content={type:'adjustment',filter:'levels',amount:100,levels:identity,channels:{red:{levels:{...identity,outputWhite:128}}}};await call('image.content.create',{name:'channels',content});assert.equal(d.selected.content.channels.red.levels.outputWhite,128);await call('image.history.undo');
 const state=d.state,history=d.history.snapshot();const invalid=await w.platform.operations.execute({apiVersion:'1',requestId:'bad-channel',operation:'image.content.create',documentId:d.identity.id,expectedRevision:d.revision,params:{name:'bad',content:{...content,channels:{red:{levels:{...identity,gamma:0}}}}}});assert.equal(invalid.status,'failed');assert.equal(d.state,state);assert.deepEqual(d.history.snapshot(),history);
 const exported=await call('image.document.export',{format:'project'}),batch=await operationClient(w.platform)('image.batch.run',{inputs:[{resourceId:exported.resourceId,name:'quality',format:'project'}],steps:[{type:'fit',width:4,height:4,resampling:'bilinear'},{type:'filter',kind:'gaussian',amount:.8},{type:'filter',kind:'usm',amount:100,radius:1,threshold:3}],format:'project'});assert(batch[0].resourceId,batch[0].error);assert.equal(deserializeProject(new TextDecoder().decode(w.platform.resources.read(batch[0].resourceId))).width,4);
 assert.throws(()=>batchBitmap(d.state,[{type:'fit',width:4,height:4,resampling:'bad'}]));
 }finally{await w.dispose();}
});
