import { copyEditorJson, EDITOR_RPC_CHUNK_BYTES, EDITOR_RPC_MAX_FILE_BYTES,
  type EditorDisposable, type EditorJsonValue, type EditorOperationRequest, type EditorRpcBridge, type EditorRpcResponse } from '@haiyue/editor-plugin-sdk';
import type { EditorPlatform } from './EditorPlatform.js';

type RecordValue = { readonly [key: string]: EditorJsonValue };
interface Client {
  closed: boolean; resources: Set<string>; calls: Set<string>; jobs: Map<string, Promise<unknown>>;
  upload?: { id: string; bytes: Uint8Array; offset: number };
}
class RpcFault extends Error { constructor(readonly code: number, message: string) { super(message); } }
const object = (value: EditorJsonValue): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RpcFault(-32602, 'Expected object params.');
  return value as RecordValue;
};
function fields(params: RecordValue, keys: string[]) {
  if (Object.keys(params).some(key => !keys.includes(key))) throw new RpcFault(-32602, 'Unknown parameter.');
}
function string(value: EditorJsonValue | undefined): string {
  if (typeof value !== 'string' || !value || value.length > 160) throw new RpcFault(-32602, 'Invalid identifier.');
  return value;
}
function integer(value: EditorJsonValue | undefined, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new RpcFault(-32602, 'Invalid byte range.');
  return value;
}

/** Transport-independent client ownership and dispatch. No sockets, DOM or Electron imports. */
export class EditorRpcHost implements EditorDisposable {
  private clients = new Map<string, Client>();
  private bindings = new Set<() => void>();
  private reservedBytes = 0;
  private disposed = false;
  constructor(private readonly platform: EditorPlatform) {}

  connect(bridge: EditorRpcBridge | undefined): EditorDisposable {
    if (!bridge) return { dispose() {} };
    if (this.disposed) throw new Error('RPC host disposed.');
    const off = bridge.onRequest(async (session, request) => {
      if (request === null) { await this.close(session); return null; }
      return this.request(session, request);
    });
    this.bindings.add(off);
    return { dispose: () => { if (this.bindings.delete(off)) off(); } };
  }

  async request(sessionId: string, input: unknown): Promise<EditorRpcResponse> {
    let id: string | null = null, client: Client | undefined, admitted = false;
    try {
      let raw: RecordValue;
      try { raw = object(copyEditorJson(input)); }
      catch { throw new RpcFault(-32600, 'Invalid RPC envelope.'); }
      if (raw.jsonrpc !== '2.0' || typeof raw.id !== 'string' || !raw.id || raw.id.length > 160 || typeof raw.method !== 'string'
        || !Object.hasOwn(raw, 'params') || Object.keys(raw).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key))) throw new RpcFault(-32600, 'Invalid RPC envelope.');
      id = raw.id;
      if (this.disposed) throw new RpcFault(-32000, 'RPC host disposed.');
      if (!sessionId || sessionId.length > 160) throw new RpcFault(-32600, 'Invalid session.');
      client = this.clients.get(sessionId);
      if (!client) {
        if (this.clients.size >= 16) throw new RpcFault(-32000, 'Client limit exceeded.');
        client = { closed: false, resources: new Set(), calls: new Set(), jobs: new Map() }; this.clients.set(sessionId, client);
      }
      if (client.closed || client.calls.size >= 32 || client.calls.has(id)) throw new RpcFault(-32000, 'Session closed, busy or duplicate RPC id.');
      client.calls.add(id); admitted = true;
      const result = await this.dispatch(client, raw.method, object(raw.params!));
      return { jsonrpc: '2.0', id, result: copyEditorJson(result) };
    } catch (error) {
      return { jsonrpc: '2.0', id, error: { code: error instanceof RpcFault ? error.code : -32603,
        message: (error instanceof Error ? error.message : 'RPC failed.').slice(0, 2000) } };
    } finally { if (admitted && id) client?.calls.delete(id); }
  }

  private async dispatch(client: Client, method: string, params: RecordValue): Promise<unknown> {
    const platform = this.platform;
    switch (method) {
      case 'rpc.discover': fields(params, []); return { apiVersion: '1', chunkBytes: EDITOR_RPC_CHUNK_BYTES, maxFileBytes: EDITOR_RPC_MAX_FILE_BYTES,
        methods: ['rpc.discover', 'documents.list', 'operations.list', 'operations.execute', 'operations.cancel', 'resources.begin', 'resources.append', 'resources.finish', 'resources.abort', 'resources.read', 'resources.release'] };
      case 'documents.list': fields(params, []); return platform.documents.snapshot();
      case 'operations.list': fields(params, []); return platform.operations.list();
      case 'operations.execute': {
        // The operation dispatcher still validates the complete versioned envelope and schemas.
        const requestId = string(params.requestId);
        if (client.jobs.has(requestId)) throw new RpcFault(-32000, 'Duplicate operation request id.');
        this.checkResources(client, params.params ?? null);
        const internalId = `rpc-${crypto.randomUUID()}`;
        const request = { ...params, requestId: internalId } as unknown as EditorOperationRequest;
        const controller = new AbortController();
        const job = platform.operations.execute(request, { signal: controller.signal });
        // Keep cancellation handles separate from caller-controlled operation IDs.
        this.controllers.set(job, controller);
        client.jobs.set(requestId, job);
        try {
          const result = await job;
          if (result.status === 'completed') this.ownResources(client, result.value);
          return { ...result, requestId };
        } finally { client.jobs.delete(requestId); this.controllers.delete(job); }
      }
      case 'operations.cancel': {
        fields(params, ['requestId']); const job = client.jobs.get(string(params.requestId));
        const controller = job && this.controllers.get(job);
        if (controller) controller.abort();
        return { requested: Boolean(controller) };
      }
      case 'resources.begin': {
        fields(params, ['byteLength']); const size = integer(params.byteLength, EDITOR_RPC_MAX_FILE_BYTES);
        if (client.upload || this.reservedBytes + size > EDITOR_RPC_MAX_FILE_BYTES) throw new RpcFault(-32000, 'Upload budget exceeded.');
        const upload = { id: crypto.randomUUID(), bytes: new Uint8Array(size), offset: 0 };
        client.upload = upload; this.reservedBytes += size;
        return { uploadId: upload.id };
      }
      case 'resources.append': {
        fields(params, ['uploadId', 'offset', 'base64']); const upload = this.upload(client, params.uploadId);
        const offset = integer(params.offset, upload.bytes.length), encoded = params.base64;
        if (offset !== upload.offset || typeof encoded !== 'string' || encoded.length > Math.ceil(EDITOR_RPC_CHUNK_BYTES / 3) * 4
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new RpcFault(-32602, 'Invalid upload chunk.');
        const decoded = atob(encoded);
        if (decoded.length > EDITOR_RPC_CHUNK_BYTES || offset + decoded.length > upload.bytes.length || btoa(decoded) !== encoded) throw new RpcFault(-32602, 'Invalid upload chunk.');
        upload.bytes.set(Uint8Array.from(decoded, character => character.charCodeAt(0)), offset); upload.offset += decoded.length;
        return { offset: upload.offset };
      }
      case 'resources.finish': {
        fields(params, ['uploadId']); const upload = this.upload(client, params.uploadId);
        if (upload.offset !== upload.bytes.length) throw new RpcFault(-32602, 'Upload is incomplete.');
        const ref = platform.resources.put(upload.bytes); client.resources.add(ref.resourceId); this.dropUpload(client); return ref;
      }
      case 'resources.abort': fields(params, ['uploadId']); this.upload(client, params.uploadId); this.dropUpload(client); return { released: true };
      case 'resources.read': {
        fields(params, ['resourceId', 'offset', 'length']); const id = string(params.resourceId); this.checkResource(client, id);
        const size = platform.resources.size(id), offset = integer(params.offset, size), length = integer(params.length, EDITOR_RPC_CHUNK_BYTES);
        const bytes = platform.resources.read(id, offset, Math.min(length, size - offset));
        let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return { byteLength: size, offset, base64: btoa(binary) };
      }
      case 'resources.release': {
        fields(params, ['resourceId']); const id = string(params.resourceId);
        if (client.resources.delete(id)) platform.resources.release(id);
        return { released: true };
      }
      default: throw new RpcFault(-32601, 'Method not found.');
    }
  }
  private controllers = new Map<Promise<unknown>, AbortController>();
  private checkResource(client: Client, id: string) { if (!client.resources.has(id)) throw new RpcFault(-32602, 'Resource does not belong to this session.'); }
  private checkResources(client: Client, value: EditorJsonValue): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'resourceId') this.checkResource(client, string(item));
      else this.checkResources(client, item);
    }
  }
  private ownResources(client: Client, value: EditorJsonValue): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'resourceId' && typeof item === 'string') {
        if (client.closed) this.platform.resources.release(item); else client.resources.add(item);
      } else this.ownResources(client, item);
    }
  }
  private upload(client: Client, id: EditorJsonValue | undefined) {
    if (!client.upload || client.upload.id !== string(id)) throw new RpcFault(-32602, 'Unknown upload.');
    return client.upload;
  }
  private dropUpload(client: Client) { if (client.upload) { this.reservedBytes -= client.upload.bytes.length; delete client.upload; } }
  async close(sessionId: string): Promise<void> {
    const client = this.clients.get(sessionId); if (!client) return;
    client.closed = true; this.dropUpload(client);
    for (const job of client.jobs.values()) this.controllers.get(job)?.abort();
    await Promise.allSettled(client.jobs.values());
    for (const id of client.resources) this.platform.resources.release(id);
    client.resources.clear(); if (this.clients.get(sessionId) === client) this.clients.delete(sessionId);
  }
  async dispose(): Promise<void> {
    if (this.disposed) return; this.disposed = true;
    for (const off of this.bindings) off(); this.bindings.clear();
    await Promise.all([...this.clients.keys()].map(id => this.close(id)));
  }
}
