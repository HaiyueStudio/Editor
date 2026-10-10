/** Conservative scalar constant tracking for case labels. Undefined means the
 * expression requires runtime evaluation or lies outside the supported subset.
 * Never infer a constant from a mutable variable, parameter, or user call.
 */
export type ScalarConstant = number | boolean;
export function constantCast(value: ScalarConstant | undefined, type: string): ScalarConstant | undefined {
  if (value === undefined) return undefined;
  if (type === 'bool') return Boolean(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  if (type === 'f32') { const rounded = Math.fround(number); return Number.isFinite(rounded) ? rounded : undefined; }
  if (type === 'u32') return Math.trunc(number) >>> 0;
  if (type === 'i32' || type === 'number') {
    const integer = Math.trunc(number);
    return integer >= -2147483648 && integer <= 2147483647 ? integer : undefined;
  }
  return undefined;
}
export function constantUnary(op: string, value: ScalarConstant | undefined, type: string): ScalarConstant | undefined {
  if (value === undefined) return undefined;
  if (op === '!' && typeof value === 'boolean') return !value;
  if (typeof value !== 'number') return undefined;
  if (op === '~') return constantCast(~value, type);
  return constantCast(op === '-' ? -value : value, type);
}
export function constantBinary(op: string, left: ScalarConstant | undefined, right: ScalarConstant | undefined, type: string): ScalarConstant | undefined {
  if (left === undefined || right === undefined) return undefined;
  switch (op) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '&&': return typeof left === 'boolean' && typeof right === 'boolean' ? left && right : undefined;
    case '||': return typeof left === 'boolean' && typeof right === 'boolean' ? left || right : undefined;
  }
  if (typeof left !== 'number' || typeof right !== 'number') return undefined;
  switch (op) {
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    case '&': return constantCast(left & right, type);
    case '|': return constantCast(left | right, type);
    case '^': return constantCast(left ^ right, type);
    case '<<': return right < 0 || right >= 32 ? undefined : constantCast(left << right, type);
    case '>>': return right < 0 || right >= 32 ? undefined : constantCast(type === 'u32' ? left >>> right : left >> right, type);
    case '+': return constantCast(left + right, type);
    case '-': return constantCast(left - right, type);
    case '*': return constantCast(type === 'u32' ? Math.imul(left, right) : left * right, type);
    case '/': return right === 0 ? undefined : constantCast(left / right, type);
    case '%': return right === 0 ? undefined : constantCast(left % right, type);
    default: return undefined;
  }
}
export function constantBuiltin(name: string, args: (ScalarConstant | undefined)[], type: string): ScalarConstant | undefined {
  if (!args.every(value => typeof value === 'number')) return undefined;
  const values = args as number[], a = values[0]!, b = values[1]!, c = values[2]!;
  // These integer-capable builtins are exact; transcendental float operations
  // deliberately stay unknown rather than guessing a GPU-dependent case value.
  if (args.length === 1 && name === 'abs') return constantCast(Math.abs(a), type);
  if (args.length === 1 && name === 'sign') return constantCast(Math.sign(a), type);
  if (args.length === 2 && name === 'min') return constantCast(Math.min(a, b), type);
  if (args.length === 2 && name === 'max') return constantCast(Math.max(a, b), type);
  if (args.length === 3 && name === 'clamp') return constantCast(Math.min(Math.max(a, b), c), type);
  return undefined;
}
