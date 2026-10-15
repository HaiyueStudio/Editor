import test from 'node:test';import assert from 'node:assert/strict';
import {residentGpuPlan,residentTilePlan,gpuFilters} from '../dist/residentGpuPlan.js';
import {previewFingerprint,previewFingerprintStats} from '../dist/previewCache.js';
import {regionalMaskWeight,effectiveMaskWeight} from '../dist/maskEffects.js';
import {diskPager} from '../dist/diskPager.js';
const pages=new Map();diskPager.store.read=async k=>pages.get(k);diskPager.store.write=async(k,b)=>pages.set(k,b.slice());
import {makeLayer,ImageDocument} from '../dist/document.js';
import {pagedBitmap,packBitmap,spillBitmap,clearPagedPixelCache} from '../dist/pagedPixels.js';
const bitmap=(w=16,h=12)=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%256)});
const fixture=()=>{const layers=Array.from({length:40},(_,i)=>({...makeLayer('Layer '+i,bitmap()),x:i*30}));return {id:'p2',name:'P2',width:9001,height:512,layers,selectedId:layers[0].id,revision:1};};
test('resident plan accepts many layers and culls per tile without crossing clipping group boundaries',()=>{
 const s=fixture(),plan=residentGpuPlan(s);assert.equal(plan.runs.length,40);assert.equal(residentTilePlan(plan,{x:0,y:0,width:256,height:256}).runs.length,9);
 const [base,clip]=s.layers;s.layers=[{...clip,clipping:true},{...base,x:300},{...clip,x:0,clipping:true},{...base,id:'hidden',visible:false},{...clip,clipping:true}];
 const p=residentGpuPlan(s);assert.equal(p.runs.length,1);assert.equal(p.runs[0].clips.length,1);assert.equal(residentTilePlan(p,{x:0,y:0,width:256,height:256}).runs.length,0);
 const group={...makeLayer('group'),kind:'group',passThrough:true,x:50,children:[base,{...clip,clipping:true}]};s.layers=[group,{...clip,clipping:true},base];assert.equal(residentGpuPlan(s),undefined,'a clipped group requires reference semantics');
 s.layers=[group,base];const nested=residentGpuPlan(s);assert.equal(nested.runs.length,2);assert.equal(nested.runs[0].base.x,50);assert.equal(nested.runs[0].clips.length,1);
});
test('complex effects fall back locally while global color and adjustment semantics stay conservative',()=>{
 const s=fixture(),base=s.layers[0];s.layers=[{...base,blendIf:{enabled:true}},...s.layers.slice(1)];const p=residentGpuPlan(s);
 assert(residentTilePlan(p,{x:0,y:0,width:256,height:256}).reference);assert(!residentTilePlan(p,{x:512,y:0,width:256,height:256}).reference);
 for(const patch of [{bitDepth:16},{bitDepth:32},{colorMode:'cmyk'},{icc:{}},{layers:[{...base,content:{type:'adjustment'}}]}])assert.equal(residentGpuPlan({...s,...patch}),undefined);
 assert(gpuFilters({...base,smartFilters:[{enabled:true,opacity:1,blend:'normal',settings:{kind:'invert'}}]}));assert(!gpuFilters({...base,smartFilters:[{enabled:true,opacity:1,blend:'normal',settings:{kind:'blur'}}]}));
});
test('bounded feather mask sampling matches dense reference including exterior and density',()=>{
 for(const precision of ['byte','float'])for(const defaultColor of [0,255])for(const feather of [0,1.2,3]){
 const m={x:-3,y:2,width:17,height:11,data:(precision==='byte'?Uint8Array:Float32Array).from({length:187},(_,i)=>(i*1.237)%255),disabled:false,defaultColor,density:.63,feather};
 for(let y=-9;y<25;y++)for(let x=-15;x<35;x++)assert(Math.abs(regionalMaskWeight(m,x,y)-effectiveMaskWeight(m,x,y))<1e-6);
 }
});
test('fingerprints reuse immutable bytes and layer paths, remain content-addressed across views and branches',async()=>{
 const s=fixture(),before=previewFingerprintStats(),key=await previewFingerprint(s,'gpu'),warm=previewFingerprintStats();assert(warm.bufferHashes-before.bufferHashes>=40);
 assert.equal(await previewFingerprint(s,'gpu'),key);const repeat=previewFingerprintStats();assert.equal(repeat.bufferBytes,warm.bufferBytes);assert.equal(repeat.layerHashes,warm.layerHashes);
 const changed={...s,layers:s.layers.map((l,i)=>i===3?{...l,opacity:.5}:l)};assert.notEqual(await previewFingerprint(changed,'gpu'),key);const edit=previewFingerprintStats();assert.equal(edit.bufferBytes,warm.bufferBytes);assert.equal(edit.layerHashes-repeat.layerHashes,1);
 assert.equal(await previewFingerprint({...s,layers:structuredClone(s.layers)},'gpu'),key);assert.equal(await previewFingerprint(s,'gpu'),key);assert.notEqual(await previewFingerprint(s,'reference'),key);
 const backing=new Uint8Array([11,22,33,44,55]),a={...s,layers:[makeLayer('a',{width:1,height:1,data:new Uint8ClampedArray(backing.buffer,1,4)})]},b={...s,layers:[makeLayer('b',{width:1,height:1,data:new Uint8ClampedArray([22,33,44,55])})]};assert.equal(await previewFingerprint(a,'gpu'),await previewFingerprint(b,'gpu'));
});
test('paging conversions invalidate structural memoization without reading a dense pixel getter',async()=>{
 const b=bitmap(),s={...fixture(),layers:[makeLayer('paged',b)]};await previewFingerprint(s,'gpu');await spillBitmap(b);const pagedKey=await previewFingerprint(s,'gpu');clearPagedPixelCache();assert.equal(await previewFingerprint(s,'gpu'),pagedKey);
 const huge=pagedBitmap(30000,30000,{kind:'psd-rgb8',channels:[]});assert.equal(typeof await previewFingerprint({...s,layers:[makeLayer('huge',huge)]},'gpu'),'string');
});

test('real document commits preserve unchanged layer identities and masked GPU inputs',async()=>{
 const s=fixture(),m={x:0,y:0,width:16,height:12,data:new Uint8Array(192).fill(200),defaultColor:0,disabled:false};s.layers=s.layers.map(l=>({...l,mask:m}));const doc=new ImageDocument(s),old=doc.state;
 await previewFingerprint(old,'gpu');const before=previewFingerprintStats();doc.updateLayer(old.layers[3].id,{opacity:.5});const next=doc.state;
 for(let i=0;i<40;i++){if(i!==3)assert.equal(next.layers[i],old.layers[i]);assert.equal(next.layers[i].mask,old.layers[i].mask);assert(Object.isFrozen(next.layers[i]));}
 assert.notEqual(await previewFingerprint(next,'gpu'),await previewFingerprint(old,'gpu'));const after=previewFingerprintStats();assert.equal(after.layerHashes-before.layerHashes,1);assert.equal(after.bufferBytes,before.bufferBytes);
 doc.history.undo();assert.equal(await previewFingerprint(doc.state,'gpu'),await previewFingerprint(old,'gpu'));doc.dispose();
});

test('nested edits only replace the changed ancestor path, preserving other groups and undo',async()=>{
 const s=fixture(),group=children=>({...makeLayer('group',null,'group'),passThrough:true,children});s.layers=[group(s.layers.slice(0,20)),group(s.layers.slice(20))];const doc=new ImageDocument(s),old=doc.state;
 await previewFingerprint(old,'gpu');const before=previewFingerprintStats();doc.updateLayer(old.layers[0].children[3].id,{opacity:.5});assert.equal(doc.state.layers[1],old.layers[1]);await previewFingerprint(doc.state,'gpu');assert.equal(previewFingerprintStats().layerHashes-before.layerHashes,2);
 doc.history.undo();assert.equal(doc.state.layers[1],old.layers[1]);doc.dispose();
});

test('paged metadata commits retain unchanged disk/compressed layers through packing and lock validation',async()=>{
 const s=fixture();s.layers=s.layers.map(l=>({...l,bitmap:packBitmap(l.bitmap)}));const doc=new ImageDocument(s),old=doc.state;await previewFingerprint(old,'gpu');const before=previewFingerprintStats();doc.updateLayer(old.layers[2].id,{opacity:.4});for(let i=0;i<40;i++)if(i!==2)assert.equal(doc.state.layers[i],old.layers[i]);await previewFingerprint(doc.state,'gpu');assert.equal(previewFingerprintStats().layerHashes-before.layerHashes,1);assert.equal(previewFingerprintStats().bufferBytes,before.bufferBytes);doc.dispose();
});
