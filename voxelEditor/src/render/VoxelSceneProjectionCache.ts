import { evaluateAnimationInstance } from '../animation';
import type { VoxelSceneProjectionSource } from '../document/VoxelSceneProjectionSource';
import type { StoredVoxelModule } from '../modules/ModuleHierarchyState';
import { transformModuleVoxels } from '../moduleTransform';
import type {
  PackedVoxelKey,
  RenderableVoxel,
  SceneSize,
  VoxelModuleInstance,
} from '../model';

export interface VoxelSceneProjectionSlice {
  readonly keys: ReadonlySet<PackedVoxelKey>;
  readonly voxels: ReadonlyMap<PackedVoxelKey, RenderableVoxel>;
}

interface InstanceProjection {
  signature: string;
  voxels: Map<PackedVoxelKey, RenderableVoxel>;
}

interface ProjectionInput extends VoxelSceneProjectionSource {
  readonly requestedKeys: Iterable<PackedVoxelKey>;
  readonly changedInstanceIds: Iterable<string>;
}

/**
 * Caches every module-instance projection separately. A drag rebuilds only the
 * changed instance and recomposes only coordinates touched before or after the
 * drag, while preserving instance declaration order for overlap resolution.
 */
export class VoxelSceneProjectionCache {
  private readonly _instances = new Map<string, InstanceProjection>();
  private _projectionBuilds = 0;
  private _projectionReuses = 0;
  private _lastRecomposedKeyCount = 0;

  get diagnostics(): Readonly<{
    projectionBuilds: number;
    projectionReuses: number;
    lastRecomposedKeyCount: number;
  }> {
    return Object.freeze({
      projectionBuilds: this._projectionBuilds,
      projectionReuses: this._projectionReuses,
      lastRecomposedKeyCount: this._lastRecomposedKeyCount,
    });
  }

  project(input: ProjectionInput): VoxelSceneProjectionSlice {
    const liveIds = new Set(input.instances.keys());
    for (const id of this._instances.keys()) if (!liveIds.has(id)) this._instances.delete(id);

    const ordered: InstanceProjection[] = [];
    for (const sourceInstance of input.instances.values()) {
      const instance = evaluateAnimationInstance(sourceInstance, input.animation, input.frame);
      const module = input.modules.get(instance.moduleId);
      const visible = module && input.layers.get(instance.layerId)?.visible !== false && instance.visible;
      const signature = projectionSignature(instance, module?.revision ?? -1, Boolean(visible), input.size);
      let projection = this._instances.get(instance.id);
      if (!projection || projection.signature !== signature) {
        projection = {
          signature,
          voxels: visible && module ? projectInstance(input.size, module, instance) : new Map(),
        };
        this._instances.set(instance.id, projection);
        this._projectionBuilds += 1;
      } else {
        this._projectionReuses += 1;
      }
      ordered.push(projection);
    }

    const keys = new Set(input.requestedKeys);
    for (const id of input.changedInstanceIds) {
      for (const key of this._instances.get(id)?.voxels.keys() ?? []) keys.add(key);
    }

    const voxels = new Map<PackedVoxelKey, RenderableVoxel>();
    this._lastRecomposedKeyCount = keys.size;
    for (const key of keys) {
      const base = input.baseVoxels.get(key);
      if (base && input.layers.get(base.layerId ?? 'layer-1')?.visible !== false) {
        voxels.set(key, { ...base, source: 'base' });
      }
      for (const projection of ordered) {
        const voxel = projection.voxels.get(key);
        if (voxel) voxels.set(key, voxel);
      }
    }
    return { keys, voxels };
  }

  clear(): void {
    this._instances.clear();
    this._projectionBuilds = 0;
    this._projectionReuses = 0;
    this._lastRecomposedKeyCount = 0;
  }
}

function projectInstance(
  sceneSize: Readonly<SceneSize>,
  module: Readonly<StoredVoxelModule>,
  instance: Readonly<VoxelModuleInstance>,
): Map<PackedVoxelKey, RenderableVoxel> {
  const result = new Map<PackedVoxelKey, RenderableVoxel>();
  for (const voxel of transformModuleVoxels(module.voxels.values(), instance, module.size)) {
    const x = instance.position.x + voxel.x;
    const y = instance.position.y + voxel.y;
    const z = instance.position.z + voxel.z;
    if (x < 0 || x >= sceneSize.x || y < 0 || y >= sceneSize.y || z < 0 || z >= sceneSize.z) continue;
    result.set(packProjectionKey(x, y, z), {
      x,
      y,
      z,
      color: voxel.color,
      materialId: voxel.materialId,
      source: 'module-instance',
      moduleId: module.id,
      moduleInstanceId: instance.id,
    });
  }
  return result;
}

function packProjectionKey(x: number, y: number, z: number): PackedVoxelKey {
  return (x & 0xff) | ((y & 0xff) << 8) | ((z & 0xff) << 16);
}

function projectionSignature(
  instance: Readonly<VoxelModuleInstance>,
  moduleRevision: number,
  visible: boolean,
  sceneSize: Readonly<SceneSize>,
): string {
  const { position, rotation, scale } = instance;
  return [
    moduleRevision,
    visible ? 1 : 0,
    instance.moduleId,
    instance.layerId,
    position.x, position.y, position.z,
    rotation.x, rotation.y, rotation.z,
    scale.x, scale.y, scale.z,
    sceneSize.x, sceneSize.y, sceneSize.z,
  ].join('|');
}
