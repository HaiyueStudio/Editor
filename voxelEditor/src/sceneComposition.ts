import { evaluateAnimationInstance } from './animation';
import { transformModuleVoxels } from './moduleTransform';
import type {
  RenderableVoxel,
  SceneSize,
  Voxel,
  VoxelAnimationClip,
  VoxelLayer,
  VoxelModuleInstance,
  PackedVoxelKey,
} from './model';

const DEFAULT_SCENE_LAYER_ID = 'layer-1';

export interface ComposableVoxelModule {
  id: string;
  size: SceneSize;
  voxels: ReadonlyMap<PackedVoxelKey, Voxel>;
}

export interface SceneCompositionInput {
  size: Readonly<SceneSize>;
  voxels: ReadonlyMap<PackedVoxelKey, Voxel>;
  modules: ReadonlyMap<string, ComposableVoxelModule>;
  instances: Iterable<Readonly<VoxelModuleInstance>>;
  layers: ReadonlyMap<string, Readonly<VoxelLayer>>;
  animation: Readonly<VoxelAnimationClip> | null;
  frame: number;
  collisions?: Map<string, Set<string>>;
}

/** Pure scene projection. Module instances win over base voxels and earlier instances. */
export function composeSceneVoxels(input: SceneCompositionInput): Map<PackedVoxelKey, RenderableVoxel> {
  const result = new Map<PackedVoxelKey, RenderableVoxel>();
  for (const voxel of input.voxels.values()) {
    const layerId = voxel.layerId ?? DEFAULT_SCENE_LAYER_ID;
    if (input.layers.get(layerId)?.visible === false) continue;
    result.set(packSceneKey(voxel.x, voxel.y, voxel.z), { ...voxel, source: 'base' });
  }
  for (const sourceInstance of input.instances) {
    const instance = evaluateAnimationInstance(sourceInstance, input.animation, input.frame);
    const module = input.modules.get(instance.moduleId);
    if (!module || input.layers.get(instance.layerId)?.visible === false || !instance.visible) continue;
    for (const voxel of transformModuleVoxels(module.voxels.values(), instance, module.size)) {
      const x = instance.position.x + voxel.x;
      const y = instance.position.y + voxel.y;
      const z = instance.position.z + voxel.z;
      if (x < 0 || x >= input.size.x || y < 0 || y >= input.size.y || z < 0 || z >= input.size.z) continue;
      const packedKey = packSceneKey(x, y, z);
      const key = `${x},${y},${z}`;
      const previous = result.get(packedKey);
      if (previous) {
        addCollision(input.collisions, instance.id, key);
        if (previous.moduleInstanceId) addCollision(input.collisions, previous.moduleInstanceId, key);
      }
      result.set(packedKey, {
        x, y, z, color: voxel.color, materialId: voxel.materialId,
        source: 'module-instance', moduleId: module.id, moduleInstanceId: instance.id,
      });
    }
  }
  return result;
}

function packSceneKey(x: number, y: number, z: number): PackedVoxelKey {
  return (x & 0xff) | ((y & 0xff) << 8) | ((z & 0xff) << 16);
}

function addCollision(collisions: Map<string, Set<string>> | undefined, instanceId: string, key: string): void {
  if (!collisions) return;
  let coordinates = collisions.get(instanceId);
  if (!coordinates) {
    coordinates = new Set();
    collisions.set(instanceId, coordinates);
  }
  coordinates.add(key);
}
