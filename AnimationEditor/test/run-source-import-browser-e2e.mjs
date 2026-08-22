import { mkdtemp, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { rollup } from 'rollup';

import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';

const bundleDirectory = await mkdtemp(resolve(import.meta.dirname, '.source-import-browser-'));
try {
  const bundle = await rollup({
    input: fileURLToPath(new URL('./source-import-entry.ts', import.meta.url)),
    plugins: [
      nodeResolve({ browser: true, preferBuiltins: false, exportConditions: ['source'] }),
      commonjs(),
      typescript({
        tsconfig: fileURLToPath(new URL('../tsconfig.rollup.json', import.meta.url)),
        outDir: bundleDirectory,
        declaration: false,
      }),
    ],
  });
  await bundle.write({
    dir: bundleDirectory,
    entryFileNames: 'entry.js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    format: 'es',
    sourcemap: true,
  });
  await bundle.close();

  const result = await runChromeWebGpuFixture({
    root: resolve(import.meta.dirname, '../..'),
    fixture: 'AnimationEditor/test/source-import-browser-e2e.html',
    query: { bundle: basename(bundleDirectory) },
    timeoutMs: 60_000,
  });
  if (result.requestCount !== 3 || result.objectUrlCalls !== 0 || result.activeImports !== 0) {
    throw new Error(`G07 lifecycle/HTTP invariant failed: ${JSON.stringify(result)}`);
  }
  if (result.families.join('/') !== '2d/2d/3d' || result.deliveryAuthoringRecovered !== false) {
    throw new Error(`G07 family/delivery invariant failed: ${JSON.stringify(result)}`);
  }
  if (result.live2dPreview !== 'binary' || result.live2dStaleReasons.join('/') !== 'recipe') {
    throw new Error(`G08 Live2D exact-preview/stale invariant failed: ${JSON.stringify(result)}`);
  }
  console.log(
    `[g07-browser] HTTP=${result.requestCount}; families=${result.families.join('/')} `
    + `Lottie nodes=${result.lottieNodes}; Sprite keys=${result.spriteKeys}; glTF clips=${result.gltfClips}; `
    + `Live2D=${result.live2dPreview}/${result.live2dStaleReasons.join('+')}; `
    + `objectURLs=${result.objectUrlCalls}; active=${result.activeImports}; bytes=${result.deterministicBytes}`,
  );
} finally {
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
