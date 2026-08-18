import { cleanOutputDirectory, haiyuePlugins, libraryOutput } from '../config/rollup.shared.js';

export default {
  input: {
    testing: 'src/testing.ts',
    'particle-authoring': 'src/domain/ParticleAuthoring.ts',
    'particle-preview': 'src/authoring/particle/Particle2DPreviewSession.ts',
    'particle-resource': 'src/authoring/particle/ParticleTextureResourceSession.ts',
    'particle-runtime': 'test/particle-runtime-entry.ts',
    'path-authoring': 'src/domain/PathAuthoring.ts',
    'path-geometry-cache': 'src/authoring/path/PathGeometryCache.ts',
    'source-import-entry': 'test/source-import-entry.ts',
    'spritesheet-authoring': 'src/domain/SpriteSheetAuthoring.ts',
    'spritesheet-resource': 'src/authoring/spritesheet/SpriteSheetResourceSession.ts',
    'timeline-production': 'src/domain/TimelineProduction.ts',
  },
  output: libraryOutput('dist-test'),
  plugins: [
    cleanOutputDirectory('dist-test'),
    ...haiyuePlugins({ declaration: false, tsconfig: './tsconfig.rollup-test.json' }),
  ],
};
