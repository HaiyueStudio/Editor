import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
import { importPsd } from '../dist/psdAdapter.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(root,'imageEditor/artifacts/p4'),downloads=resolve(out,`downloads-${Date.now()}`);mkdirSync(downloads,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'imageEditor/app-dist/index.html',downloadDirectory:downloads,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:30000,readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy")==="false"',scenario:async driver=>{
 const {evaluate,click,replaceText,waitFor,nextPaint,cdp}=driver,checks=[];
 const e=s=>`document.querySelector(${JSON.stringify(s)})`,act=a=>click(e(`[data-action="${a}"]`));
 const saved=()=>waitFor(()=>evaluate('document.querySelector("#recovery-status").textContent.includes("已存")'),'recovery committed');
 const db=expression=>evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('haiyue.image-editor.v1',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('recovery','readonly'),store=tx.objectStore('recovery');const readRequest=${expression};tx.oncomplete=()=>{db.close();resolve(readRequest.result);};tx.onabort=()=>reject(tx.error);};})`);
 const reload=async()=>{const old=await evaluate('performance.timeOrigin');await cdp.call('Page.reload');await waitFor(()=>evaluate(`performance.timeOrigin!==${old}&&document.querySelector('#app')?.getAttribute('aria-busy')==='false'`),'restarted app');};
 const stop=cdp.on('Page.javascriptDialogOpening',()=>{void cdp.call('Page.handleJavaScriptDialog',{accept:true});});
 await click(e('.header-actions [data-action=new]'));await replaceText(e('#new-name'),'P4 离线恢复');await replaceText(e('#new-width'),'512');await replaceText(e('#new-height'),'512');await evaluate('document.querySelector("#new-background").value="white"');await click(e('#new-form button[type=submit]'));await nextPaint();await saved();
 const initial=await db("store.get('session')"),initialKeys=await db('store.getAllKeys()');assert.equal(initial.version,3);assert.equal(initialKeys.filter(k=>k.startsWith('chunk:')).length,1);assert.equal(initial.documents[0].state.layers[0].bitmap.data.chunks.length,4);
 checks.push('binary recovery stores four equal pixel chunks once');
 // Abort after manifest put but before the first new chunk: old committed session must survive.
 await evaluate(`window.p4Put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(typeof key==='string'&&key.startsWith('chunk:'))throw new DOMException('P4 quota fault','QuotaExceededError');return window.p4Put.call(this,value,key);}`);
 await click(e('[data-tool=select]'));await evaluate('document.querySelector("#paint-color").value="#ee5533"');await act('fill');await waitFor(()=>evaluate('document.querySelector("#recovery-status").textContent.includes("失败")'),'quota error shown');
 assert.deepEqual(await db("store.get('session')"),initial);assert.deepEqual(await db('store.getAllKeys()'),initialKeys);assert.equal(await evaluate('document.querySelector("#recovery-retry").hidden'),false);
 await evaluate('IDBObjectStore.prototype.put=window.p4Put;delete window.p4Put');await act('retry-recovery');await saved();assert.notDeepEqual(await db("store.get('session')"),initial);assert.equal((await db('store.getAllKeys()')).filter(k=>k.startsWith('chunk:')).length,1);
 checks.push('quota fault atomically preserves the last snapshot; explicit retry saves latest pixels and collects obsolete chunks');
 const pixel=()=>evaluate('Array.from(document.querySelector("#image-canvas").getContext("2d").getImageData(200,200,1,1).data)');assert.deepEqual(await pixel(),[238,85,51,255]);
 await waitFor(()=>evaluate('Boolean(navigator.serviceWorker.controller)'),'installed PWA');await cdp.call('Network.enable');await cdp.call('Network.setCacheDisabled',{cacheDisabled:true});await cdp.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0,connectionType:'none'});
 await reload();assert.equal(await evaluate('document.querySelectorAll(".document-tab").length'),1);assert.deepEqual(await pixel(),[238,85,51,255]);checks.push('cold document reload offline boots from service-worker cache and restores exact pixels without HTTP cache');
 await act('filters');await evaluate('document.querySelector("#filter-kind").value="invert";document.querySelector("#filter-kind").dispatchEvent(new Event("change",{bubbles:true}))');await waitFor(()=>evaluate('!document.querySelector("#filter-apply").disabled'),'offline filter worker');await click(e('#filter-apply'));await nextPaint();assert.deepEqual(await pixel(),[17,170,204,255]);await act('undo');await nextPaint();assert.deepEqual(await pixel(),[238,85,51,255]);await act('redo');await nextPaint();await saved();
 await act('export-psd');await click(e('#psd-export-confirm'));const file=await waitFor(()=>readdirSync(downloads).find(f=>f.endsWith('.edited.psd')),'offline PSD file');const psd=importPsd(new Uint8Array(readFileSync(resolve(downloads,file))),file);assert(psd.layered,psd.blockers.join('\n'));assert.deepEqual(Array.from(psd.layered.layers[0].bitmap.data.slice(0,4)),[17,170,204,255]);checks.push('after offline reboot filter Worker, tile undo/redo and PSD export preserve pixel values');
 // Repeated close/reopen returns the persistent chunk store to a bounded size.
 for(let i=0;i<6;i++){
  await click(e('.document-tab.active .tab-close'));await click(e('#close-discard'));await waitFor(()=>evaluate('document.querySelectorAll(".document-tab").length===0'),'document disposed');
  await waitFor(async()=> (await db('store.getAllKeys()')).length===1,'unreferenced recovery chunks removed');
  await click(e('.header-actions [data-action=new]'));await click(e('#new-form button[type=submit]'));await nextPaint();await saved();
 }
 checks.push('six close/reopen cycles remove obsolete recovery chunks and preserve a usable workspace');
 await reload();assert.equal(await evaluate('document.querySelectorAll(".document-tab").length'),1);
 await cdp.call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});stop();
 const screenshot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'offline-workspace.png'),Buffer.from(screenshot.result.data,'base64'));driver.assertNoBrowserErrors();
 const files=[...readdirSync(resolve(root,'imageEditor/src')).map(f=>'imageEditor/src/'+f),'imageEditor/test/p4-browser-smoke.mjs','imageEditor/app/descriptor.json','package-lock.json','scripts/editor-e2e/browserDriver.mjs'];
 return {schemaVersion:1,status:'passed',checks,generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),runner:{chrome:driver.chrome,platform:process.platform,arch:process.arch},browser:await evaluate('navigator.userAgent'),buildHash:JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash,sourceFingerprints:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]))};
}});writeFileSync(resolve(out,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,out}));
