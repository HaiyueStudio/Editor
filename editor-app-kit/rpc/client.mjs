import { randomUUID } from 'node:crypto';

/** Node 22+ client. One session owns its uploads, exports and cancellation IDs. Never retries writes. */
export async function createEditorRpcClient({ url, token, signal } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw Error('Expected a loopback RPC URL.');
  if (typeof token !== 'string' || !token) throw Error('RPC token is required.');
  let sessionId, closed = false;
  const headers = { Authorization: `Bearer ${token}` };
  async function http(path, method, body, requestSignal = signal) {
    const response = await fetch(new URL(path, endpoint), { method, signal: requestSignal,
      headers: { ...headers, ...(sessionId ? { 'X-Haiyue-Session': sessionId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
    if (!response.ok) throw Error(`RPC HTTP ${response.status}; ${await response.text()}`);
    return response.json();
  }
  sessionId = (await http('/sessions', 'POST')).sessionId;
  async function request(method, params = {}, options = {}) {
    if (closed) throw Error('RPC client closed.');
    const id = randomUUID();
    const response = await http('/rpc/v1', 'POST', JSON.stringify({ jsonrpc: '2.0', id, method, params }), options.signal ?? signal);
    if (response.jsonrpc !== '2.0' || response.id !== id) throw Error('Invalid RPC response.');
    if (response.error) throw Object.assign(Error(response.error.message), { code: response.error.code });
    return response.result;
  }
  return Object.freeze({ request,
    execute: envelope => request('operations.execute', envelope),
    async upload(input) {
      const bytes = Buffer.from(input), { uploadId } = await request('resources.begin', { byteLength: bytes.length });
      try {
        for (let offset = 0; offset < bytes.length; offset += 65536) await request('resources.append', { uploadId, offset, base64: bytes.subarray(offset, offset + 65536).toString('base64') });
        return await request('resources.finish', { uploadId });
      } catch (error) { await request('resources.abort', { uploadId }).catch(() => {}); throw error; }
    },
    async download({ resourceId, byteLength }) {
      if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > 128 * 1024 * 1024) throw Error('Invalid resource size.');
      const bytes = Buffer.alloc(byteLength);
      for (let offset = 0; offset < byteLength; offset += 65536) {
        const chunk = await request('resources.read', { resourceId, offset, length: Math.min(65536, byteLength - offset) });
        const decoded = Buffer.from(chunk.base64, 'base64');
        if (chunk.byteLength !== byteLength || chunk.offset !== offset || decoded.length !== Math.min(65536, byteLength - offset)) throw Error('Invalid resource chunk.');
        decoded.copy(bytes, offset);
      }
      return bytes;
    },
    release: resourceId => request('resources.release', { resourceId }),
    async close() { if (closed) return; closed = true; await http('/session', 'DELETE', undefined, AbortSignal.timeout(5000)); },
  });
}
