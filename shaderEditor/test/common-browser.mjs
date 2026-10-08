import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/common');
mkdirSync(out,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:out,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:45000,
readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy")==="false" && shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async driver=>{
 const {evaluate,click,waitFor,cdp,nextPaint}=driver;
 const call=async(operation,params={})=>{
   const r=await evaluate(`(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:${JSON.stringify(operation)},params:${JSON.stringify(params)}});})()`);
   assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
 };
 const pixel=async()=>{
   const f=await call('shader.image.read');
   return evaluate(`(()=>{const b=haiyueEditor.readResource(${JSON.stringify(f.resourceId)}),i=(Math.floor(${f.height}/2)*${f.width}+Math.floor(${f.width}/2))*4;const c=Array.from(b.slice(i,i+4));haiyueEditor.releaseResource(${JSON.stringify(f.resourceId)});return c;})()`);
 };
 const close=(actual,expected)=>expected.forEach((v,i)=>assert.ok(Math.abs(actual[i]-v*255)<2,actual+' expected '+expected));
 const tab=async pass=>click(`document.querySelector('[data-pass="${pass}"]')`);
 await call('shader.playback.set',{playing:false});
 const common='// Shared helpers\nconst GAIN = 0.1;\nstruct Sample { value: vec4f }\nvar<private> visits: f32;\nfn sampleShared(p:vec2f)->Sample { visits += GAIN; return Sample(channel0(p / iResolution.xy) + vec4f(visits,0.0,0.0,0.0)); }';
 await call('shader.code.set',{pass:'common',code:common});
 const passes=['buffer-a','buffer-b','buffer-c','buffer-d','image'];
 for(let i=0;i<passes.length;i++) {
   await call('shader.code.set',{pass:passes[i],code:'fn mainImage(p:vec2f)->vec4f {return vec4f(sampleShared(p).value.rgb,1.0);}'});
   if(i<4)await call('shader.pass.enable',{pass:passes[i],enabled:true});
   if(i)await call('shader.channel.set',{pass:passes[i],index:0,channel:{kind:'buffer',pass:passes[i-1]}});
 }
 assert.equal((await call('shader.compile')).compiled,true);
 await call('shader.playback.step');close(await pixel(),[.5,0,0,1]);
 await call('shader.playback.step');close(await pixel(),[.5,0,0,1]);
 await tab('common');
 assert.equal(await evaluate('document.querySelectorAll("#pass-tabs button").length'),6);
 assert.equal(await evaluate('document.getElementById("pass-enable-label").hidden'),true);
 assert.equal(await evaluate('document.querySelectorAll(".channel-card").length'),0);
 assert.ok(await evaluate('document.querySelectorAll("#code-editor .cm-line span").length>5'));
 await click('document.querySelector("#code-editor .cm-content")');
 await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',modifiers:2,windowsVirtualKeyCode:35});
 await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
 await cdp.call('Input.insertText',{text:'\n// common edit'});
 await waitFor(()=>evaluate('shaderEditor.getProject().common.endsWith("// common edit")'),'Common typing updates document');
 await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
 await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90});
 await waitFor(()=>evaluate('!shaderEditor.getProject().common.includes("// common edit")'),'Common undo');
 await tab('image');await tab('common');
 assert.ok(await evaluate('document.getElementById("code-editor").textContent.includes("GAIN")'));
 await nextPaint();const shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'common.png'),Buffer.from(shot.result.data,'base64'));
 const changed=common.replace('0.1','0.15');
 await call('shader.code.set',{pass:'common',code:changed});assert.equal((await call('shader.compile')).compiled,true);
 await call('shader.playback.step');close(await pixel(),[.75,0,0,1]);
 const before=await pixel();
 await call('shader.code.set',{pass:'common',code:changed+'\nfn broken()->f32 { return missingCommon; }'});
 const bad=await call('shader.compile');assert.equal(bad.compiled,false);
 const diagnostics=bad.diagnostics.filter(d=>d.severity==='error');
 assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].pass,'common');assert.equal(diagnostics[0].line,changed.split('\n').length+1);
 assert.deepEqual(await pixel(),before);
 await tab('image');await click('document.querySelector("#diagnostics .error")');
 assert.equal(await evaluate('document.querySelector("#pass-tabs [aria-selected=true]").dataset.pass'),'common');
 await call('shader.code.set',{pass:'common',code:changed});
 await call('shader.code.set',{pass:'image',code:'// Image\nfn mainImage(p:vec2f)->vec4f {return missingImage;}'});
 const local=await call('shader.compile');assert.ok(local.diagnostics.some(d=>d.pass==='image' && d.line===2));
 await call('shader.code.set',{pass:'image',code:'fn mainImage(p:vec2f)->vec4f {return vec4f(sampleShared(p).value.rgb,1.0);}'});
 assert.equal((await call('shader.compile')).compiled,true);await call('shader.playback.step');
 await click('document.getElementById("save-project")');
 await waitFor(()=>evaluate('document.getElementById("save-state").textContent==="已保存到此浏览器"'),'Common saved');
 const exported=await call('shader.project.export');
 await call('shader.code.set',{pass:'common',code:''});await call('shader.project.open',{resourceId:exported.resourceId});
 assert.equal(await evaluate('shaderEditor.getProject().common'),changed);
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'reopened compile');
 await click('document.getElementById("back-gallery")');
 await click('document.querySelector("#saved-projects .card-open")');
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled && shaderEditor.getStatus()?.ready'),'saved gallery Common');
 assert.equal(await evaluate('shaderEditor.getProject().common'),changed);
 await call('shader.playback.set',{playing:false});await call('shader.playback.step');close(await pixel(),[.75,0,0,1]);
 return {status:'passed',checks:['Shared constants, structs, functions and per-pixel private state across all four Buffers and Image','Per-Pass channel bindings and ordering; Common edits update all five outputs','Common tab, WGSL highlighting, real typing/undo and tab state','Common and Image error locations; duplicate Common errors removed; failed compile retains preview','Save to Gallery, reopen, export and import preserve Common']};
}});
console.log(JSON.stringify(report,null,2));
