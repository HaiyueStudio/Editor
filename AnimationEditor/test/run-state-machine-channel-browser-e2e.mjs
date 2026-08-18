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

const bundleDirectory = await mkdtemp(resolve(import.meta.dirname, '.state-machine-channel-browser-'));
try {
  const bundle = await rollup({
    input: {
      'state-machine-channel': fileURLToPath(new URL('./state-machine-channel-browser-entry.mjs', import.meta.url)),
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
    fixture: 'AnimationEditor/test/state-machine-channel-browser-e2e.html',
    query: { bundle: basename(bundleDirectory) },
    timeoutMs: 120_000,
    visualCapture: { viewportWidth: 900, viewportHeight: 650, sampleWidth: 22, sampleHeight: 16 },
  });
  if (result.gpuValidationErrors !== 0
    || result.released.resources !== 0
    || result.released.owners !== 0
    || result.released.releasedOwnerResiduals !== 0) {
    throw new Error(`G08 lifecycle/GPU invariant failed: ${JSON.stringify(result)}`);
  }
  console.log(
    `[g08-browser] pixels=${result.samples.start.hash}/${result.samples.middle.hash}/${result.samples.end.hash}; `
    + `middle=${result.middleProgress}; rapid=${result.rapidTransitions}; latest=${result.latestState}; `
    + `before=${result.beforeDestroy.actionCount}/${result.beforeDestroy.bindingCount}/${result.beforeDestroy.sideEffectOwnerCount}; `
    + `after=${result.afterDestroy.actionCount}/${result.afterDestroy.bindingCount}/${result.afterDestroy.sideEffectOwnerCount}/${result.afterDestroy.activeParticles}; `
    + `released=${result.released.resources}/${result.released.owners}/${result.released.releasedOwnerResiduals}; `
    + `GPU errors=${result.gpuValidationErrors}`,
  );
} finally {
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
