import type { SceneSize } from './model';

export interface VoxelRay {
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
}

export interface GridCell {
  x: number;
  y: number;
  z: number;
}

export type GridPlaneNormal = readonly [number, number, number];

const EDGE_EPSILON = 1e-5;

/** Intersects the editable ground plane and converts the hit into a bounded grid cell. */
export function pickGroundCell(ray: VoxelRay, size: Readonly<SceneSize>): GridCell | null {
  if (Math.abs(ray.direction[1]) < 1e-7) return null;
  const distance = -ray.origin[1] / ray.direction[1];
  if (distance <= 0) return null;
  const worldX = ray.origin[0] + ray.direction[0] * distance;
  const worldZ = ray.origin[2] + ray.direction[2] * distance;
  const gridX = worldX + size.x / 2;
  const gridZ = worldZ + size.z / 2;
  if (gridX < -EDGE_EPSILON || gridX > size.x + EDGE_EPSILON
    || gridZ < -EDGE_EPSILON || gridZ > size.z + EDGE_EPSILON) return null;
  return {
    x: Math.max(0, Math.min(size.x - 1, Math.floor(gridX))),
    y: 0,
    z: Math.max(0, Math.min(size.z - 1, Math.floor(gridZ))),
  };
}

/** Intersects a ray with the axis-aligned plane through an anchor cell's center. */
export function pickGridPlaneCell(
  ray: Readonly<VoxelRay>,
  size: Readonly<SceneSize>,
  anchor: Readonly<GridCell>,
  normal: GridPlaneNormal,
  surfaceOffset = 0,
): GridCell | null {
  const axis = dominantAxis(normal);
  const centerCoordinate = axis === 0
    ? anchor.x - size.x / 2 + 0.5
    : axis === 1
      ? anchor.y + 0.5
      : anchor.z - size.z / 2 + 0.5;
  const planeCoordinate = centerCoordinate + Math.sign(normal[axis]) * surfaceOffset;
  const direction = ray.direction[axis];
  if (Math.abs(direction) < 1e-7) return null;
  const distance = (planeCoordinate - ray.origin[axis]) / direction;
  if (distance <= 0) return null;
  const worldX = ray.origin[0] + ray.direction[0] * distance;
  const worldY = ray.origin[1] + ray.direction[1] * distance;
  const worldZ = ray.origin[2] + ray.direction[2] * distance;
  const cell = {
    x: axis === 0 ? anchor.x : Math.floor(worldX + size.x / 2),
    y: axis === 1 ? anchor.y : Math.floor(worldY),
    z: axis === 2 ? anchor.z : Math.floor(worldZ + size.z / 2),
  };
  return cell.x >= 0 && cell.x < size.x
    && cell.y >= 0 && cell.y < size.y
    && cell.z >= 0 && cell.z < size.z
    ? cell
    : null;
}

function dominantAxis(normal: GridPlaneNormal): 0 | 1 | 2 {
  const x = Math.abs(normal[0]);
  const y = Math.abs(normal[1]);
  const z = Math.abs(normal[2]);
  if (y >= x && y >= z) return 1;
  return x >= z ? 0 : 2;
}
