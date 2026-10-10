import { TranslationError, type Token } from './glslSource.js';
import type { Expression } from './glslUpdates.js';

export function arrayInfo(type: string): { element: string; size: number } | undefined {
  const match = /^array<(.+), (\d+)>$/.exec(type);
  return match ? { element: match[1]!, size: Number(match[2]) } : undefined;
}
export const arrayType = (element: string, size: number) => `array<${element}, ${size}>`;
export function fixedArray(token: Token, type: string): string {
  let current = arrayInfo(type), count = 1, depth = 0;
  while (current) {
    if (!current.size) throw new TranslationError(token, '数组需要明确的长度，或通过初始值推断长度。');
    count *= current.size;
    if (count > 65536 || ++depth > 8) throw new TranslationError(token, '数组最多支持 8 维、65536 个元素。');
    current = arrayInfo(current.element);
  }
  return type;
}
export function inferArray(token: Token, type: string, value?: Expression): string {
  const array = arrayInfo(type);
  if (!array) return type;
  const other = value && arrayInfo(value.type);
  if (array.size === 0 && other) type = arrayType(array.element, other.size);
  return fixedArray(token, type);
}
export function constructArray(token: Token, type: string, args: Expression[]): Expression {
  const array = arrayInfo(type)!;
  const size = array.size || args.length;
  if (!size || size !== args.length) throw new TranslationError(token, `数组构造需要 ${size || '至少 1'} 个元素，实际为 ${args.length} 个。`);
  const result = fixedArray(token, arrayType(array.element, size));
  const values = args.map(arg => {
    if (arg.type === array.element || (arg.type === 'number' && array.element === 'i32')) return arg.code;
    if (array.element === 'f32' && ['number', 'i32', 'u32'].includes(arg.type)) return `f32(${arg.code})`;
    throw new TranslationError(token, `数组元素需要 ${array.element}，实际为 ${arg.type}。`);
  });
  return { type: result, code: `${result}(${values.join(', ')})` };
}

