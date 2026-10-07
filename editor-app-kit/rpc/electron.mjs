import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, rm, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalRpcServer } from './local-rpc.mjs';

const channels = { request: 'haiyue-editor:rpc-request', response: 'haiyue-editor:rpc-response', invoke: 'haiyue-editor:rpc-invoke', ready: 'haiyue-editor:rpc-ready' };
/** Inject Electron ports to keep this module importable/testable in Node. Never evaluates renderer code. */
export async function createElectronRpcHost({ ipcMain, webContents, entryUrl, descriptorDirectory, enabled = false, port = 0, timeoutMs = 30000 }) {
  let ready = false, disposed = false, generation = randomUUID(), server;
  const pending = new Map();
  const own = event => event.sender === webContents && event.senderFrame === webContents.mainFrame && event.senderFrame?.url === entryUrl;
  const reset = () => { ready = false; generation = randomUUID(); for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Renderer disconnected; outcome unknown.')); } pending.clear(); };
  const onReady = event => { if (own(event)) ready = true; };
  const onResponse = (event, message) => {
    if (!own(event) || message?.generation !== generation) return;
    const entry = pending.get(message.callId); if (!entry) return;
    pending.delete(message.callId); clearTimeout(entry.timer);
    if (message.error) entry.reject(Error('Renderer rejected RPC request.')); else entry.resolve(message.response);
  };
  const invoke = (sessionId, request) => {
    if (disposed || !ready || webContents.isDestroyed()) return Promise.reject(Error('Renderer RPC is unavailable.'));
    if (pending.size >= 128) return Promise.reject(Error('IPC queue is full.'));
    const callId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(callId); reject(Error('IPC timeout; outcome unknown.'));
        if (request !== null && !webContents.isDestroyed()) webContents.send(channels.request, { callId: randomUUID(), generation, sessionId, request: null });
      }, timeoutMs); timer.unref();
      pending.set(callId, { resolve, reject, timer });
      try { webContents.send(channels.request, { callId, generation, sessionId, request }); }
      catch (error) { pending.delete(callId); clearTimeout(timer); reject(error); }
    });
  };
  const onInvoke = (event, request) => {
    if (!own(event)) throw Error('Untrusted IPC sender.');
    return invoke('ipc-renderer', request);
  };
  ipcMain.on(channels.ready, onReady); ipcMain.on(channels.response, onResponse); ipcMain.handle(channels.invoke, onInvoke);
  webContents.on('did-start-loading', reset); webContents.on('render-process-gone', reset);
  const file = descriptorDirectory ? join(descriptorDirectory, 'editor-rpc.json') : null;
  let closing;
  const close = () => {
    if (closing) return closing;
    ipcMain.removeListener(channels.ready, onReady); ipcMain.removeHandler(channels.invoke);
    closing = (async () => {
    await server?.close();
    if (ready && !webContents.isDestroyed()) await invoke('ipc-renderer', null).catch(() => {});
    disposed = true; reset();
    ipcMain.removeListener(channels.response, onResponse);
    webContents.removeListener('did-start-loading', reset); webContents.removeListener('render-process-gone', reset); webContents.removeListener('destroyed', onDestroyed);
    if (file && server) {
      const current = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
      if (current?.token === server.token) await rm(file, { force: true });
    }
    })();
    return closing;
  };
  const onDestroyed = () => { void close(); }; webContents.once('destroyed', onDestroyed);
  try {
    if (enabled) {
      server = await createLocalRpcServer({ dispatch: invoke, port });
      if (file) {
        await mkdir(descriptorDirectory, { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify({ apiVersion: '1', url: server.url, token: server.token, pid: process.pid }), { mode: 0o600, flag: 'wx' });
          await rename(temporary, file);
        } finally { await rm(temporary, { force: true }); }
      }
    }
    return Object.freeze({ invoke, close, ...(server ? { url: server.url, token: server.token } : {}) });
  } catch (error) { await close(); throw error; }
}
