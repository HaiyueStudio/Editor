import type { SceneSize, VoxelPosition } from './model';

export type VoxMatrix3 = readonly [number, number, number, number, number, number, number, number, number];

export interface VoxTransform {
  rotation: VoxMatrix3;
  translation: readonly [number, number, number];
}

export const IDENTITY_VOX_MATRIX: VoxMatrix3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
export const IDENTITY_VOX_TRANSFORM: VoxTransform = Object.freeze({
  rotation: IDENTITY_VOX_MATRIX,
  translation: Object.freeze([0, 0, 0] as const),
});

/** Decodes MagicaVoxel's signed permutation matrix stored in an nTRN `_r` attribute. */
export function decodeVoxRotation(value: string | undefined): VoxMatrix3 {
  if (value === undefined || value.trim() === '') return IDENTITY_VOX_MATRIX;
  const packed = Number.parseInt(value, 10);
  if (!Number.isInteger(packed) || packed < 0 || packed > 255) throw new Error(`VOX 旋转编码无效：${value}。`);
  const first = packed & 3;
  const second = (packed >> 2) & 3;
  if (first > 2 || second > 2 || first === second) throw new Error(`VOX 旋转编码无效：${value}。`);
  const third = 3 - first - second;
  const matrix = Array(9).fill(0) as number[];
  matrix[first] = packed & 16 ? -1 : 1;
  matrix[3 + second] = packed & 32 ? -1 : 1;
  matrix[6 + third] = packed & 64 ? -1 : 1;
  return matrix as unknown as VoxMatrix3;
}

export function encodeVoxRotation(matrix: VoxMatrix3): number {
  const row0 = encodedRow(matrix, 0);
  const row1 = encodedRow(matrix, 1);
  const row2 = encodedRow(matrix, 2);
  if (new Set([row0.index, row1.index, row2.index]).size !== 3) throw new Error('VOX 旋转矩阵不是正交轴向矩阵。');
  return row0.index | (row1.index << 2) | (row0.negative ? 16 : 0)
    | (row1.negative ? 32 : 0) | (row2.negative ? 64 : 0);
}

export function parseVoxTranslation(value: string | undefined): readonly [number, number, number] {
  if (!value) return [0, 0, 0];
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) {
    throw new Error(`VOX 平移属性无效：${value}。`);
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function multiplyVoxTransforms(parent: VoxTransform, local: VoxTransform): VoxTransform {
  return {
    rotation: multiplyMatrices(parent.rotation, local.rotation),
    translation: addVectors(multiplyMatrixVector(parent.rotation, local.translation), parent.translation),
  };
}

export function voxToEditorVector(value: readonly [number, number, number]): readonly [number, number, number] {
  return [value[0], value[2], value[1]];
}

export function editorToVoxVector(value: readonly [number, number, number]): readonly [number, number, number] {
  return [value[0], value[2], value[1]];
}

export function voxToEditorMatrix(matrix: VoxMatrix3): VoxMatrix3 {
  return [
    matrix[0], matrix[2], matrix[1],
    matrix[6], matrix[8], matrix[7],
    matrix[3], matrix[5], matrix[4],
  ];
}

export function editorToVoxMatrix(matrix: VoxMatrix3): VoxMatrix3 {
  return voxToEditorMatrix(matrix);
}

export function editorQuarterTurnsToMatrix(rotation: Readonly<VoxelPosition>): VoxMatrix3 {
  let result = IDENTITY_VOX_MATRIX;
  for (const axis of ['x', 'y', 'z'] as const) {
    const turns = normalizeTurns(rotation[axis]);
    for (let turn = 0; turn < turns; turn += 1) result = multiplyMatrices(QUARTER_TURN[axis], result);
  }
  return result;
}

export function matrixToEditorQuarterTurns(matrix: VoxMatrix3): VoxelPosition {
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      for (let z = 0; z < 4; z += 1) {
        const candidate = { x, y, z };
        if (matricesEqual(editorQuarterTurnsToMatrix(candidate), matrix)) return candidate;
      }
    }
  }
  throw new Error('VOX 场景包含编辑器无法表示的镜像变换。');
}

export function transformedGridOrigin(size: Readonly<SceneSize>, rotation: Readonly<VoxelPosition>): readonly [number, number, number] {
  let point: [number, number, number] = [0, 0, 0];
  let dimensions: SceneSize = { ...size };
  for (const axis of ['x', 'y', 'z'] as const) {
    const turns = normalizeTurns(rotation[axis]);
    for (let turn = 0; turn < turns; turn += 1) {
      const [x, y, z] = point;
      if (axis === 'x') point = [x, z, dimensions.y - y - 1];
      else if (axis === 'y') point = [z, y, dimensions.x - x - 1];
      else point = [y, dimensions.x - x - 1, z];
      dimensions = rotatedSize(dimensions, axis);
    }
  }
  return point;
}

export function transformedGridSize(size: Readonly<SceneSize>, rotation: Readonly<VoxelPosition>): SceneSize {
  let result = { ...size };
  for (const axis of ['x', 'y', 'z'] as const) {
    for (let turn = 0; turn < normalizeTurns(rotation[axis]); turn += 1) result = rotatedSize(result, axis);
  }
  return result;
}

export function multiplyMatrixVector(
  matrix: VoxMatrix3,
  vector: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

export function addVectors(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function subtractVectors(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function multiplyMatrices(left: VoxMatrix3, right: VoxMatrix3): VoxMatrix3 {
  const result = Array(9).fill(0) as number[];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let index = 0; index < 3; index += 1) {
        const target = row * 3 + column;
        result[target] = result[target]! + left[row * 3 + index]! * right[index * 3 + column]!;
      }
    }
  }
  return result as unknown as VoxMatrix3;
}

function encodedRow(matrix: VoxMatrix3, row: number): { index: number; negative: boolean } {
  let found = -1;
  let value = 0;
  for (let column = 0; column < 3; column += 1) {
    const entry = matrix[row * 3 + column]!;
    if (entry === 0) continue;
    if ((entry !== 1 && entry !== -1) || found !== -1) throw new Error('VOX 旋转矩阵不是轴向矩阵。');
    found = column;
    value = entry;
  }
  if (found < 0) throw new Error('VOX 旋转矩阵包含空行。');
  return { index: found, negative: value < 0 };
}

function matricesEqual(left: VoxMatrix3, right: VoxMatrix3): boolean {
  return left.every((value, index) => value === right[index]);
}

function normalizeTurns(value: number): number {
  return ((Math.round(value) % 4) + 4) % 4;
}

function rotatedSize(size: Readonly<SceneSize>, axis: 'x' | 'y' | 'z'): SceneSize {
  if (axis === 'x') return { x: size.x, y: size.z, z: size.y };
  if (axis === 'y') return { x: size.z, y: size.y, z: size.x };
  return { x: size.y, y: size.x, z: size.z };
}

const QUARTER_TURN: Readonly<Record<'x' | 'y' | 'z', VoxMatrix3>> = Object.freeze({
  x: Object.freeze([1, 0, 0, 0, 0, 1, 0, -1, 0] as const),
  y: Object.freeze([0, 0, 1, 0, 1, 0, -1, 0, 0] as const),
  z: Object.freeze([0, 1, 0, -1, 0, 0, 0, 0, 1] as const),
});
