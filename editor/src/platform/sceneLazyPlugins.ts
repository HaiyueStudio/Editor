import { EDITOR_PLUGIN_API_VERSION, defineEditorPlugin } from '@haiyue/editor-plugin-sdk';

export const sceneInspectorPlugin = defineEditorPlugin({
  id: 'scene.inspector',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['scene.document'],
  provides: ['scene.inspector'],
  activate(context) {
    context.contributions.register({
      kind: 'inspector',
      id: 'scene.entity-inspector',
      ownerId: context.pluginId,
      value: Object.freeze({ load: () => Promise.all([
        import('../infra/inspector/mainInspectorRenderer'),
        import('../infra/inspector/inspectorRenderer'),
      ]) }),
    });
  },
});

export const sceneContentAuthoringPlugin = defineEditorPlugin({
  id: 'scene.content-authoring',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['scene.document'],
  provides: ['scene.content-authoring'],
  activate(context) {
    context.contributions.register({
      kind: 'panel',
      id: 'scene.content-authoring-panel',
      ownerId: context.pluginId,
      value: Object.freeze({ load: () => import('../infra/content/ContentAuthoringPanel') }),
    });
  },
});

export const sceneRuntimeDebugPlugin = defineEditorPlugin({
  id: 'scene.runtime-debug',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['scene.viewport'],
  provides: ['scene.runtime-debug'],
  activate(context) {
    context.contributions.register({
      kind: 'diagnostics',
      id: 'scene.play-diagnostics',
      ownerId: context.pluginId,
      value: Object.freeze({ channel: 'play-runtime' }),
    });
  },
});
