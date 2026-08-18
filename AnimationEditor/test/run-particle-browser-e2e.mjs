import { mkdtemp, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { rollup } from 'rollup';

import { workerModuleUrlPolicy } from '../../config/rollup.shared.js';
import { wgslRaw } from '../../scripts/rollup-plugin-wgsl.js';
import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';

const bundleDirectory = await mkdtemp(resolve(import.meta.dirname, '.particle-browser-'));
try {
  const bundle = await rollup({
    input: {
      'particle-domain': fileURLToPath(new URL('../src/domain/ParticleAuthoring.ts', import.meta.url)),
      'particle-adapters': fileURLToPath(new URL('../src/authoring/particle/index.ts', import.meta.url)),
      'particle-runtime': fileURLToPath(new URL('../src/authoring/particle/ParticleWebGpuRuntimeAdapter.ts', import.meta.url)),
    },
    plugins: [
      wgslRaw(), workerModuleUrlPolicy(),
      nodeResolve({ browser: true, preferBuiltins: false, exportConditions: ['source'] }), commonjs(),
      typescript({
        tsconfig: fileURLToPath(new URL('../tsconfig.rollup.json', import.meta.url)),
        outDir: bundleDirectory,
        declaration: false,
      }),
    ],
  });
  await bundle.write({
    dir: bundleDirectory,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    assetFileNames: 'assets/[name]-[hash][extname]',
    format: 'es',
    sourcemap: true,
  });
  await bundle.close();

  const result = await runChromeWebGpuFixture({
    root: resolve(import.meta.dirname, '../..'),
    fixture: 'AnimationEditor/test/particle-browser-e2e.html',
    query: { bundle: basename(bundleDirectory) },
    timeoutMs: 120_000,
    visualCapture: { viewportWidth: 980, viewportHeight: 860, sampleWidth: 24, sampleHeight: 21 },
  });
  if (result.gpuValidationErrors !== 0) throw new Error(`G05 fixture reported ${result.gpuValidationErrors} GPU validation errors.`);
  if (result.released.resources || result.released.releasedOwnerResiduals) {
    throw new Error(`G05 lifecycle invariant failed: ${JSON.stringify({ released: result.released })}`);
  }
  if (result.longTasks.length) console.warn(`[g05-browser] cross-host long-task diagnostic: ${result.longTasks.join(',')}ms.`);
  console.log(
    `[g05-browser] samples=${Object.keys(result.samples).length}; edits=${result.edits}; `
    + `scrubs=${result.adapterMetrics.scrubs}; owners=${result.before.ownerCount}/${result.after.ownerCount}; `
    + `resources=${result.before.resourceCount}/${result.after.resourceCount}; maxScrub=${result.maxScrubMs.toFixed(2)}ms; `
    + `GPU errors=${result.gpuValidationErrors}`,
  );
} finally {
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
