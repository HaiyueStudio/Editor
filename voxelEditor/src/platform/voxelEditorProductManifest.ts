import {
  EDITOR_PLUGIN_API_VERSION,
  defineEditorPlugin,
  defineEditorProduct,
  type EditorContributionKind,
} from '@haiyue/editor-plugin-sdk';

const contributions: ReadonlyArray<readonly [EditorContributionKind, string]> = [
  ['panel', 'voxel.modules'],
  ['panel', 'voxel.palette'],
  ['panel', 'voxel.animation'],
  ['menu', 'voxel.main-menu'],
  ['toolbar', 'voxel.tools'],
  ['inspector', 'voxel.properties'],
  ['importer', 'voxel.project-importer'],
  ['exporter', 'voxel.asset-exporter'],
  ['viewport', 'voxel.webgpu-viewport'],
  ['diagnostics', 'voxel.renderer-diagnostics'],
];

const core = defineEditorPlugin({
  id: 'voxel.core',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  provides: ['voxel.document', 'voxel.viewport', 'voxel.palette'],
  activate(context) {
    for (const [kind, id] of contributions) {
      context.contributions.register({
        kind,
        id,
        ownerId: context.pluginId,
        value: Object.freeze({ id, productId: 'haiyue.voxel-editor' }),
      });
    }
  },
});

const shell = defineEditorPlugin({
  id: 'voxel.shell',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['voxel.document'],
  provides: ['voxel.browser-shell'],
  activate() {},
});

export const voxelEditorProductManifest = defineEditorProduct({
  schemaVersion: 1,
  id: 'haiyue.voxel-editor',
  version: '0.1.0',
  displayName: 'HaiYue Voxel Editor',
  requiredPlugins: [core, shell],
  lazyPlugins: [
    { id: 'voxel.animation-authoring', load: () => import('./voxelEditorLazyPlugins').then(module => module.voxelAnimationAuthoringPlugin) },
    { id: 'voxel.asset-export', load: () => import('./voxelEditorLazyPlugins').then(module => module.voxelAssetExportPlugin) },
  ],
});
