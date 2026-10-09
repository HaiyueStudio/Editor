import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'imageEditor/artifacts/daily'); mkdirSync(output, { recursive: true });
const result = await runEditorBrowserScenario({ root, route: 'imageEditor/app-dist/index.html', downloadDirectory: output, failureScreenshotPath: resolve(output, 'failure.png'), readinessExpression: 'Boolean(globalThis.haiyueEditor?.listOperations().some(e => e.descriptor.id === "image.document.create") && document.querySelector("#app")?.getAttribute("aria-busy") === "false")', scenario: async driver => {
  const { evaluate, click, nextPaint, cdp } = driver;
  const e = s => `document.querySelector(${JSON.stringify(s)})`, act = a => click(e(`[data-action="${a}"]`)), tool = t => click(e(`[data-tool="${t}"]`));
  await evaluate(`globalThis.dailyId = null; globalThis.dailySequence = 0; globalThis.dailyCall = async (suffix, params = {}) => {
    const api = globalThis.haiyueEditor, d = api.listDocuments().documents.find(d => d.identity.id === dailyId);
    const r = await api.execute({ apiVersion: '1', requestId: 'daily-' + (++dailySequence), operation: 'image.' + suffix, params, ...(d && !['document.open', 'document.create'].includes(suffix) ? { documentId: dailyId, expectedRevision: d.revision } : {}) });
    if (r.status !== 'completed') throw Error(JSON.stringify(r)); return r.value;
  };`);
  const call = (suffix, params = {}) => evaluate(`dailyCall(${JSON.stringify(suffix)}, ${JSON.stringify(params)})`);
  const created = await call('document.create', { name: '日常能力验收', width: 400, height: 300, white: true }); await evaluate(`dailyId = ${JSON.stringify(created.documentId)}`); await nextPaint(); await act('actual');
  let query = await call('document.query'), base = query.selectedId;
  await call('selection.set', { shape: 'rectangle', x: 100, y: 80, width: 120, height: 100 });
  await tool('gradient'); await evaluate('document.querySelector("#paint-color").value="#ff0000"; document.querySelector("#gradient-color").value="#0000ff";');
  const point = async (x, y) => { const r = await evaluate('(()=>{const r=document.querySelector("#image-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()'); return { x: r.x + x * r.width / 400, y: r.y + y * r.height / 300 }; };
  const mouse = (type, p, modifiers = 0) => cdp.call('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers });
  const drag = async (a, b) => { await mouse('mousePressed', a); await mouse('mouseMoved', b); await nextPaint(); await mouse('mouseReleased', b); await nextPaint(); };
  const key = async key => { await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key }); await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key }); await nextPaint(); };
  await drag(await point(100, 100), await point(220, 100));
  assert.deepEqual((await call('color.sample', { x: 90, y: 100 })).rgba, [255,255,255,255]); const picked = await call('color.sample', { x: 130, y: 100 }); assert.ok(picked.rgba[0] > picked.rgba[2]);
  await tool('eyedropper'); await mouse('mousePressed', await point(130,100)); await mouse('mouseReleased', await point(130,100)); await nextPaint(); assert.equal(await evaluate('document.querySelector("#paint-color").value'), picked.hex);
  await act('copy-pixels'); await act('paste-pixels'); await nextPaint(); query = await call('document.query'); const pasted = query.selectedId; assert.equal(query.layers.length, 2); assert.equal(query.layers[1].width, 120);
  await call('selection.clear'); await nextPaint();
  await act('free-transform'); assert.equal(await evaluate('document.querySelector("#free-transform").hidden'), false);
  const revBefore = await evaluate('haiyueEditor.listDocuments().documents.find(d=>d.identity.id===dailyId).revision');
  await drag(await point(160,130), await point(180,140));
  assert.equal(await evaluate('haiyueEditor.listDocuments().documents.find(d=>d.identity.id===dailyId).revision'), revBefore); await key('Escape');
  assert.equal((await call('document.query')).layers[1].x, 100);
  await act('free-transform'); await drag(await point(160,130), await point(180,140)); await key('Enter');
  assert.equal((await call('document.query')).layers[1].x, 120); await call('history.undo'); await nextPaint(); assert.equal((await call('document.query')).layers[1].x, 100);
  await act('free-transform'); const handle = await evaluate('(()=>{const r=document.querySelector("#free-transform [data-handle=se]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()'); await drag(handle, { x: handle.x + 10, y: handle.y + 10 }); await key('Enter'); assert.equal((await call('document.query')).layers[1].width, 140); await call('history.undo'); await nextPaint();
  await act('free-transform'); const rotation = await evaluate('(()=>{const r=document.querySelector("#free-transform [data-handle=rotate]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()'); await drag(rotation, await point(235,130)); await key('Enter'); query = await call('document.query'); assert.equal(query.layers[1].width, 100); assert.equal(query.layers[1].height, 120); await call('history.undo'); await nextPaint();
  await act('free-transform'); await call('layer.update', { layerId: pasted, patch: { opacity: .75 } }); await nextPaint(); assert.equal(await evaluate('document.querySelector("#free-transform").hidden'), true); await call('history.undo'); await nextPaint();
  // Real modifier click selects both rows; moving their union is a single history edit.
  const row = await evaluate(`(()=>{const r=document.querySelector('[data-layer-id="${base}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await mouse('mousePressed', row, process.platform === 'darwin' ? 4 : 2); await mouse('mouseReleased', row, process.platform === 'darwin' ? 4 : 2); await nextPaint(); assert.equal((await call('document.query')).selectedIds.length, 2, 'modifier click must select both visible rows');
  await tool('move'); await drag(await point(160,130), await point(170,135)); query = await call('document.query'); assert.equal(query.layers[0].x, 10); assert.equal(query.layers[1].x, 110); await call('history.undo'); await nextPaint();
  await act('align-layers'); assert.equal((await call('document.query')).layers[1].x, 0); await call('history.undo'); await nextPaint();
  const before = (await call('color.sample', { x: 130, y: 100 })).rgba; await act('merge-layers'); assert.equal((await call('document.query')).layers.length, 1); assert.deepEqual((await call('color.sample', { x: 130, y: 100 })).rgba, before); await call('history.undo');
  // DOM-backed content and image codecs are exercised through the same public command API.
  const text = await call('content.create', { name: '文字', content: { type: 'text', text: '海月', size: 24, family: 'sans-serif', bold: false, italic: false, align: 'left', color: '#ffffff' } });
  const shape = await call('content.create', { name: '圆形', x: 240, y: 100, content: { type: 'shape', shape: 'ellipse', width: 60, height: 40, radius: 0, fill: '#00ff00', stroke: '#000000', strokeWidth: 0 } });
  await call('content.update', { layerId: text.layerId, content: { type: 'text', text: 'Haiyue', size: 24, family: 'serif', bold: true, italic: false, align: 'center', color: '#ff9900' } });
  await call('layer.rasterize', { layerId: shape.layerId }); assert.equal((await call('document.query')).layers.find(l=>l.id===shape.layerId).content, null);
  for (const format of ['png','jpeg']) { const file = await call('document.export', { format }); const bytes = await evaluate(`Array.from(haiyueEditor.readResource(${JSON.stringify(file.resourceId)}).slice(0,8))`); assert.equal(bytes[0], format === 'png' ? 137 : 255); await call('layer.import', { resourceId: file.resourceId, name: '导入.' + format }); await call('history.undo'); const opened = await call('document.open', { resourceId: file.resourceId, name: '打开.' + format, format }); assert.ok(opened.documentId); await evaluate(`haiyueEditor.releaseResource(${JSON.stringify(file.resourceId)})`); }
  driver.assertNoBrowserErrors(); const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(output, 'daily.png'), Buffer.from(screenshot.result.data, 'base64'));
  return { schemaVersion: 1, status: 'passed', generatedAt: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), buildHash: JSON.parse(readFileSync(resolve(root, 'imageEditor/app-dist/app-manifest.json'))).buildHash, runner: { chrome: driver.chrome, platform: process.platform, arch: process.arch }, sourceFingerprints: Object.fromEntries([...readdirSync(resolve(root, 'imageEditor/src')).map(f => 'imageEditor/src/' + f), 'imageEditor/test/daily-browser.mjs', 'imageEditor/index.html', 'imageEditor/styles.css'].map(f => [f, createHash('sha256').update(readFileSync(resolve(root, f))).digest('hex')])), checks: ['gradient selection and eyedropper', 'pixel clipboard', 'transform move/scale/rotate/cancel/undo/external mutation', 'modifier multiselect and move/align/merge undo', 'editable content and rasterize API', 'PNG/JPEG export/import/open'] };
}}); writeFileSync(resolve(output, 'browser.json'), JSON.stringify(result, null, 2)); console.log(result);
