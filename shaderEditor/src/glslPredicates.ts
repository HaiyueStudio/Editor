import { TranslationError, type Token } from './glslPreprocessor.js';
import type { Expression } from './glslUpdates.js';

const comparisons: Record<string, string> = { lessThan: '<', lessThanEqual: '<=', greaterThan: '>', greaterThanEqual: '>=', equal: '==', notEqual: '!=' };
export const PREDICATE_FUNCTIONS = new Set(['isnan', 'isinf', 'any', 'all', 'not', ...Object.keys(comparisons)]);
export const booleanVector = (type: string) => /^vec[234]<bool>$/.test(type);

/** Inspect IEEE-754 f32 bits instead of x != x, which finite-math optimizers
 * can remove. The operand occurs once, including in global const expressions.
 * This classifies the value reaching the expression; WebGPU does not guarantee
 * that invalid arithmetic produces/preserves NaNs or infinities on every GPU.
 */
export function predicate(token: Token, args: Expression[]): Expression {
  const name = token.value;
  if (comparisons[name]) {
    if (args.length !== 2) throw new TranslationError(token, `${name} 需要两个向量参数。`);
    const [a, b] = args as [Expression, Expression];
    if (a.type !== b.type || !/^vec[234](?:[fiu]|<bool>)$/.test(a.type) || (booleanVector(a.type) && !['equal', 'notEqual'].includes(name)))
      throw new TranslationError(token, `${name} 需要维度和元素类型相同的向量。`);
    return { code: `(${a.code} ${comparisons[name]} ${b.code})`, type: `vec${a.type[3]}<bool>`, eagerSafe: !!a.eagerSafe && !!b.eagerSafe };
  }
  if (args.length !== 1) throw new TranslationError(token, `${name} 需要一个参数。`);
  const arg = args[0]!;
  if (name === 'any' || name === 'all' || name === 'not') {
    if (!booleanVector(arg.type)) throw new TranslationError(token, `${name} 需要 bvec2 / bvec3 / bvec4 布尔向量。`);
    return { code: name === 'not' ? `(!${arg.code})` : `${name}(${arg.code})`, type: name === 'not' ? arg.type : 'bool' };
  }
  if (arg.type !== 'f32' && !/^vec[234]f$/.test(arg.type)) throw new TranslationError(token, `${name} 需要 float 或 vec2 / vec3 / vec4 浮点参数。`);
  const scalar = arg.type === 'f32', bits = scalar ? 'u32' : `vec${arg.type[3]}u`;
  const mask = scalar ? '0x7fffffffu' : `${bits}(0x7fffffffu)`;
  const infinity = scalar ? '0x7f800000u' : `${bits}(0x7f800000u)`;
  return {
    code: `((bitcast<${bits}>(${arg.code}) & ${mask}) ${name === 'isnan' ? '>' : '=='} ${infinity})`,
    type: scalar ? 'bool' : `vec${arg.type[3]}<bool>`,
    constant: scalar && typeof arg.constant === 'number' ? name === 'isnan' ? Number.isNaN(arg.constant) : !Number.isFinite(arg.constant) && !Number.isNaN(arg.constant) : undefined,
  };
}
