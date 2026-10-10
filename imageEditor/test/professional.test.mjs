import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageDocument,makeLayer} from '../dist/document.js';
import {PixelStroke} from '../dist/pixelTools.js';
import {retouchSampler} from '../dist/retouch.js';
import {refineSelection} from '../dist/refineSelection.js';
import {selectionWeight,maskSelection} from '../dist/selection.js';
import {formatRange,rebaseRuns} from '../dist/richText.js';
import {validateContent} from '../dist/layerFeatures.js';
import {builtinProfile,parseRgbProfile,srgbProfileBytes,convertBitmapToSrgb,profileResource,convertedLayers,embeddedProfile} from '../dist/colorManagement.js';
import {serializeProject,deserializeProject} from '../dist/projectFile.js';
import {RecoveryCodec,decodeRecovery} from '../dist/recoveryCodec.js';
import {exportPsd,importPsd} from '../dist/psdAdapter.js';
import {readPsd} from 'ag-psd';
import {runBatch} from '../dist/production.js';
import {ImageWorkspace} from '../dist/workspace.js';
import {operationClient} from '../../scripts/editor-e2e/operationWorkflow.mjs';
const bitmap=(w,h,f=()=>[0,0,0,0])=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>f(Math.floor(i/4)%w,Math.floor(i/4/w))[i%4])});
const doc=(w=64,h=64,b=bitmap(w,h))=>{const d=ImageDocument.create('pro',w,h);d.addLayer(makeLayer('pixels',b));d.history.clear();return d;};
const rgba=(b,x,y)=>[...b.data.slice((y*b.width+x)*4,(y*b.width+x+1)*4)];
const path={type:'path',width:32,height:32,closed:true,fill:'#ff0000',stroke:'#ffffff',strokeWidth:2,fillRule:'evenodd',nodes:[{x:3.3,y:3.5,inX:3.3,inY:3.5,outX:20.3,outY:1.5},{x:28.1,y:28.5,inX:30.7,inY:16.6,outX:28.1,outY:28.5},{x:3.1,y:28.2,inX:3.1,inY:28.2,outX:1.2,outY:14.1}]};
const text={type:'text',text:'A海😀B',size:16,family:'sans-serif',bold:false,italic:false,align:'left',color:'#ffffff'};
test('soft falloff, pressure and selection multiply alpha; repeated samples do not build opacity',()=>{
 const d=doc(),id=d.selected.id,stroke=new PixelStroke(d.state,id,20,.5,[255,0,0],false,{hardness:0,pressure:'opacity'});stroke.point({x:30.5,y:30.5,pressure:.5});const before=stroke.layer.bitmap.data.slice();stroke.point({x:30.5,y:30.5,pressure:.5});assert.deepEqual(stroke.layer.bitmap.data,before);assert.equal(rgba(stroke.layer.bitmap,30,30)[3],64);assert.equal(rgba(stroke.layer.bitmap,35,30)[3],35);assert.equal(rgba(stroke.layer.bitmap,41,30)[3],0);assert.equal(d.selected.bitmap.data.some(Boolean),false);
 const pen=new PixelStroke(d.state,id,20,1,[255,0,0],false,{pressure:'size'});pen.point({x:30.5,y:30.5,pressure:0});assert(!pen.changed);pen.point({x:30.5,y:30.5,pressure:.5});assert.equal(rgba(pen.layer.bitmap,36,30)[3],0);assert.throws(()=>pen.point({x:0,y:0,pressure:2}));d.dispose();
});
test('large canvas small mark allocates only touched coverage tiles and undo stores exact pixels',()=>{
 const d=doc(4096,4096),s=new PixelStroke(d.state,d.selected.id,20,1,[8,9,10],false,{hardness:.5});s.point({x:100,y:100});assert.equal(s.coverageBytes,16384);const before=d.state;d.replaceLayerPixels(d.selected.id,s.layer,'soft',d.revision,s.changedBounds);assert(rgba(d.selected.bitmap,100,100)[3]>0);d.history.undo();assert.deepEqual(d.selected.bitmap,before.layers.at(-1).bitmap);d.dispose();
});
test('clone source stays immutable across overlap, source bounds and group coordinates',()=>{
 const d=doc(64,32,bitmap(64,32,(x)=>[x*3,20,30,255])),id=d.selected.id,sample=retouchSampler(d.state,id,id,{x:-10,y:0},'clone'),s=new PixelStroke(d.state,id,1,1,[0,0,0],false,{sample});s.point({x:20.5,y:10.5});s.point({x:40.5,y:10.5});assert.deepEqual(rgba(s.layer.bitmap,40,10),[90,20,30,255]);assert.deepEqual(rgba(d.selected.bitmap,40,10),[120,20,30,255]);assert.equal(sample(0,0),undefined);d.dispose();
});
test('healing transfers source detail while matching destination local tone without changing alpha',()=>{
 const d=doc(64,32,bitmap(64,32,(x,y)=>[x<32?50+(x===16&&y===16?30:0):180,100,90,255])),id=d.selected.id,s=retouchSampler(d.state,id,id,{x:-32,y:0},'heal',4),p=s(48,16);assert(p[0]>200&&p[0]<215);assert.equal(p[3],255);assert.equal(rgba(d.selected.bitmap,48,16)[0],180);d.dispose();
});
test('guided edge refinement keeps high contrast boundaries sharper than unguided smoothing',()=>{
 const b=bitmap(32,16,x=>x<16?[0,0,0,255]:[255,255,255,255]),selection={x:0,y:0,width:16,height:16},settings={radius:4,contrast:0,shift:0,edgeAware:true};const guided=refineSelection(b,selection,settings),smooth=refineSelection(b,selection,{...settings,edgeAware:false});assert(selectionWeight(guided,15,8)>selectionWeight(smooth,15,8));assert(selectionWeight(guided,16,8)<selectionWeight(smooth,16,8));const empty=refineSelection(b,maskSelection(new Uint8Array(512),32,16),settings);assert.equal(selectionWeight(empty,10,10),0);assert.throws(()=>refineSelection(b,selection,{...settings,radius:0}));
});
test('rich text ranges own UTF-16 styles and rebase after insertion; surrogate splits reject',()=>{
 const runs=formatRange(text,1,4,{color:'#ff0000',bold:true}),rich={...text,runs,wrapWidth:80};validateContent(rich);assert.deepEqual(runs,[{start:1,end:4,color:'#ff0000',bold:true}]);const next={...rich,text:'X'+text.text,runs:rebaseRuns(rich,'X'+text.text)};validateContent(next);assert.equal(next.runs[0].start,2);assert.equal(next.runs[0].end,5);assert.throws(()=>validateContent({...text,runs:[{start:2,end:3,color:'#ff0000'}]}));
});
test('RGB conversion identity and known wide-gamut colors preserve alpha and reject invalid ICC',()=>{
 const b=bitmap(256,1,x=>[x,255-x,(x*17)%256,x]),same=convertBitmapToSrgb(b,builtinProfile('srgb'));assert.deepEqual(same,b);assert.notEqual(same.data,b.data);const profile=srgbProfileBytes(),parsed=parseRgbProfile(profile),converted=convertBitmapToSrgb(b,parsed);assert(Math.max(...converted.data.map((v,i)=>Math.abs(v-b.data[i])))<=1);const p3=convertBitmapToSrgb(bitmap(1,1,()=>[128,64,32,123]),builtinProfile('display-p3'));assert.deepEqual([...p3.data],[138,59,21,123]);const bad=profile.slice();bad[16]=67;assert.throws(()=>parseRgbProfile(bad),/RGB/);assert.throws(()=>parseRgbProfile(profile.slice(0,100)));
});
test('color conversion, project v5 and recovery v6 preserve path, rich text, ICC and exact undo',async()=>{
 const d=doc(64,64,bitmap(64,64,()=>[128,64,32,255]));d.addLayer({...makeLayer('path',bitmap(32,32)),content:path});d.addLayer({...makeLayer('rich',bitmap(32,32)),content:{...text,runs:formatRange(text,0,1,{color:'#ff0000'}),wrapWidth:40}});const before=d.state;d.commitColor(convertedLayers(before,builtinProfile('display-p3')),profileResource(srgbProfileBytes()),'display-p3');assert(Object.isFrozen(d.state.colorManagement));const encoded=serializeProject(d.state);assert.equal(JSON.parse(encoded).version,5);assert.deepEqual(deserializeProject(encoded).layers,d.state.layers);assert.deepEqual(embeddedProfile(d.state),srgbProfileBytes());const session={version:2,activeId:d.identity.id,documents:[{state:d.state,dirty:true}]},codec=new RecoveryCodec(),stored=await codec.encode(session,new Set());assert.equal(stored.session.version,6);assert.deepEqual(await decodeRecovery(stored.session,stored.chunks),session);d.history.undo();assert.equal(d.state,before);d.dispose();
});
test('fractional Bezier knots roundtrip PSD natively with 24-bit coordinate precision',()=>{
 const d=doc();d.setContent(d.selected.id,path,bitmap(32,32));const bytes=exportPsd(d.state).bytes,raw=readPsd(bytes,{useImageData:true});assert.equal(raw.children.at(-1).vectorMask.paths[0].knots.length,3);const opened=importPsd(bytes,'path.psd');assert(opened.layered,opened.blockers.join());const c=opened.layered.layers.at(-1).content;assert.equal(c.type,'path');assert.equal(c.fillRule,'evenodd');for(let i=0;i<3;i++)for(const key of Object.keys(path.nodes[i]))assert(Math.abs(c.nodes[i][key]-path.nodes[i][key])<.00001);assert.doesNotThrow(()=>exportPsd(opened.layered));d.dispose();
});
test('rich PSD export requires explicit rasterization, retaining source project semantics',()=>{
 const d=doc();d.setContent(d.selected.id,{...text,runs:formatRange(text,0,1,{color:'#ff0000'})},bitmap(32,32));assert.throws(()=>exportPsd(d.state),/确认/);assert.doesNotThrow(()=>exportPsd(d.state,true));assert.equal(d.selected.content.type,'text');d.dispose();
});
test('batch isolates input, keeps aspect ratio, names duplicates, records failures and cancels',async()=>{
 const d=doc(64,32,bitmap(64,32,()=>[20,40,60,255])),bytes=new TextEncoder().encode(serializeProject(d.state)),before=bytes.slice(),input={name:'a.hyimage',format:'project',bytes},progress=[];
 const outputs=await runBatch([input,input,{...input,name:'broken',bytes:new Uint8Array([0])}],[{type:'fit',width:16,height:16},{type:'filter',kind:'invert',amount:100}],'project',undefined,(n)=>progress.push(n));assert.equal(outputs[0].name,'a.hyimage');assert.equal(outputs[1].name,'a-2.hyimage');assert(outputs[2].error);const state=deserializeProject(new TextDecoder().decode(outputs[0].bytes));assert.equal(state.width,16);assert.equal(state.height,8);assert.deepEqual(rgba(state.layers[0].bitmap,0,0),[235,215,195,255]);assert.deepEqual(bytes,before);assert.equal(d.history.canUndo,false);assert(progress.includes(3));const c=new AbortController();await assert.rejects(runBatch([input,input],[{type:'fit',width:16,height:16}],'project',c.signal,()=>c.abort()),/取消/);d.dispose();
});
test('professional API commands revision-check, undo and release batch output resources',async()=>{
 const w=new ImageWorkspace();await w.start();try{const d=doc();w.add(d);const call=operationClient(w.platform,d.identity.id),id=d.selected.id;
 await call('image.pixels.stroke',{layerId:id,points:[{x:20,y:20,pressure:.5}],size:16,color:'#ff0000',hardness:0,pressure:'both'});const before=d.state;await call('image.retouch.stroke',{layerId:id,sourceLayerId:id,kind:'clone',offset:{x:-10,y:0},points:[{x:30,y:20}],size:16});await call('image.history.undo');assert.deepEqual(d.state.layers,before.layers);
 await call('image.selection.set',{shape:'rectangle',x:0,y:0,width:32,height:32});await call('image.selection.refine',{radius:3,contrast:10,shift:0,edgeAware:true});assert(d.state.selection.mask);await call('image.color.convert',{source:'srgb'});assert.equal((await call('image.color.query')).workingSpace,'embedded-rgb');await call('image.history.undo');assert.equal(d.state.colorManagement,undefined);
 const input=w.platform.resources.put(new TextEncoder().encode(serializeProject(d.state)));const batch=await operationClient(w.platform)('image.batch.run',{inputs:[{resourceId:input.resourceId,name:'api.hyimage',format:'project'}],steps:[{type:'fit',width:16,height:16}],format:'project'});assert(batch[0].resourceId);w.platform.resources.release(batch[0].resourceId);w.platform.resources.release(input.resourceId);
 const failure=await w.platform.operations.execute({apiVersion:'1',requestId:'stale-pro',operation:'image.color.convert',documentId:d.identity.id,expectedRevision:0,params:{source:'srgb'}});assert.equal(failure.status,'failed');
 }finally{await w.dispose();}
});

test('one pixel soft brush still covers pixel centers at integer pointer coordinates',()=>{const d=doc(),s=new PixelStroke(d.state,d.selected.id,1,1,[255,0,0],false,{hardness:0});s.point({x:10,y:10});assert(s.changed);assert(rgba(s.layer.bitmap,10,10)[3]>0);d.dispose();});
test('batch invalid recipes fail before any item; failed resource commit cleans earlier outputs',async()=>{
 await assert.rejects(runBatch([],[], 'project'),/步骤/);
 const w=new ImageWorkspace();await w.start();try{const d=doc(4,4);w.add(d);const resource=w.platform.resources.put(new TextEncoder().encode(serializeProject(d.state))),store=w.platform.resources,put=store.put.bind(store);let created,count=0;store.put=bytes=>{if(++count===2)throw Error('simulated pool full');const out=put(bytes);created=out.resourceId;return out;};
 const result=await w.platform.operations.execute({apiVersion:'1',requestId:'batch-rollback',operation:'image.batch.run',params:{inputs:[{resourceId:resource.resourceId,name:'a',format:'project'},{resourceId:resource.resourceId,name:'b',format:'project'}],steps:[{type:'fit',width:4,height:4}],format:'project'}});assert.equal(result.status,'failed');assert(created);assert.throws(()=>store.read(created));store.put=put;store.release(resource.resourceId);
 }finally{await w.dispose();}
});
