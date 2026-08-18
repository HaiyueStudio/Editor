import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaySession } from '../dist-test/testing.js';

test('PlaySession close removes listeners, timers, and scene references', async () => {
  const originalWindow = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    location: { origin: 'https://editor.test', href: 'https://editor.test/editor/' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const messages = [];
  const frame = {
    srcdoc: '',
    contentWindow: { postMessage(message) { messages.push(message); } },
  };
  const overlay = { hidden: true, tabIndex: 0, focus() {} };
  const session = new PlaySession({
    overlay,
    frame,
    pauseButton: null,
    output: { clear() {}, append() {} },
    serializeScene: async () => ({ version: 1, format: 'haiyue-editor-scene', entities: [] }),
    getDevicePixelRatio: () => 1,
    getOrigin: () => 'https://editor.test',
  });

  try {
    session.open(await session.prepare({}));
    assert.deepEqual(session.diagnostics, { messageListeners: 1, selectionSubscriptions: 0, sceneReferences: 1 });
    assert.equal(listeners.has('message'), true);
    session.close();
    assert.deepEqual(session.diagnostics, { messageListeners: 0, selectionSubscriptions: 0, sceneReferences: 0 });
    assert.equal(listeners.has('message'), false);
    assert.equal(overlay.hidden, true);
    assert.equal(frame.srcdoc, '');
    session.close();
    assert.deepEqual(session.diagnostics, { messageListeners: 0, selectionSubscriptions: 0, sceneReferences: 0 });
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PlaySession forwards the structured stage-seven diagnostic snapshot without engine or GPU coupling', async () => {
  const originalWindow = globalThis.window;
  const listeners = new Map();
  const parentMessages = [];
  const contentWindow = { postMessage(message) { parentMessages.push(message); } };
  globalThis.window = {
    location: { origin: 'https://editor.test', href: 'https://editor.test/editor/' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const rendered = [];
  const debugPanel = {
    breakpoints: [],
    setBreakpointsChangeHandler() {},
    setFieldEditHandler() {},
    clear() {},
    renderBreakpointHit() {},
    renderInspector() {},
    renderPerformance(snapshot) { rendered.push(snapshot); },
  };
  const session = new PlaySession({
    overlay: { hidden: true, tabIndex: 0, focus() {} },
    frame: { srcdoc: '', contentWindow },
    pauseButton: null,
    output: { clear() {}, append() {} },
    debugPanel,
    serializeScene: async () => ({ version: 1, format: 'haiyue-editor-scene', entities: [] }),
    getDevicePixelRatio: () => 1,
    getOrigin: () => 'https://editor.test',
  });
  const diagnostics = {
    frame: { frame: 9, counters: { draws: 4 }, cpuMs: { record: 1.2 } },
    pipeline: { passCount: 2, issues: [] },
    resources: { resources: [{ id: 1 }], caches: [] },
    assets: { records: [{ refs: 2 }] },
    device: { state: 'ready' },
  };
  try {
    session.open(await session.prepare({}));
    listeners.get('message')({
      origin: 'https://editor.test',
      source: contentWindow,
      data: { type: 'game-editor-player-performance', metrics: { fps: 60, diagnostics } },
    });
    assert.equal(rendered.length, 1);
    assert.deepEqual(rendered[0].diagnostics, diagnostics);
  } finally {
    session.close();
    globalThis.window = originalWindow;
  }
});

test('PlaySession synchronizes selection by subscription and ignores stale inspector revisions', async () => {
  const originalWindow = globalThis.window;
  const listeners = new Map();
  const messages = [];
  const contentWindow = { postMessage(message) { messages.push(message); } };
  let selectionListener = null;
  let unsubscribed = 0;
  const inspectorSnapshots = [];
  globalThis.window = {
    location: { origin: 'https://editor.test', href: 'https://editor.test/editor/' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const session = new PlaySession({
    overlay: { hidden: true, tabIndex: 0, focus() {} },
    frame: { srcdoc: '', contentWindow },
    pauseButton: null,
    output: { clear() {}, append() {} },
    debugPanel: {
      breakpoints: [],
      setBreakpointsChangeHandler() {},
      setFieldEditHandler() {},
      clear() {},
      renderBreakpointHit() {},
      renderInspector(snapshot) { inspectorSnapshots.push(snapshot); },
      renderPerformance() {},
    },
    serializeScene: async () => ({ version: 1, format: 'haiyue-editor-scene', entities: [] }),
    getDevicePixelRatio: () => 1,
    getSelectedEntityId: () => 3,
    subscribeSelectedEntityId(listener) {
      selectionListener = listener;
      return () => { unsubscribed++; selectionListener = null; };
    },
    getOrigin: () => 'https://editor.test',
  });

  try {
    session.open(await session.prepare({}));
    assert.equal(session.diagnostics.selectionSubscriptions, 1);
    selectionListener(4);
    selectionListener(4);
    assert.deepEqual(messages.filter(message => message.type === 'game-editor-player-select-entity'), [
      { type: 'game-editor-player-select-entity', entityId: 4 },
    ]);

    const snapshot = { entity: { id: 4, name: 'Selected' }, components: [] };
    listeners.get('message')({
      origin: 'https://editor.test', source: contentWindow,
      data: { type: 'game-editor-player-inspector', revision: 2, snapshot },
    });
    listeners.get('message')({
      origin: 'https://editor.test', source: contentWindow,
      data: { type: 'game-editor-player-inspector', revision: 1, snapshot: null },
    });
    assert.deepEqual(inspectorSnapshots, [snapshot]);

    session.close();
    assert.equal(unsubscribed, 1);
    assert.equal(session.diagnostics.selectionSubscriptions, 0);
  } finally {
    session.close();
    globalThis.window = originalWindow;
  }
});
