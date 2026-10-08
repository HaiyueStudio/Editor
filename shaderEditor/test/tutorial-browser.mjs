import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
import { TUTORIAL_LABS, tutorialProject } from '../dist/tutorialLabs.js';
const root=resolve(import.meta.dirname,'../..'),output=resolve(root,'shaderEditor/artifacts/tutorial');
mkdirSync(output,{recursive:true});const downloads=resolve(output,'downloads');mkdirSync(downloads,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#tutorial/ellipse',downloadDirectory:downloads,
 failureScreenshotPath:resolve(output,'failure.png'),timeoutMs:45000,
 readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy")==="false" && document.getElementById("tutorial-title")?.textContent.includes("椭圆")',
 scenario:async driver=>{
  const {evaluate,click,waitFor,nextPaint,cdp}=driver,checks=[];
  const shot=async name=>{await nextPaint();const s=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(output,name),Buffer.from(s.result.data,'base64'));};
  const call=async(operation,params={})=>{
    const r=await evaluate(`(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),operation:${JSON.stringify(operation)},params:${JSON.stringify(params)},documentId:d.identity.id,expectedRevision:d.revision});})()`);
    assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
  };
  assert.equal(await evaluate('document.querySelectorAll("#tutorial-outline a").length'),32);
  assert.equal(await evaluate('document.querySelectorAll("#tutorial-stages a").length'),8);
  assert.equal(await evaluate('shaderEditor.getStatus()'),null,'reading tutorials does not require a GPU');
  assert.equal(await evaluate('document.getElementById("workspace").hidden && document.getElementById("gallery").hidden'),true);
  assert.equal(await evaluate('document.getElementById("nav-tutorial").getAttribute("aria-current")'),'page');
  assert.ok(await evaluate('document.querySelectorAll("#tutorial-code .cm-line span").length>5'));
  assert.equal(await evaluate('document.querySelector("#tutorial-code .cm-content").getAttribute("contenteditable")'),'false');
  assert.ok(await evaluate('Array.from(document.querySelectorAll(".tutorial-references a")).every(a=>a.target==="_blank" && a.rel.includes("noopener") && a.href.startsWith("https://"))'));
  await shot('tutorial-desktop.png');
  await evaluate('document.getElementById("tutorial-search").value="布尔";document.getElementById("tutorial-search").dispatchEvent(new Event("input"))');
  assert.ok(await evaluate('Array.from(document.querySelectorAll("#tutorial-outline a")).some(a=>a.hash==="#tutorial/boolean")'));
  await evaluate('document.getElementById("tutorial-search").value="nonsense-no-results";document.getElementById("tutorial-search").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate('document.querySelectorAll("#tutorial-outline a").length'),0);
  await evaluate('document.getElementById("tutorial-search").value="";document.getElementById("tutorial-search").dispatchEvent(new Event("input"))');
  await evaluate('Array.from(document.querySelectorAll("#tutorial-outline a")).find(a=>a.hash==="#tutorial/boolean").scrollIntoView({block:"center"})');
  await click('Array.from(document.querySelectorAll("#tutorial-outline a")).find(a=>a.hash==="#tutorial/boolean")');
  assert.equal(await evaluate('location.hash'),'#tutorial/boolean');
  await evaluate('document.querySelector(".tutorial-pagination a:last-child").scrollIntoView({block:"center"})');
  await click('document.querySelector(".tutorial-pagination a:last-child")');
  assert.equal(await evaluate('location.hash'),'#tutorial/smooth');
  await evaluate('location.hash="#tutorial/unknown-chapter"');
  await waitFor(()=>evaluate('location.hash==="#tutorial/pixels"'),'invalid chapter fallback');
  await evaluate('location.hash="#tutorial/march"');
  await waitFor(()=>evaluate('document.getElementById("tutorial-title").textContent.includes("Sphere")'),'hash navigation');
  const origin=await evaluate('performance.timeOrigin');await cdp.call('Page.reload',{ignoreCache:true});
  await waitFor(()=>evaluate(`performance.timeOrigin!==${origin} && document.getElementById("tutorial-title")?.textContent.includes("Sphere")`),'deep-link reload');
  checks.push('32 chapters, 8 stages, original references, readonly WGSL highlighting, keyword search, previous/next, deep-link reload and fallback work without GPU initialization');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await nextPaint();
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),'mobile page fits viewport');
  await shot('tutorial-mobile.png');await cdp.call('Emulation.clearDeviceMetricsOverride');await nextPaint();
  await evaluate('document.getElementById("tutorial-open-lab").scrollIntoView({block:"center"})');await click('document.getElementById("tutorial-open-lab")');
  await waitFor(()=>evaluate('location.hash==="#editor" && shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled'),'open exercise');
  assert.equal(await evaluate('shaderEditor.getProject().name'),'教程 · 三维法线视图');
  await call('shader.code.set',{pass:'image',code:(await evaluate('shaderEditor.getProject().passes[4].code'))+'\n// draft survives tutorial reading'});
  const before=await evaluate('shaderEditor.getProject()');
  await click('document.getElementById("nav-tutorial")');await click('document.getElementById("nav-editor")');
  assert.deepEqual(await evaluate('shaderEditor.getProject()'),before);
  checks.push('Mobile reading layout fits; opening a lab creates a draft; tutorial navigation preserves code and project identity');
  const pixels=[];
  for(const lab of TUTORIAL_LABS){
    const p=tutorialProject(lab.id);
    const resource=await evaluate(`haiyueEditor.putResource(new TextEncoder().encode(${JSON.stringify(JSON.stringify(p))}))`);
    await call('shader.project.open',{resourceId:resource.resourceId});await evaluate(`haiyueEditor.releaseResource(${JSON.stringify(resource.resourceId)})`);
    await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'exercise compiled');
    const compiled=await call('shader.compile');assert.equal(compiled.compiled,true,lab.id+JSON.stringify(compiled));
    assert.equal(compiled.diagnostics.filter(d=>d.severity==='error').length,0);
    await call('shader.playback.set',{playing:false});await call('shader.playback.step');
    const image=await call('shader.image.read');
    const colors=await evaluate(`(()=>{const bytes=haiyueEditor.readResource(${JSON.stringify(image.resourceId)});const colors=new Set();for(let i=0;i<bytes.length;i+=64)colors.add(bytes[i]+","+bytes[i+1]+","+bytes[i+2]);haiyueEditor.releaseResource(${JSON.stringify(image.resourceId)});return colors.size;})()`);
    assert.ok(colors>8,lab.id+': varied output');pixels.push({id:lab.id,colors});
  }
  await shot('tutorial-scene-lab.png');
  await click('document.getElementById("nav-gallery")');
  await waitFor(()=>evaluate('document.querySelectorAll("#examples .card-art img").length===5'),'gallery still renders');
  assert.equal(await evaluate('document.querySelectorAll("#saved-projects .card").length'),0,'tutorials never auto-save');
  checks.push('All 8 WGSL exercises compile and produce nonuniform real GPU output, including Buffer feedback; Gallery remains intact and no automatic saving occurs');
  driver.assertNoBrowserErrors();return {status:'passed',checks,pixels};
 }});
writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
