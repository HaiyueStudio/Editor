import type { World } from '@haiyue/engine';
import type { SerializedEditorScene } from '../export/runtimeScene';
import type { EditorPlayState } from '../domain/store/PlayState';
import {
  PlayDevicePreviewController,
  type PlayDevicePreviewSession,
} from '../play/devicePreview';
import { PlayOutput } from '../play/playOutput';
import { PlaySession } from '../play/playSession';
import type {
  RuntimeDebugPanel,
  RuntimeDebugPanelElements,
  RuntimeInspectorFieldEdit,
  RuntimeInspectorSnapshot,
  RuntimePerformanceSnapshot,
} from '../play/runtimeDebugPanel';

export interface EditorRuntimeAdapterElements {
  playDeviceCustom: HTMLElement | null;
  playDeviceDprInput: HTMLInputElement | null;
  playDeviceWidthInput: HTMLInputElement | null;
  playDeviceHeightInput: HTMLInputElement | null;
  playDeviceZoomInput: HTMLInputElement | null;
  playDeviceViewport: HTMLElement | null;
  playDeviceFrame: HTMLElement | null;
  playDeviceSelect: HTMLSelectElement | null;
  playOverlay: HTMLElement | null;
  playFrame: HTMLIFrameElement | null;
  playPauseButton: HTMLButtonElement | null;
  playOutput: HTMLElement | null;
  playRuntimeInspector: HTMLElement | null;
  playPerformance: HTMLElement | null;
  playDiagnosticExportButton: HTMLButtonElement | null;
  playBreakpointsInput: HTMLTextAreaElement | null;
  playBreakpointsApplyButton: HTMLButtonElement | null;
  playBreakpointsStatus: HTMLElement | null;
}

export interface EditorRuntimeAdapterOptions {
  elements: EditorRuntimeAdapterElements;
  serializeScene(world: World, signal?: AbortSignal): Promise<SerializedEditorScene>;
  getSelectedEntityId?: () => number | null;
  subscribeSelectedEntityId?: (listener: (entityId: number | null) => void) => () => void;
  onStateChange?: (state: EditorPlayState) => void;
  playDeviceSession?: Partial<PlayDevicePreviewSession>;
  onPlayDeviceSessionChange?: (session: PlayDevicePreviewSession) => void;
}

export interface EditorRuntimeAdapterResult {
  playDevicePreview: PlayDevicePreviewController;
  playSession: PlaySession;
}

type RuntimeDebugPanelModule = typeof import('../play/runtimeDebugPanel');

class LazyRuntimeDebugPanel {
  private _panelPromise: Promise<RuntimeDebugPanel> | null = null;
  private _panel: RuntimeDebugPanel | null = null;
  private _onBreakpointsChange: ((breakpoints: string[]) => void) | null = null;
  private _onFieldEdit: ((edit: RuntimeInspectorFieldEdit) => void) | null = null;

  constructor(private readonly _elements: RuntimeDebugPanelElements) {}

  get breakpoints(): string[] {
    return this._panel?.breakpoints ?? readBreakpointsInput(this._elements.breakpointInput);
  }

  setBreakpointsChangeHandler(handler: (breakpoints: string[]) => void): void {
    this._onBreakpointsChange = handler;
    this._panel?.setBreakpointsChangeHandler(handler);
  }

  setFieldEditHandler(handler: (edit: RuntimeInspectorFieldEdit) => void): void {
    this._onFieldEdit = handler;
    this._panel?.setFieldEditHandler(handler);
  }

  clear(): void {
    void this._load().then(panel => panel.clear());
  }

  renderBreakpointHit(details: Parameters<RuntimeDebugPanel['renderBreakpointHit']>[0]): void {
    void this._load().then(panel => panel.renderBreakpointHit(details));
  }

  renderInspector(snapshot: RuntimeInspectorSnapshot | null): void {
    void this._load().then(panel => panel.renderInspector(snapshot));
  }

  renderPerformance(snapshot: RuntimePerformanceSnapshot | null): void {
    void this._load().then(panel => panel.renderPerformance(snapshot));
  }

  private _load(): Promise<RuntimeDebugPanel> {
    if (this._panel) return Promise.resolve(this._panel);
    this._panelPromise ??= import('../play/runtimeDebugPanel')
      .then((module: RuntimeDebugPanelModule) => {
        const panel = new module.RuntimeDebugPanel(this._elements);
        if (this._onBreakpointsChange) panel.setBreakpointsChangeHandler(this._onBreakpointsChange);
        if (this._onFieldEdit) panel.setFieldEditHandler(this._onFieldEdit);
        this._panel = panel;
        return panel;
      });
    return this._panelPromise;
  }
}

export function createEditorRuntimeAdapter(options: EditorRuntimeAdapterOptions): EditorRuntimeAdapterResult {
  const { elements } = options;
  const playDevicePreview = new PlayDevicePreviewController({
    custom: elements.playDeviceCustom,
    dprInput: elements.playDeviceDprInput,
    widthInput: elements.playDeviceWidthInput,
    heightInput: elements.playDeviceHeightInput,
    zoomInput: elements.playDeviceZoomInput,
    viewport: elements.playDeviceViewport,
    frame: elements.playDeviceFrame,
    select: elements.playDeviceSelect,
  }, {
    ...(options.playDeviceSession === undefined ? {} : { session: options.playDeviceSession }),
    ...(options.onPlayDeviceSessionChange === undefined ? {} : { onSessionChange: options.onPlayDeviceSessionChange }),
  });
  const playOutputLog = new PlayOutput(elements.playOutput);
  const runtimeDebugPanel = new LazyRuntimeDebugPanel({
    inspector: elements.playRuntimeInspector,
    performance: elements.playPerformance,
    diagnosticExportButton: elements.playDiagnosticExportButton,
    breakpointInput: elements.playBreakpointsInput,
    breakpointApplyButton: elements.playBreakpointsApplyButton,
    breakpointStatus: elements.playBreakpointsStatus,
  });
  const playSession = new PlaySession({
    overlay: elements.playOverlay,
    frame: elements.playFrame,
    pauseButton: elements.playPauseButton,
    output: playOutputLog,
    debugPanel: runtimeDebugPanel,
    serializeScene: options.serializeScene,
    getDevicePixelRatio: () => playDevicePreview.getPixelRatio(),
    ...(options.getSelectedEntityId === undefined ? {} : { getSelectedEntityId: options.getSelectedEntityId }),
    ...(options.subscribeSelectedEntityId === undefined ? {} : { subscribeSelectedEntityId: options.subscribeSelectedEntityId }),
    ...(options.onStateChange === undefined ? {} : { onStateChange: options.onStateChange }),
  });

  return { playDevicePreview, playSession };
}

function readBreakpointsInput(input: HTMLTextAreaElement | null): string[] {
  return (input?.value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}
