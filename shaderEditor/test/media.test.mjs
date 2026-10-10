import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardState, keyboardCode } from '../dist/keyboardTexture.js';
import { BUILTIN_TEXTURES, builtinTexture } from '../dist/builtinTextures.js';
import { createProject, validateProject, parseProject, channelTypes } from '../dist/model.js';
import { readFileSync } from 'node:fs';
test('keyboard held/press/toggle rows use bottom-left texture coordinates and one pulse per physical press', () => {
  const keys = new KeyboardState(), value=(key,row)=>keys.pixels()[((2-row)*256+key)*4];
  assert.equal(keys.down(65),true);
  assert.deepEqual([0,1,2].map(r=>value(65,r)),[255,255,255]);
  assert.equal(keys.down(65),false); assert.equal(keys.endFrame(),true); assert.equal(keys.endFrame(),false);
  assert.deepEqual([0,1,2].map(r=>value(65,r)),[255,0,255]);
  keys.up(65); assert.equal(value(65,0),0); keys.down(65);
  assert.deepEqual([0,1,2].map(r=>value(65,r)),[255,255,0]);
  keys.release(); assert.deepEqual([0,1,2].map(r=>value(65,r)),[0,0,0]);
  keys.down(90); keys.up(90); assert.equal(value(90,1),255,'quick taps remain visible until rendered');
  keys.release(); assert.equal(value(90,2),255,'blur retains toggle'); keys.reset(); assert.equal(value(90,2),0);
  for(const code of [-1,256,NaN,1.5]) assert.equal(keys.down(code),false);
  assert.equal(keyboardCode({code:'KeyA',keyCode:0}),65);
  assert.equal(keyboardCode({code:'Digit7',keyCode:0}),55);
  assert.equal(keyboardCode({code:'ArrowLeft',keyCode:0}),37);
});
test('built-in assets are packaged, generated images are 512 square, and channels round-trip without embedding images',()=>{
  const descriptor=JSON.parse(readFileSync(new URL('../app/descriptor.json',import.meta.url)));
  for(const asset of BUILTIN_TEXTURES){
    const info=builtinTexture(asset.id);
    assert.ok(descriptor.staticFiles.includes('assets/'+asset.file));
    const png=readFileSync(new URL('../assets/'+asset.file,import.meta.url));
    if(['future-city','webgpu'].includes(asset.id)) assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[512,512]);
    const p=createProject();p.passes[4].channels[0]={kind:'builtin',texture:asset.id};
    p.passes[4].channels[1]={kind:'keyboard'};
    assert.deepEqual(parseProject(JSON.stringify(p)),p);assert.equal(p.assets.length,0);
    assert.deepEqual(channelTypes(p.passes[4].channels),['2d','2d',null,null]);
    assert.match(info.url,/^\.\/assets\//);
  }
  assert.throws(()=>builtinTexture('../secret'));
});
test('video resources validate independently from images and cube resources',()=>{
  const p=createProject();p.assets=[{kind:'video',id:'clip',name:'clip.webm',dataUrl:'data:video/webm;base64,AAAA'}];
  p.passes[4].channels[0]={kind:'video',assetId:'clip'};
  assert.deepEqual(parseProject(JSON.stringify(p)),p);
  for(const change of [q=>q.passes[4].channels[0].kind='image',q=>q.assets[0].dataUrl='https://example.org/video.mp4',q=>q.assets[0].dataUrl='data:image/png;base64,AAAA',
    q=>q.passes[4].channels[0]={kind:'builtin',texture:'missing'}]){
    const q=structuredClone(p);change(q);assert.throws(()=>validateProject(q));
  }
});
