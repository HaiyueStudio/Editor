import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)), output = resolve(root, 'imageEditor/artifacts/p2');
const downloads = resolve(output, `downloads-${Date.now()}`); mkdirSync(downloads, { recursive: true });
const fixtureManifest = JSON.parse(readFileSync(resolve(root,'imageEditor/test/fixtures/p1/manifest.json')));
for (const [file, metadata] of Object.entries(fixtureManifest.files)) {
  const bytes = readFileSync(resolve(root,'imageEditor/test/fixtures/p1',file));
  assert.equal(bytes.length,metadata.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
}
const sourceFiles = [...readdirSync(resolve(root, 'imageEditor/src')).map(file => `imageEditor/src/${file}`),
  ...['index.html','styles.css','package.json','rollup.config.js','tsconfig.json','tsconfig.web.json','app/descriptor.json','test/p2-browser-smoke.mjs','test/pixelTools.test.mjs'].map(file => `imageEditor/${file}`),
  'package-lock.json','scripts/editor-e2e/browserDriver.mjs'].sort();
const report = await runEditorBrowserScenario({ root, route: 'imageEditor/app-dist/index.html', downloadDirectory: downloads,
  failureScreenshotPath: resolve(output, 'failure.png'), timeoutMs: 30000,
  readinessExpression: 'document.querySelector("#app")?.getAttribute("aria-busy") === "false"',
  scenario: async driver => {
    const { evaluate, click, replaceText, nextPaint, cdp, waitFor, setFileInputFiles } = driver, checks = [];
    const e = selector => `document.querySelector(${JSON.stringify(selector)})`;
    const act = action => click(e(`[data-action="${action}"]`));
    const tool = name => click(e(`[data-tool="${name}"]`));
    const pixel = (x,y) => evaluate(`Array.from(document.querySelector('#image-canvas').getContext('2d').getImageData(${x},${y},1,1).data)`);
    const width = () => evaluate('document.querySelector("#image-canvas").width');
    const rows = () => evaluate('document.querySelectorAll(".layer-row").length');
    const color = async value => { await evaluate(`document.querySelector('#paint-color').value=${JSON.stringify(value)}`); };
    const key = async key => { await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key}); await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key}); await nextPaint(); };
    const coords = async (x,y) => {
      const rect = JSON.parse(await evaluate('JSON.stringify(document.querySelector("#image-canvas").getBoundingClientRect())'));
      const scale = rect.width / await width(); return {x:rect.x+x*scale,y:rect.y+y*scale};
    };
    const pointer = async (type,x,y) => cdp.call('Input.dispatchMouseEvent', {type,...await coords(x,y),button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
    const drag = async (x1,y1,x2,y2,finish=true) => { await pointer('mousePressed',x1,y1); await pointer('mouseMoved',x2,y2); if(finish) await pointer('mouseReleased',x2,y2); await nextPaint(); };
    const screenshot = async name => { await nextPaint(); const shot = await cdp.call('Page.captureScreenshot',{format:'png'}); writeFileSync(resolve(output,name),Buffer.from(shot.result.data,'base64')); };
    await click(e('.header-actions [data-action=new]')); await replaceText(e('#new-name'),'P2 绘图验证'); await replaceText(e('#new-width'),'96'); await replaceText(e('#new-height'),'64'); await click(e('#new-form button[type=submit]')); await nextPaint(); await act('actual');
    await tool('brush'); await replaceText(e('#brush-size'),'8'); await color('#e04020');
    await drag(8.5,20.5,70.5,20.5); assert.deepEqual(await pixel(30,20),[224,64,32,255]);
    await act('undo'); await nextPaint(); assert.equal((await pixel(30,20))[3],0);
    await act('redo'); await nextPaint(); assert.deepEqual(await pixel(30,20),[224,64,32,255]); checks.push('continuous brush stroke is one undo/redo step with exact rendered pixels');
    await drag(10.5,40.5,70.5,40.5,false); assert.equal((await pixel(30,40))[3],255); await key('Escape'); await pointer('mouseReleased',70.5,40.5); assert.equal((await pixel(30,40))[3],0); checks.push('Escape cancels live brush preview without committing pixels');
    await tool('select'); await drag(16,16,40,32); assert.equal(await evaluate('document.querySelector("#selection-outline").style.width'),'24px');
    await color('#2060e0'); await act('fill'); await nextPaint(); assert.deepEqual(await pixel(24,24),[32,96,224,255]); assert.deepEqual(await pixel(8,20),[224,64,32,255]);
    await act('clear'); await nextPaint(); assert.equal((await pixel(24,24))[3],0); await act('undo'); await nextPaint(); assert.deepEqual(await pixel(24,24),[32,96,224,255]);
    await tool('brush'); await drag(8.5,10.5,70.5,10.5); assert.equal((await pixel(30,10))[3],0); checks.push('rectangular selection bounds fill, clear and brush; clear is undoable');
    await tool('eraser'); await replaceText(e('#paint-opacity'),'50'); await drag(24.5,24.5,24.5,24.5); assert.equal((await pixel(24,24))[3],128); await act('undo'); await nextPaint(); assert.equal((await pixel(24,24))[3],255);
    await click(e('.layer-row.selected .layer-lock')); await drag(24.5,24.5,24.5,24.5); assert.equal((await pixel(24,24))[3],255); assert(await evaluate('document.querySelector("#notice-text").textContent.includes("锁定")')); await click(e('.layer-row.selected .layer-lock')); checks.push('eraser respects opacity; locked layers reject pixel editing');
    await tool('select'); await act('deselect'); await tool('move'); await drag(30,20,35,26); assert.equal(await evaluate('document.querySelector("#layer-x").value'),'5'); assert.equal(await evaluate('document.querySelector("#layer-y").value'),'6'); assert.deepEqual(await pixel(29,30),[32,96,224,255]);
    await act('undo'); await nextPaint(); assert.equal(await evaluate('document.querySelector("#layer-x").value'),'0');
    await act('transform'); await replaceText(e('#transform-width'),'48'); await replaceText(e('#transform-height'),'32'); await replaceText(e('#transform-angle'),'90'); await click(e('#transform-form button[type=submit]')); await nextPaint(); assert.equal(await evaluate('document.querySelector("#layer-size").textContent'),'32 × 48 px');
    await act('undo'); await nextPaint(); assert.equal(await evaluate('document.querySelector("#layer-size").textContent'),'96 × 64 px');
    await act('transform'); await replaceText(e('#transform-width'),'8192'); await replaceText(e('#transform-height'),'8192'); await click(e('#transform-form button[type=submit]')); assert(await evaluate('document.querySelector("#transform-error").textContent.includes("尺寸")')); await click(e('#transform-dialog [data-close-dialog]')); checks.push('move and transform commit atomically; undo restores dimensions; oversize transform rejects');
    await tool('crop'); await drag(16,8,80,56); await act('crop'); await nextPaint(); assert.equal(await width(),64); assert.deepEqual(await pixel(8,16),[32,96,224,255]); await act('undo'); await nextPaint(); assert.equal(await width(),96); assert.equal(await evaluate('document.querySelector("#selection-outline").hidden'),false); await act('deselect'); checks.push('crop shifts rendered contents and dimensions; undo restores pixels and selection');
    await act('add-group');await setFileInputFiles('#import-input',[resolve(root,'imageEditor/test/fixtures/p1/import.png')]);await waitFor(()=>rows().then(n=>n===3),'group import');
    await click(`Array.from(document.querySelectorAll('.layer-row')).find(row=>row.textContent.includes('新图层组'))`);await tool('move');await drag(30,40,90,40);
    await setFileInputFiles('#import-input',[resolve(root,'imageEditor/test/fixtures/p1/import.png')]);await waitFor(()=>rows().then(n=>n===4),'translated group import');assert.deepEqual(await pixel(46,30),[240,50,30,255]);
    for(let i=0;i<4;i++){await act('undo');await nextPaint();}assert.equal(await rows(),1);checks.push('translated groups composite negative child coordinates; image import stays canvas-centered');
    await act('export'); await click(e('#export-form button[type=submit]'));
    const png = await waitFor(()=>readdirSync(downloads).find(f=>f.endsWith('.png')),'PNG download');
    const pngBytes=readFileSync(resolve(downloads,png)); assert.equal(pngBytes.readUInt32BE(16),96);assert.equal(pngBytes.readUInt32BE(20),64);
    await setFileInputFiles('#open-input',[resolve(downloads,png)]); await waitFor(()=>evaluate('document.querySelectorAll(".document-tab").length===2'),'PNG reopened');assert.equal((await pixel(0,0))[3],0);assert.deepEqual(await pixel(24,24),[32,96,224,255]);
    await act('export'); await evaluate('document.querySelector("#export-format").value="jpeg"'); await click(e('#export-form button[type=submit]'));
    const jpg=await waitFor(()=>readdirSync(downloads).find(f=>f.endsWith('.jpg')),'JPEG download');await setFileInputFiles('#open-input',[resolve(downloads,jpg)]);await waitFor(()=>evaluate('document.querySelectorAll(".document-tab").length===3'),'JPEG reopened');const white=await pixel(0,0);assert(white.slice(0,3).every(c=>c>245));assert.equal(white[3],255);checks.push('PNG export/reimport retains transparent pixels; JPEG export flattens onto white');
    await click(e('.document-tab:first-child [role=tab]'));await act('text');await replaceText(e('#text-content'),'海月\nP2');await replaceText(e('#text-size'),'16');await click(e('#text-form button[type=submit]'));await nextPaint();assert.equal(await rows(),2);assert(await evaluate('document.querySelector("#layer-name").value.includes("文字")'));
    assert(await evaluate('Array.from(document.querySelector(".layer-row.selected canvas").getContext("2d").getImageData(0,0,62,62).data).some((v,i)=>i%4===3&&v>0)'));await act('undo');await nextPaint();assert.equal(await rows(),1);await act('redo');await nextPaint();assert.equal(await rows(),2);checks.push('multiline raster text creates a real independent layer; undo/redo restores it');
    await tool('select');await act('select-all');await act('save');const project=await waitFor(()=>readdirSync(downloads).find(f=>f.endsWith('.hyimage')),'project download');const data=JSON.parse(readFileSync(resolve(downloads,project)));assert.equal(data.document.layers.length,2);assert.equal(data.document.selection.width,96);
    await waitFor(()=>evaluate('document.querySelector("#recovery-status").textContent.includes("已存")'),'recovery committed');
    const stop=cdp.on('Page.javascriptDialogOpening',()=>{void cdp.call('Page.handleJavaScriptDialog',{accept:true});});const origin=await evaluate('performance.timeOrigin');await cdp.call('Page.reload');await waitFor(()=>evaluate(`performance.timeOrigin!==${origin}&&document.querySelector('#app')?.getAttribute('aria-busy')==='false'&&document.querySelectorAll('.document-tab').length===3`),'P2 session restored');
    assert.equal(await rows(),2);assert.equal(await evaluate('document.querySelector("#selection-outline").style.width'),'96px');assert.deepEqual(await pixel(8,20),[224,64,32,255]);stop();checks.push('edited RGBA, raster text and selection survive project save and session reload');
    // Keep the original workflow verified before preparing a separate visual-review demo.
    await click(e('.header-actions [data-action=new]'));await click(e('#new-dialog [data-close-dialog]'));
    await setFileInputFiles('#open-input',[resolve(root,'imageEditor/test/fixtures/p1/import.png')]);await waitFor(()=>evaluate('document.querySelectorAll(".document-tab").length===4'),'import still works');await click(e('.document-tab:first-child [role=tab]'));await tool('brush');await act('fit');await click(e('#dismiss-notice'));await screenshot('editing.png');
    while (await evaluate('document.querySelectorAll(".document-tab").length')) {
      await click(e('.document-tab:first-child .tab-close'));
      if (await evaluate('document.querySelector("#close-dialog").open')) await click(e('#close-discard'));
      await nextPaint();
    }
    await act('demo');await nextPaint();await tool('brush');await screenshot('tools.png');
    driver.assertNoBrowserErrors();
    return {schemaVersion:1,status:'passed',generatedAt:new Date().toISOString(),checks,browser:await evaluate('navigator.userAgent'),runner:{platform:process.platform,arch:process.arch,chrome:driver.chrome},
      revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),
      sourceFingerprints:Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')])),
      buildHash:JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash,
      workload:{canvas:[96,64],brushDiameter:8,selection:[16,16,24,16],exportFormats:['png','jpeg'],input:'synthetic UI-authored RGBA; local P1 PNG fixture'},
      fixture:fixtureManifest};
  }
});
writeFileSync(resolve(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,output},null,2));
