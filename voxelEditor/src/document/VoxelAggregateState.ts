import {
  DEFAULT_SCENE_BACKGROUND_COLOR,
  type PackedVoxelKey,
  type SceneSize,
  type Voxel,
} from './VoxelDocumentContract';

/**
 * Mutable storage owned by the voxel document aggregate.
 *
 * The public VoxelDocument remains the compatibility facade; keeping the raw
 * voxel collection and scene bounds here prevents UI/controller lifecycles
 * from leaking into the persisted document state.
 */
export class VoxelAggregateState {
  readonly voxels = new Map<PackedVoxelKey, Voxel>();
  size: SceneSize = { x: 1, y: 1, z: 1 };
  backgroundColor = DEFAULT_SCENE_BACKGROUND_COLOR;
}
