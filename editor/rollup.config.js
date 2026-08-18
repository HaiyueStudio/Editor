import { visualizer } from 'rollup-plugin-visualizer';
import { cleanOutputDirectory, haiyuePlugins, libraryOutput } from '../config/rollup.shared.js';
import { bundleGraphPlugin } from './scripts/bundle-graph-plugin.mjs';
import { editorBundleChunkFileName, editorBundleManualChunk } from './scripts/bundle-chunk-policy.mjs';

const plugins = () => [
  cleanOutputDirectory(),
  ...haiyuePlugins({
    tsconfig: './tsconfig.rollup.json',
    extra: [visualizer({
      filename: 'dist/bundle-visualizer.html',
      title: 'Haiyue Editor Bundle',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
    }), bundleGraphPlugin()],
  }),
];

function hasEditorRuntimeSideEffects(id) {
  const normalized = id.replaceAll('\\', '/');
  if (normalized.includes('/node_modules/@haiyue/engine/')
    || normalized.includes('/node_modules/@haiyue/animation-spec/')) return false;
  return !(normalized.includes('/node_modules/box2d.ts/')
    || normalized.endsWith('/physics/Box2D.js')
    || normalized.endsWith('/physics/Box2DPhysics2DBackend.js')
    || normalized.endsWith('/physics/Physics2DSystem.js'));
}

export default {
  input: {
    editor: 'src/main.ts',
    player: 'src/player.ts',
    'export-worker': 'src/export/exportWorkerEntry.ts',
    'material-graph-worker': 'src/infra/content/materialGraphCompiler.worker.ts',
  },
  output: {
    ...libraryOutput(),
    sourcemap: 'hidden',
    compact: true,
    generatedCode: 'es2015',
    hoistTransitiveImports: false,
    chunkFileNames: editorBundleChunkFileName,
    manualChunks: editorBundleManualChunk,
    onlyExplicitManualChunks: true,
  },
  treeshake: { moduleSideEffects: hasEditorRuntimeSideEffects },
  plugins: plugins(),
};
