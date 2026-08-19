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
