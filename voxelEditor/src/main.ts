import { defineHaiyueUI } from '@haiyue/ui';
import {
  ClearDocumentCommand,
  CommandHistory,
  createSetVoxelsCommand,
  SceneResizeCommand,
} from './commands';
import { AnimationController } from './controllers/AnimationController';
import { ModulePanelController } from './controllers/ModulePanelController';
import { PaletteController } from './controllers/PaletteController';
import { ProjectIOController } from './controllers/ProjectIOController';
import { ProjectSessionController } from './controllers/ProjectSessionController';
import { ViewportInteractionController } from './controllers/ViewportInteractionController';
import { ViewportSliceController } from './controllers/ViewportSliceController';
import { VoxelBrushController } from './controllers/VoxelBrushController';
import { VoxelPaintController } from './controllers/VoxelPaintController';
import { EditorHelpController } from './controllers/EditorHelpController';
import { SelectionTransformController } from './controllers/SelectionTransformController';
import { ModuleGizmoController } from './controllers/ModuleGizmoController';
import { SceneBackgroundController } from './controllers/SceneBackgroundController';
import { ViewportInputController } from './controllers/ViewportInputController';
import { VoxelSelectionController } from './controllers/VoxelSelectionController';
import { VoxelDocument } from './model';
import type {
  VoxelDocumentChangeDetail,
  VoxelDocumentDirtyFlags,
} from './model';
import { generateShapeVoxels } from './shapeGenerator';
import type { VoxelShapeKind } from './shapeGenerator';
import { VoxelSelection } from './selection';
import { VoxelRenderer } from './VoxelRenderer';
import { createVoxelCameraStatePort, runPreservingCamera } from './cameraHistory';
import { UiRenderScheduler, type VoxelRenderInvalidation } from './uiRenderScheduler';
import { initializeEditorLocalization, translate } from './localization';
import {
  connectVoxelEditorPlatform,
  disposeVoxelEditorPlatform,
  startVoxelEditorPlatform,
  voxelEditorPlatform,
} from './platform/voxelEditorPlatform';

await startVoxelEditorPlatform();
defineHaiyueUI();
initializeEditorLocalization();
new EditorHelpController();

const documentModel = new VoxelDocument();
const commandHistory = new CommandHistory(100, 64 * 1024 * 1024, voxelEditorPlatform.history)
  .setTransactionRunner(operation => documentModel.transact(operation));
const voxelSelection = new VoxelSelection();
let renderer: VoxelRenderer | null = null;
const sceneBackgroundController = new SceneBackgroundController({
  document: documentModel,
  history: commandHistory,
  getRenderer: () => renderer,
  notify,
});

const byId = <T extends Element>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
};

const canvas = byId<HTMLCanvasElement>('viewport');
const voxelCount = byId<HTMLElement>('voxel-count');
const coordinate = byId<HTMLElement>('coordinate');
const toast = byId<HTMLElement>('toast');
const sizeX = byId<HTMLInputElement>('size-x');
const sizeY = byId<HTMLInputElement>('size-y');
const sizeZ = byId<HTMLInputElement>('size-z');
const shapeKind = byId<HTMLSelectElement>('shape-kind');
const undoButton = byId<HTMLElement>('undo-command');
const redoButton = byId<HTMLElement>('redo-command');
const selectionKind = byId<HTMLSelectElement>('selection-kind');
const boxSelectionMode = byId<HTMLSelectElement>('box-selection-mode');
const selectionCount = byId<HTMLElement>('selection-count');
const selectionRect = byId<HTMLElement>('selection-rect');
const paletteController = new PaletteController({ document: documentModel, history: commandHistory, notify });
let selectionController: VoxelSelectionController;
let selectionTransformController: SelectionTransformController;
const viewportController = new ViewportInteractionController({
  canvas,
  getRenderer: () => renderer,
  getSelectionCount: () => selectionController.count,
  getSelectedVoxels: () => selectionController.viewVoxels(),
  notify,
  onToolChange: tool => selectionTransformController.setEnabled(tool === 'select'),
});
const viewportSliceController = new ViewportSliceController({
  getRenderer: () => renderer,
  getSize: () => documentModel.viewSize,
  requestRender: requestRenderRefresh,
});
selectionController = new VoxelSelectionController({
  document: documentModel,
  history: commandHistory,
  selection: voxelSelection,
  countElement: selectionCount,
  getRenderer: () => renderer,
  getOffset: () => ({
    x: numberInput('selection-offset-x'),
    y: numberInput('selection-offset-y'),
    z: numberInput('selection-offset-z'),
  }),
  getPivot: () => selectionTransformController?.pivot ?? null,
  syncTransform: () => selectionTransformController?.sync(false) ?? false,
  syncViewportCount: count => viewportController.syncSelectionCount(count),
  requestRender: requestRenderRefresh,
  notify,
});
const brushController = new VoxelBrushController({
  document: documentModel,
  history: commandHistory,
  palette: paletteController,
  getRenderer: () => renderer,
  notify,
});
new VoxelPaintController({
  document: documentModel,
  history: commandHistory,
  getSelectionKeys: () => selectionController.keys,
  notify,
});
selectionTransformController = new SelectionTransformController({
  getRenderer: () => renderer,
  getSelectedVoxels: () => selectionController.editableVoxels(),
  execute: (result, label, duplicate) => selectionController.replace(result, label, !duplicate),
  requestRender: requestRenderRefresh,
});
let animationController: AnimationController;
const modulePanelController = new ModulePanelController({
  document: documentModel,
  history: commandHistory,
  notify,
  getRenderer: () => renderer,
  requestRenderRefresh,
  resetCamera: () => renderer?.resetCamera(),
  onSelectionChange: () => animationController?.sync(),
  getSelectedBaseVoxels: () => selectionController.baseVoxels(),
});
animationController = new AnimationController({
  document: documentModel,
  history: commandHistory,
  notify,
  getSelectedInstanceId: () => modulePanelController.selectedInstanceId,
  getRenderer: () => renderer,
});
const moduleGizmoController = new ModuleGizmoController({
  document: documentModel,
  history: commandHistory,
  getRenderer: () => renderer,
  getSelectedInstanceId: () => modulePanelController.selectedInstanceId,
  getMode: () => modulePanelController.gizmoMode,
  getEditableSelectedInstance: () => modulePanelController.editableSelectedInstance(),
  executeInstanceTransform: (after, label) => modulePanelController.executeInstanceTransform(after, label),
});
const viewportInputController = new ViewportInputController({
  canvas,
  coordinate,
  selectionRect,
  selectionKind,
  boxSelectionMode,
  document: documentModel,
  viewport: viewportController,
  brush: brushController,
  selection: selectionController,
  selectionTransform: selectionTransformController,
  moduleGizmo: moduleGizmoController,
  getRenderer: () => renderer,
  selectModuleInstance: id => modulePanelController.selectInstance(id),
  undo,
  redo,
  notify,
});
window.addEventListener('pagehide', () => viewportInputController.dispose(), { once: true });
const uiRenderScheduler = new UiRenderScheduler(flushUiUpdates);

function numberInput(id: string): number {
  return Number(byId<HTMLInputElement>(id).value);
}

function syncSceneStatsUi(): void {
  voxelCount.textContent = documentModel.sceneVoxelCount.toLocaleString();
}

function syncSizeUi(): void {
  sizeX.value = String(documentModel.size.x);
  sizeY.value = String(documentModel.size.y);
  sizeZ.value = String(documentModel.size.z);
}

function syncUi(): void {
  syncSceneStatsUi();
  syncSizeUi();
  paletteController.sync();
  brushController.syncLocale();
}

function syncHistoryUi(): void {
  undoButton.toggleAttribute('disabled', !commandHistory.canUndo);
  redoButton.toggleAttribute('disabled', !commandHistory.canRedo);
  undoButton.title = commandHistory.undoLabel
    ? translate('history.undoLabel', { label: commandHistory.undoLabel })
    : translate('history.noUndo');
  redoButton.title = commandHistory.redoLabel
    ? translate('history.redoLabel', { label: commandHistory.redoLabel })
    : translate('history.noRedo');
}

function undo(): void {
  const label = runPreservingCamera(createVoxelCameraStatePort(renderer), () => commandHistory.undo());
  if (!label) return;
  notify(`已撤销：${label}`);
}

function redo(): void {
  const label = runPreservingCamera(createVoxelCameraStatePort(renderer), () => commandHistory.redo());
  if (!label) return;
  notify(`已重做：${label}`);
}

function scheduleUiUpdate(
  dirty: Readonly<VoxelDocumentDirtyFlags>,
  impact?: Readonly<VoxelDocumentChangeDetail['impact']>,
): void {
  uiRenderScheduler.schedule(dirty, impact);
}

function requestRenderRefresh(): void {
  uiRenderScheduler.requestRender();
}

function flushUiUpdates(
  dirty: Readonly<VoxelDocumentDirtyFlags>,
  invalidation: Readonly<VoxelRenderInvalidation>,
): void {
  if (dirty.selection === 'clear') selectionController.clear(false);
  else if (dirty.selection === 'retain') selectionController.retainCurrentView();

  if (dirty.scene) syncSceneStatsUi();
  if (dirty.palette) {
    paletteController.sync();
  }
  if (dirty.grid) {
    syncSizeUi();
    viewportSliceController.syncSize(false);
  }
  let renderStateChanged = false;
  if (dirty.modules) renderStateChanged = modulePanelController.sync(false) || renderStateChanged;
  if (dirty.animation) animationController.sync();
  if (dirty.selection !== 'none') renderStateChanged = selectionController.sync(false) || renderStateChanged;
  if (dirty.grid) renderer?.rebuildGrid();
  if (dirty.render || renderStateChanged) renderer?.refreshVoxels(renderStateChanged ? undefined : invalidation);
}

function notify(message: string, error = false): void {
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

let projectSessionController: ProjectSessionController;
const projectIOController = new ProjectIOController({
  document: documentModel,
  history: commandHistory,
  notify,
  resetCamera: () => renderer?.resetCamera(),
  setCopiedModuleId: moduleId => modulePanelController.setCopiedModuleId(moduleId),
  onProjectOpened: (name, format) => projectSessionController.projectOpened(name, format),
  confirmReplaceProject: () => projectSessionController.confirmReplace(),
});
projectSessionController = new ProjectSessionController({
  document: documentModel,
  history: commandHistory,
  io: projectIOController,
  notify,
  resetCamera: () => renderer?.resetCamera(),
});
const platformBindings = connectVoxelEditorPlatform(documentModel, voxelSelection, projectSessionController);
window.addEventListener('pagehide', () => {
  platformBindings.dispose();
  commandHistory.dispose();
  disposeVoxelEditorPlatform();
}, { once: true });

document.addEventListener('voxel-editor-locale-change', () => {
  paletteController.sync();
  brushController.syncLocale();
  viewportController.syncLocale();
  viewportInputController.syncLocale();
  modulePanelController.sync(false);
  animationController.sync();
  projectIOController.syncLocale();
  projectSessionController.syncLocale();
  syncHistoryUi();
});

documentModel.addEventListener('change', event => {
  const { reason, dirty, impact } = (event as CustomEvent<VoxelDocumentChangeDetail>).detail;
  if (reason === 'scene-background' || reason === 'load') sceneBackgroundController.sync();
  if (reason === 'load' || reason === 'animation-create'
    || reason === 'animation-remove' || reason === 'animation-select') animationController.stopPlayback();
  if (reason === 'animation-frame') {
    modulePanelController.syncAnimationFrame();
    animationController.syncFrame();
  }
  scheduleUiUpdate(dirty, impact);
});

commandHistory.addEventListener('change', syncHistoryUi);
undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);

selectionController.bindActions({
  selectAll: byId('select-all'),
  invert: byId('invert-selection'),
  clear: byId('clear-selection'),
  move: byId('move-selection'),
  duplicate: byId('duplicate-selection'),
  copy: byId('copy-selection'),
  cut: byId('cut-selection'),
  paste: byId('paste-selection'),
  delete: byId('delete-selection'),
  rotateButtons: [...document.querySelectorAll<HTMLButtonElement>('[data-selection-rotate]')],
  flipButtons: [...document.querySelectorAll<HTMLButtonElement>('[data-selection-flip]')],
});

byId('apply-size').addEventListener('click', () => {
  const next = { x: Number(sizeX.value), y: Number(sizeY.value), z: Number(sizeZ.value) };
  const command = new SceneResizeCommand(documentModel, next);
  const changed = commandHistory.execute(command);
  if (!changed) {
    syncUi();
    notify('场景尺寸没有变化。');
    return;
  }
  renderer?.resetCamera();
  notify(command.removedCount > 0 ? `场景尺寸已更新，移除了 ${command.removedCount} 个越界体素。` : '场景尺寸已更新。');
});

byId('generate-shape').addEventListener('click', () => {
  try {
    const bounds = {
      min: {
        x: numberInput('shape-min-x'),
        y: numberInput('shape-min-y'),
        z: numberInput('shape-min-z'),
      },
      max: {
        x: numberInput('shape-max-x'),
        y: numberInput('shape-max-y'),
        z: numberInput('shape-max-z'),
      },
    };
    const positions = generateShapeVoxels(shapeKind.value as VoxelShapeKind, bounds, documentModel.viewSize);
    const { command, result } = createSetVoxelsCommand(documentModel, positions, documentModel.currentColor, '批量生成形状');
    if (command) commandHistory.execute(command);
    const changed = result.added + result.painted;
    notify(changed > 0
      ? `批量生成完成：新增 ${result.added.toLocaleString()}，着色 ${result.painted.toLocaleString()} 个体素。`
      : '所选区域没有需要更新的体素。');
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), true);
  }
});

byId('clear-scene').addEventListener('click', () => {
  if (documentModel.viewVoxels.size === 0 && (documentModel.isEditingModule || documentModel.moduleInstances.length === 0)) return;
  const targetName = documentModel.isEditingModule ? '当前模块' : '当前场景及其中的模块实例';
  if (!window.confirm(`确定清空${targetName}吗？`)) return;
  if (commandHistory.execute(new ClearDocumentCommand(documentModel, `清空${targetName}`))) {
    notify(`${targetName}已清空。`);
  }
});

async function main(): Promise<void> {
  await projectSessionController.initialize();
  syncUi();
  modulePanelController.sync();
  animationController.sync();
  syncHistoryUi();
  viewportController.setTool('add', selectionController.count);
  try {
    renderer = await VoxelRenderer.create(canvas, documentModel);
    sceneBackgroundController.sync();
    selectionController.sync();
    viewportController.attachRenderer();
    viewportSliceController.attachRenderer();
    byId('loading').classList.add('hidden');
  } catch (error) {
    byId('loading').innerHTML = `<strong>无法启动 WebGPU</strong><span>${escapeHtml(error instanceof Error ? error.message : String(error))}</span>`;
    notify('WebGPU 初始化失败。', true);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

void main();
