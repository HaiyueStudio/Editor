import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';import {readPsd} from 'ag-psd';
import {importPsd,exportPsd} from '../dist/psdAdapter.js';import {psdSections,resourceBlocks,additionalInfoKeys} from '../dist/psdResources.js';
import {serializeProject,deserializeProject} from '../dist/projectFile.js';import {ImageDocument,makeLayer} from '../dist/document.js';import {cases,bitmap} from './p3-cases.mjs';
const fixture=name=>new Uint8Array(readFileSync(new URL(`./fixtures/${name}`,import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL('./fixtures/manifest.json',import.meta.url)));
for(const entry of cases())test(`P3 layer bytes, Unicode, group properties and alpha roundtrip: ${entry.id}`,()=>{
  const before=serializeProject(entry.state),result=exportPsd(entry.state),opened=importPsd(result.bytes,entry.id+'.psd');
  assert(opened.layered,opened.blockers.join('\n'));assert.equal(opened.layered.width,entry.state.width);assert(result.maxPremultipliedError<=1);assert.equal(serializeProject(entry.state),before);
  const psd=readPsd(result.bytes,{useImageData:true,skipThumbnail:true});assert(psd.imageData);
  const compositeOffset=psdSections(result.bytes).composite;assert.equal(new DataView(result.bytes.buffer).getUint16(compositeOffset),0);
});
test('real unsupported features require explicit flattened fallback; bad modes and depth refuse',()=>{
  for(const sample of manifest.samples){const bytes=fixture(sample.file);assert.equal(bytes.length,sample.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),sample.sha256);}
  for(const name of ['text-layer','layer-mask','smart-object','adjustment-layers','effects','groups']){const result=importPsd(fixture(name+'.psd'),name+'.psd');assert.equal(result.layered,null,name);assert(result.blockers.length);assert(result.flattened,name);assert.equal(result.flattened.layers.length,1);assert.equal(result.flattened.psdOrigin.flattened,true);}
  for(const name of ['cmyk.psd','16bits.psd','32bits.psd','psb.psb'])assert.throws(()=>importPsd(fixture(name),name));
  const noComposite=importPsd(fixture('pass-through.psd'),'pass-through.psd');assert.equal(noComposite.flattened,null);
});
test('ICC and opaque resources survive export and project recovery as exact raw bytes',()=>{
  const original=importPsd(fixture('layers.psd'),'layers.psd');assert(original.layered,original.blockers.join('\n'));
  const state=deserializeProject(serializeProject(original.layered));assert.deepEqual(state.psdOrigin.resources,original.layered.psdOrigin.resources);
  const out=exportPsd(state),sections=psdSections(out.bytes),blocks=resourceBlocks(out.bytes.slice(sections.resources.data,sections.resources.end));
  assert(out.preservedResourceIds.includes(1039));for(const source of resourceBlocks(state.psdOrigin.resources))assert.deepEqual(blocks.find(block=>block.id===source.id).bytes,source.bytes);
  const bad=JSON.parse(serializeProject(state));bad.document.psdOrigin.resources='!!!!';assert.throws(()=>deserializeProject(JSON.stringify(bad)),/资源/);
});
test('unknown additional blocks are detected independently of codec warnings',()=>{
  const d=ImageDocument.create('未知块',8,8);d.addLayer(makeLayer('像素',bitmap(4,4,[1,2,3,255])));const bytes=exportPsd(d.state).bytes;
  const at=Buffer.from(bytes).indexOf(Buffer.from('luni'));assert(at>0);bytes.set([90,90,90,90],at);
  assert(additionalInfoKeys(bytes).includes('ZZZZ'));const imported=importPsd(bytes,'unknown.psd');assert.equal(imported.layered,null);assert(imported.blockers.some(item=>item.includes('ZZZZ')));assert(imported.flattened);
});
test('empty document export is valid; geometry and truncated resource sections fail before decode',()=>{
  const d=ImageDocument.create('空白',2,2);d.deleteSelected();assert(importPsd(exportPsd(d.state).bytes,'blank.psd').layered);
  const bytes=fixture('layer-offsets-read.psd');for(const end of [0,25,60,bytes.length-5])assert.throws(()=>importPsd(bytes.slice(0,end),'truncated.psd'));
  const tooLarge=bytes.slice();new DataView(tooLarge.buffer).setUint32(18,9000);assert.throws(()=>importPsd(tooLarge,'large.psd'),/尺寸/);
  assert.throws(()=>resourceBlocks(new Uint8Array([56,66,73,77,0,1,0])),/截断/);
});
