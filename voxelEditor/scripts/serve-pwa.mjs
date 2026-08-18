import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve('app-dist');
const port = positiveInteger(process.env.VOXEL_EDITOR_PWA_PORT, 4174);
const types = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const requested = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (requested !== root && !requested.startsWith(`${root}${sep}`)) throw new Error('Path escapes app root.');
    const info = await stat(requested);
    if (!info.isFile()) throw new Error('Not a file.');
    response.writeHead(200, {
      'Cache-Control': pathname === '/service-worker.js' ? 'no-cache' : 'no-store',
      'Content-Type': types.get(extname(requested)) ?? 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(requested).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Voxel Editor PWA: http://localhost:${port}`);
});

function positiveInteger(raw, fallback) {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
