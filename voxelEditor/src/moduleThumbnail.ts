import type { Voxel } from './model';

export interface ModuleThumbnailPoint {
  x: number;
  y: number;
  size: number;
  color: string;
}

/** Produces a small deterministic isometric point cloud for module asset cards. */
export function moduleThumbnailPoints(
  source: Iterable<Readonly<Voxel>>,
  width = 64,
  height = 52,
  limit = 96,
): ModuleThumbnailPoint[] {
  const all = Array.from(source);
  if (all.length === 0) return [];
  const stride = Math.max(1, Math.ceil(all.length / Math.max(1, limit)));
  const projected = all
    .filter((_, index) => index % stride === 0)
    .map(voxel => ({
      x: voxel.x - voxel.z,
      y: (voxel.x + voxel.z) * 0.5 - voxel.y,
      depth: voxel.x + voxel.y + voxel.z,
      color: voxel.color,
    }))
    .sort((a, b) => a.depth - b.depth);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of projected) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const padding = 5;
  const spanX = Math.max(1, maxX - minX + 1);
  const spanY = Math.max(1, maxY - minY + 1);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  return projected.map(point => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (point.y - minY) * scale,
    size: Math.max(2.4, Math.min(7, scale * 0.72)),
    color: point.color,
  }));
}
