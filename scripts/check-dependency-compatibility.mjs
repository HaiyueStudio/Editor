import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const expectedRange = '>=0.1.0 <0.2.0';
const externalPackages = [
  '@haiyue/engine',
  '@haiyue/extensions',
  '@haiyue/animation-spec',
  '@haiyue/shader-language',
  '@haiyue/ui',
];
const workspaces = ['editor', 'AnimationEditor', 'voxelEditor', 'editor-shell'];
const root = resolve(import.meta.dirname, '..');
const mode = process.argv.includes('--minimum') ? 'minimum' : 'allowed';
const violations = [];

for (const workspace of workspaces) {
  const manifest = await json(resolve(root, workspace, 'package.json'));
  for (const name of externalPackages) {
    const declared = manifest.dependencies?.[name];
    if (declared !== undefined && declared !== expectedRange) {
      violations.push(`${workspace} declares ${name}@${declared}; expected ${expectedRange}`);
    }
  }
}

for (const name of externalPackages) {
  let manifest;
  try { manifest = await json(resolve(root, 'node_modules', ...name.split('/'), 'package.json')); }
  catch { continue; }
  if (!allowedVersion(manifest.version)) violations.push(`${name}@${manifest.version} is outside ${expectedRange}`);
  if (mode === 'minimum' && manifest.version !== '0.1.0') violations.push(`${name}@${manifest.version} is not the minimum 0.1.0`);
}

if (violations.length > 0) {
  console.error('[editor-dependency-compatibility] violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log(`[editor-dependency-compatibility] ${mode} Engine/UI resolution satisfies ${expectedRange} and public-package-only declarations.`);

function allowedVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(value ?? '');
  return Boolean(match && Number(match[1]) === 0 && Number(match[2]) === 1);
}

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
