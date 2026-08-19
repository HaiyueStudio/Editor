import { mkdtemp, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { rollup } from 'rollup';

import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';

const bundleDirectory = await mkdtemp(resolve(import.meta.dirname, '.timeline-browser-'));
try {
  const bundle = await rollup({
    input: {
      'timeline-production': fileURLToPath(new URL('../src/domain/TimelineProduction.ts', import.meta.url)),
      'timeline-adapters': fileURLToPath(new URL('../src/authoring/timeline/TimelineCanvasAdapters.ts', import.meta.url)),
    },
    plugins: [
      nodeResolve({ browser: true, preferBuiltins: false }),
      typescript({
        tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
        declaration: false,
        outDir: bundleDirectory,
      }),
    ],
  });
  await bundle.write({
    dir: bundleDirectory,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    format: 'es',
    sourcemap: true,
  });
  await bundle.close();

  const result = await runChromeWebGpuFixture({
    root: resolve(import.meta.dirname, '../..'),
    fixture: 'AnimationEditor/test/timeline-browser-interaction.html',
    query: { bundle: basename(bundleDirectory) },
    timeoutMs: 60_000,
  });

  console.log(
    `[g02-browser] timeline=${result.timeline.commits} commits; graph=${result.graph.commits} commits; `
    + `2d=${result.viewport2d.commits}; 3d=${result.viewport3d.commits}; `
    + `10k scrub=${result.timings.scrub.toFixed(2)}ms selection=${result.timings.selection.toFixed(2)}ms `
    + `drag=${result.timings.drag.toFixed(2)}ms longTasks=${result.interactionLongTasks.length}`,
  );
} finally {
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
