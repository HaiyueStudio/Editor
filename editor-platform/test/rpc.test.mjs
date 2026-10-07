import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorPlatform } from '../dist/index.js';
let serial = 0;
const call = (p, session, method, params = {}, id = `rpc-${++serial}`) => p.rpc.request(session, { jsonrpc: '2.0', id, method, params });
const ok = async promise => { const response = await promise; assert.ok(!response.error, JSON.stringify(response)); return response.result; };

test('RPC discovery, strict envelopes and session-owned chunked binary round trip', async () => {
  const p = new EditorPlatform();
  try {
    assert.equal((await ok(call(p, 'one', 'rpc.discover'))).chunkBytes, 65536);
    assert.equal((await call(p, 'one', 'missing')).error.code, -32601);
    assert.equal((await p.rpc.request('one', { jsonrpc: '1.0', id: 'bad', method: 'documents.list', params: {} })).error.code, -32600);
    assert.equal((await call(p, 'one', 'documents.list', { extra: true })).error.code, -32602);
    const bytes = Buffer.alloc(1024 * 1024 + 17); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const { uploadId } = await ok(call(p, 'one', 'resources.begin', { byteLength: bytes.length }));
    assert.equal((await call(p, 'one', 'resources.finish', { uploadId })).error.code, -32602);
    assert.equal((await call(p, 'one', 'resources.append', { uploadId, offset: 1, base64: 'AQ==' })).error.code, -32602);
    assert.equal((await call(p, 'one', 'resources.append', { uploadId, offset: 0, base64: 'AR==' })).error.code, -32602);
    for (let offset = 0; offset < bytes.length; offset += 65536) await ok(call(p, 'one', 'resources.append', { uploadId, offset, base64: bytes.subarray(offset, offset + 65536).toString('base64') }));
    const ref = await ok(call(p, 'one', 'resources.finish', { uploadId }));
    assert.deepEqual(p.resources.read(ref.resourceId), new Uint8Array(bytes));
    assert.equal((await call(p, 'two', 'resources.read', { resourceId: ref.resourceId, offset: 0, length: 1 })).error.code, -32602);
    const read = await ok(call(p, 'one', 'resources.read', { resourceId: ref.resourceId, offset: 1024 * 1024, length: 65536 }));
    assert.deepEqual(Buffer.from(read.base64, 'base64'), bytes.subarray(1024 * 1024));
    await ok(call(p, 'two', 'resources.release', { resourceId: ref.resourceId })); assert.equal(p.resources.size(ref.resourceId), bytes.length);
    await p.rpc.close('one'); assert.throws(() => p.resources.read(ref.resourceId));
    const upload = await ok(call(p, 'two', 'resources.begin', { byteLength: 128 * 1024 * 1024 }));
    assert.equal((await call(p, 'three', 'resources.begin', { byteLength: 1 })).error.code, -32000);
    await ok(call(p, 'two', 'resources.abort', upload));
    await ok(call(p, 'three', 'resources.begin', { byteLength: 1 }));
  } finally { await p.dispose(); }
});

test('RPC cancellation is scoped, duplicate calls rejected, disconnect cancels active work', async () => {
  const p = new EditorPlatform();
  p.operations.register({ ownerId: 'test', descriptor: { id: 'test.wait', version: 1, title: 'Wait', target: 'workspace', access: 'read', input: { type: 'object', properties: {} }, output: { type: 'null' } },
    prepare: (_, ctx) => new Promise(resolve => ctx.signal.addEventListener('abort', () => resolve(null), { once: true })), commit: () => null });
  const envelope = { apiVersion: '1', requestId: 'same', operation: 'test.wait', params: {} };
  try {
    const a = call(p, 'one', 'operations.execute', envelope, 'pending');
    const b = call(p, 'two', 'operations.execute', envelope);
    assert.equal((await call(p, 'one', 'operations.execute', envelope)).error.code, -32000);
    assert.equal((await call(p, 'one', 'documents.list', {}, 'pending')).error.code, -32000);
    assert.deepEqual(await ok(call(p, 'three', 'operations.cancel', { requestId: 'same' })), { requested: false });
    assert.deepEqual(await ok(call(p, 'one', 'operations.cancel', { requestId: 'same' })), { requested: true });
    assert.equal((await ok(a)).status, 'cancelled');
    await p.rpc.close('two'); assert.equal((await ok(b)).status, 'cancelled');
  } finally { await p.dispose(); }
});
