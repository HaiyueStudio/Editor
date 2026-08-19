import { EDITOR_PLUGIN_API_VERSION, defineEditorPlugin } from '@haiyue/editor-plugin-sdk';

export const voxelAnimationAuthoringPlugin = defineEditorPlugin({
  id: 'voxel.animation-authoring',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['voxel.document'],
  provides: ['voxel.animation-authoring'],
  activate(context) {
    context.contributions.register({
      kind: 'panel', id: 'voxel.animation-timeline', ownerId: context.pluginId,
      value: Object.freeze({ feature: 'voxel-animation' }),
    });
  },
});

export const voxelAssetExportPlugin = defineEditorPlugin({
  id: 'voxel.asset-export',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['voxel.document'],
  provides: ['voxel.asset-export'],
  activate(context) {
    context.contributions.register({
      kind: 'exporter', id: 'voxel.gltf-sprite-export', ownerId: context.pluginId,
      value: Object.freeze({ formats: ['gltf', 'sprite', 'vox'] }),
    });
  },
});
