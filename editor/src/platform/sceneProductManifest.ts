import {
  EDITOR_PLUGIN_API_VERSION,
  defineEditorPlugin,
  defineEditorProduct,
  type EditorContributionKind,
  type EditorPluginActivationContext,
} from '@haiyue/editor-plugin-sdk';

const SCENE_CONTRIBUTIONS: ReadonlyArray<readonly [EditorContributionKind, string]> = Object.freeze([
  ['panel', 'scene.hierarchy'],
  ['panel', 'scene.resources'],
  ['menu', 'scene.main-menu'],
  ['toolbar', 'scene.viewport-toolbar'],
  ['importer', 'scene.project-importer'],
  ['exporter', 'scene.project-exporter'],
  ['viewport', 'scene.webgpu-viewport'],
  ['diagnostics', 'scene.runtime-diagnostics'],
]);

function registerContributions(context: EditorPluginActivationContext): void {
  for (const [kind, id] of SCENE_CONTRIBUTIONS) {
    context.contributions.register({
      kind,
      id,
      ownerId: context.pluginId,
      value: Object.freeze({ id, productId: 'haiyue.scene-editor' }),
    });
  }
}

const sceneCorePlugin = defineEditorPlugin({
  id: 'scene.core',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  provides: ['scene.document', 'scene.viewport'],
  activate: registerContributions,
});

const sceneShellPlugin = defineEditorPlugin({
  id: 'scene.shell',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['scene.document'],
  provides: ['scene.browser-shell'],
  activate(context) {
    context.contributions.register({
      kind: 'shortcut',
      id: 'scene.history-shortcuts',
      ownerId: context.pluginId,
      value: Object.freeze({ commands: ['history.undo', 'history.redo'] }),
    });
  },
});

export const sceneEditorProductManifest = defineEditorProduct({
  schemaVersion: 1,
  id: 'haiyue.scene-editor',
  version: '0.1.0',
  displayName: 'HaiYue Scene Editor',
  requiredPlugins: [sceneCorePlugin, sceneShellPlugin],
  lazyPlugins: [
    { id: 'scene.inspector', load: () => import('./sceneLazyPlugins').then(module => module.sceneInspectorPlugin) },
    { id: 'scene.content-authoring', load: () => import('./sceneLazyPlugins').then(module => module.sceneContentAuthoringPlugin) },
    { id: 'scene.runtime-debug', load: () => import('./sceneLazyPlugins').then(module => module.sceneRuntimeDebugPlugin) },
    { id: 'scene.ray-tracing', load: () => import('./sceneRayTracingPlugin').then(module => module.sceneRayTracingPlugin) },
  ],
});
