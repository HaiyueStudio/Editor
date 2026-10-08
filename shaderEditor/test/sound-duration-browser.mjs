import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/sound-duration');
mkdirSync(out,{recursive:true});
const supplied=process.argv[2];
const source=supplied?readFileSync(supplied,'utf8'):'vec2 mainSound(int sampleIndex,float t){float note=t<40.?440.:660.;float wave=t>1.&&t<46.?0.25*sin(6.2831853*note*t):0.;return vec2(wave);}';
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:out,timeoutMs:120000,
 readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy")==="false" && shaderEditor.getStatus()?.ready',
 scenario:async({evaluate,click,waitFor})=>{
  const call=async(operation,params={})=>{
   const r=await evaluate(`(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:${JSON.stringify(operation)},params:${JSON.stringify(params)}});})()`);
   assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
  };
  await call('shader.playback.set',{playing:false});
  // Test GPU offsets beyond f32 exact integers and across signed/unsigned wrap.
  const offsets=await evaluate(`(async()=>{
   const [{createSoundRenderer},{createProject}]=await Promise.all([import('/shaderEditor/dist/sound.js'),import('/shaderEditor/dist/model.js')]);
   const device=await(await navigator.gpu.requestAdapter()).requestDevice();
   const texture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const project=createProject();project.sound.code='fn mainSound(index:i32,time:f32)->vec2f { return vec2f(f32(bitcast<u32>(index)%101u)/100.0,time/200000.0); }';
   const renderer=await createSoundRenderer(device,project,Array.from({length:4},()=>({view:texture.createView(),width:1,height:1})),device.createSampler());
   try { const result=[];for(const start of [16777217,2147483647,4294967294]){const block=await renderer.render(start,8);result.push({start,left:Array.from(block.left),right:Array.from(block.right)});}return result; }
   finally {renderer.dispose();texture.destroy();device.destroy();}
  })()`);
  for(const block of offsets)for(let i=0;i<8;i++){
   assert.ok(Math.abs(block.left[i]-(((block.start+i)>>>0)%101)/100)<1e-6,'exact long-running sample index');
   assert.ok(Math.abs(block.right[i]-(block.start+i)/44100/200000)<1e-6,'continuous time across sample wrap');
  }
  const converted=await call('shader.glsl.translate',{pass:'sound',code:source});assert.deepEqual(converted.diagnostics,[]);
  await call('shader.code.set',{pass:'sound',code:converted.code});await call('shader.pass.enable',{pass:'sound',enabled:true});
  const render=async duration=>{
   await call('shader.sound.configure',{duration});
   const result=await call('shader.compile');assert.equal(result.compiled,true,JSON.stringify(result));
   const exported=await call('shader.sound.export');
   return evaluate(`(()=>{const bytes=haiyueEditor.readResource(${JSON.stringify(exported.resourceId)}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const count=view.getUint32(40,true)/4,rate=view.getUint32(24,true),levels=[];for(let s=0;s<count/rate;s++){let sum=0,peak=0;for(let i=s*rate;i<Math.min((s+1)*rate,count);i++){const value=view.getInt16(44+i*4,true)/32768;sum+=value*value;peak=Math.max(peak,Math.abs(value));}levels.push({second:s,rms:Math.sqrt(sum/rate),peak});}haiyueEditor.releaseResource(${JSON.stringify(exported.resourceId)});return {duration:count/rate,levels};})()`);
  };
  const short=await render(16),complete=await render(60);
  assert.equal(short.duration,16);assert.equal(complete.duration,60);
  for(const second of [2,15,16,20,30,38,41,45])assert.ok(complete.levels[second].rms>.001,'missing audio at '+second+' seconds');
  for(let second=0;second<16;second++)assert.ok(Math.abs(short.levels[second].rms-complete.levels[second].rms)<1e-5);
  assert.equal(complete.levels[0].peak,0);assert.equal(complete.levels[59].peak,0);
  await call('shader.sound.configure',{duration:1,volume:0});
  await call('shader.playback.reset');
  await click('document.getElementById("sound-toggle")');
  const until=supplied?47:18;
  await waitFor(()=>evaluate(`shaderEditor.getStatus().time>${until} && shaderEditor.getStatus().sound.playing`),'continuous playback past export duration',65000);
  const streaming=await evaluate('shaderEditor.getStatus().sound');
  assert.equal(streaming.continuous,true);assert.ok(streaming.bufferedUntil>until);
  await call('shader.playback.set',{playing:false});assert.equal(await evaluate('shaderEditor.getStatus().sound.playing'),false);
  return {status:'passed',streaming,source:supplied?'user supplied Mario Sound shader':'synthetic extended music',short,complete};
 }});
writeFileSync(resolve(out,supplied?'mario-report.json':'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,source:report.source,shortDuration:report.short.duration,completeDuration:report.complete.duration,levels:report.complete.levels.filter(v=>[0,15,16,20,30,38,41,45,46,59].includes(v.second))},null,2));
