import type { GEDropdownItem, GEDropdownSelectDetail, GETree } from '@haiyue/ui';
import type { CommandBus } from '../../commands/CommandBus';
import type { SelectionController } from '../../domain/selection/SelectionState';
import type { SerializedEditorScene } from '../../export/runtimeScene';
import type { PlayDevicePreviewController } from '../../play/devicePreview';
import type { PlaySession } from '../../play/playSession';
import type { EditorStarterKit } from '../../types';
import type { Entity, World } from '@haiyue/engine';
import { loadEditorSceneCommand } from '../../commands/sceneCommands';
import { validateSerializedEditorScene } from '../../domain/scene/deserialization';
import { onEditorLanguageChange, t } from '../options/editorOptions';
import type { EditorRecentFileSession } from '../../domain/store/EditorStore';
import { canUseSceneFilePicker, pickSceneJsonFile, type RecentSceneFileOpenResult } from '../file/recentSceneHandles';
import type { CoreWorkflowCoordinator, WorkflowResult } from '../../domain/workflows/CoreWorkflowCoordinator';
import type {
  EditorSceneExecutionContext,
  PreparedFileDownload,
} from '../scene/editorSceneActions';
import type { PreparedEditorScene } from '../../domain/scene/editorSceneIO';
import { createBrowserDocumentRecoveryStore } from '../file/documentRecovery';
import { DocumentAutoRecovery, DocumentFileSession, type DocumentRevisionState } from '../file/documentLifecycle';
import type { EditorShortcutRegistry } from '../shortcuts/EditorShortcutRegistry';

export interface AppEventElements {
  undoButton: HTMLElement | null;
  redoButton: HTMLElement | null;
  saveButton: HTMLElement | null;
  saveAsButton: HTMLElement | null;
  exportProjectButton: HTMLElement | null;
  openButton: HTMLElement | null;
  recentScenesDropdown: HTMLElement & { items: GEDropdownItem[] } | null;
  openFileInput: HTMLInputElement | null;
  playButton: HTMLElement | null;
  playDeviceSelect: HTMLSelectElement | null;
  playDeviceDprInput: HTMLInputElement | null;
  playDeviceZoomInput: HTMLInputElement | null;
  playDeviceWidthInput: HTMLInputElement | null;
  playDeviceHeightInput: HTMLInputElement | null;
  starterKitDropdown: HTMLElement & {
    items: Array<{ label?: string; value?: string; disabled?: boolean; separator?: boolean }>;
  } | null;
  playCloseButton: HTMLElement | null;
  playRestartButton: HTMLElement | null;
  playPauseButton: HTMLElement | null;
  playOverlay: HTMLElement | null;
}

export interface AppEventDeps {
  world: World;
  elements: AppEventElements;
  getCommandBus: () => CommandBus | null;
  selectionState: SelectionController;
  playDevicePreview: PlayDevicePreviewController;
  playSession: PlaySession;
  starterKits: EditorStarterKit[];
  getStarterKitDropdownItems: () => Array<{ label?: string; value?: string; disabled?: boolean; separator?: boolean }>;
  getTree: () => GETree | null;
  setCommandBus: (commandBus: CommandBus) => void;
  createCommandBus: () => CommandBus;
  updateHistoryButtons: () => void;
  setButtonDisabled: (button: HTMLElement | null, disabled: boolean) => void;
  serializeEditorScene: (world: World, context?: EditorSceneExecutionContext) => Promise<SerializedEditorScene>;
  prepareSceneDownload: (world: World, context?: EditorSceneExecutionContext) => Promise<PreparedFileDownload>;
  prepareRuntimeProjectDownload: (world: World, context?: EditorSceneExecutionContext) => Promise<PreparedFileDownload>;
  downloadPreparedFile: (download: PreparedFileDownload) => void;
  activateOptionalCapabilitiesForProject(project: unknown): Promise<void>;
  prepareEditorScene: (scene: SerializedEditorScene, context?: EditorSceneExecutionContext) => Promise<PreparedEditorScene>;
  loadEditorScene: (world: World, scene: SerializedEditorScene) => Entity | null;
  loadPreparedEditorScene: (world: World, scene: PreparedEditorScene) => Entity | null;
  syncRender2DForScene: () => void;
  renderSystemPanel: () => void;
  syncConfiguredSystems: () => void;
  selectEntities: (entities: Entity[], activeEntity?: Entity | null) => Set<Entity>;
  refreshTreeSelection: () => void;
  renderInspector: (entity: Entity | null, selectionCount?: number) => void;
  ensure2DCamera: (entity: Entity) => void;
  reportError: (message: string, error?: unknown) => void;
  recordRecentSceneFile?: (file: File, options?: { handle?: RecentSceneFileOpenResult['handle'] }) => void | Promise<void>;
  getRecentSceneFiles?: () => EditorRecentFileSession[];
  clearRecentSceneFiles?: () => void;
  openRecentSceneFile?: (file: EditorRecentFileSession) => Promise<RecentSceneFileOpenResult | null>;
  onRecentSceneFilesChange?: (listener: () => void) => () => void;
  getDocumentState: () => DocumentRevisionState;
  markDocumentSaved: (revision: number, documentName: string) => void;
  markDocumentOpened: (documentName: string) => void;
  markDocumentRecovered: (documentName: string | null) => void;
  onProjectChanged: (listener: () => void) => () => void;
  shortcuts: EditorShortcutRegistry;
  workflows: CoreWorkflowCoordinator;
}

export function setupUndoRedoShortcuts(deps: AppEventDeps, signal: AbortSignal): void {
  const { elements, updateHistoryButtons } = deps;
  elements.undoButton?.addEventListener('click', () => deps.getCommandBus()?.undo());
  elements.redoButton?.addEventListener('click', () => deps.getCommandBus()?.redo());
  updateHistoryButtons();
  const disposers = [
    deps.shortcuts.register({ id: 'history.undo', chord: 'Mod+Z', handler: () => deps.getCommandBus()?.undo() }),
    deps.shortcuts.register({ id: 'history.redo.shift', chord: 'Mod+Shift+Z', handler: () => deps.getCommandBus()?.redo() }),
    deps.shortcuts.register({ id: 'history.redo', chord: 'Mod+Y', handler: () => deps.getCommandBus()?.redo() }),
  ];
  signal.addEventListener('abort', () => disposers.forEach(dispose => dispose()), { once: true });
}

export function setupSceneFileEvents(deps: AppEventDeps): void {
  const { elements, world } = deps;
  const fileSession = new DocumentFileSession();
  const recoveryStore = createBrowserDocumentRecoveryStore();
  const recovery = recoveryStore ? new DocumentAutoRecovery({
    store: recoveryStore,
    serialize: signal => deps.serializeEditorScene(world, { signal }),
    getState: deps.getDocumentState,
    onError: error => deps.reportError('Failed to update automatic scene recovery.', error),
  }) : null;
  const applyLoadedScene = (
    scene: SerializedEditorScene,
    prepared: PreparedEditorScene | null = null,
  ): Entity | null => {
    const active = measureOpenSceneStage(
      'load-scene',
      () => prepared
        ? deps.loadPreparedEditorScene(world, prepared)
        : deps.loadEditorScene(world, scene),
    );
    measureOpenSceneStage('sync-ui', () => {
      deps.selectionState.setActive(active);
      deps.syncRender2DForScene();
      deps.renderSystemPanel();
      deps.syncConfiguredSystems();
      deps.selectionState.setSelection(deps.selectEntities(active ? [active] : [], active), active);
      deps.refreshTreeSelection();
      deps.renderInspector(active, deps.selectionState.selection.size);
    });
    return active;
  };
  const openSceneFile = async (file: File, options: { handle?: RecentSceneFileOpenResult['handle'] } = {}): Promise<void> => {
    if (deps.getDocumentState().dirty && !window.confirm('Discard unsaved changes and open another scene?')) return;
    const result = await deps.workflows.openDocument({
      prepare: async ({ signal, reportProgress }) => {
        reportProgress({ current: 0, total: 2, message: 'Reading scene' });
        const text = await measureOpenSceneStageAsync('read', () => file.text());
        signal.throwIfAborted();
        const parsedScene: unknown = measureOpenSceneStage('parse', () => JSON.parse(text));
        const scene = measureOpenSceneStage('validate', () => {
          validateSerializedEditorScene(parsedScene);
          return parsedScene;
        });
        await measureOpenSceneStageAsync(
          'activate-capabilities',
          () => deps.activateOptionalCapabilitiesForProject(scene),
        );
        signal.throwIfAborted();
        reportProgress({ current: 1, total: 3, message: 'Preparing scene entities' });
        const preparedAfter = await measureOpenSceneStageAsync(
          'prepare-entities',
          () => deps.prepareEditorScene(scene, { signal, reportProgress }),
        );
        signal.throwIfAborted();
        reportProgress({ current: 2, total: 3, message: 'Capturing current scene' });
        const before = await measureOpenSceneStageAsync(
          'capture-current',
          () => deps.serializeEditorScene(world, { signal, reportProgress }),
        );
        signal.throwIfAborted();
        return Object.freeze({ before, after: scene, preparedAfter });
      },
      commit: prepared => {
        measureOpenSceneStage('commit', () => {
          let firstPreparedAfter: PreparedEditorScene | null = prepared.preparedAfter;
          const command = loadEditorSceneCommand({
            before: prepared.before,
            after: prepared.after,
            apply: scene => {
              const candidate = scene === prepared.after ? firstPreparedAfter : null;
              firstPreparedAfter = null;
              applyLoadedScene(scene, candidate);
            },
          });
          const commandBus = deps.getCommandBus();
          if (commandBus) commandBus.execute(command);
          else command.execute();
          deps.updateHistoryButtons();
        });
      },
    });
    throwWorkflowFailure(result);
    if (result.status !== 'completed') return;
    fileSession.attachOpenedFile(file, options.handle);
    deps.markDocumentOpened(file.name);
    recovery?.saved();
    await deps.recordRecentSceneFile?.(file, options);
    renderRecentDropdown();
  };
  const openFallbackFileInput = (): void => {
    elements.openFileInput?.click();
  };
  const openWithSystemPicker = async (): Promise<boolean> => {
    if (!canUseSceneFilePicker()) return false;
    let result: RecentSceneFileOpenResult | null;
    try {
      result = await pickSceneJsonFile();
    } catch (error) {
      if (isAbortError(error)) return true;
      throw error;
    }
    if (!result) return true;
    await openSceneFile(result.file, { handle: result.handle });
    return true;
  };
  const renderRecentDropdown = (): void => {
    if (!elements.recentScenesDropdown) return;
    const recentFiles = deps.getRecentSceneFiles?.() ?? [];
    const items: GEDropdownItem[] = [
      { label: t('recent.openScene'), value: 'open-scene' },
    ];
    if (recentFiles.length > 0) {
      items.push({ separator: true });
      for (const file of recentFiles) {
        items.push({
          label: formatRecentSceneLabel(file),
          value: `recent:${file.openedAt}`,
          disabled: !file.handleId || !deps.openRecentSceneFile,
        });
      }
      items.push({ separator: true }, { label: t('recent.clear'), value: 'clear-recent' });
    } else {
      items.push({ separator: true }, { label: t('recent.empty'), value: 'empty', disabled: true });
    }
    elements.recentScenesDropdown.items = items;
  };
  const saveDocument = (saveAs = false): void => {
    const revision = deps.getDocumentState().currentRevision;
    void deps.workflows.saveDocument({
      prepare: async ({ signal, reportProgress }) => {
        const download = await deps.prepareSceneDownload(world, { signal, reportProgress });
        signal.throwIfAborted();
        return fileSession.prepareSave(download, revision, {
          saveAs,
          confirmOverwrite: fileName => window.confirm(`"${fileName}" changed outside the editor. Overwrite it?`),
        });
      },
      commit: prepared => {
        if (prepared.download) deps.downloadPreparedFile(prepared.download);
        fileSession.commitSave(prepared);
        deps.markDocumentSaved(prepared.revision, prepared.documentName);
        recovery?.saved();
        return prepared;
      },
    })
      .then(async result => {
        throwWorkflowFailure(result);
        if (result.status === 'completed' && result.value.handleChanged && result.value.handle && result.value.savedFile) {
          await deps.recordRecentSceneFile?.(result.value.savedFile, { handle: result.value.handle });
          renderRecentDropdown();
        }
      })
      .catch(error => {
        if (!isAbortError(error)) deps.reportError('Failed to save scene JSON.', error);
      });
  };
  elements.saveButton?.addEventListener('click', () => saveDocument(false));
  elements.saveAsButton?.addEventListener('click', () => saveDocument(true));
  elements.exportProjectButton?.addEventListener('click', () => {
    deps.setButtonDisabled(elements.exportProjectButton, true);
    void deps.workflows.exportProject({
      prepare: ({ signal, reportProgress }) => deps.prepareRuntimeProjectDownload(world, { signal, reportProgress }),
      commit: download => deps.downloadPreparedFile(download),
    })
      .then(throwWorkflowFailure)
      .catch(error => deps.reportError('Failed to export frontend project.', error))
      .finally(() => deps.setButtonDisabled(elements.exportProjectButton, false));
  });
  elements.openButton?.addEventListener('click', () => {
    void openWithSystemPicker()
      .then(handled => {
        if (!handled) openFallbackFileInput();
      })
      .catch(error => deps.reportError('Failed to open scene JSON.', error));
  });
  elements.recentScenesDropdown?.addEventListener('item-select', event => {
    const value = (event as CustomEvent<GEDropdownSelectDetail>).detail.value;
    if (value === 'open-scene') {
      void openWithSystemPicker()
        .then(handled => {
          if (!handled) openFallbackFileInput();
        })
        .catch(error => deps.reportError('Failed to open scene JSON.', error));
    } else if (value === 'clear-recent') {
      deps.clearRecentSceneFiles?.();
      renderRecentDropdown();
    } else if (value.startsWith('recent:')) {
      const openedAt = Number(value.slice('recent:'.length));
      const fileSession = deps.getRecentSceneFiles?.().find(item => item.openedAt === openedAt);
      if (!fileSession || !deps.openRecentSceneFile) return;
      void deps.openRecentSceneFile(fileSession)
        .then(result => {
          if (!result) return;
          return openSceneFile(result.file, { handle: result.handle });
        })
        .catch(error => deps.reportError('Failed to reopen recent scene.', error));
    }
  });
  elements.openFileInput?.addEventListener('change', () => {
    const file = elements.openFileInput?.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        await openSceneFile(file);
      } catch (error) {
        deps.reportError('Failed to open scene JSON.', error);
      } finally {
        if (elements.openFileInput) elements.openFileInput.value = '';
      }
    })();
  });
  renderRecentDropdown();
  const unsubscribeRecent = deps.onRecentSceneFilesChange?.(renderRecentDropdown);
  onEditorLanguageChange(renderRecentDropdown);

  const updateDocumentChrome = (): void => {
    const state = deps.getDocumentState();
    const name = state.documentName ?? 'Untitled Scene';
    document.title = `${state.dirty ? '● ' : ''}${name} — 海月编辑器`;
    elements.saveButton?.toggleAttribute('data-dirty', state.dirty);
    if (elements.saveButton) elements.saveButton.setAttribute('aria-label', state.dirty ? `Save ${name} (unsaved)` : `Save ${name}`);
    if (state.dirty) recovery?.changed();
  };
  const unsubscribeProject = deps.onProjectChanged(updateDocumentChrome);
  updateDocumentChrome();
  void recovery?.load().then(async record => {
    if (!record || record.currentRevision === record.savedRevision) return;
    const when = new Date(record.updatedAt).toLocaleString();
    if (!window.confirm(`Recover unsaved changes from ${when}?`)) {
      recovery.saved();
      return;
    }
    validateSerializedEditorScene(record.scene);
    await deps.activateOptionalCapabilitiesForProject(record.scene);
    applyLoadedScene(record.scene);
    fileSession.detach();
    deps.markDocumentRecovered(record.documentName);
  }).catch(error => deps.reportError('Failed to restore automatic scene recovery.', error));

  deps.shortcuts.register({ id: 'document.save', chord: 'Mod+S', handler: () => saveDocument(false) });
  deps.shortcuts.register({ id: 'document.saveAs', chord: 'Mod+Shift+S', handler: () => saveDocument(true) });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void recovery?.flush();
  });
  window.addEventListener('beforeunload', event => {
    unsubscribeRecent?.();
    unsubscribeProject();
    recovery?.dispose();
    if (!deps.getDocumentState().dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }, { once: true });
}

function measureOpenSceneStage<T>(stage: string, task: () => T): T {
  const startedAt = performance.now();
  try {
    return task();
  } finally {
    performance.measure(`editor.open.${stage}`, {
      start: startedAt,
      duration: performance.now() - startedAt,
    });
  }
}

async function measureOpenSceneStageAsync<T>(stage: string, task: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    performance.measure(`editor.open.${stage}`, {
      start: startedAt,
      duration: performance.now() - startedAt,
    });
  }
}

export function setupPlayEvents(deps: AppEventDeps): void {
  const { elements, world, playDevicePreview, playSession } = deps;
  elements.playButton?.addEventListener('click', () => {
    playDevicePreview.applyPreview();
    void deps.workflows.preview({
      prepare: ({ signal }) => playSession.prepare(world, signal),
      commit: scene => playSession.open(scene),
      rollback: (_reason, prepared) => { if (prepared) playSession.close(); },
    })
      .then(throwWorkflowFailure)
      .catch(error => deps.reportError('Failed to play scene.', error));
  });
  elements.playDeviceSelect?.addEventListener('change', () => {
    playDevicePreview.selectDevice(elements.playDeviceSelect?.value ?? '');
    playSession.reload();
  });
  elements.playDeviceDprInput?.addEventListener('change', () => {
    playDevicePreview.applyPreview();
    playSession.reload();
  });
  elements.playDeviceZoomInput?.addEventListener('input', () => {
    playDevicePreview.applyPreview({ commitZoomInput: false });
  });
  elements.playDeviceZoomInput?.addEventListener('change', () => {
    playDevicePreview.applyPreview({ commitZoomInput: true });
  });
  elements.playDeviceZoomInput?.addEventListener('blur', () => {
    playDevicePreview.applyPreview({ commitZoomInput: true });
  });
  for (const input of [elements.playDeviceWidthInput, elements.playDeviceHeightInput]) {
    input?.addEventListener('change', () => {
      playDevicePreview.selectCustomFromSizeInputs();
      playDevicePreview.applyPreview();
      playSession.reload();
    });
  }
  if (elements.playDeviceSelect) elements.playDeviceSelect.value = playDevicePreview.deviceId;
  playDevicePreview.applyPreview();
  elements.playCloseButton?.addEventListener('click', () => {
    deps.workflows.cancel('preview');
    playSession.close();
  });
  elements.playRestartButton?.addEventListener('click', () => playSession.restart());
  elements.playPauseButton?.addEventListener('click', () => playSession.togglePause());
  elements.playOverlay?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') playSession.close();
  });
}

export function setupStarterKitEvents(deps: AppEventDeps): void {
  const { elements, world, selectionState } = deps;
  if (!elements.starterKitDropdown) return;
  elements.starterKitDropdown.items = deps.getStarterKitDropdownItems();
  elements.starterKitDropdown.addEventListener('item-select', (event) => {
    const value = (event as CustomEvent<GEDropdownSelectDetail>).detail.value;
    const kit = deps.starterKits.find(item => item.name === value);
    if (!kit) return;
    kit.apply({
      world,
      tree: deps.getTree(),
      getSelection: () => selectionState.selection,
      setActive: entity => { selectionState.setActive(entity); },
      setSelection: selection => { selectionState.setSelection(selection); },
      ensure2DCamera: deps.ensure2DCamera,
    });
  });
}

function formatRecentSceneLabel(file: { name: string; path?: string; openedAt: number }): string {
  const openedDate = Number.isFinite(file.openedAt) ? new Date(file.openedAt) : null;
  const time = openedDate ? openedDate.toLocaleString() : '';
  const name = file.path || file.name;
  return time ? `${name} - ${time}` : name;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwWorkflowFailure(result: WorkflowResult<unknown>): void {
  if (result.status === 'failed') throw result.error;
}
