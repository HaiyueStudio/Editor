import { ColorSRGB, type HaiyueEngine, type World } from '@haiyue/engine';
import type { GECheckbox } from '@haiyue/ui';
import type { SerializedGlobalSettings } from '../../export/runtimeScene';
import type { EditorRuntimeContext } from '../../domain/store/RuntimeState';
import {
  applyGlobalSettingsToWorld as applyGlobalSettingsToWorldState,
  getGlobalClearColor as getGlobalClearColorState,
} from '../../domain/settings/globalSettings';

export interface MainGlobalSettingsElements {
  canvas: HTMLCanvasElement | null;
  gameNameInput: HTMLInputElement | null;
  designWidthInput: HTMLInputElement | null;
  designHeightInput: HTMLInputElement | null;
  viewportModeSelect: HTMLSelectElement | null;
  clearColorInput: HTMLInputElement | null;
  clearAlphaInput: HTMLInputElement | null;
  reverseZInput: GECheckbox | null;
  render2DLoadOpSelect: HTMLSelectElement | null;
  guiLoadOpSelect: HTMLSelectElement | null;
  parametersInput: HTMLTextAreaElement | null;
}

export interface MainGlobalSettingsBindingsDeps {
  elements: MainGlobalSettingsElements;
  getSettings(): SerializedGlobalSettings;
  getRuntimeContext(): EditorRuntimeContext | null;
  getInspectorWorld(): World | null;
  formatNumber(value: number): string;
}

export interface MainGlobalSettingsBindings {
  applyGlobalSettingsToWorld(world: World): void;
  getGlobalClearColor(): { r: number; g: number; b: number; a: number };
  syncViewportClearColor(engine?: HaiyueEngine | null): void;
  renderGlobalSettingsPanel(world?: World | null): void;
}

export function createMainGlobalSettingsBindings(deps: MainGlobalSettingsBindingsDeps): MainGlobalSettingsBindings {
  const applyGlobalSettingsToWorld = (world: World): void => {
    applyGlobalSettingsToWorldState(world, deps.getSettings(), deps.getRuntimeContext()?.viewportEngine ?? null);
  };

  const getGlobalClearColor = (): { r: number; g: number; b: number; a: number } => {
    return getGlobalClearColorState(deps.getSettings());
  };

  const syncViewportClearColor = (engine: HaiyueEngine | null = deps.getRuntimeContext()?.viewportEngine ?? null): void => {
    const clearColor = getGlobalClearColor();
    if (engine) engine.clearColor = clearColor;
    if (deps.elements.canvas) deps.elements.canvas.style.background = 'transparent';
  };

  const renderGlobalSettingsPanel = (world: World | null = deps.getInspectorWorld()): void => {
    const settings = deps.getSettings();
    const elements = deps.elements;
    if (elements.gameNameInput) elements.gameNameInput.value = world?.name ?? '';
    if (elements.designWidthInput) elements.designWidthInput.value = String(settings.designWidth);
    if (elements.designHeightInput) elements.designHeightInput.value = String(settings.designHeight);
    if (elements.viewportModeSelect) elements.viewportModeSelect.value = settings.viewportMode ?? 'expand';
    if (elements.clearColorInput) elements.clearColorInput.value = tupleToHex(settings.clearColor);
    if (elements.clearAlphaInput) elements.clearAlphaInput.value = deps.formatNumber(settings.clearColor[3]);
    if (elements.reverseZInput) elements.reverseZInput.checked = settings.reverseZ === true;
    if (elements.render2DLoadOpSelect) elements.render2DLoadOpSelect.value = settings.render2DLoadOp ?? 'load';
    if (elements.guiLoadOpSelect) elements.guiLoadOpSelect.value = settings.guiLoadOp ?? 'load';
    if (elements.parametersInput) {
      elements.parametersInput.value = JSON.stringify(settings.parameters, null, 2);
      elements.parametersInput.setCustomValidity('');
    }
  };

  return {
    applyGlobalSettingsToWorld,
    getGlobalClearColor,
    syncViewportClearColor,
    renderGlobalSettingsPanel,
  };
}

function tupleToHex(color: [number, number, number, number]): string {
  return new ColorSRGB(color[0], color[1], color[2], color[3]).toHex();
}
