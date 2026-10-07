# @haiyue/editor-platform

DOM-free lifecycle, plugin, document, history, selection and task kernel shared by HaiyueStudio editors.

The shared operation API v1 supports discoverable, schema-checked commands and structured request/result/event contracts. The platform provides per-document FIFO dispatch, revision checks, cancellation and owner-scoped disposal. See [operation contracts and integration](../docs/for-ai/editor-platform/operations.md).

`createEditorAutomationAPI(platform)` exposes operation/document discovery and owned binary-resource
handles to an in-process host. Image, HYA authoring and Voxel register their minimal open/query/edit/
undo/export loops against live product models. `EditorHistoryService.runAtomic` batches synchronous
history publication and preserves both undo and redo when a product mutation fails; the product
owns restoration of its domain state. See the linked integration guide for the product operation table and runnable example.

`platform.rpc` provides session-owned JSON-RPC dispatch over the same operation service. Electron IPC, optional loopback HTTP and the Node client live in `@haiyue/editor-app-kit/node`; see [operation and transport contracts](../docs/for-ai/editor-platform/operations.md).
