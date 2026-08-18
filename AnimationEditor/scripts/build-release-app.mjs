import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..');
const outputRoot = resolve(repositoryRoot, 'artifacts/release/apps/animation-editor');
const distRoot = resolve(packageRoot, 'dist');
const budget = Object.freeze({
  maxMainStartupClosureGzipBytes: 900_000,
  maxNative3dStartupClosureGzipBytes: 800_000,
  maxCapabilityChunkGzipBytes: 700_000,
  maxTotalJavaScriptGzipBytes: 980_000,
  maxTotalJavaScriptBytes: 5_600_000,
});
const errors = [];

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
for (const file of ['index.html', 'styles.css', 'CAPABILITY_MATRIX.md', 'native3d.html', 'native3d.css']) {
  copyFile(file);
}
copyJavaScriptTree(distRoot, resolve(outputRoot, 'dist'));

const html = readFileSync(resolve(outputRoot, 'index.html'), 'utf8');
for (const reference of ['./styles.css', './dist/main.js', './CAPABILITY_MATRIX.md']) {
  if (!html.includes(reference)) errors.push(`AnimationEditor HTML is missing relative reference ${reference}`);
}
const nativeHtml = readFileSync(resolve(outputRoot, 'native3d.html'), 'utf8');
for (const reference of ['./native3d.css', './dist/native3d.js']) {
  if (!nativeHtml.includes(reference)) errors.push(`AnimationEditor native3d HTML is missing relative reference ${reference}`);
}

const mainClosure = staticClosure('dist/main.js');
const native3dClosure = staticClosure('dist/native3d.js');
const capabilityChunks = listFiles(resolve(outputRoot, 'dist'))
  .filter(path => /^chunks\/DesignerTaskCoordinator-[\w-]+\.js$/.test(path))
  .map(path => `dist/${path}`);
if (capabilityChunks.length !== 1) {
  errors.push(`AnimationEditor expected one hashed capability chunk, found ${capabilityChunks.length}`);
}
const capabilityGzipBytes = capabilityChunks.reduce((total, path) => total + gzipFile(resolve(outputRoot, path)), 0);
const javaScript = listFiles(resolve(outputRoot, 'dist')).filter(path => path.endsWith('.js'));
const totalJavaScriptBytes = javaScript.reduce((total, path) => total + statSync(resolve(outputRoot, 'dist', path)).size, 0);
const totalJavaScriptGzipBytes = javaScript.reduce((total, path) => total + gzipFile(resolve(outputRoot, 'dist', path)), 0);
checkBudget('main startup closure gzip', mainClosure.gzipBytes, budget.maxMainStartupClosureGzipBytes);
checkBudget('native3d startup closure gzip', native3dClosure.gzipBytes, budget.maxNative3dStartupClosureGzipBytes);
checkBudget('capability chunk gzip', capabilityGzipBytes, budget.maxCapabilityChunkGzipBytes);
checkBudget('total JavaScript gzip', totalJavaScriptGzipBytes, budget.maxTotalJavaScriptGzipBytes);
checkBudget('total JavaScript raw', totalJavaScriptBytes, budget.maxTotalJavaScriptBytes);

const manifest = createManifest({
  id: 'animation-editor',
  entries: ['index.html', 'native3d.html'],
  workers: [],
  budget,
  mainStartupClosure: mainClosure,
  native3dStartupClosure: native3dClosure,
  capabilityChunks,
  capabilityGzipBytes,
  totalJavaScriptBytes,
  totalJavaScriptGzipBytes,
  errors,
});
writeFileSync(resolve(outputRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
if (errors.length > 0) throw new Error(errors.join('\n'));
console.log(
  `[animation-editor-release] ${manifest.files.length} files, startup=${mainClosure.gzipBytes}B gzip, `
  + `capability=${capabilityGzipBytes}B gzip, ${manifest.contentSha256.slice(0, 12)}.`,
);

function staticClosure(entry) {
  const seen = new Set();
  const visit = path => {
    if (seen.has(path)) return;
    seen.add(path);
    const code = readFileSync(resolve(outputRoot, path), 'utf8');
    const pattern = /(?:^|\n)import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of code.matchAll(pattern)) {
      if (!match[1].startsWith('.')) continue;
      const target = relative(outputRoot, resolve(dirname(resolve(outputRoot, path)), match[1])).replaceAll('\\', '/');
      visit(target);
    }
  };
  visit(entry);
  const files = [...seen].sort();
  return {
    files,
    rawBytes: files.reduce((total, path) => total + statSync(resolve(outputRoot, path)).size, 0),
    gzipBytes: files.reduce((total, path) => total + gzipFile(resolve(outputRoot, path)), 0),
  };
}

function checkBudget(label, actual, maximum) {
  if (actual > maximum) errors.push(`AnimationEditor ${label} ${actual}B exceeds ${maximum}B`);
}

function copyFile(path) {
  const destination = resolve(outputRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(packageRoot, path), destination);
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

function gzipFile(path) {
  return gzipSync(readFileSync(path), { level: 9 }).byteLength;
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
