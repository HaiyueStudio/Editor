import type { Component, Entity, HaiyueEngine, System, World } from '@haiyue/engine';
import type { ComponentDeserializationExtension } from '../types';
import type { PlayerRuntimeApiCapabilities } from '../engine-adapter/PlayerRuntimeAdapter';
import type {
  SerializedComponent,
  SerializedEditorScene,
  SerializedPhysics2DSystem,
} from '../export/RuntimeSceneContract';
import type {
  RenderPipelineEntryOptions,
  RenderPipelineSystem,
} from '../engine-adapter/EditorRenderProtocol';

type AddRenderSystem = (
  system: System & RenderPipelineSystem,
  options?: RenderPipelineEntryOptions,
) => void;

export interface PlayerOptionalRuntime {
  readonly componentExtensions: readonly ComponentDeserializationExtension[];
  readonly runtimeApiCapabilities: PlayerRuntimeApiCapabilities;
  installConfiguredPhysics(world: World, config: SerializedPhysics2DSystem): void;
  installSceneSystems(options: {
    world: World;
    engine: HaiyueEngine;
    camera2DEntity: Entity | null;
    addRenderSystem: AddRenderSystem;
  }): void;
}

/** Loads only the optional runtimes referenced by the serialized scene. */
export async function loadPlayerOptionalRuntime(
  scene: SerializedEditorScene,
): Promise<PlayerOptionalRuntime> {
  const componentTypes = collectComponentTypes(scene);
  const needsPhysicsSystem = (scene.systems ?? []).some(
    system => !system.disabled && system.type === 'Physics2DSystem',
  );
  const needsPhysicsSync = componentTypes.has('Physics2DTo3DTransformSync');
  // Scripts can construct component classes dynamically, so script-bearing
  // scenes retain the complete historical runtime palette. Data-only scenes
  // use exact component/system discovery and keep the cold path minimal.
  const hasScripts = (scene.resources.scripts?.length ?? 0) > 0;
  const needsPhysicsApi = needsPhysicsSystem
    || needsPhysicsSync
    || hasScripts;
  const needsGltf = needsComponentRuntime(componentTypes, hasScripts, 'GltfModelComponent');
  const needsCanvasText = needsComponentRuntime(componentTypes, hasScripts, 'CanvasTextComponent');
  const needsGrid = needsComponentRuntime(componentTypes, hasScripts, 'Grid2DComponent');
  const needsSpine = needsComponentRuntime(componentTypes, hasScripts, 'Spine2DComponent');
  const needsTilemap = needsComponentRuntime(componentTypes, hasScripts, 'Tilemap2DComponent');
  const needsTween = needsComponentRuntime(componentTypes, hasScripts, 'Tween2DComponent');

  const [
    physics,
    physicsComponents,
    physicsSyncSystems,
    physicsApi,
    gltf,
    gltfExtensions,
    canvasText,
    grid,
    spine,
    tilemap,
    tween,
  ] = await Promise.all([
    needsPhysicsApi ? import('@haiyue/engine/physics') : null,
    needsPhysicsSync ? import('@haiyue/engine/physics/components') : null,
    needsPhysicsSync ? import('@haiyue/engine/systems') : null,
    needsPhysicsApi ? import('./PlayerPhysicsRuntimeApi') : null,
    needsGltf ? import('@haiyue/extensions/gltf') : null,
    needsGltf ? import('./playerComponentExtensions') : null,
    needsCanvasText ? import('@haiyue/extensions/canvas-text') : null,
    needsGrid ? import('@haiyue/extensions/grid') : null,
    needsSpine ? import('@haiyue/extensions/spine') : null,
    needsTilemap ? import('@haiyue/extensions/tilemap') : null,
    needsTween ? import('@haiyue/extensions/tween') : null,
  ]);

  const runtime: PlayerOptionalRuntime = {
    componentExtensions: Object.freeze([
      ...(gltfExtensions?.playerComponentExtensions ?? []),
      ...(canvasText ? [createOptionalComponentExtension('CanvasTextComponent', canvasText.CanvasTextComponent)] : []),
      ...(grid ? [createOptionalComponentExtension('Grid2DComponent', grid.Grid2DComponent)] : []),
      ...(spine ? [createOptionalComponentExtension('Spine2DComponent', spine.Spine2DComponent)] : []),
      ...(tilemap ? [createOptionalComponentExtension('Tilemap2DComponent', tilemap.Tilemap2DComponent)] : []),
      ...(tween ? [createOptionalComponentExtension('Tween2DComponent', tween.Tween2DComponent)] : []),
    ]),
    runtimeApiCapabilities: Object.freeze({
      componentConstructors: Object.freeze({
        ...(physicsApi?.physicsRuntimeComponents ?? {}),
        ...(gltf ? { GltfModelComponent: gltf.GltfModelComponent } : {}),
        ...(canvasText ? { CanvasTextComponent: canvasText.CanvasTextComponent } : {}),
        ...(grid ? { Grid2DComponent: grid.Grid2DComponent } : {}),
        ...(spine ? { Spine2DComponent: spine.Spine2DComponent } : {}),
        ...(tilemap ? { Tilemap2DComponent: tilemap.Tilemap2DComponent } : {}),
        ...(tween ? { Tween2DComponent: tween.Tween2DComponent } : {}),
      }),
      ...(canvasText ? { canvasTextComponent: canvasText.CanvasTextComponent } : {}),
      ...(physicsApi ? { createPhysicsApi: physicsApi.createPlayerPhysicsApi } : {}),
    }),
    installConfiguredPhysics(world, config) {
      if (!physics) {
        throw new Error('Physics2DSystem runtime was not loaded for a configured physics scene.');
      }
      world.addSystem(new physics.Physics2DSystem({
        gravity: config.gravity,
        pixelsPerMeter: config.pixelsPerMeter,
        fixedTimeStep: config.fixedTimeStep,
        maxSubSteps: config.maxSubSteps,
        velocityIterations: config.velocityIterations,
        positionIterations: config.positionIterations,
        syncStaticBodiesFromTransform: config.syncStaticBodiesFromTransform,
        priority: config.priority,
      }));
    },
    installSceneSystems({ world, engine, camera2DEntity, addRenderSystem }) {
      if (needsPhysicsSync) {
        const syncComponent = physicsComponents?.Physics2DTo3DTransformSync;
        const syncSystem = physicsSyncSystems?.Physics2DTo3DTransformSyncSystem;
        if (!syncComponent || !syncSystem) {
          throw new Error('Physics2D-to-3D synchronization runtime is unavailable.');
        }
        if (!world.getSystem(syncSystem)) {
          world.addSystem(new syncSystem({ priority: 0.5 }));
        }
      }
      if (gltf) world.addSystem(new gltf.GltfModelSystem({ priority: 0 }));
      if (!camera2DEntity) return;
      if (tween) world.addSystem(new tween.Tween2DSystem({ priority: 1 }));
      if (tilemap) {
        addRenderSystem(
          new tilemap.Tilemap2DRenderSystem(engine, camera2DEntity, { loadOp: 'load', priority: 2 }),
          { pass: 'shared', loadOp: 'load' },
        );
      }
      if (spine) {
        addRenderSystem(
          new spine.Spine2DRenderSystem(engine, camera2DEntity, { loadOp: 'load', priority: 3 }),
          { pass: 'shared', loadOp: 'load' },
        );
      }
      if (canvasText) {
        addRenderSystem(
          new canvasText.CanvasText2DRenderSystem(engine, camera2DEntity, { loadOp: 'load', priority: 4 }),
          { pass: 'shared', loadOp: 'load' },
        );
      }
    },
  };
  return Object.freeze(runtime);
}

type OptionalComponentConstructor = new (options?: never) => Component;

function createOptionalComponentExtension(
  type: string,
  ComponentType: OptionalComponentConstructor,
): ComponentDeserializationExtension {
  return Object.freeze({
    deserializeComponent(data: SerializedComponent) {
      return data.type === type ? new ComponentType(data as never) : null;
    },
  });
}

function needsComponentRuntime(
  componentTypes: ReadonlySet<string>,
  hasScripts: boolean,
  componentType: string,
): boolean {
  return hasScripts || componentTypes.has(componentType);
}

function collectComponentTypes(scene: SerializedEditorScene): Set<string> {
  const types = new Set<string>();
  const stack = [
    ...scene.entities,
    ...(scene.resources.prefabs ?? []).map(prefab => prefab.root),
  ];
  while (stack.length > 0) {
    const entity = stack.pop();
    if (!entity) continue;
    for (const component of entity.components) types.add(component.type);
    stack.push(...entity.children);
  }
  return types;
}
