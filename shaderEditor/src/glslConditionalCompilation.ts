import { TranslationError, type Token } from './glslSource.js';

type Integer = { value: bigint; unsigned: boolean };
const ZERO: Integer = { value: 0n, unsigned: false };
const integer = (value: bigint, unsigned = false): Integer => ({ value: unsigned ? BigInt.asUintN(32, value) : BigInt.asIntN(32, value), unsigned });
const truth = (value: boolean) => integer(value ? 1n : 0n);
const PRIORITY: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

/** Bounded integer parser, never JavaScript eval. As in GLSL ES, undefined
 * identifiers are errors only on evaluated paths of && / ||. Macro expansion
 * and defined-operand protection happen before this parser is called.
 */
export function evaluateCondition(tokens: Token[], directive: Token): boolean {
  let index = 0, depth = 0;
  const current = () => tokens[index] ?? directive;
  const binary = (token: Token, left: Integer, right: Integer): Integer => {
    const op = token.value;
    if (op === '&&') return truth(left.value !== 0n && right.value !== 0n);
    if (op === '||') return truth(left.value !== 0n || right.value !== 0n);
    if (op === '<<' || op === '>>') {
      if (right.value < 0n || right.value >= 32n) throw new TranslationError(token, '#if / #elif 的移位次数必须在 0–31 之间。');
      return integer(op === '<<' ? left.value << right.value : left.value >> right.value, left.unsigned);
    }
    const unsigned = left.unsigned || right.unsigned;
    const a = integer(left.value, unsigned).value, b = integer(right.value, unsigned).value;
    switch (op) {
      case '+': return integer(a + b, unsigned);
      case '-': return integer(a - b, unsigned);
      case '*': return integer(a * b, unsigned);
      case '/': case '%':
        if (b === 0n) throw new TranslationError(token, '#if / #elif 中不能除以零或对零取余。');
        return integer(op === '/' ? a / b : a % b, unsigned);
      case '&': return integer(a & b, unsigned);
      case '|': return integer(a | b, unsigned);
      case '^': return integer(a ^ b, unsigned);
      case '==': return truth(a === b);
      case '!=': return truth(a !== b);
      case '<': return truth(a < b);
      case '>': return truth(a > b);
      case '<=': return truth(a <= b);
      case '>=': return truth(a >= b);
      default: throw new TranslationError(token, `条件编译不支持运算符 “${op}”。`);
    }
  };
  const unary = (evaluate: boolean): Integer => {
    if (++depth > 64) throw new TranslationError(current(), '条件编译表达式嵌套不能超过 64 层。');
    try {
      const token = tokens[index++];
      if (!token) throw new TranslationError(directive, '#if / #elif 需要完整的整数条件表达式。');
      if (['+', '-', '~', '!'].includes(token.value)) {
        const value = unary(evaluate);
        if (!evaluate) return ZERO;
        if (token.value === '!') return truth(value.value === 0n);
        return integer(token.value === '-' ? -value.value : token.value === '~' ? ~value.value : value.value, value.unsigned);
      }
      if (token.value === '(') {
        const value = expression(0, evaluate);
        if (tokens[index]?.value !== ')') throw new TranslationError(current(), '条件编译表达式缺少 )。');
        index++; return value;
      }
      if (/^(?:0[xX][\da-fA-F]+|0[0-7]*|[1-9]\d*)[uU]?$/.test(token.value)) {
        const raw = token.value.replace(/[uU]$/, ''), value = BigInt(/^0[0-7]+$/.test(raw) ? '0o' + raw.slice(1) : raw);
        if (value > 0xffffffffn) throw new TranslationError(token, '条件编译整数不能超过 32 位。');
        return integer(value, /[uU]$/.test(token.value));
      }
      if (/^[A-Za-z_]\w*$/.test(token.value)) {
        if (!evaluate) return ZERO;
        throw new TranslationError(token, `条件编译使用了未定义的宏 “${token.value}”；请先 #define，或用 defined(${token.value}) 检查。`);
      }
      throw new TranslationError(token, '条件编译只支持整数常量表达式，不支持浮点数、字符串或运行时函数。');
    } finally { depth--; }
  };
  const expression = (min: number, evaluate: boolean): Integer => {
    let left = unary(evaluate);
    while (index < tokens.length && (PRIORITY[tokens[index]!.value] ?? -1) >= min) {
      const token = tokens[index++]!;
      const useRight = evaluate && !(token.value === '&&' && left.value === 0n) && !(token.value === '||' && left.value !== 0n);
      const right = expression(PRIORITY[token.value]! + 1, useRight);
      left = evaluate ? binary(token, left, right) : ZERO;
    }
    return left;
  };
  const result = expression(0, true);
  if (index !== tokens.length) throw new TranslationError(current(), `条件编译表达式中不支持 “${current().value}”，或缺少运算符。`);
  return result.value !== 0n;
}
