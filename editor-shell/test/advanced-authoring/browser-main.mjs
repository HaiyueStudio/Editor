import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

let window;
console.log('advanced-browser: main entered');
const checks = [];
const output = process.env.HAIYUE_ADVANCED_TEST_OUTPUT
  ? pathToFileURL(path.resolve(process.env.HAIYUE_ADVANCED_TEST_OUTPUT) + path.sep)
  : new URL('./test-output/', import.meta.url);
app.setPath('userData', fileURLToPath(new URL('user-data/',output)));
const evaluate = code => window.webContents.executeJavaScript(code, true);
const state = () => evaluate('advancedTest.state()');
const settle = async () => { await evaluate('advancedTest.pause()'); await evaluate('advancedTest.pause()'); };
async function check(name, work) { console.log(`checking: ${name}`); await work(); checks.push(name); }
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); }
async function drag(delta, finish = true) {
  const point = await evaluate(`(()=>{const r=document.querySelector('[data-axis="x"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
  await settle();
  window.webContents.sendInputEvent({type:'mouseMove',x:point.x+delta,y:point.y,button:'left'}); await settle();
  if (finish) { window.webContents.sendInputEvent({type:'mouseUp',x:point.x+delta,y:point.y,button:'left',clickCount:1}); await settle(); }
  return point;
}
async function run() { try {
  await app.whenReady();
  console.log('advanced-browser: ready');
  window = new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'})); window.webContents.on('will-navigate',event=>event.preventDefault());
  const errors = []; window.webContents.on('console-message', event => { console.log(`renderer: ${event.message}`); if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('render-process-gone',(_event,details)=>console.error('renderer gone',details));
  await window.loadFile(fileURLToPath(new URL('browser.html',output)));
  console.log('advanced-browser: loaded');
  window.showInactive();
  for (let i=0;i<100 && !await evaluate('Boolean(window.advancedReady)');i++) await new Promise(r=>setTimeout(r,20));
  assert.equal(await evaluate('window.advancedReady'),true);
  await check('1000-row hierarchy is paged and reveal reaches final entity',async()=>{
    assert.equal(await evaluate('document.querySelectorAll("[data-entity]").length'),50);
    assert.equal(await evaluate('advancedTest.reveal("entity:999")'),true);
    assert.equal(await evaluate('document.activeElement.dataset.entity'),'entity:999');
    await click('[data-entity="entity:999"]'); assert.equal((await state()).view.selection.active.id,'entity:999');
    await evaluate('advancedTest.reset(3)');
  });
  await check('native pointer preview makes one shared History entry, then Undo/Redo',async()=>{
    await drag(20); const s=await state(); assert.ok(s.previews.some(value=>value!==null)); assert.equal(s.view.history.entries.length,1); assert.equal(s.view.gizmo.transforms[0].value.position[0],2);
    await click('[data-advanced="undo"]'); assert.equal((await state()).view.gizmo.transforms[0].value.position[0],0);
    await click('[data-advanced="redo"]'); assert.equal((await state()).view.gizmo.transforms[0].value.position[0],2);
  });
  await check('native keyboard transform shares History',async()=>{
    await evaluate('document.querySelector("[data-axis=x]").focus()');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'}); await settle();
    assert.equal((await state()).view.history.entries.length,2);
  });
  await check('selection and project changes cancel an in-flight drag',async()=>{
    const before=(await state()).view.history.entries.length; const point=await drag(20,false);
    await evaluate('advancedTest.select("entity:1")');
    window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1}); await settle();
    assert.equal((await state()).view.history.entries.length,before);
    const other=await drag(20,false); await evaluate('advancedTest.changeEpoch()');
    window.webContents.sendInputEvent({type:'mouseUp',...other,button:'left',clickCount:1}); await settle();
    assert.equal((await state()).view.history.entries.length,before);
  });
  await check('invalid inspector edit stays local; runtime is read-only; fields remain reachable',async()=>{
    assert.equal(await evaluate('document.querySelector("[data-advanced=runtime-refresh]").textContent'),'Refresh runtime');
    await click('[data-advanced=runtime-refresh]'); assert.equal((await state()).intents.at(-1).type,'runtime.inspect');
    const before=(await state()).intents.length;
    await evaluate(`(()=>{const form=document.querySelector('form[data-field="/speed"]');form.querySelector('input').value='-2';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`); await settle(); assert.equal((await state()).intents.length,before);
    await evaluate('advancedTest.dense()'); assert.equal(await evaluate('document.querySelectorAll("form[data-field]").length'),50);
    await click('[data-field-page][data-step="50"]'); assert.equal(await evaluate('document.querySelector("form[data-field]").dataset.field'),'field:50');
    await evaluate('advancedTest.historical()'); assert.match(await evaluate('document.querySelector("[data-advanced=runtime-state]").textContent'),/historical/); assert.equal(await evaluate('document.querySelector("[data-advanced=runtime]").querySelectorAll("input,button,textarea").length'),0);
  });
  await check('cancel suppresses late commit and allows retry',async()=>{
    await evaluate('advancedTest.hold()'); const before=(await state()).view.history.entries.length;
    await drag(20); assert.equal((await state()).busy,'true'); await click('[data-advanced=cancel]'); await evaluate('advancedTest.release()'); await settle();
    assert.equal((await state()).view.history.entries.length,before); assert.equal((await state()).busy,'false');
    await drag(10); assert.equal((await state()).view.history.entries.length,before+1,JSON.stringify(await state()));
  });
  await check('Chromium accessibility and narrow layout',async()=>{
    window.webContents.debugger.attach('1.3'); await window.webContents.debugger.sendCommand('Accessibility.enable'); const tree=await window.webContents.debugger.sendCommand('Accessibility.getFullAXTree'); assert.ok(tree.nodes.some(node=>node.role?.value==='tree')); assert.ok(tree.nodes.some(node=>node.name?.value==='Transform X axis')); window.webContents.debugger.detach();
    writeFileSync(new URL('desktop.png',output),(await window.webContents.capturePage()).toPNG());
    window.setSize(375,900); await settle(); assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
    writeFileSync(new URL('narrow.png',output),(await window.webContents.capturePage()).toPNG());
  });
  await check('aborted lazy import, repeated mount/unmount and failing viewport cleanup',async()=>{
    assert.equal(await evaluate('advancedTest.lazyAbort()'),true);
    for(let i=0;i<10;i++){await evaluate('advancedTest.dispose(); advancedTest.dispose()');assert.equal((await state()).roots,0);assert.equal((await state()).overlays,0);assert.equal((await state()).position,'');await evaluate('advancedTest.reset(1)');}
    assert.equal(await evaluate('advancedTest.faultCleanup()'),true);
  });
  assert.deepEqual(errors,[]);
  writeFileSync(new URL('browser.json',output),JSON.stringify({schemaVersion:1,status:'passed',checks,electron:process.versions.electron,chromium:process.versions.chrome,security:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}},null,2));
  console.log(JSON.stringify({status:'passed',checks}));
  window.destroy(); app.exit(0);
} catch(error) { console.error(error); if(window&&!window.isDestroyed()) { try { writeFileSync(new URL('failure.png',output),(await window.webContents.capturePage()).toPNG()); } catch {} window.destroy(); } app.exit(1); } }
void run();
