# Shared operation API v1

`EditorPlatform.operations` is the public in-process invocation service. Plugins access the same instance through the typed `editorServiceTokens.operations` token. It is independent of the product, DOM, renderer, storage, network transport and any AI integration. Existing UI actions are not automatically registered; products must provide domain handlers before those actions become callable. The headless RPC host delegates to this service; Electron IPC and the optional loopback HTTP transport live in App Kit. No Agent runtime is included.

## Contract and discovery

`@haiyue/editor-plugin-sdk` exports `EDITOR_OPERATION_API_VERSION = '1'`, request/result/event contracts, `EditorOperationDefinition`, the service port, and descriptor/value validation helpers. Operation protocol version, plugin API version and project-format versions are separate.

- `register(definition)` returns an idempotent **asynchronous** disposable. Every definition has an `ownerId`, stable operation ID, descriptor version 1, title, document/workspace target, read/write classification and input/output schemas. Optional `documentKinds` restrict document operations.
- `list()` returns detached, deeply frozen descriptors with owner IDs, sorted by operation ID. IDs must be unique; registration never replaces a live command implicitly.
- `execute(request, {signal?})` resolves a structured completed/failed/cancelled result. The envelope contains `apiVersion`, `requestId`, `operation`, `params`, and, for document operations, `documentId` and optional `expectedRevision`. Document writes require `expectedRevision`.
- `subscribe(listener)` receives queued/preparing/committing/rolling-back and terminal events, with progress or structured errors as applicable. Requests rejected before admission return an error directly and produce no task events. Listener failures are isolated and reported as diagnostics.
- `cancel(requestId)` cancels queued or preparing work. Unknown, settled, already cancelled, or synchronously committing operations return false. An external AbortSignal has the same semantics.

Request IDs must be unique **while in flight**. Completed results are not cached and this API does not promise exactly-once delivery across retries or process restarts. IPC and local RPC do not automatically retry writes; a lost response has an unknown outcome.

The v1 schema vocabulary supports null/boolean, finite number/safe integer with bounds, string with length/enum, arrays, closed objects with required fields, and an explicit `json` escape hatch for domain-validated data. It is not full JSON Schema. Unknown schema keywords and object fields reject. JSON inputs/results are copied and frozen, with at most 100,000 visited values, depth 32, and 1,048,576 text/key characters. Cycles, sparse arrays, accessors, functions, undefined, binary arrays and non-plain objects reject. Large pixels/assets should be represented by product-managed references; binary transfer uses the separate chunked resource methods below. Product semantic validation belongs in `prepare`, even when a schema accepts the data structurally.

## Execution and ownership

Operations targeting the **same document** run FIFO, including reads; different documents may run concurrently. Workspace operations use a separate FIFO lane. There is no global ordering or multi-document transaction between workspace and document lanes. Workspace handlers must not bypass the document lanes to mutate an already open document. A handler must not await a nested invocation on its own lane, which would deadlock.

The dispatcher delegates active work to the existing `EditorTaskCoordinator`. The queue admits only one active invocation per lane, so that coordinator's latest-wins behavior never discards ordinary queued writes. Existing preview/compile callers retain their previous latest-wins semantics. The default admission limit is 128 running plus queued requests, configurable as `new EditorPlatform({operations:{maxPending:128}})`.

Version checks occur when a document job starts and immediately before commit. The latter also checks the revision captured at prepare start, catching user edits during asynchronous preparation. The document attachment generation prevents queued/prepared work from targeting a newly opened document that reuses the same ID or adapter. Current external requests use document ID/revision; adapters should use fresh document IDs for new project instances to distinguish later client requests as well.

A handler runs `prepare → synchronous commit`, with rollback on failure/cancellation:

1. `prepare(params, context)` receives a read-only document identity/revision, cancellation signal, progress reporting and `assertCurrent`. It may use workers but must not mutate live document state. It captures detached input and the state needed for its domain transaction.
2. `commit(prepared, context)` synchronously applies the **existing product command/transaction**, including history, dirty state, selection and projections. The result must match the output schema. Async/generator commit functions are rejected at registration; a returned Promise also rejects at runtime. Handlers must never schedule delayed mutation from commit.
3. `rollback(preparedOrUndefined, context, error)` is mandatory for writes. `context.commitStarted` distinguishes pre-commit cleanup from recovery after a partial commit or invalid output. Before commit it releases temporary resources only, and must not restore an old snapshot over a concurrent user edit. After commit starts it restores the complete domain transaction, including history/revision/dirty state and derived caches. It must handle undefined prepared data if prepare threw. This product-supplied rollback is required for atomicity; the platform cannot infer how to reverse opaque product mutations.

The lane remains occupied until rollback settles. Rollback errors return `ROLLBACK_FAILED`, never success or an ordinary cancellation. Callers should inspect/recover the product state before continuing after such an error. Exported files and other external side effects are not automatically transactional.

Queued cancellation settles immediately. Running cancellation is cooperative: commit is blocked, but the service waits for prepare and cleanup to settle. There is no forced worker termination or hard timeout in this layer; adapters must wire `context.signal` to their worker/load cancellation. Owner disposal cancels and awaits its jobs before releasing registration resources. Platform disposal awaits the operation service before closing documents and tasks. Cleanup must therefore settle; a handler that ignores cancellation indefinitely also prevents disposal from completing.

## Plugin registration

```ts
import { editorServiceTokens } from '@haiyue/editor-plugin-sdk';

// Inside a plugin's activate(context):
const operations = context.services.get(editorServiceTokens.operations);
context.scope.own(operations.register({
  ownerId: context.pluginId,
  descriptor: {
    id: 'sample.document.inspect', version: 1, title: 'Inspect document',
    target: 'document', access: 'read', documentKinds: ['sample.project'],
    input: { type: 'null' },
    output: { type: 'object', properties: { revision: { type: 'integer' } }, required: ['revision'] },
  },
  prepare(_params, operation) { return { revision: operation.document!.revision }; },
  commit(prepared) { return prepared; },
}));

const response = await operations.execute({
  apiVersion: '1', requestId: 'inspect-1', operation: 'sample.document.inspect',
  documentId: 'project-instance-id', params: null,
});
```

Scope ownership makes failed plugin activation and plugin unloading unregister its operations. Register the operation after resources it depends on so reverse scope disposal stops operations before those resources are released. Do not expose a live Store, renderer or mutable project through operation results. `access` describes handler behavior; it is not an authentication or authorization mechanism for a future transport.

## Error codes and integration boundary

Errors expose `code` and bounded `message`, without raw Error objects or stack traces: `INVALID_REQUEST`, `UNSUPPORTED_VERSION`, `OPERATION_NOT_FOUND`, `INVALID_PARAMS`, `INVALID_RESULT`, `DOCUMENT_NOT_FOUND`, `DOCUMENT_KIND_MISMATCH`, `REVISION_CONFLICT`, `DUPLICATE_REQUEST`, `QUEUE_FULL`, `CANCELLED`, `DISPOSED`, `EXECUTION_FAILED`, `ROLLBACK_FAILED`.

`EditorOperationService` does not create a parallel document model or history stack. Products register `image.*`, `hya.*`, `voxel.*` and other operations while retaining their domain formats, codecs and renderers. The product adapters below register open/query/edit/undo/export operations and share owned binary resources. App Kit forwards this contract through IPC and optional local RPC; saving returned bytes to disk remains the client’s responsibility.

Validation: SDK schema/boundary tests; Platform scheduling, concurrency, cancellation, owner disposal, document replacement, rollback and observer tests; `runEditorOperationConformance()` from the existing `@haiyue/editor-platform/conformance` export. Existing plugin API version 1 and package export paths are preserved.

## Product API loops (Image / HYA / Voxel)

The three browser products expose the same **in-process** `globalThis.haiyueEditor` facade.
Hosts can also call `createEditorAutomationAPI(platform)` from `@haiyue/editor-platform`.
Electron also binds `platform.rpc` to the sandboxed preload. Browser/PWA builds keep the in-process facade and do not start a network listener.
The facade owns no second document model: registrations use the UI's document/store and history.

- `listOperations()` returns registered schemas, target, access and document kinds.
- `listDocuments()` returns `{ activeId, revision, documents }`; each document has `identity`,
  `revision`, `savedRevision`, `dirty`, `active` and `closed`.
- `execute(request, { signal? })`, `cancel(requestId)` use the existing operation contract.
- `putResource(Uint8Array)` copies bytes and returns `{ resourceId, byteLength }`.
- `readResource(resourceId)` returns a detached copy; `releaseResource(resourceId)` is idempotent.
  Handles belong to one platform, expire on disposal, and are bounded to 64 resources / 256 MiB
  in aggregate. Callers release uploaded and exported resources when done. Bytes never enter
  the JSON operation envelope. Format-specific input limits still apply.

| Product | Open | Query | Edit | Undo | Export |
| --- | --- | --- | --- | --- | --- |
| Image | `image.document.open` `{resourceId,name,format:"project"\|"psd"}` | `image.document.query` `{}` | `image.layer.opacity` `{layerId,opacity}` | `image.history.undo` `{}` | `image.document.export` `{format:"project"\|"psd"}` |
| HYA 2D authoring | `hya.document.open` `{resourceId}` | `hya.document.query` `{}` | `hya.node.opacity` `{nodeId,opacity}` / `hya.node.rename` `{nodeId,name}` | `hya.history.undo` `{}` | `hya.document.export` `{format:"project"\|"hya"}` |
| Voxel | `voxel.document.open` `{resourceId}` | `voxel.document.query` `{}` | `voxel.cell.set` `{x,y,z,color:"#RRGGBB"}` | `voxel.history.undo` `{}` | `voxel.document.export` `{format:"project"\|"vox"}` |

Image open is a workspace operation and returns `{documentId,revision,warnings}` for a newly attached,
clean document. Other image operations target that ID (`kind: haiyue.image`). PSD open requires
a supported layered import; unsupported/lossy flattening and export rasterization are not silently
accepted. Project format is the editor's existing `.hyimage` JSON representation.

HYA and Voxel currently have one live document, `animation.current` (`haiyue.animation-project`)
and `voxel.current` (`haiyue.voxel-project`). Their **open is a document write**, requiring the
current `expectedRevision`; it performs an undoable replacement and preserves the existing save
baseline/history. Thus opening a different project marks it dirty. Undoing the subsequent edit
restores the opened content; one more undo restores the prior project. API open does not trigger
file pickers, overwrite disk files or clear existing history. HYA input is `.hya-project.json`,
Voxel input is the existing versioned Voxel project JSON. Native 3D HYA and VOX import are outside
this first operation set.

Queries return bounded summaries (Image: all permitted layers; HYA: first 100 nodes plus
`nodeCount`; Voxel: first 100 base cells plus `voxelCount`). Use project export for the complete
snapshot. Opacity is in `[0,1]`; voxel edits explicitly address the base scene, independent of the
UI's module-edit cursor, and enforce scene bounds and layer locks. This initial cell operation
uses a complete before/after project history entry so palette additions undo as well; edits/open
that exceed the configured history budget fail before live mutation.

Exports return `{resourceId,byteLength,format}` and use detached snapshots. HYA uses the existing
compiler/animation-spec codec; PSD and VOX use the existing product exporters. Export does not
mark saved, change selection or append history. Source revision is checked again after asynchronous
preparation. Export capabilities and format diagnostics remain those of the underlying exporters.

Example, after the Image app is ready, with bytes supplied by the host:

```js
const api = globalThis.haiyueEditor;
let seq = 0;
const input = api.putResource(sourceBytes); // Uint8Array containing a PSD
const opened = await api.execute({
  apiVersion: '1', requestId: `call-${++seq}`, operation: 'image.document.open',
  params: { resourceId: input.resourceId, format: 'psd', name: 'input.psd' },
});
api.releaseResource(input.resourceId);
if (opened.status !== 'completed') throw new Error(opened.error.message);
const documentId = opened.value.documentId;
async function call(operation, params = {}) {
  const document = api.listDocuments().documents.find(d => d.identity.id === documentId);
  const result = await api.execute({ apiVersion: '1', requestId: `call-${++seq}`,
    operation, documentId, expectedRevision: document.revision, params });
  if (result.status !== 'completed') throw new Error(result.error.message);
  return result.value;
}
const document = await call('image.document.query');
await call('image.layer.opacity', { layerId: document.layers[0].id, opacity: 0.5 });
await call('image.history.undo');
const file = await call('image.document.export', { format: 'psd' });
const bytes = api.readResource(file.resourceId);
api.releaseResource(file.resourceId);
// The host can now save/transfer bytes according to its own file/IPC policy.
```

Verification: each product's `test/operations.test.mjs` executes the real operation service,
checks the live model, reopens exported bytes and tests rollback. After building the three apps,
`npm run test:operations:browser` performs the loop against all three running browser products
through the facade and reparses their PSD/HYA/VOX exports. Set `CHROME_PATH` when necessary.


## Unified Electron IPC and local JSON-RPC

The SDK exports `EditorRpcRequest`, `EditorRpcResponse`, `EditorRpcBridge` and chunk/file limits.
`EditorPlatform.rpc` owns transport-independent dispatch, per-client jobs and resources. App Kit
assembles the same sandboxed preload and native broker for all products. Image, HYA and Voxel
register their renderer bridge; Scene has no domain RPC binding in this release.

- **IPC:** `window.haiyueEditorIPC.request({jsonrpc:'2.0',id:'request-1',method:'operations.list',params:{}})`.
  Only the exact main frame of the packaged entry URL is accepted. No raw IPC, filesystem or
  code-evaluation capability is exposed. Renderer reload/crash rejects pending calls and changes
  the reply generation; late replies cannot settle new requests.
- **Local RPC:** disabled by default. Start the assembled Electron product with `--editor-rpc`
  or `HAIYUE_EDITOR_RPC=1`. `HAIYUE_EDITOR_RPC_PORT` defaults to `0` (OS-assigned port).
  Example: `HAIYUE_EDITOR_RPC=1 npm run electron:start -w imageEditor`.
  The current endpoint is written atomically to `app.getPath('userData')/editor-rpc.json`
  with permissions `0600`: `{apiVersion,url,token,pid}`. The host removes its own descriptor on
  clean close. A descriptor left after forced process termination is stale; never assume its PID
  or endpoint is live. Tokens are regenerated on each host start.
- HTTP binds **127.0.0.1 only**, checks the exact Host, requires `Authorization: Bearer <token>`
  and rejects requests with an Origin header. The token grants access to all registered editor
  commands; this is a local trusted-client interface, not a multi-user server.
- Create a client with `POST /sessions` (empty body), then send `POST /rpc/v1` with
  `Content-Type: application/json` and `X-Haiyue-Session: <sessionId>`. Close using
  `DELETE /session` with the same headers. HTTP authentication/transport errors are non-2xx;
  valid JSON-RPC responses are HTTP 200, including RPC errors.

JSON-RPC requires a nonempty string ID and object params. Batches and notifications are not
supported. Methods: `rpc.discover`, `documents.list`, `operations.list`, `operations.execute`
(params is the complete operation envelope), `operations.cancel` (`{requestId}`), and:

| Resource method | Params / result |
| --- | --- |
| `resources.begin` | `{byteLength}` → `{uploadId}` |
| `resources.append` | `{uploadId,offset,base64}` → next `{offset}`; contiguous canonical Base64 chunks |
| `resources.finish` | `{uploadId}` → `{resourceId,byteLength}` after every byte arrives |
| `resources.abort` | `{uploadId}` discards an unfinished upload |
| `resources.read` | `{resourceId,offset,length}` → `{byteLength,offset,base64}` |
| `resources.release` | `{resourceId}`; idempotent for this session |

Limits: 64 KiB decoded chunks, 128 MiB/file, one unfinished upload/client, 128 MiB total upload
reservations, 1 MiB HTTP body, 16 platform sessions, 32 calls/session and 128 native calls.
The platform resource-store limit remains 64 files / 256 MiB. Resource IDs cannot be used across
sessions. Completed exports become owned by the calling session. Closing a session cancels its
queued/preparing operations and releases uploads/exports after cleanup. A broken HTTP response
closes that client; idle sessions expire after five minutes. Long-running requests are subject
to the native broker's 30-second timeout, which cancels the session but cannot undo an already
committed write. **No automatic write retries:** query the live document/revision after an
unknown transport outcome. Domain failures retain the operation result envelope; RPC failures
use `-32600`/`-32601`/`-32602`/`-32603`, resource/admission failures use `-32000`.

### Node client example

`@haiyue/editor-app-kit/node` exports `createEditorRpcClient` (Node 22+). It opens one session,
encodes/decodes binary chunks and never retries operations. Always close it in `finally`.

```js
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createEditorRpcClient } from '@haiyue/editor-app-kit/node';
const client = await createEditorRpcClient(JSON.parse(await readFile(endpointFile, 'utf8')));
try {
  const input = await client.upload(await readFile('input.psd'));
  const opened = await client.execute({ apiVersion: '1', requestId: randomUUID(),
    operation: 'image.document.open',
    params: { resourceId: input.resourceId, name: 'input.psd', format: 'psd' } });
  await client.release(input.resourceId);
  if (opened.status !== 'completed') throw Error(opened.error.message);
  const documentId = opened.value.documentId;
  async function call(operation, params = {}) {
    const doc = (await client.request('documents.list')).documents.find(d => d.identity.id === documentId);
    const result = await client.execute({ apiVersion: '1', requestId: randomUUID(), operation,
      documentId, expectedRevision: doc.revision, params });
    if (result.status !== 'completed') throw Error(result.error.message);
    return result.value;
  }
  const document = await call('image.document.query');
  await call('image.filter.apply', { layerId: document.layers[0].id, kind: 'invert', amount: 100 });
  const exported = await call('image.document.export', { format: 'psd' });
  await writeFile('output.psd', await client.download(exported));
  await client.release(exported.resourceId);
} finally { await client.close(); }
```

## Expanded domain commands

`operations.list` is the authoritative runtime schema. Every document write, including undo/redo
and selections, requires its current `expectedRevision`. Queries include `canUndo`/`canRedo`.

| Product | Additional commands |
| --- | --- |
| Image | `document.rename`, `layer.create` (pixel/group), `layer.update` (name, visibility, lock, opacity, blend, position), `filters.query`, `filter.apply`, `selection.set` (rectangle/ellipse), `selection.invert`, `selection.clear`, `document.crop`, `history.redo` |
| HYA 2D | `node.create` (group/rectangle/ellipse), `node.transform`, `track.create` (position/rotation/scale/opacity), `keyframe.set`, paginated `tracks.query` / `keyframes.query`, `history.redo` |
| Voxel | `cells.patch` (up to 10,000 distinct base-scene coordinates, set/remove), `layer.create`, `layer.update`, `history.redo` |

Prefix each command with `image.`, `hya.` or `voxel.`. Image filters respect the current selection
and layer locks; `filters.query` reports each integer amount range/unit/default. HYA keys use
existing frame snapping and require the track's value dimension; node and ancestor locks apply.
Voxel batches prepare on an isolated domain model, validate the whole batch and commit as one
undo entry, including palette changes. Invalid later cells cannot partially modify the document.
History-budget limits still apply to complete Voxel snapshots.

Validation: `npm run test:operations:electron` (after building/assembling all three products)
launches real generated Electron bootstraps with isolated temporary profiles, exercises both
sandboxed IPC and external local HTTP, transfers >1 MiB of binary data, and runs domain
edit → undo → redo → export with real PSD/HYA/VOX reparsing. This runner requires a desktop
Electron environment. Platform/App Kit unit tests also cover protocol failures, isolation,
cancellation, main-frame validation, stale responses and descriptor ownership.
