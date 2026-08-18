import type { SceneSize, VoxelPosition } from './model';
import type { GridPlaneNormal, VoxelRay } from './picking';

export type SliceAxis = 'x' | 'y' | 'z';
export type SliceDisplayMode = 'all' | 'single' | 'context';
export type SliceVisibility = 'active' | 'context' | 'hidden';

export interface ViewportSliceState {
  axis: SliceAxis;
  index: number;
  mode: SliceDisplayMode;
  workPlaneEnabled: boolean;
}

const EDGE_EPSILON = 1e-5;

export function sliceAxisLength(size: Readonly<SceneSize>, axis: SliceAxis): number {
  return size[axis];
}

export function clampSliceIndex(size: Readonly<SceneSize>, axis: SliceAxis, index: number): number {
  return Math.max(0, Math.min(sliceAxisLength(size, axis) - 1, Math.round(Number.isFinite(index) ? index : 0)));
}

export function voxelSliceVisibility(
  voxel: Readonly<VoxelPosition>,
  state: Readonly<ViewportSliceState>,
): SliceVisibility {
  if (state.mode === 'all') return 'active';
  if (voxel[state.axis] === state.index) return 'active';
  return state.mode === 'context' ? 'context' : 'hidden';
}

export function slicePlaneNormal(axis: SliceAxis): GridPlaneNormal {
  return axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
}

/** Intersects the movable work plane at the lower face of the selected voxel layer. */
export function pickWorkPlaneCell(
  ray: Readonly<VoxelRay>,
  size: Readonly<SceneSize>,
  axis: SliceAxis,
  index: number,
): VoxelPosition | null {
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const direction = ray.direction[axisIndex];
  if (Math.abs(direction) < 1e-7) return null;
  const coordinate = axis === 'x' ? index - size.x / 2 : axis === 'y' ? index : index - size.z / 2;
  const distance = (coordinate - ray.origin[axisIndex]) / direction;
  if (distance <= 0) return null;

  const worldX = ray.origin[0] + ray.direction[0] * distance;
  const worldY = ray.origin[1] + ray.direction[1] * distance;
  const worldZ = ray.origin[2] + ray.direction[2] * distance;
  const gridX = worldX + size.x / 2;
  const gridZ = worldZ + size.z / 2;
  if (gridX < -EDGE_EPSILON || gridX > size.x + EDGE_EPSILON
    || worldY < -EDGE_EPSILON || worldY > size.y + EDGE_EPSILON
    || gridZ < -EDGE_EPSILON || gridZ > size.z + EDGE_EPSILON) return null;

  return {
    x: axis === 'x' ? clampSliceIndex(size, axis, index) : boundedCell(gridX, size.x),
    y: axis === 'y' ? clampSliceIndex(size, axis, index) : boundedCell(worldY, size.y),
    z: axis === 'z' ? clampSliceIndex(size, axis, index) : boundedCell(gridZ, size.z),
  };
}

function boundedCell(value: number, length: number): number {
  return Math.max(0, Math.min(length - 1, Math.floor(value)));
}
