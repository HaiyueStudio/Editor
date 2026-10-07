# Shared operation API v1

`EditorPlatform.operations` is the public in-process invocation service. Plugins access the same instance through the typed `editorServiceTokens.operations` token. It is independent of the product, DOM, renderer, storage, network transport and any AI integration. Existing UI actions are not automatically registered; products must provide domain handlers before those actions become callable. No IPC, HTTP or Agent adapter is added by this layer.

## Contract and discovery

`@haiyue/editor-plugin-sdk` exports `EDITOR_OPERATION_API_VERSION = '1'`, request/result/event contracts, `EditorOperationDefinition`, the service port, and descriptor/value validation helpers. Operation protocol version, plugin API version and project-format versions are separate.

- `register(definition)` returns an idempotent **asynchronous** disposable. Every definition has an `ownerId`, stable operation ID, descriptor version 1, title, document/workspace target, read/write classification and input/output schemas. Optional `documentKinds` restrict document operations.
- `list()` returns detached, deeply frozen descriptors with owner IDs, sorted by operation ID. IDs must be unique; registration never replaces a live command implicitly.
- `execute(request, {signal?})` resolves a structured completed/failed/cancelled result. The envelope contains `apiVersion`, `requestId`, `operation`, `params`, and, for document operations, `documentId` and optional `expectedRevision`. Document writes require `expectedRevision`.
- `subscribe(listener)` receives queued/preparing/committing/rolling-back and terminal events, with progress or structured errors as applicable. Requests rejected before admission return an error directly and produce no task events. Listener failures are isolated and reported as diagnostics.
- `cancel(requestId)` cancels queued or preparing work. Unknown, settled, already cancelled, or synchronously committing operations return false. An external AbortSignal has the same semantics.

Request IDs must be unique **while in flight**. Completed results are not cached and this API does not promise exactly-once delivery across retries or process restarts. A later transport adapter must decide its retry/receipt policy.

The v1 schema vocabulary supports null/boolean, finite number/safe integer with bounds, string with length/enum, arrays, closed objects with required fields, and an explicit `json` escape hatch for domain-validated data. It is not full JSON Schema. Unknown schema keywords and object fields reject. JSON inputs/results are copied and frozen, with at most 100,000 visited values, depth 32, and 1,048,576 text/key characters. Cycles, sparse arrays, accessors, functions, undefined, binary arrays and non-plain objects reject. Large pixels/assets should be represented by product-managed references; binary transfer is outside v1. Product semantic validation belongs in `prepare`, even when a schema accepts the data structurally.

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

`EditorOperationService` does not create a parallel document model or history stack. Products register `image.*`, `hya.*`, `voxel.*` and other operations while retaining their domain formats, codecs and renderers. This first layer does not yet register document open/save, product editing commands, binary artifact services, IPC or network endpoints. Those adapters can all invoke this same API later.

Validation: SDK schema/boundary tests; Platform scheduling, concurrency, cancellation, owner disposal, document replacement, rollback and observer tests; `runEditorOperationConformance()` from the existing `@haiyue/editor-platform/conformance` export. Existing plugin API version 1 and package export paths are preserved.
