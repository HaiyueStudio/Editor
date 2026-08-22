import { EDITOR_PLUGIN_API_VERSION, defineEditorPlugin } from '@haiyue/editor-plugin-sdk';

export const advancedAuthoringPlugin = defineEditorPlugin({
  id: 'animation.advanced-authoring',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['animation.timeline'],
  provides: ['animation.advanced-authoring'],
  activate(context) {
    context.contributions.register({
      kind: 'panel', id: 'animation.graph-editor', ownerId: context.pluginId,
      value: Object.freeze({ feature: 'timeline-graph' }),
    });
  },
});

export const native3dPreviewPlugin = defineEditorPlugin({
  id: 'animation.native3d-preview',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['animation.preview'],
  provides: ['animation.native3d-preview'],
  activate(context) {
    context.contributions.register({
      kind: 'viewport', id: 'animation.native3d-viewport', ownerId: context.pluginId,
      value: Object.freeze({ entry: 'native3d' }),
    });
  },
});

export const live2dClipBakedImportPlugin = defineEditorPlugin({
  id: 'animation.live2d-clip-baked-import', version: '0.1.0', apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['animation.document', 'animation.preview'], provides: ['animation.live2d-clip-baked-import'],
  activate(context) {
    context.contributions.register({
      kind: 'importer', id: 'animation.live2d-runtime-asset-set', ownerId: context.pluginId,
      value: Object.freeze({ entry: 'live2d/deformable-animation', canonicalInput: '.model3.json', unsupportedInput: '.wpk' }),
    });
  },
});
