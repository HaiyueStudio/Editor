import { TranslationError, type Token } from './glslPreprocessor.js';
import { constantBinary, constantUnary } from './glslConstants.js';
import type { Expression } from './glslUpdates.js';

export const BITWISE_BINARY = new Set(['<<', '>>', '&', '^', '|']);
export const BITWISE_ASSIGNMENT = new Set(['<<=', '>>=', '&=', '^=', '|=']);
const integer = (type: string) => /^(?:number|i32|u32|vec[234][iu])$/.test(type);
const lanes = (type: string) => type.startsWith('vec') ? Number(type[3]) : 1;
const unsigned = (type: string) => type === 'u32' || type.endsWith('u');
const concrete = (expr: Expression) => expr.type === 'number' ? `i32(${expr.code})` : expr.code;
const literal = (value: number, type: string) => unsigned(type) ? `${value}u` : `i32(${value})`;

export function bitwiseUnary(token: Token, expr: Expression): Expression {
  if (!integer(expr.type)) throw new TranslationError(token, '~ 仅支持 int / uint 标量或整数向量。');
  const type = expr.type === 'number' ? 'i32' : expr.type;
  const constant = constantUnary('~', expr.constant, type);
  return { code: typeof constant === 'number' ? literal(constant, type) : `(~${concrete(expr)})`, type, constant };
}

/** Keep the left operand's signedness for shifts. WGSL always requires u32
 * shift counts with the same scalar/vector shape as the shifted value; GLSL
 * additionally allows signed counts and a scalar count for a vector operand.
 * Each operand appears once, preserving increments and helper call effects.
 */
export function bitwiseBinary(token: Token, left: Expression, right: Expression): Expression {
  const op = token.value, shift = op === '<<' || op === '>>';
  if (!integer(left.type) || !integer(right.type)) throw new TranslationError(token, `${op} 仅支持 int / uint 标量或整数向量。`);
  const a = lanes(left.type), b = lanes(right.type);
  if ((shift && a === 1 && b !== 1) || (a !== 1 && b !== 1 && a !== b)) throw new TranslationError(token, `${op} 的向量维度不匹配；移位时标量左值只能搭配标量移位次数。`);
  if (!shift && unsigned(left.type) !== unsigned(right.type)) throw new TranslationError(token, `${op} 两侧的整数符号类型必须一致；请显式使用 int / uint 转换。`);
  const type = shift || a !== 1 ? left.type === 'number' ? 'i32' : left.type : right.type === 'number' ? 'i32' : right.type;
  let lhs = concrete(left), rhs = concrete(right);
  if (shift) {
    if (typeof right.constant === 'number' && (right.constant < 0 || right.constant >= 32)) throw new TranslationError(token, '32 位整数的移位次数必须在 0–31 之间；GLSL 对超出范围的结果未定义。');
    rhs = unsigned(right.type) ? right.code : `${b === 1 ? 'u32' : `vec${b}u`}(${right.code})`;
    if (a !== 1 && b === 1) rhs = `vec${a}u(${rhs})`;
  } else {
    if (a === 1 && b !== 1) lhs = `${type}(${lhs})`;
    if (b === 1 && a !== 1) rhs = `${type}(${rhs})`;
  }
  const constant = constantBinary(op, left.constant, right.constant, type);
  // GLSL integer shifts discard high bits even in constant expressions. Fold
  // known scalars so WGSL's constant-overflow checks do not reject 1 << 31.
  return { code: typeof constant === 'number' ? literal(constant, type) : `(${lhs} ${op} ${rhs})`, type, constant };
}
