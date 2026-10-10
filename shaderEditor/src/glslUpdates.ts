import { TranslationError, type Token } from './glslPreprocessor.js';
import type { ScalarConstant } from './glslConstants.js';
import { matrix, matrixSize } from './glslMatrices.js';

export type Reference = {
  root: string; type: string; space: 'function' | 'private'; writable: boolean;
  path?: (string | { code: string; type: string })[];
  members?: string[]; components?: string; index?: { code: string; type: string }; column?: { code: string; type: string };
};
// Explicit proof that evaluating this expression early is safe. Missing means unknown/unsafe.
export type Expression = { lengthEvaluations?: Expression[] | undefined; eagerSafe?: boolean | undefined; code: string; type: string; reference?: Reference | undefined; statement?: string; constant?: ScalarConstant | undefined };

/** WGSL call statements cannot retain GLSL's optional outer parentheses. */
export function discardExpression(expr: Expression): string {
  if (expr.statement) return expr.statement;
  if (expr.type !== 'void') return `_ = ${expr.code}`;
  let code = expr.code;
  while (code.startsWith('(') && code.endsWith(')')) {
    let depth = 0, end = 0;
    for (; end < code.length; end++) {
      if (code[end] === '(') depth++;
      else if (code[end] === ')' && --depth === 0) break;
    }
    if (end !== code.length - 1) break;
    code = code.slice(1, -1).trim();
  }
  return code;
}

export function referenceIndices(ref: Reference): [string, { code: string; type: string }][] {
  const entries: [string, { code: string; type: string }][] = [];
  ref.path?.forEach((part, i) => { if (typeof part !== 'string') entries.push(['path_' + i, part]); });
  for (const key of ['column', 'index'] as const) if (ref[key]) entries.push([key, ref[key]!]);
  return entries;
}

/** Access a captured l-value without taking a pointer to a vector component. */
export function referenceAccess(ref: Reference, root: string, indices: Record<string, string> = Object.fromEntries(referenceIndices(ref).map(([key]) => [key, 'hy_' + key]))) {
  const path = ref.path?.map((part, i) => typeof part === 'string' ? '.' + part : '[' + indices['path_' + i] + ']').join('') ?? '';
  const base = root + path + (ref.members?.map(name => '.' + name).join('') ?? '') + (ref.column ? '[' + indices.column + ']' : '');
  const target = ref.index ? base + '[' + (ref.components
    ? 'vec' + ref.components.length + 'u(' + [...ref.components].map(c => 'xyzw'.indexOf(c) + 'u').join(', ') + ')[' + indices.index + ']'
    : indices.index) + ']' : base + (ref.components ? '.' + ref.components : '');
  return { base, target };
}
export function writeReference(ref: Reference, access: { base: string; target: string }, value: string) {
  return ref.components && ref.components.length > 1 && !ref.index
    ? [...ref.components].map((c, i) => '  ' + access.base + '.' + c + ' = ' + value + '.' + 'xyzw'[i] + ';').join('\n')
    : '  ' + access.target + ' = ' + value + ';';
}

/** Pass the root variable, with evaluated indices, so component writes never
 * take a vector-component pointer or evaluate an index twice. */
export class Updates {
  private assignment = 0;
  constructor(private readonly helpers: Map<string, string>) {}
  private path(ref: Reference) {
    const parameters: string[] = [], arguments_: string[] = [];
    let suffix = (ref.path?.map(part => typeof part === 'string' ? '_field_' + part.length + '_' + part : '_array').join('') ?? '') + (ref.members?.map(name => '_' + name.length + '_' + name).join('') ?? '');
    for (const [kind, index] of referenceIndices(ref)) {
      const type = index.type === 'u32' ? 'u32' : 'i32';
      parameters.push(`hy_${kind}: ${type}`); arguments_.push(index.code); suffix += `_${kind}_${type}`;
    }
    return { ...referenceAccess(ref, '(*hy_value)'), parameters, arguments_, suffix };
  }
  assign(token: Token, value: Expression, rhs: Expression, operation: (left: Expression, right: Expression) => Expression, returnsValue = false): string {
    const ref = value.reference;
    if (!ref?.writable) throw new TranslationError(token, '赋值需要可写变量或不重复的向量分量。');
    const path = this.path(ref), rightType = rhs.type === 'number' ? 'i32' : rhs.type;
    const result = operation({ code: path.target, type: value.type }, { code: 'hy_rhs', type: rightType });
    if (result.type !== value.type) throw new TranslationError(token, '复合赋值的矩阵/向量维度与目标不匹配。');
    const name = `hy_assign_${this.assignment++}`;
    this.helpers.set(name, `fn ${name}(hy_value: ptr<${ref.space}, ${ref.type}>, ${[...path.parameters, `hy_rhs: ${rightType}`].join(', ')})${returnsValue ? ` -> ${value.type}` : ''} {\n  let hy_next = ${result.code};\n${writeReference(ref, path, 'hy_next')}\n${returnsValue ? '  return hy_next;\n' : ''}}`);
    return `${name}(&${ref.root}, ${[...path.arguments_, rhs.code].join(', ')})`;
  }
  lower(token: Token, value: Expression, prefix: boolean): Expression {
    const ref = value.reference;
    if (!ref?.writable) throw new TranslationError(token, `${token.value} 需要可写变量或不重复的向量分量，不能修改常量、内置变量或临时表达式。`);
    if (!/^(?:[fiu]32|vec[234][fiu])$/.test(value.type) && !matrix(value.type)) throw new TranslationError(token, `${token.value} 仅支持整数或浮点标量/向量/矩阵。`);
    const decrement = token.value === '--', op = decrement ? '-' : '+';
    const unit = value.type === 'f32' || value.type.endsWith('f') ? '1.0' : value.type === 'u32' || value.type.endsWith('u') ? '1u' : '1';
    const size = matrixSize(value.type);
    const one = matrix(value.type) ? `${value.type}(${Array.from({ length: size.columns }, () => `vec${size.rows}f(1.0)`).join(', ')})`
      : value.type.startsWith('vec') ? `${value.type}(${unit})` : unit;
    const path = this.path(ref);
    const name = `hy_update_${prefix ? 'pre' : 'post'}_${decrement ? 'dec' : 'inc'}_${ref.space}_${ref.type.replace(/[^A-Za-z0-9_]/g, '_')}${ref.components ? '_' + ref.components : ''}${path.suffix}`;
    this.helpers.set(name, `fn ${name}(hy_value: ptr<${ref.space}, ${ref.type}>${path.parameters.length ? ', ' + path.parameters.join(', ') : ''}) -> ${value.type} {\n  let hy_old = ${path.target};\n  let hy_next = hy_old ${op} ${one};\n${writeReference(ref, path, 'hy_next')}\n  return ${prefix ? 'hy_next' : 'hy_old'};\n}`);
    const call = `${name}(&${ref.root}${path.arguments_.length ? ', ' + path.arguments_.join(', ') : ''})`;
    const direct = !referenceIndices(ref).length && (!ref.components || ref.components.length === 1);
    const targetCode = referenceAccess(ref, ref.root).target;
    const statement = direct ? ['i32', 'u32'].includes(value.type) ? `${targetCode}${token.value}` : `${targetCode} ${op}= ${one}` : call;
    return { code: call, type: value.type, statement };
  }
}
