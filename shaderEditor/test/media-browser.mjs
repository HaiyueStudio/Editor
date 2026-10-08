import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
import { examples } from '../dist/examples.js';
const root=resolve(import.meta.dirname,'../..'), output=resolve(root,'shaderEditor/artifacts/media');
mkdirSync(output,{recursive:true}); const downloads=resolve(output,'downloads');mkdirSync(downloads,{recursive:true});
const report=await runEditorBrowserScenario({root,downloadDirectory:downloads,route:'shaderEditor/app-dist/index.html#editor',
 failureScreenshotPath:resolve(output,'failure.png'),timeoutMs:45000,
 readinessExpression:'window.shaderEditor?.getStatus()?.ready && !document.getElementById("compile").disabled',
 scenario:async driver=>{
 const {evaluate,click,waitFor,nextPaint,cdp,setFileInputFiles}=driver, checks=[];
 const api=(operation,params={})=>evaluate(`(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:${JSON.stringify(operation)},params:${JSON.stringify(params)}});})()`);
 const call=async(op,p)=>{const r=await api(op,p);assert.equal(r.status,'completed',JSON.stringify(r));return r.value;};
 const compile=async()=>{const r=await call('shader.compile');assert.equal(r.compiled,true,JSON.stringify(r));await call('shader.playback.step');};
 const shot=async name=>{await nextPaint();const s=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(output,name),Buffer.from(s.result.data,'base64'));};
 const sample=async()=>{
   const r=await call('shader.image.read');
   return evaluate(`(()=>{const data=haiyueEditor.readResource(${JSON.stringify(r.resourceId)}),w=${r.width},h=${r.height};
   const at=(x,y)=>Array.from(data.slice((y*w+x)*4,(y*w+x)*4+4));
   let sum=0,bright=0;for(let i=0;i<data.length;i+=4){sum=(sum+data[i]*(i+1))%1000000007;if(data[i]>60)bright++;}
   const out={center:at(w>>1,h>>1),top:at(w>>1,h>>2),bottom:at(w>>1,h*3>>2),sum,bright};haiyueEditor.releaseResource(${JSON.stringify(r.resourceId)});return out;})()`);
 };
 const key=async(type,letter,repeat=false)=>cdp.call('Input.dispatchKeyEvent',{type,key:letter.toLowerCase(),code:'Key'+letter,windowsVirtualKeyCode:letter.charCodeAt(0),autoRepeat:repeat});
 await call('shader.playback.set',{playing:false});
 const catalog=await call('shader.textures.list');assert.equal(catalog.length,8);
 const options=await evaluate('document.querySelector("#channels ge-select").options');
 assert.equal(options.filter(o=>o.value.startsWith("builtin:")).length,8);
 assert.ok(options.some(o=>o.value==='keyboard'));
 await call('shader.code.set',{pass:'image',code:'fn mainImage(p:vec2f)->vec4f{return channel0(p/iResolution.xy);}'});
 for(const id of ['future-city','webgpu','noise-small','blue-noise']){
   await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'builtin',texture:id}});await compile();
   const pixels=await sample();assert.ok(pixels.bright>100,JSON.stringify({id,pixels}));
 }
 checks.push('8 built-in options; generated city, WebGPU, noise and blue noise load and sample on GPU');
 const keyboardProject=examples().find(e=>e.id==='keyboard').project;
 const resource=await evaluate(`haiyueEditor.putResource(new TextEncoder().encode(${JSON.stringify(JSON.stringify(keyboardProject))}))`);
 await call('shader.project.open',{resourceId:resource.resourceId});await evaluate(`haiyueEditor.releaseResource(${JSON.stringify(resource.resourceId)})`);
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'example open');
 await compile(); const a=await sample();assert.ok(a.bright>100);
 await click('document.getElementById("shader-canvas")');
 await key('keyDown','B');await nextPaint();await key('keyUp','B');await nextPaint();
 const b=await sample();assert.notEqual(a.sum,b.sum);await shot('msdf-B.png');
 await call('shader.playback.step');assert.equal((await sample()).sum,b.sum,'released character retained in Buffer A');
 await key('keyDown','Z');await nextPaint();await key('keyUp','Z');await nextPaint();
 const z=await sample();assert.notEqual(z.sum,b.sum);await shot('msdf-Z.png');
 checks.push('MSDF A/B/Z render distinct glyphs; last character persists after key release while paused');
 await call('shader.code.set',{pass:'buffer-a',code:`fn mainImage(p:vec2f)->vec4f{
 let pulse=channel0(vec2f(65.5/256.0,1.5/3.0)).r;
 let count=channel1(vec2f(0.5)).b + pulse * 0.1;
 return vec4f(channel0(vec2f(65.5/256.0,0.5/3.0)).r,channel0(vec2f(65.5/256.0,2.5/3.0)).r,count,1.0);
}`});
 await call('shader.code.set',{pass:'image',code:'fn mainImage(p:vec2f)->vec4f{return channel0(vec2f(0.5));}'});
 await compile();await click('document.getElementById("shader-canvas")');
 await key('keyDown','A');await nextPaint();let p=await sample();assert.equal(p.center[0],255);assert.equal(p.center[1],255);assert.ok(Math.abs(p.center[2]-26)<=1,JSON.stringify(p));
 await key('keyDown','A',true);await call('shader.playback.step');assert.equal((await sample()).center[2],p.center[2],'repeat does not repulse');
 await key('keyUp','A');await nextPaint();assert.equal((await sample()).center[0],0);
 await key('keyDown','A');await nextPaint();p=await sample();assert.equal(p.center[1],0);assert.ok(Math.abs(p.center[2]-51)<=1);
 await click('document.querySelector("#code-editor .cm-content")');await nextPaint();assert.equal((await sample()).center[0],0,'blur releases held');
 await key('keyUp','A'); await key('keyDown','A');await key('keyUp','A');await nextPaint();assert.equal((await sample()).center[2],p.center[2],'code editing does not feed keyboard texture');
 checks.push('Real keyboard events validate held, one-frame press, toggle, repeat suppression and focus isolation');
 // A short browser-encoded changing video, with vertical color markers for orientation.
 const video=await evaluate(`(async()=>{
 const c=document.createElement('canvas');c.width=32;c.height=32;const ctx=c.getContext('2d');let frame=0;
 const draw=()=>{ctx.fillStyle='rgb(220,'+(frame++%120)+',0)';ctx.fillRect(0,0,32,16);ctx.fillStyle='rgb(0,'+(frame%120)+',220)';ctx.fillRect(0,16,32,16);};
 draw();const stream=c.captureStream(30),rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
 rec.ondataavailable=e=>chunks.push(e.data);
 const done=new Promise(resolve=>rec.onstop=resolve);rec.start();const timer=setInterval(draw,33);await new Promise(resolve=>setTimeout(resolve,2200));rec.stop();await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
 const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let text='';for(const n of bytes)text+=String.fromCharCode(n);return btoa(text);
 })()`);
 const fixture=resolve(output,'clip.webm');writeFileSync(fixture,Buffer.from(video,'base64'));
 await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
 await call('shader.code.set',{pass:'image',code:'fn mainImage(p:vec2f)->vec4f{return channel0(p/iResolution.xy);}'});
 await click('document.querySelector(".upload-video")');await setFileInputFiles('#video-input',[fixture]);
 await waitFor(()=>evaluate('shaderEditor.getProject().assets.some(a=>a.kind==="video") && !document.getElementById("compile").disabled'),'video uploaded');
 const project=await evaluate('shaderEditor.getProject()'),asset=project.assets.find(a=>a.kind==='video');
 assert.equal(project.passes[4].channels[0].assetId,asset.id);
 await compile();let v=await sample();assert.ok(v.top[0]>180 && v.top[2]<20 && v.bottom[2]>180 && v.bottom[0]<20,JSON.stringify(v));
 await call('shader.playback.set',{playing:true});
 const initial=v.sum;await waitFor(async()=>{v=await sample();return v.sum!==initial;},'video pixels advance');
 await call('shader.playback.set',{playing:false});await nextPaint();const paused=await sample();await nextPaint();assert.equal((await sample()).sum,paused.sum);
 await call('shader.channel.set',{pass:'image',index:1,channel:{kind:'video',assetId:asset.id}});
 await call('shader.code.set',{pass:'image',code:'fn mainImage(p:vec2f)->vec4f{let c=channel0(p/iResolution.xy);let d=channel1(p/iResolution.xy);return vec4f(c.r,abs(c.g-d.g),c.b,1.0);}'});
 await compile();assert.equal((await sample()).top[1],0,'shared video updates once for all channels');
 await call('shader.code.set',{pass:'image',code:'fn mainImage(p:vec2f)->vec4f{return vec4f(iChannelResolution[0].xy/32.0,iChannelTime[0],1.0);}'});
 await compile();await call('shader.playback.set',{playing:true});
 await waitFor(async()=>((await sample()).center[2]>30),'iChannelTime reports playback');
 await call('shader.playback.set',{playing:false});await call('shader.playback.reset');await nextPaint();assert.ok((await sample()).center[2]<8);
 const exported=await call('shader.project.export');await call('shader.project.open',{resourceId:exported.resourceId});await evaluate(`haiyueEditor.releaseResource(${JSON.stringify(exported.resourceId)})`);
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'video reopen');await compile();
 assert.equal((await evaluate('shaderEditor.getProject()')).assets[0].dataUrl,asset.dataUrl);
 await call('shader.playback.set',{playing:false});await call('shader.playback.step');await nextPaint();
 const stepped=(await sample()).center[2];await call('shader.playback.step');await nextPaint();assert.ok((await sample()).center[2]>stepped,'video advances on successive steps');
 await call('shader.preview.set',{mode:'scene',mesh:'sphere'});await nextPaint();assert.equal(await evaluate('shaderEditor.getStatus().mode'),'scene');
 await call('shader.preview.set',{mode:'canvas',mesh:'sphere'});
 await evaluate('document.getElementById("save-project").scrollIntoView({block:"center"})');await click('document.getElementById("save-project")');
 await waitFor(()=>evaluate('document.getElementById("save-state").textContent.includes("已保存")'),'video save');
 const origin=await evaluate('performance.timeOrigin');await cdp.call('Page.reload',{ignoreCache:true});
 await waitFor(()=>evaluate(`performance.timeOrigin !== ${origin} && shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled`),'video reload');
 assert.equal((await evaluate('shaderEditor.getProject()')).assets[0].dataUrl,asset.dataUrl);await call('shader.playback.set',{playing:false});await compile();
 checks.push('Video supports successive single steps, scene preview, explicit Save and reload with embedded bytes intact');
 const revision=(await call('shader.query')).revision;
 const invalid=await evaluate("haiyueEditor.putResource(new Uint8Array([1,2,3,4]))");
 const failed=await api('shader.video.upload',{resourceId:invalid.resourceId,name:'bad.webm',mimeType:'video/webm'});
 await evaluate(`haiyueEditor.releaseResource(${JSON.stringify(invalid.resourceId)})`);
 assert.equal(failed.status,'failed');assert.equal((await call('shader.query')).revision,revision);
 checks.push('Video file upload, orientation, playback/pause/reset, shared channels, time/resolution, export/import and atomic invalid decode verified');
 const tanh=await call('shader.glsl.translate',{code:'void mainImage(out vec4 c,in vec2 p){vec4 a=tanh(vec4(-2.0,-1.0,0.0,1.0));vec3 b=tanh(vec3(-2.0,-1.0,0.0));vec2 d=tanh(vec2(-1.0,1.0));float s=tanh(0.0);if(distance(a.xyz,b)>0.001||distance(a.yw,d)>0.001||s!=0.0){c=vec4(1.0,0.0,0.0,1.0);return;}c=a*0.5+0.5;}'});
 assert.ok(tanh.code,JSON.stringify(tanh));await call('shader.code.set',{pass:'image',code:tanh.code});await compile();
 const tanhPixel=(await sample()).center;[-2,-1,0,1].forEach((x,i)=>assert.ok(Math.abs(tanhPixel[i]-Math.round((Math.tanh(x)*0.5+0.5)*255))<=1,JSON.stringify(tanhPixel)));
 checks.push('GLSL tanh float and vec2/3/4 compile natively and match expected GPU results');
 driver.assertNoBrowserErrors();return {checks};
}});
writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
