import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateEditorAppDescriptor } from '../dist/index.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const products = ['editor', 'AnimationEditor', 'voxelEditor'];
const descriptors = await Promise.all(products.map(async product => {
  const path = resolve(repositoryRoot, product, 'app/descriptor.json');
  const descriptor = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(validateEditorAppDescriptor(descriptor), [], `${product} descriptor is invalid`);
  return descriptor;
}));

for (const key of ['id', 'appId', 'artifactName', 'storageNamespace']) {
  assert.equal(new Set(descriptors.map(descriptor => descriptor[key])).size, descriptors.length, `${key} values must be unique`);
}
assert.ok(descriptors.every(descriptor => descriptor.electron.enabled && descriptor.pwa.enabled));
console.log('[editor-app-kit] three product descriptors are valid, unique, PWA-enabled, and Electron-enabled.');
