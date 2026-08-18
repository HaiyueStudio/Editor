export interface OrthographicBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CameraRayData {
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
}

/** Matches the visible size at the orbit target when switching from perspective. */
export function orthographicBounds(radius: number, fov: number, aspect: number): OrthographicBounds {
  const safeRadius = Math.max(0.001, finiteOr(radius, 1));
  const safeFov = Math.min(Math.PI - 0.001, Math.max(0.001, finiteOr(fov, Math.PI / 4)));
  const safeAspect = Math.max(0.001, finiteOr(aspect, 1));
  const halfHeight = safeRadius * Math.tan(safeFov / 2);
  const halfWidth = halfHeight * safeAspect;
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight };
}

/** Builds a parallel picking ray by unprojecting the pointer on the near and far planes. */
export function orthographicCameraRay(
  ndcX: number,
  ndcY: number,
  inverseViewProjection: ArrayLike<number>,
  reverseZ = false,
): CameraRayData {
  if (inverseViewProjection.length < 16) throw new Error('逆视图投影矩阵至少需要 16 个数值。');
  const near = unproject(ndcX, ndcY, reverseZ ? 1 : 0, inverseViewProjection);
  const far = unproject(ndcX, ndcY, reverseZ ? 0 : 1, inverseViewProjection);
  const dx = far[0] - near[0];
  const dy = far[1] - near[1];
  const dz = far[2] - near[2];
  const length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length < 1e-7) throw new Error('无法从正交投影矩阵生成拾取射线。');
  return {
    origin: near,
    direction: [dx / length, dy / length, dz / length],
  };
}

function unproject(
  x: number,
  y: number,
  z: number,
  matrix: ArrayLike<number>,
): readonly [number, number, number] {
  const tx = valueAt(matrix, 0) * x + valueAt(matrix, 4) * y + valueAt(matrix, 8) * z + valueAt(matrix, 12);
  const ty = valueAt(matrix, 1) * x + valueAt(matrix, 5) * y + valueAt(matrix, 9) * z + valueAt(matrix, 13);
  const tz = valueAt(matrix, 2) * x + valueAt(matrix, 6) * y + valueAt(matrix, 10) * z + valueAt(matrix, 14);
  const tw = valueAt(matrix, 3) * x + valueAt(matrix, 7) * y + valueAt(matrix, 11) * z + valueAt(matrix, 15);
  if (!Number.isFinite(tw) || Math.abs(tw) < 1e-7) throw new Error('无法反投影当前指针位置。');
  return [tx / tw, ty / tw, tz / tw];
}

function valueAt(values: ArrayLike<number>, index: number): number {
  return finiteOr(values[index], 0);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}
