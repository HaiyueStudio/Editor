import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch } from 'rollup';
import config from '../rollup.config.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const requestedPort = Number.parseInt(process.env.ANIMATION_EDITOR_PORT ?? '4175', 10);
if (!Number.isSafeInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535) {
  throw new RangeError('ANIMATION_EDITOR_PORT must be an integer between 1 and 65535.');
}

const watcher = watch({ ...config, watch: { clearScreen: false } });
watcher.on('event', event => {
  if (event.code === 'BUNDLE_START') console.log('[animation-editor] rebuilding…');
  else if (event.code === 'BUNDLE_END') {
    console.log(`[animation-editor] bundle ready in ${event.duration}ms`);
    void event.result.close();
  } else if (event.code === 'ERROR') console.error(event.error);
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const path = resolve(root, `.${relative}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file.');
    const body = await readFile(path);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentType(path),
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(requestedPort, '127.0.0.1', () => {
  console.log(`[animation-editor] http://127.0.0.1:${requestedPort}`);
});

const close = async () => {
  server.close();
  await watcher.close();
};
process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void close().then(() => process.exit(0)); });

function contentType(path) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  })[extname(path)] ?? 'application/octet-stream';
}
