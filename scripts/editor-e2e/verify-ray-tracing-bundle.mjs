import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const graph = JSON.parse(await readFile(resolve('editor/dist/bundle-graph.json'), 'utf8'));
const byFile = new Map(graph.chunks.map(chunk => [chunk.fileName, chunk]));
const entry = requireChunk(chunk => chunk.fileName === 'editor.js', 'editor entry');
const rayRuntime = requireChunk(chunk => chunk.facadeModuleId?.replaceAll('\\', '/').endsWith('/@haiyue/extensions/src/ray-tracing.ts'), 'ray tracing runtime');
const previewOwner = requireChunk(chunk => chunk.facadeModuleId === 'src/infra/ray-tracing/RayTracingPreviewOwner.ts', 'preview owner');
const previewPanel = requireChunk(chunk => chunk.facadeModuleId === 'src/infra/ray-tracing/RayTracingPanel.ts', 'preview panel');
const plugin = requireChunk(chunk => chunk.facadeModuleId === 'src/platform/sceneRayTracingPlugin.ts', 'lazy plugin');
const startup = closure(entry.fileName, false);
const reachable = closure(entry.fileName, true);
for (const chunk of [plugin, previewOwner, previewPanel, rayRuntime]) {
  if (startup.has(chunk.fileName)) throw new Error(`Ray tracing chunk ${chunk.fileName} leaked into the Scene first-frame closure.`);
  if (!reachable.has(chunk.fileName)) throw new Error(`Ray tracing chunk ${chunk.fileName} is not dynamically reachable from editor.js.`);
}
if (!plugin.dynamicImports.includes(previewOwner.fileName) || !plugin.dynamicImports.includes(previewPanel.fileName)) {
  throw new Error('Ray tracing plugin must defer both preview ownership and panel UI chunks.');
}
if (!previewOwner.dynamicImports.includes(rayRuntime.fileName)) {
  throw new Error('Ray tracing preview owner must defer the extensions ray runtime.');
}
const report = Object.freeze({
  schemaVersion: 1,
  suite: 'editor-ray-tracing-bundle-topology',
  status: 'passed',
  entry: entry.fileName,
  startupChunkCount: startup.size,
  lazyChunks: Object.freeze([plugin.fileName, previewOwner.fileName, previewPanel.fileName, rayRuntime.fileName]),
  firstFrameContainsRayTracing: false,
  unclassifiedFailureCount: 0,
});
console.log(JSON.stringify(report, null, 2));

function requireChunk(predicate, label) {
  const chunk = graph.chunks.find(predicate);
  if (!chunk) throw new Error(`Bundle graph is missing ${label}.`);
  return chunk;
}

function closure(start, includeDynamic) {
  const visited = new Set();
  const pending = [start];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const chunk = byFile.get(file);
    if (!chunk) continue;
    pending.push(...chunk.imports, ...(includeDynamic ? chunk.dynamicImports : []));
  }
  return visited;
}
