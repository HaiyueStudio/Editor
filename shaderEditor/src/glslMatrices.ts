import { TranslationError, type Token } from './glslPreprocessor.js';
import type { Expression as Expr } from './glslUpdates.js';

export const matrix = (type: string) => /^mat[234]x[234]f$/.test(type);
export const matrixSize = (type: string) => ({ columns: Number(type[3]), rows: Number(type[5]) });
export const MATRIX_TYPES: Record<string, string> = {};
for (const columns of [2, 3, 4]) for (const rows of [2, 3, 4]) {
  MATRIX_TYPES[`mat${columns}x${rows}`] = `mat${columns}x${rows}f`;
  if (columns === rows) MATRIX_TYPES[`mat${columns}`] = `mat${columns}x${rows}f`;
}
export const MATRIX_FUNCTIONS = new Set(['transpose', 'determinant', 'inverse', 'matrixCompMult', 'outerProduct']);
const numeric = (type: string) => ['number', 'f32', 'i32', 'u32'].includes(type);
const floatVector = (type: string) => /^vec[234]f$/.test(type);
const sequence = (size: number) => Array.from({ length: size }, (_, index) => index);
const assemble = (type: string, component: (column: number, row: number) => string) => {
  const { columns, rows } = matrixSize(type);
  return `${type}(${sequence(columns).map(c => `vec${rows}f(${sequence(rows).map(r => component(c, r)).join(', ')})`).join(', ')})`;
};

/** GLSL and WGSL use column-major matrices, but constructors, scalar arithmetic
 * and several builtins differ. Helpers evaluate each runtime argument once;
 * global const initializers expand inline to remain constant expressions. */
export class Matrices {
  constructor(private readonly helpers: Map<string, string>) {}
  private expand(label: string, type: string, args: Expr[], build: (values: string[]) => string, constant: boolean): Expr {
    if (constant) return { code: build(args.map(a => `(${a.code})`)), type };
    const types = args.map(a => a.type === 'number' ? 'i32' : a.type);
    const name = `hy_matrix_${label}_${type}_${types.join('_')}`;
    const values = args.map((_, i) => `hy_arg_${i}`);
    this.helpers.set(name, `fn ${name}(${values.map((v, i) => `${v}: ${types[i]}`).join(', ')}) -> ${type} {\n  return ${build(values)};\n}`);
    return { code: `${name}(${args.map(a => a.code).join(', ')})`, type };
  }
  construct(token: Token, type: string, args: Expr[], constant: boolean): Expr {
    const { columns, rows } = matrixSize(type), first = args[0];
    if (args.length === 1 && first && matrix(first.type)) {
      if (first.type === type) return { code: first.code, type };
      const source = matrixSize(first.type);
      return this.expand('resize', type, args, ([m]) => assemble(type, (c, r) => c < source.columns && r < source.rows ? `${m}[${c}][${r}]` : c === r ? '1.0' : '0.0'), constant);
    }
    if (args.length === 1 && first && (numeric(first.type) || first.type === 'bool')) {
      return this.expand('diagonal', type, args, ([v]) => assemble(type, (c, r) => c !== r ? '0.0' : first.type === 'bool' ? `select(0.0, 1.0, ${v})` : `f32(${v})`), constant);
    }
    let count = 0;
    for (const arg of args) {
      if (count >= columns * rows || !(numeric(arg.type) || arg.type === 'bool' || /^vec[234][fiu]$/.test(arg.type))) {
        throw new TranslationError(token, `${token.value} 需要按列排列的标量/向量分量，或单个标量/矩阵；不能混入矩阵或多余参数。`);
      }
      count += arg.type.startsWith('vec') ? Number(arg.type[3]) : 1;
    }
    if (count < columns * rows) throw new TranslationError(token, `${token.value} 构造需要 ${columns * rows} 个分量，当前只有 ${count} 个。`);
    if (args.length === columns && args.every(a => a.type === `vec${rows}f`)) return { code: `${type}(${args.map(a => a.code).join(', ')})`, type };
    return this.expand('construct', type, args, values => {
      const parts = args.flatMap((arg, i) => arg.type.startsWith('vec')
        ? sequence(Number(arg.type[3])).map(r => `f32(${values[i]}[${r}])`)
        : [arg.type === 'bool' ? `select(0.0, 1.0, ${values[i]})` : `f32(${values[i]})`]);
      return assemble(type, (c, r) => parts[c * rows + r]!);
    }, constant);
  }
  convert(token: Token, type: string, args: Expr[], constant: boolean): Expr {
    const isVector = /^vec[234][fiu]$/.test(type), count = isVector ? Number(type[3]) : 1;
    if (!isVector && (!['f32', 'i32', 'u32', 'bool'].includes(type) || args.length !== 1)) throw new TranslationError(token, '标量转换需要一个参数。');
    let total = 0;
    for (const arg of args) {
      if (total >= count || !(matrix(arg.type) || /^vec[234][fiu]$/.test(arg.type) || numeric(arg.type) || arg.type === 'bool')) throw new TranslationError(token, '构造参数类型不匹配或存在多余参数。');
      total += matrix(arg.type) ? matrixSize(arg.type).columns * matrixSize(arg.type).rows : arg.type.startsWith('vec') ? Number(arg.type[3]) : 1;
    }
    if (total < count) throw new TranslationError(token, '构造参数分量不足。');
    const scalar = isVector ? type.endsWith('i') ? 'i32' : type.endsWith('u') ? 'u32' : 'f32' : type;
    return this.expand('convert', type, args, values => {
      const parts = args.flatMap((arg, i) => matrix(arg.type)
        ? sequence(matrixSize(arg.type).columns).flatMap(c => sequence(matrixSize(arg.type).rows).map(r => `${values[i]}[${c}][${r}]`))
        : arg.type.startsWith('vec') ? sequence(Number(arg.type[3])).map(r => `${values[i]}[${r}]`)
        : [arg.type === 'bool' ? `select(0.0, 1.0, ${values[i]})` : values[i]!]);
      const converted = parts.slice(0, count).map(part => scalar === 'bool' ? `(${part} != 0.0)` : `${scalar}(${part})`);
      return isVector ? `${type}(${converted.join(', ')})` : converted[0]!;
    }, constant);
  }
  binary(token: Token, left: Expr, right: Expr, constant: boolean): Expr {
    const op = token.value, lm = matrix(left.type), rm = matrix(right.type);
    const l = matrixSize(left.type), r = matrixSize(right.type);
    const fail = (): never => { throw new TranslationError(token, `矩阵运算 ${left.type} ${op} ${right.type} 的类型或维度不匹配。`); };
    const direct = (type: string): Expr => ({ code: `(${left.code} ${op} ${right.code})`, type });
    if (op === '*') {
      if (lm && rm) return l.columns === r.rows ? direct(`mat${r.columns}x${l.rows}f`) : fail();
      if (lm && floatVector(right.type)) return l.columns === Number(right.type[3]) ? direct(`vec${l.rows}f`) : fail();
      if (floatVector(left.type) && rm) return Number(left.type[3]) === r.rows ? direct(`vec${r.columns}f`) : fail();
      if (lm && numeric(right.type)) return { code: `(${left.code} * f32(${right.code}))`, type: left.type };
      if (numeric(left.type) && rm) return { code: `(f32(${left.code}) * ${right.code})`, type: right.type };
      return fail();
    }
    if ((op === '==' || op === '!=') && lm && left.type === right.type) {
      return this.expand(op === '==' ? 'equal' : 'unequal', 'bool', [left, right], ([a, b]) => `(${sequence(l.columns).map(c => `${op === '==' ? 'all' : 'any'}(${a}[${c}] ${op} ${b}[${c}])`).join(op === '==' ? ' && ' : ' || ')})`, constant);
    }
    if (!['+', '-', '/'].includes(op)) return fail();
    if (lm && rm && left.type === right.type && op !== '/') return direct(left.type);
    const type = lm ? left.type : right.type;
    if (!(lm && rm && left.type === right.type || lm && numeric(right.type) || rm && numeric(left.type))) return fail();
    const { columns, rows } = matrixSize(type);
    return this.expand(({ '+': 'add', '-': 'subtract', '/': 'divide' } as Record<string, string>)[op]!, type, [left, right], ([a, b]) =>
      `${type}(${sequence(columns).map(c => `(${lm ? `${a}[${c}]` : `vec${rows}f(f32(${a}))`} ${op} ${rm ? `${b}[${c}]` : `vec${rows}f(f32(${b}))`})`).join(', ')})`, constant);
  }
  unary(token: Token, value: Expr, constant: boolean): Expr {
    if (token.value === '+') return { code: value.code, type: value.type };
    if (token.value !== '-') throw new TranslationError(token, '矩阵只能使用一元 + 或 -。');
    return this.expand('negate', value.type, [value], ([m]) => `${value.type}(${sequence(matrixSize(value.type).columns).map(c => `(-${m}[${c}])`).join(', ')})`, constant);
  }
  call(token: Token, args: Expr[], constant: boolean): Expr {
    const name = token.value, first = args[0], second = args[1];
    const fail = (): never => { throw new TranslationError(token, `${name} 的矩阵参数类型、数量或维度不匹配。`); };
    if (name === 'outerProduct') {
      if (args.length !== 2 || !first || !second || !floatVector(first.type) || !floatVector(second.type)) return fail();
      const type = `mat${second.type[3]}x${first.type[3]}f`;
      return this.expand(name, type, args, ([a, b]) => `${type}(${sequence(Number(second.type[3])).map(c => `(${a} * ${b}[${c}])`).join(', ')})`, constant);
    }
    if (!first || !matrix(first.type)) return fail();
    const { columns, rows } = matrixSize(first.type);
    if (name === 'matrixCompMult') {
      if (args.length !== 2 || second?.type !== first.type) return fail();
      return this.expand(name, first.type, args, ([a, b]) => `${first.type}(${sequence(columns).map(c => `(${a}[${c}] * ${b}[${c}])`).join(', ')})`, constant);
    }
    if (args.length !== 1) return fail();
    if (name === 'transpose') return { code: `transpose(${first.code})`, type: `mat${rows}x${columns}f` };
    if (columns !== rows) return fail();
    if (name === 'determinant') return { code: `determinant(${first.code})`, type: 'f32' };
    if (name !== 'inverse') return fail();
    // Inverse column c, row r uses the cofactor with original column r and row c
    // removed: the cofactor transpose, divided by the determinant.
    return this.expand(name, first.type, args, ([m]) => {
      const adjugate = assemble(first.type, (c, r) => {
        const cols = sequence(columns).filter(i => i !== r), row = sequence(rows).filter(i => i !== c);
        const minor = columns === 2 ? `${m}[${cols[0]}][${row[0]}]`
          : `determinant(${assemble(`mat${columns - 1}x${rows - 1}f`, (mc, mr) => `${m}[${cols[mc]}][${row[mr]}]`)})`;
        return (c + r) % 2 ? `(-${minor})` : minor;
      });
      return `(${adjugate} * (1.0 / determinant(${m})))`;
    }, constant);
  }
}
