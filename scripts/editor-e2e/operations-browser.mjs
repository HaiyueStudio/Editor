import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runEditorBrowserScenario } from './browserDriver.mjs';
import { ImageDocument } from '../../imageEditor/dist/document.js';
import { serializeProject } from '../../imageEditor/dist/projectFile.js';
import { importPsd } from '../../imageEditor/dist/psdAdapter.js';
import { parseAnimation } from '@haiyue/animation-spec';
import { parseMagicaVoxel } from '../../voxelEditor/dist/vox-importer.js';

const root = resolve(import.meta.dirname, '../..');
const output = mkdtempSync(resolve(tmpdir(), 'haiyue-operation-browser-'));
const image = ImageDocument.create('API browser image', 4, 4, true);
const cases = [
  { product: 'imageEditor', prefix: 'image', source: serializeProject(image.state), format: 'psd', edit: 'layer.opacity' },
  { product: 'AnimationEditor', prefix: 'hya', source: readFileSync(resolve(root, 'AnimationEditor/examples/state-machine-multitrack.hya-project.json'), 'utf8'), format: 'hya', edit: 'node.opacity' },
  { product: 'voxelEditor', prefix: 'voxel', source: JSON.stringify({ format: 'haiyue-voxel', version: 1, size: { x: 8, y: 8, z: 8 }, editor: { currentColor: '#ff0000' }, voxels: [{ x: 1, y: 2, z: 3, color: '#ff0000' }] }), format: 'vox', edit: 'cell.set' },
];
image.dispose();
for (const item of cases) {
  const result = await runEditorBrowserScenario({
    root: resolve(root, item.product, 'app-dist'), route: 'index.html', downloadDirectory: output,
    failureScreenshotPath: resolve(output, `${item.prefix}-failed.png`), timeoutMs: 90000,
    readinessExpression: `Boolean(globalThis.haiyueEditor?.listOperations().length >= 5 && (${item.prefix === 'image' ? 'true' : 'globalThis.haiyueEditor.listDocuments().documents.length'}) && document.querySelector('canvas'))`,
    async scenario({ evaluate, nextPaint, getBrowserErrors }) {
      // Allow the normal startup/recovery path to settle before opening through the API.
      await nextPaint();
      const value = await evaluate(`(async () => {
        const api = globalThis.haiyueEditor, item = ${JSON.stringify(item)};
        let id = item.prefix === 'image' ? null : api.listDocuments().documents[0].identity.id, counter = 0;
        async function call(suffix, params = {}) {
          const doc = id ? api.listDocuments().documents.find(d => d.identity.id === id) : null;
          const result = await api.execute({ apiVersion: '1', requestId: 'browser-' + (++counter), operation: item.prefix + '.' + suffix,
            ...(doc ? { documentId: id, expectedRevision: doc.revision } : {}), params });
          if (result.status !== 'completed') throw new Error(JSON.stringify(result));
          return result.value;
        }
        const resource = api.putResource(new TextEncoder().encode(item.source));
        const opened = await call('document.open', { resourceId: resource.resourceId, ...(item.prefix === 'image' ? { format: 'project', name: 'browser.hyimage' } : {}) });
        if (item.prefix === 'image') id = opened.documentId;
        api.releaseResource(resource.resourceId);
        const before = await call('document.query');
        const params = item.prefix === 'image' ? { layerId: before.layers[0].id, opacity: 0.25 }
          : item.prefix === 'hya' ? { nodeId: before.nodes[0].id, opacity: 0.25 }
          : { x: 1, y: 2, z: 3, color: '#123456' };
        await call(item.edit, params);
        const edited = await call('document.query');
        const file = await call('document.export', { format: item.format });
        const bytes = Array.from(api.readResource(file.resourceId)); api.releaseResource(file.resourceId);
        await call('history.undo');
        const after = await call('document.query');
        const restored = await call('document.export', { format: item.format });
        const restoredBytes = Array.from(api.readResource(restored.resourceId)); api.releaseResource(restored.resourceId);
        return { before, edited, after, bytes, restoredBytes };
      })()`);
      await nextPaint();
      assert.deepEqual(getBrowserErrors(), [], `${item.prefix} browser errors`);
      return value;
    },
  });
  assert.equal(result.after.canRedo, true);
  const content = ({ canRedo, ...rest }) => rest;
  assert.deepEqual(content(result.after), content(result.before), `${item.prefix}: undo restores queried state`);
  assert.notDeepEqual(result.edited, result.before, `${item.prefix}: edit changes live state`);
  const bytes = Uint8Array.from(result.bytes), restoredBytes = Uint8Array.from(result.restoredBytes);
  if (item.prefix === 'image') {
    assert.ok(Math.abs(importPsd(bytes, 'edited.psd').layered.layers[0].opacity - 0.25) < 0.004);
    assert.equal(importPsd(restoredBytes, 'restored.psd').layered.layers[0].opacity, 1);
  } else if (item.prefix === 'hya') {
    assert.ok(parseAnimation(bytes.buffer)); assert.ok(parseAnimation(restoredBytes.buffer));
    assert.notDeepEqual(bytes, restoredBytes);
  } else {
    assert.ok(parseMagicaVoxel(bytes)); assert.ok(parseMagicaVoxel(restoredBytes)); assert.notDeepEqual(bytes, restoredBytes);
  }
  console.log(`[operations-browser] ${item.prefix}: open → query → edit → undo → export passed (${restoredBytes.length} bytes)`);
}
console.log(`[operations-browser] diagnostics directory: ${output}`);
