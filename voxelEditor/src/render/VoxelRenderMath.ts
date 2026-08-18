import { normalizeColor, type SceneSize } from '../document/VoxelDocumentContract';

export function cameraRadius(size: Readonly<SceneSize>): number {
  return Math.max(18, Math.hypot(size.x, Math.min(size.y, 32), size.z) * 0.72);
}

export function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-8) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function materialBatchKey(metallic: number, roughness: number, transparent: boolean): string {
  return `${metallic.toFixed(4)}:${roughness.toFixed(4)}:${transparent ? 'blend' : 'opaque'}`;
}

export function backgroundColorToGpu(color: string): { r: number; g: number; b: number; a: number } {
  const normalized = normalizeColor(color);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16) / 255,
    g: Number.parseInt(normalized.slice(3, 5), 16) / 255,
    b: Number.parseInt(normalized.slice(5, 7), 16) / 255,
    a: 1,
  };
}
