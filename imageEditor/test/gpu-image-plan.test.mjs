import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gpuImageLayers,gpuDisplayProfile} from '../dist/gpuImagePlan.js';
import {makeLayer} from '../dist/document.js';
const b={width:4,height:3,data:new Uint8ClampedArray(48)},layer=()=>makeLayer('pixels',b),state=ls=>({id:'gpu',name:'gpu',width:100,height:100,layers:ls,revision:1});
test('GPU flattens pass-through coordinates without changing opacity or ordering',()=>{const a=layer(),c=layer(),g={...makeLayer('group',null,'group'),passThrough:true,x:5,y:7,children:[{...a,x:3,y:2},c]};assert.deepEqual(gpuImageLayers(state([g])).map(l=>[l.layer.id,l.x,l.y]),[[a.id,8,9],[c.id,5,7]]);assert.equal(gpuImageLayers(state([{...g,opacity:.5}])),undefined);});
test('GPU admission keeps nonlocal/isolated/high-depth semantics on reference compositor',()=>{const l=layer();for(const patch of [{clipping:true},{styles:{enabled:true}},{smartFilters:[{enabled:true}]},{blendIf:{enabled:true}},{kind:'adjustment',content:{type:'adjustment'}}])assert.equal(gpuImageLayers(state([{...l,...patch}])),undefined);for(const patch of [{bitDepth:32},{bitDepth:16},{colorMode:'cmyk'}])assert.equal(gpuImageLayers({...state([l]),...patch}),undefined);assert.deepEqual(gpuImageLayers(state([{...l,visible:false}])),[]);});
test('explicit ICC workflows bypass GPU matrix conversion and unprofiled RGB stays encoded',()=>{assert.equal(gpuDisplayProfile({...state([]),icc:{intent:1}}),undefined);assert.equal(gpuDisplayProfile(state([])).curves.length,0);});
