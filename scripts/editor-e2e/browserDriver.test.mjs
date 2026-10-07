import test from 'node:test';
import assert from 'node:assert/strict';
import { connectCdp } from './browserDriver.mjs';

test('CDP rejects outstanding commands when Chrome closes without replying to Browser.close', async () => {
  const original = globalThis.WebSocket; let socket;
  class FakeSocket extends EventTarget {
    static OPEN = 1; readyState = 1;
    constructor() { super(); socket = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send() {}
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  globalThis.WebSocket = FakeSocket;
  try {
    const cdp = await connectCdp('ws://test'); const pending = cdp.call('Browser.close'); socket.close();
    await assert.rejects(pending, /connection closed/);
    await assert.rejects(cdp.call('Runtime.evaluate'), /not open/); cdp.close();
  } finally { globalThis.WebSocket = original; }
});

test('CDP still resolves responses and rejects pending commands on transport error', async () => {
  const original = globalThis.WebSocket; let socket;
  class FakeSocket extends EventTarget {
    static OPEN = 1; readyState = 1;
    constructor() { super(); socket = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(json) { this.last = JSON.parse(json); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  globalThis.WebSocket = FakeSocket;
  try {
    const cdp = await connectCdp('ws://test'); const success = cdp.call('Test');
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({id: socket.last.id, result: {value: 42}}) }));
    assert.deepEqual(await success, {id: 1, result: {value: 42}});
    const pending = cdp.call('Test'); socket.dispatchEvent(new Event('error')); await assert.rejects(pending,/closed/);cdp.close();
  } finally { globalThis.WebSocket = original; }
});
