import { mkdtemp, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { rollup } from 'rollup';
import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';

const bundleDirectory = await mkdtemp(resolve(import.meta.dirname, '.deformable-live2d-browser-'));
try {
  const bundle = await rollup({
    input: fileURLToPath(new URL('./deformable-live2d-browser-entry.ts', import.meta.url)),
    plugins: [
      nodeResolve({ browser: true, preferBuiltins: false, exportConditions: ['source'] }),
      commonjs(),
      typescript({ tsconfig: fileURLToPath(new URL('./tsconfig.deformable-live2d-browser.json', import.meta.url)), outDir: bundleDirectory, declaration: false }),
    ],
  });
  await bundle.write({ dir: bundleDirectory, entryFileNames: 'entry.js', chunkFileNames: 'chunks/[name]-[hash].js', format: 'es', sourcemap: true });
  await bundle.close();
  const result = await runChromeWebGpuFixture({
    root: resolve(import.meta.dirname, '../..'), fixture: 'AnimationEditor/test/deformable-live2d-browser-e2e.html',
    query: { bundle: basename(bundleDirectory) }, timeoutMs: 90_000,
  });
  if (result.forbiddenNetworkCount !== 0 || result.preview.activeObjectUrls !== 0 || result.preview.pendingAssetJobs !== 0) throw new Error(`G08 closure/lifecycle failed: ${JSON.stringify(result)}`);
  if (!result.strictObserved || !result.missingObserved || !result.coreObserved) throw new Error(`G08 failure classification incomplete: ${JSON.stringify(result)}`);
  console.log(`[g08-live2d-browser] calls=${result.calls}; id=${result.stableId}; package=${result.paths.join('+')}; objectURLs=${result.objectUrlsCreated}/${result.objectUrlsRevoked}; closure=${result.forbiddenNetworkCount}`);
} finally {
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
