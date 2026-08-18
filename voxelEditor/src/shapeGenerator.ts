import type { SceneSize, VoxelPosition } from './model';

export type VoxelShapeKind =
  | 'box'
  | 'box-shell'
  | 'disk'
  | 'ring'
  | 'sphere'
  | 'sphere-shell'
  | 'cylinder';

export interface VoxelBounds {
  min: VoxelPosition;
  max: VoxelPosition;
}

interface NormalizedBounds {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  radius: [number, number, number];
}

export function* generateShapeVoxels(
  kind: VoxelShapeKind,
  bounds: Readonly<VoxelBounds>,
  sceneSize: Readonly<SceneSize>,
): Generator<VoxelPosition> {
  const normalized = normalizeBounds(bounds, sceneSize);
  if (!normalized) return;
  const [minX, minY, minZ] = normalized.min;
  const [maxX, maxY, maxZ] = normalized.max;

  if (kind === 'disk' || kind === 'ring') {
    const y = Math.round(normalized.center[1]);
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!insideEllipse(x, z, normalized)) continue;
        if (kind === 'ring' && isEllipseInterior(x, z, normalized)) continue;
        yield { x, y, z };
      }
    }
    return;
  }

  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (kind === 'box') {
          yield { x, y, z };
          continue;
        }
        if (kind === 'box-shell') {
          if (x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ) yield { x, y, z };
          continue;
        }
        if (kind === 'cylinder') {
          if (insideEllipse(x, z, normalized)) yield { x, y, z };
          continue;
        }
        if (!insideEllipsoid(x, y, z, normalized)) continue;
        if (kind === 'sphere-shell' && isEllipsoidInterior(x, y, z, normalized)) continue;
        yield { x, y, z };
      }
    }
  }
}

function normalizeBounds(bounds: Readonly<VoxelBounds>, sceneSize: Readonly<SceneSize>): NormalizedBounds | null {
  const rawMin: [number, number, number] = [bounds.min.x, bounds.min.y, bounds.min.z];
  const rawMax: [number, number, number] = [bounds.max.x, bounds.max.y, bounds.max.z];
  const dimensions: [number, number, number] = [sceneSize.x, sceneSize.y, sceneSize.z];
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [0, 0, 0];
  for (const axis of [0, 1, 2] as const) {
    const a = rawMin[axis];
    const b = rawMax[axis];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('包围盒坐标必须是有效数字。');
    min[axis] = Math.max(0, Math.round(Math.min(a, b)));
    max[axis] = Math.min((dimensions[axis] ?? 1) - 1, Math.round(Math.max(a, b)));
    if (min[axis] > max[axis]) return null;
  }
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const radius: [number, number, number] = [
    (max[0] - min[0] + 1) / 2,
    (max[1] - min[1] + 1) / 2,
    (max[2] - min[2] + 1) / 2,
  ];
  return { min, max, center, radius };
}

function insideEllipse(x: number, z: number, bounds: NormalizedBounds): boolean {
  const dx = (x - bounds.center[0]) / bounds.radius[0];
  const dz = (z - bounds.center[2]) / bounds.radius[2];
  return dx * dx + dz * dz <= 1 + Number.EPSILON;
}

function isEllipseInterior(x: number, z: number, bounds: NormalizedBounds): boolean {
  return insideEllipse(x - 1, z, bounds)
    && insideEllipse(x + 1, z, bounds)
    && insideEllipse(x, z - 1, bounds)
    && insideEllipse(x, z + 1, bounds);
}

function insideEllipsoid(x: number, y: number, z: number, bounds: NormalizedBounds): boolean {
  const dx = (x - bounds.center[0]) / bounds.radius[0];
  const dy = (y - bounds.center[1]) / bounds.radius[1];
  const dz = (z - bounds.center[2]) / bounds.radius[2];
  return dx * dx + dy * dy + dz * dz <= 1 + Number.EPSILON;
}

function isEllipsoidInterior(x: number, y: number, z: number, bounds: NormalizedBounds): boolean {
  return insideEllipsoid(x - 1, y, z, bounds)
    && insideEllipsoid(x + 1, y, z, bounds)
    && insideEllipsoid(x, y - 1, z, bounds)
    && insideEllipsoid(x, y + 1, z, bounds)
    && insideEllipsoid(x, y, z - 1, bounds)
    && insideEllipsoid(x, y, z + 1, bounds);
}
