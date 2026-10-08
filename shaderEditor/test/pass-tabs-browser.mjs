import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/pass-tabs');mkdirSync(out,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:out,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:60000,
readinessExpression:'shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async({evaluate,click,waitFor,cdp,nextPaint})=>{
 const call=async(operation,params={})=>{
  const r=await evaluate('(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:"1",requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:'+JSON.stringify(operation)+',params:'+JSON.stringify(params)+'});})()');
  assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
 };
 const tabs=()=>evaluate('Array.from(document.querySelectorAll("#pass-tabs [data-pass]"),b=>b.dataset.pass)');
 const add=async id=>{
  await click('document.getElementById("add-pass")');
  await click('Array.from(document.getElementById("add-pass-menu").shadowRoot.querySelectorAll("button")).find(b=>b.textContent==='+JSON.stringify(id==='sound'?'Sound':id==='common'?'Common':'Buffer '+id.at(-1).toUpperCase())+')');
  await waitFor(()=>evaluate('!document.getElementById("compile").disabled && document.querySelector("#pass-tabs [aria-selected=true]").dataset.pass==='+JSON.stringify(id)),'added '+id);
 };
 assert.deepEqual(await tabs(),['image']);
 await evaluate('window.audioGestures=[];const resume=AudioContext.prototype.resume;AudioContext.prototype.resume=function(){audioGestures.push(navigator.userActivation.isActive);return resume.call(this);};');
 await call('shader.playback.set',{playing:false});
 await click('document.getElementById("add-pass")');
 assert.equal(await evaluate('document.getElementById("add-pass").getAttribute("aria-expanded")'),'true');
 assert.deepEqual(await evaluate('audioGestures'),[],'opening the menu does not start audio');
 await nextPaint();let shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'add-menu.png'),Buffer.from(shot.result.data,'base64'));
 await click('Array.from(document.getElementById("add-pass-menu").shadowRoot.querySelectorAll("button")).find(b=>b.textContent==="Sound")');
 await waitFor(()=>evaluate('shaderEditor.getStatus().sound.playing && shaderEditor.getStatus().time>.15 && !document.getElementById("compile").disabled'),'Sound plays after adding, without a separate unmute click');
 assert.deepEqual(await tabs(),['image','sound']);assert.equal(await evaluate('shaderEditor.getProject().sound.enabled'),true);
 assert.deepEqual(await evaluate('audioGestures'),[true]);
 assert.equal(await evaluate('document.getElementById("sound-toggle").textContent'),'静音');
 assert.equal(await evaluate('document.getElementById("add-pass-menu").items.some(i=>i.value==="sound")'),false);
 await click('document.getElementById("sound-toggle")');assert.equal(await evaluate('shaderEditor.getStatus().sound.audible'),false);
 await add('common');await add('buffer-a');
 assert.equal(await evaluate('shaderEditor.getStatus().sound.audible'),false,'adding other tabs preserves explicit mute');
 assert.equal(await evaluate('shaderEditor.getProject().passes[0].enabled'),true);
 await click('document.getElementById("pass-enabled").shadowRoot.querySelector("label")');
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled && !shaderEditor.getProject().passes[0].enabled'),'disable retains Buffer tab');
 assert.deepEqual(await tabs(),['image','sound','common','buffer-a']);
 const saved=await call('shader.project.export');
 await call('shader.project.open',{resourceId:saved.resourceId});
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'reopen');
 assert.deepEqual(await tabs(),['image','sound','common','buffer-a']);
 assert.equal(await evaluate('shaderEditor.getStatus().sound.audible'),false,'reopening does not autoplay');
 for(const id of ['buffer-b','buffer-c','buffer-d'])await add(id);
 assert.equal((await tabs()).length,7);assert.equal(await evaluate('document.getElementById("add-pass-menu").hidden'),true);
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:720,height:1000,deviceScaleFactor:1,mobile:false});
 await nextPaint();assert.equal(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true);
 await cdp.call('Emulation.clearDeviceMetricsOverride');
 await nextPaint();shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'added-tabs.png'),Buffer.from(shot.result.data,'base64'));
 await click('document.getElementById("nav-gallery")');await click('document.getElementById("new-project")');
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'fresh project');
 assert.deepEqual(await tabs(),['image']);assert.equal(await evaluate('shaderEditor.getStatus().sound.audible'),false);
 return {status:'passed',checks:['New projects show only Image; shared dropdown adds each module once','Sound selection resumes AudioContext within the actual click and automatically plays after compilation','Mute/pause, disable, empty Common, export/reopen and project switching preserve intent and tabs','All seven modules fit a scrollable tab bar and narrow layouts without page overflow']};
}});
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
