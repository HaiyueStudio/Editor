import { cleanOutputDirectory, haiyuePlugins, libraryOutput } from '../config/rollup.shared.js';

export default {
  input: { main: 'src/main.ts', native3d: 'src/native3d-main.ts' },
  output: libraryOutput(),
  plugins: [cleanOutputDirectory(), ...haiyuePlugins({ declaration: false, tsconfig: './tsconfig.rollup.json' })],
};
