import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const expected = new Map([
  ['editor-plugin-sdk', ['.']],
  ['editor-platform', ['.', './conformance']],
  ['editor-shell', ['.']],
  ['editor-app-kit', ['.', './node']],
]);
for (const [workspace, expectedExports] of expected) {
  const manifest = JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8'));
  const actual = Object.keys(manifest.exports ?? {}).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedExports.sort())) {
    throw new Error(`${workspace} exports ${actual.join(', ')}, expected ${expectedExports.join(', ')}`);
  }
  if (manifest.private) throw new Error(`${workspace} must remain a publishable public foundation package.`);
}
console.log('[editor-platform-api] foundation package exports are intentional and versioned.');
