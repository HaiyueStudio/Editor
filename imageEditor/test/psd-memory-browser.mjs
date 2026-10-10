import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
import {importPsd} from '../dist/psdAdapter.js';

// External PSD stays outside the repository. Run with a local, explicitly selected fixture.
if(!process.argv[2])throw Error('Usage: node imageEditor/test/psd-memory-browser.mjs /absolute/path/to/over-budget.psd');
const root=resolve(import.meta.dirname,'../..'),source=resolve(process.argv[2]),hash=b=>createHash('sha256').update(b).digest('hex');
const input=readFileSync(source),sourceHash=hash(input),expected=importPsd(new Uint8Array(input),basename(source));
assert(expected.memory.compositeOnly&&expected.flattened&&!expected.layered,'fixture must exceed layered budget and have a real merged image');
const expectedHash=hash(expected.flattened.layers[0].bitmap.data),out=resolve(root,'imageEditor/artifacts/psd-memory'),downloads=resolve(out,`downloads-${Date.now()}`);mkdirSync(downloads,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'imageEditor/app-dist/index.html',downloadDirectory:downloads,timeoutMs:120000,failureScreenshotPath:resolve(out,'failure.png'),readinessExpression:'Boolean(globalThis.haiyueEditor&&document.querySelector("#app")?.getAttribute("aria-busy")==="false")',scenario:async driver=>{
 const {evaluate,click,waitFor,nextPaint,setFileInputFiles,cdp,replaceText}=driver,e=s=>`document.querySelector(${JSON.stringify(s)})`;
 const start=Date.now();await setFileInputFiles('#open-input',[source]);await waitFor(()=>evaluate(e('#psd-import-dialog')+'.open'),'budget report',60000);
 const importMs=Date.now()-start;assert.equal(await evaluate(e('#psd-import-layers')+'.disabled'),true);assert.equal(await evaluate(e('#psd-import-flat')+'.disabled'),false);
 assert.match(await evaluate(e('#psd-import-summary')+'.textContent'),/内存预算/);assert.match(await evaluate(e('#psd-import-details')+'.textContent'),/跳过图层解码/);
 assert.equal(await evaluate('haiyueEditor.listDocuments().documents.length'),0,'fallback must require explicit choice');
 await click(e('#psd-import-cancel'));assert.equal(await evaluate('haiyueEditor.listDocuments().documents.length'),0);
 await setFileInputFiles('#open-input',[source]);await waitFor(()=>evaluate(e('#psd-import-dialog')+'.open'),'reopen report',60000);await click(e('#psd-import-flat'));
 await waitFor(()=>evaluate('haiyueEditor.listDocuments().documents.length===1'),'merged document',60000);await nextPaint();
 assert.equal(await evaluate(e('#image-canvas')+'.width'),expected.flattened.width);assert.equal(await evaluate(e('#image-canvas')+'.height'),expected.flattened.height);
 assert.equal(await evaluate('document.querySelectorAll(".layer-row").length'),1);
 await evaluate(`globalThis.seq=0;globalThis.call=async(operation,params={})=>{const list=haiyueEditor.listDocuments(),d=list.documents.find(d=>d.identity.id===list.activeId);const r=await haiyueEditor.execute({apiVersion:'1',requestId:'psd-budget-'+(++seq),operation:'image.'+operation,params,documentId:d.identity.id,expectedRevision:d.revision});if(r.status!=='completed')throw Error(JSON.stringify(r));return r.value;};globalThis.hashBytes=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');globalThis.canvasHash=()=>{const c=document.querySelector('#image-canvas');return hashBytes(c.getContext('2d').getImageData(0,0,c.width,c.height).data);};`);
 const sourcePixels=await evaluate(`(async()=>{const q=await call('document.query'),r=await call('pixels.copy',{layerId:q.selectedId});try{return await hashBytes(haiyueEditor.readResource(r.resourceId));}finally{haiyueEditor.releaseResource(r.resourceId);}})()`);assert.equal(sourcePixels,expectedHash);
 const before=await evaluate('canvasHash()');await replaceText(e('#opacity'),'65');await nextPaint();assert.notEqual(await evaluate('canvasHash()'),before);await click(e('[data-action=undo]'));await nextPaint();assert.equal(await evaluate('canvasHash()'),before);
 await replaceText(e('#layer-name'),'合并副本编辑验证');await click(e('[data-action=export-psd]'));await click(e('#psd-export-confirm'));
 const file=await waitFor(()=>readdirSync(downloads).find(f=>f.endsWith('.edited.psd')),'worker PSD export',60000),exported=importPsd(new Uint8Array(readFileSync(resolve(downloads,file))),file);
 assert(exported.layered,exported.blockers.join('\n'));assert.equal(exported.layered.layers[0].name,'合并副本编辑验证');assert.equal(hash(exported.layered.layers[0].bitmap.data),expectedHash);
 await setFileInputFiles('#open-input',[resolve(downloads,file)]);await waitFor(()=>evaluate(e('#psd-import-dialog')+'.open'),'exported PSD report',60000);assert.equal(await evaluate(e('#psd-import-layers')+'.disabled'),false);await click(e('#psd-import-layers'));await waitFor(()=>evaluate('haiyueEditor.listDocuments().documents.length===2'),'exported document',60000);await nextPaint();assert.equal(await evaluate('canvasHash()'),before);
 driver.assertNoBrowserErrors();assert.equal(hash(readFileSync(source)),sourceHash);
 return {status:'passed',importMs,memory:expected.memory,checks:['explicit budget report and cancel','merged pixels match source exactly','opacity edit and undo','worker PSD export and reopen','source file unchanged'],runner:{chrome:driver.chrome,platform:process.platform,arch:process.arch,node:process.version},browser:await evaluate('navigator.userAgent')};
}});
const files=[...readdirSync(resolve(root,'imageEditor/src')).map(f=>'imageEditor/src/'+f),'imageEditor/test/psd-memory-browser.mjs','imageEditor/index.html','imageEditor/styles.css','scripts/editor-e2e/browserDriver.mjs','package-lock.json'];
writeFileSync(resolve(out,'browser.json'),JSON.stringify({...report,schemaVersion:1,generatedAt:new Date().toISOString(),fixture:{name:basename(source),sha256:sourceHash,bytes:input.length},revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),buildHash:JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash,sourceFingerprints:Object.fromEntries(files.map(f=>[f,hash(readFileSync(resolve(root,f)))]))},null,2)+'\n');console.log(report);
