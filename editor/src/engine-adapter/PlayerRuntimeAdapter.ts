// Browser/player engine adapter: DOM canvas and runtime engine objects stay outside domain.
import { AmbientLight, Fog, PointLight } from '@haiyue/engine/lighting';
import { BasicMaterial, Camera2D, Camera3D, CartesianTransform3D, ColorSRGB, Component, DirectionalLight, EnvironmentLight, Entity, Geometry2D, Geometry3D, Material2D, Mesh2D, Mesh3D, PbrMaterial, SphericalTransform3D, System, Transform2D, HaiyueEngine, World } from '@haiyue/engine';
import { BasisTransform3D, DataComponent, InstancedMesh3D, KeyboardComponent, MeshHelper, ScriptComponent, ScriptResource, Transform3D, type ScriptRuntimeApi, type ScriptRuntimeContext, type ScriptRuntimeReadApi, type ScriptRuntimeSceneApi } from '@haiyue/engine/components';
import { BlinnPhongMaterial, CssMaterial, DepthMaterial, InstancedMaterial, Material, NormalMaterial, RadialShadowMaterial } from '@haiyue/engine/material';
import { InputMap } from '@haiyue/engine/input';
import { InstancedMesh3DRenderSystem } from '@haiyue/engine/systems';
import { createRoundedBox3D } from '@haiyue/engine/geometry';
import {
  getSystemRenderPipelineOptions,
  isRenderPipelineSystem,
  type RenderPipelineEntryOptions,
  type RenderPipelineSystem,
  } from './EditorRenderProtocol';
import type { RuntimePrefab } from '../export/runtimeScene';
import type { Vec3Tuple } from '../types';
import { deserializeEntity } from '../domain/scene/deserialization';

// These systems live on the already-deferred player adapter boundary. The
// player entry consumes them only after a scene is loaded so material-specific
// renderers do not become part of the cold player closure.
export { InstancedMesh3DRenderSystem };

export interface PointerRuntimeSnapshot {
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

export class PointerRuntime {
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

export interface PlayerRuntime {
  engine: HaiyueEngine;
  world: World;
  geometryMap: Map<number, Geometry3D>;
  materialMap: Map<number, Material>;
  scriptMap: Map<number, ScriptResource>;
  prefabMap: Map<number, RuntimePrefab>;
  canvas: HTMLCanvasElement;
  pointer: PointerRuntime;
  registerRenderSystem?: (
    system: RenderPipelineSystem & Partial<System>,
    options?: RenderPipelineEntryOptions,
  ) => void;
}

export interface PlayerRuntimeApiCapabilities {
  readonly componentConstructors?: Readonly<Record<string, unknown>>;
  readonly canvasTextComponent?: RuntimeComponentConstructor;
  readonly createPhysicsApi?: (runtime: PlayerRuntime) => Record<string, unknown>;
}

interface SpawnPrefabOptions {
  name?: string;
  parent?: Entity | null;
  position?: Vec3Tuple | [number, number] | { x?: number; y?: number; z?: number };
  disabled?: boolean;
}

function findEntity(world: World, nameOrId: string | number): Entity | null {
  if (typeof nameOrId === 'number') return world.getEntity(nameOrId);
  for (const entity of world.entities.values()) {
    if (entity.name === nameOrId) return entity;
  }
  return world.getEntity(nameOrId);
}

function findEntities(world: World, name?: string): Entity[] {
  const result: Entity[] = [];
  for (const entity of world.entities.values()) {
    if (name === undefined || entity.name === name) result.push(entity);
  }
  return result;
}

function findPrefab(runtime: PlayerRuntime, nameOrId: string | number): RuntimePrefab | null {
  if (typeof nameOrId === 'number') return runtime.prefabMap.get(nameOrId) ?? null;
  for (const prefab of runtime.prefabMap.values()) {
    if (prefab.name === nameOrId) return prefab;
  }
  const id = Number(nameOrId);
  return Number.isFinite(id) ? runtime.prefabMap.get(id) ?? null : null;
}

function normalizePosition(position: SpawnPrefabOptions['position']): Vec3Tuple | null {
  if (!position) return null;
  if (Array.isArray(position)) {
    return [Number(position[0] ?? 0), Number(position[1] ?? 0), Number(position[2] ?? 0)];
  }
  return [
    Number(position.x ?? 0),
    Number(position.y ?? 0),
    Number(position.z ?? 0),
  ];
}

function applySpawnOptions(entity: Entity, options: SpawnPrefabOptions = {}): void {
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
  if (parent) {
    parent.addChild(entity);
  } else {
    runtime.world.addEntity(entity);
  }
  return entity;
}

type RuntimeSystemConstructor = new (...args: never[]) => System;
type RuntimeComponentConstructor = new (...args: never[]) => Component;

function findSystem(world: World, system: string | RuntimeSystemConstructor): System | null {
  if (typeof system !== 'string') return world.getSystem(system);
  for (const item of world.systems.values()) {
    if (item.name === system || item.constructor.name === system) return item;
  }
  return world.getSystem(system);
}

function findByComponent(world: World, componentType: string | RuntimeComponentConstructor): Entity[] {
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

function addSystemToRuntimeWorld(
  runtime: PlayerRuntime,
  system: System,
  renderOptions?: RenderPipelineEntryOptions | false | null,
): System {
  runtime.world.addSystem(system);
  if (renderOptions !== false && runtime.registerRenderSystem && isRenderPipelineSystem(system)) {
    runtime.registerRenderSystem(system, renderOptions ?? getSystemRenderPipelineOptions(system));
  }
  return system;
}

function createCanvasApi(runtime: PlayerRuntime): Record<string, unknown> {
  return {
    element: runtime.canvas,
    width: () => runtime.canvas.width,
    height: () => runtime.canvas.height,
    clientWidth: () => runtime.canvas.clientWidth,
    clientHeight: () => runtime.canvas.clientHeight,
  };
}

function getRuntimeComponents(
  capabilities: PlayerRuntimeApiCapabilities,
): Record<string, unknown> {
  return {
    AmbientLight,
    BasicMaterial,
    BasisTransform3D,
    BlinnPhongMaterial,
    Camera2D,
    Camera3D,
    CartesianTransform3D,
    ColorSRGB,
    CssMaterial,
    DataComponent,
    DepthMaterial,
    DirectionalLight,
    EnvironmentLight,
    Fog,
    Entity,
    Geometry2D,
    Geometry3D,
    InputMap,
    InstancedMaterial,
    InstancedMesh3D,
    InstancedMesh3DRenderSystem,
    KeyboardComponent,
    Material2D,
    Mesh2D,
    Mesh3D,
    MeshHelper,
    NormalMaterial,
    PointLight,
    PbrMaterial,
    RadialShadowMaterial,
    ScriptComponent,
    SphericalTransform3D,
    Transform2D,
    Transform3D,
    createRoundedBox3D,
    ...(capabilities.componentConstructors ?? {}),
  };
}

type RuntimeScriptFacade = Pick<ScriptRuntimeReadApi, 'find' | 'findAll' | 'findByComponent' | 'getSystem'>
  & ScriptRuntimeSceneApi
  & { findPrefab(nameOrId: string | number): RuntimePrefab | null };

function createWorldFacade(
  runtime: PlayerRuntime,
  capabilities: PlayerRuntimeApiCapabilities,
): RuntimeScriptFacade {
  const facade: RuntimeScriptFacade = {
    createEntity(name = 'Untitled Entity', parent?: Entity | null): Entity {
      const entity = new Entity(name);
      return addEntityToRuntimeWorld(runtime, entity, parent);
    },
    destroy(entityOrId: Entity | number | string): void {
      const entity = entityOrId instanceof Entity ? entityOrId : findEntity(runtime.world, entityOrId);
      if (entity) runtime.world.removeEntity(entity);
    },
    removeEntity(entityOrId: Entity | number | string): void {
      facade.destroy(entityOrId);
    },
    find(nameOrId: string | number): Entity | null {
      return findEntity(runtime.world, nameOrId);
    },
    findAll(name?: string): Entity[] {
      return findEntities(runtime.world, name);
    },
    findByComponent(componentType: string | RuntimeComponentConstructor): Entity[] {
      return findByComponent(runtime.world, componentType);
    },
    findPrefab(nameOrId: string | number): RuntimePrefab | null {
      return findPrefab(runtime, nameOrId);
    },
    spawnPrefab(nameOrId: string | number, options: SpawnPrefabOptions = {}): Entity | null {
      const prefab = findPrefab(runtime, nameOrId);
      if (!prefab) return null;
      const entity = deserializeEntity(prefab.root, runtime.geometryMap, runtime.materialMap, runtime.scriptMap, { deserializePrefabInstances: false });
      applySpawnOptions(entity, options);
      return addEntityToRuntimeWorld(runtime, entity, options.parent ?? null);
    },
    addComponent(entity: Entity, component: Component): Entity {
      entity.addComponent(component);
      return entity;
    },
    addSystem(system: System, renderOptions?: RenderPipelineEntryOptions | false | null): System {
      return addSystemToRuntimeWorld(runtime, system, renderOptions);
    },
    getSystem(system: string | RuntimeSystemConstructor): System | null {
      return findSystem(runtime.world, system);
    },
    setText(entityOrId: Entity | number | string, text: string): boolean {
      const entity = entityOrId instanceof Entity ? entityOrId : findEntity(runtime.world, entityOrId);
      if (!entity) return false;
      const canvasTextType = capabilities.canvasTextComponent;
      const canvasText = canvasTextType
        ? entity.getComponent(canvasTextType) as (Component & { text: string }) | null
        : null;
      if (!canvasText) return false;
      canvasText.text = text;
      return true;
    },
  };
  return facade;
}

export function createRuntimeApiFactory(
  runtime: PlayerRuntime,
  capabilities: PlayerRuntimeApiCapabilities = {},
) {
  const components = getRuntimeComponents(capabilities);
  const worldFacade = createWorldFacade(runtime, capabilities);
  const physics = capabilities.createPhysicsApi?.(runtime) ?? Object.freeze({
    getSystem: () => null,
    body: () => null,
  });
  const canvasApi = createCanvasApi(runtime);
  const asset = {
    findPrefab: (nameOrId: string | number) => findPrefab(runtime, nameOrId),
    prefabs: runtime.prefabMap,
  };
  return (baseApi: ScriptRuntimeApi, _context: ScriptRuntimeContext): ScriptRuntimeApi => {
    return {
      ...baseApi,
      input: KeyboardComponent,
      read: Object.freeze({
        ...baseApi.read!,
        find: worldFacade.find,
        findAll: worldFacade.findAll,
        findByComponent: worldFacade.findByComponent,
        getSystem: worldFacade.getSystem,
        components,
        pointer: { ...runtime.pointer.state },
        canvas: canvasApi,
        engine: runtime.engine as unknown as Readonly<Record<string, unknown>>,
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
