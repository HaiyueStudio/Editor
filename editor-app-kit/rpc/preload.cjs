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
