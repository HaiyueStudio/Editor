import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { cpus, platform, arch, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { writePsdUint8Array } from 'ag-psd';
import { inspectPsd, composite, exportEditedPsd, imageResourceIds } from '../dist/psdPrototype.js';
import { syntheticDocument, applyEdit } from '../test/synthetic.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = resolve(root, '..');
const output = resolve(root, 'artifacts/p0');
const fixtureDir = resolve(root, 'test/fixtures');
const manifest = JSON.parse(readFileSync(resolve(fixtureDir, 'manifest.json')));
mkdirSync(output, { recursive: true });
const hash = data => createHash('sha256').update(data).digest('hex');
const json = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
const files = [];
function fingerprint(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) fingerprint(path);
    else files.push([relative(repository, path), hash(readFileSync(path))]);
  }
}
for (const directory of ['src', 'scripts', 'test']) fingerprint(resolve(root, directory));
for (const file of ['package.json', 'tsconfig.json']) files.push([`imageEditor/${file}`, hash(readFileSync(resolve(root, file)))]);
for (const file of ['package-lock.json', 'package.json', 'config/architecture-boundaries.json'])
  files.push([file, hash(readFileSync(resolve(repository, file)))]);
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), kind: 'local-p0-diagnostic',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()),
  sourceFingerprint: hash(JSON.stringify(files.sort())), files,
  environment: { node: process.version, platform: platform(), arch: arch(), os: release(), cpu: cpus()[0]?.model, codec: 'ag-psd@31.0.2' },
  photoshop: { status: 'pending', reason: 'No Photoshop execution evidence supplied; automated checks cannot satisfy the Photoshop acceptance gate.' },
  cases: [],
};

function pixels(image) {
  return image ? { width: image.width, height: image.height, sha256: hash(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)) } : null;
}
function layerSnapshot(layer) {
  return {
    name: layer.name ?? '', left: layer.left ?? 0, top: layer.top ?? 0, right: layer.right ?? 0, bottom: layer.bottom ?? 0,
    blendMode: layer.blendMode ?? 'normal', opacity: layer.opacity ?? 1, hidden: layer.hidden ?? false,
    clipping: layer.clipping ?? false, transparencyProtected: layer.transparencyProtected ?? false,
    pixels: pixels(layer.imageData), mask: pixels(layer.mask?.imageData), realMask: pixels(layer.realMask?.imageData),
    children: layer.children?.map(layerSnapshot) ?? null,
  };
}
function difference(actual, expected) {
  if (!expected || actual.width !== expected.width || actual.height !== expected.height) return { status: 'unavailable' };
  let maxError = 0, changedChannels = 0, sum = 0, alphaMaxError = 0, premultipliedMaxError = 0;
  for (let i = 0; i < actual.data.length; i++) {
    const delta = Math.abs(actual.data[i] - expected.data[i]);
    maxError = Math.max(maxError, delta); sum += delta; if (delta) changedChannels++;
    if (i % 4 === 3) alphaMaxError = Math.max(alphaMaxError, delta);
    else {
      const alphaIndex = i - i % 4 + 3;
      premultipliedMaxError = Math.max(premultipliedMaxError,
        Math.abs(actual.data[i] * actual.data[alphaIndex] / 255 - expected.data[i] * expected.data[alphaIndex] / 255));
    }
  }
  return { status: maxError === 0 ? 'exact' : 'different', maxError, alphaMaxError, premultipliedMaxError, changedChannels, meanAbsoluteError: sum / actual.data.length };
}

for (const sample of manifest.samples) {
  const bytes = readFileSync(resolve(fixtureDir, sample.file));
  assert.equal(hash(bytes), sample.sha256, `Fixture hash mismatch: ${sample.id}`);
  const start = performance.now();
  const row = { id: sample.id, source: sample.source, inputSha256: sample.sha256, inputBytes: bytes.length };
  try {
    const inspection = inspectPsd(bytes), document = inspection.document;
    assert.equal(sample.expectedAdmission, 'readable');
    row.readMs = performance.now() - start;
    row.admission = 'readable';
    row.authoringMetadata = document.imageResources?.versionInfo ?? null;
    row.width = document.width; row.height = document.height;
    row.estimatedPixelBytes = inspection.estimatedPixelBytes;
    row.diagnostics = inspection.diagnostics;
    // Laboratory raw codec write, deliberately bypassing the guarded editing exporter.
    // These outputs demonstrate losses; they must not be presented as safe product exports.
    const writeStart = performance.now();
    const encoded = writePsdUint8Array(document, { noBackground: true });
    row.writeMs = performance.now() - writeStart;
    const reopened = inspectPsd(encoded).document;
    assert.deepEqual(reopened.children?.map(layerSnapshot), document.children?.map(layerSnapshot), `${sample.id}: layer contract changed`);
    row.layerAndMaskPixelRoundtrip = 'exact';
    row.cachedCompositeRoundtrip = difference(reopened.imageData, document.imageData);
    row.cachedCompositeRoundtrip.note = 'Copied cache, not a rendering test. Partial-alpha white-matte quantization can change RGB.';
    row.lostResourceIds = inspection.resourceIds.filter(id => !imageResourceIds(encoded).includes(id));
    row.outputSha256 = hash(encoded);
    row.outputBytes = encoded.length;
    writeFileSync(resolve(output, `${sample.id}.codec-roundtrip.psd`), encoded);
    try {
      if (document.imageResources?.versionInfo?.hasRealMergedData === false) {
        row.recomposite = { status: 'unavailable', reason: 'Source declares no real merged image' };
      } else row.recomposite = difference(composite(document), document.imageData);
    } catch (error) { row.recomposite = { status: 'unsupported', reason: error.message }; }
    try { exportEditedPsd(inspection); row.guardedExport = 'admitted-prototype'; }
    catch (error) { row.guardedExport = 'blocked'; row.exportReason = error.code; }
  } catch (error) {
    if (sample.expectedAdmission === 'readable' || error.code !== sample.expectedAdmission) throw error;
    row.admission = 'rejected-as-specified'; row.reason = error.code;
  }
  report.cases.push(row);
}

const source = writePsdUint8Array(syntheticDocument(), { noBackground: true });
writeFileSync(resolve(output, 'synthetic-original.psd'), source);
const inspection = inspectPsd(source);
applyEdit(inspection.document);
const edited = exportEditedPsd(inspection);
writeFileSync(resolve(output, 'synthetic-edited.psd'), edited);
const reopened = inspectPsd(edited).document;
assert.deepEqual(pixels(reopened.imageData), pixels(composite(reopened)));
writeFileSync(resolve(output, 'synthetic-edited.rgba'), reopened.imageData.data);
json(resolve(output, 'synthetic-edited.pixels.json'), { width: reopened.width, height: reopened.height, sha256: pixels(reopened.imageData).sha256 });
report.synthetic = { status: 'passed', sourceSha256: hash(source), editedSha256: hash(edited),
  operations: ['Unicode layer rename', 'pixel edit', 'layer translation', 'layer opacity'],
  regeneratedComposite: 'exact on reread', layerTree: reopened.children.map(layerSnapshot) };

const python = process.env.PSD_P0_PYTHON;
if (python) {
  const result = spawnSync(python, [resolve(root, 'scripts/independent-check.py'), fixtureDir, output], { encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(`Independent decoder failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  report.independent = JSON.parse(readFileSync(resolve(output, 'independent.json')));
} else report.independent = { status: 'unavailable', reason: 'Set PSD_P0_PYTHON to a Python environment with requirements-p0.txt installed' };
report.summary = {
  fixtures: report.cases.length,
  readable: report.cases.filter(c => c.admission === 'readable').length,
  rejectedAsSpecified: report.cases.filter(c => c.admission === 'rejected-as-specified').length,
  exactLayerRoundtrips: report.cases.filter(c => c.layerAndMaskPixelRoundtrip === 'exact').length,
  resourceLossCases: report.cases.filter(c => c.lostResourceIds?.length).length,
  cachedCompositeDriftCases: report.cases.filter(c => c.cachedCompositeRoundtrip?.status === 'different').length,
  exactRecomposites: report.cases.filter(c => c.recomposite?.status === 'exact').length,
  p0Acceptance: 'pending-photoshop',
};
json(resolve(output, 'report.json'), report);
console.log(JSON.stringify({ output, ...report.summary, independent: report.independent.status }, null, 2));
