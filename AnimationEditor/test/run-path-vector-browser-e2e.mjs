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

const bundleDirectory = await mkdtemp(resolve(import.meta.dirname, '.path-vector-browser-'));
try {
  const bundle = await rollup({
    input: {
      'path-domain': fileURLToPath(new URL('../src/domain/PathAuthoring.ts', import.meta.url)),
      'path-adapters': fileURLToPath(new URL('../src/authoring/path/index.ts', import.meta.url)),
      'runtime-preview': fileURLToPath(new URL('../src/preview/AnimationEditorRuntimePreview.ts', import.meta.url)),
    },
    plugins: [
      wgslRaw(), workerModuleUrlPolicy(),
      nodeResolve({ browser: true, preferBuiltins: false, exportConditions: ['source'] }), commonjs(),
      typescript({
        tsconfig: fileURLToPath(new URL('../tsconfig.rollup.json', import.meta.url)),
        outDir: bundleDirectory, declaration: false,
      }),
    ],
  });
  await bundle.write({
    dir: bundleDirectory, entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js',
    assetFileNames: 'assets/[name]-[hash][extname]', format: 'es', sourcemap: true,
  });
  await bundle.close();
  const result = await runChromeWebGpuFixture({
    root: resolve(import.meta.dirname, '../..'),
    fixture: 'AnimationEditor/test/path-vector-browser-e2e.html',
    query: { bundle: basename(bundleDirectory) }, timeoutMs: 90_000,
    visualCapture: { viewportWidth: 760, viewportHeight: 820, sampleWidth: 19, sampleHeight: 20 },
  });
  if (result.commands !== 'MLLLZ') throw new Error(`G04 fixture expected an inserted MLLLZ path, received ${result.commands}.`);
  if (result.gpuValidationErrors !== 0) throw new Error(`G04 fixture reported ${result.gpuValidationErrors} GPU validation errors.`);
  if (result.cache.entries > 8 || result.cache.peakEntries > 8) {
    throw new Error(`G04 structural budget failed: ${JSON.stringify({ cache: result.cache })}`);
  }
  if (result.longTasks.length) console.warn(`[g04-browser] cross-host long-task diagnostic: ${result.longTasks.join(',')}ms.`);
  console.log(
    `[g04-browser] commands=${result.commands}; points=${result.pointCount}; morphKeys=${result.morphKeys}; `
    + `trimKeys=${result.trimKeys}; commits=${result.commits + result.motionCommits}; cache=${result.cache.entries}/${result.cache.peakEntries}; `
    + `pixels=${result.pixels.start.painted}/${result.pixels.middle.painted}/${result.pixels.end.painted}; GPU errors=${result.gpuValidationErrors}`,
  );
} finally {
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
