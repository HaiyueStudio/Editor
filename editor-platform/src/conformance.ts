import {
  EDITOR_PLUGIN_API_VERSION,
  defineEditorPlugin,
  defineEditorProduct,
  type EditorDocumentAdapter,
} from '@haiyue/editor-plugin-sdk';
import { EditorPlatform } from './EditorPlatform.js';

export async function runEditorPluginConformance(): Promise<Readonly<{ disposed: readonly string[] }>> {
  const disposed: string[] = [];
  const provider = defineEditorPlugin({
    id: 'conformance.provider', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION,
    provides: ['conformance.service'],
    activate({ scope }) { scope.defer(() => { disposed.push('provider'); }); },
  });
  const consumer = defineEditorPlugin({
    id: 'conformance.consumer', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION,
    requiredCapabilities: ['conformance.service'],
    activate({ scope }) { scope.defer(() => { disposed.push('consumer'); }); },
  });
  const product = defineEditorProduct({
    schemaVersion: 1, id: 'conformance', version: '0.1.0', displayName: 'Conformance',
    requiredPlugins: [provider, consumer],
  });
  const platform = new EditorPlatform();
  await platform.start(product);
  await platform.dispose();
  return Object.freeze({ disposed: Object.freeze(disposed) });
}

export async function runEditorDocumentConformance(factory: () => EditorDocumentAdapter): Promise<void> {
  const platform = new EditorPlatform();
  const adapter = factory();
  platform.documents.attach(adapter);
  const before = platform.documents.snapshot().documents[0];
  if (!before || before.identity.id !== adapter.identity.id || !before.active) {
    throw new Error('Document adapter did not attach as the active document.');
  }
  await adapter.serialize();
  await platform.documents.close(adapter.identity.id);
  if (platform.documents.snapshot().documents.length !== 0) throw new Error('Document adapter did not close cleanly.');
  await platform.dispose();
}

/** Exercise the public invocation contract without DOM, product models, or transport adapters. */
export async function runEditorOperationConformance(): Promise<Readonly<{ revision: number; value: number }>> {
  const platform = new EditorPlatform();
  let revision = 1, value = 0;
  platform.documents.attach({
    identity: { id: 'operation-fixture', name: 'Operation fixture', kind: 'conformance.document' },
    get revision() { return revision; }, savedRevision: 1,
    serialize: () => ({ value }), markSaved() {}, subscribe: () => ({ dispose() {} }), dispose() {},
  });
  platform.operations.register({
    ownerId: 'conformance',
    descriptor: {
      id: 'conformance.set', version: 1, title: 'Set fixture value', target: 'document', access: 'write',
      input: { type: 'integer', minimum: 0 }, output: { type: 'integer' },
    },
    prepare(next: number) { return { next, value, revision }; },
    commit(prepared) { value = prepared.next; revision++; return value; },
    rollback(prepared, context) { if (prepared && context.commitStarted) { value = prepared.value; revision = prepared.revision; } },
  });
  try {
    const first = await platform.operations.execute({ apiVersion: '1', requestId: 'first', operation: 'conformance.set', documentId: 'operation-fixture', expectedRevision: 1, params: 7 });
    if (first.status !== 'completed' || first.value !== 7 || first.document?.revision !== 2) throw new Error('Operation conformance: successful commit was not observable.');
    const stale = await platform.operations.execute({ apiVersion: '1', requestId: 'stale', operation: 'conformance.set', documentId: 'operation-fixture', expectedRevision: 1, params: 9 });
    if (stale.status !== 'failed' || stale.error.code !== 'REVISION_CONFLICT' || value !== 7) throw new Error('Operation conformance: stale mutation was not rejected.');
    return Object.freeze({ revision, value });
  } finally { await platform.dispose(); }
}
