import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writePsdUint8Array } from 'ag-psd';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';

const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'imageEditor/artifacts/idle-work-p0');
mkdirSync(out, { recursive: true });
const pixels = (width, height, rgb) => ({ width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : rgb[i % 4]) });
const fixture = writePsdUint8Array({ width: 9001, height: 65, children: [
  { name: 'base', imageData: pixels(9001, 65, [40, 130, 210]) },
  ...Array.from({ length: 16 }, (_, i) => ({ name: `small-${i}`, left: i * 40, top: 0, imageData: pixels(32, 32, [80 + i * 8, 60, 100]) })),
] }, { noBackground: true });
const file = resolve(out, 'layers.psd'); writeFileSync(file, fixture);
const report = await runEditorBrowserScenario({ root, route: 'imageEditor/app-dist/index.html', timeoutMs: 180000,
  downloadDirectory: out, failureScreenshotPath: resolve(out, 'failure.png'),
  readinessExpression: `Boolean(globalThis.haiyueEditor && document.querySelector('#app')?.getAttribute('aria-busy') === 'false')`,
  scenario: async driver => {
    const { evaluate, waitFor, click, nextPaint, cdp } = driver;
    await evaluate(`(() => {
      globalThis.audit = { reads: 0, livePreviews: 0, thumbnailStarts: 0, thumbnailStops: 0, paintChanges: 0, rowChanges: 0, hold: true };
      const NativeWorker = Worker;
      globalThis.Worker = class extends NativeWorker {
        postMessage(message, ...rest) {
          if (message.kind === 'preview-init') {
            this.preview = true; this.thumbnail = message.state.id === 'thumbnail';
            if (this.thumbnail) audit.thumbnailStarts++; else audit.livePreviews++;
          }
          if (message.kind === 'preview-read') { audit.reads++; if (this.thumbnail && audit.hold) return; }
          return super.postMessage(message, ...rest);
        }
        terminate() {
          if (!this.stopped && this.preview) { if (this.thumbnail) audit.thumbnailStops++; else audit.livePreviews--; }
          this.stopped = true; return super.terminate();
        }
      };
      new MutationObserver(records => audit.paintChanges += records.length).observe(document.querySelector('#image-canvas'), { attributes: true, attributeFilter: ['data-painting'] });
      new MutationObserver(records => audit.rowChanges += records.length).observe(document.querySelector('#layer-list'), { childList: true });
    })()`);
    await driver.setFileInputFiles('#open-input', [file]);
    await waitFor(() => evaluate(`document.querySelector('#psd-import-dialog').open`), 'PSD ready');
    await click(`document.querySelector('#psd-import-layers')`);
    const paint = () => waitFor(() => evaluate(`document.querySelector('#image-canvas').dataset.painting === 'false'`), 'visible frame');
    await paint(); await waitFor(() => evaluate('audit.livePreviews === 0'), 'overview finished'); await nextPaint();
    await evaluate(`globalThis.p0doc = haiyueEditor.listDocuments().activeId;
      globalThis.call = async (id, params = {}) => { const r = await haiyueEditor.execute({ apiVersion: '1', requestId: crypto.randomUUID(), operation: 'image.' + id, ...(id === 'document.create' ? {} : { documentId: p0doc, expectedRevision: haiyueEditor.listDocuments().documents.find(d => d.identity.id === p0doc).revision }), params }); if (r.status !== 'completed') throw Error(JSON.stringify(r)); return r.value; }`);
    const call = (id, params = {}) => evaluate(`call(${JSON.stringify(id)}, ${JSON.stringify(params)})`);
    const query = await call('document.query'), top = query.layers.at(-1).id, base = query.layers.find(l => l.name === 'base').id;
    await evaluate(`globalThis.savedRow = document.querySelector('[data-layer-id="${top}"]'); globalThis.savedCanvas = savedRow.querySelector('canvas'); savedRow.focus();`);
    const idleBefore = await evaluate('({...audit})');
    for (let i = 0; i < 6; i++) await call('layers.select', { layerIds: [query.layers.at(-1 - i % 2).id] });
    await call('layer.update', { layerId: top, patch: { name: 'renamed' } });
    await call('layer.update', { layerId: top, patch: { locked: true } });
    await call('history.undo'); await call('history.undo'); await call('history.redo');
    await call('selection.set', { shape: 'rectangle', x: 1, y: 1, width: 5, height: 5 }); await call('selection.clear');
    await nextPaint(); await nextPaint();
    const idleAfter = await evaluate('({...audit})');
    assert.equal(idleAfter.paintChanges, idleBefore.paintChanges, 'metadata/selection must not request a frame');
    assert.equal(idleAfter.reads, idleBefore.reads, 'metadata/selection must not request new preview pixels');
    assert.equal(idleAfter.rowChanges, idleBefore.rowChanges, 'rows must survive updates');
    assert(await evaluate(`savedRow === document.querySelector('[data-layer-id="${top}"]') && savedCanvas === savedRow.querySelector('canvas') && document.activeElement === savedRow`));

    await cdp.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown' }); await nextPaint();
    assert.equal(await evaluate(`document.activeElement.dataset.layerId`), query.layers.at(-2).id);

    // P1 imports already have thumbnails. A real pixel edit invalidates that
    // transient preview so this test still exercises the uncached cancellation path.
    await call('pixels.stroke', { layerId: base, points: [{ x: 8500, y: 32 }], size: 1, color: '#ff0000' });
    await paint(); await waitFor(() => evaluate('audit.livePreviews === 0'), 'edited overview finished');

    // Pause only the thumbnail read response to exercise cancellation deterministically.
    // The normal viewport/overview and all Worker initialization still run unchanged.
    assert.equal(await evaluate('audit.thumbnailStarts'), 0, 'offscreen large layer must stay idle');
    await evaluate(`document.querySelector('#layer-list').scrollTop = 100000`);
    await waitFor(() => evaluate('audit.thumbnailStarts === 1'), 'visible thumbnail started');
    await evaluate(`document.querySelector('#layer-list').scrollTop = 0`);
    await waitFor(() => evaluate('audit.thumbnailStops === 1'), 'offscreen thumbnail cancelled');
    assert.equal(await evaluate(`document.querySelector('[data-layer-id="${base}"] canvas').dataset.thumbnail`), 'idle');
    await evaluate(`document.querySelector('#layer-list').scrollTop = 100000`);
    await waitFor(() => evaluate('audit.thumbnailStarts === 2'), 'thumbnail retry');
    await call('document.create', { name: 'switch cancellation', width: 32, height: 32 });
    await waitFor(() => evaluate('audit.thumbnailStops === 2'), 'document switch cancels thumbnail');
    await paint(); await evaluate('audit.hold = false');
    await click(`document.querySelector('[data-document-id="${query.documentId ?? await evaluate('p0doc')}"] > button')`);
    await paint(); await evaluate(`document.querySelector('#layer-list').scrollTop = 100000`);
    await waitFor(() => evaluate(`document.querySelector('[data-layer-id="${base}"] canvas').dataset.thumbnail === 'ready'`), 'thumbnail resumes normally');
    const starts = await evaluate('audit.thumbnailStarts');
    await evaluate(`document.querySelector('#layer-list').scrollTop = 0`); await nextPaint();
    await evaluate(`document.querySelector('#layer-list').scrollTop = 100000`); await nextPaint();
    assert.equal(await evaluate('audit.thumbnailStarts'), starts, 'completed thumbnail reused');

    const oldFrame = await evaluate(`JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame`);
    await call('layer.update', { layerId: base, patch: { opacity: .5 } }); await paint();
    assert((await evaluate(`JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame`)) > oldFrame);
    await call('history.undo'); await paint();
    const beforeZoom = await evaluate(`JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame`);
    await click(`document.querySelector('[data-action=actual]')`);
    await waitFor(() => evaluate(`JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame > ${beforeZoom}`), 'zoom submits a new frame'); await paint();
    assert((await evaluate(`JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame`)) > beforeZoom);
    const beforeFit = await evaluate(`JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame`);
    await click(`document.querySelector('[data-action=fit]')`);
    await waitFor(() => evaluate(`JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame > ${beforeFit}`), 'fit submits a new frame'); await paint();
    writeFileSync(resolve(out, 'workspace.png'), Buffer.from((await cdp.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    driver.assertNoBrowserErrors();
    return { status: 'passed', idleBefore, idleAfter, audit: await evaluate('({...audit})'), checks: [
      'selection, rename, lock and metadata undo/redo: zero paint/pixel requests', 'stable layer rows, canvas identity and keyboard focus',
      'offscreen thumbnails stay idle; scroll/document switch cancellation terminates Worker; retry and completed reuse', 'opacity edit, undo and zoom still repaint',
    ], runner: { chrome: driver.chrome, browser: await evaluate('navigator.userAgent'), platform: process.platform, arch: process.arch } };
  },
});
const sources = ['main', 'canvasView', 'layerListView', 'thumbnailQueue', 'renderInputs', 'renderDamage', 'previewCache', 'tiledViewportRenderer'].map(n => `imageEditor/src/${n}.ts`);
writeFileSync(resolve(out, 'browser.json'), JSON.stringify({ ...report, schema: 1, kind: 'local diagnostic', generatedAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  fixture: { width: 9001, height: 65, layers: 17, bytes: fixture.length, sha256: createHash('sha256').update(fixture).digest('hex') },
  buildHash: JSON.parse(readFileSync(resolve(root, 'imageEditor/app-dist/app-manifest.json'))).buildHash,
  sourceFingerprints: Object.fromEntries([...sources, 'imageEditor/test/idle-work-p0-browser.mjs'].map(f => [f, createHash('sha256').update(readFileSync(resolve(root, f))).digest('hex')])),
}, null, 2));
console.log(JSON.stringify(report, null, 2));
