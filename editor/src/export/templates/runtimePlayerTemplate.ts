export const RUNTIME_PLAYER_TS = String.raw`__ENGINE_IMPORT_BLOCK____COMPONENT_IMPORT_BLOCK__
import { getSceneRenderIntegration, type RenderPipelineEntryOptions } from '@haiyue/engine/experimental';
import {
  deserializeEntity,
  deserializeGeometry,
  deserializeMaterial,
  loadPrecompiledBinary,
  type RuntimeScene,
  type TextureSource,
} from './runtime-deserialization';

type Vec3Tuple = [number, number, number];

interface RuntimePrefab {
  id: number;
  name: string;
  root: any;
}

interface RuntimeHandle {
  engine: HaiyueEngine;
  world: World;
  stop(): void;
}

interface RunRuntimeSceneOptions {
  canvas: HTMLCanvasElement;
  scene: RuntimeScene;
  devicePixelRatio?: number | (() => number);
}

interface PlayerRuntime {
  engine: HaiyueEngine;
  world: World;
  geometryMap: Map<number, Geometry3D>;
  materialMap: Map<number, Material>;
  scriptMap: Map<number, ScriptResource>;
  prefabMap: Map<number, RuntimePrefab>;
  canvas: HTMLCanvasElement;
  pointer: PointerRuntime;
  registerRenderSystem?: (system: any, options?: RenderPipelineEntryOptions) => void;
}

interface PointerRuntimeSnapshot {
  x: number;
  y: number;
  dx: number;
  dy: number;
  down: boolean;
  pressed: boolean;
  released: boolean;
  button: number;
  buttons: number;
  startX: number;
  startY: number;
  dragX: number;
  dragY: number;
}

class PointerRuntime {
  private snapshot: PointerRuntimeSnapshot = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    down: false,
    pressed: false,
    released: false,
    button: -1,
    buttons: 0,
    startX: 0,
    startY: 0,
    dragX: 0,
    dragY: 0,
  };

  constructor(private readonly canvasElement: HTMLCanvasElement) {
    canvasElement.addEventListener('pointerdown', this.onPointerDown);
    canvasElement.addEventListener('pointermove', this.onPointerMove);
    canvasElement.addEventListener('pointerup', this.onPointerUp);
    canvasElement.addEventListener('pointercancel', this.onPointerUp);
    canvasElement.addEventListener('contextmenu', this.preventContextMenu);
  }

  get state(): PointerRuntimeSnapshot {
    return { ...this.snapshot };
  }

  endFrame(): void {
    this.snapshot.dx = 0;
    this.snapshot.dy = 0;
    this.snapshot.pressed = false;
    this.snapshot.released = false;
  }

  destroy(): void {
    this.canvasElement.removeEventListener('pointerdown', this.onPointerDown);
    this.canvasElement.removeEventListener('pointermove', this.onPointerMove);
    this.canvasElement.removeEventListener('pointerup', this.onPointerUp);
    this.canvasElement.removeEventListener('pointercancel', this.onPointerUp);
    this.canvasElement.removeEventListener('contextmenu', this.preventContextMenu);
  }

  private updatePosition(event: PointerEvent): void {
    const rect = this.canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.snapshot.dx += x - this.snapshot.x;
    this.snapshot.dy += y - this.snapshot.y;
    this.snapshot.x = x;
    this.snapshot.y = y;
    this.snapshot.dragX = x - this.snapshot.startX;
    this.snapshot.dragY = y - this.snapshot.startY;
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.updatePosition(event);
    this.snapshot.down = true;
    this.snapshot.pressed = true;
    this.snapshot.button = event.button;
    this.snapshot.buttons = event.buttons;
    this.snapshot.startX = this.snapshot.x;
    this.snapshot.startY = this.snapshot.y;
    this.snapshot.dragX = 0;
    this.snapshot.dragY = 0;
    this.canvasElement.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.updatePosition(event);
    this.snapshot.buttons = event.buttons;
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.updatePosition(event);
    this.snapshot.down = false;
    this.snapshot.released = true;
    this.snapshot.button = event.button;
    this.snapshot.buttons = event.buttons;
  };

  private preventContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}

export async function runRuntimeScene(options: RunRuntimeSceneOptions): Promise<RuntimeHandle> {
  const scene = options.scene;
  const engine = new HaiyueEngine({
    canvas: options.canvas,
    defaults: getEngineDefaultsFromRuntimeGlobals(scene.globals),
    alphaMode: 'premultiplied',
    msaaSamples: 4,
    devicePixelRatio: options.devicePixelRatio ?? (() => Math.min(window.devicePixelRatio || 1, 2)),
  });
  await engine.init();

  const runtimeScene = engine.createScene({
    name: scene.name || 'Runtime Scene',
    render3D: false,
    render2D: false,
    gui: false,
    pipelineLabel: 'ExportedRuntimeRenderPipeline',
  });
  runtimeScene.clear({ keepCamera: false });
  const world = runtimeScene.world;
  const renderIntegration = getSceneRenderIntegration(runtimeScene);
  (world as World & { globals?: unknown }).globals = scene.globals;
  KeyboardComponent.setInputMap(scene.globals?.inputMap ?? InputMap.defaultTetris());
  options.canvas.tabIndex = 0;
  options.canvas.focus();

  const textureMap = new Map<number, TextureSource>();
  for (const textureData of scene.resources?.textures ?? []) {
    if (textureData.src) textureMap.set(textureData.id, typeof textureData.src === 'string' ? textureData.src : { ...textureData.src });
  }

  const binaryBuffer = await loadPrecompiledBinary(scene);
  const geometryMap = new Map<number, Geometry3D>();
  for (const geometryData of scene.resources?.geometries ?? []) {
    geometryMap.set(geometryData.id, deserializeGeometry(geometryData, binaryBuffer, scene.precompiled?.geometries?.[geometryData.id]));
  }

  const materialMap = new Map<number, Material>();
  for (const materialData of scene.resources?.materials ?? []) {
    materialMap.set(materialData.id, deserializeMaterial(materialData, textureMap));
  }

  const scriptMap = new Map<number, ScriptResource>();
  for (const scriptData of scene.resources?.scripts ?? []) {
    const resource = new ScriptResource({ name: scriptData.name, scripts: scriptData.scripts });
    scriptMap.set(scriptData.id, resource);
    scriptMap.set(resource.id, resource);
  }

  const prefabMap = new Map<number, RuntimePrefab>();
  for (const prefabData of scene.resources?.prefabs ?? []) {
    prefabMap.set(prefabData.id, { id: prefabData.id, name: prefabData.name, root: prefabData.root });
  }

  const pointer = new PointerRuntime(options.canvas);
  const registerRenderSystem = (system: any, options?: RenderPipelineEntryOptions) => {
    renderIntegration.register(system, options);
  };
  const runtime: PlayerRuntime = { engine, world, geometryMap, materialMap, scriptMap, prefabMap, canvas: options.canvas, pointer, registerRenderSystem };
  ScriptComponent.setRuntimeApiFactory(createRuntimeApiFactory(runtime));
  ScriptComponent.enableTrustedProject({ capabilities: ['read', 'scene', 'asset', 'input', 'physics', 'debug'] });

  for (const entityData of scene.entities ?? []) {
    world.addEntity(deserializeEntity(entityData, geometryMap, materialMap, scriptMap));
  }

  const addRenderSystem = (
    system: System & { record: (...args: any[]) => unknown },
    options?: RenderPipelineEntryOptions,
  ) => {
    runtimeScene.addSystem(system, options);
  };
  installRuntimeSystems(world, engine, scene, addRenderSystem);

  const resizeCanvas = () => engine.resizeToDisplaySize();
  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(options.canvas);
  window.addEventListener('resize', resizeCanvas);

  engine.switchScene(runtimeScene);
  engine.on('after-update', () => {
    pointer.endFrame();
  });
  engine.run();

  return {
    engine,
    world,
    stop() {
      resizeObserver.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      pointer.destroy();
      engine.destroy();
      ScriptComponent.resetRuntimeApiFactory();
      ScriptComponent.resetExecutionOptions();
    },
  };
}

__HAS_RADIAL_SHADOW_HELPER__

function installRuntimeSystems(
  world: World,
  engine: HaiyueEngine,
  scene: RuntimeScene,
  addRenderSystem: (
    system: System & { record: (...args: any[]) => unknown },
    options?: RenderPipelineEntryOptions,
  ) => void,
): void {
__INSTALL_RUNTIME_SYSTEMS__
}

function applyViewportSettingsToCamera2D(cameraEntity: Entity, globals: RuntimeScene['globals']): void {
  cameraEntity.getComponent(Camera2D)?.setViewportFit({
    designWidth: globals?.designWidth,
    designHeight: globals?.designHeight,
    viewportMode: globals?.viewportMode ?? 'expand',
  });
}

function findCameraEntity(world: World): Entity | null {
  for (const entity of world.entities.values()) {
    if (!entity.disabled && entity.getComponent(Camera3D)) return entity;
  }
  return null;
}

function findCamera2DEntity(world: World): Entity | null {
  for (const entity of world.entities.values()) {
    if (!entity.disabled && entity.getComponent(Camera2D)) return entity;
  }
  return null;
}

__HAS_BLINN_PHONG_HELPER__
__HAS_TOON_HELPER__

function hasComponentType(world: World, componentType: new (...args: any[]) => Component): boolean {
  for (const entity of world.entities.values()) {
    if (entity.getComponent(componentType)) return true;
  }
  return false;
}

function findEntity(world: World, nameOrId: string | number): Entity | null {
  if (typeof nameOrId === 'number') return world.getEntity(nameOrId);
  for (const entity of world.entities.values()) {
    if (entity.name === nameOrId) return entity;
  }
  return world.getEntity(nameOrId);
}

function findPrefab(runtime: PlayerRuntime, nameOrId: string | number): RuntimePrefab | null {
  if (typeof nameOrId === 'number') return runtime.prefabMap.get(nameOrId) ?? null;
  for (const prefab of runtime.prefabMap.values()) {
    if (prefab.name === nameOrId) return prefab;
  }
  const id = Number(nameOrId);
  return Number.isFinite(id) ? runtime.prefabMap.get(id) ?? null : null;
}

function normalizePosition(position: any): Vec3Tuple | null {
  if (!position) return null;
  if (Array.isArray(position)) return [Number(position[0] ?? 0), Number(position[1] ?? 0), Number(position[2] ?? 0)];
  return [Number(position.x ?? 0), Number(position.y ?? 0), Number(position.z ?? 0)];
}

function applySpawnOptions(entity: Entity, options: any = {}): void {
  if (options.name) entity.name = options.name;
  if (typeof options.disabled === 'boolean') entity.disabled = options.disabled;
  const position = normalizePosition(options.position);
  if (!position) return;

  const transform2D = entity.getComponent(Transform2D);
  if (transform2D) {
    transform2D.x = position[0];
    transform2D.y = position[1];
    return;
  }
  const cartesian = entity.getComponent(CartesianTransform3D);
  if (cartesian) {
    cartesian.setPosition(position[0], position[1], position[2]);
    return;
  }
  const transform3D = entity.getComponent(Transform3D);
  if (transform3D) {
    transform3D.setTranslation(position[0], position[1], position[2]);
  }
}

function addEntityToRuntimeWorld(runtime: PlayerRuntime, entity: Entity, parent?: Entity | null): Entity {
  if (parent) parent.addChild(entity);
  else runtime.world.addEntity(entity);
  return entity;
}

function findSystem(world: World, system: string | (new (...args: any[]) => unknown)): unknown | null {
  if (typeof system !== 'string') return world.getSystem(system as any);
  for (const item of world.systems.values()) {
    if (item.name === system || item.constructor.name === system) return item;
  }
  return world.getSystem(system);
}

function findByComponent(world: World, componentType: string | (new (...args: any[]) => Component)): Entity[] {
  const result: Entity[] = [];
  for (const entity of world.entities.values()) {
    if (typeof componentType === 'string') {
      if (entity.getComponent(componentType)) result.push(entity);
    } else if (entity.getComponent(componentType)) {
      result.push(entity);
    }
  }
  return result;
}

__PHYSICS_API_HELPERS__

function createCanvasApi(runtime: PlayerRuntime): Record<string, unknown> {
  return {
    element: runtime.canvas,
    width: () => runtime.canvas.width,
    height: () => runtime.canvas.height,
    clientWidth: () => runtime.canvas.clientWidth,
    clientHeight: () => runtime.canvas.clientHeight,
  };
}

function createRuntimeApiFactory(runtime: PlayerRuntime) {
  const components = {
__COMPONENT_API_ENTRIES__
  };
  const physics = createPhysicsApi(runtime);
  const canvasApi = createCanvasApi(runtime);
  const worldFacade = {
    createEntity(name = 'Untitled Entity', parent?: Entity | null): Entity {
      return addEntityToRuntimeWorld(runtime, new Entity(name), parent);
    },
    destroy(entityOrId: Entity | number | string): void {
      const entity = entityOrId instanceof Entity ? entityOrId : findEntity(runtime.world, entityOrId);
      if (entity) runtime.world.removeEntity(entity);
    },
    removeEntity(entityOrId: Entity | number | string): void {
      this.destroy(entityOrId);
    },
    find(nameOrId: string | number): Entity | null {
      return findEntity(runtime.world, nameOrId);
    },
    findAll(name?: string): Entity[] {
      const result: Entity[] = [];
      for (const entity of runtime.world.entities.values()) {
        if (name === undefined || entity.name === name) result.push(entity);
      }
      return result;
    },
    findByComponent(componentType: string | (new (...args: any[]) => Component)): Entity[] {
      return findByComponent(runtime.world, componentType);
    },
    findPrefab(nameOrId: string | number): RuntimePrefab | null {
      return findPrefab(runtime, nameOrId);
    },
    spawnPrefab(nameOrId: string | number, options: any = {}): Entity | null {
      const prefab = findPrefab(runtime, nameOrId);
      if (!prefab) return null;
      const entity = deserializeEntity(prefab.root, runtime.geometryMap, runtime.materialMap, runtime.scriptMap);
      applySpawnOptions(entity, options);
      return addEntityToRuntimeWorld(runtime, entity, options.parent ?? null);
    },
    addComponent(entity: Entity, component: Component): Entity {
      entity.addComponent(component);
      return entity;
    },
    addSystem(system: System, renderOptions?: RenderPipelineEntryOptions | false | null): System {
      runtime.world.addSystem(system);
      if (renderOptions !== false && runtime.registerRenderSystem && ('record' in system || 'recordDelta' in system)) {
        runtime.registerRenderSystem(system, renderOptions ?? undefined);
      }
      return system;
    },
    getSystem(system: string | (new (...args: any[]) => unknown)): unknown | null {
      return findSystem(runtime.world, system);
    },
    setText(entityOrId: Entity | number | string, text: string): boolean {
__SET_TEXT_BODY__
    },
  };

  const asset = {
    prefabs: runtime.prefabMap,
    findPrefab: (nameOrId: string | number) => findPrefab(runtime, nameOrId),
  };
  return (baseApi: any): any => {
    return {
      ...baseApi,
      input: KeyboardComponent,
      read: Object.freeze({
        ...baseApi.read,
        find: worldFacade.find,
        findAll: worldFacade.findAll,
        findByComponent: worldFacade.findByComponent,
        getSystem: worldFacade.getSystem,
        components,
        pointer: runtime.pointer.state,
        canvas: canvasApi,
        engine: runtime.engine,
      }),
      scene: Object.freeze({
        createEntity: worldFacade.createEntity,
        destroy: worldFacade.destroy,
        removeEntity: worldFacade.removeEntity,
        spawnPrefab: worldFacade.spawnPrefab,
        addComponent: worldFacade.addComponent,
        addSystem: worldFacade.addSystem,
        setText: worldFacade.setText,
      }),
      asset: Object.freeze(asset),
      physics,
    };
  };
}
`;
