import type {
  PackedVoxelKey,
  SceneSize,
  Voxel,
  VoxelLayer,
  VoxelModuleInstance,
} from '../model';

export interface StoredVoxelModule {
  id: string;
  name: string;
  size: SceneSize;
  voxels: Map<PackedVoxelKey, Voxel>;
  revision: number;
}

/** Module definitions, instances and their layer hierarchy. */
export class ModuleHierarchyState {
  readonly modules = new Map<string, StoredVoxelModule>();
  readonly instances = new Map<string, VoxelModuleInstance>();
  readonly layers = new Map<string, VoxelLayer>();
  editingModuleId: string | null = null;
  activeVoxelLayerId = 'layer-1';
  nextModuleId = 1;
  nextModuleRevision = 1;
  nextModuleInstanceId = 1;
  nextLayerId = 2;
}
