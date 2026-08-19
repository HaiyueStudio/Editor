import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assembleEditorApp, previewEditorApp, validateAssembledEditorApp } from '../node.mjs';

test('assembler creates deterministic base-relative PWA and byte-identical Electron renderer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haiyue-app-kit-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'index.html'), '<html><head></head><body><script type="module" src="./dist/main.js"></script></body></html>');
    await writeFile(join(root, 'dist/main.js'), 'export const ready = true;\n');
    await writeFile(join(root, 'dist/bundle-report.json'), '{"generatedAt":"changes-each-build"}\n');
    await writeFile(join(root, 'dist/bundle-report.md'), 'Generated: changes-each-build\n');
    await writeFile(join(root, 'app.json'), JSON.stringify({
      schemaVersion: 1, id: 'test-editor', version: '0.1.0', productName: 'Test Editor',
      appId: 'studio.haiyue.test', artifactName: 'Test-${version}-${os}-${arch}.${ext}', storageNamespace: 'haiyue.test',
      supportTier: 'stable', entries: ['index.html'], staticFiles: [], workers: [], distDirectory: 'dist',
      outputDirectory: 'app-dist', electronRendererDirectory: 'electron/app-dist',
      budget: { maxRawBytes: 100000, maxGzipBytes: 100000 },
      pwa: { enabled: true, shortName: 'Test', description: 'Test', themeColor: '#000', backgroundColor: '#000' },
      electron: { enabled: true, width: 1200, height: 800, minWidth: 800, minHeight: 600, backgroundColor: '#000' },
    }));
    const first = await assembleEditorApp({ descriptorPath: join(root, 'app.json'), packageRoot: root });
    const second = await assembleEditorApp({ descriptorPath: join(root, 'app.json'), packageRoot: root });
    assert.equal(first.buildHash, second.buildHash);
    await validateAssembledEditorApp({ descriptorPath: join(root, 'app.json'), packageRoot: root });
    const manifest = JSON.parse(await readFile(join(root, 'app-dist/manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    await assert.rejects(readFile(join(root, 'app-dist/dist/bundle-report.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(root, 'app-dist/dist/bundle-report.md')), { code: 'ENOENT' });
    const electronMain = await readFile(join(root, 'electron/main.mjs'), 'utf8');
    assert.match(electronMain, /HAIYUE_ELECTRON_SMOKE/);

    const server = await previewEditorApp({
      descriptorPath: join(root, 'app.json'),
      packageRoot: root,
      port: 0,
      basePath: '/nested/test-editor/',
    });
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const origin = `http://127.0.0.1:${address.port}`;
      assert.equal((await fetch(`${origin}/nested/test-editor/`)).status, 200);
      assert.equal((await fetch(`${origin}/nested/test-editor/manifest.webmanifest`)).status, 200);
      assert.equal((await fetch(`${origin}/manifest.webmanifest`)).status, 404);
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
