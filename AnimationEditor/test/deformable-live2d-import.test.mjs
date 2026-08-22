import assert from 'node:assert/strict';
import test from 'node:test';
import * as subject from '../dist-test/source-import-entry.js';
import { compileAnimationEditorProject, createEmptyAnimationEditorProject } from '../dist-test/testing.js';

function request(overrides = {}) {
  return { entry: 'model.model3.json', files: [{ path: 'model.model3.json', bytes: new TextEncoder().encode('{}') }, { path: 'texture.png', bytes: new Uint8Array([1, 2, 3]) }], coreVersion: '5.0.0', recipe: { id: 'idle', motion: 'Idle:0', frameRate: 30, tolerance: 0.01, quantizationStep: 0.001, mode: 'normal' }, ...overrides };
}
function converter(options = {}) {
  const project = createEmptyAnimationEditorProject({ id: 'live2d', name: 'Live2D', width: 64, height: 64, duration: 1, frameRate: 30 });
  const hya = new Uint8Array(compileAnimationEditorProject(project).binary);
  return { id: 'live2d-cubism-clip-baked', version: options.version ?? '1.0.0', async convert(_request, context) {
    if (options.waitForAbort) await new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    context.progress(1, 2, 'sample');
    return { hya, sidecars: [{ path: 'model.hydm', bytes: new Uint8Array([4, 5]), mimeType: 'application/vnd.haiyue.deformable-mesh-2d' }], diagnostics: options.diagnostics ?? [], sourceVersion: 'moc3-v4', evaluatorVersion: 'core-5' };
  } };
}

test('Live2D workflow exact-parses converter HYA and exports no source/Core payload', async () => {
  const progress = [];
  const asset = await new subject.Live2DImportWorkflow(converter(), item => progress.push(item.stage)).convert(request());
  assert.equal(asset.preview.source, 'binary');
  assert.equal(asset.kind, 'live2d-clip-baked-hya');
  assert.deepEqual(subject.createLive2DDeliveryFiles(asset).map(file => file.path), ['model.hya', 'model.hydm']);
  const reopened = subject.parseLive2DDerivedAsset(subject.serializeLive2DDerivedAsset(asset));
  assert.equal(reopened.preview.source, 'binary');
  assert.deepEqual(reopened.recipe, asset.recipe);
  assert.deepEqual(reopened.hya, asset.hya);
  assert.deepEqual(reopened.sidecars[0].bytes, asset.sidecars[0].bytes);
  assert.deepEqual(progress, ['convert', 'sample', 'complete']);
  assert.throws(() => subject.createLive2DDeliveryFiles({ ...asset, sidecars: [{ path: 'source.moc3', bytes: new Uint8Array(), mimeType: 'application/octet-stream' }] }), error => error.code === 'E_LIVE2D_INVALID_OUTPUT');
});

test('reimport preserves identity, computes precise staleness and supports undo/redo', async () => {
  const first = await new subject.Live2DImportWorkflow(converter()).convert(request({ assetId: 'character' }));
  const secondRequest = request({ assetId: 'character', recipe: { ...request().recipe, motion: 'Tap:0' } });
  assert.deepEqual(await subject.inspectLive2DAssetStaleness(first, secondRequest, converter()), { stale: true, reasons: ['recipe'] });
  const second = await new subject.Live2DImportWorkflow(converter()).convert(secondRequest);
  assert.equal(second.id, first.id);
  const history = new subject.Live2DAssetHistory(first); history.commit(second);
  assert.equal(history.undo().recipe.motion, 'Idle:0');
  assert.equal(history.redo().recipe.motion, 'Tap:0');
});

test('strict diagnostics, WPK and stale late conversion fail without commit', async () => {
  const diagnostic = { code: 'W_CUBISM_COLOR_APPROXIMATED', severity: 'warning', path: '$.drawables[0]', message: 'color' };
  await assert.rejects(new subject.Live2DImportWorkflow(converter({ diagnostics: [diagnostic] })).convert(request({ recipe: { ...request().recipe, mode: 'strict' } })), error => error.code === 'E_LIVE2D_STRICT_DIAGNOSTIC');
  await assert.rejects(new subject.Live2DImportWorkflow(converter()).convert(request({ entry: 'protected.wpk' })), error => error.code === 'E_LIVE2D_INVALID_SOURCE');
  let commits = 0;
  const workflow = new subject.Live2DImportWorkflow(converter({ waitForAbort: true }));
  const pending = workflow.convert(request(), () => commits++); workflow.cancel();
  await assert.rejects(pending, error => error.code === 'E_LIVE2D_ABORTED');
  assert.equal(commits, 0);
});
