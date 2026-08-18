import type { getEditorDom } from '../../dom';
import {
  startEditorApp,
  type EditorAppDeps,
  type EditorAppElements,
} from './editorApp';

type MainEditorDom = ReturnType<typeof getEditorDom>;

export type MainEditorStartupDeps = Omit<EditorAppDeps, 'elements'> & {
  editorDom: MainEditorDom;
};

function createEditorAppElements(dom: MainEditorDom): EditorAppElements {
  return {
    canvas: dom.canvas,
    viewportWrap: dom.viewportWrap,
    viewportMessage: dom.viewportMessage,
    selectionHelper2DLayer: dom.selectionHelper2DLayer,
    tree: dom.tree,
    entityContextMenu: dom.entityContextMenu,
    systemAddSelect: dom.systemAddSelect,
    systemAddButton: dom.systemAddButton,
    orbitModeButton: dom.orbitModeButton,
    boxModeButton: dom.boxModeButton,
    boxSelectTargetDropdown: dom.boxSelectTargetDropdown,
    viewportTranslateButton: dom.viewportTranslateButton,
    viewportRotateButton: dom.viewportRotateButton,
    viewportScaleButton: dom.viewportScaleButton,
    viewportTransformSpace: dom.viewportTransformSpace,
    viewportTransformPivot: dom.viewportTransformPivot,
    viewportSnapEnabled: dom.viewportSnapEnabled,
    viewportSnapValue: dom.viewportSnapValue,
    viewportFocusSelection: dom.viewportFocusSelection,
    undoButton: dom.undoButton,
    redoButton: dom.redoButton,
    saveButton: dom.saveButton,
    saveAsButton: dom.saveAsButton,
    exportProjectButton: dom.exportProjectButton,
    openButton: dom.openButton,
    recentScenesDropdown: dom.recentScenesDropdown,
    openFileInput: dom.openFileInput,
    playButton: dom.playButton,
    playDeviceSelect: dom.playDeviceSelect,
    playDeviceDprInput: dom.playDeviceDprInput,
    playDeviceZoomInput: dom.playDeviceZoomInput,
    playDeviceWidthInput: dom.playDeviceWidthInput,
    playDeviceHeightInput: dom.playDeviceHeightInput,
    starterKitDropdown: dom.starterKitDropdown,
    playCloseButton: dom.playCloseButton,
    playRestartButton: dom.playRestartButton,
    playPauseButton: dom.playPauseButton,
    playOverlay: dom.playOverlay,
  };
}

export async function startMainEditorApp(deps: MainEditorStartupDeps): Promise<void> {
  const { editorDom, ...appDeps } = deps;
  await startEditorApp({
    ...appDeps,
    elements: createEditorAppElements(editorDom),
  });
}
