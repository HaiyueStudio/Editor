import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/common-glsl');
mkdirSync(out,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:out,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:60000,
readinessExpression:'shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async({evaluate,click,waitFor,cdp,nextPaint})=>{
 const call=async(operation,params={})=>{
  const r=await evaluate('(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:"1",requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:'+JSON.stringify(operation)+',params:'+JSON.stringify(params)+'});})()');
  assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
 };
 const compile=async()=>{const r=await call('shader.compile');assert.equal(r.compiled,true,JSON.stringify(r));};
 const pixel=async()=>{
  const f=await call('shader.image.read');
  return evaluate('(()=>{const b=haiyueEditor.readResource('+JSON.stringify(f.resourceId)+'),i=(Math.floor('+f.height+'/2)*'+f.width+'+Math.floor('+f.width+'/2))*4;const c=Array.from(b.slice(i,i+4));haiyueEditor.releaseResource('+JSON.stringify(f.resourceId)+');return c;})()');
 };
 const close=(c,e)=>e.forEach((v,i)=>assert.ok(Math.abs(c[i]-v*255)<2,c+' expected '+e));
 const audio=async()=>{
  const f=await call('shader.sound.export');
  return evaluate('(()=>{const b=haiyueEditor.readResource('+JSON.stringify(f.resourceId)+'),v=new DataView(b.buffer,b.byteOffset,b.byteLength);const r=[0,1,100,44100-1].map(i=>[v.getInt16(44+i*4,true)/32768,v.getInt16(46+i*4,true)/32768]);haiyueEditor.releaseResource('+JSON.stringify(f.resourceId)+');return r;})()');
 };
 const fill=async text=>{
  await click('document.querySelector("#glsl-source .cm-content")');
  await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65});
  await cdp.call('Input.insertText',{text});
 };
 const applyUI=async text=>{
  await click('document.getElementById("glsl-button")');await fill(text);
  await click('document.getElementById("translate-glsl")');
  assert.equal(await evaluate('document.getElementById("apply-glsl").disabled'),false,await evaluate('document.getElementById("glsl-messages").textContent'));
  assert.ok(await evaluate('document.querySelectorAll("#glsl-result .cm-line span").length>5'));
  await click('document.getElementById("apply-glsl")');
  await waitFor(()=>evaluate('!document.getElementById("compile").disabled && !document.getElementById("glsl-dialog").open'),'Common apply compiled');
 };
 const common=`#define GAIN .125
const float factors[2]=float[](1.,2.);
struct Tint {vec3 color;};
float level=GAIN+iTime*0.;
float gain(float x){return x*level;}
vec3 gain(vec3 x){return x*level;}
Tint shade(){return Tint(gain(vec3(factors[1])));}
`;
 await call('shader.playback.set',{playing:false});
 await call('shader.pass.add',{pass:'common'});
 await click('document.querySelector("[data-pass=common]")');
 assert.equal(await evaluate('document.getElementById("glsl-button").disabled'),false);
 await applyUI(common);
 assert.equal(await evaluate('shaderEditor.getProject().commonGlsl'),common);
 await compile(); // The existing native WGSL image also compiles with this standalone library.
 await click('document.querySelector("[data-pass=image]")');
 const image='void mainImage(out vec4 c,in vec2 p){c=vec4(texture(iChannel0,p/iResolution.xy).r+shade().color.r,gain(1.),0.,1.);}';
 await applyUI(image);
 await call('shader.glsl.apply',{pass:'buffer-a',code:'void mainImage(out vec4 c,in vec2 p){c=vec4(GAIN,0.,0.,1.);}'});
 await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
 await call('shader.glsl.apply',{pass:'sound',code:'vec2 mainSound(float t){return vec2(gain(factors[0]),GAIN);}'});
 await call('shader.sound.configure',{duration:1});await call('shader.pass.enable',{pass:'sound',enabled:true});
 await compile();await call('shader.playback.step');close(await pixel(),[.375,.125,0,1]);
 for(const pair of await audio())for(const sample of pair)assert.ok(Math.abs(sample-.125)<.0001);
 // A Common-only edit must update all linked outputs from their preserved GLSL.
 const changed=common.replace('GAIN .125','GAIN .25');
 await click('document.querySelector("[data-pass=common]")');
 await click('document.getElementById("glsl-button")');
 assert.equal(await evaluate('document.querySelector("#glsl-source .cm-content").innerText.trimEnd()'),common.trimEnd());
 assert.ok(await evaluate('document.querySelectorAll("#glsl-source .cm-line span").length>5'));
 await fill(changed);await click('document.getElementById("translate-glsl")');await click('document.getElementById("apply-glsl")');
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'Common recompile');
 await compile();await call('shader.playback.step');close(await pixel(),[.75,.25,0,1]);
 for(const pair of await audio())for(const sample of pair)assert.ok(Math.abs(sample-.25)<.0001);
 // Export and reopening preserve both shared and per-Pass original source.
 const exported=await call('shader.project.export');
 await call('shader.code.set',{pass:'common',code:''});
 await call('shader.project.open',{resourceId:exported.resourceId});
 assert.equal(await evaluate('shaderEditor.getProject().commonGlsl'),changed);
 assert.equal(await evaluate('shaderEditor.getProject().passes.find(p=>p.id==="image").glsl'),image);
 await compile();await call('shader.playback.step');close(await pixel(),[.75,.25,0,1]);
 // Valid Common changes that break a dependent GLSL pass report that Pass and retain the last image.
 await call('shader.glsl.apply',{pass:'common',code:'#define GAIN .25'});
 const failed=await call('shader.compile');assert.equal(failed.compiled,false);
 assert.ok(failed.diagnostics.some(d=>d.pass==='image' && d.line===1));
 close(await pixel(),[.75,.25,0,1]);
 await call('shader.glsl.apply',{pass:'common',code:changed});await compile();
 // Native WGSL can also use Common globals that depend on uniforms/fragment coordinates.
 await call('shader.pass.enable',{pass:'sound',enabled:false});await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
 await call('shader.code.set',{pass:'image',code:'fn mainImage(p:vec2f)->vec4f{return vec4f(hy_common_global_coordY/iResolution.y,hy_common_global_level,0.0,1.0);}'});
 await call('shader.glsl.apply',{pass:'common',code:'#define GAIN .25\nfloat coordY=gl_FragCoord.y;\nfloat level=GAIN+iTime*0.;'});
 await compile();await call('shader.playback.step');close(await pixel(),[.5,.25,0,1]);
 await nextPaint();
 const shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'common-glsl.png'),Buffer.from(shot.result.data,'base64'));
 return {status:'passed',checks:['Common button, no-entry GLSL import and both syntax highlights','Common macros, overloads, structures, arrays and globals across Image/Buffer/Sound','Common edits relink real GPU pixels and audio samples','Original GLSL restoration/export/reopen, source diagnostics and failed compile retention','Standalone converted Common initializes native WGSL builtins and gl_FragCoord']};
}});
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
