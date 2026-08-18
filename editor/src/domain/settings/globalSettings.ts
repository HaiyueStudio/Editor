import { Camera2D } from '@haiyue/engine/components';
import type { HaiyueEngine } from '@haiyue/engine/core';
import type { World } from '@haiyue/engine/ecs';
import { InputMap } from '@haiyue/engine/input';
import { type EngineDefaults, type RenderView } from '@haiyue/engine/core';
import type { SerializedGlobalSettings } from '../../export/runtimeScene';

const worldGlobalSettings = new WeakMap<World, SerializedGlobalSettings>();
const worldRenderViews = new WeakMap<World, RenderView>();
const worldRender3DSettings = new WeakMap<World, { reverseZ: boolean }>();

export function bindWorldRenderView(world: World, view: RenderView | null): void {
  if (view) worldRenderViews.set(world, view);
  else worldRenderViews.delete(world);
}

export function bindWorldRender3DSettings(
  world: World,
  target: { reverseZ: boolean } | null,
): void {
  if (target) worldRender3DSettings.set(world, target);
  else worldRender3DSettings.delete(world);
}

export const DEFAULT_GLOBAL_SETTINGS: SerializedGlobalSettings = {
  designWidth: 1280,
  designHeight: 720,
  viewportMode: 'expand',
  clearColor: [0.04, 0.05, 0.07, 1],
  reverseZ: true,
  render2DLoadOp: 'load',
  guiLoadOp: 'load',
  parameters: {},
  inputMap: InputMap.defaultTetris().toJSON(),
};

export function cloneGlobalSettings(settings: SerializedGlobalSettings): SerializedGlobalSettings {
  return {
    designWidth: settings.designWidth,
    designHeight: settings.designHeight,
    viewportMode: normalizeViewportMode(settings.viewportMode),
    clearColor: [
      settings.clearColor[0],
      settings.clearColor[1],
      settings.clearColor[2],
      settings.clearColor[3],
    ],
    reverseZ: settings.reverseZ === true,
    render2DLoadOp: settings.render2DLoadOp === 'clear' ? 'clear' : 'load',
    guiLoadOp: settings.guiLoadOp === 'clear' ? 'clear' : 'load',
    parameters: JSON.parse(JSON.stringify(settings.parameters ?? {})) as Record<string, unknown>,
    inputMap: new InputMap(settings.inputMap ?? InputMap.defaultTetris().toJSON()).toJSON(),
  };
}

export function normalizeGlobalSettings(settings?: Partial<SerializedGlobalSettings>): SerializedGlobalSettings {
  const fallback = cloneGlobalSettings(DEFAULT_GLOBAL_SETTINGS);
  return {
    designWidth: Math.max(1, Math.floor(Number(settings?.designWidth ?? fallback.designWidth) || fallback.designWidth)),
    designHeight: Math.max(1, Math.floor(Number(settings?.designHeight ?? fallback.designHeight) || fallback.designHeight)),
    viewportMode: normalizeViewportMode(settings?.viewportMode ?? fallback.viewportMode),
    clearColor: [
      Number(settings?.clearColor?.[0] ?? fallback.clearColor[0]),
      Number(settings?.clearColor?.[1] ?? fallback.clearColor[1]),
      Number(settings?.clearColor?.[2] ?? fallback.clearColor[2]),
      Number(settings?.clearColor?.[3] ?? fallback.clearColor[3]),
    ],
    reverseZ: settings?.reverseZ === true,
    render2DLoadOp: settings?.render2DLoadOp === 'clear' ? 'clear' : 'load',
    guiLoadOp: settings?.guiLoadOp === 'clear' ? 'clear' : 'load',
    parameters: settings?.parameters && typeof settings.parameters === 'object' && !Array.isArray(settings.parameters)
      ? JSON.parse(JSON.stringify(settings.parameters)) as Record<string, unknown>
      : {},
    inputMap: new InputMap(settings?.inputMap ?? fallback.inputMap).toJSON(),
  };
}

export function applyGlobalSettingsToWorld(
  world: World,
  settings: SerializedGlobalSettings,
  engine: HaiyueEngine | null = null,
): void {
  worldGlobalSettings.set(world, cloneGlobalSettings(settings));
  const view = worldRenderViews.get(world);
  if (view) {
    view.clearColor = getGlobalClearColor(settings);
    view.reverseZ = settings.reverseZ === true;
  } else if (engine) {
    engine.clearColor = getGlobalClearColor(settings);
    engine.reverseZ = settings.reverseZ === true;
  }
  for (const entity of world.entities.values()) {
    entity.getComponent(Camera2D)?.setViewportFit({
      designWidth: settings.designWidth,
      designHeight: settings.designHeight,
      viewportMode: settings.viewportMode ?? 'expand',
    });
  }
  const render3D = worldRender3DSettings.get(world);
  if (render3D) render3D.reverseZ = settings.reverseZ === true;
}

export function getWorldGlobalSettings(world: World): SerializedGlobalSettings | null {
  const settings = worldGlobalSettings.get(world);
  return settings ? cloneGlobalSettings(settings) : null;
}

export function getGlobalClearColor(settings: SerializedGlobalSettings): { r: number; g: number; b: number; a: number } {
  const [r, g, b, a] = settings.clearColor;
  return { r, g, b, a };
}

export function getEngineDefaultsFromGlobalSettings(settings: SerializedGlobalSettings): EngineDefaults {
  const clearColor = getGlobalClearColor(settings);
  const reverseZ = settings.reverseZ === true;
  return {
    clearColor,
    reverseZ,
    scene: {
      clearColor,
      reverseZ,
      render3D: { reverseZ },
      render2D: { loadOp: settings.render2DLoadOp ?? 'load' },
      gui: { loadOp: settings.guiLoadOp ?? 'load' },
    },
  };
}

function normalizeViewportMode(value: unknown): NonNullable<SerializedGlobalSettings['viewportMode']> {
  return value === 'fit' || value === 'fill' || value === 'fixed' ? value : 'expand';
}
