import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_BODY = 1024 * 1024;
const reply = (res, status, value) => {
  if (res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
const fault = (message, status = 400) => Object.assign(new Error(message), { status });

/** Loopback-only JSON-RPC transport. dispatch(session, null) releases that client's work/resources. */
export async function createLocalRpcServer({ dispatch, port = 0, token = randomBytes(32).toString('hex'), idleMs = 300000 }) {
  if (typeof dispatch !== 'function' || !Number.isInteger(port) || port < 0 || port > 65535 || typeof token !== 'string' || token.length < 32 || token.length > 256
    || !Number.isFinite(idleMs) || idleMs < 1) throw new TypeError('Invalid local RPC configuration.');
  const secret = Buffer.from(`Bearer ${token}`), clients = new Map();
  let authority = '', disposed = false;
  const closeSession = async id => {
    const client = clients.get(id); if (!client) return;
    clients.delete(id); await Promise.resolve().then(() => dispatch(id, null)).catch(() => {});
  };
  const server = createServer(async (req, res) => {
    try {
      const authorization = Buffer.from(req.headers.authorization ?? '');
      if (disposed || req.headers.host !== authority || req.headers.origin !== undefined
        || authorization.length !== secret.length || !timingSafeEqual(authorization, secret)) throw fault('Unauthorized local RPC request.', 403);
      if (req.method === 'POST' && req.url === '/sessions') {
        if (clients.size >= 16) throw fault('Session limit exceeded.', 429);
        if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0) throw fault('Session creation requires an empty body.');
        const id = randomUUID(); clients.set(id, { touched: Date.now(), pending: 0 });
        reply(res, 201, { sessionId: id, rpc: '/rpc/v1', apiVersion: '1' }); return;
      }
      const id = req.headers['x-haiyue-session'];
      const client = typeof id === 'string' && clients.get(id);
      if (!client) throw fault('Session is unavailable.', 404);
      client.touched = Date.now();
      if (req.method === 'DELETE' && req.url === '/session') {
        await closeSession(id); reply(res, 200, { closed: true }); return;
      }
      if (req.method !== 'POST' || req.url !== '/rpc/v1') throw fault('Endpoint not found.', 404);
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw fault('Expected application/json.', 415);
      if (client.pending >= 32) throw fault('Too many in-flight requests.', 429);
      client.pending++;
      res.once('close', () => { if (!res.writableEnded) void closeSession(id); });
      try {
        const body = await readBody(req);
        let request;
        try { request = JSON.parse(body); }
        catch { reply(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }); return; }
        if (!clients.has(id) || res.destroyed) return;
        reply(res, 200, await dispatch(id, request));
      } finally { client.pending--; client.touched = Date.now(); }
    } catch (error) {
      if (error.status === 413) { res.setHeader('Connection', 'close'); req.resume(); }
      reply(res, error.status ?? 503, { error: error.status ? error.message : 'Renderer unavailable; outcome may be unknown. Do not retry writes automatically.' });
    }
  });
  server.maxConnections = 32; server.maxHeadersCount = 32;
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  authority = `127.0.0.1:${server.address().port}`;
  const timer = setInterval(() => { for (const [id, client] of clients) if (!client.pending && Date.now() - client.touched > idleMs) void closeSession(id); }, Math.min(idleMs, 30000)); timer.unref();
  return Object.freeze({ url: `http://${authority}`, token,
    async close() {
      if (disposed) return; disposed = true; clearInterval(timer);
      server.closeAllConnections();
      await Promise.all([...clients.keys()].map(closeSession));
      await new Promise(resolve => server.close(resolve));
    },
  });
}

async function readBody(req) {
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) throw fault('RPC body exceeds 1 MiB.', 413);
  let length = 0; const parts = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > MAX_BODY) throw fault('RPC body exceeds 1 MiB.', 413);
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString('utf8');
}
