import type { EditorJsonValue } from './operations.js';

/** JSON-RPC 2.0, explicit IDs, no batches/notifications, bounded binary chunks. */
export interface EditorRpcRequest {
  readonly jsonrpc: '2.0'; readonly id: string; readonly method: string; readonly params: EditorJsonValue;
}
export type EditorRpcResponse =
  | { readonly jsonrpc: '2.0'; readonly id: string; readonly result: EditorJsonValue }
  | { readonly jsonrpc: '2.0'; readonly id: string | null; readonly error: { readonly code: number; readonly message: string } };
export interface EditorRpcBridge {
  /** Only the preload may deliver main-process requests. null closes this client's session. */
  onRequest(handler: (sessionId: string, request: EditorRpcRequest | null) => Promise<EditorRpcResponse | null>): () => void;
  request(request: EditorRpcRequest): Promise<EditorRpcResponse>;
}
export const EDITOR_RPC_CHUNK_BYTES = 64 * 1024;
export const EDITOR_RPC_MAX_FILE_BYTES = 128 * 1024 * 1024;
