import type { Vec2Tuple, Vec3Tuple, Vec4Tuple } from '../../types';
import type { ColorValue } from '@haiyue/engine/color';

export function toVec2(value: ArrayLike<number>): Vec2Tuple {
  return [value[0] ?? 0, value[1] ?? 0];
}

export function toVec3(value: ArrayLike<number>): Vec3Tuple {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

export function toVec4(value: ArrayLike<number>): Vec4Tuple {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0];
}

export function colorToTuple(color: ColorValue): Vec4Tuple {
  const data = new Float32Array(4);
  color.writeSRGB(data);
  return [data[0]!, data[1]!, data[2]!, data[3]!];
}

export function colorToVec3(color: ColorValue): Vec3Tuple {
  const data = colorToTuple(color);
  return [data[0], data[1], data[2]];
}
