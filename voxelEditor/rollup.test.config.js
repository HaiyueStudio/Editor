import { cleanOutputDirectory, haiyuePlugins, libraryOutput } from '../config/rollup.shared.js';

export default {
  input: {
    'voxel-render-projection-cache': 'src/render/VoxelRenderProjectionCache.ts',
    'voxel-scene-projection-cache': 'src/render/VoxelSceneProjectionCache.ts',
    'project-migration': 'src/persistence/VoxelProjectMigration.ts',
    'electron-close-controller': 'src/controllers/ElectronCloseController.ts',
  },
  output: libraryOutput('dist-test'),
  plugins: [
    cleanOutputDirectory('dist-test'),
    ...haiyuePlugins({ declaration: false, tsconfig: './tsconfig.rollup-test.json' }),
  ],
};
