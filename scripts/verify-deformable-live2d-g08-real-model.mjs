#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { rollup } from 'rollup';
import { encodeAnimationBinary } from '@haiyue/animation-spec';
import { createDeformableMesh2DFormatRegistry } from '@haiyue/animation-spec/deformable2d';
import { convertCubismCaptureToHya } from '@haiyue/animation-spec/live2d';
import { runChromeWebGpuFixture } from './webgpu-gate/chrome-runner.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '..');
const editorRoot = resolve(repositoryRoot, 'AnimationEditor');
const testRoot = resolve(editorRoot, 'test');
const args = process.argv.slice(2);
const modelRoot = requiredPath('--model');
const capturePath = requiredPath('--capture');
const coreVersion = requiredValue('--core-version');
const modelEntry = optionalValue('--entry') ?? findSingleModelEntry(await collectFiles(modelRoot));
const cliPath = resolve(repositoryRoot, 'node_modules/@haiyue/animation-spec/bin/hya-live2d-convert.mjs');
const scratch = await mkdtemp(resolve(testRoot, '.deformable-live2d-real-data-'));
const bundleDirectory = await mkdtemp(resolve(testRoot, '.deformable-live2d-real-bundle-'));

try {
  const stagedCapturePath = resolve(scratch, 'capture.json');
  const capture = JSON.parse(await readFile(capturePath, 'utf8'));
  await writeFile(stagedCapturePath, `${JSON.stringify(capture)}\n`);
  for (const texture of capture.textures ?? []) {
    assertSafeRelativePath(texture.uri, 'capture texture');
    const source = resolve(dirname(capturePath), texture.uri);
    const target = resolve(scratch, texture.uri);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }

  const cliHya = resolve(scratch, 'model.hya');
  const cliHydm = resolve(scratch, 'model.hydm');
  const cliReport = resolve(scratch, 'model.report.json');
  const cli = await execFileAsync(process.execPath, [cliPath, '--input', stagedCapturePath, '--output', cliHya, '--data', cliHydm, '--report', cliReport], { maxBuffer: 8 * 1024 * 1024 });
  const [expectedHya, expectedHydm, sourceFiles, api] = await Promise.all([
    readFile(cliHya), readFile(cliHydm), collectFiles(modelRoot),
    import(pathToFileURL(resolve(editorRoot, 'dist-test/source-import-entry.js')).href),
  ]);
  const captureBytes = await readFile(stagedCapturePath);
  const converter = createConverter(capture, scratch, coreVersion, sha256(captureBytes));
  const workflow = new api.Live2DImportWorkflow(converter);
  const preview = createExactBytePreview();
  const session = new api.Live2DImportSession({ converter, workflow, preview });
  await session.selectSource({ entry: modelEntry, files: sourceFiles });
  assert.equal(session.snapshot.phase, 'configuring');
  await session.configureRecipe({ motion: 'Idle:0', physics: true, frameRate: capture.frameRate, mode: 'normal' });
  const first = await session.convert();
  assert.deepEqual(Buffer.from(first.hya), expectedHya, 'Editor HYA differs from packed CLI output.');
  assert.deepEqual(Buffer.from(sidecar(first, 'model.hydm').bytes), expectedHydm, 'Editor HYDM differs from packed CLI output.');
  assert.equal(preview.lastHyaSha256, sha256(expectedHya));
  const stableId = first.id;
  const serialized = session.save();
  const reopened = await session.reopen(serialized);
  assert.equal(reopened.id, stableId);
  assert.deepEqual(Buffer.from(reopened.hya), expectedHya);

  const changedFiles = sourceFiles.map((file, index) => index === sourceFiles.length - 1
    ? Object.freeze({ path: file.path, bytes: new Uint8Array([...file.bytes, 0x0a]) })
    : file);
  await session.selectSource({ entry: modelEntry, files: changedFiles });
  assert.equal(session.snapshot.phase, 'stale');
  assert.deepEqual(session.snapshot.staleReasons, ['source-hash']);
  const reimported = await session.reimport();
  assert.equal(reimported.id, stableId);
  assert.deepEqual(Buffer.from(reimported.hya), expectedHya);
  await session.undo();
  await session.redo();
  assert.equal(session.snapshot.asset.id, stableId);
  const delivery = session.exportFiles();
  assert.deepEqual(delivery.map(file => file.path), ['model.hya', ...['model.hydm', ...capture.textures.map(texture => texture.uri)].sort((left, right) => left.localeCompare(right))]);
  assert.ok(delivery.every(file => !/(?:live2dcubismcore|\.moc3|\.model3\.json|\.motion3\.json|\.physics3\.json|\.wpk|\.js$|\.wasm$)/iu.test(file.path)));
  await writeFile(resolve(scratch, 'asset.json'), session.save());
  await writeFile(resolve(scratch, 'manifest.json'), `${JSON.stringify({ hyaSha256: sha256(expectedHya), drawableCount: capture.frames[0]?.drawables.length ?? 0 })}\n`);
  await session.close();
  assert.equal(preview.active, false);

  const bundle = await rollup({
    input: resolve(testRoot, 'deformable-live2d-browser-entry.ts'),
    plugins: [
      nodeResolve({ browser: true, preferBuiltins: false, exportConditions: ['source'] }),
      commonjs(),
      typescript({ tsconfig: resolve(testRoot, 'tsconfig.deformable-live2d-browser.json'), outDir: bundleDirectory, declaration: false }),
    ],
  });
  await bundle.write({ dir: bundleDirectory, entryFileNames: 'entry.js', chunkFileNames: 'chunks/[name]-[hash].js', format: 'es', sourcemap: true });
  await bundle.close();
  const browser = await runChromeWebGpuFixture({
    root: repositoryRoot,
    fixture: 'AnimationEditor/test/deformable-live2d-real-model-e2e.html',
    query: { bundle: basename(bundleDirectory), data: basename(scratch) },
    timeoutMs: 180_000,
  });
  assert.equal(browser.hyaHash, sha256(expectedHya));
  assert.equal(browser.ready.drawableCount, capture.frames[0]?.drawables.length ?? 0);
  assert.ok(browser.ready.visualCount > 0);
  assert.equal(browser.closed.activeObjectUrls, 0);
  assert.equal(browser.closed.pendingAssetJobs, 0);
  assert.equal(browser.forbiddenNetworkCount, 0);
  assert.equal(browser.objectUrlsCreated, browser.objectUrlsRevoked);
  console.log(`[g08-real-model] model=${basename(modelRoot)}; frames=${capture.frames.length}; drawables=${browser.ready.drawableCount}; hya=${expectedHya.byteLength}B/${sha256(expectedHya)}; hydm=${expectedHydm.byteLength}B/${sha256(expectedHydm)}; stable=${stableId}; CLI=${cli.stdout.trim()}; browserURLs=${browser.objectUrlsCreated}/${browser.objectUrlsRevoked}; closure=${browser.forbiddenNetworkCount}`);
} finally {
  await Promise.all([
    rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
    rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  ]);
}

function createConverter(capture, captureRoot, version, sourceVersion) {
  return Object.freeze({
    id: 'packed-cubism-capture-adapter', version: '1.0.0',
    async inspect(request) {
      const model = JSON.parse(new TextDecoder().decode(request.files.find(file => file.path === request.entry).bytes));
      const references = model.FileReferences ?? {};
      const paths = new Set(request.files.map(file => file.path));
      const dependencies = [
        [request.entry, 'model'], [references.Moc, 'model'], ...(references.Textures ?? []).map(path => [path, 'texture']),
        [references.Physics, 'physics'], [references.Pose, 'pose'], [references.DisplayInfo, 'metadata'],
        ...Object.values(references.Motions ?? {}).flat().map(item => [item.File, 'motion']),
        ...Object.values(references.Expressions ?? {}).map(item => [item.File, 'expression']),
      ].filter(([path]) => typeof path === 'string').map(([path, kind]) => ({ path, kind, status: paths.has(path) ? 'available' : 'missing' }));
      return {
        modelName: basename(request.entry, '.model3.json'), core: { available: true, version },
        motions: Object.entries(references.Motions ?? {}).flatMap(([group, items]) => items.map((_item, index) => `${group}:${index}`)),
        expressions: Object.keys(references.Expressions ?? {}), physicsAvailable: Boolean(references.Physics), poseAvailable: Boolean(references.Pose),
        dependencies, diagnostics: [],
      };
    },
    async convert(_request, context) {
      context.progress(0, capture.frames.length, 'bake');
      const result = convertCubismCaptureToHya(capture, { dataUri: 'model.hydm', strict: false });
      const sidecars = [{ path: 'model.hydm', bytes: new Uint8Array(result.data), mimeType: 'application/vnd.haiyue.deformable-mesh-2d' }];
      for (const texture of capture.textures) {
        assertSafeRelativePath(texture.uri, 'capture texture');
        sidecars.push({ path: texture.uri, bytes: new Uint8Array(await readFile(resolve(captureRoot, texture.uri))), mimeType: mimeType(texture.uri) });
      }
      context.progress(capture.frames.length, capture.frames.length, 'bake');
      return {
        hya: new Uint8Array(encodeAnimationBinary(result.document, { extensions: createDeformableMesh2DFormatRegistry() })),
        sidecars, diagnostics: result.diagnostics, sourceVersion, evaluatorVersion: `Cubism Core ${version}`,
      };
    },
  });
}

function createExactBytePreview() {
  return {
    active: false,
    lastHyaSha256: null,
    async replace(asset, signal) { if (signal?.aborted) throw signal.reason; assert.equal(asset.preview.source, 'binary'); this.lastHyaSha256 = sha256(asset.hya); this.active = true; },
    clear() { this.active = false; },
    close() { this.active = false; },
  };
}

async function collectFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(Object.freeze({ path: toUri(relative(root, absolute)), bytes: new Uint8Array(await readFile(absolute)) }));
    }
  }
  await visit(root);
  return Object.freeze(output);
}
function findSingleModelEntry(files) { const entries = files.filter(file => file.path.toLowerCase().endsWith('.model3.json')); assert.equal(entries.length, 1, `Expected one model3.json, found ${entries.length}.`); return entries[0].path; }
function sidecar(asset, path) { const value = asset.sidecars.find(item => item.path === path); assert.ok(value, `Missing sidecar ${path}.`); return value; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function mimeType(path) { const extension = extname(path).toLowerCase(); return extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.avif' ? 'image/avif' : 'image/jpeg'; }
function assertSafeRelativePath(value, label) { assert.equal(typeof value, 'string', `${label} is not a string.`); assert.ok(value && !isAbsolute(value) && !/^[a-z][a-z\d+.-]*:/iu.test(value) && !value.replaceAll('\\', '/').split('/').includes('..'), `${label} is not a safe relative path: ${value}`); }
function toUri(value) { return value.split(sep).join('/'); }
function valueAfter(flag) { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; }
function requiredValue(flag) { const value = valueAfter(flag); if (!value) throw new Error(`Missing ${flag} <value>.`); return value; }
function optionalValue(flag) { return valueAfter(flag); }
function requiredPath(flag) { return resolve(requiredValue(flag)); }
