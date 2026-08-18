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

const bundleDirectory = await mkdtemp(resolve(import.meta.dirname, '.spritesheet-browser-'));
try {
  const bundle = await rollup({
    input: {
      'spritesheet-domain': fileURLToPath(new URL('../src/domain/SpriteSheetAuthoring.ts', import.meta.url)),
      'spritesheet-adapters': fileURLToPath(new URL('../src/authoring/spritesheet/index.ts', import.meta.url)),
      'runtime-preview': fileURLToPath(new URL('../src/preview/AnimationEditorRuntimePreview.ts', import.meta.url)),
    },
    plugins: [
      wgslRaw(),
      workerModuleUrlPolicy(),
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
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    assetFileNames: 'assets/[name]-[hash][extname]',
    format: 'es',
    sourcemap: true,
  });
  await bundle.close();

  const result = await runChromeWebGpuFixture({
    root: resolve(import.meta.dirname, '../..'),
    fixture: 'AnimationEditor/test/spritesheet-browser-e2e.html',
    query: { bundle: basename(bundleDirectory) },
    timeoutMs: 90_000,
    visualCapture: { viewportWidth: 880, viewportHeight: 520, sampleWidth: 22, sampleHeight: 13 },
  });
  if (result.fixedGrid !== '5x5' || result.frameCount !== 25) throw new Error('G03 fixture did not exercise the fixed 5×5 atlas.');
  if (result.gpuValidationErrors !== 0) throw new Error(`G03 fixture reported ${result.gpuValidationErrors} GPU validation errors.`);
  if (result.resources !== 1 || result.perFrameResources !== 0 || result.pixelCopies !== 0) {
    throw new Error(`G03 resource invariant failed: ${JSON.stringify(result.resourceMetrics)}`);
  }
  console.log(
    `[g03-browser] 5x5=${result.frameCount} frames; modes=${result.sequenceModes.join('/')} `
    + `keys=${result.keyCount}; resource=${result.resources}; peakDecoded=${result.resourceMetrics.peakLiveImages}; `
    + `pixelCopies=${result.pixelCopies}; perFrameResources=${result.perFrameResources}; GPU errors=${result.gpuValidationErrors}`,
  );
} finally {
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
