import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..');
const sourceRoot = resolve(packageRoot, 'app-dist');
const electronRendererRoot = resolve(packageRoot, 'electron/app-dist');
const electronOutputRoot = process.env.VOXEL_ELECTRON_OUTPUT_ROOT
  ? resolve(process.env.VOXEL_ELECTRON_OUTPUT_ROOT)
  : resolve(packageRoot, 'release-electron');
const outputRoot = resolve(repositoryRoot, 'artifacts/release/apps/voxel-pwa');
const requireElectron = process.argv.includes('--require-electron');
for (const argument of process.argv.slice(2)) {
  if (argument !== '--require-electron') throw new Error(`Unknown Voxel release verification argument "${argument}".`);
}
const budget = Object.freeze({
  maxJavaScriptBytes: 3_500_000,
  maxJavaScriptGzipBytes: 650_000,
  maxPwaBytes: 4_000_000,
});
const errors = [];

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(dirname(outputRoot), { recursive: true });
cpSync(sourceRoot, outputRoot, { recursive: true });
const files = listFiles(outputRoot);
if (files.some(path => path.endsWith('.map'))) errors.push('Voxel PWA contains source maps');
for (const path of [
  'index.html',
  'manifest.webmanifest',
  'service-worker.js',
  'pwa/register.js',
  'dist/main.js',
  'dist/export-worker.js',
  'dist/project-import-worker.js',
]) {
  if (!files.includes(path)) errors.push(`Voxel PWA is missing ${path}`);
}
const manifestJson = JSON.parse(readFileSync(resolve(outputRoot, 'manifest.webmanifest'), 'utf8'));
if (manifestJson.start_url !== './' || manifestJson.scope !== './') {
  errors.push('Voxel PWA manifest start_url and scope must remain base-path relative');
}
const serviceWorker = readFileSync(resolve(outputRoot, 'service-worker.js'), 'utf8');
for (const path of ['./dist/main.js', './dist/export-worker.js', './dist/project-import-worker.js']) {
  if (!serviceWorker.includes(path)) errors.push(`Voxel service worker does not precache ${path}`);
}
if (/__BUILD_HASH__|__PRECACHE_MANIFEST__/.test(serviceWorker)) errors.push('Voxel service worker still contains template tokens');

const jsFiles = files.filter(path => path.endsWith('.js'));
const javaScriptBytes = jsFiles.reduce((total, path) => total + statSync(resolve(outputRoot, path)).size, 0);
const javaScriptGzipBytes = jsFiles.reduce((total, path) => total + gzipFile(resolve(outputRoot, path)), 0);
const pwaBytes = files.reduce((total, path) => total + statSync(resolve(outputRoot, path)).size, 0);
checkBudget('JavaScript raw', javaScriptBytes, budget.maxJavaScriptBytes);
checkBudget('JavaScript gzip', javaScriptGzipBytes, budget.maxJavaScriptGzipBytes);
checkBudget('PWA raw', pwaBytes, budget.maxPwaBytes);

const pwaContentSha256 = hashTree(outputRoot);
const electronRendererSha256 = hashTree(electronRendererRoot);
if (pwaContentSha256 !== electronRendererSha256) {
  errors.push('Voxel Electron renderer is not byte-identical to the validated PWA renderer');
}
const asarFiles = directoryExists(electronOutputRoot)
  ? listAbsoluteFiles(electronOutputRoot).filter(path => basename(path) === 'app.asar')
  : [];
if (requireElectron && asarFiles.length === 0) errors.push('Voxel Electron unpacked application is missing app.asar');
for (const path of asarFiles) {
  if (statSync(path).size < 100_000) errors.push(`Voxel Electron app.asar is unexpectedly small: ${relative(packageRoot, path)}`);
}

const releaseManifest = {
  schemaVersion: 1,
  id: 'voxel-pwa-electron',
  entry: 'index.html',
  workers: ['dist/export-worker.js', 'dist/project-import-worker.js', 'service-worker.js'],
  budget,
  javaScriptBytes,
  javaScriptGzipBytes,
  pwaBytes,
  pwaContentSha256,
  electronRendererSha256,
  electron: {
    required: requireElectron,
    platform: process.platform,
    architecture: process.arch,
    appAsar: asarFiles.map(path => ({
      path: relative(electronOutputRoot, path).replaceAll('\\', '/'),
      bytes: statSync(path).size,
      sha256: sha256File(path),
    })),
  },
  files: files.map(path => ({
    path,
    bytes: statSync(resolve(outputRoot, path)).size,
    sha256: sha256File(resolve(outputRoot, path)),
  })),
  errors,
};
writeFileSync(resolve(outputRoot, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`);
if (errors.length > 0) throw new Error(errors.join('\n'));
console.log(
  `[voxel-release] ${files.length} PWA files, ${javaScriptGzipBytes}B JS gzip, `
  + `${asarFiles.length} Electron asar, ${pwaContentSha256.slice(0, 12)}.`,
);

function checkBudget(label, actual, maximum) {
  if (actual > maximum) errors.push(`Voxel ${label} ${actual}B exceeds ${maximum}B`);
}

function hashTree(directory) {
  const hash = createHash('sha256');
  for (const path of listFiles(directory)) {
    if (path === 'release-manifest.json') continue;
    hash.update(path);
    hash.update(readFileSync(resolve(directory, path)));
  }
  return hash.digest('hex');
}

function gzipFile(path) {
  return gzipSync(readFileSync(path), { level: 9 }).byteLength;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function directoryExists(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(resolve(directory, entry.name), path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function listAbsoluteFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...listAbsoluteFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
