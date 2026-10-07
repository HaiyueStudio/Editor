import { cleanOutputDirectory, haiyuePlugins } from '../config/rollup.shared.js';
import { fileURLToPath } from 'node:url';

export default {
  input: { main: 'src/main.ts', 'psd-worker': 'src/psdWorker.ts', 'filter-worker': 'src/filterWorker.ts' },
  output: { dir: 'web', format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', sourcemap: false },
  plugins: [cleanOutputDirectory('web'), ...haiyuePlugins({ tsconfig: './tsconfig.web.json', declaration: false, minify: true,
    localPackages: { '@haiyue/ui': fileURLToPath(import.meta.resolve('@haiyue/ui')) },
  })],
};
