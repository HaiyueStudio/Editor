import { EDITOR_PLUGIN_API_VERSION, defineEditorPlugin } from '@haiyue/editor-plugin-sdk';
import { Live2DAuthoringPanel, type Live2DAuthoringPanelOptions } from '../authoring/deformable-animation/Live2DAuthoringPanel';
import {
  Live2DImportSession,
  type Live2DExactPreviewPort,
  type Live2DImportSessionOptions,
} from '../authoring/deformable-animation/Live2DImportSession';
import {
  Live2DImportWorkflow,
  type Live2DClipRecipe,
  type Live2DConversionPort,
} from '../import/deformable-animation/Live2DImportWorkflow';

export interface AnimationEditorLive2DImporterContribution {
  readonly entry: 'live2d/deformable-animation';
  readonly canonicalInput: '.model3.json';
  readonly unsupportedInput: '.wpk';
  readonly conversionOwnership: 'caller-injected';
  createSession(options: Readonly<{
    readonly converter: Live2DConversionPort;
    readonly preview?: Live2DExactPreviewPort;
    readonly initialRecipe?: Partial<Live2DClipRecipe>;
  }>): Live2DImportSession;
  mount(
    root: HTMLElement,
    session: Live2DImportSession,
    options?: Live2DAuthoringPanelOptions,
  ): Live2DAuthoringPanel;
}

type Live2DImporterSessionFactoryOptions = Parameters<AnimationEditorLive2DImporterContribution['createSession']>[0];

export const animationEditorLive2DImporter: AnimationEditorLive2DImporterContribution = Object.freeze({
  entry: 'live2d/deformable-animation',
  canonicalInput: '.model3.json',
  unsupportedInput: '.wpk',
  conversionOwnership: 'caller-injected',
  createSession(options: Live2DImporterSessionFactoryOptions) {
    const workflow = new Live2DImportWorkflow(options.converter);
    const sessionOptions: Live2DImportSessionOptions = {
      converter: options.converter,
      workflow,
      ...(options.preview ? { preview: options.preview } : {}),
      ...(options.initialRecipe ? { initialRecipe: options.initialRecipe } : {}),
    };
    return new Live2DImportSession(sessionOptions);
  },
  mount(root: HTMLElement, session: Live2DImportSession, options: Live2DAuthoringPanelOptions = {}) {
    return new Live2DAuthoringPanel(root, session, options);
  },
});

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
      value: animationEditorLive2DImporter,
    });
  },
});
