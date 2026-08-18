import { createHash } from 'node:crypto';
import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(packageRoot, 'app-dist');
const electronOutputRoot = join(packageRoot, 'electron', 'app-dist');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(outputRoot, 'pwa'), { recursive: true });
await copyProductionDist(join(packageRoot, 'dist'), join(outputRoot, 'dist'));
await Promise.all([
  cp(join(packageRoot, 'index.html'), join(outputRoot, 'index.html')),
  cp(join(packageRoot, 'styles.css'), join(outputRoot, 'styles.css')),
  cp(join(packageRoot, 'manifest.webmanifest'), join(outputRoot, 'manifest.webmanifest')),
  cp(join(packageRoot, 'pwa', 'register.js'), join(outputRoot, 'pwa', 'register.js')),
  cp(join(packageRoot, 'pwa', 'icons'), join(outputRoot, 'pwa', 'icons'), { recursive: true }),
]);

const precacheFiles = (await walkFiles(outputRoot))
  .filter(path => !path.endsWith('.map') && !path.endsWith('service-worker.js'))
  .sort();
const hash = createHash('sha256');
for (const path of precacheFiles) {
  hash.update(relative(outputRoot, path));
  hash.update(await readFile(path));
}
const buildHash = hash.digest('hex').slice(0, 16);
const precacheUrls = ['./', ...precacheFiles.map(path => `./${toUrlPath(relative(outputRoot, path))}`)];
const template = await readFile(join(packageRoot, 'pwa', 'service-worker.template.js'), 'utf8');
const serviceWorker = template
  .replaceAll('__BUILD_HASH__', buildHash)
  .replace('__PRECACHE_MANIFEST__', JSON.stringify(precacheUrls, null, 2));
await writeFile(join(outputRoot, 'service-worker.js'), serviceWorker);
await rm(electronOutputRoot, { recursive: true, force: true });
await cp(outputRoot, electronOutputRoot, { recursive: true });

console.log(`Voxel Editor app assembled at ${relative(packageRoot, outputRoot)} (${precacheFiles.length} precached files, ${buildHash}).`);

async function walkFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function toUrlPath(path) {
  return sep === '/' ? path : path.split(sep).join('/');
}

async function copyProductionDist(sourceRoot, destinationRoot) {
  for (const source of await walkFiles(sourceRoot)) {
    if (source.endsWith('.map')) continue;
    const destination = join(destinationRoot, relative(sourceRoot, source));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}
