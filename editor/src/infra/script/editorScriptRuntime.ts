import { Camera2D, Camera3D, CartesianTransform3D, ColorSRGB, Component, Entity, System, SphericalTransform3D, Transform2D, HaiyueEngine, World } from '@haiyue/engine';
import { DataComponent, KeyboardComponent, ScriptComponent, type ScriptRuntimeApi, type ScriptRuntimeReadApi, type ScriptRuntimeSceneApi, Transform3D } from '@haiyue/engine/components';
import { InputMap } from '@haiyue/engine/input';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import { GltfModelComponent } from '@haiyue/extensions/gltf';
import { Grid2DComponent } from '@haiyue/extensions/grid';
import { Tilemap2DComponent } from '@haiyue/extensions/tilemap';
import { Tween2DComponent } from '@haiyue/extensions/tween';
import type { SerializedGlobalSettings } from '../../export/runtimeScene';
import { getWorldGlobalSettings } from '../../domain/settings/globalSettings';
import { EditorEntityLookupIndex } from './editorEntityLookupIndex';
import { getEngineGPUResourceTracker } from '../../engine-adapter/EditorDiagnosticsProtocol';

export const DEFAULT_EDITOR_SCRIPT_COMPONENTS = Object.freeze({
  Camera2D,
  Camera3D,
  CanvasTextComponent,
  CartesianTransform3D,
  ColorSRGB,
  DataComponent,
  Entity,
  GltfModelComponent,
  Grid2DComponent,
  InputMap,
  KeyboardComponent,
  SphericalTransform3D,
  Tilemap2DComponent,
  Transform2D,
  Transform3D,
  Tween2DComponent,
});

export interface EditorScriptRuntimeApiFactoryDeps {
  canvas: HTMLCanvasElement | null;
  /**
   * Names from DEFAULT_EDITOR_SCRIPT_COMPONENTS that should be exposed to editor scripts.
   * Omit to use the default editor-safe whitelist.
   */
  componentWhitelist?: readonly (keyof typeof DEFAULT_EDITOR_SCRIPT_COMPONENTS)[];
  /**
   * Explicit opt-in extension point for project/editor-owned component factories.
   * Avoid exposing renderer, system, engine, GPU, physics, or mesh internals here.
   */
  extraComponents?: Record<string, unknown>;
  /**
   * System names that editor scripts may query through api.read.getSystem().
   * Defaults to none to avoid exposing mutable engine systems by string lookup.
   */
  allowedSystemNames?: readonly string[];
  /**
   * False by default. When false, api.read.engine is a read-only viewport info facade
   * instead of the mutable HaiyueEngine instance.
   */
  exposeRawEngine?: boolean;
}

export function createEditorScriptRuntimeApiFactory(
  world: World,
  engine: HaiyueEngine,
  deps: EditorScriptRuntimeApiFactoryDeps,
) {
  const allowedSystemNames = new Set(deps.allowedSystemNames ?? []);
  const components = createEditorScriptComponents(deps);
  const entityLookup = new EditorEntityLookupIndex(world);
  const engineApi = deps.exposeRawEngine === true
    ? engine
    : createEditorEngineFacade(engine);
  const canvasApi = createEditorCanvasFacade(engine, deps.canvas);
  const runtimeFacade = {
    get globals(): SerializedGlobalSettings | null {
      return getWorldGlobalSettings(world);
    },
    createEntity(name = 'Untitled Entity', parent?: Entity | null): Entity {
      const entity = new Entity(name);
      if (parent) parent.addChild(entity);
      else world.addEntity(entity);
      entityLookup.add(entity);
      return entity;
    },
    destroy(entityOrId: Entity | number | string): void {
      const entity = entityOrId instanceof Entity ? entityOrId : entityLookup.find(entityOrId);
      if (!entity) return;
      world.removeEntity(entity);
      entityLookup.remove(entity);
    },
    removeEntity(entityOrId: Entity | number | string): void {
      this.destroy(entityOrId);
    },
    find(nameOrId: string | number): Entity | null {
      return entityLookup.find(nameOrId);
    },
    findAll(name?: string): Entity[] {
      return entityLookup.findAll(name);
    },
    findByComponent(componentType: string | (new (...args: never[]) => Component)): Entity[] {
      return [...world.entities.values()].filter(entity => {
        if (typeof componentType === 'string') return entity.getComponent(componentType) !== null;
        return entity.getComponent(componentType) !== null;
      });
    },
    findPrefab(): null {
      return null;
    },
    spawnPrefab(): null {
      return null;
    },
    addSystem(): null {
      return null;
    },
    addComponent(entity: Entity, component: Component): Entity {
      entity.addComponent(component);
      return entity;
    },
    getSystem(system: string | (new (...args: never[]) => System)): System | null {
      const systemName = typeof system === 'string' ? system : system.name;
      if (!allowedSystemNames.has(systemName)) return null;
      if (typeof system !== 'string') return world.getSystem(system);
      for (const item of world.systems.values()) {
        if (item.name === system || item.constructor.name === system) return item;
      }
      return world.getSystem(system);
    },
    setText(entityOrId: Entity | number | string, text: string): boolean {
      const entity = entityOrId instanceof Entity ? entityOrId : entityLookup.find(entityOrId);
      const canvasText = entity?.getComponent(CanvasTextComponent);
      if (!canvasText) return false;
      canvasText.text = text;
      return true;
    },
  } satisfies Pick<ScriptRuntimeReadApi, 'find' | 'findAll' | 'findByComponent' | 'getSystem'>
    & ScriptRuntimeSceneApi
    & {
      readonly globals: SerializedGlobalSettings | null;
      findPrefab(nameOrId: string | number): unknown | null;
    };
  let cachedBaseApi: ScriptRuntimeApi | null = null;
  let cachedRuntimeApi: ScriptRuntimeApi | null = null;
  return (baseApi: ScriptRuntimeApi): ScriptRuntimeApi => {
    if (cachedBaseApi === baseApi && cachedRuntimeApi) return cachedRuntimeApi;
    cachedBaseApi = baseApi;
    const runtimeApi: ScriptRuntimeApi = {
      ...baseApi,
      input: KeyboardComponent,
      read: Object.freeze({
        ...baseApi.read!,
        globals: runtimeFacade.globals,
        find: runtimeFacade.find,
        findAll: runtimeFacade.findAll,
        findByComponent: runtimeFacade.findByComponent,
        getSystem: runtimeFacade.getSystem,
        components,
        canvas: canvasApi,
        pointer: Object.freeze({}),
        engine: engineApi as unknown as Readonly<Record<string, unknown>>,
      }),
      scene: Object.freeze({
        createEntity: runtimeFacade.createEntity,
        destroy: runtimeFacade.destroy,
        removeEntity: runtimeFacade.removeEntity,
        spawnPrefab: runtimeFacade.spawnPrefab,
        addSystem: runtimeFacade.addSystem,
        addComponent: runtimeFacade.addComponent,
        setText: runtimeFacade.setText,
      }),
      asset: Object.freeze({ findPrefab: runtimeFacade.findPrefab }),
    };
    cachedRuntimeApi = runtimeApi;
    return runtimeApi;
  };
}

function createEditorScriptComponents(deps: EditorScriptRuntimeApiFactoryDeps): Readonly<Record<string, unknown>> {
  const whitelist = deps.componentWhitelist ?? Object.keys(DEFAULT_EDITOR_SCRIPT_COMPONENTS) as Array<keyof typeof DEFAULT_EDITOR_SCRIPT_COMPONENTS>;
  const exposed: Record<string, unknown> = {};
  for (const name of whitelist) {
    exposed[name] = DEFAULT_EDITOR_SCRIPT_COMPONENTS[name];
  }
  if (deps.extraComponents) {
    for (const [name, value] of Object.entries(deps.extraComponents)) {
      if (value !== undefined && value !== null) exposed[name] = value;
    }
  }
  return Object.freeze(exposed);
}

function createEditorEngineFacade(engine: HaiyueEngine): Readonly<Record<string, unknown>> {
  return Object.freeze({
    get width() { return engine.width; },
    get height() { return engine.height; },
    get displayWidth() { return engine.displayWidth; },
    get displayHeight() { return engine.displayHeight; },
    get devicePixelRatio() { return engine.devicePixelRatio; },
    get clearColor() { return { ...engine.clearColor }; },
    get reverseZ() { return engine.reverseZ; },
    getGPUResourceUsage: () => getEngineGPUResourceTracker(engine)?.getUsage()
      ?? { buffers: 0, textures: 0, querySets: 0, estimatedBytes: 0 },
  });
}

function createEditorCanvasFacade(
  engine: HaiyueEngine,
  canvas: HTMLCanvasElement | null,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    get element() { return canvas; },
    get width() { return canvas?.width ?? engine.width; },
    get height() { return canvas?.height ?? engine.height; },
    get displayWidth() { return canvas?.clientWidth ?? engine.width; },
    get displayHeight() { return canvas?.clientHeight ?? engine.height; },
  });
}

export function updateEditorWorld(
  world: World,
  time: number,
  delta: number,
  runScriptsInEditor: boolean,
): void {
  if (runScriptsInEditor) {
    world.update(time, delta);
    return;
  }
  ScriptComponent.withExecutionOptions({ enabled: false, policy: 'disabled' }, () => {
    world.update(time, delta);
  });
}
