import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';

const editorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const viewport = await runChromeWebGpuFixture({
  root: editorRoot,
  fixture: 'voxelEditor/test/fixtures/viewport-smoke.html',
  timeoutMs: 45_000,
});
console.log(`[voxel-editor] Viewport smoke passed: camera=${viewport.cameraMoved ? 'moved' : 'static'}, selected=${viewport.visibleVoxelCount}, gizmo=${viewport.pickedAxes.join(',')}.`);

const history = await runChromeWebGpuFixture({
  root: editorRoot,
  fixture: 'voxelEditor/test/fixtures/editor-history-smoke.html',
  timeoutMs: 45_000,
});
console.log(`[voxel-editor] History smoke passed: voxels=${history.voxelCount}, camera-preserved=${history.cameraPreserved}.`);

const persistence = await runChromeWebGpuFixture({
  root: editorRoot,
  fixture: 'voxelEditor/test/fixtures/editor-persistence-smoke.html',
  timeoutMs: 45_000,
});
console.log(`[voxel-editor] Persistence smoke passed: restored=${persistence.restoredVoxelCount} voxel from IndexedDB.`);
