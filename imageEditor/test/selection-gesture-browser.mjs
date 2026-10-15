import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
const diskMode=process.argv.includes('--disk');
const root=fileURLToPath(new URL('../../',import.meta.url)),output=resolve(root,diskMode?'imageEditor/artifacts/disk-gestures':'imageEditor/artifacts/selection-gesture'),downloads=resolve(output,`downloads-${Date.now()}`);mkdirSync(downloads,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'imageEditor/app-dist/index.html',downloadDirectory:downloads,failureScreenshotPath:resolve(output,'failure.png'),timeoutMs:30000,readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy")==="false"',scenario:async driver=>{
 const {evaluate,click,replaceText,nextPaint:nextFrame,cdp,waitFor}=driver,checks=[];const nextPaint=async()=>{await nextFrame();if(diskMode)await waitFor(()=>evaluate(`document.querySelector('#image-canvas').dataset.painting==='false'`),'async paint',30000);};
 const e=s=>`document.querySelector(${JSON.stringify(s)})`,act=a=>click(e(`[data-action="${a}"]`)),tool=t=>click(e(`[data-tool="${t}"]`));
 const selection=()=>evaluate('JSON.stringify({hidden:document.querySelector("#selection-outline").hidden,x:parseFloat(document.querySelector("#selection-outline").style.left),y:parseFloat(document.querySelector("#selection-outline").style.top),width:parseFloat(document.querySelector("#selection-outline").style.width),height:parseFloat(document.querySelector("#selection-outline").style.height)})').then(JSON.parse);
 const point=async(x,y)=>{const r=JSON.parse(await evaluate('JSON.stringify(document.querySelector("#image-canvas").getBoundingClientRect())'));return {x:r.x+x*r.width/1000,y:r.y+y*r.height/700};};
 const pointer=async(type,p)=>cdp.call('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
 const drag=async(a,b)=>{const start=await point(...a),end=await point(...b);await pointer('mousePressed',start);await pointer('mouseMoved',end);await nextPaint();await pointer('mouseReleased',end);await nextPaint();};
 const pendingText=async(selector,value)=>{await click(e(selector));await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await cdp.call('Input.insertText',{text:value});assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),value);};
 const pixel=(x,y)=>evaluate(`Array.from(document.querySelector('#image-canvas').getContext('2d').getImageData(${x},${y},1,1).data)`);
 const expect=async(rect,label)=>assert.deepEqual(await selection(),{hidden:false,...rect},label);
 await click(e('.header-actions [data-action=new]'));await replaceText(e('#new-name'),'选区手势回归');await replaceText(e('#new-width'),'1000');await replaceText(e('#new-height'),'700');await evaluate('document.querySelector("#new-background").value="white"');await click(e('#new-form button[type=submit]'));await nextPaint();await act('actual');await tool('select');
 if(diskMode){await evaluate(`(async()=>{const list=haiyueEditor.listDocuments(),d=list.documents.find(d=>d.identity.id===list.activeId);for(const operation of ['image.storage.spill','image.storage.trim']){const r=await haiyueEditor.execute({apiVersion:'1',requestId:operation,operation,documentId:d.identity.id,expectedRevision:d.revision,params:{}});if(r.status!=='completed')throw Error(JSON.stringify(r));}})()`);await nextPaint();}
 await drag([100,100],[200,200]);await expect({x:100,y:100,width:100,height:100},'initial selection');
 await drag([400,300],[600,500]);await expect({x:400,y:300,width:200,height:200},'replacement selection');checks.push('repeated mouse drags replace old selection');
 // Leave a real property edit pending: its change event occurs when the canvas takes focus.
 await pendingText('#layer-name','拖动前刚改名');
 await drag([250,200],[350,350]);await expect({x:250,y:200,width:100,height:150},'drag must survive property blur commit');checks.push('drag after pending property edit commits the new selection');
 await pendingText('#layer-x','7');await drag([350,200],[450,300]);await expect({x:350,y:200,width:100,height:100},'pending coordinate edit must not cancel selection');assert.equal(await evaluate('document.querySelector("#layer-x").value'),'7');checks.push('pending layer coordinate edits commit before rectangle gesture snapshot');
 await tool('ellipse');await pendingText('#opacity','65');await drag([500,300],[700,500]);await expect({x:500,y:300,width:200,height:200},'pending opacity edit must not cancel ellipse');assert.equal(await evaluate('document.querySelector("#selection-mask").hidden'),false);
 await act('clear');await nextPaint();assert.equal((await pixel(600,400))[3],0);assert.equal((await pixel(500,300))[3],166);assert.equal((await pixel(400,250))[3],166);await act('undo');await nextPaint();await expect({x:500,y:300,width:200,height:200},'undo pixels must retain newest ellipse');checks.push('ellipse after opacity blur controls real edited pixels, and undo restores the new region');
 for(let i=0;i<12;i++){await tool(i%2?'ellipse':'select');const x=100+i*30;await drag([x,150],[x+80,250]);await expect({x,y:150,width:80,height:100},'consecutive rectangle/ellipse replacement '+i);}
 checks.push('12 alternating rectangle and ellipse gestures retain their final region');
 // A harmless active-tab refresh emits a workspace update without changing the document.
 await tool('select');const refreshStart=await point(300,400),refreshEnd=await point(450,550);await pointer('mousePressed',refreshStart);await pointer('mouseMoved',refreshEnd);await nextPaint();await expect({x:300,y:400,width:150,height:150},'live preview before refresh');
 await evaluate('document.querySelector(".document-tab.active [role=tab]").click()');await nextPaint();await expect({x:300,y:400,width:150,height:150},'refresh must preserve live preview');await pointer('mouseReleased',refreshEnd);await nextPaint();await expect({x:300,y:400,width:150,height:150},'refreshed drag must commit');checks.push('same-document refresh preserves live selection preview and final commit');
 // Touch taps get implicit capture on the canvas; their release must not discard polygon vertices.
 await tool('polygon');
 const touch=async(type,x,y)=>cdp.call('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{...await point(x,y),id:1}]});
 for(const [x,y] of [[500,150],[700,150],[500,350]]){await touch('touchStart',x,y);await touch('touchEnd',x,y);await nextPaint();}
 await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter'});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter'});await nextPaint();
 const polygon=await selection();assert(polygon.x>=499&&polygon.x<=501&&polygon.y>=149&&polygon.y<=151,'touch capture release must preserve polygon vertices');checks.push('implicit touch capture release preserves polygon selection');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:818,height:904,deviceScaleFactor:1,mobile:false});await nextPaint();await act('zoom-out');
 for(let i=0;i<8;i++){await tool(i%2?'ellipse':'select');const x=350+i*15;await drag([x,300],[x+113,415]);const actual=await selection();for(const [key,value] of Object.entries({x,y:300,width:113,height:115}))assert(Math.abs(actual[key]-value)<=1,'narrow window replacement '+i+' '+JSON.stringify(actual));}
 checks.push('narrow 818px window with zoom retains 8 consecutive final selections');
 await cdp.call('Emulation.clearDeviceMetricsOverride');await nextPaint();
 const shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(output,'selection-fixed.png'),Buffer.from(shot.result.data,'base64'));
 await act('save');const saved=await waitFor(()=>readdirSync(downloads).find(f=>f.endsWith('.hyimage')),'saved current selection');const source=readFileSync(resolve(downloads,saved),'utf8'),envelope=JSON.parse(source),stored=(await import('../dist/projectFile.js')).deserializeProject(envelope.version===14?envelope.project:source,false,envelope.version===14).selection,shown=await selection();for(const key of ['x','y','width','height'])assert.equal(stored[key],shown[key]);assert(stored.mask);checks.push('saved project contains the visible latest selection rather than stale geometry');
 driver.assertNoBrowserErrors();return {schemaVersion:1,status:'passed',checks,generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),runner:{chrome:driver.chrome,platform:process.platform,arch:process.arch},buildHash:JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash,browser:await evaluate('navigator.userAgent'),sourceFingerprints:Object.fromEntries([...readdirSync(resolve(root,'imageEditor/src')).map(f=>'imageEditor/src/'+f),'imageEditor/test/selection-gesture-browser.mjs','imageEditor/index.html','imageEditor/styles.css','imageEditor/app/descriptor.json','imageEditor/rollup.config.js','package-lock.json','scripts/editor-e2e/browserDriver.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]))};
}});writeFileSync(resolve(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
