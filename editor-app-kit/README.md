# @haiyue/editor-app-kit

Versioned descriptors and shared deterministic Web/PWA/Electron assembly for HaiyueStudio editor products.

Products that set `electron.unsavedCloseProtection` receive a sandboxed preload bridge and a native
Save and Close / Don't Save / Cancel dialog. The renderer publishes only document identity and dirty state and
handles save requests; raw Electron APIs are never exposed to product code.

Electron assembly includes the sandboxed `haiyueEditorIPC` bridge. Enable the loopback JSON-RPC server with `--editor-rpc` or `HAIYUE_EDITOR_RPC=1`; it writes a private endpoint descriptor under Electron userData. The public `./node` entry exports `createEditorRpcClient`, `createLocalRpcServer` and `createElectronRpcHost`. See [the RPC contract and client example](../docs/for-ai/editor-platform/operations.md).
