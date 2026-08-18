import { mkdtemp, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import { rollup } from 'rollup';

import { workerModuleUrlPolicy } from '../../config/rollup.shared.js';
import { wgslRaw } from '../../scripts/rollup-plugin-wgsl.js';
import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';
import { native3dTypescript } from './native-3d-rollup.mjs';

const bundleDirectory = await mkdtemp(resolve(import.meta.dirname, '.native-3d-browser-'));
try {
  const bundle = await rollup({
    input: fileURLToPath(new URL('./native-3d-entry.ts', import.meta.url)),
    plugins: [
      wgslRaw(), workerModuleUrlPolicy(),
      nodeResolve({ browser: true, preferBuiltins: false, extensions: ['.mjs', '.js', '.json', '.node', '.ts'], exportConditions: ['source'] }), commonjs(),
      native3dTypescript(),
    ],
  });
  await bundle.write({
    dir: bundleDirectory,
    entryFileNames: 'native-3d.js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    assetFileNames: 'assets/[name]-[hash][extname]',
    format: 'es', sourcemap: false,
  });
  await bundle.close();

  const result = await runChromeWebGpuFixture({
    root: resolve(import.meta.dirname, '../..'),
    fixture: 'AnimationEditor/test/native-3d-browser-e2e.html',
    query: { bundle: basename(bundleDirectory) },
    timeoutMs: 120_000,
    visualCapture: { viewportWidth: 1040, viewportHeight: 760, sampleWidth: 26, sampleHeight: 19 },
  });
  if (result.gpuValidationErrors !== 0) throw new Error(`G06 fixture reported ${result.gpuValidationErrors} GPU validation errors.`);
  if (result.released.ownerResidualCount !== 0) throw new Error(`G06 owner residual failed: ${JSON.stringify(result.released)}`);
  if (result.samples.length !== 3 || new Set(result.samples.map(sample => sample.hash)).size !== 3) {
    throw new Error(`G06 key-pixel sequence failed: ${JSON.stringify(result.samples)}`);
  }
  console.log(
    `[g06-browser] HYA=${result.hyaBytes} bytes; pixels=${result.samples.map(sample => sample.hash).join('/')}; `
    + `package=${result.packageBytes} bytes; `
    + `painted=${result.samples.map(sample => sample.painted).join('/')}; actions=${JSON.stringify(result.actionCount)}; `
    + `owner residual=${result.released.ownerResidualCount}; GPU errors=${result.gpuValidationErrors}`,
  );
} finally {
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
