import test from 'node:test';
import assert from 'node:assert/strict';
import {readPsd,writePsdUint8Array} from 'ag-psd';
import {ImageDocument,makeLayer,validateState} from '../dist/document.js';
import {convertSmart} from '../dist/smartObject.js';
import {filterStackBitmap,liveBitmap,blendIfWeight,validateSmartFilters} from '../dist/liveEffects.js';
import {effectiveMaskWeight,rawMaskWeight} from '../dist/maskEffects.js';
import {maskStrokeState,maskFromStroke} from '../dist/maskTools.js';
import {filterBitmap} from '../dist/filters.js';
import {compositeState} from '../dist/compositor.js';
import {serializeProject,deserializeProject} from '../dist/projectFile.js';
import {RecoveryCodec,decodeRecovery} from '../dist/recoveryCodec.js';
import {exportPsd,importPsd} from '../dist/psdAdapter.js';
import {readBlendIf,writeBlendIf} from '../dist/psdLiveEffects.js';
import {mergeLayers} from '../dist/dailyEditing.js';
import {ImageWorkspace} from '../dist/workspace.js';
import {operationClient} from '../../scripts/editor-e2e/operationWorkflow.mjs';
const bitmap=(w=4,h=3)=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%4===3?255:(Math.floor(i/4)*29+i%4*41)%256)});
const filter=(id,kind='invert',amount=100,patch={})=>({id,enabled:true,settings:{kind,amount},opacity:1,blend:'normal',...patch});
const mask=(patch={})=>({width:4,height:3,x:0,y:0,data:new Uint8Array(12).fill(255),disabled:false,defaultColor:0,...patch});
const rule=(patch={})=>({enabled:true,channel:'red',source:[0,0,255,255],underlying:[0,0,255,255],...patch});
const base=()=>{const d=ImageDocument.create('live',4,3);d.addLayer(makeLayer('source',bitmap()));convertSmart(d,d.selected.id);d.history.clear();return d;};
test('ordered filter stack is non destructive, reorderable, independently enabled and blended',()=>{
 const source=bitmap(),original=structuredClone(source),a=filter('a'),b=filter('b','brightness',30),ab=filterStackBitmap(source,[a,b]),ba=filterStackBitmap(source,[b,a]);assert.notDeepEqual(ab,ba);assert.deepEqual(ab,filterBitmap(filterBitmap(source,a.settings),b.settings));assert.deepEqual(source,original);
 assert.deepEqual(filterStackBitmap(source,[{...a,enabled:false},b]),filterBitmap(source,b.settings));assert.deepEqual(filterStackBitmap(source,[{...a,opacity:0}]),source);
 const half=filterStackBitmap(source,[{...a,opacity:.5}]);for(let i=0;i<half.data.length;i++)assert.equal(half.data[i],i%4===3?255:128);
 const multiply=filterStackBitmap(source,[{...a,blend:'multiply'}]);assert.equal(multiply.data[1],Math.round(41*(255-41)/255));
 assert.throws(()=>validateSmartFilters([a,a]));assert.throws(()=>validateSmartFilters(Array.from({length:17},(_,i)=>filter(String(i)))));
});
test('filter mask interpolates original and filtered color and alpha, respects offsets, density and disabled state',()=>{
 const d=base(),id=d.selected.id;d.setLiveEffects(id,{smartFilters:[filter('a')]});const source=d.selected.bitmap;d.setMask(id,mask({data:Uint8Array.from({length:12},(_,i)=>i%2?255:0)}),'filter');let out=liveBitmap(d.selected);assert.deepEqual(out.data.slice(0,4),source.data.slice(0,4));assert.equal(out.data[4],255-source.data[4]);
 d.setMask(id,{...d.selected.filterMask,density:0},'filter');assert.deepEqual(liveBitmap(d.selected),filterBitmap(source,{kind:'invert',amount:100}));
 d.setMask(id,mask({x:1,width:1,height:1,data:Uint8Array.of(255)}),'filter');out=liveBitmap(d.selected);assert.equal(out.data[0],source.data[0]);assert.equal(out.data[4],255-source.data[4]);d.dispose();
 const transparent={...makeLayer('edge',{width:2,height:1,data:Uint8ClampedArray.of(255,0,0,255,0,255,0,0)}),smartFilters:[filter('g','gaussian',1)],filterMask:mask({width:2,height:1,data:Uint8Array.of(0,128)})};out=liveBitmap(transparent);assert.deepEqual([...out.data.slice(0,4)],[255,0,0,255]);assert.deepEqual([...out.data.slice(4,7)],[255,0,0]);assert(out.data[7]>0&&out.data[7]<128);
});
test('mask feather matches Gaussian reference with exterior coverage; density never rewrites raw samples',()=>{
 const m=mask({width:1,height:1,data:Uint8Array.of(0),defaultColor:255,feather:1,density:.6}),k=Array.from({length:7},(_,i)=>Math.exp(-((i-3)**2)/2)),sum=k.reduce((a,b)=>a+b);assert(Math.abs(effectiveMaskWeight(m,0,0)-(1-.6/(sum*sum)))<1e-7);assert(Math.abs(effectiveMaskWeight(m,1,0)-(1-.6*Math.exp(-.5)/(sum*sum)))<1e-7);assert.equal(effectiveMaskWeight(m,10,0),1);assert.equal(rawMaskWeight(m,0,0),0);assert.equal(effectiveMaskWeight({...m,disabled:true},0,0),1);
 const d=base();d.setMask(d.selected.id,mask({data:new Uint8Array(12),density:.4,feather:1}),'filter');const original=d.selected,stroke=maskStrokeState(d.state,original.id,'filter').layers.at(-1);assert.equal(stroke.bitmap.data[0],0);const result=maskFromStroke(original,stroke,'filter');assert.equal(result.feather,1);assert.equal(result.density,.4);assert.deepEqual(result.data,original.filterMask.data);d.dispose();
});
test('Blend If has split ramps, underlying alpha and identity semantics',()=>{
 const b=[100,10,20,255],s=[50,90,80,255];assert.equal(blendIfWeight(rule(),s,0,b,0),1);assert.equal(blendIfWeight(rule({source:[0,100,200,255]}),s,0,b,0),.5);assert.equal(blendIfWeight(rule({underlying:[0,200,255,255]}),s,0,b,0),.5);assert.equal(blendIfWeight(rule({underlying:[0,200,255,255]}),s,0,[100,0,0,0],0),1);
 assert.equal(blendIfWeight(rule({source:[100,100,200,200]}),s,0,b,0),0);assert.equal(blendIfWeight(rule({enabled:false,source:[100,100,200,200]}),s,0,b,0),1);
 const d=base();d.setLiveEffects(d.selected.id,{blendIf:rule({source:[100,100,255,255]})});assert.equal(compositeState(d.state).data[3],0);d.dispose();
});
test('history and rasterize preserve appearance; duplicate and new effect metadata own their data',()=>{
 const d=base(),id=d.selected.id,filters=[filter('a')];d.setLiveEffects(id,{smartFilters:filters});filters[0].enabled=false;assert.equal(d.selected.smartFilters[0].enabled,true);assert(Object.isFrozen(d.selected.smartFilters[0].settings));d.setMask(id,mask({density:.5,feather:1}),'filter');const before=d.state,image=compositeState(before);d.rasterizeSelected();assert.equal(d.selected.content,undefined);assert.equal(d.selected.smartFilters,undefined);assert.equal(d.selected.filterMask,undefined);assert.deepEqual(compositeState(d.state),image);d.history.undo();assert.equal(d.state,before);d.history.redo();assert.deepEqual(compositeState(d.state),image);d.history.undo();d.duplicateSelected();assert.notEqual(d.selected.filterMask.data,before.layers.at(-1).filterMask.data);assert.deepEqual(d.selected.smartFilters,before.layers.at(-1).smartFilters);d.dispose();
});
test('project v7 and recovery v8 preserve live metadata, filter mask chunks and reject older schemas',async()=>{
 const d=base(),id=d.selected.id;d.setLiveEffects(id,{smartFilters:[filter('a')],blendIf:rule({source:[10,30,220,240]})});d.setMask(id,mask({density:.7,feather:1}),'filter');d.setMask(id,mask({density:.8,feather:2}));const text=serializeProject(d.state),parsed=JSON.parse(text);assert.equal(parsed.version,7);assert.deepEqual(deserializeProject(text).layers,d.state.layers);parsed.version=6;assert.throws(()=>deserializeProject(JSON.stringify(parsed)),/版本 7/);
 const session={version:2,activeId:d.identity.id,documents:[{state:d.state,dirty:true}]},stored=await new RecoveryCodec().encode(session,new Set());assert.equal(stored.session.version,8);assert.deepEqual(await decodeRecovery(stored.session,stored.chunks),session);await assert.rejects(()=>decodeRecovery({...stored.session,version:7},stored.chunks));d.dispose();
});
for(const channel of ['gray','red','green','blue'])test('native PSD preserves '+channel+' Blend If and mask density/feather',()=>{
 const d=base();d.setLiveEffects(d.selected.id,{blendIf:rule({channel,source:[10,40,200,240],underlying:[0,30,240,255]})});d.setMask(d.selected.id,mask({data:Uint8Array.from({length:12},(_,i)=>i*20),density:128/255,feather:.7}));const bytes=exportPsd(d.state).bytes,raw=readPsd(bytes,{useImageData:true,skipThumbnail:true}),layer=raw.children.at(-1);assert(layer.blendingRanges);assert.equal(layer.mask.userMaskDensity,128/255);assert.equal(layer.mask.userMaskFeather,.7);const reopened=importPsd(bytes,'live.psd');assert(reopened.layered,reopened.blockers.join());assert.deepEqual(reopened.layered.layers.at(-1).blendIf,d.selected.blendIf);assert.deepEqual(compositeState(reopened.layered),compositeState(d.state));d.dispose();
});
test('PSD rejects unsupported multi-channel ranges; smart filters require explicit flattened copy',()=>{
 const range=writeBlendIf(rule({source:[10,20,240,255]}));range.blendingRanges.compositeGrayBlendSource=[1,2,250,255];assert.throws(()=>readBlendIf(range),/不能丢弃/);
 const d=base();d.setLiveEffects(d.selected.id,{smartFilters:[filter('a')]});d.setMask(d.selected.id,mask(),'filter');assert.throws(()=>exportPsd(d.state),/确认栅格化/);const reopened=importPsd(exportPsd(d.state,true).bytes,'flat.psd');assert(reopened.layered,reopened.blockers.join());assert.equal(reopened.layered.layers.length,1);assert.deepEqual(compositeState(reopened.layered),compositeState(d.state));d.dispose();
});
test('invalid states and backdrop-sensitive subset merging reject atomically',()=>{
 const d=base(),id=d.selected.id,before=d.state;for(const patch of [{smartFilters:[filter('a','gaussian',NaN)]},{blendIf:rule({source:[20,10,240,255]})}]){assert.throws(()=>d.setLiveEffects(id,patch));assert.equal(d.state,before);}assert.throws(()=>d.setMask(id,mask({density:2})));assert.throws(()=>d.setMask(id,mask({feather:65})));for(const key of ['smartFilters','filterMask','blendIf'])assert.throws(()=>validateState({...d.state,layers:[{...d.selected,[key]:null}]}));d.setLiveEffects(id,{blendIf:rule({underlying:[0,30,240,255]})});assert.throws(()=>mergeLayers(d,[id]));d.dispose();
});
test('public API supports filters, both masks, raw painting, query, undo and export with failed request rollback',async()=>{
 const w=new ImageWorkspace();await w.start();try{const opened=await operationClient(w.platform)('image.document.create',{name:'effects api',width:4,height:3}),client=operationClient(w.platform,opened.documentId),call=(id,p)=>client('image.'+id,p),d=w.active,id=d.selected.id;await call('pixels.fill',{layerId:id,color:'#4080c0'});await call('smart.convert',{layerId:id});await call('smart.filters',{layerId:id,filters:[filter('a')]});await call('mask.update',{layerId:id,target:'filter',action:'fromSelection'});await call('mask.settings',{layerId:id,target:'filter',density:.6,feather:1});const raw=d.selected.bitmap.data.slice();await call('pixels.fill',{layerId:id,target:'filterMask',color:'#000000'});assert.equal(d.selected.filterMask.data[0],0);assert.equal(d.selected.filterMask.density,.6);assert.deepEqual(d.selected.bitmap.data,raw);await call('history.undo');assert.equal(d.selected.filterMask.data[0],255);await call('pixels.stroke',{layerId:id,target:'filterMask',points:[{x:1,y:1}],color:'#000000',size:1});assert(d.selected.filterMask.data.some(v=>v<255));await call('mask.update',{layerId:id,action:'fromSelection'});await call('mask.settings',{layerId:id,density:.4,feather:.5});await call('layer.blend-if',{layerId:id,rule:rule({source:[0,30,240,255]})});let q=await call('document.query');assert.equal(q.layers[0].filterMask.feather,1);assert.equal(q.layers[0].mask.density,.4);assert.equal(q.layers[0].smartFilters[0].id,'a');assert.equal(q.layers[0].blendIf.source[1],30);
 const state=d.state,history=d.history.snapshot();const fail=await w.platform.operations.execute({apiVersion:'1',requestId:'bad-live',operation:'image.layer.blend-if',documentId:d.identity.id,expectedRevision:d.revision,params:{layerId:id,rule:rule({source:[50,10,255,255]})}});assert.equal(fail.status,'failed');assert.equal(d.state,state);assert.deepEqual(d.history.snapshot(),history);const exported=await call('document.export',{format:'project'});assert.equal(JSON.parse(new TextDecoder().decode(w.platform.resources.read(exported.resourceId))).version,7);await call('layer.blend-if',{layerId:id,remove:true});assert.equal(d.selected.blendIf,undefined);
 }finally{await w.dispose();}
});
test('nested offsets and clipping combine live effects without leaking outside base alpha',()=>{
 const source={width:2,height:1,data:Uint8ClampedArray.of(100,20,30,255,100,20,30,0)},baseLayer={...makeLayer('base',source),smartFilters:[filter('a')],filterMask:mask({width:2,height:1,data:Uint8Array.of(255,255)})};const clip={...makeLayer('clip',{width:2,height:1,data:Uint8ClampedArray.of(0,200,0,255,0,200,0,255)}),clipping:true,blendIf:rule({channel:'green',source:[0,100,255,255]})};const d=base(),state={...d.state,width:4,height:3,layers:[{...makeLayer('group',null,'group'),x:1,y:1,children:[baseLayer,clip]}]};const out=compositeState(state);assert.deepEqual([...out.data.slice(20,24)],[0,200,0,255]);assert.equal(out.data[27],0);assert.equal(out.data[3],0);d.dispose();
});
test('smart source replace reruns stack; locked layers and stale live commits reject',async()=>{
 const {replaceSmart}=await import('../dist/smartObject.js');const d=base(),id=d.selected.id;d.setLiveEffects(id,{smartFilters:[filter('a')]});const previous=d.state;replaceSmart(d,id,{width:4,height:3,data:new Uint8ClampedArray(48).fill(255)},'white');assert.deepEqual([...liveBitmap(d.selected).data.slice(0,4)],[0,0,0,255]);assert.equal(d.selected.smartFilters[0].id,'a');d.history.undo();assert.equal(d.state,previous);
 const before=d.state;assert.throws(()=>d.commitLayers('stale',d.state.layers,[id],d.selectedIds,d.revision-1));assert.equal(d.state,before);d.updateLayer(id,{locked:true});const locked=d.state;assert.throws(()=>d.setLiveEffects(id,{smartFilters:[]}));assert.throws(()=>d.setMask(id,mask(),'filter'));assert.equal(d.state,locked);d.dispose();
});
