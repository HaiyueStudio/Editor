import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

export async function loadEditorAppDescriptor(path) {
  const descriptor = JSON.parse(await readFile(path, 'utf8'));
  const errors = validateDescriptor(descriptor);
  if (errors.length > 0) throw new TypeError(`Invalid Editor app descriptor:\n- ${errors.join('\n- ')}`);
  return Object.freeze(descriptor);
}

export async function assembleEditorApp({ descriptorPath, packageRoot = dirname(resolve(descriptorPath)) }) {
  const root = resolve(packageRoot);
  const descriptor = await loadEditorAppDescriptor(resolve(descriptorPath));
  const outputRoot = resolveInside(root, descriptor.outputDirectory);
  const distRoot = resolveInside(root, descriptor.distDirectory);
  const destinationDist = resolveInside(outputRoot, descriptor.distDirectory);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const path of new Set([...descriptor.entries, ...descriptor.staticFiles])) {
    const source = resolveInside(root, path);
    const destination = resolveInside(outputRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
  await copyProductionTree(distRoot, destinationDist);

  if (descriptor.pwa.enabled) {
    await writePwaFiles(outputRoot, descriptor);
    for (const entry of descriptor.entries) await injectPwaMarkup(resolveInside(outputRoot, entry));
  }

  let files = await listRelativeFiles(outputRoot);
  for (const required of [...descriptor.entries, ...descriptor.workers]) {
    if (!files.includes(toUrlPath(required))) throw new Error(`${descriptor.id} artifact is missing ${required}.`);
  }
  if (files.some(path => forbiddenArtifact(path))) throw new Error(`${descriptor.id} artifact contains source, test, or source-map files.`);

  const precache = files.filter(path => path !== 'service-worker.js' && path !== 'app-manifest.json');
  const buildHash = await hashFiles(outputRoot, precache);
  if (descriptor.pwa.enabled) {
    await writeFile(resolveInside(outputRoot, 'service-worker.js'), serviceWorkerSource(descriptor.storageNamespace, buildHash, precache));
  }
  files = await listRelativeFiles(outputRoot);
  const measurements = await measureFiles(outputRoot, files.filter(path => path !== 'app-manifest.json'));
  const errors = [];
  if (measurements.rawBytes > descriptor.budget.maxRawBytes) {
    errors.push(`raw bytes ${measurements.rawBytes} exceed ${descriptor.budget.maxRawBytes}`);
  }
  if (measurements.gzipBytes > descriptor.budget.maxGzipBytes) {
    errors.push(`gzip bytes ${measurements.gzipBytes} exceed ${descriptor.budget.maxGzipBytes}`);
  }
  const manifest = {
    schemaVersion: 1,
    descriptor: { id: descriptor.id, version: descriptor.version, supportTier: descriptor.supportTier },
    entries: descriptor.entries,
    workers: descriptor.workers,
    buildHash,
    rawBytes: measurements.rawBytes,
    gzipBytes: measurements.gzipBytes,
    files: measurements.files,
    errors,
  };
  await writeFile(resolveInside(outputRoot, 'app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (errors.length > 0) throw new Error(`${descriptor.id} app budget failed:\n- ${errors.join('\n- ')}`);

  let electronRendererHash = null;
  if (descriptor.electron.enabled) {
    const rendererRoot = resolveInside(root, descriptor.electronRendererDirectory);
    await rm(rendererRoot, { recursive: true, force: true });
    await mkdir(dirname(rendererRoot), { recursive: true });
    await cp(outputRoot, rendererRoot, { recursive: true });
    await writeElectronFiles(root, descriptor);
    const [webHash, rendererHash] = await Promise.all([hashTree(outputRoot), hashTree(rendererRoot)]);
    if (webHash !== rendererHash) throw new Error(`${descriptor.id} Electron renderer is not byte-identical to its PWA tree.`);
    electronRendererHash = rendererHash;
  }

  return Object.freeze({ ...manifest, electronRendererHash, outputRoot });
}

export async function validateAssembledEditorApp({ descriptorPath, packageRoot = dirname(resolve(descriptorPath)) }) {
  const root = resolve(packageRoot);
  const descriptor = await loadEditorAppDescriptor(resolve(descriptorPath));
  const outputRoot = resolveInside(root, descriptor.outputDirectory);
  const manifest = JSON.parse(await readFile(resolveInside(outputRoot, 'app-manifest.json'), 'utf8'));
  const files = await listRelativeFiles(outputRoot);
  const actualHash = await hashFiles(outputRoot, files.filter(path => !['app-manifest.json', 'service-worker.js'].includes(path)));
  if (actualHash !== manifest.buildHash) throw new Error(`${descriptor.id} assembled content hash is stale.`);
  if (manifest.errors?.length) throw new Error(`${descriptor.id} app manifest contains errors.`);
  if (descriptor.pwa.enabled) {
    const webmanifest = JSON.parse(await readFile(resolveInside(outputRoot, 'manifest.webmanifest'), 'utf8'));
    if (webmanifest.start_url !== './' || webmanifest.scope !== './') throw new Error(`${descriptor.id} PWA URLs are not base-relative.`);
  }
  if (descriptor.electron.enabled) {
    const rendererRoot = resolveInside(root, descriptor.electronRendererDirectory);
    if (await hashTree(outputRoot) !== await hashTree(rendererRoot)) {
      throw new Error(`${descriptor.id} Electron renderer differs from the PWA tree.`);
    }
    const main = await readFile(resolveInside(root, 'electron/main.mjs'), 'utf8');
    for (const policy of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true']) {
      if (!main.includes(policy)) throw new Error(`${descriptor.id} Electron bootstrap is missing ${policy}.`);
    }
  }
  return Object.freeze({ descriptor, manifest, files: Object.freeze(files) });
}

export async function previewEditorApp({
  descriptorPath,
  packageRoot = dirname(resolve(descriptorPath)),
  port = 4174,
  basePath = '/',
}) {
  const descriptor = await loadEditorAppDescriptor(resolve(descriptorPath));
  const root = resolveInside(resolve(packageRoot), descriptor.outputDirectory);
  const mount = normalizeBasePath(basePath);
  const types = new Map([
    ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ]);
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      const pathname = decodeURIComponent(requestUrl.pathname);
      if (mount !== '/' && pathname === mount.slice(0, -1)) {
        response.writeHead(308, { Location: mount }).end();
        return;
      }
      if (!pathname.startsWith(mount)) throw new Error('Outside preview mount.');
      const relativePath = pathname.slice(mount.length);
      const requested = resolveInside(root, relativePath === '' ? 'index.html' : relativePath);
      const info = await stat(requested);
      if (!info.isFile()) throw new Error('Not a file.');
      response.writeHead(200, {
        'Cache-Control': pathname === '/service-worker.js' ? 'no-cache' : 'no-store',
        'Content-Type': types.get(extname(requested)) ?? 'application/octet-stream',
      });
      if (request.method === 'HEAD') response.end(); else createReadStream(requested).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  return server;
}

async function writePwaFiles(outputRoot, descriptor) {
  const manifest = {
    id: './',
    name: descriptor.productName,
    short_name: descriptor.pwa.shortName,
    description: descriptor.pwa.description,
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: descriptor.pwa.backgroundColor,
    theme_color: descriptor.pwa.themeColor,
    icons: descriptor.pwa.icons ?? [],
  };
  await writeFile(resolveInside(outputRoot, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(resolveInside(outputRoot, 'pwa'), { recursive: true });
  await writeFile(resolveInside(outputRoot, 'pwa/register.js'), `if ('serviceWorker' in navigator) {\n  addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js', { scope: './' }));\n}\n`);
}

async function injectPwaMarkup(path) {
  let html = await readFile(path, 'utf8');
  if (!html.includes('manifest.webmanifest')) html = html.replace(/<\/head>/i, '  <link rel="manifest" href="./manifest.webmanifest">\n</head>');
  if (!html.includes('pwa/register.js')) html = html.replace(/<\/body>/i, '  <script type="module" src="./pwa/register.js"></script>\n</body>');
  await writeFile(path, html);
}

async function writeElectronFiles(root, descriptor) {
  const electronRoot = resolveInside(root, 'electron');
  await mkdir(electronRoot, { recursive: true });
  const rendererRelative = relative(electronRoot, resolveInside(root, descriptor.electronRendererDirectory)).replaceAll('\\', '/');
  const entry = `${rendererRelative}/${descriptor.entries[0]}`;
  const e = descriptor.electron;
  const main = `import { app, BrowserWindow, Menu, shell } from 'electron';\nimport { join } from 'node:path';\nimport { pathToFileURL } from 'node:url';\nconst smoke = process.env.HAIYUE_ELECTRON_SMOKE === '1';\nlet mainWindow = null;\nlet smokeTimer = null;\nfunction finishSmoke(code, message) {\n  if (!smoke) return;\n  if (smokeTimer) clearTimeout(smokeTimer);\n  console.log(message);\n  app.exit(code);\n}\nfunction createWindow() {\n  if (mainWindow && !mainWindow.isDestroyed()) { if (!smoke) { mainWindow.show(); mainWindow.focus(); } return mainWindow; }\n  const window = new BrowserWindow({ width: ${e.width}, height: ${e.height}, minWidth: ${e.minWidth}, minHeight: ${e.minHeight}, show: false, backgroundColor: ${JSON.stringify(e.backgroundColor)}, title: ${JSON.stringify(descriptor.productName)}, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });\n  mainWindow = window;\n  const entry = join(import.meta.dirname, ${JSON.stringify(entry)});\n  const entryUrl = pathToFileURL(entry).href;\n  window.once('ready-to-show', () => { if (!smoke) { window.show(); window.focus(); } });\n  if (smoke) {\n    smokeTimer = setTimeout(() => finishSmoke(2, '[editor-app-kit] Electron smoke timed out.'), 30000);\n    window.webContents.once('did-finish-load', () => finishSmoke(0, '[editor-app-kit] Electron renderer loaded.'));\n    window.webContents.once('did-fail-load', (_event, code, description) => finishSmoke(1, \`[editor-app-kit] Electron renderer failed: \${code} \${description}\`));\n  }\n  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });\n  window.webContents.on('will-navigate', (event, url) => { if (url !== entryUrl) event.preventDefault(); });\n  window.once('closed', () => { if (mainWindow === window) mainWindow = null; });\n  void window.loadFile(entry);\n  return window;\n}\nconst lock = app.requestSingleInstanceLock();\nif (!lock) app.quit(); else { app.on('second-instance', createWindow); void app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); }); }\napp.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });\napp.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });\n`;
  await writeFile(resolveInside(electronRoot, 'main.mjs'), main);
  const packageJson = {
    name: descriptor.id,
    version: descriptor.version,
    description: descriptor.pwa.description,
    author: 'HaiyueStudio',
    private: true,
    type: 'module',
    main: 'main.mjs',
  };
  await writeFile(resolveInside(electronRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  const builder = {
    appId: descriptor.appId,
    productName: descriptor.productName,
    artifactName: descriptor.artifactName,
    npmRebuild: false,
    asar: true,
    directories: { app: 'electron', output: 'release-electron' },
    files: ['app-dist/**/*', 'main.mjs', 'package.json', '!node_modules{,/**/*}'],
    win: { target: ['nsis', 'portable'] },
  };
  await writeFile(resolveInside(root, 'electron-builder.generated.json'), `${JSON.stringify(builder, null, 2)}\n`);
}

function serviceWorkerSource(namespace, hash, paths) {
  const urls = ['./', ...paths.map(path => `./${path}`)];
  return `const CACHE = ${JSON.stringify(`${namespace}-${hash}`)};\nconst FILES = ${JSON.stringify(urls, null, 2)};\nself.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));\nself.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));\nself.addEventListener('fetch', event => { if (event.request.method === 'GET') event.respondWith(caches.match(event.request).then(hit => hit ?? fetch(event.request))); });\n`;
}

async function copyProductionTree(sourceRoot, destinationRoot) {
  for (const path of await listAbsoluteFiles(sourceRoot)) {
    const rel = relative(sourceRoot, path);
    if (forbiddenArtifact(toUrlPath(rel))) continue;
    const destination = resolveInside(destinationRoot, rel);
    await mkdir(dirname(destination), { recursive: true });
    await cp(path, destination);
  }
}

function forbiddenArtifact(path) {
  return path.endsWith('.map') || path.endsWith('.ts') || path === 'bundle-report.json'
    || path === 'bundle-report.md' || path.endsWith('/bundle-report.json')
    || path.endsWith('/bundle-report.md') || path.includes('/test/') || path.includes('/src/')
    || path.includes('rollup') || path.includes('tsconfig');
}

async function listAbsoluteFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listAbsoluteFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function listRelativeFiles(root) {
  return (await listAbsoluteFiles(root)).map(path => toUrlPath(relative(root, path))).sort();
}

async function hashFiles(root, files) {
  const hash = createHash('sha256');
  for (const path of [...files].sort()) { hash.update(path); hash.update(await readFile(resolveInside(root, path))); }
  return hash.digest('hex');
}

async function hashTree(root) { return hashFiles(root, await listRelativeFiles(root)); }

async function measureFiles(root, files) {
  let rawBytes = 0;
  let gzipBytes = 0;
  const entries = [];
  for (const path of files) {
    const content = await readFile(resolveInside(root, path));
    const gz = gzipSync(content, { level: 9 }).byteLength;
    rawBytes += content.byteLength;
    gzipBytes += gz;
    entries.push(Object.freeze({ path, bytes: content.byteLength, gzipBytes: gz, sha256: createHash('sha256').update(content).digest('hex') }));
  }
  return Object.freeze({ rawBytes, gzipBytes, files: Object.freeze(entries) });
}

function resolveInside(root, path) {
  const base = resolve(root);
  const target = resolve(base, path);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error(`Path escapes app root: ${path}`);
  return target;
}

function toUrlPath(path) { return path.replaceAll('\\', '/'); }

function validateDescriptor(descriptor) {
  const errors = [];
  if (descriptor?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  for (const key of ['id', 'version', 'productName', 'appId', 'artifactName', 'storageNamespace']) {
    if (typeof descriptor?.[key] !== 'string' || !descriptor[key].trim()) errors.push(`${key} is required`);
  }
  if (!['stable', 'extended', 'experimental'].includes(descriptor?.supportTier)) errors.push('supportTier is invalid');
  for (const key of ['entries', 'staticFiles', 'workers']) if (!Array.isArray(descriptor?.[key])) errors.push(`${key} must be an array`);
  for (const path of [...(descriptor?.entries ?? []), ...(descriptor?.staticFiles ?? []), ...(descriptor?.workers ?? [])]) {
    if (!safePath(path)) errors.push(`unsafe descriptor path: ${path}`);
  }
  for (const key of ['distDirectory', 'outputDirectory', 'electronRendererDirectory']) if (!safePath(descriptor?.[key])) errors.push(`${key} must be a safe relative path`);
  if (!descriptor?.budget || !(descriptor.budget.maxRawBytes > 0) || !(descriptor.budget.maxGzipBytes > 0)) errors.push('budget is invalid');
  if (!descriptor?.pwa || typeof descriptor.pwa.enabled !== 'boolean') errors.push('pwa descriptor is required');
  if (!descriptor?.electron || typeof descriptor.electron.enabled !== 'boolean') errors.push('electron descriptor is required');
  return errors;
}

function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.startsWith('\\')
    && !/^[a-z]:/i.test(path) && !path.split(/[\\/]/).includes('..');
}

function normalizeBasePath(value) {
  const segments = String(value ?? '/').replaceAll('\\', '/').split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..')) throw new Error(`Unsafe preview base path: ${value}`);
  return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
}
