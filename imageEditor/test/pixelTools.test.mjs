import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageDocument, makeLayer } from '../dist/document.js';
import { PixelStroke, fillPixels, transformBitmap, selectionRect, parentOffset } from '../dist/pixelTools.js';
import { serializeProject, deserializeProject } from '../dist/projectFile.js';
const pixel = (bitmap, x, y) => Array.from(bitmap.data.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x + 1) * 4));
const source = () => ({ width: 2, height: 2, data: new Uint8ClampedArray([255,0,0,255, 0,255,0,128, 0,0,255,255, 80,90,100,0]) });

test('one stroke interpolates sparse events, preserves source and commits as one undo', () => {
  const doc = ImageDocument.create('绘画', 32, 24); doc.markSaved(); const before = doc.state;
  const stroke = new PixelStroke(doc.state, doc.selected.id, 3, 1, [240,60,10]);
  stroke.point({x:2.5,y:8.5}); stroke.point({x:25.5,y:8.5});
  assert.equal(doc.state, before); assert.equal(doc.selected.bitmap, null);
  assert.deepEqual(pixel(stroke.layer.bitmap,15,8),[240,60,10,255]); assert.deepEqual(pixel(stroke.layer.bitmap,15,14),[0,0,0,0]);
  doc.replaceLayerPixels(stroke.layer.id,stroke.layer,'笔画',before.revision);
  stroke.layer.bitmap.data.fill(0); assert.equal(pixel(doc.selected.bitmap,15,8)[3],255);
  doc.history.undo(); assert.equal(doc.state,before); assert.equal(doc.dirty,false);
  doc.history.redo(); assert.equal(pixel(doc.selected.bitmap,15,8)[3],255); doc.dispose();
});
test('repeated pointer samples do not multiply brush opacity; straight alpha is correct', () => {
  const doc = ImageDocument.create('透明',16,16), stroke = new PixelStroke(doc.state,doc.selected.id,4,0.5,[200,100,20]);
  for(let i=0;i<5;i++) stroke.point({x:8.5,y:8.5});
  assert.deepEqual(pixel(stroke.layer.bitmap,8,8),[200,100,20,128]);
  doc.replaceLayerPixels(stroke.layer.id,stroke.layer,'笔画');
  const second = new PixelStroke(doc.state,doc.selected.id,4,0.5,[0,100,220]); second.point({x:8.5,y:8.5});
  assert.deepEqual(pixel(second.layer.bitmap,8,8),[67,100,153,192]); doc.dispose();
});
test('eraser changes alpha without destroying hidden RGB; undo is byte exact', () => {
  const doc=ImageDocument.create('擦除',2,2);doc.addLayer(makeLayer('像素',source())); const before=doc.state;
  const stroke=new PixelStroke(doc.state,doc.selected.id,3,1,[0,0,0],true);stroke.point({x:0.5,y:0.5});
  assert.deepEqual(pixel(stroke.layer.bitmap,0,0),[255,0,0,0]);
  doc.replaceLayerPixels(stroke.layer.id,stroke.layer,'擦除');doc.history.undo();assert.equal(doc.state,before);doc.dispose();
});
test('selection clips brush/fill/clear and clamps reversed drag to the canvas',()=>{
  assert.deepEqual(selectionRect({x:12,y:15},{x:-4,y:3},10,10),{x:0,y:3,width:10,height:7});
  const doc=ImageDocument.create('选区',16,16,true);doc.setSelection({x:4,y:5,width:3,height:2});
  const stroke=new PixelStroke(doc.state,doc.selected.id,50,1,[30,50,70]);stroke.point({x:5,y:5});
  assert.deepEqual(pixel(stroke.layer.bitmap,4,5),[30,50,70,255]);assert.deepEqual(pixel(stroke.layer.bitmap,3,5),[255,255,255,255]);
  const fill=fillPixels(doc.state,doc.selected.id,[255,0,0],0.5);assert.deepEqual(pixel(fill.bitmap,4,5),[255,128,128,255]);
  const clear=fillPixels(doc.state,doc.selected.id,null);assert.equal(pixel(clear.bitmap,4,5)[3],0);assert.equal(pixel(clear.bitmap,7,5)[3],255);doc.dispose();
});
test('translated groups paint in document coordinates and preserve off-canvas pixels',()=>{
  const doc=ImageDocument.create('偏移',16,16); const group={...makeLayer('组',null,'group'),x:6,y:-2};doc.addLayer(group);
  doc.addLayer({...makeLayer('偏移像素',source()),x:-9,y:3});const id=doc.selected.id;
  assert.deepEqual(parentOffset(doc.state.layers,id),{x:6,y:-2});
  doc.setSelection({x:5,y:5,width:2,height:2});const stroke=new PixelStroke(doc.state,id,3,1,[10,20,30]);stroke.point({x:5.5,y:5.5});
  const localX=5-stroke.layer.x-6,localY=5-stroke.layer.y+2;
  assert.deepEqual(pixel(stroke.layer.bitmap,localX,localY),[10,20,30,255]);assert.deepEqual(pixel(stroke.layer.bitmap,0,0),[255,0,0,255]);doc.dispose();
});
test('locks, invalid settings and stale transactions fail without changing history',()=>{
  const doc=ImageDocument.create('保护',16,16);const stroke=new PixelStroke(doc.state,doc.selected.id,3,1,[0,0,0]);stroke.point({x:4,y:4});
  const revision=doc.revision;doc.updateLayer(doc.selected.id,{locked:true});const state=doc.state;
  assert.throws(()=>new PixelStroke(state,doc.selected.id,3,1,[0,0,0]),/锁定/);
  assert.throws(()=>doc.replaceLayerPixels(doc.selected.id,stroke.layer,'笔画',revision),/变化/);
  assert.throws(()=>new PixelStroke(state,doc.selected.id,0,1,[0,0,0]),/大小/);
  assert.equal(doc.state,state);doc.dispose();
});
test('quarter rotation, flip and integer scale preserve exact RGBA including transparent RGB',()=>{
  const bitmap=source(), rotated=transformBitmap(bitmap,2,2,90);
  assert.deepEqual(pixel(rotated,0,0),pixel(bitmap,0,1));assert.deepEqual(pixel(rotated,1,0),pixel(bitmap,0,0));
  assert.deepEqual(pixel(rotated,0,1),pixel(bitmap,1,1));
  const flipped=transformBitmap(bitmap,2,2,0,true);assert.deepEqual(pixel(flipped,0,0),pixel(bitmap,1,0));
  const scaled=transformBitmap(bitmap,4,6,0,false,false,'nearest');assert.deepEqual(pixel(scaled,3,5),pixel(bitmap,1,1));
  assert.equal(transformBitmap(bitmap,2,2,45).width,3);assert.throws(()=>transformBitmap(bitmap,8192,8192,0),/尺寸/);
});
test('crop preserves all layer bytes, moves root coordinates once, and restores selection on undo',()=>{
  const doc=ImageDocument.create('裁剪',20,20);doc.addLayer({...makeLayer('组',null,'group'),x:5,y:4});doc.addLayer({...makeLayer('子层',source()),x:2,y:3});
  doc.setSelection({x:4,y:5,width:10,height:9});const before=doc.state;doc.cropToSelection();
  assert.equal(doc.state.width,10);assert.equal(doc.state.height,9);assert.equal(doc.state.selection,null);
  assert.equal(doc.state.layers[1].x,1);assert.equal(doc.state.layers[1].y,-1);assert.equal(doc.selected.x,2);assert.equal(doc.selected.y,3);assert.equal(doc.selected.bitmap,before.layers[1].children[0].bitmap);
  doc.history.undo();assert.equal(doc.state,before);doc.history.redo();assert.equal(doc.state.width,10);doc.dispose();
});
test('crop rejects any locked layer atomically; malformed selection does not enter recovery',()=>{
  const doc=ImageDocument.create('锁定裁剪',20,20);doc.setSelection({x:2,y:2,width:8,height:9});doc.updateLayer(doc.selected.id,{locked:true});const before=doc.state;
  assert.throws(()=>doc.cropToSelection(),/解锁/);assert.equal(doc.state,before);
  assert.throws(()=>doc.setSelection({x:0,y:0,width:21,height:10}),/选区/);assert.equal(doc.state,before);
  const payload=JSON.parse(serializeProject(doc.state));payload.document.selection.x=-1;assert.throws(()=>deserializeProject(JSON.stringify(payload)),/选区/);doc.dispose();
});
test('edited project roundtrip preserves pixels and selection; P1 projects still open',()=>{
  const doc=ImageDocument.create('工程',8,8);doc.setSelection({x:1,y:2,width:3,height:4});const layer=fillPixels(doc.state,doc.selected.id,[120,50,90]);doc.replaceLayerPixels(layer.id,layer,'填充');
  const reopened=deserializeProject(serializeProject(doc.state));assert.deepEqual(reopened.layers,doc.state.layers);assert.deepEqual(reopened.selection,doc.state.selection);
  const old=JSON.parse(serializeProject(doc.state));delete old.document.selection;assert.equal(deserializeProject(JSON.stringify(old)).width,8);doc.dispose();
});
