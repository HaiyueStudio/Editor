import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEditorAppDescriptor, validateEditorAppDescriptor } from '../dist/index.js';

const descriptor = {
  schemaVersion: 1,
  id: 'test-editor', version: '0.1.0', productName: 'Test Editor',
  appId: 'studio.haiyue.test', artifactName: 'HaiYue-Test-${version}-${os}-${arch}.${ext}',
  storageNamespace: 'haiyue.test', supportTier: 'stable',
  entries: ['index.html'], staticFiles: ['styles.css'], workers: ['dist/worker.js'],
  distDirectory: 'dist', outputDirectory: 'app-dist', electronRendererDirectory: 'electron/app-dist',
  budget: { maxRawBytes: 1000, maxGzipBytes: 500 },
  pwa: { enabled: true, shortName: 'Test', description: 'Test', themeColor: '#000', backgroundColor: '#000' },
  electron: { enabled: true, width: 1200, height: 800, minWidth: 800, minHeight: 600, backgroundColor: '#000' },
};

test('app descriptor validates identity, safe paths, and budgets', () => {
  assert.deepEqual(validateEditorAppDescriptor(descriptor), []);
  assert.ok(Object.isFrozen(defineEditorAppDescriptor(descriptor)));
  assert.match(validateEditorAppDescriptor({ ...descriptor, outputDirectory: '../escape' }).join('\n'), /safe relative path/);
});
