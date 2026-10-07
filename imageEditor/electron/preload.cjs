'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const stateChannel = 'haiyue-editor:update-document-state';
const saveRequestChannel = 'haiyue-editor:save-and-close';
const saveResultChannel = 'haiyue-editor:save-and-close-result';
let saveAndCloseHandler = null;
ipcRenderer.on(saveRequestChannel, () => {
  const handler = saveAndCloseHandler;
  if (!handler) { ipcRenderer.send(saveResultChannel, false); return; }
  Promise.resolve().then(() => handler()).then(
    saved => ipcRenderer.send(saveResultChannel, saved === true),
    () => ipcRenderer.send(saveResultChannel, false),
  );
});
contextBridge.exposeInMainWorld('haiyueEditorHost', Object.freeze({
  updateDocumentState(state) {
    ipcRenderer.send(stateChannel, {
      dirty: state?.dirty === true,
      name: typeof state?.name === 'string' ? state.name : '',
      locale: typeof state?.locale === 'string' ? state.locale : 'en-US',
    });
  },
  onSaveAndClose(handler) {
    if (typeof handler !== 'function') throw new TypeError('Save-and-close handler must be a function.');
    saveAndCloseHandler = handler;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (saveAndCloseHandler === handler) saveAndCloseHandler = null;
    };
  },
}));

;(() => {
  const { contextBridge, ipcRenderer } = require('electron');
  const requestChannel = 'haiyue-editor:rpc-request';
  let listener = null;
  ipcRenderer.on(requestChannel, (_event, message) => {
    const handler = listener;
    if (!handler) return;
    Promise.resolve().then(() => handler(message.sessionId, message.request)).then(
      response => ipcRenderer.send('haiyue-editor:rpc-response', { callId: message.callId, generation: message.generation, response }),
      () => ipcRenderer.send('haiyue-editor:rpc-response', { callId: message.callId, generation: message.generation, error: true }),
    );
  });
  contextBridge.exposeInMainWorld('haiyueEditorIPC', Object.freeze({
    request: request => ipcRenderer.invoke('haiyue-editor:rpc-invoke', request),
    onRequest(handler) {
      if (listener || typeof handler !== 'function') throw new TypeError('RPC handler already bound or invalid.');
      listener = handler; ipcRenderer.send('haiyue-editor:rpc-ready');
      return () => { if (listener === handler) listener = null; };
    },
  }));
})();
