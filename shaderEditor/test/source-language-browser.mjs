import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/source-language');mkdirSync(out,{recursive:true});
const glsl='// editable GLSL\nvoid mainImage(out vec4 c, in vec2 p) {\n  c = vec4(0.2, 0.4, 0.6, 1.0);\n}';
const wgsl='fn mainImage(p: vec2f) -> vec4f {\n  return vec4f(0.8, 0.1, 0.3, 1.0);\n}';
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:out,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:60000,
readinessExpression:'shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async({evaluate,click,waitFor,cdp,nextPaint})=>{
 const call=async(operation,params={})=>{
  const r=await evaluate('(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:"1",requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:'+JSON.stringify(operation)+',params:'+JSON.stringify(params)+'});})()');
  assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
 };
 const language=()=>evaluate('document.getElementById("code-language").value');
 const code=()=>evaluate('document.querySelector("#code-editor .cm-content").textContent');
 const key=async(key,code,windowsVirtualKeyCode,modifiers=0)=>{
  for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode,modifiers});
 };
 const choose=async lang=>{
  await click('document.getElementById("code-language").shadowRoot.querySelector("select")');
  await key(lang==='wgsl'?'Home':'End',lang==='wgsl'?'Home':'End',lang==='wgsl'?36:35);
  await key('Enter','Enter',13);
  await waitFor(async()=>await language()===lang,'language selection '+lang);
 };
 const paste=async source=>{
  await click('document.querySelector("#code-editor .cm-content")');await key('a','KeyA',65,2);
  await evaluate('(()=>{const data=new DataTransfer();data.setData("text/plain",'+JSON.stringify(source)+');document.querySelector("#code-editor .cm-content").dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));})()');
  await nextPaint();
 };
 const render=async()=>{
  await click('document.getElementById("compile")');
  await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'compile finished');await nextPaint();
  assert.deepEqual((await call('shader.query')).diagnostics.filter(d=>d.severity==='error'),[]);
 };
 const pixel=async()=>{
  const r=await call('shader.image.read');
  return evaluate('(()=>{const b=haiyueEditor.readResource('+JSON.stringify(r.resourceId)+');const i=('+r.width+'*Math.floor('+r.height+'/2)+Math.floor('+r.width+'/2))*4;const p=Array.from(b.slice(i,i+4));haiyueEditor.releaseResource('+JSON.stringify(r.resourceId)+');return p;})()');
 };
 const near=(actual,expected)=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<3,JSON.stringify(actual)));
 const highlight=async lang=>{
  assert.equal(await evaluate('document.querySelector("#code-editor .cm-content").getAttribute("aria-label")'),lang.toUpperCase()+' 代码编辑器');
  assert.ok(await evaluate('document.querySelectorAll("#code-editor .cm-line span").length>3'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#code-editor .cm-scroller")).display'),'flex');
 };
 assert.equal(await language(),'wgsl');
 const original=(await call('shader.query')).passes.find(p=>p.id==='image').code;
 await paste(glsl);assert.equal(await language(),'glsl');await highlight('glsl');
 assert.equal((await call('shader.query')).passes.find(p=>p.id==='image').glsl,glsl);
 await key('z','KeyZ',90,2);assert.equal(await language(),'wgsl');assert.ok((await code()).includes('fn mainImage'));
 await key('y','KeyY',89,2);assert.equal(await language(),'glsl');await highlight('glsl');
 await render();near(await pixel(),[51,102,153,255]);assert.equal(await language(),'glsl');
 const before=await call('shader.query');
 await click('document.getElementById("view-wgsl")');
 assert.equal(await evaluate('document.getElementById("generated-dialog").open'),true);
 assert.ok(await evaluate('document.querySelector("#generated-code .cm-content").textContent.includes("fn mainImage")'));
 assert.ok(await evaluate('document.querySelectorAll("#generated-code .cm-line span").length>3'));
 assert.equal(await evaluate('document.querySelector("#generated-code .cm-content").getAttribute("contenteditable")'),'false');
 await nextPaint();let shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'wgsl-preview.png'),Buffer.from(shot.result.data,'base64'));
 await click('document.querySelector("#generated-dialog button")');assert.equal((await call('shader.query')).revision,before.revision);
 await choose('wgsl');assert.equal((await call('shader.query')).passes.find(p=>p.id==='image').code,original);
 await paste(wgsl);await render();near(await pixel(),[204,26,77,255]);await highlight('wgsl');
 await choose('glsl');assert.equal((await call('shader.query')).passes.find(p=>p.id==='image').glsl,glsl);
 await paste('// invalid\nvoid mainImage(out vec4 c, in vec2 p) {\n c=vec4(missingValue);\n}');
 await click('document.getElementById("compile")');
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled && document.querySelector("#diagnostics .diagnostic")'),'GLSL error');
 let q=await call('shader.query');assert.ok(q.diagnostics.some(d=>d.language==='glsl'&&d.line===3));
 near(await pixel(),[204,26,77,255]);
 await click('document.querySelector("#diagnostics .diagnostic")');assert.equal(await evaluate('document.getElementById("generated-dialog").open'),false);
 assert.ok(await evaluate('document.querySelector("#code-editor .cm-activeLine").textContent.includes("missingValue")'));
 await paste('void mainImage(out vec4 c,in vec2 p){c=vec4(1.0/0.0);}');
 await click('document.getElementById("compile")');
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled && document.querySelector("#diagnostics .diagnostic")'),'generated WGSL error');
 q=await call('shader.query');assert.ok(q.diagnostics.some(d=>d.severity==='error'&&d.language!=='glsl'));
 await click('document.querySelector("#diagnostics .diagnostic")');
 assert.equal(await evaluate('document.getElementById("generated-dialog").open'),true);
 assert.ok(await evaluate('document.querySelector("#generated-code .cm-activeLine").textContent.includes("1.0 / 0.0")'));
 await click('document.querySelector("#generated-dialog button")');
 await choose('wgsl');assert.ok((await code()).includes('0.8'));
 // Disabled auto-detection leaves the explicit choice intact even for recognized input.
 await click('document.getElementById("detect-language").shadowRoot.querySelector("label")');
 await paste(glsl);assert.equal(await language(),'wgsl');
 await key('z','KeyZ',90,2);assert.ok((await code()).includes('0.8'));
 await click('document.getElementById("detect-language").shadowRoot.querySelector("label")');
 await paste(glsl);assert.equal(await language(),'glsl');
 await paste(wgsl);assert.equal(await language(),'wgsl');
 // Common, Buffer and Sound all retain independent language selections via API and UI.
 await call('shader.source.set',{pass:'common',language:'glsl',code:'float gain(float x) { return x * .5; }'});
 await call('shader.source.set',{pass:'image',language:'glsl',code:'void mainImage(out vec4 c,in vec2 p) { c=vec4(vec3(gain(.8)),1.0); }'});
 await call('shader.source.set',{pass:'buffer-a',language:'glsl',code:glsl});
 await call('shader.pass.enable',{pass:'buffer-a',enabled:true});
 await call('shader.source.set',{pass:'sound',language:'glsl',code:'vec2 mainSound(int s,float t) { return vec2(gain(sin(t))); }'});
 await render();near(await pixel(),[102,102,102,255]);
 for(const pass of ['common','buffer-a','sound','image']) {
  await click('document.querySelector("#pass-tabs [data-pass=\\"'+pass+'\\"]")');assert.equal(await language(),'glsl');await highlight('glsl');
 }
 const saved=await call('shader.project.export');
 await call('shader.project.open',{resourceId:saved.resourceId});
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'reopen');
 q=await call('shader.query');assert.equal(q.editorLanguages.image,'glsl');assert.equal(q.editorLanguages.common,'glsl');
 assert.equal(await language(),'glsl');await highlight('glsl');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:720,height:1000,deviceScaleFactor:1,mobile:false});await nextPaint();
 assert.equal(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true);
 await cdp.call('Emulation.clearDeviceMetricsOverride');await nextPaint();
 shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'editor.png'),Buffer.from(shot.result.data,'base64'));
 return {status:'passed',checks:['Automatic paste detection, syntax colors and undo/redo restore the matching language','Manual choices preserve both drafts, including invalid GLSL','Both languages render expected GPU colors; GLSL diagnostics target original lines and preserve last good image','Readonly generated WGSL has highlighting and leaves the document unchanged','Common/Buffer/Sound/Image language metadata survives API, export and reopen; narrow layout fits']};
}});
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

