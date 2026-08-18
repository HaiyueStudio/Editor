import { Camera3D, Entity, type HaiyueEngine, type World } from '@haiyue/engine';
import { Physics2DSystem } from '@haiyue/engine/physics';
import { RadialShadowRenderFeature } from '@haiyue/engine/systems';
import type {
  RenderPipelineEntryOptions,
  RenderPipelineSystem,
} from '../../engine-adapter/EditorRenderProtocol';
import type { SerializedSystem } from '../../export/runtimeScene';

export interface ConfiguredEditorSystemInstallOptions {
  registerRenderSystem?: (
    system: RenderPipelineSystem,
    options?: RenderPipelineEntryOptions,
  ) => void;
}

export function installConfiguredEditorSystems(
  world: World,
  engine: HaiyueEngine,
  fallbackCameraEntity: Entity,
  configs: readonly SerializedSystem[],
  options: ConfiguredEditorSystemInstallOptions = {},
): void {
  destroySystems(world, Physics2DSystem);
  destroySystems(world, RadialShadowRenderFeature);
  const cameraEntity = findPrimaryCamera3DEntity(world) ?? fallbackCameraEntity;
  for (const config of configs) {
    if (config.disabled) continue;
    if (config.type === 'Physics2DSystem') {
      world.addSystem(new Physics2DSystem({
        gravity: config.gravity,
        pixelsPerMeter: config.pixelsPerMeter,
        fixedTimeStep: config.fixedTimeStep,
        maxSubSteps: config.maxSubSteps,
        velocityIterations: config.velocityIterations,
        positionIterations: config.positionIterations,
        syncStaticBodiesFromTransform: config.syncStaticBodiesFromTransform,
        priority: config.priority,
      }));
    } else {
      const system = new RadialShadowRenderFeature(engine, cameraEntity, {
        loadOp: config.loadOp,
        priority: config.priority,
      });
      if (options.registerRenderSystem) {
        system.autoUpdate = false;
        options.registerRenderSystem(system);
      }
      world.addSystem(system);
    }
  }
}

function findPrimaryCamera3DEntity(world: World): Entity | null {
  for (const entity of world.entities.values()) {
    if (!entity.disabled && entity.getComponent(Camera3D)) return entity;
  }
  return null;
}

function destroySystems(
  world: World,
  type: typeof Physics2DSystem | typeof RadialShadowRenderFeature,
): void {
  let system = world.getSystem(type);
  while (system) {
    system.destroy();
    system = world.getSystem(type);
  }
}
