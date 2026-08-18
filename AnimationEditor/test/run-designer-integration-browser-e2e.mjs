import { resolve } from 'node:path';
import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';

const result = await runChromeWebGpuFixture({
  root: resolve(import.meta.dirname, '../..'),
  fixture: 'AnimationEditor/test/designer-integration-browser-e2e.html',
  timeoutMs: 180_000,
  visualCapture: { viewportWidth: 1280, viewportHeight: 900, sampleWidth: 28, sampleHeight: 20 },
});
if (result.templates !== 6) throw new Error(`G09 browser candidate structure failed: ${JSON.stringify(result)}`);
if (result.startup2d > 5000 || result.startup3d > 5000 || result.longTasks.length !== 0) {
  console.warn(
    `[g09-browser] cross-host timing diagnostic: startup=${result.startup2d.toFixed(1)}/${result.startup3d.toFixed(1)}ms; `
    + `longTasks=${result.longTasks.length}.`,
  );
}
console.log(`[g09-browser] templates=${result.templates}; startup=${result.startup2d.toFixed(1)}/${result.startup3d.toFixed(1)}ms; pixels=${Object.values(result.pixels).map(value => value.hash).join('/')}; heap=${result.heapGrowth ?? 'unavailable'}; longTasks=${result.longTasks.length}`);
