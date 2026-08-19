import {
  EDITOR_PLUGIN_API_VERSION,
  defineEditorPlugin,
} from '@haiyue/editor-plugin-sdk';

export const sceneRayTracingPlugin = defineEditorPlugin({
  id: 'scene.ray-tracing',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['scene.document', 'scene.viewport'],
  provides: ['scene.ray-tracing'],
  async activate(context) {
    const { RayTracingPreviewOwner } = await import('../infra/ray-tracing/RayTracingPreviewOwner');
    const owner = new RayTracingPreviewOwner(context);
    context.scope.own(owner);
    context.contributions.register({
      kind: 'panel',
      id: 'scene.ray-tracing-preview',
      ownerId: context.pluginId,
      value: Object.freeze({
        owner,
        load: () => import('../infra/ray-tracing/RayTracingPanel'),
      }),
    });
    context.contributions.register({
      kind: 'viewport',
      id: 'scene.ray-tracing-preview-layer',
      ownerId: context.pluginId,
      value: Object.freeze({ owner: context.pluginId, policy: 'preview-only', lazy: true }),
    });
    context.contributions.register({
      kind: 'diagnostics',
      id: 'scene.ray-tracing-diagnostics',
      ownerId: context.pluginId,
      value: Object.freeze({ channel: 'ray-tracing-preview', source: owner }),
    });
    context.contributions.register({
      kind: 'exporter',
      id: 'scene.ray-tracing-export-policy',
      ownerId: context.pluginId,
      value: Object.freeze({ policy: 'preview-metadata-only', mutatesRuntimeScene: false }),
    });
  },
});
