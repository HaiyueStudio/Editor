import { cleanOutputDirectory, haiyuePlugins } from '../config/rollup.shared.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The compiler is lazy-loaded and its WASM is local in web, PWA and Electron.
const nagaAsset = {
  name: 'shader-naga-asset',
  resolveId(id) { if (id === 'naga-wasm/naga_bg.wasm') return '\0naga-asset'; },
  load(id) {
    if (id !== '\0naga-asset') return null;
    const ref = this.emitFile({ type: 'asset', name: 'naga_bg.wasm', source: readFileSync(fileURLToPath(import.meta.resolve('naga-wasm/naga_bg.wasm'))) });
    return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
  },
};

export default {
  input: 'src/main.ts',
  output: { dir: 'web', format: 'es', entryFileNames: 'main.js', chunkFileNames: 'chunks/[name]-[hash].js', sourcemap: false },
  plugins: [cleanOutputDirectory('web'), nagaAsset, ...haiyuePlugins({ tsconfig: './tsconfig.web.json', declaration: false, minify: true, mangle: true })],
};
