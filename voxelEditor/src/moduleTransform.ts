import type { SceneSize, Voxel, VoxelModuleInstance } from './model';

export interface ModuleTransform {
  rotation: Readonly<{ x: number; y: number; z: number }>;
  scale: Readonly<{ x: number; y: number; z: number }>;
}

export function normalizeQuarterTurn(value: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  return ((rounded % 4) + 4) % 4;
}

export function normalizeModuleScale(value: number): number {
  return Math.max(1, Math.min(16, Number.isFinite(value) ? Math.round(value) : 1));
}

export function transformModuleVoxels(
  source: Iterable<Voxel>,
  transform: ModuleTransform,
  sourceSize?: Readonly<SceneSize>,
): Voxel[] {
  const scale = {
    x: normalizeModuleScale(transform.scale.x),
    y: normalizeModuleScale(transform.scale.y),
    z: normalizeModuleScale(transform.scale.z),
  };
  const sourceVoxels = Array.from(source);
  if (sourceVoxels.length * scale.x * scale.y * scale.z > 200_000) {
    throw new Error('单个模块实例变换后的体素数量不能超过 200,000。');
  }
  let voxels: Voxel[] = [];
  for (const voxel of sourceVoxels) {
    for (let dz = 0; dz < scale.z; dz += 1) {
      for (let dy = 0; dy < scale.y; dy += 1) {
        for (let dx = 0; dx < scale.x; dx += 1) {
          voxels.push({
            x: voxel.x * scale.x + dx,
            y: voxel.y * scale.y + dy,
            z: voxel.z * scale.z + dz,
            color: voxel.color,
            materialId: voxel.materialId,
          });
        }
      }
    }
  }
  let size = sourceSize ? {
    x: Math.max(1, Math.round(sourceSize.x)) * scale.x,
    y: Math.max(1, Math.round(sourceSize.y)) * scale.y,
    z: Math.max(1, Math.round(sourceSize.z)) * scale.z,
  } : voxelSize(voxels);
  for (const axis of ['x', 'y', 'z'] as const) {
    const turns = normalizeQuarterTurn(transform.rotation[axis]);
    for (let turn = 0; turn < turns; turn += 1) {
      voxels = rotateQuarter(voxels, axis, size);
      size = rotatedSize(size, axis);
    }
  }
  return voxels;
}

export function projectGizmoDragSteps(
  axisScreen: Readonly<{ x: number; y: number }>,
  axisWorldLength: number,
  pointerDelta: Readonly<{ x: number; y: number }>,
): number {
  const screenLength = Math.hypot(axisScreen.x, axisScreen.y);
  if (screenLength < 1e-4 || axisWorldLength <= 0) return 0;
  const projected = (pointerDelta.x * axisScreen.x + pointerDelta.y * axisScreen.y) / screenLength;
  return Math.round(projected / (screenLength / axisWorldLength));
}

export function cloneModuleInstance(instance: VoxelModuleInstance): VoxelModuleInstance {
  return {
    ...instance,
    position: { ...instance.position },
    rotation: { ...instance.rotation },
    scale: { ...instance.scale },
  };
}

function rotateQuarter(voxels: readonly Voxel[], axis: 'x' | 'y' | 'z', size: Readonly<SceneSize>): Voxel[] {
  return voxels.map(voxel => {
    if (axis === 'x') return { ...voxel, y: voxel.z, z: size.y - voxel.y - 1 };
    if (axis === 'y') return { ...voxel, x: voxel.z, z: size.x - voxel.x - 1 };
    return { ...voxel, x: voxel.y, y: size.x - voxel.x - 1 };
  });
}

function rotatedSize(size: Readonly<SceneSize>, axis: 'x' | 'y' | 'z'): SceneSize {
  if (axis === 'x') return { x: size.x, y: size.z, z: size.y };
  if (axis === 'y') return { x: size.z, y: size.y, z: size.x };
  return { x: size.y, y: size.x, z: size.z };
}

function voxelSize(voxels: readonly Voxel[]): SceneSize {
  let x = 1, y = 1, z = 1;
  for (const voxel of voxels) {
    x = Math.max(x, voxel.x + 1); y = Math.max(y, voxel.y + 1); z = Math.max(z, voxel.z + 1);
  }
  return { x, y, z };
}
