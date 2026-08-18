import type { StoredVoxelModule } from '../modules/ModuleHierarchyState';
import type {
  PackedVoxelKey,
  SceneSize,
  Voxel,
  VoxelAnimationClip,
  VoxelLayer,
  VoxelModuleInstance,
} from '../model';

/**
 * Read-only document port consumed by projection caches. It exposes domain
 * collections without giving the document ownership of renderer lifecycle.
 */
export interface VoxelSceneProjectionSource {
  readonly size: Readonly<SceneSize>;
  readonly baseVoxels: ReadonlyMap<PackedVoxelKey, Voxel>;
  readonly modules: ReadonlyMap<string, StoredVoxelModule>;
  readonly instances: ReadonlyMap<string, VoxelModuleInstance>;
  readonly layers: ReadonlyMap<string, VoxelLayer>;
  readonly animation: Readonly<VoxelAnimationClip> | null;
  readonly frame: number;
}
