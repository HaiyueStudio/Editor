import {
  EDITOR_PLUGIN_API_VERSION,
  defineEditorPlugin,
  defineEditorProduct,
  type EditorContributionKind,
} from '@haiyue/editor-plugin-sdk';

const contributions: ReadonlyArray<readonly [EditorContributionKind, string]> = [
  ['panel', 'animation.hierarchy'],
  ['panel', 'animation.timeline'],
  ['panel', 'animation.assets'],
  ['menu', 'animation.main-menu'],
  ['toolbar', 'animation.playback-toolbar'],
  ['inspector', 'animation.property-inspector'],
  ['importer', 'animation.project-importer'],
  ['exporter', 'animation.hya-exporter'],
  ['viewport', 'animation.preview'],
  ['diagnostics', 'animation.compile-diagnostics'],
];

const core = defineEditorPlugin({
  id: 'animation.core',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  provides: ['animation.document', 'animation.timeline', 'animation.preview'],
  activate(context) {
    for (const [kind, id] of contributions) {
      context.contributions.register({
        kind,
        id,
        ownerId: context.pluginId,
        value: Object.freeze({ id, productId: 'haiyue.animation-editor' }),
      });
    }
  },
});

const shell = defineEditorPlugin({
  id: 'animation.shell',
  version: '0.1.0',
  apiVersion: EDITOR_PLUGIN_API_VERSION,
  requiredCapabilities: ['animation.document'],
  provides: ['animation.browser-shell'],
  activate() {},
});

export const animationEditorProductManifest = defineEditorProduct({
  schemaVersion: 1,
  id: 'haiyue.animation-editor',
  version: '0.1.0',
  displayName: 'HaiYue Animation Editor',
  requiredPlugins: [core, shell],
  lazyPlugins: [
    { id: 'animation.advanced-authoring', load: () => import('./animationEditorLazyPlugins').then(module => module.advancedAuthoringPlugin) },
    { id: 'animation.native3d-preview', load: () => import('./animationEditorLazyPlugins').then(module => module.native3dPreviewPlugin) },
    { id: 'animation.live2d-clip-baked-import', load: () => import('./animationEditorLazyPlugins').then(module => module.live2dClipBakedImportPlugin) },
  ],
});
