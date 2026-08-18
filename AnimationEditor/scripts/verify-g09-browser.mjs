import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const scripts = [
  'AnimationEditor/scripts/verify-stage4-browser.mjs',
  'AnimationEditor/test/run-designer-integration-browser-e2e.mjs',
  'AnimationEditor/test/run-timeline-browser-interaction.mjs',
  'AnimationEditor/test/run-spritesheet-browser-e2e.mjs',
  'AnimationEditor/test/run-path-vector-browser-e2e.mjs',
  'AnimationEditor/test/run-particle-browser-e2e.mjs',
  'AnimationEditor/test/run-native-3d-browser-e2e.mjs',
  'AnimationEditor/test/run-source-import-browser-e2e.mjs',
  'AnimationEditor/test/run-state-machine-channel-browser-e2e.mjs'
];

for (const [index, script] of scripts.entries()) {
  console.log(`[g09-browser] running ${script}`);
  const result = spawnSync(process.execPath, [resolve(root, script)], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (index < scripts.length - 1) {
    // Give Chrome's GPU/helper processes time to leave before the next strict
    // long-task fixture starts measuring its own interactions.
    await new Promise(resolveWait => setTimeout(resolveWait, 750));
  }
}
console.log(`[g09-browser] passed ${scripts.length} product and delegated WebGPU fixtures`);
