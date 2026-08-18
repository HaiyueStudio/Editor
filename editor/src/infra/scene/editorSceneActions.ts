import type { Entity, World } from '@haiyue/engine';
import type { ScriptResource } from '@haiyue/engine/components';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type {
  RuntimeExportResult,
  SerializedEditorScene,
  SerializedGlobalSettings,
  SerializedSystem,
} from '../../export/runtimeScene';
import type { RuntimeProjectExport, RuntimeProjectOptions } from '../../export/projectTemplate';
import { getSafeDownloadName, triggerBlobDownload } from '../file/download';
import { textureSourceToSerializableUrl } from '../texture/textureSerialization';
import { getCanvasSourceSize, isGPUTexture } from '../../resources/icons';
import type { ResourcePool } from '../../resources/ResourcePool';
import {
  exportRuntimeScene as exportRuntimeSceneData,
  loadEditorScene as loadEditorSceneData,
  loadPreparedEditorScene as loadPreparedEditorSceneData,
  prepareEditorSceneAsync,
  serializeEditorScene as serializeEditorSceneData,
  type PreparedEditorScene,
} from '../../domain/scene/editorSceneIO';
import type { WorkflowProgress } from '../../domain/workflows/CoreWorkflowCoordinator';
import { getRuntimeComponentContributions } from '../../domain/library/componentLibrary';
import { createBrowserExportWorkerClient } from '../../export/ExportWorkerClient';
import type { ExportWorkerProgress } from '../../export/ExportWorkerProtocol';
import type { ContentAuthoringStore } from '../../domain/content/ContentAuthoringStore';

export interface EditorSceneExecutionContext {
  readonly signal?: AbortSignal;
  readonly reportProgress?: (progress: WorkflowProgress) => void;
}

export interface PreparedFileDownload {
  readonly blob: Blob;
  readonly fileName: string;
}

export interface EditorSceneActionsDeps {
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  componentLibraries: EditorComponentLibrary[];
  getGlobalSettings: () => SerializedGlobalSettings;
  setGlobalSettings: (settings: SerializedGlobalSettings) => void;
  getSystemConfigs: () => SerializedSystem[];
  setSystemConfigs: (systems: SerializedSystem[]) => void;
  applyGlobalSettingsToWorld: (world: World) => void;
  syncViewportClearColor: () => void;
  clearResourceSelection: () => void;
  setActiveScriptResource: (resource: ScriptResource | null) => void;
  setSelectedComponentName: (name: string) => void;
  clearEntityClipboard: () => void;
  renderGlobalSettingsPanel: (world: World) => void;
  refreshResourcePool: (world: World) => void;
  authoringStore?: ContentAuthoringStore;
}

export interface EditorSceneActions {
  serializeEditorScene: (world: World, context?: EditorSceneExecutionContext) => Promise<SerializedEditorScene>;
  exportRuntimeScene: (world: World, context?: EditorSceneExecutionContext) => Promise<RuntimeExportResult>;
  exportRuntimeProject: (world: World, options?: RuntimeProjectOptions, context?: EditorSceneExecutionContext) => Promise<RuntimeProjectExport>;
  prepareRuntimeProjectDownload: (world: World, context?: EditorSceneExecutionContext) => Promise<PreparedFileDownload>;
  prepareSceneDownload: (world: World, context?: EditorSceneExecutionContext) => Promise<PreparedFileDownload>;
  downloadPreparedFile: (download: PreparedFileDownload) => void;
  prepareEditorScene: (data: SerializedEditorScene, context?: EditorSceneExecutionContext) => Promise<PreparedEditorScene>;
  loadEditorScene: (world: World, data: SerializedEditorScene) => Entity | null;
  loadPreparedEditorScene: (world: World, prepared: PreparedEditorScene) => Entity | null;
}

export function createEditorSceneActions(deps: EditorSceneActionsDeps): EditorSceneActions {
  const exportWorker = createBrowserExportWorkerClient();
  const getSerializationDeps = (context: EditorSceneExecutionContext = {}) => ({
    resourcePool: deps.resourcePool,
    globals: deps.getGlobalSettings(),
    systems: deps.getSystemConfigs(),
    componentExtensions: deps.componentLibraries,
    textureSourceToSerializableUrl: (source: Parameters<typeof textureSourceToSerializableUrl>[0]) =>
      textureSourceToSerializableUrl(source, {
        isGPUTexture,
        getCanvasSourceSize,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      }),
    refreshResourcePool: deps.refreshResourcePool,
    ...(deps.authoringStore === undefined ? {} : { authoring: deps.authoringStore }),
  });
  const finishSceneLoad = (
    world: World,
    loaded: ReturnType<typeof loadEditorSceneData>,
  ): Entity | null => {
    deps.setGlobalSettings(loaded.globals);
    deps.setSystemConfigs(loaded.systems);
    deps.applyGlobalSettingsToWorld(world);
    deps.syncViewportClearColor();
    deps.clearResourceSelection();
    deps.setActiveScriptResource(null);
    deps.setSelectedComponentName('');
    deps.clearEntityClipboard();
    deps.renderGlobalSettingsPanel(world);
    return loaded.firstEntity;
  };

  const actions: EditorSceneActions = {
    serializeEditorScene(world, context = {}) {
      return serializeEditorSceneData(world, getSerializationDeps(context), context);
    },
    exportRuntimeScene(world, context = {}) {
      return exportRuntimeSceneData(world, getSerializationDeps(context), context);
    },
    async exportRuntimeProject(world, options = {}, context = {}) {
      context.reportProgress?.({ current: 0, total: 4, message: 'Serializing scene' });
      const runtimeExport = await actions.exportRuntimeScene(world, context);
      context.signal?.throwIfAborted();
      const workerOptions = {
        ...options,
        componentContributions: getRuntimeComponentContributions(deps.componentLibraries),
      };
      if (exportWorker) {
        return exportWorker.buildProject(runtimeExport, workerOptions, {
          ...(context.signal === undefined ? {} : { signal: context.signal }),
          onProgress: progress => reportWorkerProgress(context, progress, false),
        });
      }
      context.reportProgress?.({ current: 1, total: 4, message: 'Optimizing textures' });
      const [{ optimizeRuntimeTextures }, { generateRuntimeProjectFiles }] = await Promise.all([
        import('../../export/texturePipeline'),
        import('../../export/projectTemplate'),
      ]);
      const optimizedExport = await optimizeRuntimeTextures(runtimeExport, options.texturePipeline, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        onProgress: (current, total, message) => context.reportProgress?.({
          current: 1 + (total === 0 ? 1 : current / total),
          total: 4,
          ...(message === undefined ? {} : { message }),
        }),
      });
      context.signal?.throwIfAborted();
      context.reportProgress?.({ current: 2, total: 4, message: 'Generating project' });
      return generateRuntimeProjectFiles(optimizedExport, workerOptions, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        onProgress: (stage, current, total) => reportWorkerProgress(context, { stage, current, total }),
      });
    },
    async prepareRuntimeProjectDownload(world, context = {}) {
      if (exportWorker) {
        context.reportProgress?.({ current: 0, total: 4, message: 'Serializing scene' });
        const runtimeExport = await actions.exportRuntimeScene(world, context);
        context.signal?.throwIfAborted();
        const result = await exportWorker.buildZip(runtimeExport, {
          mode: 'project',
          componentContributions: getRuntimeComponentContributions(deps.componentLibraries),
        }, {
          ...(context.signal === undefined ? {} : { signal: context.signal }),
          onProgress: progress => reportWorkerProgress(context, progress, true),
        });
        context.signal?.throwIfAborted();
        return Object.freeze({
          blob: new Blob([result.buffer], { type: 'application/zip' }),
          fileName: `${result.projectName}.zip`,
        });
      }
      const project = await actions.exportRuntimeProject(world, { mode: 'project' }, context);
      context.signal?.throwIfAborted();
      const { createRuntimeProjectZip } = await import('../../export/projectZip');
      context.reportProgress?.({ current: 0, total: 100, message: 'Compressing project' });
      const blob = await createRuntimeProjectZip(project, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        onProgress: (current, fileName) => context.reportProgress?.({
          current,
          total: 100,
          ...(fileName === undefined ? {} : { message: fileName }),
        }),
      });
      context.signal?.throwIfAborted();
      return Object.freeze({ blob, fileName: `${project.projectName}.zip` });
    },
    loadEditorScene(world, data) {
      const loaded = loadEditorSceneData(world, data, {
        resourcePool: deps.resourcePool,
        resourceDisplayNames: deps.resourceDisplayNames,
        componentExtensions: deps.componentLibraries,
        refreshResourcePool: deps.refreshResourcePool,
        ...(deps.authoringStore === undefined ? {} : { authoring: deps.authoringStore }),
      });
      return finishSceneLoad(world, loaded);
    },
    prepareEditorScene(data, context = {}) {
      return prepareEditorSceneAsync(data, deps.componentLibraries, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        reportProgress: (current, total) => context.reportProgress?.({
          current,
          total,
          message: 'Preparing scene entities',
        }),
      });
    },
    loadPreparedEditorScene(world, prepared) {
      const loaded = loadPreparedEditorSceneData(world, prepared, {
        resourcePool: deps.resourcePool,
        resourceDisplayNames: deps.resourceDisplayNames,
        componentExtensions: deps.componentLibraries,
        refreshResourcePool: deps.refreshResourcePool,
        ...(deps.authoringStore === undefined ? {} : { authoring: deps.authoringStore }),
      });
      return finishSceneLoad(world, loaded);
    },
    async prepareSceneDownload(world, context = {}) {
      context.reportProgress?.({ current: 0, total: 1, message: 'Serializing scene' });
      const scene = await actions.serializeEditorScene(world, context);
      context.signal?.throwIfAborted();
      const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' });
      return Object.freeze({ blob, fileName: `${getSafeDownloadName(world.name || 'scene')}.json` });
    },
    downloadPreparedFile(download) {
      triggerBlobDownload(download.blob, download.fileName);
    },
  };

  return actions;
}

function reportWorkerProgress(context: EditorSceneExecutionContext, progress: ExportWorkerProgress, includesZip = false): void {
  const stageOffset = progress.stage === 'textures' ? 1 : progress.stage === 'precompile' ? 2 : progress.stage === 'project' ? 3 : 4;
  const fraction = progress.total <= 0 ? 1 : Math.min(1, progress.current / progress.total);
  const defaultMessage = progress.stage === 'textures'
    ? 'Optimizing textures'
    : progress.stage === 'precompile'
      ? 'Precompiling runtime data'
      : progress.stage === 'project'
        ? 'Generating project'
        : 'Compressing project';
  context.reportProgress?.({
    current: Math.min(includesZip ? 5 : 4, stageOffset + fraction),
    total: includesZip ? 5 : 4,
    message: progress.message ?? defaultMessage,
  });
}
