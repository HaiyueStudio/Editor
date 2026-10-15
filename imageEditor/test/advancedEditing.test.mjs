import test from 'node:test';import assert from 'node:assert/strict';
import {ImageDocument,makeLayer} from '../dist/document.js';
import {selectionWeight as weight,selectionCount,invertSelection,combineSelection,ellipseSelection,polygonSelection,colorSelection,modifySelection} from '../dist/selection.js';
import {PixelStroke,fillPixels} from '../dist/pixelTools.js';
import {FILTERS,filterBitmap,filterLayer} from '../dist/filters.js';
import {serializeProject,deserializeProject} from '../dist/projectFile.js';
import {exportPsd,importPsd} from '../dist/psdAdapter.js';
const image=(w,h,colors)=>({width:w,height:h,data:new Uint8ClampedArray(Array.from({length:w*h},(_,i)=>colors[i%colors.length]).flat())});
const pixel=(b,x,y)=>Array.from(b.data.slice((y*b.width+x)*4,(y*b.width+x+1)*4));
const rect={x:1,y:1,width:2,height:2};
test('inverse preserves holes and empty selection never becomes unrestricted editing',()=>{
 const inverse=invertSelection(rect,4,4);assert.equal(selectionCount(inverse),12);assert.equal(weight(inverse,1,1),0);assert.equal(weight(inverse,0,0),1);
 const empty=invertSelection({x:0,y:0,width:4,height:4},4,4);assert.equal(selectionCount(empty),0);
 const doc=ImageDocument.create('空选区',4,4,true);doc.setSelection(empty);const filled=fillPixels(doc.state,doc.selected.id,[255,0,0]);assert.deepEqual(filled.bitmap,doc.selected.bitmap);assert.throws(()=>doc.cropToSelection(),/非空/);
 assert.equal(selectionCount(invertSelection(empty,4,4)),16);doc.dispose();
});
test('selection union subtraction intersection and null semantics are explicit',()=>{
 const next={x:2,y:0,width:2,height:3};assert.equal(selectionCount(combineSelection(rect,next,'add',4,4)),8);assert.equal(selectionCount(combineSelection(rect,next,'subtract',4,4)),2);assert.equal(selectionCount(combineSelection(rect,next,'intersect',4,4)),2);
 assert.equal(selectionCount(combineSelection(null,next,'add',4,4)),6);assert.equal(selectionCount(combineSelection(null,next,'subtract',4,4)),0);assert.equal(selectionCount(combineSelection(null,next,'intersect',4,4)),6);
});
test('ellipse and concave lasso include real interiors instead of bounding rectangles',()=>{
 const ellipse=ellipseSelection({x:0,y:0,width:10,height:10});assert.equal(weight(ellipse,0,0),0);assert.equal(weight(ellipse,5,5),1);
 const polygon=polygonSelection([{x:1,y:1},{x:7,y:1},{x:7,y:3},{x:3,y:3},{x:3,y:7},{x:1,y:7}],8,8);assert.equal(selectionCount(polygon),20);assert.equal(weight(polygon,5,5),0);assert.equal(weight(polygon,2,5),1);
 assert.equal(selectionCount(polygonSelection([{x:-2,y:-2},{x:9,y:-2},{x:9,y:9},{x:-2,y:9}],8,8)),64);
});
test('magic wand selects four-connected pixels; color range finds disconnected matches',()=>{
 const b=image(5,1,[[250,0,0,255],[255,0,0,255],[0,0,255,255],[250,0,0,255],[0,0,255,255]]);
 assert.equal(selectionCount(colorSelection(b,[255,0,0,255],5,{x:0,y:0})),2);assert.equal(selectionCount(colorSelection(b,[255,0,0],5)),3);assert.equal(selectionCount(colorSelection(b,[255,0,0],0)),1);
 const diagonal=image(2,2,[[255,0,0,255],[0,0,0,255],[0,0,0,255],[255,0,0,255]]);assert.equal(selectionCount(colorSelection(diagonal,[255,0,0],0,{x:0,y:0})),1);
 assert.throws(()=>colorSelection(b,[0,0,0],256),/容差/);
});
test('color selection ignores hidden RGB but distinguishes alpha',()=>{
 const b=image(3,1,[[200,40,100,0],[1,2,3,0],[200,40,100,255]]);assert.equal(selectionCount(colorSelection(b,[100,200,30,0],0)),2);assert.equal(selectionCount(colorSelection(b,[200,40,100],0)),1);
});
test('feather expansion and contraction use bounded masks with zero canvas exterior',()=>{
 const r={x:3,y:3,width:3,height:3};const expanded=modifySelection(r,9,9,'expand',1);assert.equal(selectionCount(expanded),25);assert.equal(selectionCount(modifySelection(expanded,9,9,'contract',1)),9);
 const feather=modifySelection(r,9,9,'feather',1);assert.equal(weight(feather,4,4),1);assert.equal(Math.round(weight(feather,2,2)*255),28);assert.equal(weight(feather,0,0),0);
 assert.equal(selectionCount(modifySelection({x:0,y:0,width:2,height:2},2,2,'contract',1)),0);
});
test('soft mask controls brush and erase strength and preserves group offsets',()=>{
 const doc=ImageDocument.create('蒙版',4,4,true);doc.setSelection({x:0,y:0,width:2,height:1,mask:new Uint8Array([128,0])});
 const fill=fillPixels(doc.state,doc.selected.id,[255,0,0]);assert.deepEqual(pixel(fill.bitmap,0,0),[255,127,127,255]);assert.deepEqual(pixel(fill.bitmap,1,0),[255,255,255,255]);
 const clear=fillPixels(doc.state,doc.selected.id,null);assert.equal(pixel(clear.bitmap,0,0)[3],127);
 const stroke=new PixelStroke(doc.state,doc.selected.id,30,1,[0,0,0]);stroke.point({x:.5,y:.5});assert.deepEqual(pixel(stroke.layer.bitmap,0,0),[127,127,127,255]);assert.deepEqual(pixel(stroke.layer.bitmap,1,0),[255,255,255,255]);doc.dispose();
});
test('selection history owns mask bytes, marks dirty and roundtrips in version 2',()=>{
 const doc=ImageDocument.create('历史',4,4);doc.markSaved();const before=doc.state,mask=new Uint8Array([255,0,128,255]);doc.setSelection({x:1,y:1,width:2,height:2,mask});mask.fill(0);assert.equal(doc.state.selection.mask[0],255);assert(doc.dirty);
 const serialized=serializeProject(doc.state);assert.equal(JSON.parse(serialized).version,2);assert.deepEqual(deserializeProject(serialized).selection,doc.state.selection);
 doc.history.undo();assert.equal(doc.state,before);assert.equal(doc.dirty,false);doc.history.redo();assert.equal(doc.state.selection.mask[2],128);
 const broken=JSON.parse(serialized);broken.document.selection.mask='AAAA';assert.throws(()=>deserializeProject(JSON.stringify(broken)),/蒙版/);
 assert.throws(()=>doc.setSelection({...rect,mask:new Uint8Array(3)}),/蒙版/);doc.dispose();
});
test('all filters preserve input buffers, dimensions, valid channels and color-only alpha',()=>{
 const b=image(3,2,[[200,40,20,255],[0,200,20,128],[80,30,200,0],[0,0,0,255],[255,255,255,255],[30,70,180,200]]),before=b.data.slice();
 for(const [kind,config] of Object.entries(FILTERS)){const out=filterBitmap(b,{kind,amount:config.value});assert.deepEqual(b.data,before);assert.equal(out.width,b.width);assert.equal(out.height,b.height);assert.notEqual(out.data,b.data);if(!['blur','gaussian','pixelate'].includes(kind))for(let i=3;i<before.length;i+=4)assert.equal(out.data[i],before[i]);}
 assert.throws(()=>filterBitmap(b,{kind:'brightness',amount:101}),/参数/);
});
test('filter math produces expected invert grayscale threshold and posterize values',()=>{
 const b=image(1,1,[[240,40,20,128]]);assert.deepEqual(pixel(filterBitmap(b,{kind:'invert',amount:100}),0,0),[15,215,235,128]);assert.deepEqual(pixel(filterBitmap(b,{kind:'grayscale',amount:100}),0,0),[81,81,81,128]);assert.deepEqual(pixel(filterBitmap(b,{kind:'threshold',amount:100}),0,0),[0,0,0,128]);assert.deepEqual(pixel(filterBitmap(b,{kind:'posterize',amount:2}),0,0),[255,0,0,128]);
 for(const kind of ['brightness','contrast','saturation','hue','grayscale','sepia','invert','sharpen','emboss'])assert.deepEqual(filterBitmap(b,{kind,amount:0}).data,b.data);
});
test('blur and mosaic use associated colors so hidden transparent RGB cannot bleed',()=>{
 const b=image(3,1,[[255,0,0,255],[0,0,255,0],[0,0,255,0]]);const blurred=filterBitmap(b,{kind:'blur',amount:1});assert.deepEqual(pixel(blurred,1,0),[255,0,0,85]);const mosaic=filterBitmap(b,{kind:'pixelate',amount:3});assert.deepEqual(pixel(mosaic,2,0),[255,0,0,85]);
});
test('filter honors feather weights and translated parent coordinates atomically',()=>{
 const doc=ImageDocument.create('滤镜',6,6);doc.addLayer({...makeLayer('组',null,'group'),x:2,y:1});doc.addLayer({...makeLayer('像素',image(2,1,[[200,100,50,255]])),x:1,y:1});doc.setSelection({x:3,y:2,width:2,height:1,mask:new Uint8Array([128,0])});const before=doc.state;
 const result=filterLayer(before,doc.selected.id,{kind:'invert',amount:100});assert.deepEqual(pixel(result.bitmap,1,0),[200,100,50,255]);assert.deepEqual(pixel(result.bitmap,0,0),[127,128,128,255]);assert.equal(doc.state,before);
 doc.replaceLayerPixels(result.id,result,'滤镜');doc.history.undo();assert.equal(doc.state,before);doc.history.redo();assert.deepEqual(doc.selected.bitmap,result.bitmap);doc.updateLayer(doc.selected.id,{locked:true});assert.throws(()=>filterLayer(doc.state,doc.selected.id,{kind:'invert',amount:100}),/锁定/);doc.dispose();
});
test('filtered pixels survive project and PSD export independently from active selection',()=>{
 const doc=ImageDocument.create('PSD 滤镜',3,2,true);doc.setSelection(ellipseSelection({x:0,y:0,width:3,height:2}));const result=filterLayer(doc.state,doc.selected.id,{kind:'sepia',amount:100});doc.replaceLayerPixels(result.id,result,'滤镜');
 assert.deepEqual(deserializeProject(serializeProject(doc.state)).layers,doc.state.layers);const reopened=importPsd(exportPsd(doc.state).bytes,'滤镜.psd');assert(reopened.layered,reopened.blockers.join('\n'));assert.deepEqual(reopened.layered.layers[0].bitmap,doc.selected.bitmap);doc.dispose();
});
