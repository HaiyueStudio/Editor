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
  let wait = options.waitForAbort;
  let fail = options.failOnce;
  return { id: 'live2d-cubism-clip-baked', version: options.version ?? '1.0.0',
    async inspect() { return options.inspection ?? inspection(); },
    async convert(_request, context) {
    if (wait) { wait = false; await new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })); }
    if (fail) { fail = false; throw new Error('converter failed once'); }
    context.progress(1, 2, 'sample');
    return { hya, sidecars: [], diagnostics: options.diagnostics ?? [], sourceVersion: 'moc3-v4', evaluatorVersion: 'core-5' };
  } };
}

function inspection(overrides = {}) {
  return {
    modelName: 'Fixture', core: { available: true, version: '5.0.0' }, motions: ['Idle:0', 'Tap:0'], expressions: ['Smile'],
    physicsAvailable: true, poseAvailable: true,
    dependencies: [{ path: 'model.model3.json', kind: 'model', status: 'available' }, { path: 'texture.png', kind: 'texture', status: 'available' }],
    diagnostics: [], ...overrides,
  };
}

function preview() {
  return {
    asset: null, replacements: 0, clears: 0, closed: false, failNext: false,
    async replace(asset) { if (this.failNext) { this.failNext = false; throw new Error('preview failed'); } this.asset = asset; this.replacements++; },
    clear() { this.asset = null; this.clears++; }, close() { this.closed = true; this.asset = null; },
  };
}

test('Live2D workflow exact-parses converter HYA and exports no source/Core payload', async () => {
  const progress = [];
  const asset = await new subject.Live2DImportWorkflow(converter(), item => progress.push(item.stage)).convert(request());
  assert.equal(asset.preview.source, 'binary');
  assert.equal(asset.kind, 'live2d-clip-baked-hya');
  assert.deepEqual(subject.createLive2DDeliveryFiles(asset).map(file => file.path), ['model.hya']);
  const reopened = subject.parseLive2DDerivedAsset(subject.serializeLive2DDerivedAsset(asset));
  assert.equal(reopened.preview.source, 'binary');
  assert.deepEqual(reopened.recipe, asset.recipe);
  assert.deepEqual(reopened.hya, asset.hya);
  assert.deepEqual(reopened.sidecars, asset.sidecars);
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

test('authoring session performs configure, preview, save/reopen, stale reimport, export and history atomically', async () => {
  const port = converter();
  const runtime = preview();
  const workflow = new subject.Live2DImportWorkflow(port);
  const session = new subject.Live2DImportSession({ converter: port, workflow, preview: runtime });
  const phases = [];
  session.subscribe(snapshot => phases.push(snapshot.phase));
  const selected = await session.selectSource({ entry: request().entry, files: request().files });
  assert.equal(selected.phase, 'configuring');
  assert.equal(selected.recipe.motion, 'Idle:0');
  await session.configureRecipe({ motion: 'Tap:0', expression: 'Smile', physics: true, pose: true });
  const first = await session.convert();
  assert.equal(first.preview.source, 'binary');
  assert.equal(runtime.asset.id, first.id);
  const saved = session.save();
  const changedFiles = request().files.map((file, index) => index === 1 ? { ...file, bytes: new Uint8Array([9, 9, 9]) } : file);
  const changed = await session.selectSource({ entry: request().entry, files: changedFiles });
  assert.deepEqual(changed.staleReasons, ['source-hash']);
  assert.equal(changed.phase, 'stale');
  const second = await session.reimport();
  assert.equal(second.id, first.id);
  assert.equal(session.exportFiles()[0].path, 'model.hya');
  assert.equal((await session.undo()).sourceHash, first.sourceHash);
  assert.equal((await session.redo()).sourceHash, second.sourceHash);
  const reopened = await session.reopen(saved);
  assert.deepEqual(reopened.hya, first.hya);
  assert.ok(phases.includes('inspecting') && phases.includes('converting') && phases.includes('ready'));
  await session.close();
  assert.equal(runtime.closed, true);
});

test('failed converter or exact preview replacement preserves the previous derived asset', async () => {
  const port = converter({ failOnce: true });
  const runtime = preview();
  const session = new subject.Live2DImportSession({ converter: port, workflow: new subject.Live2DImportWorkflow(port), preview: runtime });
  await session.selectSource({ entry: request().entry, files: request().files });
  await assert.rejects(session.convert(), error => error.code === 'E_LIVE2D_CONVERSION_FAILED');
  const first = await session.retry();
  runtime.failNext = true;
  await session.configureRecipe({ motion: 'Tap:0' });
  await assert.rejects(session.reimport(), error => error.code === 'E_LIVE2D_CONVERSION_FAILED');
  assert.equal(session.snapshot.asset.id, first.id);
  assert.equal(session.snapshot.asset.recipe.motion, 'Idle:0');
  assert.equal(runtime.asset.id, first.id);
  await session.close();
});

test('session classifies missing/moved dependencies, unavailable Core, parameterized demand and cancel/retry', async () => {
  for (const [inspectionValue, code] of [
    [inspection({ dependencies: [{ path: 'texture.png', kind: 'texture', status: 'missing' }] }), 'E_LIVE2D_DEPENDENCY_MISSING'],
    [inspection({ dependencies: [{ path: 'texture.png', kind: 'texture', status: 'moved', resolvedPath: 'textures/texture.png' }] }), 'E_LIVE2D_DEPENDENCY_MISSING'],
    [inspection({ core: { available: false, message: 'Core missing' } }), 'E_LIVE2D_CORE_UNAVAILABLE'],
  ]) {
    const port = converter({ inspection: inspectionValue });
    const session = new subject.Live2DImportSession({ converter: port, workflow: new subject.Live2DImportWorkflow(port) });
    assert.equal((await session.selectSource({ entry: request().entry, files: request().files })).phase, 'blocked');
    await assert.rejects(session.convert(), error => error.code === code);
    await session.close();
  }

  const parameterizedPort = converter();
  const parameterized = new subject.Live2DImportSession({ converter: parameterizedPort, workflow: new subject.Live2DImportWorkflow(parameterizedPort) });
  await parameterized.selectSource({ entry: request().entry, files: request().files });
  await parameterized.configureRecipe({ runtimeInputs: ['ParamAngleX'] });
  await assert.rejects(parameterized.convert(), error => error.code === 'E_LIVE2D_PARAMETERIZED_UNSUPPORTED');
  await parameterized.close();

  const cancelPort = converter({ waitForAbort: true });
  const cancelSession = new subject.Live2DImportSession({ converter: cancelPort, workflow: new subject.Live2DImportWorkflow(cancelPort) });
  await cancelSession.selectSource({ entry: request().entry, files: request().files });
  const pending = cancelSession.convert();
  await waitFor(() => cancelSession.snapshot.progress?.stage === 'convert');
  cancelSession.cancel();
  await assert.rejects(pending, error => error.code === 'E_LIVE2D_ABORTED');
  assert.equal((await cancelSession.retry()).preview.source, 'binary');
  await cancelSession.close();
});

test('conversion validates recipe budgets, error diagnostics and delivery allow-list', async () => {
  await assert.rejects(new subject.Live2DImportWorkflow(converter()).convert(request({ recipe: { ...request().recipe, frameRate: 1000 } })), error => error.code === 'E_LIVE2D_INVALID_SOURCE');
  const errorDiagnostic = { code: 'E_CAPTURE', severity: 'error', path: '$.frames[0]', message: 'capture failed' };
  await assert.rejects(new subject.Live2DImportWorkflow(converter({ diagnostics: [errorDiagnostic] })).convert(request()), error => error.code === 'E_LIVE2D_CONVERSION_FAILED');
  const asset = await new subject.Live2DImportWorkflow(converter()).convert(request());
  assert.throws(() => subject.createLive2DDeliveryFiles({ ...asset, sidecars: [{ path: 'renamed-core.js', bytes: new Uint8Array(), mimeType: 'text/javascript' }] }), error => error.code === 'E_LIVE2D_INVALID_OUTPUT');
  const serialized = JSON.parse(subject.serializeLive2DDerivedAsset(asset));
  serialized.sidecars = [{ path: 'source.moc3', mimeType: 'application/octet-stream', bytes: 'AQ==' }];
  assert.throws(() => subject.parseLive2DDerivedAsset(JSON.stringify(serialized)), error => error.code === 'E_LIVE2D_INVALID_OUTPUT');
  const mismatchedPort = converter({ version: '2.0.0' });
  assert.throws(
    () => new subject.Live2DImportSession({ converter: mismatchedPort, workflow: new subject.Live2DImportWorkflow(converter({ version: '1.0.0' })) }),
    error => error.code === 'E_LIVE2D_INVALID_SOURCE',
  );
});

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test condition.');
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
