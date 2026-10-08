import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';

const root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'shaderEditor/artifacts/browser');
const downloads = resolve(output, `downloads-${Date.now()}`); mkdirSync(downloads, {recursive:true});
const report = await runEditorBrowserScenario({root, route:'shaderEditor/app-dist/index.html', downloadDirectory:downloads,
  failureScreenshotPath:resolve(output,'failure.png'), timeoutMs:45000,
  readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy") === "false"',
  scenario: async driver => {
    const {evaluate, click, waitFor, nextPaint, cdp, setFileInputFiles} = driver;
    const checks = [], el = id => `document.getElementById(${JSON.stringify(id)})`;
    const shot = async name => { await nextPaint(); const response = await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); writeFileSync(resolve(output,name),Buffer.from(response.result.data,'base64')); };
    const api = (operation,params={}) => evaluate(`(async()=>{ const d=window.haiyueEditor.listDocuments().documents[0]; return await window.haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),operation:${JSON.stringify(operation)},documentId:d.identity.id,expectedRevision:d.revision,params:${JSON.stringify(params)}});})()`);
    const call = async (operation,params={}) => { const response=await api(operation,params); assert.equal(response.status,'completed',JSON.stringify(response)); return response.value; };
    const savedProjects = () => evaluate(`new Promise((resolve,reject)=>{
      const request=indexedDB.open('haiyue.shader-editor.v1',1);
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction('projects','readonly'),items=tx.objectStore('projects').getAll();
        tx.oncomplete=()=>{db.close();resolve(items.result);};
        tx.onerror=()=>{db.close();reject(tx.error);};
      };
    })`);
    const pixels = async () => {
      const result = await call('shader.image.read');
      const rgba = await evaluate(`(()=>{const bytes=haiyueEditor.readResource(${JSON.stringify(result.resourceId)}); const w=${result.width},h=${result.height};const at=(x,y)=>Array.from(bytes.slice((y*w+x)*4,(y*w+x)*4+4));const output={center:at(w>>1,h>>1),topLeft:at(w>>2,h>>2),bottomLeft:at(w>>2,(h*3)>>2),width:w,height:h};haiyueEditor.releaseResource(${JSON.stringify(result.resourceId)});return output;})()`);
      return rgba;
    };
    const channelPreview = async index => {
      await waitFor(()=>evaluate(`document.querySelector('.channel-card[data-channel="${index}"] .buffer-preview')?.dataset.previewState === 'ready'`),'Buffer channel preview ready');
      await nextPaint();
      const preview=await evaluate(`(()=>{const source=document.querySelector('.channel-card[data-channel="${index}"] .buffer-preview'),r=source.getBoundingClientRect();return {pass:source.dataset.buffer,frame:Number(source.dataset.previewFrame),width:source.width,height:source.height,clip:{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}};})()`);
      // WebGPU's drawable texture expires after presentation. Check the actual
      // composited thumbnail, including RGB visibility when Buffer alpha is zero.
      const screenshot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:preview.clip});
      const colors=await evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${screenshot.result.data}';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const at=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);return {center:at(canvas.width>>1,canvas.height>>1),top:at(canvas.width>>1,canvas.height>>2),bottom:at(canvas.width>>1,(canvas.height*3)>>2)};})()`);
      return {...preview,...colors};
    };
    const examplePreviews = () => evaluate(`(async()=>{
      const images=Array.from(document.querySelectorAll('#examples .card-art img'));
      await Promise.all(images.map(image=>image.decode()));
      return images.map(image=>({id:image.closest('button').dataset.project,src:image.src,width:image.naturalWidth,height:image.naturalHeight}));
    })()`);
    await waitFor(()=>evaluate('document.querySelectorAll("#examples .card-art img").length === 5'),'real GPU gallery thumbnails');
    const originalPreviews=await examplePreviews();
    assert.ok(originalPreviews.every(image=>image.width===480 && image.height===270));
    assert.equal(new Set(originalPreviews.map(image=>image.src)).size,5,'examples have distinct rendered previews');
    await shot('gallery.png'); checks.push('Gallery renders five actual Haiyue shader thumbnails');
    await click('document.querySelector("#examples .card-open")');
    await waitFor(()=>evaluate('window.shaderEditor.getStatus()?.ready && window.shaderEditor.getStatus()?.frame > 2'),'initial WebGPU frame');
    assert.equal(await evaluate('document.querySelectorAll(".cm-line span").length > 0'),true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".cm-scroller")).display'),'flex');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".cm-line span")).color'),'rgb(196, 165, 250)');
    assert.equal(await evaluate('Math.abs(document.querySelector(".cm-line").getBoundingClientRect().y-document.querySelector(".cm-lineNumbers .cm-gutterElement:nth-child(2)").getBoundingClientRect().y)<8'),true);
    assert.equal(await evaluate('document.querySelectorAll(".channel-card").length'),4);
    await shot('editor.png'); checks.push('example opens, WGSL syntax highlighting and four channels');
    assert.deepEqual(await savedProjects(),[],'opening and rendering an example does not save it');
    assert.equal(await evaluate(`${el('save-state')}.textContent`),'尚未保存');
    const draftId=await evaluate('shaderEditor.getProject().id');
    await click(el('back-gallery'));
    assert.equal(await evaluate('document.querySelectorAll("#saved-projects .shader-card").length'),0);
    await click(el('nav-editor'));
    assert.equal(await evaluate('shaderEditor.getProject().id'),draftId,'returning from Gallery retains the draft');
    await click('document.querySelector(".brand")');
    await click('document.querySelectorAll("#examples .card-open")[1]');
    await waitFor(()=>evaluate('!document.getElementById("compile").disabled && shaderEditor.getStatus()?.frame>0'),'second example rendered');
    await click(el('nav-gallery'));
    assert.deepEqual(await savedProjects(),[],'navigation and switching examples do not create saved projects');
    await click('document.querySelector("#examples .card-open")');
    await waitFor(()=>evaluate('!document.getElementById("compile").disabled && shaderEditor.getStatus()?.frame>0'),'first example reopened');
    checks.push('opening, rendering and switching examples, back button, Gallery tab and brand navigation leave My Works empty; draft survives Gallery navigation');
    await call('shader.playback.set',{playing:false});
    const splitRatio = id => evaluate(`${el(id)}.ratio`);
    const dragSplit = async (id,dx,dy) => {
      const point = await evaluate(`(()=>{const r=${el(id)}.shadowRoot.querySelector('[role=separator]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
      await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+dx,y:point.y+dy,button:'left',buttons:1});
      await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+dx,y:point.y+dy,button:'left'}); await nextPaint();
    };
    const originalRatio = await splitRatio('workspace-split');
    const originalWidth = await evaluate('document.getElementById("shader-canvas").clientWidth');
    await dragSplit('workspace-split',70,0);
    assert.ok(await splitRatio('workspace-split') > originalRatio);
    assert.ok(await evaluate('document.getElementById("shader-canvas").clientWidth') > originalWidth);
    const originalPreview = await splitRatio('preview-split'); await dragSplit('preview-split',0,-25);
    assert.ok(await splitRatio('preview-split') < originalPreview);
    const originalCode = await splitRatio('code-split');
    await evaluate('document.getElementById("code-split").shadowRoot.querySelector("[role=separator]").focus()');
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38}); await nextPaint();
    assert.ok(await splitRatio('code-split') < originalCode);
    await click('document.querySelector(".cm-content")');
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',modifiers:2,windowsVirtualKeyCode:35});
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',modifiers:2,windowsVirtualKeyCode:35});
    await cdp.call('Input.insertText',{text:'\n// edited inside split pane'});
    await waitFor(()=>evaluate('shaderEditor.getProject().passes[4].code.includes("// edited inside split pane")'),'slotted CodeMirror editing');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".cm-scroller")).display'),'flex');
    const storedRatio = await splitRatio('workspace-split');
    assert.equal(await evaluate('document.querySelectorAll("ge-select").length'),8);
    const optionColors = await evaluate(`(()=>{const s=${el('preview-scale')}.shadowRoot.querySelector('select'); return Array.from(s.options).map(o=>{const c=getComputedStyle(o);return {foreground:c.color,background:c.backgroundColor,scheme:getComputedStyle(s).colorScheme};});})()`);
    assert.ok(optionColors.every(c=>c.scheme==='dark' && ((c.background==='rgb(28, 34, 44)' && c.foreground==='rgb(233, 237, 243)') || (c.background==='rgb(53, 71, 41)' && c.foreground==='rgb(216, 247, 183)'))),JSON.stringify(optionColors));
    const selectScale = async key => {
      await click(`${el('preview-scale')}.shadowRoot.querySelector('select')`);
      await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Home'?36:40});
      await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:key==='Home'?36:40});
      await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    };
    await selectScale('ArrowDown');
    await waitFor(()=>evaluate('shaderEditor.getProject().preview.scale===0.5 && !document.getElementById("compile").disabled && shaderEditor.getStatus().frame>0'),'UI select changes render scale and renders');
    const halfWidth = (await pixels()).width;
    await selectScale('Home');
    await waitFor(()=>evaluate('shaderEditor.getProject().preview.scale===1 && !document.getElementById("compile").disabled && shaderEditor.getStatus().frame>0'),'UI select restores full scale and renders');
    assert.ok(Math.abs((await pixels()).width-halfWidth*2)<=2);
    await click(`${el('auto-run')}.shadowRoot.querySelector('label')`);
    await waitFor(()=>evaluate(`${el('auto-run')}.checked && !${el('compile')}.disabled`),'shared auto-run checkbox');
    await click(`${el('auto-run')}.shadowRoot.querySelector('label')`);
    assert.equal(await evaluate(`${el('auto-run')}.checked`),false);
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await click('document.querySelector("#pass-tabs [data-pass=buffer-a]")');
    await click(`${el('pass-enabled')}.shadowRoot.querySelector('label')`);
    await waitFor(()=>evaluate('shaderEditor.getProject().passes[0].enabled && !document.getElementById("compile").disabled'),'shared Pass checkbox enables buffer');
    await click(`${el('pass-enabled')}.shadowRoot.querySelector('label')`);
    await waitFor(()=>evaluate('!shaderEditor.getProject().passes[0].enabled && !document.getElementById("compile").disabled'),'shared Pass checkbox disables buffer');
    await click('document.querySelector("#pass-tabs [data-pass=image]")');
    await shot('resized-editor.png');
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:720,height:1000,deviceScaleFactor:1,mobile:false});
    await waitFor(()=>evaluate('document.getElementById("workspace-split").direction==="vertical"'),'responsive vertical split'); await nextPaint();
    assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'),true);
    await shot('narrow-editor.png');
    await cdp.call('Emulation.clearDeviceMetricsOverride');
    await waitFor(()=>evaluate('document.getElementById("workspace-split").direction==="horizontal"'),'desktop split restored'); await nextPaint();
    assert.equal(await splitRatio('workspace-split'),storedRatio);
    checks.push('shared UI select has dark readable options and changes resolution; checkboxes toggle auto-run and Pass state; three splits resize, support keyboard, preserve code highlighting/editing and adapt to narrow screens');
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return vec4f(0.25, 0.5, 0.75, 1.0); }'});
    assert.equal((await call('shader.compile')).compiled,true); await call('shader.playback.step');
    const flat = await pixels(); [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(flat.center[i]-expected)<=1,JSON.stringify(flat.center))); checks.push('WGSL executes on GPU with RGBA8 output validation (one quantization step tolerance)');
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f {\n return missing_name;\n}'});
    const error = await call('shader.compile'); assert.equal(error.compiled,false); assert.equal(error.diagnostics[0].line,2);
    assert.equal(await evaluate('shaderEditor.getStatus().ready'),true); assert.deepEqual((await pixels()).center,flat.center);
    checks.push('invalid WGSL reports source line and preserves last working renderer and pixels');
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    await call('shader.code.set',{pass:'buffer-a',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy) + vec4f(0.1, 0.0, 0.0, 0.0); }'});
    await call('shader.channel.set',{pass:'buffer-a',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    assert.equal((await call('shader.compile')).compiled,true);
    await call('shader.playback.step'); const first = (await pixels()).center[0];
    await call('shader.playback.step'); const second = (await pixels()).center[0]; assert.ok(second-first>=24 && second-first<=27,`${first} -> ${second}`);
    const feedbackPreview=await channelPreview(0);
    assert.equal(feedbackPreview.pass,'buffer-a');assert.ok(Math.abs(feedbackPreview.center[0]-second)<=1,JSON.stringify(feedbackPreview));
    assert.equal(feedbackPreview.center[3],255,'Buffer alpha is data, not thumbnail transparency');
    const pausedPreviewFrame=await evaluate('shaderEditor.getStatus().frame');
    await click('document.querySelector("#pass-tabs [data-pass=buffer-a]")');
    const selfPreview=await channelPreview(0);assert.ok(Math.abs(selfPreview.center[0]-second)<=1);assert.equal(await evaluate('shaderEditor.getStatus().frame'),pausedPreviewFrame,'previewing feedback does not advance its state');
    await click('document.querySelector("#pass-tabs [data-pass=image]")');
    await call('shader.playback.reset'); await call('shader.playback.step'); assert.ok((await pixels()).center[0]<=52);
    const resetPreview=await channelPreview(0);assert.ok(resetPreview.center[0]<=52,JSON.stringify(resetPreview));
    await call('shader.playback.set',{playing:true});
    await waitFor(()=>evaluate('Number(document.querySelector(".buffer-preview").dataset.previewFrame)>4'),'playing updates Buffer previews');
    await call('shader.playback.set',{playing:false});
    await waitFor(()=>evaluate('Number(document.querySelector(".buffer-preview").dataset.previewFrame)===shaderEditor.getStatus().frame'),'paused preview catches up to the final frame');
    checks.push('Floating-point ping-pong self-feedback accumulates, Image sees current Buffer, reset clears history');
    const precisionResult=await call('shader.glsl.translate',{code:readFileSync(resolve(import.meta.dirname,'fixtures/feedback-precision.glsl'),'utf8')});
    assert.deepEqual(precisionResult.diagnostics,[]);
    await call('shader.code.set',{pass:'buffer-a',code:precisionResult.code});
    // Sampling halfway between adjacent pixels verifies linear filtering of RGBA32F.
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0((p + vec2f(0.5, 0.0)) / iResolution.xy); }'});
    const precisionCompiled=await call('shader.compile');assert.equal(precisionCompiled.compiled,true,JSON.stringify(precisionCompiled));
    const precisionFormat=await evaluate('shaderEditor.getStatus().bufferFormat');
    assert.ok(['rgba32float','rgba16float'].includes(precisionFormat));
    if(precisionFormat==='rgba32float')assert.deepEqual(precisionCompiled.diagnostics,[]);
    else assert.ok(precisionCompiled.diagnostics.some(d=>d.severity==='warning' && d.message.includes('16 位兼容模式')));
    await call('shader.playback.step');
    for(let frame=0;frame<32;frame++){
      await call('shader.playback.step');
      if(frame===0 || frame===1 || frame===31){
        const sampled=await pixels();
        const expected=precisionFormat==='rgba32float'?[128,128,128,255]:[255,0,0,255];
        for(const point of ['center','topLeft','bottomLeft'])expected.forEach((value,i)=>assert.ok(Math.abs(sampled[point][i]-value)<=1,'feedback precision '+frame+' '+point+': '+JSON.stringify(sampled[point])));
      }
    }
    await call('shader.playback.reset');await call('shader.playback.step');await call('shader.playback.step');
    const resetPrecision=await pixels();
    assert.ok(Math.abs(resetPrecision.center[0]-(precisionFormat==='rgba32float'?128:255))<=1);
    checks.push('feedback format '+precisionFormat+' verified across 32 frames/reset: camera coefficients, signed translations and alpha retain precision, half-texel sampling stays linear; unsupported hardware exposes an explicit precision warning');
    for (const [index,pass] of ['buffer-a','buffer-b','buffer-c','buffer-d'].entries()) {
      await call('shader.code.set',{pass,code:`fn mainImage(p: vec2f) -> vec4f { return vec4f(${index===0||index===3?'1.0':'0.0'},${index===1||index===3?'1.0':'0.0'},${index===2||index===3?'1.0':'0.0'},1.0); }`});
      await call('shader.channel.set',{pass:'image',index,channel:{kind:'buffer',pass}});
    }
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { let uv=p/iResolution.xy; return (channel0(uv)+channel1(uv)+channel2(uv)+channel3(uv))*0.25; }'});
    assert.equal((await call('shader.compile')).compiled,true);await call('shader.playback.step');
    const fourBuffers=(await pixels()).center;assert.ok(fourBuffers.slice(0,3).every(v=>v>=127&&v<=128));
    const channelColors=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,255,255]];
    for(let index=0;index<4;index++){
      const preview=await channelPreview(index);assert.equal(preview.pass,['buffer-a','buffer-b','buffer-c','buffer-d'][index]);
      channelColors[index].forEach((expected,i)=>assert.ok(Math.abs(preview.center[i]-expected)<=1,JSON.stringify(preview)));
      assert.ok(preview.width<=256 && preview.height<=256,'thumbnails stay small');
      const size=await evaluate('shaderEditor.getStatus()');assert.ok(Math.abs(preview.width/preview.height-size.width/size.height)<0.06,'preserves Buffer aspect ratio');
    }
    await call('shader.code.set',{pass:'buffer-a',code:'fn mainImage(p: vec2f) -> vec4f { let top=step(iResolution.y*0.5,p.y); return vec4f(top,0.0,1.0-top,0.0); }'});
    assert.equal((await call('shader.compile')).compiled,true);await call('shader.playback.step');
    const orientedPreview=await channelPreview(0);assert.deepEqual(orientedPreview.top,[255,0,0,255]);assert.deepEqual(orientedPreview.bottom,[0,0,255,255]);
    await shot('buffer-channel-previews.png');
    await call('shader.code.set',{pass:'buffer-a',code:'fn mainImage(p: vec2f) -> vec4f { return missing_preview_value; }'});
    assert.equal((await call('shader.compile')).compiled,false);
    const preservedPreview=await channelPreview(0);assert.deepEqual(preservedPreview.top,orientedPreview.top);assert.deepEqual(preservedPreview.bottom,orientedPreview.bottom);
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-b'}});
    const switchedPreview=await channelPreview(0);assert.deepEqual(switchedPreview.center,[0,255,0,255]);assert.equal(switchedPreview.pass,'buffer-b');
    await click(el('nav-gallery'));const hiddenPreviewFrame=await evaluate('document.querySelector(".buffer-preview").dataset.previewFrame');await nextPaint();
    assert.equal(await evaluate('document.querySelector(".buffer-preview").dataset.previewFrame'),hiddenPreviewFrame);
    await click(el('nav-editor'));assert.deepEqual((await channelPreview(0)).center,[0,255,0,255]);
    for(const pass of ['buffer-a','buffer-b','buffer-c','buffer-d'])await call('shader.pass.enable',{pass,enabled:false});
    assert.equal(await evaluate('document.querySelectorAll(".buffer-preview").length'),0,'disabling sources removes preview surfaces');
    checks.push('Buffer channels show live GPU thumbnails with A-D badges, correct independent colors/aspect/orientation and visible RGB at zero alpha; playback/step/reset/self-feedback, paused pass switching, compile failure, source switching, hidden routing and disable cleanup preserve rendering state');
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    checks.push('all four framebuffer inputs are independently bound and composited on GPU');
    // Actual file-input upload of a 2×2 image with red top and blue bottom.
    const data = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=c.height=2;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,2,1);x.fillStyle='#0000ff';x.fillRect(0,1,2,1);return c.toDataURL('image/png').split(',')[1];})()`);
    const fixture=resolve(output,'texture.png');writeFileSync(fixture,Buffer.from(data,'base64'));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await evaluate('document.querySelector(".upload-channel").scrollIntoView({block:"center"})');
    await click('document.querySelector(".upload-channel")'); await setFileInputFiles('#texture-input',[fixture]);
    await waitFor(()=>evaluate('shaderEditor.getProject().assets.length === 1 && !document.getElementById("compile").disabled'),'image texture compiled');
    await call('shader.playback.step');
    const texture=await pixels(); assert.ok(texture.topLeft[0]>220 && texture.topLeft[2]<35,JSON.stringify(texture));assert.ok(texture.bottomLeft[2]>220 && texture.bottomLeft[0]<35);
    const assetId = await evaluate('shaderEditor.getProject().assets[0].id');
    for(let i=1;i<4;i++) await call('shader.channel.set',{pass:'image',index:i,channel:{kind:'image',assetId}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { let uv=p/iResolution.xy; return (channel0(uv)+channel1(uv)+channel2(uv)+channel3(uv))*0.25; }'});
    assert.equal((await call('shader.compile')).compiled,true);await call('shader.playback.step');assert.deepEqual((await pixels()).topLeft,texture.topLeft);
    checks.push('file upload, all four image bindings, and bottom-left sampling orientation verified');
    await evaluate('document.getElementById("mode-scene").scrollIntoView({block:"center"})');
    await click(el('mode-scene'));await nextPaint();assert.equal(await evaluate('shaderEditor.getStatus().mode'),'scene');
    await waitFor(()=>evaluate('!document.getElementById("gpu-overlay").classList.contains("failed")'),'3D pipeline remains valid');
    const before = await evaluate('shaderEditor.getStatus().camera');
    const pausedFrame = await evaluate('shaderEditor.getStatus().frame');
    const rect = await evaluate('(()=>{const r=document.getElementById("shader-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()');
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+90,y:y+40,button:'left',buttons:1});
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+90,y:y+40,button:'left'});await nextPaint();
    assert.notEqual((await evaluate('shaderEditor.getStatus().camera')).theta,before.theta);
    assert.equal(await evaluate('shaderEditor.getStatus().frame'),pausedFrame,'orbiting while paused must not advance feedback');
    await shot('scene.png');
    for(const mesh of ['box','torus','sphere']) {await call('shader.preview.set',{mode:'scene',mesh});await nextPaint();}
    await click(el('reset-camera'));assert.equal((await evaluate('shaderEditor.getStatus().camera')).theta,0.45);
    await click(el('mode-canvas')); checks.push('Haiyue 3D material mode, sphere/box/torus, orbit drag and camera reset');
    const macroSource = '// Shadertoy macro example\n#define BASE 0.25\n#define DOUBLE(x) ((x)+(x))\n#define COLOR(r,g,b) vec4(r,g,b,1.0)\n#define MAKE COLOR\nvoid mainImage(out vec4 c,in vec2 p){\n  float t = iTime; /* built-in time */\n  c=MAKE(BASE,DOUBLE(BASE),BASE+DOUBLE(BASE));\n}';
    const macroResult = await call('shader.glsl.translate',{code:macroSource});
    assert.deepEqual(macroResult.diagnostics,[]); assert.ok(macroResult.code);
    await click(el('glsl-button'));
    const sourceInput = async value => {
      await evaluate('document.getElementById("glsl-source").scrollIntoView({block:"center"})');
      await click('document.querySelector("#glsl-source .cm-scroller")');
      await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
      await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
      await cdp.call('Input.insertText',{text:value}); await nextPaint();
    };
    await sourceInput('#define F(a,b) a+b\nvoid mainImage(out vec4 c,in vec2 p){c=vec4(F(1.0));}');
    await click(el('translate-glsl')); assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),true);
    assert.match(await evaluate(`${el('glsl-messages')}.textContent`),/需要 2 个参数/);
    assert.equal(await evaluate('document.querySelector("#glsl-result .cm-content").textContent.trim()'),'');
    await sourceInput(macroSource);
    const glslColors = await evaluate('Array.from(document.querySelectorAll("#glsl-source .cm-line span")).map(s=>({text:s.textContent,color:getComputedStyle(s).color}))');
    for (const [text,color] of [['#define','rgb(230, 160, 181)'],['BASE','rgb(230, 160, 181)'],['void','rgb(138, 217, 205)'],['out','rgb(196, 165, 250)'],['mainImage','rgb(166, 202, 255)'],['0.25','rgb(239, 189, 133)'],['iTime','rgb(174, 232, 121)'],['// Shadertoy macro example','rgb(105, 119, 137)']]) {
      assert.ok(glslColors.some(token=>token.text===text && token.color===color),`${text}: ${JSON.stringify(glslColors)}`);
    }
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#glsl-source .cm-scroller")).display'),'flex');
    assert.ok(await evaluate('document.querySelectorAll("#glsl-source .cm-lineNumbers .cm-gutterElement").length')>5);
    await click(el('translate-glsl'));assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'valid macro translation enables Apply');
    const wgslColors = await evaluate('Array.from(document.querySelectorAll("#glsl-result .cm-line span")).map(s=>({text:s.textContent,color:getComputedStyle(s).color}))');
    assert.ok(wgslColors.some(token=>token.text==='fn' && token.color==='rgb(196, 165, 250)'));
    assert.ok(wgslColors.some(token=>token.text==='mainImage' && token.color==='rgb(166, 202, 255)'));
    assert.equal(await evaluate('document.querySelector("#glsl-result .cm-content").contentEditable'),'false');
    assert.doesNotMatch(await evaluate('document.querySelector("#glsl-result .cm-content").textContent'),/不支持|转换后需|GLSL 子集/);
    assert.match(await evaluate(`${el('glsl-messages')}.textContent`),/转换后需通过 WGSL 编译/);
    await evaluate('document.getElementById("glsl-result").scrollIntoView({block:"nearest"})');
    await shot('glsl-highlight.png');
    await sourceInput(macroSource+'\n// changed'); assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),true);
    assert.match(await evaluate(`${el('glsl-messages')}.textContent`),/重新翻译/);
    assert.equal(await evaluate('document.querySelector("#glsl-result .cm-content").textContent.trim()'),'');
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});
    assert.equal(await evaluate('document.querySelector("#glsl-source .cm-content").textContent.includes("// changed")'),false,'undo restores the previous GLSL source');
    await evaluate('document.querySelector("#glsl-dialog .dialog-header").scrollIntoView({block:"nearest"})');
    await click('document.querySelector("#glsl-dialog .dialog-header button")'); await click(el('glsl-button'));
    assert.ok(await evaluate('document.querySelector("#glsl-source .cm-content").textContent.includes("#define BASE")'));
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',modifiers:2,windowsVirtualKeyCode:13});
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',modifiers:2,windowsVirtualKeyCode:13});
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'Ctrl+Enter translates after reopening');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'macro shader applied and compiled');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),macroResult.code);
    await call('shader.playback.step');
    const macroPixels=(await pixels()).center;[64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(macroPixels[i]-expected)<=1,JSON.stringify(macroPixels)));
    checks.push('define constants, nested parameter macros and aliases translate through API and UI, compile on GPU and render expected pixels; invalid arity cannot be applied');
    checks.push('GLSL CodeMirror highlights macros, types, keywords, functions, numbers, built-ins and comments; paste, undo, reopen, stale-result invalidation and keyboard translation work');
    const overloadSource = readFileSync(resolve(import.meta.dirname,'fixtures/overloads.glsl'),'utf8');
    const overloadResult = await call('shader.glsl.translate',{code:overloadSource});
    assert.deepEqual(overloadResult.diagnostics,[]); assert.ok(overloadResult.code);
    await click(el('glsl-button'));await sourceInput(overloadSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'overload translation enables Apply');
    await evaluate('document.getElementById("glsl-result").scrollIntoView({block:"nearest"})');
    await shot('glsl-overloads.png');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'overloaded shader applied and compiled');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),overloadResult.code);
    const overloadCompiled = await call('shader.compile'); assert.equal(overloadCompiled.compiled,true,JSON.stringify(overloadCompiled));
    await call('shader.playback.step');
    const overloadPixels=(await pixels()).center;[64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(overloadPixels[i]-expected)<=1,JSON.stringify(overloadPixels)));
    checks.push('seven overloads, prototypes, integer/unsigned/float/bool/vector and nested macro calls compile and produce expected GPU pixels; generated WGSL has read-only highlighting with separate diagnostics');
    const globalsSource = readFileSync(resolve(import.meta.dirname,'fixtures/globals.glsl'),'utf8');
    const globalsResult = await call('shader.glsl.translate',{code:globalsSource});
    assert.deepEqual(globalsResult.diagnostics,[]); assert.ok(globalsResult.code);
    await click(el('glsl-button'));await sourceInput(globalsSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'mutable global translation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'global shader applied and compiled');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),globalsResult.code);
    const globalsCompiled = await call('shader.compile'); assert.equal(globalsCompiled.compiled,true,JSON.stringify(globalsCompiled));
    for (let frame=0;frame<3;frame++) {
      const state=await call('shader.playback.step'), sampled=await pixels();
      const expected=[191,191,Math.round(((state.frame-1)*0.125+state.time)*255),255];
      for(const point of ['center','topLeft','bottomLeft']) expected.forEach((value,i)=>assert.ok(Math.abs(sampled[point][i]-value)<=1,`${point}: ${JSON.stringify(sampled[point])}; expected ${JSON.stringify(expected)}`));
    }
    checks.push('mutable globals translate through API and UI; ordered initializers, helper mutations, overloads, shadowing and swizzle writes compile on GPU; globals stay private per pixel/frame and initializers read current iFrame/iTime');
    const expressionSource = readFileSync(resolve(import.meta.dirname,'fixtures/expressions.glsl'),'utf8');
    const expressionResult = await call('shader.glsl.translate',{code:expressionSource});
    assert.deepEqual(expressionResult.diagnostics,[]); assert.ok(expressionResult.code);
    await click(el('glsl-button'));await sourceInput(expressionSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'increment expressions and declaration lists enable Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'expression shader applied and compiled');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),expressionResult.code);
    const expressionCompiled=await call('shader.compile'); assert.equal(expressionCompiled.compiled,true,JSON.stringify(expressionCompiled));
    for(let frame=0;frame<2;frame++) {
      await call('shader.playback.step'); const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`${point}: ${JSON.stringify(sampled[point])}`));
    }
    checks.push('GLSL prefix/postfix updates, float/int/uint/vector values, indexed/swizzled/global writes, short-circuit and continue semantics, single-evaluation builtins and comma-separated declarations compile and produce correct GPU pixels');
    const matrixSource=readFileSync(resolve(import.meta.dirname,'fixtures/matrices.glsl'),'utf8');
    const matrixResult=await call('shader.glsl.translate',{code:matrixSource});
    assert.deepEqual(matrixResult.diagnostics,[]);assert.ok(matrixResult.code);
    await click(el('glsl-button'));await sourceInput(matrixSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'matrix translation enables Apply');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("#glsl-result .cm-line span")).some(s=>s.textContent==="mat2x2f" && getComputedStyle(s).color==="rgb(138, 217, 205)")'),true);
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'matrix shader applied');
    const matrixCompiled=await call('shader.compile');assert.equal(matrixCompiled.compiled,true,JSON.stringify(matrixCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`matrix ${point}: ${JSON.stringify(sampled[point])}`));
    }
    checks.push('GLSL square/non-square matrices translate through API and UI with WGSL highlighting; constructors, matrix/vector multiplication, scalar operations, inverse/determinant/transpose, globals, overloads and indexed/swizzled writes produce correct GPU pixels');
    await call('shader.code.set',{pass:'buffer-a',code:'fn mainImage(p: vec2f) -> vec4f { return vec4f(0.0,0.5,0.0,1.0); }'});
    await call('shader.code.set',{pass:'buffer-b',code:'fn mainImage(p: vec2f) -> vec4f { return vec4f(0.25,0.0,0.75,1.0); }'});
    await call('shader.channel.set',{pass:'image',index:1,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.channel.set',{pass:'image',index:3,channel:{kind:'buffer',pass:'buffer-b'}});
    const samplerSource=readFileSync(resolve(import.meta.dirname,'fixtures/samplers.glsl'),'utf8');
    const samplerResult=await call('shader.glsl.translate',{code:samplerSource});
    assert.deepEqual(samplerResult.diagnostics,[]);assert.ok(samplerResult.code);
    await click(el('glsl-button'));await sourceInput(samplerSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'sampler2D translation enables Apply');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("#glsl-source .cm-line span")).some(s=>s.textContent==="sampler2D" && getComputedStyle(s).color==="rgb(138, 217, 205)")'),true);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("#glsl-result .cm-line span")).some(s=>s.textContent==="texture_2d" && getComputedStyle(s).color==="rgb(138, 217, 205)")'),true);
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'sampler shader applied');
    const samplerCompiled=await call('shader.compile');assert.equal(samplerCompiled.compiled,true,JSON.stringify(samplerCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['topLeft','bottomLeft']) texture[point].forEach((value,i)=>{const expected=(value+[63.75,0,191.25,255][i])*0.5;assert.ok(Math.abs(sampled[point][i]-expected)<=2,`sampler ${point}: ${JSON.stringify(sampled[point])}; expected channel ${i}=${expected}`);});
    }
    const samplerFeedback=await call('shader.glsl.translate',{code:'vec4 previous(sampler2D source,vec2 uv){return texture(source,uv);} void mainImage(out vec4 c,in vec2 p){c=previous(iChannel0,p/iResolution.xy)+vec4(0.1,0.0,0.0,0.0);}'});
    assert.deepEqual(samplerFeedback.diagnostics,[]);
    await call('shader.code.set',{pass:'buffer-a',code:samplerFeedback.code});
    await call('shader.channel.set',{pass:'buffer-a',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const feedbackCompiled=await call('shader.compile');assert.equal(feedbackCompiled.compiled,true,JSON.stringify(feedbackCompiled));
    await call('shader.playback.step');const samplerFirst=(await pixels()).center[0];
    await call('shader.playback.step');const samplerSecond=(await pixels()).center[0];
    assert.ok(samplerSecond-samplerFirst>=24 && samplerSecond-samplerFirst<=27,`${samplerFirst} -> ${samplerSecond}`);
    for(const pass of ['buffer-a','buffer-b'])await call('shader.pass.enable',{pass,enabled:false});
    for(let index=0;index<4;index++)await call('shader.channel.set',{pass:'image',index,channel:{kind:'image',assetId}});
    checks.push('sampler2D translates through API/UI with GLSL/WGSL highlighting; readonly texture parameters, nested calls, overloads, channel shadowing, uniform declarations, textureSize/texelFetch and single-evaluation coordinates render correct image/framebuffer pixels and feedback');
    const fragCoordSource=readFileSync(resolve(import.meta.dirname,'fixtures/fragcoord.glsl'),'utf8');
    const fragCoordResult=await call('shader.glsl.translate',{code:fragCoordSource});
    assert.deepEqual(fragCoordResult.diagnostics,[]);assert.ok(fragCoordResult.code);
    await click(el('glsl-button'));await sourceInput(fragCoordSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'gl_FragCoord translation enables Apply');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("#glsl-source .cm-line span")).some(s=>s.textContent==="gl_FragCoord" && getComputedStyle(s).color==="rgb(174, 232, 121)")'),true);
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'gl_FragCoord shader applied');
    const fragCoordCompiled=await call('shader.compile');assert.equal(fragCoordCompiled.compiled,true,JSON.stringify(fragCoordCompiled));
    await call('shader.playback.step');const coordImage=await pixels();
    for(const point of ['topLeft','bottomLeft'])texture[point].forEach((expected,i)=>assert.ok(Math.abs(coordImage[point][i]-expected)<=1,`Image gl_FragCoord ${point}: ${JSON.stringify(coordImage[point])}`));
    await call('shader.code.set',{pass:'buffer-a',code:fragCoordResult.code});
    await call('shader.channel.set',{pass:'buffer-a',index:0,channel:{kind:'image',assetId}});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    const coordBufferCompiled=await call('shader.compile');assert.equal(coordBufferCompiled.compiled,true,JSON.stringify(coordBufferCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['topLeft','bottomLeft'])texture[point].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`Buffer gl_FragCoord ${point}: ${JSON.stringify(sampled[point])}`));
    }
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    const coordGradient=await call('shader.glsl.translate',{code:'vec2 initial=gl_FragCoord.xy;vec4 coords(){return gl_FragCoord;}void mainImage(out vec4 c,in vec2 p){vec2 original=p;p=vec2(0.0);vec4 pixel=coords();if(distance(initial,original)>0.00001 || distance(pixel.xy,original)>0.00001){c=vec4(1.0,0.0,0.0,1.0);return;}c=vec4(pixel.xy/iResolution.xy,pixel.zw);}'});
    assert.deepEqual(coordGradient.diagnostics,[]);await call('shader.code.set',{pass:'image',code:coordGradient.code});
    assert.equal((await call('shader.compile')).compiled,true);await call('shader.playback.step');
    const checkCoordinates=async()=>{
      const sampled=await pixels(),w=sampled.width,h=sampled.height;
      for(const [point,x,y] of [['center',w>>1,h>>1],['topLeft',w>>2,h>>2],['bottomLeft',w>>2,(h*3)>>2]]){
        const expected=[(x+0.5)/w*255,(1-(y+0.5)/h)*255,127.5,255];
        expected.forEach((v,i)=>assert.ok(Math.abs(sampled[point][i]-v)<=1,`coordinate ${point}: ${JSON.stringify(sampled[point])}; expected ${JSON.stringify(expected)}`));
      }
      return w;
    };
    const coordFullWidth=await checkCoordinates();
    await selectScale('ArrowDown');
    await waitFor(()=>evaluate('shaderEditor.getProject().preview.scale===0.5 && !document.getElementById("compile").disabled && shaderEditor.getStatus().frame>0'),'gl_FragCoord at half resolution');
    const coordHalfWidth=await checkCoordinates();assert.ok(Math.abs(coordHalfWidth*2-coordFullWidth)<=2);
    await selectScale('Home');
    await waitFor(()=>evaluate('shaderEditor.getProject().preview.scale===1 && !document.getElementById("compile").disabled && shaderEditor.getStatus().frame>0'),'gl_FragCoord restores full resolution');
    assert.equal(await checkCoordinates(),coordFullWidth);
    checks.push('gl_FragCoord translates through API/UI, resolves in helpers and globals before user initialization, stays independent of a mutated mainImage argument, matches pixel centers at two resolutions, and preserves image/Buffer sampling orientation');
    const outputsSource=readFileSync(resolve(import.meta.dirname,'fixtures/outputs.glsl'),'utf8');
    const outputsResult=await call('shader.glsl.translate',{code:outputsSource});
    assert.deepEqual(outputsResult.diagnostics,[]);assert.ok(outputsResult.code);
    await click(el('glsl-button'));await sourceInput(outputsSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'out/inout translation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'out/inout shader applied');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),outputsResult.code);
    const outputsCompiled=await call('shader.compile');assert.equal(outputsCompiled.compiled,true,JSON.stringify(outputsCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`out/inout ${point}: ${JSON.stringify(sampled[point])}`));
    }
    await call('shader.code.set',{pass:'buffer-a',code:outputsResult.code});
    await call('shader.channel.set',{pass:'buffer-a',index:0,channel:{kind:'image',assetId}});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const outputsBufferCompiled=await call('shader.compile');assert.equal(outputsBufferCompiled.compiled,true,JSON.stringify(outputsBufferCompiled));
    await call('shader.playback.step');const outputBufferPixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(outputBufferPixels[point][i]-expected)<=1,`Buffer out/inout ${point}: ${JSON.stringify(outputBufferPixels[point])}`));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    checks.push('out/inout helper parameters translate through API/UI and render correct Image/Buffer pixels: independent copies, aliased roots, early returns, return-expression updates, argument order, single-evaluation indices, vector/matrix components, globals, nested calls, prototypes, overloads, unnamed/shadowed parameters, sampler inputs, short-circuiting and loops');
    const conditionalSource=readFileSync(resolve(import.meta.dirname,'fixtures/conditionals.glsl'),'utf8');
    const conditionalResult=await call('shader.glsl.translate',{code:conditionalSource});
    assert.deepEqual(conditionalResult.diagnostics,[]);assert.ok(conditionalResult.code);
    await click(el('glsl-button'));await sourceInput(conditionalSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'ternary translation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'ternary shader applied');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),conditionalResult.code);
    const conditionalCompiled=await call('shader.compile');assert.equal(conditionalCompiled.compiled,true,JSON.stringify(conditionalCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`ternary ${point}: ${JSON.stringify(sampled[point])}`));
    }
    await call('shader.code.set',{pass:'buffer-a',code:conditionalResult.code});
    await call('shader.channel.set',{pass:'buffer-a',index:0,channel:{kind:'image',assetId}});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const conditionalBufferCompiled=await call('shader.compile');assert.equal(conditionalBufferCompiled.compiled,true,JSON.stringify(conditionalBufferCompiled));
    await call('shader.playback.step');const conditionalBufferPixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(conditionalBufferPixels[point][i]-expected)<=1,`Buffer ternary ${point}: ${JSON.stringify(conditionalBufferPixels[point])}`));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    checks.push('ternary expressions translate through API/UI and render correct Image/Buffer pixels: spatial branches, nested right association, precedence, one condition evaluation, lazy increments/out-inout/discard, vector/matrix/scalar/void results, global constants/initializers, lexical captures, macros, texture parameters, short-circuiting, indices and continuing clauses');
    const switchSource=readFileSync(resolve(import.meta.dirname,'fixtures/switches.glsl'),'utf8');
    const switchResult=await call('shader.glsl.translate',{code:switchSource});
    assert.deepEqual(switchResult.diagnostics,[]);assert.ok(switchResult.code);
    await click(el('glsl-button'));await sourceInput(switchSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'switch translation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'switch shader applied');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),switchResult.code);
    const switchCompiled=await call('shader.compile');assert.equal(switchCompiled.compiled,true,JSON.stringify(switchCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`switch ${point}: ${JSON.stringify(sampled[point])}`));
    }
    await call('shader.code.set',{pass:'buffer-a',code:switchResult.code});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const switchBufferCompiled=await call('shader.compile');assert.equal(switchBufferCompiled.compiled,true,JSON.stringify(switchBufferCompiled));
    await call('shader.playback.step');const switchBufferPixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(switchBufferPixels[point][i]-expected)<=1,`Buffer switch ${point}: ${JSON.stringify(switchBufferPixels[point])}`));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    checks.push('switch translates through API/UI and renders correct Image/Buffer pixels: grouped labels/default, fallthrough, conditional break, default in the middle, single selector evaluation, signed/unsigned constant cases, shared declarations, lexical scope, nested switches/loops, continue/continuing, out/inout returns and mainImage early returns');
    const bitwiseSource=readFileSync(resolve(import.meta.dirname,'fixtures/bitwise.glsl'),'utf8');
    const bitwiseResult=await call('shader.glsl.translate',{code:bitwiseSource});
    assert.deepEqual(bitwiseResult.diagnostics,[]);assert.ok(bitwiseResult.code);
    await click(el('glsl-button'));await sourceInput(bitwiseSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'bitwise translation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'bitwise shader applied');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),bitwiseResult.code);
    const bitwiseCompiled=await call('shader.compile');assert.equal(bitwiseCompiled.compiled,true,JSON.stringify(bitwiseCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`bitwise ${point}: ${JSON.stringify(sampled[point])}`));
    }
    await call('shader.code.set',{pass:'buffer-a',code:bitwiseResult.code});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const bitwiseBufferCompiled=await call('shader.compile');assert.equal(bitwiseBufferCompiled.compiled,true,JSON.stringify(bitwiseBufferCompiled));
    await call('shader.playback.step');const bitwiseBufferPixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(bitwiseBufferPixels[point][i]-expected)<=1,`Buffer bitwise ${point}: ${JSON.stringify(bitwiseBufferPixels[point])}`));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    checks.push('integer shift/bitwise operators translate through API/UI and render correct Image/Buffer pixels: original packed vec2 expression at 16 shift counts, signed/unsigned right shifts, GLSL precedence, scalar/vector operands, 32-bit constants/case labels, compound writes, indexed/swizzled targets, single evaluation, lazy branches, loops and integer-to-float constructor components');
    const predicateSource=readFileSync(resolve(import.meta.dirname,'fixtures/predicates.glsl'),'utf8');
    const predicateResult=await call('shader.glsl.translate',{code:predicateSource});
    assert.deepEqual(predicateResult.diagnostics,[]);assert.ok(predicateResult.code);
    await click(el('glsl-button'));await sourceInput(predicateSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'isnan translation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'isnan shader applied');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),predicateResult.code);
    const predicateCompiled=await call('shader.compile');assert.equal(predicateCompiled.compiled,true,JSON.stringify(predicateCompiled));
    await call('shader.playback.step');const finitePixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(finitePixels[point][i]-expected)<=1,`finite predicate ${point}: ${JSON.stringify(finitePixels[point])}`));
    // Feed known runtime float encodings to the translated classification helper.
    // Do not depend on undefined GLSL/WGSL arithmetic such as 0.0 / 0.0 to
    // manufacture NaNs, or on constant-expression nonfinite bitcasts.
    const specialPredicates=predicateResult.code.replace('fn mainImage(', 'fn hy_predicate_finite_main(')+`
fn mainImage(p: vec2f) -> vec4f {
  let finite = hy_predicate_finite_main(p);
  var nan_bits = 0x7fc00001u;
  if (p.x < iResolution.x * 0.5) { nan_bits = 0xffa00001u; }
  var positive_inf_bits = 0x7f800000u;
  var negative_inf_bits = 0xff800000u;
  let good = hy_fn_checkSpecial_3_f32_f32_f32(bitcast<f32>(nan_bits), bitcast<f32>(positive_inf_bits), bitcast<f32>(negative_inf_bits));
  if (good) { return finite; }
  return vec4f(1.0, 0.0, 0.0, 1.0);
}`;
    await call('shader.code.set',{pass:'image',code:specialPredicates});
    const specialCompiled=await call('shader.compile');assert.equal(specialCompiled.compiled,true,JSON.stringify(specialCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`NaN/Inf predicate ${point}: ${JSON.stringify(sampled[point])}`));
    }
    await call('shader.code.set',{pass:'buffer-a',code:specialPredicates});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const predicateBufferCompiled=await call('shader.compile');assert.equal(predicateBufferCompiled.compiled,true,JSON.stringify(predicateBufferCompiled));
    await call('shader.playback.step');const predicateBufferPixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(predicateBufferPixels[point][i]-expected)<=1,`Buffer predicate ${point}: ${JSON.stringify(predicateBufferPixels[point])}`));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    checks.push('isnan/isinf translate through API/UI and render correct Image/Buffer pixels: finite extremes, signed zeros, runtime positive/negative NaN encodings and infinities, scalar/vector results, bvec construction/casts, any/all/not, swizzles, indices, overloads, inout, ternaries, constants/globals and single evaluation with short-circuiting');
    const preprocessingSource=readFileSync(resolve(import.meta.dirname,'fixtures/preprocessor-conditions.glsl'),'utf8');
    const preprocessingResult=await call('shader.glsl.translate',{code:preprocessingSource});
    assert.deepEqual(preprocessingResult.diagnostics,[]);assert.ok(preprocessingResult.code);
    await click(el('glsl-button'));
    await sourceInput('#if 1\nvoid mainImage(out vec4 c,in vec2 p){c=vec4(1.0);}');await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),true,'unclosed conditional cannot be applied');
    assert.match(await evaluate(`${el('glsl-messages')}.textContent`),/缺少 #endif/);
    await sourceInput(preprocessingSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(`${el('apply-glsl')}.disabled`),false,'conditional compilation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate(`!${el('compile')}.disabled && !${el('glsl-dialog')}.open`),'conditional shader applied');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),preprocessingResult.code);
    for(const [mode,red] of [[2,64],[1,128],[0,191]]){
      const result=await call('shader.glsl.translate',{code:preprocessingSource.replace('#define MODE 2',`#define MODE ${mode}`)});
      assert.deepEqual(result.diagnostics,[]);await call('shader.code.set',{pass:'image',code:result.code});
      const compiled=await call('shader.compile');assert.equal(compiled.compiled,true,JSON.stringify(compiled));
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [red,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,`#if mode ${mode} ${point}: ${JSON.stringify(sampled[point])}`));
    }
    await call('shader.code.set',{pass:'buffer-a',code:preprocessingResult.code});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const preprocessingBufferCompiled=await call('shader.compile');assert.equal(preprocessingBufferCompiled.compiled,true,JSON.stringify(preprocessingBufferCompiled));
    await call('shader.playback.step');const preprocessingBufferPixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(preprocessingBufferPixels[point][i]-expected)<=1,`Buffer #if ${point}: ${JSON.stringify(preprocessingBufferPixels[point])}`));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    checks.push('conditional compilation works through API/UI with Image/Buffer pixels for if/elif/else variants: nested groups, ifdef/ifndef, defined, macro arithmetic/bitwise expressions, short circuits, GLSL ES import predefines, active define/undef, ignored unsupported code/directives and unclosed-branch diagnostics');
    const structSource=readFileSync(resolve(import.meta.dirname,'fixtures/structs.glsl'),'utf8');
    const structResult=await call('shader.glsl.translate',{code:structSource});
    assert.deepEqual(structResult.diagnostics,[]);assert.ok(structResult.code);
    await click(el('glsl-button'));await sourceInput(structSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(el('apply-glsl')+'.disabled'),false,'struct translation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate('!'+el('compile')+'.disabled && !'+el('glsl-dialog')+'.open'),'struct shader applied');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),structResult.code);
    const structCompiled=await call('shader.compile');assert.equal(structCompiled.compiled,true,JSON.stringify(structCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,'struct '+point+': '+JSON.stringify(sampled[point])));
    }
    await call('shader.code.set',{pass:'buffer-a',code:structResult.code});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const structBufferCompiled=await call('shader.compile');assert.equal(structBufferCompiled.compiled,true,JSON.stringify(structBufferCompiled));
    await call('shader.playback.step');const structPixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(structPixels[point][i]-expected)<=1,'Buffer struct '+point+': '+JSON.stringify(structPixels[point])));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    checks.push('structures and WGSL reserved identifiers translate through API/UI and render correct Image/Buffer pixels: nested scalar/vector/matrix fields, constructors, copies, globals/constants, overloads, returns, out/inout alias roots, swizzles/index evaluation, distinct member update helpers, equality, lazy and constant ternaries, local type scopes, loops/switch and ref/let/var/override renaming');
    const commaSource=readFileSync(resolve(import.meta.dirname,'fixtures/comma-statements.glsl'),'utf8');
    const commaResult=await call('shader.glsl.translate',{code:commaSource});
    assert.deepEqual(commaResult.diagnostics,[]);assert.ok(commaResult.code);
    await click(el('glsl-button'));await sourceInput(commaSource);await click(el('translate-glsl'));
    assert.equal(await evaluate(el('apply-glsl')+'.disabled'),false,'comma statement translation enables Apply');
    await click(el('apply-glsl'));
    await waitFor(()=>evaluate('!'+el('compile')+'.disabled && !'+el('glsl-dialog')+'.open'),'comma shader applied');
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),commaResult.code);
    const commaCompiled=await call('shader.compile');assert.equal(commaCompiled.compiled,true,JSON.stringify(commaCompiled));
    for(let frame=0;frame<2;frame++){
      await call('shader.playback.step');const sampled=await pixels();
      for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(sampled[point][i]-expected)<=1,'comma '+point+': '+JSON.stringify(sampled[point])));
    }
    await call('shader.code.set',{pass:'buffer-a',code:commaResult.code});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
    await call('shader.code.set',{pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return channel0(p / iResolution.xy); }'});
    const commaBufferCompiled=await call('shader.compile');assert.equal(commaBufferCompiled.compiled,true,JSON.stringify(commaBufferCompiled));
    await call('shader.playback.step');const commaPixels=await pixels();
    for(const point of ['center','topLeft','bottomLeft']) [64,128,191,255].forEach((expected,i)=>assert.ok(Math.abs(commaPixels[point][i]-expected)<=1,'Buffer comma '+point+': '+JSON.stringify(commaPixels[point])));
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false});
    await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'image',assetId}});
    checks.push('comma statements translate through API/UI and render correct Image/Buffer pixels: original unbraced if with true/false paths, else/dangling else, macro sequences, left-to-right calls/assignments/updates, swizzle/matrix/struct writes, nested argument commas, for initialization/updates with continue, while and switch bodies');
    const translated = await call('shader.glsl.translate',{code:'void mainImage(out vec4 fragColor,in vec2 fragCoord){ vec2 uv=fragCoord/iResolution.xy; vec3 col=0.5+0.5*cos(iTime+uv.xyx+vec3(0,2,4)); fragColor=vec4(col,1.0); }'});
    assert.ok(translated.code);await call('shader.code.set',{pass:'image',code:translated.code});
    const compiled=await call('shader.compile');assert.equal(compiled.compiled,true,JSON.stringify(compiled));await call('shader.playback.step');
    checks.push('Shadertoy GLSL translated and compiled as WGSL on real GPU');
    assert.deepEqual(await savedProjects(),[],'editing, uploads and repeated compilation do not save a draft');
    await click(el('save-project'));await waitFor(()=>evaluate('document.getElementById("save-state").textContent.includes("已保存")'),'saved');
    await click(el('export-project'));const exported=await waitFor(()=>readdirSync(downloads).find(f=>f.endsWith('.hyshader')),'project downloaded');
    const project=JSON.parse(readFileSync(resolve(downloads,exported),'utf8'));assert.equal(project.assets.length,1);assert.equal(project.passes[4].code,translated.code);
    await click(el('back-gallery'));await waitFor(()=>evaluate('document.querySelectorAll("#saved-projects .shader-card").length === 1'),'saved Gallery card');
    const firstSaved=await savedProjects();
    assert.equal(firstSaved.length,1);assert.equal(firstSaved[0].project.passes[4].code,translated.code);
    assert.match(firstSaved[0].thumbnail,/^data:image\/png;base64,/,'explicit save captures a thumbnail');
    assert.deepEqual(await evaluate(`(()=>{const button=document.querySelector('#saved-projects .card-delete');return {icon:!!button.querySelector('svg'),text:button.textContent,label:button.getAttribute('aria-label'),title:button.title};})()`),
      {icon:true,text:'',label:`删除 ${project.name}`,title:`删除 ${project.name}`});
    await evaluate('document.querySelector("#saved-projects .shader-card").scrollIntoView({block:"center"})');
    await shot('manual-save-gallery.png');
    const origin = await evaluate('performance.timeOrigin');await cdp.call('Page.reload');
    await waitFor(()=>evaluate(`performance.timeOrigin !== ${origin} && document.getElementById('app')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('#saved-projects .shader-card').length===1`),'Gallery persists across reload');
    await evaluate('document.querySelector("#saved-projects .card-open").scrollIntoView({block:"center"})');
    await click('document.querySelector("#saved-projects .card-open")');await waitFor(()=>evaluate('shaderEditor.getStatus()?.ready'),'saved project restored');
    assert.equal(await evaluate('shaderEditor.getProject().assets.length'),1);assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),translated.code);
    assert.equal(await splitRatio('workspace-split'),storedRatio);
    assert.equal(await evaluate(`${el('save-state')}.textContent`),'已保存到此浏览器');
    const editedCode=translated.code+'\n// save only on explicit request';
    await call('shader.code.set',{pass:'image',code:editedCode});
    assert.equal((await call('shader.compile')).compiled,true);await call('shader.playback.step');
    await click(el('back-gallery'));
    assert.deepEqual(await savedProjects(),firstSaved,'edits and returning home do not overwrite a saved project');
    await click(el('nav-editor'));
    assert.equal(await evaluate('shaderEditor.getProject().passes[4].code'),editedCode);
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'s',code:'KeyS',modifiers:2,windowsVirtualKeyCode:83});
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'s',code:'KeyS',modifiers:2,windowsVirtualKeyCode:83});
    await waitFor(()=>evaluate(`${el('save-state')}.textContent==='已保存到此浏览器'`),'keyboard save');
    const resaved=await savedProjects();assert.equal(resaved.length,1);assert.equal(resaved[0].project.passes[4].code,editedCode);
    await call('shader.code.set',{pass:'image',code:translated.code});
    await click(el('save-project'));await waitFor(()=>evaluate(`${el('save-state')}.textContent==='已保存到此浏览器'`),'button updates saved project');
    assert.equal((await savedProjects()).length,1,'repeated saves update one card');
    checks.push('explicit Save captures project and preview; export includes image bytes; reload and reopen restore saved content; subsequent edits remain drafts until button or Ctrl+S saves without duplicates');
    await shot('final.png');
    // Reproduce a cold load on #editor, then return to Gallery. Hold the first
    // thumbnail pipeline to test navigation overlap, then fail it once to verify
    // the other examples still render and a retry fills only the missing image.
    const editorOrigin = await evaluate('performance.timeOrigin'); await cdp.call('Page.reload');
    await waitFor(()=>evaluate(`performance.timeOrigin !== ${editorOrigin} && location.hash==='#editor' && shaderEditor.getStatus()?.frame>0 && !document.getElementById('compile').disabled`),'direct editor reload ready');
    assert.equal(await evaluate('document.querySelectorAll("#examples .card-art img").length'),0);
    assert.equal(await evaluate('document.querySelectorAll(".thumb-render").length'),0,'editor startup does not allocate a Gallery renderer');
    await evaluate(`(()=>{
      const original=GPUDevice.prototype.createRenderPipelineAsync;
      const state=window.__thumbnailTest={calls:0,release:null};
      GPUDevice.prototype.createRenderPipelineAsync=function(descriptor){
        if(descriptor.label==='ShaderEditor.image'){
          state.calls++;
          if(state.calls===1) return new Promise((resolve,reject)=>{state.release=()=>reject(new Error('Expected thumbnail pipeline failure'));});
        }
        return original.call(this,descriptor);
      };
      state.restore=()=>{GPUDevice.prototype.createRenderPipelineAsync=original;};
    })()`);
    await click(el('back-gallery'));
    await waitFor(()=>evaluate('typeof window.__thumbnailTest.release === "function"'),'Gallery starts rendering after editor reload');
    assert.equal(await evaluate('document.getElementById("examples").getAttribute("aria-busy")'),'true');
    assert.equal(await evaluate('document.querySelectorAll("#examples .thumbnail-placeholder").length'),5);
    assert.ok(await evaluate('Array.from(document.querySelectorAll("#examples .card-art, #hero-example")).every(art=>getComputedStyle(art).backgroundImage==="none")'),'placeholders cannot masquerade as shader screenshots');
    await click(el('nav-editor')); await click(el('nav-gallery'));
    assert.equal(await evaluate('document.querySelectorAll(".thumb-render").length'),1,'route changes share one in-flight thumbnail batch');
    assert.equal(await evaluate('window.__thumbnailTest.calls'),1);
    await shot('gallery-loading.png');
    await evaluate('window.__thumbnailTest.release()');
    await waitFor(()=>evaluate('document.querySelectorAll("#examples .card-art img").length===4 && !document.getElementById("retry-example-previews").hidden'),'one failure leaves four usable previews and a retry');
    const partialPreviews=await examplePreviews();
    assert.deepEqual(partialPreviews,originalPreviews.slice(1));
    assert.match(await evaluate('document.querySelector("#examples .thumbnail-placeholder").textContent'),/预览暂不可用/);
    assert.equal(await evaluate('document.getElementById("hero-thumbnail").hidden'),true);
    await shot('gallery-preview-failure.png');
    await evaluate('document.getElementById("retry-example-previews").scrollIntoView({block:"center"})');
    await click(el('retry-example-previews'));
    await waitFor(()=>evaluate('document.querySelectorAll("#examples .card-art img").length===5 && document.getElementById("examples").getAttribute("aria-busy")==="false"'),'retry renders missing preview');
    assert.deepEqual(await examplePreviews(),originalPreviews,'reloaded/retried previews match their original rendered examples');
    assert.equal(await evaluate('window.__thumbnailTest.calls'),6,'only the failed preview is regenerated');
    assert.equal(await evaluate('document.querySelectorAll(".thumb-render").length'),0,'thumbnail renderer is released');
    assert.equal(await evaluate('document.getElementById("hero-thumbnail").src'),originalPreviews[0].src);
    assert.equal(await evaluate('document.getElementById("hero-preview-state").hidden'),true);
    await evaluate('window.__thumbnailTest.restore(); delete window.__thumbnailTest');
    await shot('gallery-after-editor-reload.png');
    checks.push('cold #editor load then Gallery produces the correct five thumbnails; overlapping navigation shares one job; per-example failure is isolated, placeholders are explicit and retry reuses successful previews');
    await evaluate('document.querySelector("#saved-projects .card-delete").scrollIntoView({block:"center"})');
    let acceptDelete=false,deleteDialogs=0;
    const stopDialogs=cdp.on('Page.javascriptDialogOpening',()=>{deleteDialogs++;void cdp.call('Page.handleJavaScriptDialog',{accept:acceptDelete});});
    try {
      await click('document.querySelector("#saved-projects .card-delete")');
      assert.equal((await savedProjects()).length,1,'cancel keeps the saved project');
      acceptDelete=true;
      await click('document.querySelector("#saved-projects .card-delete")');
      await waitFor(()=>evaluate('document.querySelectorAll("#saved-projects .shader-card").length===0'),'trash button deletes project');
      assert.equal(deleteDialogs,2);
    } finally { stopDialogs(); }
    assert.deepEqual(await savedProjects(),[]);
    await evaluate('document.getElementById("nav-editor").scrollIntoView({block:"center"})');
    await click(el('nav-editor'));
    await waitFor(()=>evaluate('location.hash==="#editor" && !document.getElementById("compile").disabled && shaderEditor.getStatus()?.frame>0'),'new draft after deleting current project');
    assert.notEqual(await evaluate('shaderEditor.getProject().id'),project.id);
    await click(el('back-gallery'));
    assert.deepEqual(await savedProjects(),[],'opening a new draft does not recreate a deleted project');
    checks.push('trash icon has tooltip and accessible name; cancel keeps the project, confirm deletes it, and navigation cannot recreate it');
    driver.assertNoBrowserErrors();
    return {schemaVersion:1,status:'passed',generatedAt:new Date().toISOString(),checks,browser:await evaluate('navigator.userAgent'),adapter:await evaluate('(async()=>{const a=await navigator.gpu.requestAdapter();const i=a.info;return {vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,isFallbackAdapter:i.isFallbackAdapter};})()'),
      revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),buildHash:JSON.parse(readFileSync(resolve(root,'shaderEditor/app-dist/app-manifest.json'))).buildHash,
      fixtureHash:createHash('sha256').update(readFileSync(fixture)).digest('hex')};
  }
});
writeFileSync(resolve(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
