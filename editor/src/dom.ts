import type { GECheckbox, GEContextMenu, GEDropdown, GESelect, GETree } from '@haiyue/ui';

export interface EditorDom {
  tree: GETree | null;
  entitySearchInput: HTMLInputElement | null;
  resourceSearchInput: HTMLInputElement | null;
  assetOperationCenter: HTMLElement | null;
  entityContextMenu: GEContextMenu | null;
  systemList: HTMLElement | null;
  systemAddSelect: HTMLSelectElement | null;
  systemAddButton: HTMLButtonElement | null;
  canvas: HTMLCanvasElement | null;
  viewportWrap: HTMLElement | null;
  viewportMessage: HTMLElement | null;
  selectionHelper2DLayer: HTMLElement | null;
  geometryResources: HTMLElement | null;
  materialResources: HTMLElement | null;
  textureResources: HTMLElement | null;
  modelResources: HTMLElement | null;
  prefabResources: HTMLElement | null;
  scriptResources: HTMLElement | null;
  entityInspectorPanel: HTMLElement | null;
  inspectorEmpty: HTMLElement | null;
  inspectorForm: HTMLElement | null;
  resourceDetail: HTMLElement | null;
  resourceDetailTitle: HTMLElement | null;
  resourceDetailGrid: HTMLElement | null;
  globalGameNameInput: HTMLInputElement | null;
  globalDesignWidthInput: HTMLInputElement | null;
  globalDesignHeightInput: HTMLInputElement | null;
  globalViewportModeSelect: HTMLSelectElement | null;
  globalClearColorInput: HTMLInputElement | null;
  globalClearAlphaInput: HTMLInputElement | null;
  globalReverseZInput: GECheckbox | null;
  globalRender2DLoadOpSelect: HTMLSelectElement | null;
  globalGuiLoadOpSelect: HTMLSelectElement | null;
  globalParametersInput: HTMLTextAreaElement | null;
  entityNameInput: HTMLInputElement | null;
  entityIdValue: HTMLElement | null;
  selectedComponents: GESelect | null;
  addComponentButton: HTMLButtonElement | null;
  addComponentDropdown: GEDropdown | null;
  removeComponentButton: HTMLButtonElement | null;
  componentEditorEmpty: HTMLElement | null;
  componentSectionTitle: HTMLElement | null;
  transformSection: HTMLElement | null;
  cartesianTransformFields: HTMLElement | null;
  sphericalTransformFields: HTMLElement | null;
  transformNote: HTMLElement | null;
  meshSection: HTMLElement | null;
  meshGeometrySelect: GESelect | null;
  meshMaterialSelect: GESelect | null;
  mesh2DSection: HTMLElement | null;
  mesh2DMaterialSelect: GESelect | null;
  mesh2DColorInput: HTMLInputElement | null;
  mesh2DAlphaInput: HTMLInputElement | null;
  mesh2DBlendingSelect: HTMLSelectElement | null;
  canvasTextSection: HTMLElement | null;
  canvasTextTextInput: HTMLTextAreaElement | null;
  canvasTextStyleInput: HTMLTextAreaElement | null;
  dataComponentSection: HTMLElement | null;
  dataComponentInput: HTMLTextAreaElement | null;
  genericComponentSection: HTMLElement | null;
  genericComponentTitle: HTMLElement | null;
  genericComponentFields: HTMLElement | null;
  tilemap2DSection: HTMLElement | null;
  tilemapColumnsInput: HTMLInputElement | null;
  tilemapRowsInput: HTMLInputElement | null;
  tilemapCellWidthInput: HTMLInputElement | null;
  tilemapCellHeightInput: HTMLInputElement | null;
  tilemapGapInput: HTMLInputElement | null;
  tilemapOriginXInput: HTMLInputElement | null;
  tilemapOriginYInput: HTMLInputElement | null;
  tilemapPaletteInput: HTMLTextAreaElement | null;
  tilemapCellsInput: HTMLTextAreaElement | null;
  transform2DSection: HTMLElement | null;
  transform2DXInput: HTMLInputElement | null;
  transform2DYInput: HTMLInputElement | null;
  transform2DRotationInput: HTMLInputElement | null;
  transform2DScaleXInput: HTMLInputElement | null;
  transform2DScaleYInput: HTMLInputElement | null;
  keyboardSection: HTMLElement | null;
  keyboardPressedValue: HTMLElement | null;
  keyboardExampleCode: HTMLElement | null;
  cameraSection: HTMLElement | null;
  cameraSectionTitle: HTMLElement | null;
  camera3DFields: HTMLElement | null;
  camera2DFields: HTMLElement | null;
  cameraProjectionSelect: HTMLSelectElement | null;
  cameraFovInput: HTMLInputElement | null;
  cameraNearInput: HTMLInputElement | null;
  cameraFarInput: HTMLInputElement | null;
  cameraReverseZInput: HTMLInputElement | null;
  cameraOrthoLeftInput: HTMLInputElement | null;
  cameraOrthoRightInput: HTMLInputElement | null;
  cameraOrthoTopInput: HTMLInputElement | null;
  cameraOrthoBottomInput: HTMLInputElement | null;
  camera2DWidthInput: HTMLInputElement | null;
  camera2DHeightInput: HTMLInputElement | null;
  camera2DZoomInput: HTMLInputElement | null;
  camera2DNearInput: HTMLInputElement | null;
  camera2DFarInput: HTMLInputElement | null;
  scriptSection: HTMLElement | null;
  scriptResourceSelect: GESelect | null;
  scriptLifecycleSelect: GESelect | null;
  scriptEditorHost: HTMLElement | null;
  scriptParametersCode: HTMLElement | null;
  scriptInsertExampleButton: HTMLButtonElement | null;
  scriptEditorOverlay: HTMLElement | null;
  scriptEditorOverlayTitle: HTMLElement | null;
  scriptEditorOverlayClose: HTMLButtonElement | null;
  positionInputs: Array<HTMLInputElement | null>;
  rotationInputs: Array<HTMLInputElement | null>;
  scaleInputs: Array<HTMLInputElement | null>;
  sphericalRadiusInput: HTMLInputElement | null;
  sphericalThetaInput: HTMLInputElement | null;
  sphericalPhiInput: HTMLInputElement | null;
  sphericalTargetInputs: Array<HTMLInputElement | null>;
  undoButton: HTMLElement | null;
  redoButton: HTMLElement | null;
  openButton: HTMLElement | null;
  recentScenesDropdown: GEDropdown | null;
  saveButton: HTMLElement | null;
  saveAsButton: HTMLElement | null;
  exportProjectButton: HTMLElement | null;
  playButton: HTMLElement | null;
  editorOptionsButton: HTMLButtonElement | null;
  editorOptionsPanel: HTMLElement | null;
  editorLanguageSelect: HTMLSelectElement | null;
  editorThemeSelect: HTMLSelectElement | null;
  editorDefaultMaterialSelect: HTMLSelectElement | null;
  resourceTabs: HTMLElement | null;
  inspectorTabs: HTMLElement | null;
  workspaceSplit: HTMLElement | null;
  leftStackSplit: HTMLElement | null;
  centerSplit: HTMLElement | null;
  viewportStackSplit: HTMLElement | null;
  viewportTranslateButton: HTMLElement | null;
  viewportRotateButton: HTMLElement | null;
  viewportScaleButton: HTMLElement | null;
  viewportTransformSpace: HTMLSelectElement | null;
  viewportTransformPivot: HTMLSelectElement | null;
  viewportSnapEnabled: HTMLInputElement | null;
  viewportSnapValue: HTMLInputElement | null;
  viewportFocusSelection: HTMLElement | null;
  starterKitDropdown: GEDropdown | null;
  playOverlay: HTMLElement | null;
  playDeviceSelect: HTMLSelectElement | null;
  playDeviceDprInput: HTMLInputElement | null;
  playDeviceCustom: HTMLElement | null;
  playDeviceWidthInput: HTMLInputElement | null;
  playDeviceHeightInput: HTMLInputElement | null;
  playDeviceZoomInput: HTMLInputElement | null;
  playDeviceViewport: HTMLElement | null;
  playDeviceFrame: HTMLElement | null;
  playFrame: HTMLIFrameElement | null;
  playCloseButton: HTMLButtonElement | null;
  playRestartButton: HTMLButtonElement | null;
  playPauseButton: HTMLButtonElement | null;
  playOutput: HTMLElement | null;
  playRuntimeInspector: HTMLElement | null;
  playPerformance: HTMLElement | null;
  playDiagnosticExportButton: HTMLButtonElement | null;
  playBreakpointsInput: HTMLTextAreaElement | null;
  playBreakpointsApplyButton: HTMLButtonElement | null;
  playBreakpointsStatus: HTMLElement | null;
  openFileInput: HTMLInputElement | null;
  orbitModeButton: HTMLButtonElement | null;
  boxModeButton: HTMLButtonElement | null;
  boxSelectTargetDropdown: GEDropdown | null;
}

export function getEditorDom(): EditorDom {
  return {
    tree: document.getElementById('hierarchy-tree') as GETree | null,
    entitySearchInput: document.getElementById('entity-search-input') as HTMLInputElement | null,
    resourceSearchInput: document.getElementById('resource-search-input') as HTMLInputElement | null,
    assetOperationCenter: document.getElementById('asset-operation-center'),
    entityContextMenu: document.getElementById('entity-context-menu') as GEContextMenu | null,
    systemList: document.getElementById('system-list'),
    systemAddSelect: document.getElementById('system-add-select') as HTMLSelectElement | null,
    systemAddButton: document.getElementById('system-add-button') as HTMLButtonElement | null,
    canvas: document.getElementById('viewport') as HTMLCanvasElement | null,
    viewportWrap: document.getElementById('viewport-wrap'),
    viewportMessage: document.getElementById('viewport-message'),
    selectionHelper2DLayer: document.getElementById('selection-helper-2d-layer') as HTMLElement | null,
    geometryResources: document.getElementById('geometry-resources'),
    materialResources: document.getElementById('material-resources'),
    textureResources: document.getElementById('texture-resources'),
    modelResources: document.getElementById('model-resources'),
    prefabResources: document.getElementById('prefab-resources'),
    scriptResources: document.getElementById('script-resources'),
    entityInspectorPanel: document.getElementById('entity-inspector-panel') as HTMLElement | null,
    inspectorEmpty: document.getElementById('inspector-empty'),
    inspectorForm: document.getElementById('inspector-form') as HTMLElement | null,
    resourceDetail: document.getElementById('resource-detail') as HTMLElement | null,
    resourceDetailTitle: document.getElementById('resource-detail-title') as HTMLElement | null,
    resourceDetailGrid: document.getElementById('resource-detail-grid') as HTMLElement | null,
    globalGameNameInput: document.getElementById('global-game-name-input') as HTMLInputElement | null,
    globalDesignWidthInput: document.getElementById('global-design-width-input') as HTMLInputElement | null,
    globalDesignHeightInput: document.getElementById('global-design-height-input') as HTMLInputElement | null,
    globalViewportModeSelect: document.getElementById('global-viewport-mode-select') as HTMLSelectElement | null,
    globalClearColorInput: document.getElementById('global-clear-color-input') as HTMLInputElement | null,
    globalClearAlphaInput: document.getElementById('global-clear-alpha-input') as HTMLInputElement | null,
    globalReverseZInput: document.getElementById('global-reverse-z-input') as GECheckbox | null,
    globalRender2DLoadOpSelect: document.getElementById('global-render2d-load-op-select') as HTMLSelectElement | null,
    globalGuiLoadOpSelect: document.getElementById('global-gui-load-op-select') as HTMLSelectElement | null,
    globalParametersInput: document.getElementById('global-parameters-input') as HTMLTextAreaElement | null,
    entityNameInput: document.getElementById('entity-name-input') as HTMLInputElement | null,
    entityIdValue: document.getElementById('entity-id-value'),
    selectedComponents: document.getElementById('selected-components') as GESelect | null,
    addComponentButton: document.getElementById('add-component-button') as HTMLButtonElement | null,
    addComponentDropdown: document.getElementById('add-component-dropdown') as GEDropdown | null,
    removeComponentButton: document.getElementById('remove-component-button') as HTMLButtonElement | null,
    componentEditorEmpty: document.getElementById('component-editor-empty') as HTMLElement | null,
    componentSectionTitle: document.getElementById('component-section-title') as HTMLElement | null,
    transformSection: document.getElementById('transform-section') as HTMLElement | null,
    cartesianTransformFields: document.getElementById('cartesian-transform-fields') as HTMLElement | null,
    sphericalTransformFields: document.getElementById('spherical-transform-fields') as HTMLElement | null,
    transformNote: document.getElementById('transform-note') as HTMLElement | null,
    meshSection: document.getElementById('mesh-section') as HTMLElement | null,
    meshGeometrySelect: document.getElementById('mesh-geometry-select') as GESelect | null,
    meshMaterialSelect: document.getElementById('mesh-material-select') as GESelect | null,
    mesh2DSection: document.getElementById('mesh2d-section') as HTMLElement | null,
    mesh2DMaterialSelect: document.getElementById('mesh2d-material-select') as GESelect | null,
    mesh2DColorInput: document.getElementById('mesh2d-color-input') as HTMLInputElement | null,
    mesh2DAlphaInput: document.getElementById('mesh2d-alpha-input') as HTMLInputElement | null,
    mesh2DBlendingSelect: document.getElementById('mesh2d-blending-select') as HTMLSelectElement | null,
    canvasTextSection: document.getElementById('canvas-text-section') as HTMLElement | null,
    canvasTextTextInput: document.getElementById('canvas-text-input') as HTMLTextAreaElement | null,
    canvasTextStyleInput: document.getElementById('canvas-text-style-input') as HTMLTextAreaElement | null,
    dataComponentSection: document.getElementById('data-component-section') as HTMLElement | null,
    dataComponentInput: document.getElementById('data-component-input') as HTMLTextAreaElement | null,
    genericComponentSection: document.getElementById('generic-component-section') as HTMLElement | null,
    genericComponentTitle: document.getElementById('generic-component-title') as HTMLElement | null,
    genericComponentFields: document.getElementById('generic-component-fields') as HTMLElement | null,
    tilemap2DSection: document.getElementById('tilemap2d-section') as HTMLElement | null,
    tilemapColumnsInput: document.getElementById('tilemap-columns-input') as HTMLInputElement | null,
    tilemapRowsInput: document.getElementById('tilemap-rows-input') as HTMLInputElement | null,
    tilemapCellWidthInput: document.getElementById('tilemap-cell-width-input') as HTMLInputElement | null,
    tilemapCellHeightInput: document.getElementById('tilemap-cell-height-input') as HTMLInputElement | null,
    tilemapGapInput: document.getElementById('tilemap-gap-input') as HTMLInputElement | null,
    tilemapOriginXInput: document.getElementById('tilemap-origin-x-input') as HTMLInputElement | null,
    tilemapOriginYInput: document.getElementById('tilemap-origin-y-input') as HTMLInputElement | null,
    tilemapPaletteInput: document.getElementById('tilemap-palette-input') as HTMLTextAreaElement | null,
    tilemapCellsInput: document.getElementById('tilemap-cells-input') as HTMLTextAreaElement | null,
    transform2DSection: document.getElementById('transform2d-section') as HTMLElement | null,
    transform2DXInput: document.getElementById('transform2d-x-input') as HTMLInputElement | null,
    transform2DYInput: document.getElementById('transform2d-y-input') as HTMLInputElement | null,
    transform2DRotationInput: document.getElementById('transform2d-rotation-input') as HTMLInputElement | null,
    transform2DScaleXInput: document.getElementById('transform2d-scale-x-input') as HTMLInputElement | null,
    transform2DScaleYInput: document.getElementById('transform2d-scale-y-input') as HTMLInputElement | null,
    keyboardSection: document.getElementById('keyboard-section') as HTMLElement | null,
    keyboardPressedValue: document.getElementById('keyboard-pressed-value') as HTMLElement | null,
    keyboardExampleCode: document.getElementById('keyboard-example-code') as HTMLElement | null,
    cameraSection: document.getElementById('camera-section') as HTMLElement | null,
    cameraSectionTitle: document.getElementById('camera-section-title') as HTMLElement | null,
    camera3DFields: document.getElementById('camera3d-fields') as HTMLElement | null,
    camera2DFields: document.getElementById('camera2d-fields') as HTMLElement | null,
    cameraProjectionSelect: document.getElementById('camera-projection-select') as HTMLSelectElement | null,
    cameraFovInput: document.getElementById('camera-fov-input') as HTMLInputElement | null,
    cameraNearInput: document.getElementById('camera-near-input') as HTMLInputElement | null,
    cameraFarInput: document.getElementById('camera-far-input') as HTMLInputElement | null,
    cameraReverseZInput: document.getElementById('camera-reverse-z-input') as HTMLInputElement | null,
    cameraOrthoLeftInput: document.getElementById('camera-ortho-left-input') as HTMLInputElement | null,
    cameraOrthoRightInput: document.getElementById('camera-ortho-right-input') as HTMLInputElement | null,
    cameraOrthoTopInput: document.getElementById('camera-ortho-top-input') as HTMLInputElement | null,
    cameraOrthoBottomInput: document.getElementById('camera-ortho-bottom-input') as HTMLInputElement | null,
    camera2DWidthInput: document.getElementById('camera2d-width-input') as HTMLInputElement | null,
    camera2DHeightInput: document.getElementById('camera2d-height-input') as HTMLInputElement | null,
    camera2DZoomInput: document.getElementById('camera2d-zoom-input') as HTMLInputElement | null,
    camera2DNearInput: document.getElementById('camera2d-near-input') as HTMLInputElement | null,
    camera2DFarInput: document.getElementById('camera2d-far-input') as HTMLInputElement | null,
    scriptSection: document.getElementById('script-section') as HTMLElement | null,
    scriptResourceSelect: document.getElementById('script-resource-select') as GESelect | null,
    scriptLifecycleSelect: document.getElementById('script-lifecycle-select') as GESelect | null,
    scriptEditorHost: document.getElementById('script-editor-host') as HTMLElement | null,
    scriptParametersCode: document.getElementById('script-parameters-code') as HTMLElement | null,
    scriptInsertExampleButton: document.getElementById('script-insert-example') as HTMLButtonElement | null,
    scriptEditorOverlay: document.getElementById('script-editor-overlay') as HTMLElement | null,
    scriptEditorOverlayTitle: document.getElementById('script-editor-overlay-title') as HTMLElement | null,
    scriptEditorOverlayClose: document.getElementById('script-editor-overlay-close') as HTMLButtonElement | null,
    positionInputs: [
      document.getElementById('position-x') as HTMLInputElement | null,
      document.getElementById('position-y') as HTMLInputElement | null,
      document.getElementById('position-z') as HTMLInputElement | null,
    ],
    rotationInputs: [
      document.getElementById('rotation-x') as HTMLInputElement | null,
      document.getElementById('rotation-y') as HTMLInputElement | null,
      document.getElementById('rotation-z') as HTMLInputElement | null,
    ],
    scaleInputs: [
      document.getElementById('scale-x') as HTMLInputElement | null,
      document.getElementById('scale-y') as HTMLInputElement | null,
      document.getElementById('scale-z') as HTMLInputElement | null,
    ],
    sphericalRadiusInput: document.getElementById('spherical-radius-input') as HTMLInputElement | null,
    sphericalThetaInput: document.getElementById('spherical-theta-input') as HTMLInputElement | null,
    sphericalPhiInput: document.getElementById('spherical-phi-input') as HTMLInputElement | null,
    sphericalTargetInputs: [
      document.getElementById('spherical-target-x') as HTMLInputElement | null,
      document.getElementById('spherical-target-y') as HTMLInputElement | null,
      document.getElementById('spherical-target-z') as HTMLInputElement | null,
    ],
    undoButton: document.getElementById('undo-button') as HTMLElement | null,
    redoButton: document.getElementById('redo-button') as HTMLElement | null,
    openButton: document.getElementById('open-button') as HTMLElement | null,
    recentScenesDropdown: document.getElementById('recent-scenes-dropdown') as GEDropdown | null,
    saveButton: document.getElementById('save-button') as HTMLElement | null,
    saveAsButton: document.getElementById('save-as-button') as HTMLElement | null,
    exportProjectButton: document.getElementById('export-project-button') as HTMLElement | null,
    playButton: document.getElementById('play-button') as HTMLElement | null,
    editorOptionsButton: document.getElementById('editor-options-button') as HTMLButtonElement | null,
    editorOptionsPanel: document.getElementById('editor-options-panel') as HTMLElement | null,
    editorLanguageSelect: document.getElementById('editor-language-select') as HTMLSelectElement | null,
    editorThemeSelect: document.getElementById('editor-theme-select') as HTMLSelectElement | null,
    editorDefaultMaterialSelect: document.getElementById('editor-default-material-select') as HTMLSelectElement | null,
    resourceTabs: document.getElementById('resource-tabs') as HTMLElement | null,
    inspectorTabs: document.getElementById('inspector-tabs') as HTMLElement | null,
    workspaceSplit: document.getElementById('workspace-split') as HTMLElement | null,
    leftStackSplit: document.getElementById('left-stack-split') as HTMLElement | null,
    centerSplit: document.getElementById('center-split') as HTMLElement | null,
    viewportStackSplit: document.getElementById('viewport-stack-split') as HTMLElement | null,
    viewportTranslateButton: document.getElementById('viewport-tool-translate') as HTMLElement | null,
    viewportRotateButton: document.getElementById('viewport-tool-rotate') as HTMLElement | null,
    viewportScaleButton: document.getElementById('viewport-tool-scale') as HTMLElement | null,
    viewportTransformSpace: document.getElementById('viewport-transform-space') as HTMLSelectElement | null,
    viewportTransformPivot: document.getElementById('viewport-transform-pivot') as HTMLSelectElement | null,
    viewportSnapEnabled: document.getElementById('viewport-snap-enabled') as HTMLInputElement | null,
    viewportSnapValue: document.getElementById('viewport-snap-value') as HTMLInputElement | null,
    viewportFocusSelection: document.getElementById('viewport-focus-selection') as HTMLElement | null,
    starterKitDropdown: document.getElementById('starter-kit-dropdown') as GEDropdown | null,
    playOverlay: document.getElementById('play-overlay') as HTMLElement | null,
    playDeviceSelect: document.getElementById('play-device-select') as HTMLSelectElement | null,
    playDeviceDprInput: document.getElementById('play-device-dpr-input') as HTMLInputElement | null,
    playDeviceCustom: document.getElementById('play-device-custom') as HTMLElement | null,
    playDeviceWidthInput: document.getElementById('play-device-width-input') as HTMLInputElement | null,
    playDeviceHeightInput: document.getElementById('play-device-height-input') as HTMLInputElement | null,
    playDeviceZoomInput: document.getElementById('play-device-zoom-input') as HTMLInputElement | null,
    playDeviceViewport: document.getElementById('play-device-viewport') as HTMLElement | null,
    playDeviceFrame: document.getElementById('play-device-frame') as HTMLElement | null,
    playFrame: document.getElementById('play-frame') as HTMLIFrameElement | null,
    playCloseButton: document.getElementById('play-close-button') as HTMLButtonElement | null,
    playRestartButton: document.getElementById('play-restart-button') as HTMLButtonElement | null,
    playPauseButton: document.getElementById('play-pause-button') as HTMLButtonElement | null,
    playOutput: document.getElementById('play-output') as HTMLElement | null,
    playRuntimeInspector: document.getElementById('play-runtime-inspector') as HTMLElement | null,
    playPerformance: document.getElementById('play-performance') as HTMLElement | null,
    playDiagnosticExportButton: document.getElementById('play-diagnostic-export') as HTMLButtonElement | null,
    playBreakpointsInput: document.getElementById('play-breakpoints-input') as HTMLTextAreaElement | null,
    playBreakpointsApplyButton: document.getElementById('play-breakpoints-apply') as HTMLButtonElement | null,
    playBreakpointsStatus: document.getElementById('play-breakpoints-status') as HTMLElement | null,
    openFileInput: document.getElementById('open-file-input') as HTMLInputElement | null,
    orbitModeButton: document.getElementById('viewport-mode-orbit') as HTMLButtonElement | null,
    boxModeButton: document.getElementById('viewport-mode-box') as HTMLButtonElement | null,
    boxSelectTargetDropdown: document.getElementById('box-select-target-dropdown') as GEDropdown | null,
  };
}
