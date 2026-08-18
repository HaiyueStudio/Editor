import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import { cleanOutputDirectory } from '../config/rollup.shared.js';
import { wgslRaw } from '../scripts/rollup-plugin-wgsl.js';
import { editorBundleChunkFileName, editorBundleManualChunk } from './scripts/bundle-chunk-policy.mjs';

function hasEditorRuntimeSideEffects(id) {
  const normalized = id.replaceAll('\\', '/');
  if (normalized.includes('/node_modules/@haiyue/engine/')) return false;
  return !(normalized.includes('/node_modules/box2d.ts/')
    || normalized.endsWith('/physics/Box2D.js')
    || normalized.endsWith('/physics/Box2DPhysics2DBackend.js')
    || normalized.endsWith('/physics/Physics2DSystem.js'));
}

export default {
  input: { testing: 'src/testing.ts' },
  output: {
    dir: 'dist-test',
    entryFileNames: '[name].js',
    chunkFileNames: editorBundleChunkFileName,
    format: 'es',
    sourcemap: false,
    manualChunks: editorBundleManualChunk,
  },
  treeshake: { moduleSideEffects: hasEditorRuntimeSideEffects },
  plugins: [
    cleanOutputDirectory('dist-test'),
    wgslRaw(),
    resolve({ browser: true, preferBuiltins: false, exportConditions: ['source'] }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.rollup.json',
      compilerOptions: { outDir: 'dist-test', sourceMap: false, declaration: false, declarationMap: false },
    }),
  ],
};
