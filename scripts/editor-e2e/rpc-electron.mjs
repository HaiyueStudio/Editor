import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createEditorRpcClient } from '@haiyue/editor-app-kit/node';
import { connectCdp } from './browserDriver.mjs';
import { ImageDocument } from '../../imageEditor/dist/document.js';
import { serializeProject } from '../../imageEditor/dist/projectFile.js';
import { importPsd } from '../../imageEditor/dist/psdAdapter.js';
import { parseAnimation } from '@haiyue/animation-spec';
import { parseMagicaVoxel } from '../../voxelEditor/dist/vox-importer.js';

const root = resolve(import.meta.dirname, '../..'), electron = createRequire(import.meta.url)('electron');
const selected = process.argv.slice(2);
for (const name of selected) if (!['imageEditor', 'AnimationEditor', 'voxelEditor'].includes(name)) throw Error(`Unknown product: ${name}`);
const image = ImageDocument.create('RPC image', 4, 4, true);
const cases = [
  { product: 'imageEditor', prefix: 'image', source: serializeProject(image.state), format: 'psd' },
  { product: 'AnimationEditor', prefix: 'hya', source: await readFile(resolve(root, 'AnimationEditor/examples/state-machine-multitrack.hya-project.json'), 'utf8'), format: 'hya' },
  { product: 'voxelEditor', prefix: 'voxel', source: JSON.stringify({ format: 'haiyue-voxel', version: 1, size: { x: 8, y: 8, z: 8 }, editor: { currentColor: '#ff0000' }, voxels: [{ x: 1, y: 2, z: 3, color: '#ff0000' }] }), format: 'vox' },
];
image.dispose();
for (const item of cases.filter(item => !selected.length || selected.includes(item.product))) {
  const profile = await mkdtemp(join(tmpdir(), 'haiyue-rpc-electron-'));
  const harness = join(profile, 'launch.mjs');
  await writeFile(harness, `import { app } from 'electron';\napp.setPath('userData', ${JSON.stringify(profile)});\nawait import(${JSON.stringify(pathToFileURL(resolve(root, item.product, 'electron/main.mjs')).href)});\n`);
  const child = spawn(electron, [harness, '--remote-debugging-port=0'], { env: { ...process.env, HAIYUE_EDITOR_RPC: '1', HAIYUE_EDITOR_RPC_PORT: '0', HAIYUE_ELECTRON_SMOKE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '', cdp, client; child.stdout.on('data', chunk => logs += chunk); child.stderr.on('data', chunk => logs += chunk);
  const exited = new Promise(resolve => child.once('exit', resolve));
  async function wait(read, label) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw Error(`Electron exited: ${logs}`);
      const value = await read(); if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Timed out: ${label}\n${logs}`);
  }
  try {
    const endpoint = await wait(() => /DevTools listening on (ws:\/\/[^\s]+)/.exec(logs)?.[1], 'DevTools');
    const target = await wait(async () => (await fetch(`http://${new URL(endpoint).host}/json/list`).then(r => r.json())).find(t => t.type === 'page' && t.url.startsWith('file:')), 'renderer');
    cdp = await connectCdp(target.webSocketDebuggerUrl); await cdp.call('Runtime.enable');
    const errors = []; cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails?.text));
    async function evaluate(expression) {
      const response = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.result.exceptionDetails) throw Error(JSON.stringify(response.result.exceptionDetails));
      return response.result.result.value;
    }
    await wait(() => evaluate(`Boolean(globalThis.haiyueEditor?.listOperations().some(entry => entry.descriptor.id === '${item.prefix}.history.redo') && (${item.prefix === 'image' ? 'true' : 'globalThis.haiyueEditor.listDocuments().documents.length'}))`), 'platform ready');
    assert.deepEqual(await evaluate('[typeof require,typeof process,Object.isFrozen(window.haiyueEditorIPC)]'), ['undefined', 'undefined', true]);
    const ipc = await evaluate(`window.haiyueEditorIPC.request({jsonrpc:'2.0',id:'native-ipc',method:'operations.list',params:{}})`);
    assert.ok(ipc.result.some(entry => entry.descriptor.id === `${item.prefix}.history.redo`), 'real sandboxed preload IPC discovery');
    const descriptor = JSON.parse(await readFile(join(profile, 'editor-rpc.json'), 'utf8'));
    client = await createEditorRpcClient(descriptor);
    const large = Buffer.alloc(1024 * 1024 + 13, 91), ref = await client.upload(large);
    assert.deepEqual(await client.download(ref), large); await client.release(ref.resourceId);
    let documentId = item.prefix === 'image' ? null : (await client.request('documents.list')).documents[0].identity.id;
    async function call(suffix, params = {}) {
      const doc = documentId ? (await client.request('documents.list')).documents.find(d => d.identity.id === documentId) : null;
      const result = await client.execute({ apiVersion: '1', requestId: randomUUID(), operation: `${item.prefix}.${suffix}`, params,
        ...(doc ? { documentId, expectedRevision: doc.revision } : {}) });
      assert.equal(result.status, 'completed', JSON.stringify(result)); return result.value;
    }
    const input = await client.upload(Buffer.from(item.source));
    const opened = await call('document.open', { resourceId: input.resourceId, ...(item.prefix === 'image' ? { format: 'project', name: 'native.hyimage' } : {}) });
    if (item.prefix === 'image') documentId = opened.documentId;
    await client.release(input.resourceId);
    const before = await call('document.query');
    if (item.prefix === 'image') await call('filter.apply', { layerId: before.layers[0].id, kind: 'invert', amount: 100 });
    else if (item.prefix === 'hya') await call('node.transform', { nodeId: before.nodes[0].id, patch: { x: 123, y: 456, opacity: 0.25 } });
    else await call('cells.patch', { cells: [{ x: 1, y: 2, z: 3, action: 'remove' }, { x: 4, y: 4, z: 4, action: 'set', color: '#123456' }] });
    const changed = await call('document.query');
    async function exported() { const file = await call('document.export', { format: item.format }); const bytes = await client.download(file); await client.release(file.resourceId); return bytes; }
    const edited = await exported(); await call('history.undo');
    const after = await call('document.query'); const content = ({ canRedo, ...rest }) => rest;
    assert.deepEqual(content(after), content(before)); assert.equal(after.canRedo, true);
    const restored = await exported(); assert.notDeepEqual(edited, restored);
    await call('history.redo'); assert.deepEqual(await call('document.query'), changed);
    for (const bytes of [edited, restored]) {
      if (item.prefix === 'image') assert.ok(importPsd(new Uint8Array(bytes), 'out.psd').layered);
      else if (item.prefix === 'hya') assert.ok(parseAnimation(new Uint8Array(bytes).buffer));
      else assert.ok(parseMagicaVoxel(new Uint8Array(bytes)));
    }
    assert.deepEqual(errors, []);
    console.log(`[rpc-electron] ${item.prefix}: IPC + HTTP open/query/domain edit/undo/redo/export + chunked binary passed`);
  } finally {
    await client?.close().catch(() => {}); cdp?.close(); if (child.exitCode === null) child.kill('SIGKILL'); await exited;
    await rm(profile, { recursive: true, force: true });
  }
}
