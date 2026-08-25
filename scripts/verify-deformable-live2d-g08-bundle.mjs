#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'AnimationEditor/dist');
const files = await collectJavaScript(dist);
assert.ok(files.some(path => path.endsWith('main.js')), 'AnimationEditor dist/main.js is missing; run the production build first.');
const forbiddenImplementation = /Live2DAuthoringPanel|Live2DExactPreviewSession|Live2DImportSession|Live2DImportWorkflow|packed-cubism-capture-adapter/gu;
// The lazy descriptor deliberately contains the literal ".wpk" so the UI can explain that it is unsupported.
const forbiddenSourceRuntime = /live2dcubismcore|cubismcore|\.moc3|\.motion3\.json|\.physics3\.json|\.pose3\.json|\.cmo3/giu;
const violations = [];
for (const path of files) {
  const source = await readFile(path, 'utf8');
  const implementation = [...source.matchAll(forbiddenImplementation)].map(match => match[0]);
  const runtime = [...source.matchAll(forbiddenSourceRuntime)].map(match => match[0]);
  if (implementation.length || runtime.length) violations.push({ path: relative(root, path).replaceAll('\\', '/'), implementation, runtime });
}
assert.deepEqual(violations, [], `Default production closure contains G08 implementation/source runtime: ${JSON.stringify(violations)}`);
console.log(`[g08-bundle] js=${files.length}; implementation=0; Core/source=0; lazy importer descriptor remains the only product contribution.`);

async function collectJavaScript(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectJavaScript(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(path);
  }
  return output.sort();
}
