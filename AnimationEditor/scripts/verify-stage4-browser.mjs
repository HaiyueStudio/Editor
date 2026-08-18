import { resolve } from 'node:path';

import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';

const result = await runChromeWebGpuFixture({
  root: resolve(import.meta.dirname, '../..'),
  fixture: 'AnimationEditor/test/browser-stage4.html',
  timeoutMs: 60_000,
});

console.log(
  `[animation-editor] browser stage 9 passed: ${result.previewTitle}; `
  + `${result.runtimeTarget}; ${result.previewStats}`,
);
