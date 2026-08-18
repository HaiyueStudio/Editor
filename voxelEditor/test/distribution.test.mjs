import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const packageRoot = new URL('../', import.meta.url);

test('PWA manifest exposes installable icons and a scoped standalone application', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', packageRoot), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0e131b');
  assert.equal(manifest.icons.some(icon => icon.sizes === '192x192'), true);
  assert.equal(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'), true);
  assert.equal(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'), true);
  for (const icon of manifest.icons) {
    const info = await stat(new URL(icon.src, packageRoot));
    assert.equal(info.isFile(), true);
  }
});

test('assembled PWA precaches the complete production shell without source maps', async () => {
  const outputRoot = new URL('app-dist/', packageRoot);
  const worker = await readFile(new URL('service-worker.js', outputRoot), 'utf8');
  const html = await readFile(new URL('index.html', outputRoot), 'utf8');
  assert.doesNotMatch(worker, /__BUILD_HASH__|__PRECACHE_MANIFEST__/);
  assert.match(worker, /\.\/dist\/main\.js/);
  assert.match(worker, /\.\/dist\/export-worker\.js/);
  assert.match(worker, /\.\/dist\/project-import-worker\.js/);
  assert.match(worker, /cache\.addAll\(PRECACHE_URLS\)/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /src="\.\/pwa\/register\.js"/);
  assert.equal((await listFiles(outputRoot)).some(path => path.endsWith('.map')), false);
});

test('Electron entry keeps renderer privileges isolated and packages the shared app output', async () => {
  const main = await readFile(new URL('electron/main.mjs', packageRoot), 'utf8');
  const builder = await readFile(new URL('electron-builder.yml', packageRoot), 'utf8');
  const desktopPackage = JSON.parse(await readFile(new URL('electron/package.json', packageRoot), 'utf8'));
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /let mainWindow = null/);
  assert.match(main, /WINDOW_SHOW_FALLBACK_MS/);
  assert.match(main, /did-finish-load/);
  assert.match(main, /did-fail-load/);
  assert.match(main, /app-dist[\s\S]*index\.html/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(builder, /app-dist\/\*\*\/\*/);
  assert.match(builder, /!node_modules/);
  assert.match(builder, /asar:\s*true/);
  assert.match(builder, /target:[\s\S]*dmg[\s\S]*nsis[\s\S]*AppImage/);
  assert.equal(desktopPackage.main, 'main.mjs');
  assert.equal('dependencies' in desktopPackage, false);
});

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), root);
    if (entry.isDirectory()) files.push(...await listFiles(url));
    else files.push(url.pathname);
  }
  return files;
}
