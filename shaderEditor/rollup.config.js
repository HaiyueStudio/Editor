import { cleanOutputDirectory, haiyuePlugins } from '../config/rollup.shared.js';

export default {
  input: 'src/main.ts',
  output: { dir: 'web', format: 'es', entryFileNames: 'main.js', chunkFileNames: 'chunks/[name]-[hash].js', sourcemap: false },
  plugins: [cleanOutputDirectory('web'), ...haiyuePlugins({ tsconfig: './tsconfig.web.json', declaration: false, minify: true, mangle: true })],
};
