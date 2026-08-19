import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { loadEditorAppDescriptor, previewEditorApp } from '@haiyue/editor-app-kit/node';
import { defaultChromePath, defaultWebGpuAngleBackend } from './webgpu-gate/chrome-runner.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const workspaces = process.argv.slice(2);
const selected = workspaces.length > 0 ? workspaces : ['editor', 'AnimationEditor', 'voxelEditor'];

for (const workspace of selected) await smokeWorkspace(workspace);

async function smokeWorkspace(workspace) {
  const packageRoot = resolve(repositoryRoot, workspace);
  const descriptorPath = resolve(packageRoot, 'app/descriptor.json');
  const descriptor = await loadEditorAppDescriptor(descriptorPath);
  const basePath = `/__haiyue_pwa_smoke__/${descriptor.id}/`;
  const server = await previewEditorApp({ descriptorPath, packageRoot, port: 0, basePath });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error(`Could not allocate preview port for ${descriptor.id}.`);

  const chrome = process.env.CHROME_PATH ?? defaultChromePath();
  if (!existsSync(chrome)) throw new Error(`PWA smoke requires Chrome. Set CHROME_PATH (looked for ${chrome}).`);
  const profile = mkdtempSync(resolve(tmpdir(), 'haiyue-pwa-smoke-'));
  const child = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    `--use-angle=${process.env.WEBGPU_ANGLE_BACKEND ?? defaultWebGpuAngleBackend()}`,
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.resume();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });

  try {
    const endpoint = await waitFor(
      () => /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1],
      20_000,
      `${descriptor.id} Chrome DevTools endpoint`,
    );
    const listUrl = `http://${new URL(endpoint).host}/json/list`;
    const page = await waitFor(async () => {
      const targets = await fetch(listUrl).then(response => response.json()).catch(() => []);
      return targets.find(target => target.type === 'page' && target.url === 'about:blank');
    }, 20_000, `${descriptor.id} Chrome page`);
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    const errors = [];
    cdp.on('Runtime.exceptionThrown', event => errors.push(
      event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? 'Unknown exception',
    ));
    cdp.on('Runtime.consoleAPICalled', event => {
      if (event.type === 'error') errors.push((event.args ?? []).map(item => item.description ?? item.value ?? item.type).join(' '));
    });

    try {
      await cdp.call('Page.enable');
      await cdp.call('Runtime.enable');
      await cdp.call('Network.enable');
      const url = `http://127.0.0.1:${address.port}${basePath}`;
      await cdp.call('Page.navigate', { url });
      await waitFor(() => evaluate(cdp, `document.readyState === 'complete' && location.pathname === ${JSON.stringify(basePath)}`), 60_000, `${descriptor.id} online load`);
      await waitFor(() => evaluate(cdp, `navigator.serviceWorker?.controller?.scriptURL || ''`), 30_000, `${descriptor.id} service worker control`);
      const online = await evaluate(cdp, `fetch('./app-manifest.json').then(response => response.ok)`);
      if (!online) throw new Error(`${descriptor.id} could not fetch its app manifest online.`);

      await cdp.call('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
        connectionType: 'none',
      });
      const offlineLoad = waitForCdpEvent(cdp, 'Page.loadEventFired', 60_000, `${descriptor.id} offline load event`);
      await cdp.call('Page.reload', { ignoreCache: true });
      await offlineLoad;
      await waitFor(() => evaluate(cdp, `document.readyState === 'complete' && Boolean(navigator.serviceWorker?.controller)`), 60_000, `${descriptor.id} offline reload`);
      await waitFor(
        () => evaluate(cdp, `fetch('./app-manifest.json').then(response => response.ok).catch(() => false)`),
        10_000,
        `${descriptor.id} offline app manifest`,
      );
      if (errors.length > 0) throw new Error(`${descriptor.id} browser errors:\n- ${errors.join('\n- ')}`);
      console.log(`[editor-app-kit] ${descriptor.id} nested-base and offline PWA smoke passed.`);
    } finally {
      await cdp.call('Browser.close').catch(() => {});
      cdp.close();
    }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nChrome stderr:\n${stderr}`);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise(resolveExit => child.once('exit', resolveExit)),
        new Promise(resolveTimeout => setTimeout(resolveTimeout, 2_000)),
      ]);
    }
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    await new Promise(resolveClose => server.close(resolveClose));
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { console.warn(`[editor-app-kit] Could not remove Chrome profile: ${error.message}`); }
  }
}

async function evaluate(cdp, expression) {
  try {
    const response = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) return null;
    return response.result?.result?.value ?? null;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot find default execution context')) return null;
    throw error;
  }
}

function connectCdp(url) {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 0;
    socket.addEventListener('error', () => rejectConnect(new Error(`Could not connect to Chrome DevTools at ${url}.`)), { once: true });
    socket.addEventListener('open', () => resolveConnect({
      call(method, params = {}) {
        return new Promise((resolveCall, rejectCall) => {
          const id = ++nextId;
          pending.set(id, { resolveCall, rejectCall });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      on(method, listener) {
        const methodListeners = listeners.get(method) ?? new Set();
        methodListeners.add(listener);
        listeners.set(method, methodListeners);
      },
      close() { socket.close(); },
    }), { once: true });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.rejectCall(new Error(message.error.message));
        else request.resolveCall(message);
        return;
      }
      for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {});
    });
  });
}

async function waitFor(read, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
      lastError = null;
    } catch (error) { lastError = error; }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${label}.${detail}`);
}

function waitForCdpEvent(cdp, method, timeoutMs, label) {
  return new Promise((resolveEvent, rejectEvent) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      rejectEvent(new Error(`Timed out waiting for ${label}.`));
    }, timeoutMs);
    cdp.on(method, event => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveEvent(event);
    });
  });
}
