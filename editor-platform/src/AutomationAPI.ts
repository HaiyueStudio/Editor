import type { EditorPlatform } from './EditorPlatform.js';
import type { EditorOperationRequest } from '@haiyue/editor-plugin-sdk';

/** In-process host facade; an IPC adapter can forward the same request envelopes. */
export function createEditorAutomationAPI(platform: EditorPlatform) {
  return Object.freeze({
    apiVersion: '1' as const,
    listOperations: () => platform.operations.list(),
    listDocuments: () => platform.documents.snapshot(),
    execute: (request: EditorOperationRequest, options?: { readonly signal?: AbortSignal }) => platform.operations.execute(request, options),
    cancel: (requestId: string) => platform.operations.cancel(requestId),
    putResource: (bytes: Uint8Array) => platform.resources.put(bytes),
    readResource: (resourceId: string) => platform.resources.read(resourceId),
    releaseResource: (resourceId: string) => platform.resources.release(resourceId),
  });
}
