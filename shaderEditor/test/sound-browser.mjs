import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),output=resolve(root,'shaderEditor/artifacts/sound'),downloads=resolve(output,'downloads-'+Date.now());mkdirSync(downloads,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:downloads,failureScreenshotPath:resolve(output,'failure.png'),timeoutMs:45000,
readinessExpression:'shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async driver=>{
 const {evaluate,click,waitFor,cdp,nextPaint}=driver;
 const call=async(operation,params={})=>{
   const r=await evaluate('(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:"1",requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:'+JSON.stringify(operation)+',params:'+JSON.stringify(params)+'});})()');
   assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
 };
 const read=async()=>{
   const f=await call('shader.sound.export');
   return evaluate('(()=>{const b=haiyueEditor.readResource('+JSON.stringify(f.resourceId)+');const bytes=Array.from(b);haiyueEditor.releaseResource('+JSON.stringify(f.resourceId)+');return bytes;})()');
 };
 const compile=async()=>{const r=await call('shader.compile');assert.equal(r.compiled,true,JSON.stringify(r));};
 await call('shader.playback.set',{playing:false});
 await call('shader.pass.add',{pass:'sound'});
 await click('document.querySelector("[data-pass=sound]")');
 assert.equal(await evaluate('document.getElementById("sound-settings").hidden'),false,"line 21");
 assert.ok(await evaluate('document.getElementById("code-editor").textContent.includes("mainSound")'));
 assert.equal(await evaluate('document.querySelectorAll("#pass-tabs button").length'),2);
 await call('shader.sound.configure',{duration:1,volume:.25});await call('shader.pass.enable',{pass:'sound',enabled:true});
 await compile();assert.equal(await evaluate('shaderEditor.getStatus().sound.ready'),true);
 assert.equal(await evaluate('shaderEditor.getStatus().sound.audible'),false,'compile never starts audible playback');
 const defaultBytes=await read();assert.equal(defaultBytes.length,44+44100*4);assert.ok(defaultBytes.slice(44).some(v=>v!==0));
 // Both supported GLSL signatures use the Sound target rather than an Image adapter.
 const source='float gain=.25; vec2 mainSound(int samp,float time){return vec2(gain*sin(6.2831853*440.*time),float(samp%101)/50.0-1.0);}';
 const translated=await call('shader.glsl.translate',{pass:'sound',code:source});assert.ok(translated.code,JSON.stringify(translated));
 await call('shader.code.set',{pass:'sound',code:translated.code});await call('shader.sound.configure',{duration:2});await compile();
 const wave=new Uint8Array(await read()),view=new DataView(wave.buffer);
 assert.equal(wave.length,44+88200*4);assert.equal(view.getUint32(24,true),44100);
 const indices=[0,1,50,100,101,1023,1024,44100,65534,65535,65536,65537,88199];
 for(const i of indices){
   const left=view.getInt16(44+i*4,true)/32768,right=view.getInt16(46+i*4,true)/32768;
   assert.ok(Math.abs(left-.25*Math.sin(6.2831853*440*i/44100))<.001,'left '+i+': '+left);
   assert.ok(Math.abs(right-((i%101)/50-1))<.0001,'right '+i+': '+right);
 }
 // Check actual sine frequency, beyond metadata/sample count checks.
 let crossings=0;for(let i=1;i<44100;i++)if(view.getInt16(44+(i-1)*4,true)<=0 && view.getInt16(44+i*4,true)>0)crossings++;
 assert.ok(Math.abs(crossings-440)<=1);
 // Save exact stereo samples as a reusable verification artifact.
 writeFileSync(resolve(output,'stereo-test.wav'),wave);
 // UI conversion for the legacy single-time signature, with independent Sound highlighting.
 await click('document.getElementById("glsl-button")');
 await click('document.querySelector("#glsl-source .cm-content")');
 await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
 await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65});
 await cdp.call('Input.insertText',{text:'vec2 mainSound(float time){return vec2(0.2*sin(6.2831853*440.*time));}'});
 await click('document.getElementById("translate-glsl")');
 assert.equal(await evaluate('document.getElementById("apply-glsl").disabled'),false,"line 52");
 assert.ok(await evaluate('document.querySelectorAll("#glsl-result .cm-line span").length>5'));
 await click('document.getElementById("apply-glsl")');
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled && shaderEditor.getProject().sound.code.includes("sampleTime")'),'Sound GLSL apply');
 await call('shader.sound.configure',{duration:8});await compile();
 await click('document.getElementById("sound-toggle")');
 await waitFor(()=>evaluate('shaderEditor.getStatus().sound.playing && shaderEditor.getStatus().time>.15'),'explicit gesture starts audio clock');
 await call('shader.playback.set',{playing:false});
 const paused=await evaluate('shaderEditor.getStatus().time');
 assert.equal(await evaluate('shaderEditor.getStatus().sound.playing'),false,'pause stops Sound source');
 await nextPaint();await nextPaint();assert.equal(await evaluate('shaderEditor.getStatus().time'),paused);
 await call('shader.playback.set',{playing:true});
 await waitFor(()=>evaluate('shaderEditor.getStatus().time>'+JSON.stringify(paused+.1)),'resume audio clock');
 await call('shader.playback.reset');assert.ok(await evaluate('shaderEditor.getStatus().time<.12'));
 await click('document.getElementById("nav-gallery")');
 assert.equal(await evaluate('shaderEditor.getStatus().sound.playing'),false,"line 67");
 const hidden=await evaluate('shaderEditor.getStatus().time');await nextPaint();assert.equal(await evaluate('shaderEditor.getStatus().time'),hidden);
 await click('document.getElementById("nav-editor")');
 await waitFor(()=>evaluate('shaderEditor.getStatus().sound.playing'),'return resumes armed sound');
 await nextPaint();
 await click('document.getElementById("sound-toggle")');assert.equal(await evaluate('shaderEditor.getStatus().sound.audible'),false,"line 71");
 await call('shader.playback.set',{playing:false});
 // Shared code and static image channels participate in audio compilation.
 const resource=await evaluate('(async()=>{const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const ctx=canvas.getContext("2d");ctx.fillStyle="rgb(64,128,192)";ctx.fillRect(0,0,1,1);const blob=await new Promise(r=>canvas.toBlob(r));return haiyueEditor.putResource(new Uint8Array(await blob.arrayBuffer()));})()');
 const asset=await call('shader.texture.upload',{resourceId:resource.resourceId,name:'audio-color',mimeType:'image/png'});
 await call('shader.channel.set',{pass:'sound',index:0,channel:{kind:'image',assetId:asset.assetId}});
 await call('shader.channel.set',{pass:'sound',index:3,channel:{kind:'image',assetId:asset.assetId}});
 await call('shader.code.set',{pass:'common',code:'fn soundGain()->f32 { return 0.5; }'});
 const stable='fn mainSound(index:i32,time:f32)->vec2f { return vec2f(channel0(vec2f(0.5)).r, channel3(vec2f(0.5)).g)*soundGain(); }';
 await call('shader.code.set',{pass:'sound',code:stable});await call('shader.sound.configure',{duration:1});await compile();
 const textureBytes=await read(),textureView=new DataView(new Uint8Array(textureBytes).buffer);
 assert.ok(Math.abs(textureView.getInt16(44,true)/32768-64/510)<.0001);
 assert.ok(Math.abs(textureView.getInt16(46,true)/32768-128/510)<.0001);
 await call('shader.sound.configure',{volume:0});assert.deepEqual(await read(),textureBytes,'monitor volume does not alter export');
 await call('shader.code.set',{pass:'sound',code:'// Sound error\nfn mainSound(i:i32,t:f32)->vec2f{return missingSound;}'});
 const invalid=await call('shader.compile');assert.equal(invalid.compiled,false,"line 86");
 assert.ok(invalid.diagnostics.some(d=>d.pass==='sound'&&d.line===2));
 assert.deepEqual(await read(),textureBytes,'failed compile preserves successful audio');
 await call('shader.code.set',{pass:'sound',code:stable});await compile();
 const exported=await call('shader.project.export');await call('shader.code.set',{pass:'sound',code:''});
 await call('shader.project.open',{resourceId:exported.resourceId});await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'project reopen');
 assert.equal(await evaluate('shaderEditor.getProject().sound.code'),stable);
 assert.equal(await evaluate('shaderEditor.getStatus().sound.audible'),false,'open never unmutes');
 await click('document.querySelector("[data-pass=sound]")');
 await click('document.getElementById("sound-export")');
 await waitFor(()=>readdirSync(downloads).some(n=>n.endsWith('.wav')),'WAV download');
 assert.equal(readFileSync(resolve(downloads,readdirSync(downloads).find(n=>n.endsWith('.wav')))).length,44+44100*4);
 await click('document.getElementById("save-project")');await waitFor(()=>evaluate('document.getElementById("save-state").textContent==="已保存到此浏览器"'),'Sound save');
 await click('document.getElementById("back-gallery")');await evaluate('document.querySelector("#saved-projects .card-open").scrollIntoView({block:"center"})');await nextPaint();await click('document.querySelector("#saved-projects .card-open")');
 await waitFor(()=>evaluate('location.hash==="#editor" && !document.getElementById("compile").disabled'),'saved Sound reopen');
 assert.equal(await evaluate('shaderEditor.getProject().sound.code'),stable);
 await click('document.querySelector("[data-pass=sound]")');
 await nextPaint();const image=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(output,'sound.png'),Buffer.from(image.result.data,'base64'));
 await call('shader.pass.enable',{pass:'sound',enabled:false});await compile();
 assert.equal(await evaluate('shaderEditor.getStatus().sound.ready'),false,"line 105");
 assert.equal(await evaluate('shaderEditor.getStatus().sound.audible'),false,"line 106");
 driver.assertNoBrowserErrors();
 return {status:'passed',checks:['GPU default music and both GLSL mainSound entry signatures','44100 Hz stereo PCM, 440 Hz tone and exact sample order at row/chunk boundaries','Explicit audio gesture, audio clock, pause/resume/reset and route suspension','Common and static image channel sampling; WAV export unaffected by volume','Sound errors preserve prior audio; project export/import, Gallery save/reopen and WAV download; disabling releases audio']};
}});
writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
