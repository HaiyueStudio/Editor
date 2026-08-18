import type { SceneSize, VoxelPosition } from './model';

export interface VoxelBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface CameraFrame {
  target: readonly [number, number, number];
  radius: number;
}

export function voxelBounds(voxels: Iterable<Readonly<VoxelPosition>>): VoxelBounds | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const voxel of voxels) {
    minX = Math.min(minX, voxel.x); minY = Math.min(minY, voxel.y); minZ = Math.min(minZ, voxel.z);
    maxX = Math.max(maxX, voxel.x + 1); maxY = Math.max(maxY, voxel.y + 1); maxZ = Math.max(maxZ, voxel.z + 1);
  }
  return minX === Infinity ? null : { minX, minY, minZ, maxX, maxY, maxZ };
}

export function frameVoxelBounds(
  bounds: Readonly<VoxelBounds>,
  size: Readonly<SceneSize>,
  fov: number,
  aspect: number,
  projection: 'perspective' | 'orthographic',
  padding = 1.18,
): CameraFrame {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);
  const halfDiagonal = Math.hypot(width, height, depth) / 2;
  const safeAspect = Math.max(0.01, Number.isFinite(aspect) ? aspect : 1);
  const verticalHalfFov = Math.max(0.01, Math.min(Math.PI / 2 - 0.01, fov / 2));
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * safeAspect);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const fit = projection === 'orthographic'
    ? halfDiagonal / Math.tan(limitingHalfFov)
    : halfDiagonal / Math.sin(limitingHalfFov);
  return {
    target: [
      (bounds.minX + bounds.maxX) / 2 - size.x / 2,
      (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2 - size.z / 2,
    ],
    radius: Math.max(3, fit * Math.max(1, padding)),
  };
}

export function sceneVoxelBounds(size: Readonly<SceneSize>): VoxelBounds {
  return { minX: 0, minY: 0, minZ: 0, maxX: size.x, maxY: size.y, maxZ: size.z };
}
