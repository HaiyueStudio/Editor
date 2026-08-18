import type { RenderableVoxel, SceneSize } from './model';
import type { VoxelRay } from './picking';

export interface VoxelRaycastHit {
  voxel: RenderableVoxel;
  normal: readonly [number, number, number];
}

/** Engine-independent 3D DDA traversal through the document's integer voxel grid. */
export function traceVoxelGrid(
  ray: VoxelRay,
  size: Readonly<SceneSize>,
  getVoxel: (x: number, y: number, z: number) => RenderableVoxel | null,
): VoxelRaycastHit | null {
  const volume = intersectBox(ray, [-size.x / 2, 0, -size.z / 2], [size.x / 2, size.y, size.z / 2]);
  if (!volume) return null;
  const distance = Math.max(0, volume.distance) + 1e-5;
  const point = ray.origin.map((origin, axis) => origin + ray.direction[axis]! * distance) as [number, number, number];
  let x = clampCell(Math.floor(point[0] + size.x / 2), size.x);
  let y = clampCell(Math.floor(point[1]), size.y);
  let z = clampCell(Math.floor(point[2] + size.z / 2), size.z);
  const stepX = Math.sign(ray.direction[0]);
  const stepY = Math.sign(ray.direction[1]);
  const stepZ = Math.sign(ray.direction[2]);
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / ray.direction[0]);
  const deltaY = stepY === 0 ? Infinity : Math.abs(1 / ray.direction[1]);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / ray.direction[2]);
  let maxX = nextBoundaryDistance(ray.origin[0], ray.direction[0], x - size.x / 2, stepX);
  let maxY = nextBoundaryDistance(ray.origin[1], ray.direction[1], y, stepY);
  let maxZ = nextBoundaryDistance(ray.origin[2], ray.direction[2], z - size.z / 2, stepZ);
  let normal: readonly [number, number, number] = volume.distance > 0 ? volume.normal : [0, 0, 0];
  while (x >= 0 && x < size.x && y >= 0 && y < size.y && z >= 0 && z < size.z) {
    const voxel = getVoxel(x, y, z);
    if (voxel) return { voxel, normal };
    if (maxX <= maxY && maxX <= maxZ) {
      if (maxX > volume.farDistance) break;
      x += stepX; maxX += deltaX; normal = [-stepX, 0, 0];
    } else if (maxY <= maxZ) {
      if (maxY > volume.farDistance) break;
      y += stepY; maxY += deltaY; normal = [0, -stepY, 0];
    } else {
      if (maxZ > volume.farDistance) break;
      z += stepZ; maxZ += deltaZ; normal = [0, 0, -stepZ];
    }
  }
  return null;
}

interface BoxHit { distance: number; farDistance: number; normal: readonly [number, number, number] }

function intersectBox(ray: VoxelRay, min: readonly [number, number, number], max: readonly [number, number, number]): BoxHit | null {
  let near = -Infinity;
  let far = Infinity;
  let normal: readonly [number, number, number] = [0, 0, 0];
  for (const axis of [0, 1, 2] as const) {
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];
    if (Math.abs(direction) < 1e-7) {
      if (origin < min[axis] || origin > max[axis]) return null;
      continue;
    }
    let t1 = (min[axis] - origin) / direction;
    let t2 = (max[axis] - origin) / direction;
    let sign = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; sign = 1; }
    if (t1 > near) {
      near = t1;
      normal = axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, sign, 0] : [0, 0, sign];
    }
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  return far < 0 ? null : { distance: near, farDistance: far, normal };
}

function nextBoundaryDistance(origin: number, direction: number, cellMin: number, step: number): number {
  if (step === 0) return Infinity;
  return ((step > 0 ? cellMin + 1 : cellMin) - origin) / direction;
}

function clampCell(value: number, size: number): number { return Math.max(0, Math.min(size - 1, value)); }
