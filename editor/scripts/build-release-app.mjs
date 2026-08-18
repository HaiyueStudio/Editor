import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..');
const outputRoot = resolve(repositoryRoot, 'artifacts/release/apps/scene-editor');
const distRoot = resolve(packageRoot, 'dist');
const reportPath = resolve(distRoot, 'bundle-report.json');

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
copyFile('index.html');
copyTree(resolve(packageRoot, 'assets'), resolve(outputRoot, 'assets'));
copyJavaScriptTree(distRoot, resolve(outputRoot, 'dist'));

const html = readFileSync(resolve(outputRoot, 'index.html'), 'utf8');
const bundleReport = JSON.parse(readFileSync(reportPath, 'utf8'));
const errors = [];
for (const reference of [
  './assets/branding/haiyue-favicon.png',
  './assets/branding/haiyue-logo-128.png',
  './dist/editor.js',
]) {
  if (!html.includes(reference)) errors.push(`Scene Editor HTML is missing relative reference ${reference}`);
}
for (const worker of ['dist/export-worker.js', 'dist/material-graph-worker.js']) {
  if (!existsInManifest(worker)) errors.push(`Scene Editor release artifact is missing ${worker}`);
}
if ((bundleReport.violations ?? []).length > 0) {
  errors.push(`Scene Editor bundle report has violations: ${bundleReport.violations.join('; ')}`);
}
if (!Number.isFinite(bundleReport.totals?.startupClosureGzipBytes)) {
  errors.push('Scene Editor bundle report is missing startup closure gzip bytes');
}
if (bundleReport.totals?.totalGzipBytes > bundleReport.budget?.maxTotalGzipBytes) {
  errors.push('Scene Editor total JavaScript gzip exceeds its existing bundle budget');
}

const manifest = createManifest({
  id: 'scene-editor',
  entry: 'index.html',
  workers: ['dist/export-worker.js', 'dist/material-graph-worker.js'],
  startupClosureGzipBytes: bundleReport.totals?.startupClosureGzipBytes,
  startupClosureBudgetBytes: bundleReport.budget?.maxStartupClosureGzipBytes,
  capabilityMeasurements: Object.fromEntries(Object.entries(bundleReport.capabilities ?? {}).map(([id, value]) => [id, {
    staticClosureGzipBytes: value.staticClosureGzipBytes,
    incrementalGzipBytes: value.incrementalGzipBytes,
  }])),
  errors,
});
writeFileSync(resolve(outputRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
if (errors.length > 0) throw new Error(errors.join('\n'));
console.log(`[scene-editor-release] ${manifest.files.length} files, ${manifest.rawBytes}B raw, ${manifest.gzipBytes}B gzip, ${manifest.contentSha256.slice(0, 12)}.`);

function copyFile(path) {
  const destination = resolve(outputRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(packageRoot, path), destination);
}

function copyTree(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isDirectory()) copyTree(sourcePath, destinationPath);
    else if (entry.isFile()) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

function copyJavaScriptTree(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isDirectory()) copyJavaScriptTree(sourcePath, destinationPath);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

function existsInManifest(path) {
  try { return statSync(resolve(outputRoot, path)).isFile(); } catch { return false; }
}

function createManifest(extra) {
  const files = listFiles(outputRoot);
  const hash = createHash('sha256');
  let rawBytes = 0;
  let gzipBytes = 0;
  const entries = files.map(path => {
    const contents = readFileSync(resolve(outputRoot, path));
    const sha256 = createHash('sha256').update(contents).digest('hex');
    const gzipBytesForFile = gzipSync(contents, { level: 9 }).byteLength;
    hash.update(path);
    hash.update(contents);
    rawBytes += contents.byteLength;
    gzipBytes += gzipBytesForFile;
    return { path, bytes: contents.byteLength, gzipBytes: gzipBytesForFile, sha256 };
  });
  return { schemaVersion: 1, ...extra, rawBytes, gzipBytes, contentSha256: hash.digest('hex'), files: entries };
}

function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(resolve(directory, entry.name), path));
    else if (entry.isFile() && path !== 'release-manifest.json') files.push(path);
  }
  return files.sort();
}
