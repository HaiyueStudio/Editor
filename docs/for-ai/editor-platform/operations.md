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

### Image daily editing commands

The renderer API, sandboxed IPC and local RPC discover and dispatch the same commands.
Use `operations.list` (or `haiyueEditor.listOperations()`) for the actual bounded input schemas.
All document writes require `expectedRevision`; failed commits restore pixels, selection, dirty
state and history including redo. Coordinates are document pixels unless stated otherwise.

| Area | Commands (prefix `image.`) | Contract |
| --- | --- | --- |
| Documents/codecs | `document.create`, `document.open`, `document.export`, `layer.import` | Create bounded canvases; open project/PSD/PNG/JPEG. Export project/PSD/PNG/JPEG. Import PNG/JPEG as a root layer. Codec work runs in the renderer. PSD conversion requires explicit `allowRasterize: true` when lossy; no silent fallback. JPEG uses white behind transparency and `quality` 0.1–1. |
| Inspection | `document.query`, `color.sample` | Query includes primary and multiple selected IDs, parent IDs, pixel dimensions, editable content and mask metadata. Sample integer x/y returns encoded RGBA8 and hex; omit layerId for visible composite, provide it for isolated layer rendering including its opacity/mask. |
| Pixel clipboard | `pixels.copy`, `pixels.paste` | Copy crops to the current selection and weights alpha by feather coverage. Returns owned binary resource plus format `rgba8`, width/height and document x/y. Paste requires resourceId/width/height; optional x/y default zero. Creates one root layer and one undo entry. Resource size must equal width×height×4; release copied resources after use. |
| Pixel editing | `pixels.fill`, `pixels.stroke`, `pixels.gradient` | Fill/stroke take layerId, optional color/opacity/erase; stroke requires bounded points and size. `target: "mask"` edits the enabled mask (black hides; white reveals). Gradient requires start/end, from/to hex colors and linear/radial kind. Selection coverage, locks and pixel budgets apply; editable text/shapes must first be rasterized. |
| Selections | `selection.all`, `selection.set`, `selection.polygon`, `selection.color`, `selection.wand`, `selection.modify` | Rectangle/ellipse, polygon/lasso points, color range, sampled wand and feather/expand/contract. Set/polygon/color/wand accept replace/add/subtract/intersect mode. Wand defaults contiguous, samples RGBA including alpha; optional layerId controls source. Modify radius 1–64. Existing invert/clear remain available. |
| Layers | `layers.select`, `layers.move`, `layers.align`, `layers.merge` | Explicit layerIds; selected ancestors prune selected descendants. Move uses integer dx/dy. Align uses left/center/right/top/middle/bottom relative to selection union (default) or canvas. Selection alone is view state and does not increment revision/history. |
| Layer details | `layer.delete`, `layer.duplicate`, `layer.reorder`, `layer.rasterize`, `layer.transform` | Explicit layerId. Reorder up/down within siblings. Transform requires width/height; angle/dx/dy default zero, flipX/flipY false. Nearest-neighbor, center-based pixel transform. Masks and text/shapes must first be applied/rasterized; smart objects retain their original source. |
| Editable content | `content.create`, `content.update` | Create requires name/content; update requires layerId/content. Supply a complete text, shape or adjustment object from query/schema; missing type-specific fields fail validation. Text/shape previews rasterize in the renderer; editable parameters remain in projects. Create x/y are root coordinates. |
| Masks | `mask.update`, `layer.mask.apply` | Update action fromSelection/invert/enable/disable/remove. FromSelection without selection reveals the canvas. Apply explicitly bakes an enabled mask into a raster layer. |

Merge requires visible, unlocked, contiguous siblings whose top-level blend mode is normal;
standalone adjustment layers are rejected because they depend on the unselected backdrop.
Nested normal groups remain composited with their existing masks and adjustments. This
constraint preserves the visible result instead of silently changing unrelated layers.

Example using the existing revision-aware `call` helper:

```js
const snapshot = await call('image.document.query');
const layerId = snapshot.selectedId;
const copy = await call('image.pixels.copy', { layerId });
try {
  await call('image.pixels.paste', {
    resourceId: copy.resourceId, width: copy.width, height: copy.height,
    x: copy.x + 20, y: copy.y + 20, name: '选区副本',
  });
} finally { api.releaseResource(copy.resourceId); }
await call('image.history.undo');
const png = await call('image.document.export', { format: 'png' });
// readResource / RPC download, then releaseResource / RPC release.
```

UI: I samples the visible composite into foreground color; G drags a linear/radial gradient.
Cmd/Ctrl+C/V uses an editor-local pixel clipboard shared across its documents (not the system
clipboard). Cmd/Ctrl-click toggles layer selection; Shift-click selects a visible range. The
move tool moves all selected roots; alignment and merge are in the layer panel. Cmd/Ctrl+T
opens interactive single-layer free transform: drag interior, edge/corner handles or rotation
handle, then Enter to commit or Esc to cancel. Scaling is center-based. An external document
mutation, tool change, pointer cancellation, window blur or document switch cancels previews.

The Engine CMYK object is a separate color-authoring API in `@haiyue/engine/color`; this batch
does not change the editor's RGB8 document/PSD support or add ICC print conversion.

### Image non-destructive commands

These additions bring Image Editor to 46 operations, all using the same renderer/IPC/RPC
registry. Query includes `clipping`, `styles`, adjustment parameters, and a bounded smart
summary (`sourceWidth`, `sourceHeight`, `sourceId`, `name`, `transform`); no source bytes in JSON.

| Command (prefix `image.`) | Parameters and behavior |
| --- | --- |
| `layer.clipping` | `layerId`, `enabled`. Enable requires a lower non-clipped pixel/group sibling as base. Consecutive clipped siblings share base alpha; base opacity applies once. |
| `layer.styles` | `layerId`, either `styles` or `remove: true`. Styles has required `enabled`; optional `overlay: {color, opacity}`, `stroke: {color, opacity, size}`, `shadow: {color, opacity, dx, dy, blur}`. Hex RGB, opacity 0–1, stroke 1–64, integer dx/dy ±256, blur 0–64. Normal blend only, pixel/group layers only. |
| `smart.convert` | `layerId`. An unlocked raster layer becomes an independent embedded source with an identity transform; original source pixels are copied and owned. |
| `smart.source` | `layerId`. Read returns owned RGBA8 binary resource, width, height, name; release resource when finished. |
| `smart.replace` | `layerId`, `resourceId`, `width`, `height`, `name`. Exact RGBA8 length, dimension/budget checks; replaces source while preserving transform, one undo entry. No external links are fetched. |
| `layer.transform` (extended) | Smart layers use absolute width/height/angle/flip relative to original source; dx/dy translate current center. Defaults remain angle/dx/dy=0 and flips=false. Every preview and commit resamples the source rather than previously resized pixels. |
| `content.create/update` (extended) | Adjustment `filter: 'levels'`, `amount: 100`, `levels: {black, white, gamma, outputBlack, outputWhite}`; or `filter: 'curves'`, `amount: 100`, `curves: [{input, output}, ...]`. Black ≤253, white ≥2, black<white, outputs ordered 0–255; gamma 0.10–9.99 in hundredths. Curves: 2–16 ordered integer points, endpoints input 0 and 255. Use layer opacity for strength. Text optionally accepts `fontName`; unavailable fonts use the chosen family fallback. |

Native PSD exports now preserve the supported basic text/shape/levels/curves/invert,
clipping, effects and embedded pixel smart objects. Unsupported content still needs explicit
`allowRasterize: true`, which flattens **only the exported copy**. This is not full PSD fidelity;
read the [native support matrix](../../../imageEditor/docs/non-destructive-and-native-psd.md).

```js
await call('image.smart.convert', { layerId });
await call('image.layer.transform', { layerId, width: 400, height: 300, angle: 15 });
await call('image.layer.styles', {
  layerId, styles: { enabled: true, stroke: { color: '#ffffff', opacity: 1, size: 3 } },
});
await call('image.content.create', {
  name: 'RGB curves',
  content: { type: 'adjustment', filter: 'curves', amount: 100,
    curves: [{ input: 0, output: 0 }, { input: 128, output: 160 }, { input: 255, output: 255 }] },
});
const psd = await call('image.document.export', { format: 'psd' });
// Download/read the resource, then release it.
```

## Image professional / production commands

This professional-production milestone brought Image to 51 commands; the processing-quality extension below brings it to 52. `image.pixels.stroke` adds hardness and optional per-point pressure; `image.retouch.stroke` adds immutable clone/heal sampling. `image.selection.refine` and `image.color.convert` prepare cancellable Worker results and commit one document history entry with the normal revision guard. `image.color.query` reports the bounded RGB ICC contract. `image.content.create/update` accepts Bezier path nodes and rich text runs / wrap width.

`image.batch.run` is a workspace operation on resource handles: up to 16 inputs, 32 ordered fit/filter steps, and 128 MiB total input/output limits. It exports isolated flattened copies, reports progress and per-file errors, rejects unsupported PSD/ICC instead of silently flattening on admission, and rolls back already allocated output resources if commit fails. Cancellation publishes no partial outputs. The same descriptors are exposed by in-process discovery, IPC and local RPC. See [Image professional production contract](../../../imageEditor/docs/professional-production.md) for parameters and limitations.

### Image processing quality

处理质量这一批完成时为 52 个领域命令（下方第二批扩展到 55 个）。新增只读 `image.histogram.query({layerId?,selection?})`，返回 RGBA8 编码值下的 R/G/B／亮度 256 桶及加权统计。Alpha × 选区覆盖率作为权重；完全透明像素不计入。

`image.layer.transform` 增加可选 `resampling: nearest|bilinear|bicubic|lanczos`，新变换默认 `bicubic`。`image.content.create/update` 的曲线／色阶内容增加 `channels.red/green/blue`，子项使用对应 `curves` 或 `levels`；主 RGB 字段保持原契约。`image.filter.apply` 增加 `gaussian`（amount 为 σ，0.1–32）和 `usm`（amount 0–500%，radius 0.1–32，threshold 0–255）；radius／threshold 仅用于 USM，默认 2／0。滤镜在浏览器使用可取消 Worker，提交继续受 revision 与原子写入约束。

`image.batch.run` 的 fit 支持 resampling，filter 支持相同高斯／USM 参数。所有接口自动通过现有 IPC／本地 RPC 暴露，无新增传输专用命令。完整口径见 `imageEditor/docs/processing-quality.md`。

### Image 非破坏性处理链

第二批扩展后共有 55 个图像命令：`image.smart.filters({layerId,filters})` 完整替换可取消计算的有序智能滤镜；`image.layer.blend-if({layerId,rule})` 设置单通道分离颜色带（`remove:true` 删除）；`image.mask.settings({layerId,target?,density?,feather?,disabled?})` 修改蒙版参数。`mask.update` 新增 `target: layer|filter`；`pixels.fill/stroke` 的 target 新增 `filterMask`。查询返回新效果及蒙版元数据，不存在时为 null。

调用仍经同一 Platform 队列、revision 检查及原子历史提交，浏览器、IPC／RPC 契约一致。完整格式、渲染顺序、示例、版本门禁及 PSD 兼容范围见 [非破坏性处理链](../../../imageEditor/docs/non-destructive-pipeline.md)。

### Image 生产效率扩展

第三批将图像命令扩展到 65 个：`channel.save/update/delete/load/read`、`layout.set`、`action.save/delete/run`、`template.export`。领域写操作仍使用 documentId／expectedRevision，`channel.read` 返回独立 gray8 资源。动作在隔离快照中执行，成功后一次提交历史；模板导出不改变原稿，取消不发布部分结果，资源分配失败回滚已分配句柄。

查询新增通道元数据、参考线／吸附配置与动作定义；工程 v8／恢复 v9 完整保存。本批生产数据尚不映射 PSD，导出须明确确认省略。参数、动作白名单、模板数据行、尺寸适配及限制见 [生产效率契约](../../../imageEditor/docs/productivity.md)。

## 图像第四批扩展

新增 `image.smart.source.read`、`image.smart.source.replace`（document 目标）和 `image.color.precision`（workspace 目标），图像命令共 68 个。多层智能源通过工程／PSD 资源回写，使用父文档版本锁并支持一次撤销；高精度转换为独立的 RGBA16LE／RGBA32FLE SDR 资源转换，不改变 RGB8 文档。IPC／本地 RPC 使用相同调用契约。详见 [兼容性与基础能力](../../../imageEditor/docs/compatibility-foundations.md)。
