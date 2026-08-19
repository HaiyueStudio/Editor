import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(join(root, 'config/architecture-boundaries.json'), 'utf8'));
const workspaceRoots = new Map();
const violations = [];

for (const workspace of JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces) {
  const directory = join(root, workspace);
  const manifestPath = join(directory, 'package.json');
  if (!existsSync(manifestPath)) {
    violations.push(`missing workspace manifest: ${workspace}/package.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  workspaceRoots.set(manifest.name, { directory, manifest });
}

for (const [name, entry] of workspaceRoots) {
  const declared = policy.packages[name];
  if (!declared) {
    violations.push(`workspace is missing from architecture policy: ${name}`);
    continue;
  }
  const dependencies = {
    ...entry.manifest.dependencies,
    ...entry.manifest.devDependencies,
    ...entry.manifest.peerDependencies,
    ...entry.manifest.optionalDependencies,
  };
  for (const [dependency, version] of Object.entries(dependencies)) {
    const lowered = dependency.toLowerCase();
    if (policy.forbiddenDependencyFragments.some(fragment => lowered.includes(fragment))) {
      violations.push(`${name} depends on forbidden AI capability ${dependency}`);
    }
    if (typeof version === 'string' && policy.forbiddenProtocols.some(protocol => version.startsWith(protocol))) {
      violations.push(`${name} uses forbidden dependency protocol ${dependency}@${version}`);
    }
    if (dependency.startsWith('@haiyue/') && dependency !== name && !declared.allow.includes(dependency)) {
      violations.push(`${name} is not allowed to depend on ${dependency}`);
    }
  }
  const src = join(entry.directory, 'src');
  if (existsSync(src)) scanSource(name, entry.directory, src);
}

if (violations.length > 0) {
  console.error('[editor-repository-boundary] violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log(`[editor-repository-boundary] ${workspaceRoots.size} workspaces satisfy package, source, and AI-neutral boundaries.`);

function scanSource(packageName, workspaceRoot, directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      scanSource(packageName, workspaceRoot, path);
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const source = readFileSync(path, 'utf8');
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(|export\s+[^;]*?from\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const specifier of imports) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(path), specifier);
        const rel = relative(workspaceRoot, target);
        if (rel === '..' || rel.startsWith(`..${sep}`)) {
          violations.push(`${relative(root, path)} imports across workspace source boundary: ${specifier}`);
        }
      }
      if (specifier.includes('/src/') && specifier.startsWith('@haiyue/')) {
        violations.push(`${relative(root, path)} imports private package source: ${specifier}`);
      }
    }
    if (packageName === '@haiyue/editor-platform' && /\b(?:window|HTMLElement|customElements|GPUDevice|navigator)\b|globalThis\.document/.test(source)) {
      violations.push(`${relative(root, path)} introduces DOM/WebGPU globals into headless platform`);
    }
    if (/deepseek-harness|@haiyue\/aistudio|agent-runtime|model-provider/i.test(source)) {
      violations.push(`${relative(root, path)} introduces an AI/Agent runtime dependency into Editor`);
    }
  }
}
