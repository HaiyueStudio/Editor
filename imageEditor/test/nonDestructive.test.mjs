import test from 'node:test';
import assert from 'node:assert/strict';
import {readPsd,writePsdUint8Array} from 'ag-psd';
import {ImageDocument,makeLayer} from '../dist/document.js';
import {compositeState} from '../dist/compositor.js';
import {adjustmentBitmap,styleBitmap} from '../dist/nonDestructiveRender.js';
import {convertSmart,replaceSmart} from '../dist/smartObject.js';
import {transformedLayer,commitTransform} from '../dist/freeTransform.js';
import {serializeProject,deserializeProject} from '../dist/projectFile.js';
import {RecoveryCodec,decodeRecovery} from '../dist/recoveryCodec.js';
import {exportPsd,importPsd} from '../dist/psdAdapter.js';
import {validateContent} from '../dist/layerFeatures.js';
import {ImageWorkspace} from '../dist/workspace.js';
import {operationClient} from '../../scripts/editor-e2e/operationWorkflow.mjs';
const bitmap=(w=4,h=4,rgba=[64,128,192,255])=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>rgba[i%4])});
const doc=()=>{const d=ImageDocument.create('native',16,16);d.addLayer({...makeLayer('pixels',bitmap()),x:4,y:4});d.history.clear();return d;};
const pixel=(b,x,y)=>Array.from(b.data.slice((y*b.width+x)*4,(y*b.width+x)*4+4));
const levels={type:'adjustment',filter:'levels',amount:100,levels:{black:64,white:192,gamma:1,outputBlack:10,outputWhite:250}};
const curves={type:'adjustment',filter:'curves',amount:100,curves:[{input:0,output:255},{input:255,output:0}]};
const styles={enabled:true,overlay:{color:'#ff0000',opacity:.5},stroke:{color:'#ffffff',opacity:1,size:1},shadow:{color:'#112233',opacity:.5,dx:2,dy:3,blur:2}};
test('clipping uses base alpha once, respects base opacity/visibility, and clipped adjustment does not affect the backdrop',()=>{
 const d=doc(),base=d.selected;d.updateLayer(base.id,{opacity:.5});d.addLayer({...makeLayer('clip',bitmap(8,8,[255,0,0,255])),x:2,y:2});d.setClipping(d.selected.id,true);
 let out=compositeState(d.state);assert.deepEqual(pixel(out,4,4),[255,0,0,128]);assert.equal(pixel(out,2,2)[3],0);
 d.addLayer({...makeLayer('invert'),kind:'adjustment',content:curves},false);d.setClipping(d.selected.id,true);out=compositeState(d.state);assert.deepEqual(pixel(out,4,4),[0,255,255,128]);assert.equal(pixel(out,2,2)[3],0);
 d.updateLayer(base.id,{visible:false});assert.equal(pixel(compositeState(d.state),4,4)[3],0);d.history.undo();assert.equal(pixel(compositeState(d.state),4,4)[3],128);
 d.setStyles(base.id,{enabled:true,stroke:{color:'#ffffff',opacity:1,size:1}});assert.deepEqual(pixel(compositeState(d.state),3,3),[255,255,255,128],'base style is applied after clipping; effects cannot become clipping coverage');d.dispose();
});
test('levels and curves produce predictable LUTs without touching source alpha or pixels',()=>{
 const b=bitmap(1,1,[64,128,192,123]),old=b.data.slice();assert.deepEqual([...adjustmentBitmap(b,levels).data],[10,130,250,123]);assert.deepEqual([...adjustmentBitmap(b,curves).data],[191,127,63,123]);assert.deepEqual(b.data,old);
 assert.throws(()=>validateContent({...curves,curves:[{input:0,output:0},{input:0,output:255}]}),/曲线/);assert.throws(()=>validateContent({...levels,amount:20}),/amount/);assert.throws(()=>validateContent({...levels,levels:{...levels.levels,gamma:1.234}}),/色阶/);
});
test('live styles own parameters, keep source pixels and undo, including disabled styles',()=>{
 const d=doc(),b=d.selected.bitmap.data.slice(),s=structuredClone(styles);d.setStyles(d.selected.id,s);s.overlay.color='#000000';assert.equal(d.selected.styles.overlay.color,'#ff0000');assert.deepEqual(d.selected.bitmap.data,b);assert.equal(pixel(compositeState(d.state),3,3)[3],255);
 const before=d.state;d.setStyles(d.selected.id,{...styles,enabled:false});assert.equal(pixel(compositeState(d.state),3,3)[3],0);d.history.undo();assert.equal(d.state,before);
 d.updateLayer(d.selected.id,{locked:true});const locked=d.state;assert.throws(()=>d.setStyles(d.selected.id,styles),/锁定/);assert.equal(d.state,locked);d.dispose();
});
test('smart scaling restores original source pixels; replace and duplicate own source buffers and undo',()=>{
 const d=doc(),id=d.selected.id;d.replaceLayerPixels(id,{...d.selected,bitmap:{width:4,height:4,data:Uint8ClampedArray.from({length:64},(_,i)=>i%4===3?255:(i*37)%256)}},'pattern');const original=d.selected.bitmap.data.slice();convertSmart(d,id);
 const ownedSource=d.selected.content.source.data;const transform=(width,height)=>commitTransform(d,transformedLayer(d.state,id,{width,height,angle:0,dx:0,dy:0}));transform(1,1);assert.equal(d.selected.content.source.data,ownedSource,'transform history shares the immutable source buffer');transform(4,4);assert.equal(d.selected.content.source.data,ownedSource);assert.deepEqual(d.selected.bitmap.data,original);
 const source=bitmap(2,2,[255,0,0,255]);replaceSmart(d,id,source,'new');source.data.fill(0);assert.equal(d.selected.content.source.data[0],255);d.history.undo();assert.deepEqual(d.selected.content.source.data,original);
 d.duplicateSelected();assert.notEqual(d.selected.content.source.data,d.state.layers[1].content.source.data);assert.deepEqual(d.selected.content.source.data,original);d.dispose();
});
test('project v4 and recovery v5 retain owned smart source, live styles and adjustment parameters',async()=>{
 const d=doc();convertSmart(d,d.selected.id);d.setStyles(d.selected.id,styles);d.addLayer({...makeLayer('levels'),kind:'adjustment',content:levels},false);d.setClipping(d.selected.id,true);
 const encoded=serializeProject(d.state);assert.equal(JSON.parse(encoded).version,4);const reopened=deserializeProject(encoded);assert.deepEqual(reopened.layers,d.state.layers);assert.deepEqual(compositeState(reopened),compositeState(d.state));
 const session={version:2,activeId:d.identity.id,documents:[{state:d.state,dirty:true}]},codec=new RecoveryCodec(),stored=await codec.encode(session,new Set());assert.equal(stored.session.version,5);assert.deepEqual(await decodeRecovery(stored.session,stored.chunks),session);
 const bad=JSON.parse(encoded);bad.document.layers[1].content.source.rgba='AA==';assert.throws(()=>deserializeProject(JSON.stringify(bad)));d.dispose();
});
for(const kind of ['text','rectangle','ellipse','line','levels','curves','invert','smart','styles','clipping'])test('PSD native semantics, pixels and second generation export: '+kind,()=>{
 const d=doc();let expected;
 if(kind==='text')expected={type:'text',text:'海月\nNative',size:12,family:'sans-serif',fontName:'ArialMT',bold:true,italic:false,align:'left',color:'#112233'};
 if(['rectangle','ellipse','line'].includes(kind))expected={type:'shape',shape:kind,width:4,height:4,radius:kind==='rectangle'?1:0,fill:'#112233',stroke:'#334455',strokeWidth:kind==='line'?1:0};
 if(['levels','curves','invert'].includes(kind))expected=kind==='levels'?levels:kind==='curves'?curves:{type:'adjustment',filter:'invert',amount:100};
 if(expected)d.setContent(d.selected.id,expected,expected.type==='adjustment'?null:d.selected.bitmap);
 if(kind==='smart'){convertSmart(d,d.selected.id);commitTransform(d,transformedLayer(d.state,d.selected.id,{width:8,height:4,angle:90,dx:1,dy:0,flipY:true}));}
 if(kind==='styles')d.setStyles(d.selected.id,styles);
 if(kind==='clipping'){d.addLayer(makeLayer('clip',bitmap(8,8)));d.setClipping(d.selected.id,true);}
 const bytes=exportPsd(d.state).bytes,raw=readPsd(bytes,{useImageData:true,skipThumbnail:true}),opened=importPsd(bytes,'native.psd');assert(opened.layered,opened.blockers.join('\n'));
 const a=d.selected,b=opened.layered.layers.at(-1);if(expected)assert.deepEqual(b.content,expected);
 if(kind==='smart'){assert.equal(raw.linkedFiles.length,1);assert(raw.children.at(-1).placedLayer);assert.deepEqual(b.content.source,a.content.source);}
 if(kind==='styles')assert.deepEqual(b.styles,styles);if(kind==='clipping')assert(b.clipping);
 assert.deepEqual(compositeState(opened.layered),compositeState(d.state));const again=importPsd(exportPsd(opened.layered).bytes,'again.psd');assert(again.layered,again.blockers.join('\n'));assert.deepEqual(compositeState(again.layered),compositeState(d.state));d.dispose();
});
test('PSD channel adjustments import natively while custom text layout stays an explicit blocker',()=>{
 const d=doc();d.setContent(d.selected.id,levels,null);const raw=readPsd(exportPsd(d.state).bytes,{useImageData:true});raw.children.at(-1).adjustment.red.shadowInput=10;let opened=importPsd(writePsdUint8Array(raw,{noBackground:true,compress:true}),'channel.psd');assert(opened.layered,opened.blockers.join());assert.equal(opened.layered.layers.at(-1).content.channels.red.levels.black,10);
 const t=doc();t.setContent(t.selected.id,{type:'text',text:'text',size:12,family:'sans-serif',bold:false,italic:false,align:'left',color:'#000000'},t.selected.bitmap);const text=readPsd(exportPsd(t.state).bytes,{useImageData:true});text.children.at(-1).text.transform[4]+=10;opened=importPsd(writePsdUint8Array(text,{noBackground:true,compress:true}),'custom.psd');assert.equal(opened.layered,null);assert.match(opened.blockers.join(),/自定义原点/);
 d.dispose();t.dispose();
});
test('new public API commands are atomic, revision checked and preserve smart resources across undo/export',async()=>{
 const w=new ImageWorkspace();await w.start();try{
  const opened=await operationClient(w.platform)('image.document.create',{name:'agent',width:8,height:8}),d=w.active,call=operationClient(w.platform,opened.documentId),id=d.selected.id;
  await call('image.pixels.fill',{layerId:id,color:'#ff0000'});await call('image.smart.convert',{layerId:id});const source=await call('image.smart.source',{layerId:id});assert.equal(source.width,8);assert.equal(w.platform.resources.read(source.resourceId).length,256);
  await call('image.layer.transform',{layerId:id,width:2,height:2});await call('image.smart.replace',{layerId:id,resourceId:source.resourceId,width:8,height:8,name:'replace'});await call('image.history.undo');assert.equal(d.selected.content.name,'图层 1');
  await call('image.layer.styles',{layerId:id,styles});const before=serializeProject(d.state),history=d.history.snapshot();
  const failed=await w.platform.operations.execute({apiVersion:'1',requestId:'invalid',operation:'image.smart.replace',documentId:d.identity.id,expectedRevision:d.revision,params:{layerId:id,resourceId:source.resourceId,width:1,height:1,name:'bad'}});assert.equal(failed.status,'failed');assert.equal(serializeProject(d.state),before);assert.deepEqual(d.history.snapshot(),history);
  const stale=await w.platform.operations.execute({apiVersion:'1',requestId:'stale',operation:'image.layer.styles',documentId:d.identity.id,expectedRevision:d.revision-1,params:{layerId:id,remove:true}});assert.notEqual(stale.status,'completed');assert.equal(serializeProject(d.state),before);
  const query=await call('image.document.query');assert.equal(query.layers[0].content.type,'smart');assert.equal(query.layers[0].content.source,undefined);
  const file=await call('image.document.export',{format:'psd'});assert(importPsd(w.platform.resources.read(file.resourceId),'api.psd').layered);
 }finally{await w.dispose();}
});
test('merging a clipping base cannot silently change its unselected clip; isolated sample ignores clipping relation',async()=>{
 const {mergeLayers,sampleColor}=await import('../dist/dailyEditing.js');const d=doc(),base=d.selected.id;d.addLayer(makeLayer('clip',bitmap()));d.setClipping(d.selected.id,true);assert.deepEqual(sampleColor(d.state,1,1,d.selected.id),[64,128,192,255]);const state=d.state;assert.throws(()=>mergeLayers(d,[d.state.layers[0].id,base]),/剪贴/);assert.equal(d.state,state);d.dispose();
});
test('nested and repeated levels export uses canonical v2 blocks; disabled styles survive native roundtrip',()=>{
 const d=doc();d.setStyles(d.selected.id,{...styles,enabled:false});const group={...makeLayer('group',null,'group'),children:[{...makeLayer('levels'),kind:'adjustment',content:levels}]};d.addLayer(group,false);d.addLayer({...makeLayer('levels2'),kind:'adjustment',content:levels},false);
 const bytes=exportPsd(d.state).bytes;let blocks=0;for(let p=0;p<bytes.length-12;p++)if(String.fromCharCode(...bytes.subarray(p,p+8))==='8BIMlevl'){assert.equal(new DataView(bytes.buffer,bytes.byteOffset).getUint32(p+8),292);assert(bytes.subarray(p+12+272,p+12+292).every(n=>n===0));blocks++;}assert.equal(blocks,2);
 const opened=importPsd(bytes,'nested.psd');assert(opened.layered,opened.blockers.join('\n'));assert.equal(opened.layered.layers[1].styles.enabled,false);d.dispose();
});
test('text with trailing empty lines requires explicit flattening rather than silently losing text',()=>{
 const d=doc();d.setContent(d.selected.id,{type:'text',text:'hello\n',size:12,family:'sans-serif',bold:false,italic:false,align:'left',color:'#ffffff'},bitmap());assert.throws(()=>exportPsd(d.state),/末尾空行/);assert.equal(importPsd(exportPsd(d.state,true).bytes,'flat.psd').layered.layers.length,1);d.dispose();
});
test('valid custom project IDs can export smart objects; tiny embedded previews retain alpha',()=>{
 const d=new ImageDocument({id:'custom-doc',name:'custom',width:2,height:2,layers:[{...makeLayer('custom',bitmap(1,1,[90,160,220,123])),id:'custom-layer'}],selectedId:'custom-layer',revision:0});convertSmart(d,d.selected.id);const bytes=exportPsd(d.state).bytes,raw=readPsd(bytes,{useImageData:true});const embedded=readPsd(raw.linkedFiles[0].data,{useImageData:true});assert.equal(embedded.imageData.data[3],123);assert.deepEqual(embedded.children[0].imageData.data,d.selected.content.source.data);assert(importPsd(bytes,'custom.psd').layered);d.dispose();
});
