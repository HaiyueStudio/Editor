import {
  ANIMATION_VERSION,
  type HyaStateMachineParameter,
} from '@haiyue/animation-spec';
import {
  defineHaiyueUI,
  type GEDialog,
  type GEDropdown,
  type GEDropdownSelectDetail,
  type GECheckbox,
  type GECheckboxChangeDetail,
  type GEInput,
  type GEInputChangeDetail,
  type GESplit,
  type GESplitRatioChangeDetail,
  type GETree,
  type GETreeDataChangeDetail,
  type GETreeNodeData,
  type GETreeSelectionChangeDetail,
} from '@haiyue/ui';
import { AnimationEditorStore } from './domain/AnimationEditorStore';
import { CommandHistory, createProjectMutationCommand } from './domain/CommandHistory';
import {
  animationEditorProjectFingerprint,
  cloneAnimationEditorProject,
  createEmptyAnimationEditorProject,
  type AnimationEditorProject,
  type AnimationEditorTrack,
  type DeepMutable,
} from './domain/AnimationEditorProject';
import { setCompositionDuration } from './domain/CompositionAuthoring';
import {
  generateSpriteSheetAnimation,
  setSpriteSheetFrame,
} from './domain/SpriteSheetAuthoring';
import { SelectionStore, type AnimationEditorSelectionItem } from './domain/SelectionStore';
import {
  animationAssetReferences,
  applyAnimationNodeHierarchy,
  buildAnimationNodeHierarchy,
  createBasicAnimationNode,
  deleteAnimationNodeSubtrees,
  duplicateAnimationNodes,
  type AnimationEditorBasicNodeKind,
  type AnimationEditorHierarchyNode,
} from './domain/SceneAuthoring';
import {
  availableCoreTransformProperties,
  coreTransformPropertyLabel,
  createCoreTransformTrack,
  createTimelineClip,
  createTimelineKeyframe,
  deleteTimelineClips,
  deleteTimelineKeyframes,
  deleteTimelineTracks,
  moveTimelineKeyframe,
  snapTimelineTime,
  type CoreTransformProperty,
  type TimelineKeyframeReference,
} from './domain/TimelineAuthoring';
import {
  availableAdvancedPropertyBindings,
  createAdvancedPropertyTrack,
} from './domain/AdvancedContentAuthoring';
import {
  downloadAnimationEditorProject,
  readAnimationEditorProjectFile,
} from './persistence/ProjectFileIO';
import {
  AnimationEditorProjectFormatError,
  projectFileName,
} from './persistence/ProjectCodec';
import { AnimationEditorProjectSession } from './persistence/ProjectSession';
import type { ProjectSnapshot } from './persistence/ProjectStorage';
import {
  AnimationEditorAssetImportError,
  createAnimationEditorAssetFromFile,
} from './persistence/AssetImport';
import { SourceImportCoordinator } from './persistence/SourceImport';
import {
  AnimationEditorCompileError,
  compileAnimationEditorProject,
  type AnimationEditorCompilation,
} from './compiler/AnimationEditorCompiler';
import { downloadHyaFile } from './compiler/HyaFileIO';
import { downloadHyaPackage } from './compiler/HyaPackageIO';
import {
  AnimationEditorRuntimePreview,
  type AnimationEditorPreviewFrame,
} from './preview/AnimationEditorRuntimePreview';
import { renderAnimationEditorInspector } from './authoring/Inspector';
import { renderStateMachineInspector } from './authoring/StateMachineInspector';
import {
  createAnimationEditorStateMachine,
  createStateMachineLayer,
  createStateMachineParameter,
  createStateMachineState,
  createStateMachineTransition,
  deleteStateMachineLayer,
  deleteStateMachineParameter,
  deleteStateMachineState,
  deleteStateMachineTransition,
  renameStateMachineParameter,
  stateMachineClipReferences,
  stateMachineParameterReferences,
  type StateMachineParameterType,
} from './domain/StateMachineAuthoring';
import {
  getAnimationEditorLocale,
  initializeAnimationEditorLocalization,
  localizedText,
  localizeLiteral,
  translate,
} from './localization';
import {
  DESIGNER_TEMPLATES,
  createDesignerTemplateProject,
  type DesignerTemplateId,
} from './integration/DesignerTemplates';
import { detectDesignerProjectFamily, relinkAnimationEditorAsset } from './integration/DesignerProjectIO';
import { DesignerTaskCoordinator } from './integration/DesignerTaskCoordinator';
import { DesignerViewportInteraction } from './integration/DesignerViewportInteraction';

defineHaiyueUI();
initializeAnimationEditorLocalization();

const SPLIT_LAYOUT_STORAGE_KEY = 'haiyue-animation-editor:split-layout@1';
const TIMELINE_END_PADDING = 32;
const store = new AnimationEditorStore(createEmptyAnimationEditorProject());
const selection = new SelectionStore();
const history = new CommandHistory();
let playing = false;
let statusMessage = translate('status.ready');
let recoverySnapshot: ProjectSnapshot | null = null;
let dragDepth = 0;
let pendingConfirm: ((accepted: boolean) => void) | null = null;
let projectSessionInitialized = false;
let previewCompileTimer: number | null = null;
let timelinePointerPersistTimer: number | null = null;
let timelineLayoutFrame: number | null = null;
let observedTimelineWidth = 0;
let previewGeneration = 0;
let previewTime: number | null = null;
let compiledFingerprint = '';
let currentCompilation: AnimationEditorCompilation | null = null;
let runtimeStateLayers: AnimationEditorPreviewFrame['stateMachineLayers'] = [];
const runtimeParameterValues = new Map<string, number | boolean>();
const designerTasks = new DesignerTaskCoordinator();
const sourceImports = new SourceImportCoordinator();
let relinkAssetId: string | null = null;

const newProject = query<HTMLElement>('#new-project');
const openProject = query<HTMLElement>('#open-project');
const saveProjectButton = query<HTMLElement>('#save-project');
const saveAsProject = query<HTMLElement>('#save-as-project');
const closeProject = query<HTMLElement>('#close-project');
const showCompositionSettingsButton = query<HTMLButtonElement>('#show-composition-settings');
const undoButton = query<HTMLElement>('#undo-command');
const redoButton = query<HTMLElement>('#redo-command');
const addNodeMenu = query<GEDropdown>('#add-node-menu');
const addTrackMenu = query<GEDropdown>('#add-track-menu');
const addTrackButton = query<HTMLButtonElement>('#add-track');
const addKeyframeButton = query<HTMLButtonElement>('#add-keyframe');
const addClipButton = query<HTMLButtonElement>('#add-clip');
const timelineRuler = query<HTMLElement>('#timeline-ruler');
const timelineLanes = query<HTMLElement>('#timeline-lanes');
const deleteNodeButton = query<HTMLButtonElement>('#delete-node');
const importAssetButton = query<HTMLButtonElement>('#import-asset');
const deleteAssetButton = query<HTMLButtonElement>('#delete-asset');
const assetFileInput = query<HTMLInputElement>('#asset-file-input');
const sourceFileInput = query<HTMLInputElement>('#source-file-input');
const hierarchyTree = query<GETree>('#hierarchy-tree');
const playButton = query<HTMLButtonElement>('#toggle-play');
const tabs = query<HTMLElement & { value: string }>('#authoring-tabs');
const addParameterMenu = query<GEDropdown>('#add-parameter-menu');
const addParameterButton = query<HTMLButtonElement>('#add-parameter');
const addStateLayerButton = query<HTMLButtonElement>('#add-state-layer');
const addStateButton = query<HTMLButtonElement>('#add-state');
const addTransitionButton = query<HTMLButtonElement>('#add-transition');
const resetStateRuntimeButton = query<HTMLButtonElement>('#reset-state-runtime');
const createStateMachineButton = query<HTMLButtonElement>('#create-state-machine');
const projectFileInput = query<HTMLInputElement>('#project-file-input');
const recentMenu = query<GEDropdown>('#recent-projects-menu');
const confirmDialog = query<GEDialog>('#confirm-dialog');
const saveAsDialog = query<GEDialog>('#save-as-dialog');
const recoveryDialog = query<GEDialog>('#recovery-dialog');
const errorDialog = query<GEDialog>('#error-dialog');
const newProjectDialog = query<GEDialog>('#new-project-dialog');
const capabilityDialog = query<GEDialog>('#capability-dialog');
const dropOverlay = query<HTMLElement>('#drop-import-overlay');
const previewCanvas = query<HTMLCanvasElement>('#preview-canvas');
const exportHyaButton = query<HTMLElement>('#export-hya');
const exportPackageButton = query<HTMLElement>('#export-package');
const relinkAssetFileInput = query<HTMLInputElement>('#relink-asset-file-input');
const runtimePreview = new AnimationEditorRuntimePreview(previewCanvas, {
  onFrame: updatePreviewFrame,
  onError: error => setPreviewMessage(
    localizedText('WebGPU 预览错误', 'WebGPU preview error'),
    errorMessage(error),
    'error',
  ),
});
const session = new AnimationEditorProjectSession(store, {
  onStorageError: error => showError(localizedText('自动保存不可用', 'Autosave is unavailable'), error),
});
const viewportInteraction = new DesignerViewportInteraction({
  host: query<HTMLElement>('#viewport-stage'),
  surface: query<HTMLElement>('.canvas-frame'),
  compositionSize: [store.project.composition.canvas.width, store.project.composition.canvas.height],
  initialView: store.project.editor?.viewport ?? {
    zoom: 1,
    center: [store.project.composition.canvas.width / 2, store.project.composition.canvas.height / 2],
    showGrid: true,
  },
  label: localizedText(
    '动画画布：滚轮缩放，按住空格或鼠标中键平移，Shift 吸附到 10 像素网格',
    'Animation canvas: wheel to zoom, hold Space or middle mouse to pan, Shift to snap to a 10 px grid',
  ),
  onChange: view => store.update('change-viewport', draft => {
    draft.editor ??= {};
    draft.editor.viewport = { zoom: view.zoom, center: [...view.center], showGrid: view.showGrid };
  }),
});
const timelineResizeObserver = new ResizeObserver(entries => {
  const width = entries[0]?.contentRect.width ?? timelineLanes.clientWidth;
  if (Math.abs(width - observedTimelineWidth) < 1) return;
  observedTimelineWidth = width;
  scheduleTimelineLayoutRender();
});

initializeSplitLayout();
timelineResizeObserver.observe(timelineLanes);

newProject.addEventListener('click', () => showNewProjectDialog());
closeProject.addEventListener('click', () => void replaceWithEmptyProject(
  localizedText('关闭当前工程', 'Close the current project'),
  localizedText('已关闭当前工程。', 'Closed the current project.'),
));
showCompositionSettingsButton.addEventListener('click', () => {
  selection.clear();
  renderInspector();
});

openProject.addEventListener('click', () => void (async () => {
  if (!await confirmReplace(localizedText('打开其他工程', 'Open another project'))) return;
  projectFileInput.click();
})());

projectFileInput.addEventListener('change', () => void (async () => {
  const file = projectFileInput.files?.[0];
  projectFileInput.value = '';
  if (file) await openProjectFile(file);
})());

saveProjectButton.addEventListener('click', () => void saveProject());
exportHyaButton.addEventListener('click', () => exportHya());
exportPackageButton.addEventListener('click', () => void exportHyaPackage());

saveAsProject.addEventListener('click', showSaveAsDialog);

query<HTMLElement>('#save-as-cancel').addEventListener('click', () => saveAsDialog.close('action'));
query<HTMLElement>('#save-as-confirm').addEventListener('click', () => void saveProjectAs());
query<HTMLElement>('#confirm-cancel').addEventListener('click', () => settleConfirm(false));
query<HTMLElement>('#confirm-accept').addEventListener('click', () => settleConfirm(true));
confirmDialog.addEventListener('dialog-close', () => {
  if (!pendingConfirm) return;
  const resolve = pendingConfirm;
  pendingConfirm = null;
  resolve(false);
});

recentMenu.addEventListener('item-select', event => void openRecentProject(
  (event as CustomEvent<GEDropdownSelectDetail>).detail.value,
));

query<HTMLElement>('#restore-recovery').addEventListener('click', () => void restoreRecovery());
query<HTMLElement>('#discard-recovery').addEventListener('click', () => void discardRecovery());
query<HTMLElement>('#dismiss-error').addEventListener('click', () => errorDialog.close('action'));
query<HTMLElement>('#new-project-cancel').addEventListener('click', () => newProjectDialog.close('action'));
query<HTMLElement>('#capability-help').addEventListener('click', () => capabilityDialog.showModal());
query<HTMLElement>('#capability-close').addEventListener('click', () => capabilityDialog.close('action'));
query<HTMLElement>('#cancel-task').addEventListener('click', () => void designerTasks.cancel());

relinkAssetFileInput.addEventListener('change', () => void (async () => {
  const file = relinkAssetFileInput.files?.[0];
  relinkAssetFileInput.value = '';
  const assetId = relinkAssetId;
  relinkAssetId = null;
  if (!file || !assetId) return;
  try {
    const next = await designerTasks.run(localizedText('重链接资源', 'Relink asset'), async ({ report }) => {
      report(0.15, file.name);
      const project = await relinkAnimationEditorAsset(store.project, assetId, file);
      report(1, file.name);
      return project;
    });
    const replacement = next.assets.find(asset => asset.id === assetId);
    if (!replacement || !commitAuthoringMutation('Relink Asset', draft => {
      const index = draft.assets.findIndex(asset => asset.id === assetId);
      if (index < 0) throw new RangeError(`Unknown asset "${assetId}".`);
      draft.assets[index] = structuredClone(replacement) as DeepMutable<typeof replacement>;
    })) return;
    selection.select({ kind: 'asset', id: assetId });
    statusMessage = localizedText(`已将资源重链接到 ${file.name}，引用 ID 保持不变。`, `Relinked the asset to ${file.name}; its reference id was preserved.`);
    render();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    showError(localizedText('资源重链接失败', 'Asset relink failed'), error);
  }
})());

designerTasks.subscribe(snapshot => {
  const host = query<HTMLElement>('#task-progress');
  const running = snapshot.state === 'running';
  host.hidden = !running;
  query<HTMLProgressElement>('#task-progress-value').value = snapshot.progress;
  query<HTMLElement>('#task-progress-label').textContent = snapshot.detail
    ? `${snapshot.label} · ${snapshot.detail}`
    : snapshot.label;
});

function showNewProjectDialog(): void {
  const host = query<HTMLElement>('#template-grid');
  host.replaceChildren();
  const locale = getAnimationEditorLocale();
  const blank = document.createElement('button');
  blank.type = 'button';
  blank.className = 'template-card';
  blank.append(
    textElement('strong', localizedText('空白 2D 工程', 'Blank 2D Project')),
    textElement('p', localizedText('从干净画布开始，手动添加节点和轨道。', 'Start from a clean canvas and add nodes and tracks manually.')),
    templateTags(['2d', 'blank']),
  );
  blank.addEventListener('click', () => void activateTemplate(null));
  host.append(blank);
  for (const definition of DESIGNER_TEMPLATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'template-card';
    button.dataset.templateId = definition.id;
    button.append(
      textElement('strong', definition.name[locale]),
      textElement('p', definition.description[locale]),
      templateTags([definition.family, ...definition.tags.filter(tag => tag !== definition.family)]),
    );
    button.addEventListener('click', () => void activateTemplate(definition.id));
    host.append(button);
  }
  newProjectDialog.showModal();
}

function templateTags(tags: readonly string[]): HTMLElement {
  const footer = document.createElement('footer');
  footer.append(...tags.slice(0, 3).map(tag => textElement('span', tag)));
  return footer;
}

async function activateTemplate(templateId: DesignerTemplateId | null): Promise<void> {
  const definition = templateId ? DESIGNER_TEMPLATES.find(candidate => candidate.id === templateId) : null;
  if (definition?.family === '3d') {
    if (!await confirmReplace(localizedText('打开原生 3D 工作区', 'Open the native 3D workspace'))) return;
    newProjectDialog.close('action');
    window.location.href = `./native3d.html?template=${encodeURIComponent(templateId!)}`;
    return;
  }
  if (!await confirmReplace(localizedText('从模板新建工程', 'Create a project from a template'))) return;
  const project = templateId
    ? createDesignerTemplateProject(templateId) as AnimationEditorProject
    : createEmptyAnimationEditorProject();
  await session.activateSavedProject(project, projectFileName(project.name), 'new-project-template', false);
  history.clear();
  selection.clear();
  resetStateMachineSessionState();
  newProjectDialog.close('action');
  statusMessage = templateId
    ? localizedText(`已从模板创建“${project.name}”。`, `Created “${project.name}” from a template.`)
    : localizedText('已新建空白 2D 动画工程。', 'Created a blank 2D animation project.');
  render();
}

async function replaceWithEmptyProject(action: string, message: string): Promise<void> {
  if (!await confirmReplace(action)) return;
  const project = createEmptyAnimationEditorProject();
  await session.activateSavedProject(project, projectFileName(project.name), 'new-project', false);
  history.clear();
  selection.clear();
  resetStateMachineSessionState();
  statusMessage = message;
  syncRecentMenu();
  render();
}

undoButton.addEventListener('click', () => {
  const label = history.undo();
  if (label) statusMessage = localizedText(`已撤销 ${label}。`, `Undid ${label}.`);
  render();
});

redoButton.addEventListener('click', () => {
  const label = history.redo();
  if (label) statusMessage = localizedText(`已重做 ${label}。`, `Redid ${label}.`);
  render();
});

addNodeMenu.addEventListener('item-select', event => {
  const kind = (event as CustomEvent<GEDropdownSelectDetail>).detail.value as AnimationEditorBasicNodeKind;
  addBasicNode(kind);
});

addTrackMenu.addEventListener('item-select', event => {
  const value = (event as CustomEvent<GEDropdownSelectDetail>).detail.value;
  if (value.startsWith('advanced:')) addAdvancedPropertyTrack(value.slice('advanced:'.length));
  else addCoreTransformTrack(value as CoreTransformProperty);
});
addKeyframeButton.addEventListener('click', () => addKeyframeAtPlayhead());
addClipButton.addEventListener('click', () => addNamedClip());
query<HTMLButtonElement>('#timeline-zoom-out').addEventListener('click', () => zoomTimeline(0.75));
query<HTMLButtonElement>('#timeline-zoom-in').addEventListener('click', () => zoomTimeline(4 / 3));

createStateMachineButton.addEventListener('click', () => createProjectStateMachine());
addParameterMenu.addEventListener('item-select', event => {
  addStateMachineParameter(
    (event as CustomEvent<GEDropdownSelectDetail>).detail.value as StateMachineParameterType,
  );
});
addStateLayerButton.addEventListener('click', () => addStateMachineLayer());
addStateButton.addEventListener('click', () => addStateMachineState());
addTransitionButton.addEventListener('click', () => connectSelectedStates());
resetStateRuntimeButton.addEventListener('click', () => resetStateMachineRuntime());

deleteNodeButton.addEventListener('click', () => deleteSelectedNodes());
importAssetButton.addEventListener('click', () => assetFileInput.click());
query<HTMLButtonElement>('#import-source').addEventListener('click', () => sourceFileInput.click());
deleteAssetButton.addEventListener('click', () => deleteSelectedAsset());

assetFileInput.addEventListener('change', () => {
  const files = [...(assetFileInput.files ?? [])];
  assetFileInput.value = '';
  if (files.length > 0) void importAssetFiles(files);
});
sourceFileInput.addEventListener('change', () => void importSourceFile());

hierarchyTree.addEventListener('selection-change', event => {
  const detail = (event as CustomEvent<GETreeSelectionChangeDetail>).detail;
  queueMicrotask(() => selection.replace(detail.selectedIds.map(id => ({ kind: 'node', id }))));
});

hierarchyTree.addEventListener('data-change', event => {
  handleHierarchyChange((event as CustomEvent<GETreeDataChangeDetail>).detail);
});

playButton.addEventListener('click', () => void toggleRuntimePlayback());

query<HTMLButtonElement>('#jump-start').addEventListener('click', () => updatePlayhead(0));
query<HTMLButtonElement>('#jump-end').addEventListener('click', () => updatePlayhead(store.project.composition.duration));

tabs.addEventListener('tab-change', event => {
  const detail = (event as CustomEvent<{ value: 'timeline' | 'state-machine' }>).detail;
  store.update('change-authoring-panel', draft => {
    draft.editor ??= {};
    draft.editor.activePanel = detail.value;
  });
});

window.addEventListener('keydown', event => {
  const commandKey = event.metaKey || event.ctrlKey;
  if (!commandKey && !event.altKey && (event.key === 'Delete' || event.key === 'Backspace')) {
    if (isEditableEventTarget(event.target)) return;
    if (deleteSelectedTimelineItems()) event.preventDefault();
    return;
  }
  if (!commandKey || event.altKey) return;
  if (event.key.toLocaleLowerCase() === 's') {
    event.preventDefault();
    if (!event.repeat) void (event.shiftKey ? showSaveAsDialog() : saveProject());
    return;
  }
  if (event.key.toLocaleLowerCase() !== 'z') return;
  event.preventDefault();
  const label = event.shiftKey ? history.redo() : history.undo();
  if (label) statusMessage = event.shiftKey
    ? localizedText(`已重做 ${label}。`, `Redid ${label}.`)
    : localizedText(`已撤销 ${label}。`, `Undid ${label}.`);
  render();
});

window.addEventListener('beforeunload', event => {
  if (!store.isDirty) return;
  event.preventDefault();
});

window.addEventListener('pagehide', () => {
  cancelTimelinePointerPersistence();
  timelineResizeObserver.disconnect();
  if (timelineLayoutFrame !== null) window.cancelAnimationFrame(timelineLayoutFrame);
  session.dispose();
  viewportInteraction.destroy();
  void sourceImports.close();
  void designerTasks.close();
  runtimePreview.destroy();
}, { once: true });

window.addEventListener('dragenter', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  dropOverlay.classList.add('visible');
});

window.addEventListener('dragover', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('dragleave', event => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.remove('visible');
});

window.addEventListener('drop', event => void (async () => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('visible');
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0) return;
  const projectFile = files.length === 1 && files[0]!.name.toLowerCase().endsWith('.hya-project.json')
    ? files[0]
    : null;
  if (projectFile) {
    if (await confirmReplace(localizedText('打开拖入的工程', 'Open the dropped project'))) await openProjectFile(projectFile);
    return;
  }
  await importAssetFiles(files);
})());

store.subscribe(change => {
  selection.prune(item => selectionItemExists(change.project, item));
  render();
  if (animationEditorProjectFingerprint(change.project) !== animationEditorProjectFingerprint(change.previousProject)) {
    scheduleRuntimeCompile();
  }
});
selection.subscribe(() => render());
history.subscribe(() => renderHistory());

const gpuStatus = query<HTMLElement>('#gpu-status');
if ('gpu' in navigator) {
  gpuStatus.textContent = translate('preview.gpuAvailable');
  gpuStatus.dataset.state = 'ready';
} else {
  gpuStatus.textContent = translate('preview.gpuUnavailable');
  gpuStatus.dataset.state = 'unavailable';
}

document.addEventListener('animation-editor-locale-change', () => {
  gpuStatus.textContent = translate('gpu' in navigator ? 'preview.gpuAvailable' : 'preview.gpuUnavailable');
  statusMessage = translate('status.languageChanged');
  syncRecentMenu();
  render();
  void refreshRuntimePreview();
});

query<HTMLElement>('#runtime-target').textContent = `HYA ${ANIMATION_VERSION} · screen-y-down`;
render();
void initializeProjectSession();

async function initializeProjectSession(): Promise<void> {
  const startup = await session.initialize();
  if (startup.restoredCurrent) {
    history.clear();
    selection.clear();
    statusMessage = localizedText(
      `已恢复上次打开的工程“${store.project.name}”。`,
      `Restored the last open project “${store.project.name}”.`,
    );
  }
  syncRecentMenu();
  render();
  projectSessionInitialized = true;
  await refreshRuntimePreview();
  if (!startup.recovery) return;
  recoverySnapshot = startup.recovery;
  const time = new Date(startup.recovery.updatedAt).toLocaleString();
  query<HTMLElement>('#recovery-message').textContent = localizedText(
    `“${startup.recovery.name}”存在 ${time} 保存的未提交修改。\n恢复会替换当前画布，原保存基线仍会保留。`,
    `“${startup.recovery.name}” has unsaved changes from ${time}.\nRestoring replaces the current canvas while keeping the saved baseline.`,
  );
  recoveryDialog.showModal();
}

function addBasicNode(kind: AnimationEditorBasicNodeKind): void {
  if (!['group', 'rectangle', 'ellipse', 'path', 'vector', 'text', 'sprite', 'particle', 'audio'].includes(kind)) return;
  const selectedNode = selection.primary?.kind === 'node'
    ? store.project.nodes.find(node => node.id === selection.primary?.id)
    : undefined;
  if (selectedNode?.editor?.locked) {
    statusMessage = localizedText(
      `节点“${selectedNode.name}”已锁定，不能添加子节点。`,
      `Node “${selectedNode.name}” is locked and cannot accept child nodes.`,
    );
    renderStatus();
    return;
  }
  try {
    const node = createBasicAnimationNode(store.project, kind, selectedNode ? { parentId: selectedNode.id } : {});
    if (!commitAuthoringMutation(`Add ${node.name}`, draft => { draft.nodes.push(node); })) return;
    selection.select({ kind: 'node', id: node.id });
    statusMessage = localizedText(
      `已添加 ${node.name}${selectedNode ? ` 到“${selectedNode.name}”` : ''}。`,
      `Added ${node.name}${selectedNode ? ` to “${selectedNode.name}”` : ''}.`,
    );
    render();
  } catch (error) {
    showError(localizedText('无法添加节点', 'Unable to add node'), error);
  }
}

function addCoreTransformTrack(property: CoreTransformProperty): void {
  if (!['position', 'rotation', 'scale', 'opacity'].includes(property)) return;
  const primary = selection.primary;
  if (primary?.kind !== 'node') {
    statusMessage = localizedText('请先选择要制作动画的节点。', 'Select a node to animate first.');
    renderStatus();
    return;
  }
  const node = store.project.nodes.find(candidate => candidate.id === primary.id);
  if (!node) return;
  if (node.editor?.locked) {
    statusMessage = localizedText(
      `节点“${node.name}”已锁定，不能添加动画轨道。`,
      `Node “${node.name}” is locked and cannot accept animation tracks.`,
    );
    renderStatus();
    return;
  }
  try {
    const track = createCoreTransformTrack(store.project, node.id, property, currentPlayhead());
    if (!commitAuthoringMutation(`Add ${coreTransformPropertyLabel(property)} Track`, draft => {
      draft.timeline.tracks.push(track);
    })) return;
    selection.select({ kind: 'track', id: track.id, ownerId: node.id });
    statusMessage = localizedText(
      `已为“${node.name}”添加 ${localizeLiteral(coreTransformPropertyLabel(property))} 轨道。`,
      `Added a ${coreTransformPropertyLabel(property)} track to “${node.name}”.`,
    );
    render();
  } catch (error) {
    showError(localizedText('无法添加轨道', 'Unable to add track'), error);
  }
}

function addAdvancedPropertyTrack(key: string): void {
  const primary = selection.primary;
  if (primary?.kind !== 'node') {
    statusMessage = localizedText('请先选择要制作动画的节点。', 'Select a node to animate first.');
    renderStatus();
    return;
  }
  const node = store.project.nodes.find(candidate => candidate.id === primary.id);
  if (!node || node.editor?.locked) return;
  try {
    const track = createAdvancedPropertyTrack(store.project, node.id, key, currentPlayhead());
    if (!commitAuthoringMutation(`Add ${track.name} Track`, draft => { draft.timeline.tracks.push(track); })) return;
    selection.select({ kind: 'track', id: track.id, ownerId: node.id });
    statusMessage = localizedText(`已添加高级属性轨道“${track.name}”。`, `Added advanced property track “${track.name}”.`);
    render();
  } catch (error) {
    showError(localizedText('无法添加高级属性轨道', 'Unable to add advanced property track'), error);
  }
}

function addKeyframeAtPlayhead(explicitTrackId?: string): void {
  addKeyframeAtTime(explicitTrackId, currentPlayhead());
}

function addKeyframeAtTime(explicitTrackId: string | undefined, requestedTime: number): void {
  const trackId = explicitTrackId ?? selectedTimelineTrackId();
  if (!trackId) {
    statusMessage = localizedText('请选择一条轨道后再添加关键帧。', 'Select a track before adding a keyframe.');
    renderStatus();
    return;
  }
  const track = store.project.timeline.tracks.find(candidate => candidate.id === trackId);
  if (!track) return;
  const time = snapTimelineTime(
    requestedTime,
    store.project.composition.frameRate,
    store.project.composition.duration,
  );
  let keyframeId = '';
  const changed = commitAuthoringMutation('Add Keyframe', draft => {
    keyframeId = createTimelineKeyframe(draft, trackId, time).id;
  });
  if (!keyframeId) {
    keyframeId = track.keyframes.find(keyframe => (
      Math.round(keyframe.time * store.project.composition.frameRate)
      === Math.round(time * store.project.composition.frameRate)
    ))?.id ?? '';
  }
  if (keyframeId) selection.select({ kind: 'keyframe', id: keyframeId, ownerId: trackId });
  statusMessage = changed
    ? localizedText(`已在 ${time.toFixed(3)}s 添加关键帧。`, `Added a keyframe at ${time.toFixed(3)}s.`)
    : localizedText('播放头所在帧已有关键帧。', 'A keyframe already exists at the playhead.');
  render();
}

function addNamedClip(): void {
  const clip = createTimelineClip(store.project, currentPlayhead());
  if (!commitAuthoringMutation('Add Animation Clip', draft => { draft.timeline.clips.push(clip); })) return;
  selection.select({ kind: 'clip', id: clip.id });
  statusMessage = localizedText(`已添加命名片段“${clip.name}”。`, `Added named clip “${clip.name}”.`);
  render();
}

function deleteSelectedTimelineItems(): boolean {
  const keyframes = selection.items
    .filter((item): item is AnimationEditorSelectionItem & { ownerId: string } => item.kind === 'keyframe' && Boolean(item.ownerId))
    .map(item => ({ trackId: item.ownerId, keyframeId: item.id }));
  const tracks = selection.items.filter(item => item.kind === 'track').map(item => item.id);
  const clips = selection.items.filter(item => item.kind === 'clip').map(item => item.id);
  if (keyframes.length > 0) {
    deleteSelectedKeyframes(keyframes);
    return true;
  }
  if (tracks.length > 0) {
    deleteSelectedTracks(tracks);
    return true;
  }
  if (clips.length > 0) {
    deleteSelectedClips(clips);
    return true;
  }
  const primary = selection.primary;
  if (primary?.kind === 'parameter') {
    deleteSelectedStateMachineParameter(primary.id);
    return true;
  }
  if (primary?.kind === 'layer') {
    deleteSelectedStateMachineLayer(primary.id);
    return true;
  }
  if (primary?.kind === 'state' && primary.ownerId) {
    deleteSelectedStateMachineState(primary.ownerId, primary.id);
    return true;
  }
  if (primary?.kind === 'transition' && primary.ownerId) {
    deleteSelectedStateMachineTransition(primary.ownerId, primary.id);
    return true;
  }
  return false;
}

function deleteSelectedKeyframes(references: readonly TimelineKeyframeReference[]): void {
  let deleted = 0;
  if (!commitAuthoringMutation('Delete Keyframes', draft => {
    deleted = deleteTimelineKeyframes(draft, references);
  })) {
    statusMessage = localizedText(
      '轨道至少需要保留一个关键帧；如不再需要，请删除整条轨道。',
      'A track must keep at least one keyframe; delete the entire track if it is no longer needed.',
    );
    renderStatus();
    return;
  }
  selection.clear();
  statusMessage = localizedText(`已删除 ${deleted} 个关键帧。`, `Deleted ${deleted} keyframes.`);
  render();
}

function deleteSelectedTracks(trackIds: readonly string[]): void {
  let deleted = 0;
  if (!commitAuthoringMutation('Delete Tracks', draft => {
    deleted = deleteTimelineTracks(draft, trackIds);
  })) return;
  selection.clear();
  statusMessage = localizedText(`已删除 ${deleted} 条轨道。`, `Deleted ${deleted} tracks.`);
  render();
}

function deleteSelectedClips(clipIds: readonly string[]): void {
  const referenced = clipIds.flatMap(clipId => stateMachineClipReferences(store.project.stateMachine, clipId)
    .map(reference => ({ clipId, ...reference })));
  if (referenced.length > 0) {
    const locations = referenced.map(reference => (
      `${reference.clipId}: ${reference.layerId}/${reference.stateId}`
    )).join('\n');
    showError(
      localizedText('动画片段仍在使用', 'Animation clip is still in use'),
      new Error(localizedText(`以下状态仍引用所选片段：\n${locations}`, `These states still reference the selected clips:\n${locations}`)),
    );
    return;
  }
  let deleted = 0;
  if (!commitAuthoringMutation('Delete Clips', draft => {
    deleted = deleteTimelineClips(draft, clipIds);
  })) return;
  selection.clear();
  statusMessage = localizedText(`已删除 ${deleted} 个命名片段。`, `Deleted ${deleted} named clips.`);
  render();
}

function zoomTimeline(factor: number): void {
  store.update('zoom-timeline', draft => {
    draft.editor ??= {};
    draft.editor.timeline ??= { playhead: 0, pixelsPerSecond: 240, scrollX: 0 };
    draft.editor.timeline.pixelsPerSecond = Math.max(
      40,
      Math.min(800, draft.editor.timeline.pixelsPerSecond * factor),
    );
  });
}

function createProjectStateMachine(): void {
  if (store.project.stateMachine) return;
  try {
    const machine = createAnimationEditorStateMachine(store.project);
    if (!commitAuthoringMutation('Create State Machine', draft => { draft.stateMachine = machine; })) return;
    runtimeParameterValues.clear();
    selection.select({ kind: 'layer', id: machine.layers[0]!.id });
    statusMessage = localizedText(`已创建状态机“${machine.name}”。`, `Created state machine “${machine.name}”.`);
    render();
  } catch (error) {
    showError(localizedText('无法创建状态机', 'Unable to create state machine'), error);
  }
}

function addStateMachineParameter(type: StateMachineParameterType): void {
  const machine = store.project.stateMachine;
  if (!machine || !['float', 'integer', 'boolean', 'trigger'].includes(type)) return;
  const parameter = createStateMachineParameter(machine, type);
  if (!commitAuthoringMutation(`Add ${type} Parameter`, draft => {
    draft.stateMachine?.parameters.push(parameter);
  })) return;
  if (parameter.type !== 'trigger') runtimeParameterValues.set(parameter.name, parameter.defaultValue);
  selection.select({ kind: 'parameter', id: parameter.name });
  statusMessage = localizedText(
    `已添加 ${localizeLiteral(type)} 参数“${parameter.name}”。`,
    `Added ${type} parameter “${parameter.name}”.`,
  );
  render();
}

function deleteSelectedStateMachineParameter(name: string): void {
  const machine = store.project.stateMachine;
  if (!machine) return;
  const references = stateMachineParameterReferences(machine, name);
  if (references.length > 0) {
    showError(
      localizedText('参数仍在使用', 'Parameter is still in use'),
      new Error(localizedText(
        `“${name}”仍被 ${references.length} 个状态、Blend Tree 或转场条件引用。`,
        `“${name}” is still referenced by ${references.length} states, blend trees, or transition conditions.`,
      )),
    );
    return;
  }
  let deleted = false;
  if (!commitAuthoringMutation('Delete State Machine Parameter', draft => {
    if (draft.stateMachine) deleted = deleteStateMachineParameter(draft.stateMachine, name);
  }) || !deleted) return;
  runtimeParameterValues.delete(name);
  selection.clear();
  statusMessage = localizedText(`已删除参数“${name}”。`, `Deleted parameter “${name}”.`);
  render();
}

function renameSelectedStateMachineParameter(currentName: string, requestedName: string): void {
  let nextName = currentName;
  try {
    if (!commitAuthoringMutation('Rename State Machine Parameter', draft => {
      if (draft.stateMachine) {
        nextName = renameStateMachineParameter(draft.stateMachine, currentName, requestedName);
      }
    })) return;
    if (runtimeParameterValues.has(currentName)) {
      const value = runtimeParameterValues.get(currentName)!;
      runtimeParameterValues.delete(currentName);
      runtimeParameterValues.set(nextName, value);
    }
    selection.select({ kind: 'parameter', id: nextName });
    statusMessage = localizedText(`参数已重命名为“${nextName}”。`, `Renamed parameter to “${nextName}”.`);
    render();
  } catch (error) {
    showError(localizedText('无法重命名参数', 'Unable to rename parameter'), error);
  }
}

function addStateMachineLayer(): void {
  const machine = store.project.stateMachine;
  if (!machine) return;
  try {
    const layer = createStateMachineLayer(store.project, machine);
    if (!commitAuthoringMutation('Add State Machine Layer', draft => {
      draft.stateMachine?.layers.push(layer);
    })) return;
    selection.select({ kind: 'layer', id: layer.id });
    statusMessage = localizedText(`已添加状态机层“${layer.name}”。`, `Added state-machine layer “${layer.name}”.`);
    render();
  } catch (error) {
    showError(localizedText('无法添加状态机层', 'Unable to add state-machine layer'), error);
  }
}

function deleteSelectedStateMachineLayer(layerId: string): void {
  let deleted = false;
  if (!commitAuthoringMutation('Delete State Machine Layer', draft => {
    if (draft.stateMachine) deleted = deleteStateMachineLayer(draft.stateMachine, layerId);
  }) || !deleted) {
    statusMessage = localizedText('状态机至少需要保留一个层。', 'A state machine must keep at least one layer.');
    renderStatus();
    return;
  }
  selection.clear();
  statusMessage = localizedText('已删除状态机层。', 'Deleted state-machine layer.');
  render();
}

function addStateMachineState(position?: readonly [number, number]): void {
  const machine = store.project.stateMachine;
  const layer = activeStateMachineLayer();
  if (!machine || !layer) return;
  try {
    const state = createStateMachineState(store.project, layer, position);
    if (!commitAuthoringMutation('Add State', draft => {
      draft.stateMachine?.layers.find(candidate => candidate.id === layer.id)?.states.push(state);
    })) return;
    selection.select({ kind: 'state', id: state.id, ownerId: layer.id });
    statusMessage = localizedText(`已添加状态“${state.name}”。`, `Added state “${state.name}”.`);
    render();
  } catch (error) {
    showError(localizedText('无法添加状态', 'Unable to add state'), error);
  }
}

function deleteSelectedStateMachineState(layerId: string, stateId: string): void {
  let deleted = false;
  if (!commitAuthoringMutation('Delete State', draft => {
    const layer = draft.stateMachine?.layers.find(candidate => candidate.id === layerId);
    if (layer) deleted = deleteStateMachineState(layer, stateId);
  }) || !deleted) {
    statusMessage = localizedText('状态机层至少需要保留一个状态。', 'A state-machine layer must keep at least one state.');
    renderStatus();
    return;
  }
  selection.clear();
  statusMessage = localizedText('已删除状态及其关联转场。', 'Deleted the state and its related transitions.');
  render();
}

function connectSelectedStates(): void {
  const layer = activeStateMachineLayer();
  if (!layer) return;
  const states = selection.items.filter(item => item.kind === 'state' && item.ownerId === layer.id);
  if (states.length !== 2 || states[0]!.id === states[1]!.id) {
    statusMessage = localizedText(
      '按住 Shift 依次选择来源状态和目标状态，再创建转场。',
      'Hold Shift to select a source state and destination state before creating a transition.',
    );
    renderStatus();
    return;
  }
  try {
    const transition = createStateMachineTransition(layer, states[0]!.id, states[1]!.id);
    if (!commitAuthoringMutation('Create Transition', draft => {
      draft.stateMachine?.layers.find(candidate => candidate.id === layer.id)?.transitions.push(transition);
    })) return;
    selection.select({ kind: 'transition', id: transition.id, ownerId: layer.id });
    statusMessage = localizedText(
      `已创建 ${states[0]!.id} → ${states[1]!.id} 转场。`,
      `Created transition ${states[0]!.id} → ${states[1]!.id}.`,
    );
    render();
  } catch (error) {
    showError(localizedText('无法创建转场', 'Unable to create transition'), error);
  }
}

function deleteSelectedStateMachineTransition(layerId: string, transitionId: string): void {
  let deleted = false;
  if (!commitAuthoringMutation('Delete Transition', draft => {
    const layer = draft.stateMachine?.layers.find(candidate => candidate.id === layerId);
    if (layer) deleted = deleteStateMachineTransition(layer, transitionId);
  }) || !deleted) return;
  selection.clear();
  statusMessage = localizedText('已删除转场。', 'Deleted transition.');
  render();
}

function resetStateMachineRuntime(): void {
  try {
    runtimePreview.resetStateMachine();
    runtimeParameterValues.clear();
    statusMessage = localizedText(
      '状态机运行时已重置为默认参数和初始状态。',
      'Reset the state-machine runtime to default parameters and initial states.',
    );
    render();
  } catch (error) {
    statusMessage = errorMessage(error);
    renderStatus();
  }
}

function activeStateMachineLayer(): NonNullable<AnimationEditorProject['stateMachine']>['layers'][number] | null {
  const machine = store.project.stateMachine;
  if (!machine) return null;
  const primary = selection.primary;
  const layerId = primary?.kind === 'layer'
    ? primary.id
    : primary?.kind === 'state' || primary?.kind === 'transition'
      ? primary.ownerId
      : undefined;
  return machine.layers.find(layer => layer.id === layerId) ?? machine.layers[0] ?? null;
}

function deleteSelectedNodes(nodeIds: readonly string[] = selection.items
  .filter(item => item.kind === 'node')
  .map(item => item.id)): void {
  if (nodeIds.length === 0) return;
  const deleting = collectNodeSubtreeIds(nodeIds);
  const locked = store.project.nodes.find(node => deleting.has(node.id) && node.editor?.locked);
  if (locked) {
    statusMessage = localizedText(
      `节点“${locked.name}”已锁定，删除已取消。`,
      `Node “${locked.name}” is locked; deletion was cancelled.`,
    );
    render();
    return;
  }
  let deletedTrackCount = 0;
  let deletedCompositeCount = 0;
  if (!commitAuthoringMutation(`Delete ${nodeIds.length} Node${nodeIds.length === 1 ? '' : 's'}`, draft => {
    const result = deleteAnimationNodeSubtrees(draft, nodeIds);
    deletedTrackCount = result.deletedTrackCount;
    deletedCompositeCount = result.deletedCompositeCount;
  })) return;
  selection.clear();
  statusMessage = localizedText(
    `已删除 ${deleting.size} 个节点`
      + `${deletedTrackCount ? `、${deletedTrackCount} 条关联轨道` : ''}`
      + `${deletedCompositeCount ? `、${deletedCompositeCount} 个合成引用` : ''}。`,
    `Deleted ${deleting.size} nodes`
      + `${deletedTrackCount ? `, ${deletedTrackCount} related tracks` : ''}`
      + `${deletedCompositeCount ? `, and ${deletedCompositeCount} composite references` : ''}.`,
  );
  render();
}

function handleHierarchyChange(detail: GETreeDataChangeDetail): void {
  const hierarchy = detail.data as AnimationEditorHierarchyNode[];
  if (detail.action === 'drop') {
    const source = detail.sourceId ? store.project.nodes.find(node => node.id === detail.sourceId) : undefined;
    const target = detail.targetId ? store.project.nodes.find(node => node.id === detail.targetId) : undefined;
    if (source?.editor?.locked || target?.editor?.locked) {
      statusMessage = localizedText('锁定节点不能参与层级拖拽。', 'Locked nodes cannot be reordered in the hierarchy.');
      renderHierarchy();
      renderStatus();
      return;
    }
    if (commitAuthoringMutation('Reorder Node Hierarchy', draft => applyAnimationNodeHierarchy(draft, hierarchy))) {
      statusMessage = localizedText(
        `已移动“${source?.name ?? detail.sourceId ?? '节点'}”。`,
        `Moved “${source?.name ?? detail.sourceId ?? 'node'}”.`,
      );
      renderStatus();
    }
    return;
  }
  if (detail.action === 'delete') {
    deleteSelectedNodes(detail.deletedIds ?? []);
    return;
  }
  if (detail.action === 'paste') {
    const pasted = (detail.pastedNodes ?? []) as AnimationEditorHierarchyNode[];
    const target = detail.targetId ? store.project.nodes.find(node => node.id === detail.targetId) : undefined;
    if (target?.editor?.locked) {
      statusMessage = localizedText(
        `节点“${target.name}”已锁定，粘贴已取消。`,
        `Node “${target.name}” is locked; paste was cancelled.`,
      );
      renderHierarchy();
      renderStatus();
      return;
    }
    let copiedIds: readonly string[] = [];
    if (!commitAuthoringMutation('Duplicate Nodes', draft => {
      copiedIds = duplicateAnimationNodes(draft, hierarchy, pasted);
    })) {
      renderHierarchy();
      return;
    }
    selection.replace(copiedIds.map(id => ({ kind: 'node', id })));
    statusMessage = localizedText(`已复制 ${copiedIds.length} 个节点。`, `Duplicated ${copiedIds.length} nodes.`);
    render();
  }
}

async function importAssetFiles(files: readonly File[]): Promise<void> {
  try {
    const imported = await designerTasks.run(localizedText('导入资源', 'Import assets'), async ({ signal, report }) => {
      const working = cloneAnimationEditorProject(store.project);
      const results: DeepMutable<AnimationEditorProject['assets']> = [];
      for (let index = 0; index < files.length; index++) {
        if (signal.aborted) throw new DOMException('Asset import cancelled.', 'AbortError');
        const file = files[index]!;
        report(index / files.length, file.name);
        const asset = await createAnimationEditorAssetFromFile(file, working as AnimationEditorProject);
        working.assets.push(asset);
        results.push(asset);
      }
      report(1, localizedText('完成', 'Done'));
      return results;
    });
    if (!commitAuthoringMutation(`Import ${imported.length} Asset${imported.length === 1 ? '' : 's'}`, draft => {
      draft.assets.push(...structuredClone(imported));
    })) return;
    const last = imported.at(-1);
    if (last) selection.select({ kind: 'asset', id: last.id });
    statusMessage = localizedText(`已导入 ${imported.length} 个资源。`, `Imported ${imported.length} assets.`);
    render();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      statusMessage = localizedText('资源导入已取消。', 'Asset import cancelled.');
      renderStatus();
      return;
    }
    showError(
      error instanceof AnimationEditorAssetImportError
        ? localizedText('资源导入失败', 'Asset import failed')
        : localizedText('无法导入资源', 'Unable to import assets'),
      error,
    );
  }
}

function deleteSelectedAsset(): void {
  const primary = selection.primary;
  if (primary?.kind !== 'asset') return;
  const asset = store.project.assets.find(candidate => candidate.id === primary.id);
  if (!asset) return;
  const references = animationAssetReferences(store.project, asset.id);
  if (references.length > 0) {
    const locations = references.map(reference => `${reference.nodeId}/${reference.componentId}.${reference.field}`).join('\n');
    showError(
      localizedText('资源仍在使用', 'Asset is still in use'),
      new Error(localizedText(
        `“${asset.name}”仍被以下组件引用：\n${locations}`,
        `“${asset.name}” is still referenced by these components:\n${locations}`,
      )),
    );
    return;
  }
  if (!commitAuthoringMutation('Delete Asset', draft => {
    draft.assets = draft.assets.filter(candidate => candidate.id !== asset.id);
  })) return;
  selection.clear();
  statusMessage = localizedText(`已删除资源“${asset.name}”。`, `Deleted asset “${asset.name}”.`);
  render();
}

function commitAuthoringMutation(
  label: string,
  mutation: (draft: DeepMutable<AnimationEditorProject>) => void,
): boolean {
  return history.execute(createProjectMutationCommand(store, label, mutation));
}

function collectNodeSubtreeIds(rootIds: readonly string[]): Set<string> {
  const result = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of store.project.nodes) {
      if (node.parent && result.has(node.parent) && !result.has(node.id)) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

function scheduleRuntimeCompile(): void {
  if (!projectSessionInitialized) return;
  query<HTMLElement>('#gpu-status').textContent = localizedText('HYA 运行时更新中', 'HYA RUNTIME UPDATING');
  query<HTMLElement>('#gpu-status').dataset.state = 'loading';
  if (previewCompileTimer !== null) window.clearTimeout(previewCompileTimer);
  previewCompileTimer = window.setTimeout(() => {
    previewCompileTimer = null;
    void refreshRuntimePreview();
  }, 160);
}

async function refreshRuntimePreview(): Promise<void> {
  const fingerprint = animationEditorProjectFingerprint(store.project);
  if (fingerprint === compiledFingerprint
    && currentCompilation
    && (!runtimePreview.supported || runtimePreview.ready)) {
    updateCompiledPresentation(currentCompilation);
    if (runtimePreview.supported) {
      setPreviewMessage(
        translate('preview.runtimeReady'),
        runtimeCompilationDetail(currentCompilation),
        'ready',
      );
    } else {
      setPreviewMessage(
        localizedText('HYA 编译完成', 'HYA compilation complete'),
        localizedText(
          `${formatBytes(currentCompilation.binary.byteLength)} · 当前浏览器无 WebGPU，仍可导出`,
          `${formatBytes(currentCompilation.binary.byteLength)} · WebGPU is unavailable; export remains enabled`,
        ),
        'ready',
      );
    }
    return;
  }
  const generation = ++previewGeneration;
  query<HTMLElement>('#gpu-status').textContent = localizedText('HYA 运行时更新中', 'HYA RUNTIME UPDATING');
  query<HTMLElement>('#gpu-status').dataset.state = 'loading';
  setPreviewMessage(translate('preview.compileTitle'), translate('preview.compileDetail'), 'working');
  let compilation: AnimationEditorCompilation;
  let requestedTime = 0;
  let resume = false;
  try {
    compilation = compileAnimationEditorProject(store.project);
    if (generation !== previewGeneration) return;
    requestedTime = Math.min(
      compilation.parsed.duration,
      store.project.editor?.timeline?.playhead ?? 0,
    );
    resume = playing;
    currentCompilation = compilation;
    compiledFingerprint = fingerprint;
    previewTime = requestedTime;
    updateCompiledPresentation(compilation);
    if (!runtimePreview.supported) {
      playing = false;
      syncPlayButton();
      setPreviewMessage(
        localizedText('HYA 编译完成', 'HYA compilation complete'),
        localizedText(
          `${formatBytes(compilation.binary.byteLength)} · 当前浏览器无 WebGPU，仍可导出`,
          `${formatBytes(compilation.binary.byteLength)} · WebGPU is unavailable; export remains enabled`,
        ),
        'ready',
      );
      return;
    }
  } catch (error) {
    if (generation !== previewGeneration) return;
    currentCompilation = null;
    compiledFingerprint = '';
    previewTime = null;
    playing = false;
    runtimePreview.clear();
    syncPlayButton();
    query<HTMLElement>('.canvas-frame').classList.remove('runtime-active');
    query<HTMLElement>('.canvas-frame').classList.add('preview-error');
    setPreviewMessage(translate('preview.compileFailed'), compileErrorSummary(error), 'error');
    query<HTMLElement>('#preview-stats').textContent = translate('preview.compileFailedShort');
    return;
  }

  try {
    await runtimePreview.load(compilation, { startTime: requestedTime, autoplay: resume });
    if (generation !== previewGeneration) return;
    for (const parameter of store.project.stateMachine?.parameters ?? []) {
      const value = runtimeParameterValues.get(parameter.name);
      if (value !== undefined && parameter.type !== 'trigger') {
        runtimePreview.setStateMachineParameter(parameter.name, parameter.type, value);
      }
    }
    if (resume) runtimePreview.play();
    setPreviewMessage(
      translate('preview.runtimeReady'),
      runtimeCompilationDetail(compilation),
      'ready',
    );
    query<HTMLElement>('#gpu-status').textContent = localizedText('HYA 运行时就绪', 'HYA RUNTIME READY');
    query<HTMLElement>('#gpu-status').dataset.state = 'ready';
    query<HTMLElement>('.canvas-frame').classList.add('runtime-active');
    query<HTMLElement>('.canvas-frame').classList.remove('preview-error');
  } catch (error) {
    if (generation !== previewGeneration) return;
    playing = false;
    runtimePreview.clear();
    syncPlayButton();
    query<HTMLElement>('.canvas-frame').classList.remove('runtime-active');
    query<HTMLElement>('.canvas-frame').classList.add('preview-error');
    query<HTMLElement>('#gpu-status').textContent = localizedText('WEBGPU 预览失败', 'WEBGPU PREVIEW FAILED');
    query<HTMLElement>('#gpu-status').dataset.state = 'unavailable';
    setPreviewMessage(
      localizedText('WebGPU 预览失败', 'WebGPU preview failed'),
      localizedText(
        `${errorMessage(error)} · 已编译的 HYA 仍可导出`,
        `${errorMessage(error)} · The compiled HYA remains available for export`,
      ),
      'error',
    );
    query<HTMLElement>('#preview-stats').textContent =
      `${compilation.parsed.nodes.length} nodes · ${compilation.parsed.tracks.length} tracks · HYA 已校验`;
  }
}

function runtimeCompilationDetail(compilation: AnimationEditorCompilation): string {
  return localizedText(
    `${formatBytes(compilation.binary.byteLength)} · ${compilation.parsed.nodes.length} 个节点 · ${compilation.parsed.tracks.length} 条轨道`,
    `${formatBytes(compilation.binary.byteLength)} · ${compilation.parsed.nodes.length} nodes · ${compilation.parsed.tracks.length} tracks`,
  );
}

function updateCompiledPresentation(compilation: AnimationEditorCompilation): void {
  const canvas = compilation.parsed.canvas;
  query<HTMLElement>('.canvas-frame').style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  query<HTMLElement>('#runtime-target').textContent = `HYA ${ANIMATION_VERSION} · ${formatBytes(compilation.binary.byteLength)}`;
  const warnings = compilation.diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length;
  query<HTMLElement>('#preview-stats').textContent =
    `${compilation.parsed.nodes.length} nodes · ${compilation.parsed.tracks.length} tracks${warnings ? ` · ${warnings} warnings` : ''}`;
}

async function toggleRuntimePlayback(): Promise<void> {
  if (!currentCompilation || !runtimePreview.ready) await refreshRuntimePreview();
  if (!runtimePreview.ready || !currentCompilation) {
    statusMessage = runtimePreview.supported
      ? localizedText('运行时预览尚未就绪。', 'Runtime preview is not ready yet.')
      : localizedText('当前浏览器不支持 WebGPU；HYA 仍可导出。', 'This browser does not support WebGPU; HYA export remains available.');
    renderStatus();
    return;
  }
  if (runtimePreview.playing) {
    runtimePreview.pause();
    playing = false;
    statusMessage = translate('preview.runtimePaused');
    persistPreviewPlayhead();
  } else {
    runtimePreview.play();
    playing = true;
    statusMessage = translate('preview.runtimePlaying');
  }
  syncPlayButton();
  renderStatus();
}

function updatePreviewFrame(frame: AnimationEditorPreviewFrame): void {
  previewTime = frame.currentTime;
  playing = frame.playing;
  updateStateMachineRuntimePresentation(frame);
  syncPlayButton();
  updateTimelinePlayheadPosition(frame.currentTime);
  query<HTMLElement>('#playhead-time').textContent = timecode(frame.currentTime, store.project.composition.frameRate);
  query<HTMLElement>('#preview-stats').textContent =
    `${frame.visualCount} visuals · ${currentCompilation?.parsed.tracks.length ?? 0} tracks`
    + (frame.unsupportedComponentCount ? ` · ${frame.unsupportedComponentCount} unsupported` : '');
}

function syncPlayButton(): void {
  playButton.setAttribute('aria-pressed', String(playing));
  playButton.textContent = playing ? 'Ⅱ' : '▶';
  const label = translate(playing ? 'toolbar.pause' : 'toolbar.play');
  playButton.title = label;
  playButton.setAttribute('aria-label', label);
}

function persistPreviewPlayhead(): void {
  if (previewTime === null) return;
  persistTimelinePlayhead(previewTime);
}

function persistTimelinePlayhead(time: number): void {
  store.update('persist-preview-playhead', draft => {
    draft.editor ??= {};
    draft.editor.timeline ??= { playhead: 0, pixelsPerSecond: 240, scrollX: 0 };
    draft.editor.timeline.playhead = time;
  });
}

function exportHya(): void {
  try {
    const artifact = downloadHyaFile(store.project);
    currentCompilation = artifact.compilation;
    compiledFingerprint = '';
    updateCompiledPresentation(artifact.compilation);
    const warnings = artifact.compilation.diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length;
    statusMessage = localizedText(
      `已导出 ${artifact.fileName} · ${formatBytes(artifact.bytes)}${warnings ? ` · ${warnings} 个警告` : ''}`,
      `Exported ${artifact.fileName} · ${formatBytes(artifact.bytes)}${warnings ? ` · ${warnings} warnings` : ''}`,
    );
    renderStatus();
    void refreshRuntimePreview();
  } catch (error) {
    showError(localizedText('无法导出 HYA', 'Unable to export HYA'), error);
  }
}

async function exportHyaPackage(): Promise<void> {
  setDisabled(exportPackageButton, true);
  try {
    const artifact = await designerTasks.run(localizedText('生成交付包', 'Build delivery package'), async ({ signal, report }) => {
      report(0.1, localizedText('编译 HYA', 'Compile HYA'));
      if (signal.aborted) throw new DOMException('Package export cancelled.', 'AbortError');
      const result = await downloadHyaPackage(store.project);
      report(1, localizedText('完成', 'Done'));
      return result;
    });
    const external = artifact.externalAssetCount > 0
      ? ` · ${artifact.externalAssetCount} external`
      : '';
    const warnings = artifact.hya.compilation.diagnostics
      .filter(diagnostic => diagnostic.severity === 'warning').length;
    statusMessage = localizedText(
      `已导出 ${artifact.fileName} · ${formatBytes(artifact.bytes)}`
        + ` · ${artifact.bundledAssetCount} bundled${external}`
        + (warnings ? ` · ${warnings} 个警告` : ''),
      `Exported ${artifact.fileName} · ${formatBytes(artifact.bytes)}`
        + ` · ${artifact.bundledAssetCount} bundled${external}`
        + (warnings ? ` · ${warnings} warnings` : ''),
    );
    renderStatus();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      statusMessage = localizedText('交付包导出已取消。', 'Delivery package export cancelled.');
      renderStatus();
      return;
    }
    showError(localizedText('无法导出 HYA 交付包', 'Unable to export HYA delivery package'), error);
  } finally {
    setDisabled(exportPackageButton, false);
  }
}

function setPreviewMessage(title: string, detail: string, state: 'working' | 'ready' | 'error'): void {
  query<HTMLElement>('#preview-title').textContent = title;
  query<HTMLElement>('#preview-detail').textContent = detail;
  query<HTMLElement>('.viewport-message').dataset.state = state;
}

function compileErrorSummary(error: unknown): string {
  if (error instanceof AnimationEditorCompileError) {
    const errors = error.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    const first = errors[0] ?? error.diagnostics[0];
    return first ? `${first.code} · ${first.path} · ${first.message}` : error.message;
  }
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openProjectFile(file: File): Promise<void> {
  try {
    const source = await file.text();
    if (detectDesignerProjectFamily(source) === '3d') {
      sessionStorage.setItem('haiyue.animation-editor:open-native3d@1', source);
      window.location.href = './native3d.html?open=session';
      return;
    }
    const result = await readAnimationEditorProjectFile(file);
    await session.activateSavedProject(result.project, file.name, 'open-project-file');
    history.clear();
    selection.clear();
    resetStateMachineSessionState();
    statusMessage = result.migrated
      ? localizedText(`已打开并迁移工程 ${file.name}。`, `Opened and migrated project ${file.name}.`)
      : localizedText(`已打开工程 ${file.name}。`, `Opened project ${file.name}.`);
    syncRecentMenu();
    render();
  } catch (error) {
    showError(localizedText('无法打开工程', 'Unable to open project'), error);
  }
}

async function importSourceFile(): Promise<void> {
  const file = sourceFileInput.files?.[0];
  sourceFileInput.value = '';
  if (!file || !await confirmReplace(localizedText('导入来源并替换当前工程', 'Import a source and replace the current project'))) return;
  const kind = file.name.toLowerCase().endsWith('.hya') ? 'hya' as const : 'lottie' as const;
  try {
    const imported = await designerTasks.run(localizedText('导入动画来源', 'Import animation source'), async ({ signal, report }) => {
      report(0.1, file.name);
      const input = kind === 'hya'
        ? { kind: 'bytes' as const, bytes: await file.arrayBuffer(), contentType: file.type || 'application/vnd.haiyue.animation' }
        : { kind: 'text' as const, text: await file.text(), contentType: file.type || 'application/json' };
      if (signal.aborted) throw new DOMException('Source import cancelled.', 'AbortError');
      const result = await sourceImports.import({ kind, input, name: file.name, signal });
      report(1, localizedText('完成', 'Done'));
      return result;
    });
    if (imported.source.family !== '2d') throw new Error(localizedText('该来源属于原生 3D，请在 3D 工作区打开。', 'This source belongs to native 3D; open it in the 3D workspace.'));
    await session.activateSavedProject(imported.source.project, projectFileName(imported.source.name), 'import-source', false);
    history.clear(); selection.clear(); resetStateMachineSessionState();
    const diagnostic = imported.diagnostics[0];
    statusMessage = diagnostic
      ? `${localizedText('来源已导入', 'Source imported')} · ${diagnostic.code} · ${diagnostic.path}`
      : localizedText('来源已导入为可编辑工程。', 'Source imported as an editable project.');
    render();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      statusMessage = localizedText('来源导入已取消。', 'Source import cancelled.'); renderStatus(); return;
    }
    showError(localizedText('来源导入失败', 'Source import failed'), error);
  }
}

async function saveProject(): Promise<void> {
  try {
    const artifact = downloadAnimationEditorProject(store.project, session.fileName);
    await session.save();
    statusMessage = localizedText(
      `已保存 ${artifact.fileName} · ${formatBytes(artifact.bytes)}`,
      `Saved ${artifact.fileName} · ${formatBytes(artifact.bytes)}`,
    );
    syncRecentMenu();
    render();
  } catch (error) {
    showError(localizedText('无法保存工程', 'Unable to save project'), error);
  }
}

function showSaveAsDialog(): void {
  const input = query<HTMLInputElement>('#save-as-name');
  input.value = session.fileName;
  saveAsDialog.showModal();
  window.setTimeout(() => { input.focus(); input.select(); }, 0);
}

async function saveProjectAs(): Promise<void> {
  const input = query<HTMLInputElement>('#save-as-name');
  if (!input.value.trim()) {
    input.focus();
    return;
  }
  try {
    const fileName = projectFileName(input.value);
    const artifact = downloadAnimationEditorProject(store.project, fileName);
    await session.saveAs(artifact.fileName);
    saveAsDialog.close('action');
    statusMessage = localizedText(
      `工程副本已保存为 ${artifact.fileName} · ${formatBytes(artifact.bytes)}`,
      `Saved a project copy as ${artifact.fileName} · ${formatBytes(artifact.bytes)}`,
    );
    syncRecentMenu();
    render();
  } catch (error) {
    showError(localizedText('无法另存工程', 'Unable to save project copy'), error);
  }
}

async function openRecentProject(id: string): Promise<void> {
  if (id === '__clear__') {
    await session.clearRecent();
    statusMessage = localizedText('已清除最近工程记录。', 'Cleared recent project history.');
    syncRecentMenu();
    renderStatus();
    return;
  }
  if (!id || !await confirmReplace(localizedText('打开最近工程', 'Open a recent project'))) return;
  const record = await session.openRecent(id);
  if (!record) return;
  history.clear();
  selection.clear();
  resetStateMachineSessionState();
  statusMessage = localizedText(`已打开最近工程“${record.name}”。`, `Opened recent project “${record.name}”.`);
  syncRecentMenu();
  render();
}

function syncRecentMenu(): void {
  recentMenu.items = session.recent.length === 0
    ? [{ label: translate('recent.empty'), value: '', disabled: true }]
    : [
        ...session.recent.map(record => ({
          label: `${record.name} · ${new Date(record.updatedAt).toLocaleDateString()}`,
          value: record.id,
        })),
        { separator: true },
        { label: translate('recent.clear'), value: '__clear__' },
      ];
}

async function restoreRecovery(): Promise<void> {
  const snapshot = recoverySnapshot;
  if (!snapshot) return;
  await session.restoreRecovery(snapshot);
  recoverySnapshot = null;
  recoveryDialog.close('action');
  history.clear();
  selection.clear();
  resetStateMachineSessionState();
  statusMessage = localizedText(
    `已恢复“${snapshot.name}”的自动保存，工程仍标记为未保存。`,
    `Restored the autosave for “${snapshot.name}”; the project remains marked as unsaved.`,
  );
  render();
}

async function discardRecovery(): Promise<void> {
  await session.discardRecovery();
  recoverySnapshot = null;
  recoveryDialog.close('action');
  statusMessage = localizedText('已丢弃自动保存快照。', 'Discarded the autosave snapshot.');
  renderStatus();
}

function resetStateMachineSessionState(): void {
  runtimeParameterValues.clear();
  runtimeStateLayers = [];
}

function confirmReplace(action: string): Promise<boolean> {
  if (!store.isDirty) return Promise.resolve(true);
  if (pendingConfirm) return Promise.resolve(false);
  query<HTMLElement>('#confirm-message').textContent =
    localizedText(
      `“${store.project.name}”有未保存的修改。${action}会丢失这些修改，是否继续？`,
      `“${store.project.name}” has unsaved changes. ${action} will discard them. Continue?`,
    );
  confirmDialog.showModal();
  return new Promise(resolve => { pendingConfirm = resolve; });
}

function settleConfirm(accepted: boolean): void {
  const resolve = pendingConfirm;
  pendingConfirm = null;
  confirmDialog.close('action');
  resolve?.(accepted);
}

function showError(heading: string, error: unknown): void {
  errorDialog.heading = heading;
  query<HTMLElement>('#error-message').textContent = error instanceof AnimationEditorProjectFormatError
    ? error.diagnostics.map(issue => `${issue.code}\n${issue.path}\n${issue.message}`).join('\n\n')
    : error instanceof AnimationEditorCompileError
      ? error.diagnostics.map(issue => `${issue.severity.toUpperCase()} · ${issue.code}\n${issue.path}\n${issue.message}`).join('\n\n')
      : error instanceof Error ? error.message : String(error);
  errorDialog.showModal();
  statusMessage = heading;
  renderStatus();
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

function render(): void {
  renderDocumentStatus();
  renderAssets();
  renderHierarchy();
  renderInspector();
  renderTimeline();
  renderStateMachine();
  renderHistory();
  renderStatus();
}

function renderDocumentStatus(): void {
  const project = store.project;
  viewportInteraction.setProjectView(
    [project.composition.canvas.width, project.composition.canvas.height],
    project.editor?.viewport ?? {
      zoom: 1,
      center: [project.composition.canvas.width / 2, project.composition.canvas.height / 2],
      showGrid: true,
    },
  );
  query<HTMLElement>('#project-name').textContent = project.name;
  query<HTMLElement>('#dirty-indicator').classList.toggle('active', store.isDirty);
  query<HTMLElement>('#canvas-size').textContent = `${project.composition.canvas.width} × ${project.composition.canvas.height}`;
  const playhead = previewTime ?? project.editor?.timeline?.playhead ?? 0;
  query<HTMLElement>('#playhead-time').textContent = timecode(playhead, project.composition.frameRate);
  tabs.value = project.editor?.activePanel ?? 'timeline';
  query<HTMLElement>('#node-placeholder').classList.toggle('visible', project.nodes.length > 0);
}

function renderAssets(): void {
  const host = query<HTMLElement>('#asset-list');
  host.replaceChildren();
  const selectedAssetId = selection.primary?.kind === 'asset' ? selection.primary.id : null;
  setDisabled(deleteAssetButton, selectedAssetId === null);
  if (store.project.assets.length === 0) {
    host.append(emptyMessage(
      localizedText('暂无资源', 'No assets'),
      localizedText('点击＋导入图片、音频或二进制文件', 'Click ＋ to import an image, audio, or binary file'),
    ));
    return;
  }
  for (const asset of store.project.assets) {
    const row = document.createElement('div');
    row.className = 'asset-row';
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'asset-item';
    item.classList.toggle('selected', selectedAssetId === asset.id);
    const kind = document.createElement('span');
    kind.className = 'asset-kind';
    kind.textContent = asset.type === 'image' ? 'IMG' : asset.type === 'audio' ? 'AUD' : 'BIN';
    const copy = document.createElement('span');
    copy.className = 'asset-copy';
    copy.append(
      textElement('strong', asset.name),
      textElement('span', asset.type === 'image' && asset.delivery.width && asset.delivery.height
        ? `${asset.delivery.width} × ${asset.delivery.height}`
        : asset.delivery.mimeType ?? asset.type),
    );
    item.append(kind, copy);
    item.addEventListener('click', event => selectItem({ kind: 'asset', id: asset.id }, event));
    const relink = document.createElement('button');
    relink.type = 'button';
    relink.className = 'asset-relink';
    relink.textContent = '↻';
    relink.title = localizedText('重链接资源并保留引用 ID', 'Relink asset while preserving its reference id');
    relink.setAttribute('aria-label', `${relink.title}: ${asset.name}`);
    relink.addEventListener('click', event => {
      event.stopPropagation();
      relinkAssetId = asset.id;
      relinkAssetFileInput.accept = asset.type === 'image' ? 'image/*'
        : asset.type === 'audio' ? 'audio/*' : 'application/octet-stream,.bin';
      relinkAssetFileInput.click();
    });
    row.append(item, relink);
    host.append(row);
  }
}

function renderHierarchy(): void {
  const project = store.project;
  hierarchyTree.data = buildAnimationNodeHierarchy(project.nodes) as GETreeNodeData[];
  hierarchyTree.selectedIds = selection.items.filter(item => item.kind === 'node').map(item => item.id);
  const selectedNodeIds = selection.items.filter(item => item.kind === 'node').map(item => item.id);
  setDisabled(deleteNodeButton, selectedNodeIds.length === 0);
  const hasImage = project.assets.some(asset => asset.type === 'image');
  const hasAudio = project.assets.some(asset => asset.type === 'audio');
  addNodeMenu.items = [
    { label: localizedText('空 Group', 'Empty Group'), value: 'group' },
    { separator: true },
    { label: localizeLiteral('Rectangle'), value: 'rectangle' },
    { label: localizeLiteral('Ellipse'), value: 'ellipse' },
    { label: localizedText('路径', 'Path'), value: 'path' },
    { label: localizedText('矢量图形', 'Vector Shape'), value: 'vector' },
    { label: localizedText('文本', 'Text'), value: 'text' },
    { label: localizedText('精灵', 'Sprite'), value: 'sprite', disabled: !hasImage },
    { separator: true },
    { label: localizedText('2D 粒子', 'Particle2D'), value: 'particle' },
    { label: localizedText('时间轴音频', 'Timeline Audio'), value: 'audio', disabled: !hasAudio },
  ];
}

function renderInspector(): void {
  const host = query<HTMLElement>('#inspector-content');
  const primary = selection.primary;
  query<HTMLElement>('#selection-kind').textContent = primary
    ? localizeLiteral(primary.kind.toUpperCase())
    : localizedText('合成', 'COMPOSITION');
  query<HTMLElement>('#selection-summary').textContent = primary
    ? translate('selection.summary', { kind: localizeLiteral(primary.kind), count: selection.items.length })
    : localizedText(
      `合成设置 · ${store.project.composition.duration}s`,
      `Composition settings · ${store.project.composition.duration}s`,
    );
  if (renderStateMachineInspector(host, store.project, primary, {
    commit: commitAuthoringMutation,
    renameParameter: renameSelectedStateMachineParameter,
    deleteParameter: deleteSelectedStateMachineParameter,
    deleteLayer: deleteSelectedStateMachineLayer,
    deleteState: deleteSelectedStateMachineState,
    deleteTransition: deleteSelectedStateMachineTransition,
  })) return;
  renderAnimationEditorInspector(host, store.project, primary, {
    commit: commitAuthoringMutation,
    deleteAsset: assetId => {
      selection.select({ kind: 'asset', id: assetId });
      deleteSelectedAsset();
    },
    deleteNodes: deleteSelectedNodes,
    addKeyframe: addKeyframeAtPlayhead,
    deleteTracks: deleteSelectedTracks,
    deleteKeyframes: deleteSelectedKeyframes,
    deleteClips: deleteSelectedClips,
    seek: updatePlayhead,
    currentTime: currentPlayhead,
    setCompositionDuration: requestedDuration => {
      let appliedDuration = store.project.composition.duration;
      if (!commitAuthoringMutation('Set Composition Duration', draft => {
        appliedDuration = setCompositionDuration(draft, requestedDuration);
      })) return;
      if (previewTime !== null && previewTime > appliedDuration) {
        previewTime = appliedDuration;
        runtimePreview.seek(appliedDuration);
      }
      statusMessage = localizedText(
        `合成总时长已设为 ${appliedDuration.toFixed(3)}s。`,
        `Composition duration set to ${appliedDuration.toFixed(3)}s.`,
      );
      render();
    },
    setSpriteSheetFrame: (nodeId, componentId, columns, rows, frame) => {
      try {
        const changed = commitAuthoringMutation('Set Spritesheet Frame', draft => {
          setSpriteSheetFrame(
            draft,
            nodeId,
            componentId,
            columns,
            rows,
            frame,
            currentPlayhead(),
          );
        });
        if (!changed) return;
        statusMessage = localizedText(
          `已选择精灵图集第 ${Math.round(frame) + 1} 帧。`,
          `Selected sprite-sheet frame ${Math.round(frame) + 1}.`,
        );
        render();
      } catch (error) {
        showError(localizedText('无法设置精灵图集帧', 'Unable to set sprite-sheet frame'), error);
      }
    },
    generateSpriteSheetAnimation: (nodeId, componentId, columns, rows) => {
      try {
        let trackId = '';
        if (!commitAuthoringMutation('Generate Spritesheet Animation', draft => {
          trackId = generateSpriteSheetAnimation(draft, nodeId, componentId, columns, rows);
        })) return;
        statusMessage = localizedText(
          `已生成 ${columns * rows} 帧精灵图集动画轨道“${trackId}”。`,
          `Generated ${columns * rows}-frame sprite-sheet animation track “${trackId}”.`,
        );
        render();
      } catch (error) {
        showError(localizedText('无法生成精灵图集动画', 'Unable to generate sprite-sheet animation'), error);
      }
    },
  });
}

function renderTimeline(): void {
  const project = store.project;
  const trackList = query<HTMLElement>('#track-list');
  trackList.replaceChildren();
  timelineRuler.replaceChildren();
  timelineLanes.replaceChildren();

  const primary = selection.primary;
  const selectedNode = primary?.kind === 'node'
    ? project.nodes.find(node => node.id === primary.id)
    : undefined;
  const available = selectedNode ? availableCoreTransformProperties(project, selectedNode.id) : [];
  const advanced = selectedNode ? availableAdvancedPropertyBindings(project, selectedNode.id) : [];
  addTrackMenu.items = [
    ...available.map(property => ({
      label: localizeLiteral(coreTransformPropertyLabel(property)),
      value: property,
    })),
    ...(available.length > 0 && advanced.length > 0 ? [{ separator: true as const }] : []),
    ...advanced.map(property => ({ label: localizeLiteral(property.label), value: `advanced:${property.key}` })),
  ];
  setDisabled(addTrackButton, !selectedNode || selectedNode.editor?.locked === true || available.length + advanced.length === 0);
  setDisabled(addKeyframeButton, selectedTimelineTrackId() === null);

  const clipRow = document.createElement('button');
  clipRow.type = 'button';
  clipRow.className = 'track-row track-clip-row';
  clipRow.append(
    textElement('span', 'CLIP', 'track-kind'),
    textElement('span', localizedText(
      `命名片段 (${project.timeline.clips.length})`,
      `Named clips (${project.timeline.clips.length})`,
    ), 'track-label'),
  );
  clipRow.addEventListener('click', () => {
    const clip = project.timeline.clips[0];
    if (clip) selection.select({ kind: 'clip', id: clip.id });
  });
  trackList.append(clipRow);

  for (const [index, track] of project.timeline.tracks.entries()) {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.classList.toggle('selected', primary?.kind === 'track' && primary.id === track.id
      || primary?.kind === 'keyframe' && primary.ownerId === track.id);
    row.classList.toggle('disabled-track', track.enabled === false);
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'track-select';
    select.title = trackTargetSummary(track);
    const dot = document.createElement('span');
    dot.className = 'track-dot';
    dot.style.setProperty('--track-color', track.color ?? '#5bb8ff');
    const copy = document.createElement('span');
    copy.className = 'track-copy';
    copy.append(
      textElement('span', track.name, 'track-label'),
      textElement('span', trackTargetSummary(track), 'track-binding'),
    );
    select.append(dot, copy);
    select.addEventListener('click', event => selectItem({
      kind: 'track', id: track.id, ownerId: track.target.nodeId,
    }, event));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'track-key-add';
    add.textContent = '◆';
    add.title = translate('timeline.keyframeTitle', { track: track.name });
    add.setAttribute('aria-label', add.title);
    add.addEventListener('click', () => addKeyframeAtPlayhead(track.id));
    row.append(select, add);
    trackList.append(row);
  }

  if (project.timeline.tracks.length === 0) {
    const row = document.createElement('div');
    row.className = 'track-row track-empty-row';
    row.textContent = translate(selectedNode ? 'timeline.emptySelected' : 'timeline.empty');
    trackList.append(row);
  }

  const pixelsPerSecond = project.editor?.timeline?.pixelsPerSecond ?? 240;
  const viewportWidth = timelineRuler.clientWidth || timelineLanes.clientWidth || 720;
  const contentWidth = Math.max(
    Math.max(1, viewportWidth - TIMELINE_END_PADDING),
    project.composition.duration * pixelsPerSecond,
  );
  const surfaceWidth = contentWidth + TIMELINE_END_PADDING;
  const rulerSurface = document.createElement('div');
  rulerSurface.className = 'timeline-ruler-surface';
  rulerSurface.style.width = `${surfaceWidth}px`;
  rulerSurface.dataset.timelineContentWidth = String(contentWidth);
  const effectivePixelsPerSecond = contentWidth / project.composition.duration;
  const majorStep = timelineMajorStep(effectivePixelsPerSecond);
  for (let time = 0; time <= project.composition.duration + 1e-9; time += majorStep) {
    const label = document.createElement('span');
    label.className = 'ruler-label';
    label.style.userSelect = 'none';
    label.style.webkitUserSelect = 'none';
    label.style.left = `${time / project.composition.duration * contentWidth}px`;
    label.textContent = `${Number(time.toFixed(3))}s`;
    rulerSurface.append(label);
  }
  if (Math.abs(Math.round(project.composition.duration / majorStep) * majorStep - project.composition.duration) > 1e-6) {
    const end = document.createElement('span');
    end.className = 'ruler-label ruler-end-label';
    end.style.userSelect = 'none';
    end.style.webkitUserSelect = 'none';
    end.style.left = `${contentWidth}px`;
    end.textContent = `${project.composition.duration}s`;
    rulerSurface.append(end);
  }
  appendTimelineEndGutter(rulerSurface, contentWidth);
  appendTimelinePlayhead(rulerSurface, contentWidth, true);
  rulerSurface.addEventListener('pointerdown', event => {
    updatePlayhead(timeFromTimelinePointer(event, rulerSurface, contentWidth));
  });
  timelineRuler.append(rulerSurface);

  const laneSurface = document.createElement('div');
  laneSurface.className = 'timeline-lanes-surface';
  laneSurface.style.width = `${surfaceWidth}px`;
  laneSurface.dataset.timelineContentWidth = String(contentWidth);
  laneSurface.style.height = `${Math.max(58, (project.timeline.tracks.length + 1) * 29)}px`;
  const clipLane = document.createElement('div');
  clipLane.className = 'timeline-clip-lane';
  for (const clip of project.timeline.clips) {
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'timeline-clip';
    bar.classList.toggle('selected', primary?.kind === 'clip' && primary.id === clip.id);
    bar.style.left = `${clip.start / project.composition.duration * contentWidth}px`;
    bar.style.width = `${Math.max(4, clip.duration / project.composition.duration * contentWidth)}px`;
    bar.style.setProperty('--clip-color', clip.color ?? '#3fb950');
    bar.textContent = clip.name;
    bar.title = `${clip.name} · ${clip.start.toFixed(3)}–${(clip.start + clip.duration).toFixed(3)}s`;
    bar.addEventListener('pointerdown', event => event.stopPropagation());
    bar.addEventListener('click', event => selectItem({ kind: 'clip', id: clip.id }, event));
    clipLane.append(bar);
  }
  laneSurface.append(clipLane);

  for (const [index, track] of project.timeline.tracks.entries()) {
    for (const keyframe of track.keyframes) {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'keyframe-dot';
      marker.classList.toggle('selected', primary?.kind === 'keyframe'
        && primary.id === keyframe.id && primary.ownerId === track.id);
      marker.style.left = `${keyframe.time / project.composition.duration * contentWidth}px`;
      marker.style.top = `${(index + 1) * 29 + 15}px`;
      marker.style.setProperty('--track-color', track.color ?? '#5bb8ff');
      marker.title = `${track.name} · ${keyframe.time.toFixed(3)}s · ${keyframe.interpolation}`;
      marker.setAttribute('aria-label', localizedText(
        `${track.name} ${keyframe.time.toFixed(3)} 秒关键帧`,
        `${track.name} keyframe at ${keyframe.time.toFixed(3)} seconds`,
      ));
      marker.addEventListener('click', event => selectItem({
        kind: 'keyframe', id: keyframe.id, ownerId: track.id,
      }, event));
      installKeyframeDrag(marker, track.id, keyframe.id, keyframe.time, contentWidth);
      laneSurface.append(marker);
    }
  }
  appendTimelineEndGutter(laneSurface, contentWidth);
  appendTimelinePlayhead(laneSurface, contentWidth, false);
  laneSurface.addEventListener('pointerdown', event => {
    if (event.target === laneSurface || event.target === clipLane) {
      previewTimelinePointer(timeFromTimelinePointer(event, laneSurface, contentWidth));
    }
  });
  laneSurface.addEventListener('dblclick', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.keyframe-dot, .timeline-clip')) return;
    const bounds = laneSurface.getBoundingClientRect();
    const trackIndex = Math.floor((event.clientY - bounds.top) / 29) - 1;
    const track = project.timeline.tracks[trackIndex];
    if (!track) return;
    const time = timeFromTimelinePointer(event, laneSurface, contentWidth);
    cancelTimelinePointerPersistence();
    updatePlayhead(time);
    addKeyframeAtTime(track.id, time);
    event.preventDefault();
  });
  timelineLanes.append(laneSurface);
  timelineLanes.onscroll = () => {
    rulerSurface.style.transform = `translateX(${-timelineLanes.scrollLeft}px)`;
  };
  rulerSurface.style.transform = `translateX(${-timelineLanes.scrollLeft}px)`;
  query<HTMLElement>('#timeline-zoom-value').textContent = `${Math.round(pixelsPerSecond)} px/s`;
}

function appendTimelineEndGutter(host: HTMLElement, contentWidth: number): void {
  const gutter = document.createElement('span');
  gutter.className = 'timeline-end-gutter';
  gutter.style.left = `${contentWidth}px`;
  gutter.style.width = `${TIMELINE_END_PADDING}px`;
  gutter.setAttribute('aria-hidden', 'true');
  host.append(gutter);
}

function appendTimelinePlayhead(host: HTMLElement, surfaceWidth: number, ruler: boolean): void {
  const playhead = document.createElement('span');
  playhead.className = `timeline-playhead${ruler ? ' ruler-playhead' : ''}`;
  playhead.style.left = `${currentPlayhead() / store.project.composition.duration * surfaceWidth}px`;
  if (ruler) {
    const head = document.createElement('span');
    head.className = 'timeline-playhead-head';
    playhead.append(head);
  }
  host.append(playhead);
}

function updateTimelinePlayheadPosition(time: number): void {
  for (const playhead of document.querySelectorAll<HTMLElement>('.timeline-playhead')) {
    const width = Number(playhead.parentElement?.dataset.timelineContentWidth ?? 0);
    playhead.style.left = `${time / store.project.composition.duration * width}px`;
  }
}

function timeFromTimelinePointer(event: MouseEvent | PointerEvent, surface: HTMLElement, width: number): number {
  const x = Math.max(0, Math.min(width, event.clientX - surface.getBoundingClientRect().left));
  return snapTimelineTime(
    x / width * store.project.composition.duration,
    store.project.composition.frameRate,
    store.project.composition.duration,
  );
}

function installKeyframeDrag(
  marker: HTMLButtonElement,
  trackId: string,
  keyframeId: string,
  initialTime: number,
  surfaceWidth: number,
): void {
  let pointerId = -1;
  let originX = 0;
  let candidateTime = initialTime;
  let moved = false;
  marker.addEventListener('pointerdown', event => {
    event.stopPropagation();
    pointerId = event.pointerId;
    originX = event.clientX;
    candidateTime = initialTime;
    moved = false;
    marker.setPointerCapture(pointerId);
  });
  marker.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId || !marker.hasPointerCapture(pointerId)) return;
    const delta = (event.clientX - originX) / surfaceWidth * store.project.composition.duration;
    candidateTime = snapTimelineTime(
      initialTime + delta,
      store.project.composition.frameRate,
      store.project.composition.duration,
    );
    moved ||= Math.abs(event.clientX - originX) >= 2;
    marker.style.left = `${candidateTime / store.project.composition.duration * surfaceWidth}px`;
    marker.title = `${candidateTime.toFixed(3)}s`;
  });
  marker.addEventListener('pointerup', event => {
    if (event.pointerId !== pointerId) return;
    marker.releasePointerCapture(pointerId);
    pointerId = -1;
    if (!moved || candidateTime === initialTime) return;
    let changed = false;
    const committed = commitAuthoringMutation('Move Keyframe', draft => {
      changed = moveTimelineKeyframe(draft, trackId, keyframeId, candidateTime);
    });
    if (committed && changed) {
      selection.select({ kind: 'keyframe', id: keyframeId, ownerId: trackId });
      updatePlayhead(candidateTime);
      statusMessage = localizedText(
        `关键帧已移动到 ${candidateTime.toFixed(3)}s。`,
        `Moved keyframe to ${candidateTime.toFixed(3)}s.`,
      );
      renderStatus();
    } else {
      statusMessage = localizedText(
        '目标帧已有关键帧，移动已取消。',
        'A keyframe already exists at the target frame; move cancelled.',
      );
      render();
    }
  });
}

function timelineMajorStep(pixelsPerSecond: number): number {
  return [1 / 60, 1 / 30, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]
    .find(step => step * pixelsPerSecond >= 72) ?? 60;
}

function trackTargetSummary(track: AnimationEditorTrack): string {
  const target = track.target;
  if (target.kind === 'node-transform') return `Transform.${target.property}`;
  if (target.kind === 'component-property') return `${target.componentId}.${target.property}`;
  if (target.kind === 'effect-property') return `${target.effectId}.${target.property}`;
  return `${target.compositeLayerId}.${target.property}`;
}

function selectedTimelineTrackId(): string | null {
  const primary = selection.primary;
  if (primary?.kind === 'track') return primary.id;
  if (primary?.kind === 'keyframe') return primary.ownerId ?? null;
  return null;
}

function currentPlayhead(): number {
  return previewTime ?? store.project.editor?.timeline?.playhead ?? 0;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"], ge-input, ge-select'));
}

function selectionItemExists(
  project: AnimationEditorProject,
  item: AnimationEditorSelectionItem,
): boolean {
  if (item.kind === 'asset') return project.assets.some(asset => asset.id === item.id);
  if (item.kind === 'node') return project.nodes.some(node => node.id === item.id);
  if (item.kind === 'component' || item.kind === 'effect') {
    const node = project.nodes.find(candidate => candidate.id === item.ownerId);
    return item.kind === 'component'
      ? node?.components.some(component => component.id === item.id) === true
      : node?.effects.some(effect => effect.id === item.id) === true;
  }
  if (item.kind === 'track') return project.timeline.tracks.some(track => track.id === item.id);
  if (item.kind === 'keyframe') {
    return project.timeline.tracks.find(track => track.id === item.ownerId)
      ?.keyframes.some(keyframe => keyframe.id === item.id) === true;
  }
  if (item.kind === 'clip') return project.timeline.clips.some(clip => clip.id === item.id);
  const machine = project.stateMachine;
  if (!machine) return false;
  if (item.kind === 'parameter') return machine.parameters.some(parameter => parameter.name === item.id);
  if (item.kind === 'layer') return machine.layers.some(layer => layer.id === item.id);
  const layer = machine.layers.find(candidate => candidate.id === item.ownerId);
  if (item.kind === 'state') return layer?.states.some(state => state.id === item.id) === true;
  if (item.kind === 'transition') return layer?.transitions.some(transition => transition.id === item.id) === true;
  return false;
}

function renderStateMachine(): void {
  const machine = store.project.stateMachine;
  const parameterList = query<HTMLElement>('#parameter-list');
  const layerList = query<HTMLElement>('#state-layer-list');
  const summary = query<HTMLElement>('#state-summary');
  const graph = query<HTMLElement>('#state-graph');
  const transitionLayer = query<SVGSVGElement>('#state-transition-layer');
  parameterList.replaceChildren();
  layerList.replaceChildren();
  graph.replaceChildren();
  transitionLayer.replaceChildren();
  addParameterMenu.items = [
    { label: 'Float', value: 'float' },
    { label: 'Integer', value: 'integer' },
    { label: 'Boolean', value: 'boolean' },
    { label: 'Trigger', value: 'trigger' },
  ];
  if (!machine) {
    summary.hidden = false;
    createStateMachineButton.disabled = store.project.timeline.clips.length === 0;
    createStateMachineButton.title = createStateMachineButton.disabled
      ? localizedText('请先在时间轴创建至少一个命名片段', 'Create at least one named clip in the timeline first')
      : translate('stateMachine.create');
    parameterList.append(emptyMessage(
      translate('stateMachine.noParameters'),
      translate('stateMachine.noParametersDetail'),
    ));
    layerList.append(emptyMessage(
      translate('stateMachine.noLayers'),
      translate('stateMachine.noLayersDetail'),
    ));
    setDisabled(addParameterButton, true);
    setDisabled(addStateLayerButton, true);
    setDisabled(addStateButton, true);
    setDisabled(addTransitionButton, true);
    setDisabled(resetStateRuntimeButton, true);
    query<HTMLElement>('#active-state-layer').textContent = translate('stateMachine.noLayer');
    return;
  }
  summary.hidden = true;
  setDisabled(addParameterButton, false);
  setDisabled(addStateLayerButton, false);
  setDisabled(addStateButton, false);
  setDisabled(resetStateRuntimeButton, !runtimePreview.stateMachineActive);

  if (machine.parameters.length === 0) {
    parameterList.append(emptyMessage(
      translate('stateMachine.noParameters'),
      translate('stateMachine.noParametersAction'),
      'empty-block',
    ));
  }
  for (const parameter of machine.parameters) {
    const row = document.createElement('div');
    row.className = 'state-parameter-row';
    row.classList.toggle('selected', selection.primary?.kind === 'parameter' && selection.primary.id === parameter.name);
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'state-item-select';
    select.append(
      textElement('strong', parameter.name),
      textElement('span', parameter.type.toUpperCase()),
    );
    select.addEventListener('click', event => selectItem({ kind: 'parameter', id: parameter.name }, event));
    row.append(select, createRuntimeParameterControl(parameter));
    parameterList.append(row);
  }

  const activeLayer = activeStateMachineLayer() ?? machine.layers[0]!;
  for (const layer of machine.layers) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'state-layer-row';
    button.classList.toggle('selected', activeLayer.id === layer.id);
    button.append(
      textElement('strong', layer.name),
      textElement('span', localizedText(
        `${layer.states.length} 个状态 · ${localizeLiteral(layer.blendMode ?? 'override')}`,
        `${layer.states.length} states · ${layer.blendMode ?? 'override'}`,
      )),
    );
    button.addEventListener('click', event => selectItem({ kind: 'layer', id: layer.id }, event));
    layerList.append(button);
  }
  query<HTMLElement>('#active-state-layer').textContent = activeLayer.name;

  const selectedStates = selection.items.filter(item => item.kind === 'state' && item.ownerId === activeLayer.id);
  setDisabled(addTransitionButton, selectedStates.length !== 2 || selectedStates[0]?.id === selectedStates[1]?.id);
  const runtimeLayer = runtimeStateLayers.find(layer => layer.layerId === activeLayer.id);
  const statePositions = new Map(activeLayer.states.map(state => [
    state.id,
    state.editorPosition ?? [100, 120] as const,
  ]));
  for (const transition of activeLayer.transitions) {
    const from = transition.from === '*'
      ? [38, 52] as const
      : statePositions.get(transition.from) ?? [100, 120] as const;
    const to = statePositions.get(transition.to) ?? [100, 120] as const;
    const startX = from[0] + (transition.from === '*' ? 0 : 75);
    const startY = from[1] + (transition.from === '*' ? 0 : 34);
    const endX = to[0] + 75;
    const endY = to[1] + 34;
    const bend = Math.max(55, Math.abs(endX - startX) * 0.45);
    const pathData = `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('state-transition');
    group.dataset.transitionId = transition.id;
    group.classList.toggle('selected', selection.primary?.kind === 'transition' && selection.primary.id === transition.id);
    group.classList.toggle('active', runtimeLayer?.transitionId === transition.id);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', pathData);
    hit.classList.add('state-transition-hit');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.classList.add('state-transition-path');
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String((startX + endX) / 2));
    label.setAttribute('y', String((startY + endY) / 2 - 5));
    label.textContent = transition.conditions.length
      ? translate('stateMachine.conditionCount', { count: transition.conditions.length })
      : translate('stateMachine.exit');
    group.append(hit, path, label);
    group.addEventListener('click', event => {
      event.stopPropagation();
      selection.select({ kind: 'transition', id: transition.id, ownerId: activeLayer.id });
    });
    transitionLayer.append(group);
  }

  for (const state of activeLayer.states) {
    const position = state.editorPosition ?? [100, 120];
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'state-node';
    node.dataset.stateId = state.id;
    node.style.left = `${position[0]}px`;
    node.style.top = `${position[1]}px`;
    node.classList.toggle('initial', activeLayer.initialStateId === state.id);
    node.classList.toggle('selected', selection.items.some(item => (
      item.kind === 'state' && item.id === state.id && item.ownerId === activeLayer.id
    )));
    node.classList.toggle('runtime-active', runtimeLayer?.currentStateId === state.id);
    node.classList.toggle('runtime-source', runtimeLayer?.sourceStateId === state.id);
    node.classList.toggle('runtime-destination', runtimeLayer?.destinationStateId === state.id);
    node.append(
      textElement('span', activeLayer.initialStateId === state.id ? 'ENTRY' : state.motion.kind.toUpperCase(), 'state-node-kind'),
      textElement('strong', state.name),
      textElement('span', stateMotionSummary(state), 'state-node-motion'),
    );
    node.addEventListener('click', event => selectItem({
      kind: 'state', id: state.id, ownerId: activeLayer.id,
    }, event));
    installStateNodeDrag(node, activeLayer.id, state.id, position);
    graph.append(node);
  }
  graph.ondblclick = event => {
    if (event.target !== graph) return;
    const bounds = graph.getBoundingClientRect();
    addStateMachineState([
      Math.max(20, event.clientX - bounds.left - 75),
      Math.max(55, event.clientY - bounds.top - 34),
    ]);
  };
}

function createRuntimeParameterControl(parameter: HyaStateMachineParameter): HTMLElement {
  const current = runtimeParameterValues.get(parameter.name)
    ?? (parameter.type === 'trigger' ? false : parameter.defaultValue);
  if (parameter.type === 'boolean') {
    const input = document.createElement('ge-checkbox') as GECheckbox;
    input.checked = Boolean(current);
    input.label = 'Runtime';
    input.addEventListener('checked-change', event => {
      const value = (event as CustomEvent<GECheckboxChangeDetail>).detail.checked;
      applyRuntimeParameter(parameter, value);
    });
    return input;
  }
  if (parameter.type === 'trigger') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'runtime-trigger';
    button.textContent = translate('stateMachine.fire');
    button.title = translate('stateMachine.fireTitle', { name: parameter.name });
    button.addEventListener('click', () => applyRuntimeParameter(parameter, true));
    return button;
  }
  const input = document.createElement('ge-input') as GEInput;
  input.type = 'number';
  input.value = String(current);
  input.className = 'runtime-number';
  input.setAttribute('aria-label', `${parameter.name} Runtime`);
  input.setAttribute('step', parameter.type === 'integer' ? '1' : '0.1');
  input.addEventListener('value-change', event => {
    const detail = (event as CustomEvent<GEInputChangeDetail>).detail;
    if (detail.valid && detail.valueAsNumber !== null) {
      applyRuntimeParameter(
        parameter,
        parameter.type === 'integer' ? Math.round(detail.valueAsNumber) : detail.valueAsNumber,
      );
    }
  });
  return input;
}

function applyRuntimeParameter(parameter: HyaStateMachineParameter, value: number | boolean): void {
  try {
    runtimePreview.setStateMachineParameter(parameter.name, parameter.type, value);
    if (parameter.type !== 'trigger') runtimeParameterValues.set(parameter.name, value);
    statusMessage = parameter.type === 'trigger'
      ? localizedText(`已触发 ${parameter.name}。`, `Fired ${parameter.name}.`)
      : `${parameter.name} = ${String(value)}`;
    renderStatus();
  } catch (error) {
    statusMessage = errorMessage(error);
    renderStatus();
  }
}

function stateMotionSummary(state: NonNullable<AnimationEditorProject['stateMachine']>['layers'][number]['states'][number]): string {
  const motion = state.motion;
  if (motion.kind === 'clip') {
    return store.project.timeline.clips.find(clip => clip.id === motion.clipId)?.name ?? motion.clipId;
  }
  if (motion.kind === 'blend-1d') return `${motion.parameter} · ${motion.children.length} motions`;
  return `${motion.parameterX}, ${motion.parameterY} · ${motion.children.length} motions`;
}

function installStateNodeDrag(
  node: HTMLButtonElement,
  layerId: string,
  stateId: string,
  initialPosition: readonly [number, number],
): void {
  let pointerId = -1;
  let originX = 0;
  let originY = 0;
  let nextX = initialPosition[0];
  let nextY = initialPosition[1];
  let moved = false;
  node.addEventListener('pointerdown', event => {
    event.stopPropagation();
    pointerId = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    moved = false;
    node.setPointerCapture(pointerId);
  });
  node.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId || !node.hasPointerCapture(pointerId)) return;
    nextX = Math.max(15, initialPosition[0] + event.clientX - originX);
    nextY = Math.max(48, initialPosition[1] + event.clientY - originY);
    moved ||= Math.abs(event.clientX - originX) + Math.abs(event.clientY - originY) >= 3;
    node.style.left = `${nextX}px`;
    node.style.top = `${nextY}px`;
  });
  node.addEventListener('pointerup', event => {
    if (event.pointerId !== pointerId) return;
    node.releasePointerCapture(pointerId);
    pointerId = -1;
    if (!moved) return;
    if (commitAuthoringMutation('Move State Node', draft => {
      const state = draft.stateMachine?.layers
        .find(layer => layer.id === layerId)?.states.find(candidate => candidate.id === stateId);
      if (state) state.editorPosition = [Number(nextX.toFixed(2)), Number(nextY.toFixed(2))];
    })) {
      selection.select({ kind: 'state', id: stateId, ownerId: layerId });
      statusMessage = localizedText('已更新状态图布局。', 'Updated the state-graph layout.');
      renderStatus();
    }
  });
}

function updateStateMachineRuntimePresentation(frame: AnimationEditorPreviewFrame): void {
  runtimeStateLayers = frame.stateMachineLayers;
  const activeLayer = activeStateMachineLayer();
  const runtimeLayer = activeLayer
    ? frame.stateMachineLayers.find(layer => layer.layerId === activeLayer.id)
    : undefined;
  for (const node of document.querySelectorAll<HTMLElement>('.state-node')) {
    const stateId = node.dataset.stateId;
    node.classList.toggle('runtime-active', stateId === runtimeLayer?.currentStateId);
    node.classList.toggle('runtime-source', stateId === runtimeLayer?.sourceStateId);
    node.classList.toggle('runtime-destination', stateId === runtimeLayer?.destinationStateId);
  }
  for (const transition of document.querySelectorAll<SVGGElement>('.state-transition')) {
    transition.classList.toggle('active', transition.dataset.transitionId === runtimeLayer?.transitionId);
  }
  setDisabled(resetStateRuntimeButton, !runtimePreview.stateMachineActive);
}

function renderHistory(): void {
  setDisabled(undoButton, !history.canUndo);
  setDisabled(redoButton, !history.canRedo);
  const undoTitle = history.undoLabel
    ? translate('history.undoLabel', { label: history.undoLabel })
    : translate('history.noUndo');
  const redoTitle = history.redoLabel
    ? translate('history.redoLabel', { label: history.redoLabel })
    : translate('history.noRedo');
  undoButton.setAttribute('title', undoTitle);
  undoButton.setAttribute('aria-label', undoTitle);
  redoButton.setAttribute('title', redoTitle);
  redoButton.setAttribute('aria-label', redoTitle);
}

function renderStatus(): void {
  const project = store.project;
  query<HTMLElement>('#status-message').textContent = statusMessage;
  query<HTMLElement>('#project-stats').textContent = translate('status.stats', {
    nodes: project.nodes.length,
    tracks: project.timeline.tracks.length,
    assets: project.assets.length,
  });
}

function previewTimelinePointer(time: number): void {
  cancelTimelinePointerPersistence();
  const clamped = Math.max(0, Math.min(store.project.composition.duration, time));
  previewTime = clamped;
  runtimePreview.seek(clamped);
  updateTimelinePlayheadPosition(clamped);
  query<HTMLElement>('#playhead-time').textContent = timecode(clamped, store.project.composition.frameRate);
  statusMessage = translate('timeline.playheadMoved', { time: clamped.toFixed(3) });
  renderStatus();
  timelinePointerPersistTimer = window.setTimeout(() => {
    timelinePointerPersistTimer = null;
    persistTimelinePlayhead(clamped);
  }, 350);
}

function cancelTimelinePointerPersistence(): void {
  if (timelinePointerPersistTimer === null) return;
  window.clearTimeout(timelinePointerPersistTimer);
  timelinePointerPersistTimer = null;
}

function updatePlayhead(time: number): void {
  cancelTimelinePointerPersistence();
  const clamped = Math.max(0, Math.min(store.project.composition.duration, time));
  previewTime = clamped;
  runtimePreview.seek(clamped);
  updateTimelinePlayheadPosition(clamped);
  store.update('seek-shell-playhead', draft => {
    draft.editor ??= {};
    draft.editor.timeline ??= { playhead: 0, pixelsPerSecond: 240, scrollX: 0 };
    draft.editor.timeline.playhead = clamped;
  });
  statusMessage = translate('timeline.playheadMoved', { time: clamped.toFixed(3) });
  render();
}

function initializeSplitLayout(): void {
  const splits = [...document.querySelectorAll<GESplit>('ge-split[data-layout-key]')];
  let saved: Record<string, number> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY) ?? '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, number>;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  for (const split of splits) {
    const key = split.dataset.layoutKey;
    if (!key) continue;
    const ratio = saved[key];
    if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) split.ratio = ratio;
    split.addEventListener('ratio-change', event => {
      if (event.target !== split) return;
      const detail = (event as CustomEvent<GESplitRatioChangeDetail>).detail;
      saved[key] = detail.ratio;
      try {
        localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // Resizing remains functional even when preferences cannot be persisted.
      }
    });
  }
}

function scheduleTimelineLayoutRender(): void {
  if (timelineLayoutFrame !== null) return;
  timelineLayoutFrame = window.requestAnimationFrame(() => {
    timelineLayoutFrame = null;
    if (timelineLanes.isConnected) renderTimeline();
  });
}

function selectItem(item: AnimationEditorSelectionItem, event: MouseEvent): void {
  selection.select(item, {
    additive: event.shiftKey,
    toggle: event.metaKey || event.ctrlKey,
  });
}

function emptyMessage(title: string, detail: string, className = 'empty-list'): HTMLElement {
  const value = document.createElement('div');
  value.className = className;
  value.append(textElement('strong', title), textElement('span', detail));
  return value;
}

function textElement(tag: string, text: string, className = ''): HTMLElement {
  const value = document.createElement(tag);
  value.className = className;
  value.textContent = text;
  return value;
}

function timecode(seconds: number, frameRate: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const frames = Math.floor((safe - Math.floor(safe)) * frameRate);
  return [minutes, wholeSeconds, frames].map(value => String(value).padStart(2, '0')).join(':');
}

function setDisabled(element: HTMLElement, disabled: boolean): void {
  element.toggleAttribute('disabled', disabled);
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new ReferenceError(`Missing Animation Editor element ${selector}.`);
  return element;
}
