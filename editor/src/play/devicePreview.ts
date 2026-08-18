import type { PlayDevicePreset } from '../types';
import { readNumber } from '../utils/formValues';

const DEFAULT_PC_PRESET: PlayDevicePreset = {
  label: 'PC Responsive',
  width: null,
  height: null,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
};

export const PLAY_DEVICE_PRESETS: Record<string, PlayDevicePreset> = {
  pc: DEFAULT_PC_PRESET,
  'iphone-se': { label: 'iPhone SE', width: 375, height: 667, dpr: 2 },
  'iphone-14': { label: 'iPhone 14', width: 390, height: 844, dpr: 3 },
  'pixel-7': { label: 'Pixel 7', width: 412, height: 915, dpr: 2.625 },
  ipad: { label: 'iPad', width: 820, height: 1180, dpr: 2 },
  custom: { label: 'Custom', width: 390, height: 844, dpr: 2 },
};

export interface PlayDevicePreviewElements {
  custom: HTMLElement | null;
  dprInput: HTMLInputElement | null;
  widthInput: HTMLInputElement | null;
  heightInput: HTMLInputElement | null;
  zoomInput: HTMLInputElement | null;
  viewport: HTMLElement | null;
  frame: HTMLElement | null;
  select: HTMLSelectElement | null;
}

export interface ApplyPlayDevicePreviewOptions {
  commitZoomInput?: boolean;
  emitSessionChange?: boolean;
}

export interface PlayDevicePreviewSession {
  deviceId: string;
  width: number | null;
  height: number | null;
  dpr: number;
  zoom: number;
}

export interface PlayDevicePreviewControllerOptions {
  session?: Partial<PlayDevicePreviewSession>;
  onSessionChange?: (session: PlayDevicePreviewSession) => void;
}

export class PlayDevicePreviewController {
  private _deviceId = 'pc';
  private _zoom = 1;
  private readonly _onSessionChange: ((session: PlayDevicePreviewSession) => void) | undefined;

  constructor(
    private readonly _elements: PlayDevicePreviewElements,
    options: PlayDevicePreviewControllerOptions = {},
  ) {
    this._onSessionChange = options.onSessionChange;
    if (options.session) this.restoreSession(options.session, { emitSessionChange: false });
  }

  get deviceId(): string {
    return this._deviceId;
  }

  set deviceId(value: string) {
    this.selectDevice(value);
  }

  get zoom(): number {
    return this._zoom;
  }

  selectDevice(deviceId: string): void {
    this._deviceId = PLAY_DEVICE_PRESETS[deviceId] ? deviceId : 'pc';
    const preset = PLAY_DEVICE_PRESETS[this._deviceId] ?? DEFAULT_PC_PRESET;
    if (this._elements.select) this._elements.select.value = this._deviceId;
    if (this._elements.dprInput) this._elements.dprInput.value = formatNumber(preset.dpr);
    if (this._elements.widthInput && preset.width !== null) this._elements.widthInput.value = String(preset.width);
    if (this._elements.heightInput && preset.height !== null) this._elements.heightInput.value = String(preset.height);
    this.applyPreview();
  }

  selectCustomFromSizeInputs(): void {
    if (this._deviceId === 'custom') return;
    this._deviceId = 'custom';
    if (this._elements.select) this._elements.select.value = 'custom';
  }

  getPreset(): PlayDevicePreset {
    const preset = PLAY_DEVICE_PRESETS[this._deviceId] ?? DEFAULT_PC_PRESET;
    if (this._deviceId !== 'custom') return preset;
    return {
      label: 'Custom',
      width: Math.max(1, Math.floor(readNumber(this._elements.widthInput, preset.width ?? 390))),
      height: Math.max(1, Math.floor(readNumber(this._elements.heightInput, preset.height ?? 844))),
      dpr: Math.max(0.5, Math.min(4, readNumber(this._elements.dprInput, preset.dpr))),
    };
  }

  getPixelRatio(): number {
    const preset = this.getPreset();
    return Math.max(0.5, Math.min(4, readNumber(this._elements.dprInput, preset.dpr)));
  }

  getZoom(options: { clamp?: boolean } = {}): number {
    const rawPercent = readNumber(this._elements.zoomInput, this._zoom * 100);
    const percent = options.clamp === false ? rawPercent : clampZoomPercent(rawPercent);
    return Math.max(0.01, percent / 100);
  }

  snapshot(): PlayDevicePreviewSession {
    const preset = this.getPreset();
    return {
      deviceId: this._deviceId,
      width: preset.width,
      height: preset.height,
      dpr: this.getPixelRatio(),
      zoom: this._zoom,
    };
  }

  restoreSession(session: Partial<PlayDevicePreviewSession>, options: { emitSessionChange?: boolean } = {}): void {
    this._deviceId = typeof session.deviceId === 'string' && PLAY_DEVICE_PRESETS[session.deviceId]
      ? session.deviceId
      : 'pc';
    this._zoom = normalizeZoom(session.zoom);
    if (this._elements.select) this._elements.select.value = this._deviceId;
    if (this._elements.zoomInput) this._elements.zoomInput.value = String(Math.round(this._zoom * 100));
    if (this._elements.dprInput && Number.isFinite(session.dpr)) {
      this._elements.dprInput.value = formatNumber(clampDpr(Number(session.dpr)));
    }
    if (this._deviceId === 'custom') {
      if (this._elements.widthInput && Number.isFinite(session.width)) {
        this._elements.widthInput.value = String(Math.max(1, Math.floor(Number(session.width))));
      }
      if (this._elements.heightInput && Number.isFinite(session.height)) {
        this._elements.heightInput.value = String(Math.max(1, Math.floor(Number(session.height))));
      }
    }
    this.applyPreview(options.emitSessionChange === undefined ? {} : { emitSessionChange: options.emitSessionChange });
  }

  applyPreview(options: ApplyPlayDevicePreviewOptions = {}): void {
    const preset = this.getPreset();
    const isPc = this._deviceId === 'pc';
    this._zoom = this.getZoom({ clamp: options.commitZoomInput !== false });
    if (this._elements.custom) this._elements.custom.hidden = this._deviceId !== 'custom';
    if (this._elements.dprInput) this._elements.dprInput.value = formatNumber(this.getPixelRatio());
    if (this._elements.zoomInput && options.commitZoomInput !== false) this._elements.zoomInput.value = String(Math.round(this._zoom * 100));
    if (this._elements.widthInput && preset.width !== null) this._elements.widthInput.value = String(preset.width);
    if (this._elements.heightInput && preset.height !== null) this._elements.heightInput.value = String(preset.height);
    if (!this._elements.frame) {
      this._emitSessionChange(options);
      return;
    }
    this._elements.frame.classList.toggle('device', !isPc);
    this._elements.frame.style.transform = `scale(${this._zoom})`;

    if (isPc || preset.width === null || preset.height === null) {
      if (this._elements.viewport) {
        this._elements.viewport.style.width = '100%';
        this._elements.viewport.style.height = '100%';
      }
      this._elements.frame.style.width = `${100 / this._zoom}%`;
      this._elements.frame.style.height = `${100 / this._zoom}%`;
      this._emitSessionChange(options);
      return;
    }

    const scaledWidth = Math.max(1, Math.round(preset.width * this._zoom));
    const scaledHeight = Math.max(1, Math.round(preset.height * this._zoom));
    if (this._elements.viewport) {
      this._elements.viewport.style.width = `${scaledWidth}px`;
      this._elements.viewport.style.height = `${scaledHeight}px`;
    }
    this._elements.frame.style.width = `${preset.width}px`;
    this._elements.frame.style.height = `${preset.height}px`;
    this._emitSessionChange(options);
  }

  private _emitSessionChange(options: ApplyPlayDevicePreviewOptions): void {
    if (options.emitSessionChange === false) return;
    this._onSessionChange?.(this.snapshot());
  }
}

function clampZoomPercent(value: number): number {
  return Math.max(25, Math.min(200, value));
}

function normalizeZoom(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 1;
  return clampZoomPercent(numberValue * 100) / 100;
}

function clampDpr(value: number): number {
  return Math.max(0.5, Math.min(4, value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
