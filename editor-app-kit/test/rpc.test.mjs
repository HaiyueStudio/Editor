import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalRpcServer, createEditorRpcClient, createElectronRpcHost } from '../node.mjs';

test('local RPC authenticates, rejects browser origins/host spoofing and closes client sessions', async () => {
  const closed = [];
  const server = await createLocalRpcServer({ dispatch: async (id, request) => { if (request === null) { closed.push(id); return null; } return { jsonrpc: '2.0', id: request.id, result: request.params }; } });
  let client;
  try {
    assert.equal((await fetch(`${server.url}/sessions`, { method: 'POST' })).status, 403);
    const headers = { Authorization: `Bearer ${server.token}` };
    assert.equal((await fetch(`${server.url}/sessions`, { method: 'POST', headers: { ...headers, Origin: 'http://localhost' } })).status, 403);
    // A raw HTTP client, unlike browsers, can override Host.
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => { const req = request(server.url + '/sessions', { method: 'POST', headers: { ...headers, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(status, 403);
    client = await createEditorRpcClient(server);
    assert.deepEqual(await client.request('echo', { message: 'hello' }), { message: 'hello' });
    const session = await fetch(server.url + '/sessions', { method: 'POST', headers }).then(res => res.json());
    const rpcHeaders = { ...headers, 'X-Haiyue-Session': session.sessionId, 'Content-Type': 'application/json' };
    const invalid = await fetch(server.url + '/rpc/v1', { method: 'POST', headers: rpcHeaders, body: '{' }).then(res => res.json());
    assert.equal(invalid.error.code, -32700);
    assert.equal((await fetch(server.url + '/rpc/v1', { method: 'POST', headers: rpcHeaders, body: ' '.repeat(1024 * 1024 + 1) })).status, 413);
    await client.close(); client = null; assert.ok(closed.length);
  } finally { await client?.close(); await server.close(); }
});

function fakeElectron() {
  const ipcMain = new EventEmitter(); ipcMain.handlers = new Map();
  ipcMain.handle = (name, handler) => ipcMain.handlers.set(name, handler); ipcMain.removeHandler = name => ipcMain.handlers.delete(name);
  const webContents = new EventEmitter(); webContents.mainFrame = { url: 'file:///editor/index.html' }; webContents.isDestroyed = () => false;
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  webContents.send = (channel, message) => queueMicrotask(() => ipcMain.emit('haiyue-editor:rpc-response', event, { ...message, response: message.request === null ? null : { jsonrpc: '2.0', id: message.request.id, result: 'ok' } }));
  return { ipcMain, webContents, event, entryUrl: webContents.mainFrame.url };
}

test('Electron IPC validates main-frame sender, reload generation and secure descriptor ownership', async () => {
  const ports = fakeElectron(), directory = await mkdtemp(join(tmpdir(), 'haiyue-rpc-unit-'));
  const file = join(directory, 'editor-rpc.json'); await writeFile(file, 'old', { mode: 0o644 });
  const host = await createElectronRpcHost({ ...ports, descriptorDirectory: directory, enabled: true, timeoutMs: 100 });
  const invoke = ports.ipcMain.handlers.get('haiyue-editor:rpc-invoke');
  try {
    assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal(JSON.parse(await readFile(file)).token, host.token);
    assert.throws(() => invoke({ ...ports.event, senderFrame: { url: ports.entryUrl } }, {}), /Untrusted/);
    await assert.rejects(host.invoke('session', {}), /unavailable/);
    ports.ipcMain.emit('haiyue-editor:rpc-ready', ports.event);
    assert.equal((await invoke(ports.event, { id: '1' })).result, 'ok');
    let sent; ports.webContents.send = (_, message) => { sent = message; };
    const pending = host.invoke('session', { id: '2' }); ports.webContents.emit('did-start-loading');
    await assert.rejects(pending, /disconnected/);
    ports.ipcMain.emit('haiyue-editor:rpc-ready', ports.event);
    ports.ipcMain.emit('haiyue-editor:rpc-response', ports.event, { ...sent, response: 'stale' });
    const timeout = host.invoke('session', { id: '3' });
    await assert.rejects(timeout, /timeout/);
    await writeFile(file, JSON.stringify({ token: 'new owner' }));
    ports.webContents.emit('did-start-loading');
    await host.close(); assert.equal(JSON.parse(await readFile(file)).token, 'new owner');
    assert.equal(ports.ipcMain.handlers.size, 0);
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test('local RPC closes interrupted and idle sessions and rejects streamed oversized bodies', { timeout: 5000 }, async () => {
  let started, disconnected, finish;
  const startedPromise = new Promise(resolve => started = resolve), disconnectedPromise = new Promise(resolve => disconnected = resolve);
  const closed = [];
  const server = await createLocalRpcServer({ idleMs: 100, dispatch: async (id, request) => {
    if (request === null) { closed.push(id); finish?.(null); disconnected(); return null; }
    started(); return new Promise(resolve => finish = resolve);
  } });
  const headers = { Authorization: `Bearer ${server.token}` };
  try {
    const session = await fetch(server.url + '/sessions', { method: 'POST', headers }).then(r => r.json());
    const controller = new AbortController();
    const pending = fetch(server.url + '/rpc/v1', { method: 'POST', signal: controller.signal,
      headers: { ...headers, 'X-Haiyue-Session': session.sessionId, 'Content-Type': 'application/json' }, body: '{}' });
    await startedPromise; controller.abort(); await assert.rejects(pending); await disconnectedPromise;
    assert.ok(closed.includes(session.sessionId));
    const streamed = await fetch(server.url + '/sessions', { method: 'POST', headers }).then(r => r.json());
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = request(server.url + '/rpc/v1', { method: 'POST', headers: { ...headers, 'X-Haiyue-Session': streamed.sessionId, 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.write(' '.repeat(600000)); req.end(' '.repeat(600000));
    });
    assert.equal(status, 413);
    const deadline = Date.now() + 2000;
    while (!closed.includes(streamed.sessionId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(closed.includes(streamed.sessionId), 'idle session expired');
  } finally { await server.close(); }
});
