import { readFileSync } from 'node:fs';
import { cleanOutputDirectory, haiyuePlugins } from '../config/rollup.shared.js';
import { fileURLToPath } from 'node:url';

// Keep shared modules beside worker entries: new URL(worker, import.meta.url)
// must resolve consistently after Rollup extracts an API helper into a chunk.
// Use the codec's advertised ESM distribution so Rollup can remove unused exports.
const psdPackage=new URL(import.meta.resolve('ag-psd/package.json'));
const psdModule=fileURLToPath(new URL(JSON.parse(readFileSync(psdPackage,'utf8')).module,psdPackage));

export default {
  input: { main: 'src/main.ts', 'psd-worker': 'src/psdWorker.ts', 'filter-worker': 'src/filterWorker.ts' },
  output: { dir: 'web', format: 'es', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js', sourcemap: false },
  plugins: [cleanOutputDirectory('web'), ...haiyuePlugins({ tsconfig: './tsconfig.web.json', declaration: false, minify: true, mangle: true, keepFunctionNames: false, keepClassNames: false, minifyModule: true,
    localPackages: { 'ag-psd': psdModule, '@haiyue/ui': fileURLToPath(import.meta.resolve('@haiyue/ui')) },
  })],
};
