import { TranslationError, type Token } from './glslPreprocessor.js';
import { discardExpression, type Expression } from './glslUpdates.js';
import type { ScalarConstant } from './glslConstants.js';
import { matrix, matrixSize } from './glslMatrices.js';
import type { Structures } from './glslStructs.js';
import { isSampler, wgslType } from './glslTextures.js';

export type LocalBinding = { type: string; writable: boolean; code?: string; constant?: ScalarConstant | undefined };

/** GLSL ?: evaluates its condition once, then exactly one branch. A helper
 * captures mutable locals by root pointer, so branch reads happen AFTER the
 * condition and writes reach the caller. Globals remain direct accesses.
 * This keeps the expression at its original evaluation site, including in
 * short-circuit operands and loop conditions/continuing clauses.
 */
export class Conditionals {
  private serial = 0;
  constructor(private readonly helpers: Map<string, string>, private readonly structures: Structures) {}

  lower(token: Token, condition: Expression, yes: Expression, no: Expression,
    locals: ReadonlyMap<string, LocalBinding>, constant: boolean): Expression {
    if (condition.type !== 'bool') throw new TranslationError(token, '三元表达式的条件必须是 bool 标量。');
    const normalize = (type: string) => type === 'number' ? 'i32' : type;
    const type = normalize(yes.type);
    if (isSampler(type) || isSampler(no.type) || type.startsWith('array:') || no.type.startsWith('array:')) {
      throw new TranslationError(token, '三元表达式不能直接选择 sampler2D / samplerCube 或内置数组；请选择采样结果或数组元素。');
    }
    if (type !== normalize(no.type)) throw new TranslationError(token, `三元表达式两分支的类型必须一致（${type} / ${normalize(no.type)}），请使用显式类型转换。`);
    if (constant) {
      // No runtime state or user calls can appear in a global const initializer.
      // Keep it a WGSL constant expression; matrices select their columns.
      const literal = condition.code.replace(/[()\s]/g, '');
      if (literal === 'true' || literal === 'false') return { code: literal === 'true' ? yes.code : no.code, type };
      if (this.structures.has(type)) return { code: this.structures.select(type, yes.code, no.code, condition.code), type };
      const select = (a: string, b: string) => `select(${b}, ${a}, ${condition.code})`;
      const code = matrix(type) ? `${type}(${Array.from({ length: matrixSize(type).columns }, (_, i) => select(`(${yes.code})[${i}]`, `(${no.code})[${i}]`)).join(', ')})` : select(yes.code, no.code);
      return { code, type };
    }
    const name = `hy_ternary_${this.serial++}`;
    const bindings = new Map([...locals].map(([id, local]) => [local.code ?? id, local]));
    const captures = new Map<string, string>(), params = ['hy_condition: bool'], args = [condition.code];
    const rewrite = (code: string) => code.replace(/\b[A-Za-z_]\w*\b/g, (id: string, offset: number) => {
      // Generated expressions contain no strings/comments. Field names and
      // constructor/builtin names are not variable references, even when a
      // GLSL local happens to share the spelling of a WGSL builtin such as f32.
      if (code[offset - 1] === '.' || /^\s*\(/.test(code.slice(offset + id.length))) return id;
      const local = bindings.get(id); if (!local) return id;
      let capture = captures.get(id);
      if (!capture) {
        const param = `hy_capture_${captures.size}`;
        const pointer = local.writable && !isSampler(local.type);
        params.push(`${param}: ${pointer ? `ptr<function, ${local.type}>` : wgslType(local.type)}`);
        args.push(pointer ? `&${id}` : id);
        capture = pointer ? `(*${param})` : param; captures.set(id, capture);
      }
      return capture;
    });
    const whenTrue = rewrite(yes.code), whenFalse = rewrite(no.code);
    const branch = (code: string) => type === 'void' ? `${discardExpression({ code, type })};` : `return ${code};`;
    this.helpers.set(name, `fn ${name}(${params.join(', ')})${type === 'void' ? '' : ` -> ${type}`} {\n  if (hy_condition) {\n    ${branch(whenTrue)}\n  } else {\n    ${branch(whenFalse)}\n  }\n}`);
    // Conditional expressions are r-values, even when both branches are writable.
    return { code: `${name}(${args.join(', ')})`, type };
  }
}
