import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  '../Engine/.artifacts/packages/haiyue-engine-0.1.0.tgz',
  '../Engine/.artifacts/packages/haiyue-animation-spec-0.1.0.tgz',
  '../Engine/.artifacts/packages/haiyue-extensions-0.1.0.tgz',
  '../Engine/.artifacts/packages/haiyue-shader-language-0.1.0.tgz',
  '../UI/.artifacts/packages/haiyue-ui-0.1.0.tgz',
];

const missing = candidates.filter(candidate => !existsSync(resolve(repositoryRoot, candidate)));
if (missing.length > 0) {
  throw new Error([
    'Missing local package candidates:',
    ...missing.map(candidate => `- ${candidate}`),
    'Run `npm run pack:candidates` in ../Engine and `npm run pack:candidate` in ../UI first.',
  ].join('\n'));
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this bootstrap through `npm run deps:local`.');
const result = spawnSync(process.execPath, [npmCli, 'install', '--no-save', '--package-lock=false', '--cache=.npm-cache', ...candidates], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
