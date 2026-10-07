import assert from 'node:assert/strict';
import { importPsd } from '../dist/psdAdapter.js';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'imageEditor/artifacts/p1');
const downloads = resolve(output, `downloads-${Date.now()}`); mkdirSync(downloads, { recursive: true });
const fixtures = resolve(root, 'imageEditor/test/fixtures/p1');
const manifest = JSON.parse(readFileSync(resolve(fixtures, 'manifest.json')));
const sourceFiles = [
  ...readdirSync(resolve(root, 'imageEditor/src')).map(file => `imageEditor/src/${file}`),
  ...['package.json', 'tsconfig.json', 'tsconfig.web.json', 'rollup.config.js', 'app/descriptor.json', 'index.html', 'styles.css', 'assets/branding/haiyue-moon.png', 'test/browser-smoke.mjs'].map(file => `imageEditor/${file}`),
  'package-lock.json', 'config/architecture-boundaries.json', 'scripts/editor-e2e/browserDriver.mjs', 'scripts/pwa-smoke.mjs',
].sort();
const sourceFingerprints = Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]));
for (const [file, entry] of Object.entries(manifest.files)) {
  const bytes = readFileSync(resolve(fixtures, file)); assert.equal(bytes.length, entry.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
}
const report = await runEditorBrowserScenario({
  root, route: 'imageEditor/app-dist/index.html', downloadDirectory: downloads,
  failureScreenshotPath: resolve(output, 'failure.png'), timeoutMs: 30000,
  readinessExpression: 'document.querySelector("#app")?.getAttribute("aria-busy") === "false"',
  scenario: async driver => {
    const { click, evaluate, waitFor, replaceText, setFileInputFiles, cdp, nextPaint } = driver;
    const checks = [];
    const e = selector => `document.querySelector(${JSON.stringify(selector)})`;
    const rows = () => evaluate('document.querySelectorAll(".layer-row").length');
    const tabs = () => evaluate('document.querySelectorAll(".document-tab").length');
    const pixel = (x, y) => evaluate(`Array.from(document.querySelector('#image-canvas').getContext('2d').getImageData(${x},${y},1,1).data)`);
    const waitSaved = () => waitFor(() => evaluate('document.querySelector("#recovery-status").textContent.includes("已存")'), 'IndexedDB recovery committed');
    const shot = async name => { await nextPaint(); const response = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(resolve(output, name), Buffer.from(response.result.data, 'base64')); };
    assert.equal(await evaluate('document.querySelector("#welcome").hidden'), false); checks.push('empty workspace');
    assert.equal(await evaluate('document.querySelector(".brand-mark").naturalWidth'),384);
    assert(await evaluate('document.querySelector("[data-action=demo]").textContent.includes("海上生明月")'));
    await shot('welcome.png');
    await click(e('[data-action=demo]')); await waitFor(() => rows().then(n => n === 4), 'demo layers');
    assert.equal(await tabs(), 1); assert.equal(await evaluate('document.querySelector("#image-canvas").width'), 1200);
    await shot('workspace.png');
    await click(e('[data-action=export-psd]')); await click(e('#psd-export-confirm'));
    const psdFile=await waitFor(()=>readdirSync(downloads).find(f=>f.endsWith('.psd')),'moonrise sample PSD');
    const psdBytes=new Uint8Array(readFileSync(resolve(downloads,psdFile))),psd=importPsd(psdBytes,psdFile);
    assert(psd.layered,psd.blockers.join('\n')); assert.deepEqual(psd.layered.layers.map(l=>l.name),['01 · 夜空','02 · 明月','03 · 海面与月光','04 · 海上生明月 · 题字']);
    writeFileSync(resolve(output,'海上生明月.psd'),psdBytes); checks.push('shared engine branding and four-layer moonrise PSD export');
    const sunRow = `Array.from(document.querySelectorAll('.layer-row')).find(row => row.textContent.includes('02 · 明月'))`;
    await evaluate(`${sunRow}.scrollIntoView({block:'nearest'})`);
    const before = await pixel(842, 340); await click(`${sunRow}.querySelector('.layer-eye')`); await nextPaint(); assert.notDeepEqual(await pixel(842, 340), before);
    await click(e('[data-action=undo]')); await nextPaint(); assert.deepEqual(await pixel(842, 340), before); checks.push('visibility changes real pixels; undo restores pixels');
    await click(sunRow); await replaceText(e('#layer-name'), '明月 A'); await replaceText(e('#opacity'), '40'); await nextPaint();
    assert.notDeepEqual(await pixel(842, 340), before);
    await click(e('.layer-row.selected .layer-lock')); await nextPaint(); assert.equal(await evaluate('document.querySelector("#layer-name").disabled'), true);
    await click(e('.layer-row.selected .layer-lock')); await click(e('[data-action=duplicate]')); await waitFor(() => rows().then(n => n === 5), 'duplicated layer');
    await click(e('[data-action=undo]')); await waitFor(() => rows().then(n => n === 4), 'duplicate undo');
    await click(e('[data-action=add-group]')); await click(e('.layer-actions [data-action=add-layer]')); await nextPaint();
    assert.equal(await evaluate('document.querySelector(".layer-row.selected").getAttribute("aria-level")'), '2'); checks.push('rename, opacity, lock, duplicate, group creation');
    await click(e('[data-action=save]')); await waitSaved();

    await click(e('.header-actions [data-action=new]')); await replaceText(e('#new-name'), '导入测试'); await replaceText(e('#new-width'), '64'); await replaceText(e('#new-height'), '48');
    await evaluate('document.querySelector("#new-background").value="white"'); await click(e('#new-form button[type=submit]'));
    await waitFor(() => tabs().then(n => n === 2), 'second document'); assert.deepEqual(await pixel(0, 0), [255, 255, 255, 255]);
    await setFileInputFiles('#import-input', [resolve(fixtures, 'import.png')]); await waitFor(() => rows().then(n => n === 2), 'PNG imported as layer');
    assert.deepEqual(await pixel(30, 22), [240, 50, 30, 255]); await replaceText(e('#layer-x'), '31'); await nextPaint();
    assert.deepEqual(await pixel(30, 22), [255, 255, 255, 255]); assert.deepEqual(await pixel(31, 22), [240, 50, 30, 255]);
    await click(e('.document-tab:first-child [role=tab]')); assert.equal(await rows(), 6);
    await click(e('[data-action=undo]')); await nextPaint(); assert.equal(await rows(), 5);
    await click(e('.document-tab:nth-child(2) [role=tab]')); assert.equal(await rows(), 2); assert.equal(await evaluate('document.querySelector("#layer-x").value'), '31');
    checks.push('multi-document histories isolated; imported pixels and position verified');
    await evaluate(`void Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => { throw new DOMException('cancelled', 'AbortError'); } })`);
    await click(e('[data-action=save]')); await nextPaint();
    assert(await evaluate('document.querySelector(".document-tab.active").textContent.includes("•")'));
    await evaluate(`void Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })`);
    checks.push('cancelled file picker retains unsaved state');
    await click(e('[data-action=save]')); await waitSaved();
    const savedProject = await waitFor(() => readdirSync(downloads).find(file => /^导入测试.*\.hyimage$/.test(file)), 'project download');
    const project = JSON.parse(readFileSync(resolve(downloads, savedProject))); assert.equal(project.format, 'haiyue-image'); assert.equal(project.document.layers.length, 2);
    await replaceText(e('#layer-name'), '刷新后仍在'); await waitSaved();
    const stopDialogs = cdp.on('Page.javascriptDialogOpening', () => { void cdp.call('Page.handleJavaScriptDialog', { accept: true }); });
    let previousOrigin = await evaluate('performance.timeOrigin');
    await cdp.call('Page.reload');
    await waitFor(() => evaluate(`performance.timeOrigin !== ${previousOrigin} && document.querySelector("#app")?.getAttribute("aria-busy")==="false" && document.querySelectorAll(".document-tab").length===2`), 'session restored after reload');
    assert.equal(await evaluate('document.querySelector("#layer-name").value'), '刷新后仍在');
    assert.deepEqual(await pixel(31, 22), [240, 50, 30, 255]); assert(await evaluate('document.querySelector(".document-tab.active").textContent.includes("•")'));
    checks.push('IndexedDB refresh restores both documents, active tab, dirty state and pixels');
    await click(e('.document-tab.active .tab-close')); await waitFor(() => evaluate('document.querySelector("#close-dialog").open'), 'unsaved close dialog');
    await click(e('#close-cancel')); assert.equal(await tabs(), 2);
    await click(e('.document-tab.active .tab-close')); await click(e('#close-discard')); await waitFor(() => tabs().then(n => n === 1), 'discard closes document'); await waitSaved();
    previousOrigin = await evaluate('performance.timeOrigin');
    await cdp.call('Page.reload'); await waitFor(() => evaluate(`performance.timeOrigin !== ${previousOrigin} && document.querySelector("#app")?.getAttribute("aria-busy")==="false" && document.querySelectorAll(".document-tab").length===1`), 'closed document absent from recovery');
    await setFileInputFiles('#open-input', [resolve(downloads, savedProject)]); await waitFor(() => tabs().then(n => n === 2), 'saved project reopened');
    assert.equal(await evaluate('document.querySelector("#layer-name").value'), 'import'); assert.deepEqual(await pixel(31, 22), [240, 50, 30, 255]);
    checks.push('close cancel/discard, recovery removal, downloaded project reopening');
    await setFileInputFiles('#open-input', [resolve(fixtures, 'invalid.hyimage')]); await waitFor(() => evaluate('document.querySelector("#notice").classList.contains("error")'), 'invalid project error'); assert.equal(await tabs(), 2);
    await setFileInputFiles('#open-input', [resolve(fixtures, 'import.png')]); await waitFor(() => tabs().then(n => n === 3), 'PNG opens as document'); assert.deepEqual(await pixel(0, 0), [240, 50, 30, 255]);
    await setFileInputFiles('#open-input', [resolve(fixtures, 'import.jpg')]); await waitFor(() => tabs().then(n => n === 4), 'JPEG opens as document'); assert.equal(await evaluate('document.querySelector("#image-canvas").width'), 6);
    const green = await pixel(0, 0); assert(Math.abs(green[0] - 20) <= 3 && Math.abs(green[1] - 180) <= 3 && Math.abs(green[2] - 70) <= 3);
    checks.push('PNG/JPEG opening and malformed-project rejection without data loss');
    await click(e('.document-tab:first-child [role=tab]')); await click(e('[data-action=actual]')); assert.equal(await evaluate('document.querySelector("#zoom-label").textContent'), '100%');
    await click(e('[data-action=zoom-in]')); assert.equal(await evaluate('document.querySelector("#zoom-label").textContent'), '125%');
    await click(e('[data-action=fit]')); await nextPaint();
    const rect = await evaluate('JSON.stringify(document.querySelector("#viewport").getBoundingClientRect())'); const box = JSON.parse(rect);
    const transform = await evaluate('document.querySelector("#artboard").style.transform');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 40, y: y + 25, buttons: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 40, y: y + 25, button: 'left' }); await nextPaint();
    assert.notEqual(await evaluate('document.querySelector("#artboard").style.transform'), transform); checks.push('zoom, actual pixels, fit and pointer panning');
    await click(e('[data-action=fit]')); await click(e('#dismiss-notice')); await shot('final-workspace.png');
    await evaluate(`new Promise((resolve, reject) => { const request = indexedDB.open('haiyue.image-editor.v1', 1); request.onsuccess = () => { const db = request.result, tx = db.transaction('recovery', 'readwrite'); tx.objectStore('recovery').put({version:99,documents:[]}, 'session'); tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = () => reject(tx.error); }; })`);
    previousOrigin = await evaluate('performance.timeOrigin');
    await cdp.call('Page.reload'); await waitFor(() => evaluate(`performance.timeOrigin !== ${previousOrigin} && document.querySelector('#app')?.getAttribute('aria-busy') === 'false'`), 'corrupt recovery handled');
    assert.equal(await tabs(), 0); assert(await evaluate('document.querySelector("#recovery-status").textContent.includes("不可用")'));
    await click(e('.header-actions [data-action=new]')); await click(e('#new-form button[type=submit]')); await waitFor(() => tabs().then(n => n === 1), 'new work after corrupt recovery');
    const corruptVersion = await evaluate(`new Promise((resolve, reject) => { const request = indexedDB.open('haiyue.image-editor.v1', 1); request.onsuccess = () => { const db = request.result, tx = db.transaction('recovery', 'readonly'), get = tx.objectStore('recovery').get('session'); tx.oncomplete = () => { db.close(); resolve(get.result.version); }; tx.onerror = () => reject(tx.error); }; })`);
    assert.equal(corruptVersion, 99); checks.push('corrupt recovery preserved; new work remains possible without overwriting it');
    stopDialogs(); driver.assertNoBrowserErrors();
    return { schemaVersion: 1, status: 'passed', generatedAt: new Date().toISOString(), checks, browser: await evaluate('navigator.userAgent'),
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), sourceFingerprints,
      buildHash: JSON.parse(readFileSync(resolve(root, 'imageEditor/app-dist/app-manifest.json'))).buildHash, fixtures: manifest };
  },
});
writeFileSync(resolve(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output }, null, 2));
