import { cleanOutputDirectory, haiyuePlugins, libraryOutput } from '../config/rollup.shared.js';

export default {
  input: {
    main: 'src/main.ts', model: 'src/model.ts', picking: 'src/picking.ts',
    'shape-generator': 'src/shapeGenerator.ts', 'gltf-exporter': 'src/gltfExporter.ts',
    'gltf-scene-exporter': 'src/gltfSceneExporter.ts', 'vox-importer': 'src/voxImporter.ts',
    'vox-exporter': 'src/voxExporter.ts', commands: 'src/commands.ts',
    'camera-history': 'src/cameraHistory.ts', 'camera-axis': 'src/cameraAxis.ts',
    'camera-projection': 'src/cameraProjection.ts', 'camera-framing': 'src/cameraFraming.ts',
    'viewport-slice': 'src/viewportSlice.ts', 'image-importer': 'src/imageImporter.ts',
    selection: 'src/selection.ts', brushes: 'src/brushes.ts', 'voxel-paint': 'src/voxelPaint.ts',
    'selection-transform': 'src/selectionTransform.ts', 'module-transform': 'src/moduleTransform.ts',
    'module-thumbnail': 'src/moduleThumbnail.ts', animation: 'src/animation.ts',
    'sprite-exporter': 'src/spriteExporter.ts', 'ui-render-scheduler': 'src/uiRenderScheduler.ts',
    localization: 'src/localization.ts', 'project-io-controller': 'src/controllers/ProjectIOController.ts',
    'project-session-controller': 'src/controllers/ProjectSessionController.ts',
    'project-storage': 'src/projectStorage.ts', 'voxel-brush-controller': 'src/controllers/VoxelBrushController.ts',
    'voxel-selection-controller': 'src/controllers/VoxelSelectionController.ts',
    'module-gizmo-controller': 'src/controllers/ModuleGizmoController.ts',
    'viewport-input-controller': 'src/controllers/ViewportInputController.ts',
    'selection-transform-controller': 'src/controllers/SelectionTransformController.ts',
    'voxel-renderer': 'src/VoxelRenderer.ts', 'export-worker': 'src/exportWorker.ts',
    'project-import-worker': 'src/projectImportWorker.ts', 'project-import': 'src/projectImport.ts',
  },
  output: libraryOutput(),
  plugins: [cleanOutputDirectory(), ...haiyuePlugins({ declaration: false, tsconfig: './tsconfig.rollup.json', minify: true })],
};
