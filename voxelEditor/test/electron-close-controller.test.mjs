import assert from 'node:assert/strict';
import test from 'node:test';
import { ElectronCloseController } from '../dist-test/electron-close-controller.js';

class FakeSession {
  dirty = false;
  projectName = 'untitled';
  saveResult = true;
  saveCalls = 0;
  listeners = new Set();

  subscribe(listener) {
    this.listeners.add(listener);
    listener({ dirty: this.dirty, projectName: this.projectName });
    return () => this.listeners.delete(listener);
  }

  async save() {
    this.saveCalls += 1;
    if (this.saveResult) this.dirty = false;
    this.emit();
    return this.saveResult;
  }

  emit() {
    for (const listener of this.listeners) listener({ dirty: this.dirty, projectName: this.projectName });
  }
}

test('Electron close bridge publishes session state and returns the actual save outcome', async () => {
  const states = [];
  let saveHandler = null;
  let handlerUnsubscribed = 0;
  const bridge = {
    updateDocumentState: state => states.push(state),
    onSaveAndClose(handler) {
      saveHandler = handler;
      return () => { handlerUnsubscribed += 1; };
    },
  };
  const session = new FakeSession();
  const controller = new ElectronCloseController(session, bridge, () => 'zh-CN');
  assert.deepEqual(states.at(-1), { dirty: false, name: 'untitled', locale: 'zh-CN' });

  session.dirty = true;
  session.projectName = '城市场景';
  session.emit();
  assert.deepEqual(states.at(-1), { dirty: true, name: '城市场景', locale: 'zh-CN' });
  assert.equal(await saveHandler(), true);
  assert.equal(session.saveCalls, 1);
  assert.equal(states.at(-1).dirty, false);

  session.dirty = true;
  session.saveResult = false;
  assert.equal(await saveHandler(), false);
  assert.equal(states.at(-1).dirty, true);

  const publishedBeforeDispose = states.length;
  controller.dispose();
  controller.dispose();
  session.emit();
  assert.equal(states.length, publishedBeforeDispose);
  assert.equal(handlerUnsubscribed, 1);
});

test('browser builds keep the optional Electron bridge as a no-op', () => {
  const session = new FakeSession();
  const controller = new ElectronCloseController(session, null, () => 'en-US');
  assert.equal(session.listeners.size, 0);
  controller.dispose();
});
