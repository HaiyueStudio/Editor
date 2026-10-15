import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageDocument, makeLayer, validateState } from '../dist/document.js';
import { BLEND_MODES, maskWeight } from '../dist/layerFeatures.js';
import { compositeState, blendChannel } from '../dist/compositor.js';
import { maskFromSelection, maskStrokeState, maskFromStroke } from '../dist/maskTools.js';
import { PixelStroke } from '../dist/pixelTools.js';
import { serializeProject, deserializeProject } from '../dist/projectFile.js';
import { RecoveryCodec, decodeRecovery } from '../dist/recoveryCodec.js';
import { exportPsd, importPsd } from '../dist/psdAdapter.js';
import { psdExportWarnings } from '../dist/psdExportPolicy.js';
const bitmap=(w=2,h=2,color=[100,150,200,255])=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>color[i%4])});
const mask=(values=[0,64,128,255])=>({width:2,height:2,x:0,y:0,data:new Uint8Array(values),disabled:false,defaultColor:255});
const shape={type:'shape',shape:'rectangle',width:2,height:2,radius:0,fill:'#6496c8',stroke:'#ffffff',strokeWidth:0};
const doc=()=>{const d=ImageDocument.create('P5',4,4);d.addLayer(makeLayer('pixels',bitmap()));d.history.clear();return d;};
test('mask edits own their data, follow translated groups, preserve pixels and undo',()=>{
 const d=doc(),original=d.selected.bitmap.data.slice(),m=mask();d.setMask(d.selected.id,m);m.data.fill(255);
 assert.deepEqual(Array.from(compositeState(d.state).data.filter((_,i)=>i%4===3)).slice(0,6),[0,64,0,0,128,255]);assert.deepEqual(d.selected.bitmap.data,original);
 const before=d.state;d.setMask(d.selected.id,{...d.selected.mask,disabled:true});assert.equal(compositeState(d.state).data[3],255);d.history.undo();assert.equal(d.state,before);
 d.updateLayer(d.selected.id,{x:1,y:1});const image=compositeState(d.state);assert.equal(image.data[(1*4+1)*4+3],0);assert.equal(image.data[(2*4+2)*4+3],255);
 d.duplicateSelected();assert.notEqual(d.state.layers[1].mask.data,d.selected.mask.data);d.dispose();
});
test('mask brush and fractional selections never mutate original layer RGBA',()=>{
 const d=doc();d.setSelection({x:0,y:0,width:4,height:4,mask:new Uint8Array(16).fill(128)});d.setMask(d.selected.id,maskFromSelection(d.state,d.selected.id));
 assert.equal(d.selected.mask.data[0],128);const original=d.selected.bitmap.data.slice();d.setSelection(null);
 const source=maskStrokeState(d.state,d.selected.id),stroke=new PixelStroke(source,d.selected.id,2,1,[0,0,0]);stroke.point({x:.5,y:.5});d.setMask(d.selected.id,maskFromStroke(d.selected,stroke.layer));assert.equal(d.selected.mask.data[0],0);assert.deepEqual(d.selected.bitmap.data,original);d.history.undo();assert.equal(d.selected.mask.data[0],128);d.dispose();
});
test('content edit and explicit rasterization are undoable; pixel edits require rasterization',()=>{
 const d=doc();d.setContent(d.selected.id,shape,bitmap());assert.equal(d.selected.content.type,'shape');assert.throws(()=>d.replaceLayerPixels(d.selected.id,d.selected,'paint'),/栅格化/);
 d.setContent(d.selected.id,{...shape,fill:'#ff0000'},bitmap(2,2,[255,0,0,255]));d.history.undo();assert.equal(d.selected.content.fill,'#6496c8');
 d.rasterizeSelected();assert.equal(d.selected.content,undefined);d.history.undo();assert.equal(d.selected.content.type,'shape');d.dispose();
});
test('adjustment is non-destructive and respects its mask, opacity, visibility and isolated group',()=>{
 const d=doc(),base=d.selected.bitmap.data.slice();const layer={...makeLayer('invert'),kind:'adjustment',content:{type:'adjustment',filter:'invert',amount:100},mask:mask([255,0,255,255]),opacity:.5};d.addLayer(layer,false);
 const out=compositeState(d.state);assert.deepEqual(Array.from(out.data.slice(0,4)),[128,128,128,255]);assert.deepEqual(Array.from(out.data.slice(4,8)),[100,150,200,255]);assert.deepEqual(d.state.layers[1].bitmap.data,base);
 d.updateLayer(d.selected.id,{visible:false});assert.deepEqual(Array.from(compositeState(d.state).data.slice(0,4)),[100,150,200,255]);d.history.undo();
 const group={...makeLayer('isolated',null,'group'),children:[layer]};assert.deepEqual(compositeState({...d.state,layers:[d.state.layers[1],group]}).data,compositeState({...d.state,layers:[d.state.layers[1]]}).data);d.dispose();
});
test('project v3 and recovery v4 preserve content, masks and blend modes; malformed content rejects',async()=>{
 const d=doc();d.setContent(d.selected.id,shape,bitmap());d.setMask(d.selected.id,mask());d.updateLayer(d.selected.id,{blend:'overlay'});
 const text=serializeProject(d.state);assert.equal(JSON.parse(text).version,3);const reopened=deserializeProject(text);assert.deepEqual(reopened.layers,d.state.layers);
 const session={version:2,activeId:d.identity.id,documents:[{state:d.state,dirty:true}]},codec=new RecoveryCodec(),stored=await codec.encode(session,new Set());assert.equal(stored.session.version,4);assert.deepEqual(await decodeRecovery(stored.session,stored.chunks),session);
 const bad=JSON.parse(text);bad.document.layers[1].content.width=999999;assert.throws(()=>deserializeProject(JSON.stringify(bad)),/形状/);d.dispose();
});
test('locked and invalid mask/content mutations are atomic',()=>{
 const d=doc(),before=d.state;assert.throws(()=>d.setMask(d.selected.id,{...mask(),data:new Uint8Array(1)}),/蒙版/);assert.equal(d.state,before);
 assert.throws(()=>d.setContent(d.selected.id,{type:'adjustment',filter:'invert',amount:500},null),/调整/);assert.equal(d.state,before);
 d.updateLayer(d.selected.id,{locked:true});assert.throws(()=>d.setMask(d.selected.id,mask()),/锁定/);assert.throws(()=>d.setContent(d.selected.id,shape,bitmap()),/锁定/);d.dispose();
});
for(const [mode,expected] of [['normal',.75],['multiply',.1875],['screen',.8125],['overlay',.375],['hard-light',.625],['darken',.25],['lighten',.75],['difference',.5],['exclusion',.625]])test('blend formula and PSD roundtrip: '+mode,()=>{
 assert.equal(blendChannel(.25,.75,mode),expected);const d=doc();d.updateLayer(d.selected.id,{blend:mode});const result=exportPsd(d.state),opened=importPsd(result.bytes,'blend.psd');assert(opened.layered,opened.blockers.join('\n'));assert.equal(opened.layered.layers[1].blend,mode);d.dispose();
});
test('PSD retains simple raster mask bytes, offsets, default fill and disabled flag',()=>{
 const d=doc();d.updateLayer(d.selected.id,{x:1,y:1});d.setMask(d.selected.id,{...mask(),x:-1,y:0,defaultColor:255});
 const bytes=exportPsd(d.state).bytes,opened=importPsd(bytes,'mask.psd');assert(opened.layered,opened.blockers.join('\n'));assert.deepEqual(opened.layered.layers[1].mask,d.selected.mask);assert.deepEqual(compositeState(opened.layered).data,compositeState(d.state).data);d.dispose();
});
test('basic shapes now export natively; unsupported adjustments still require flattening consent',()=>{
 const d=doc();d.setContent(d.selected.id,shape,bitmap());assert.deepEqual(psdExportWarnings(d.state),[]);const raster=importPsd(exportPsd(d.state).bytes,'shape.psd');assert(raster.layered,raster.blockers.join('\n'));assert.deepEqual(raster.layered.layers[1].content,shape);
 d.addLayer({...makeLayer('brightness'),kind:'adjustment',content:{type:'adjustment',filter:'brightness',amount:30}},false);assert.throws(()=>exportPsd(d.state),/合并/);const merged=importPsd(exportPsd(d.state,true).bytes,'adjustment.psd');assert(merged.layered);assert.equal(merged.layered.layers.length,1);assert.deepEqual(compositeState(merged.layered).data,compositeState(d.state).data);assert.equal(d.selected.kind,'adjustment');d.dispose();
});

test('applying a mask bakes alpha exactly and undo restores editable mask',()=>{
 const d=doc();d.setMask(d.selected.id,mask());const before=compositeState(d.state);d.applySelectedMask();assert.equal(d.selected.mask,undefined);assert.deepEqual(compositeState(d.state),before);d.history.undo();assert(d.selected.mask);d.dispose();
});
test('translated group mask exports and reimports at the same canvas coordinates',()=>{
 const child=makeLayer('child',bitmap()),group={...makeLayer('group',null,'group'),x:1,y:1,children:[child],mask:{...mask(),x:0,y:0}};
 const state={id:'group-mask',name:'group mask',width:4,height:4,layers:[group],selectedId:group.id,revision:0};
 const opened=importPsd(exportPsd(state).bytes,'group.psd');assert(opened.layered,opened.blockers.join('\n'));assert.deepEqual(compositeState(opened.layered).data,compositeState(state).data);
 const disabled={...state,layers:[{...group,mask:{...group.mask,disabled:true}}]};const again=importPsd(exportPsd(disabled).bytes,'disabled.psd');assert.equal(again.layered.layers[0].mask.disabled,true);assert.deepEqual(compositeState(again.layered).data,compositeState(disabled).data);
});
