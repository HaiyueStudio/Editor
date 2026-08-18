import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRollupOnce } from '../../scripts/shared-rollup-runner.mjs';

const editorDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await rm(resolve(editorDir, 'dist'), { recursive: true, force: true });

try {
  await runRollupOnce({
    cwd: editorDir,
    config: 'rollup.config.js',
    expectedOutputs: ['dist'],
    label: 'editor',
    timeoutMs: environmentDuration('EDITOR_BUILD_TIMEOUT_MS', 180_000),
    exitGraceMs: environmentDuration('EDITOR_EXIT_GRACE_MS', 1_500, true),
    terminateGraceMs: environmentDuration('EDITOR_TERM_GRACE_MS', 1_000),
    killGraceMs: environmentDuration('EDITOR_KILL_GRACE_MS', 1_000),
  });

  const report = spawn(
    process.execPath,
    [resolve(editorDir, 'scripts', 'bundle-report.mjs')],
    {
      cwd: editorDir,
      env: process.env,
      stdio: 'inherit',
    },
  );
  const reportResult = await new Promise(resolveResult => {
    report.on('error', error => resolveResult({ error }));
    report.on('close', code => resolveResult({ code }));
  });
  if (reportResult.error) {
    console.error(reportResult.error);
    process.exit(1);
  }
  if (reportResult.code !== 0) process.exit(reportResult.code ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function environmentDuration(name, fallback, allowZero = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? 'zero or a positive integer' : 'a positive integer'}.`);
  }
  return value;
}
