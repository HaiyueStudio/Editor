import { TranslationError, type Token } from './glslSource.js';
import type { Expression } from './glslUpdates.js';
import { matrix, matrixSize } from './glslMatrices.js';
import { wgslIdentifier } from './glslNames.js';

export type StructField = { name: string; type: string };
type Structure = { name: string; type: string; fields: StructField[] };

/** GLSL block-local types become unique module-level WGSL types. Keep source
 * lookup scopes separate from emitted type identities (including for overloads).
 */
export class Structures {
  private readonly scopes: Map<string, string>[] = [new Map()];
  private readonly types = new Map<string, Structure>();
  constructor(private readonly helpers: Map<string, string>) {}
  enter() { this.scopes.push(new Map()); }
  leave() { this.scopes.pop(); }
  lookup(name: string): string | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const type = this.scopes[i]!.get(name); if (type) return type;
    }
    return undefined;
  }
  has(type: string) { return this.types.has(type); }
  declare(token: Token, fields: StructField[]): string {
    if (this.scopes.at(-1)!.has(token.value)) throw new TranslationError(token, `结构体 “${token.value}” 在当前作用域重复声明。`);
    if (!fields.length) throw new TranslationError(token, '结构体至少需要一个成员。');
    const type = `hy_struct_${this.types.size}_${token.value}`;
    this.types.set(type, { name: token.value, type, fields }); this.scopes.at(-1)!.set(token.value, type);
    this.helpers.set(type, `struct ${type} {\n${fields.map(f => '  ' + wgslIdentifier(f.name) + ': ' + f.type + ',').join('\n')}\n}`);
    return type;
  }
  member(token: Token, value: Expression): Expression {
    const info = this.types.get(value.type)!, field = info.fields.find(f => f.name === token.value);
    if (!field) throw new TranslationError(token, `结构体 “${info.name}” 没有成员 “${token.value}”。`);
    const name = wgslIdentifier(field.name), ref = value.reference;
    return { code: `${value.code}.${name}`, type: field.type,
      reference: ref ? { ...ref, members: [...(ref.members ?? []), name] } : undefined };
  }
  construct(token: Token, type: string, args: Expression[]): Expression {
    const info = this.types.get(type)!;
    if (args.length !== info.fields.length) throw new TranslationError(token, `结构体 ${info.name} 构造需要 ${info.fields.length} 个参数，每个成员一个，实际为 ${args.length} 个。`);
    const values = args.map((arg, i) => {
      const field = info.fields[i]!;
      if (field.type === arg.type || (arg.type === 'number' && field.type === 'i32')) return arg.code;
      if (field.type === 'f32' && ['number', 'i32', 'u32'].includes(arg.type)) return `f32(${arg.code})`;
      throw new TranslationError(token, `结构体 ${info.name} 的成员 “${field.name}” 需要 ${field.type}，实际为 ${arg.type}。`);
    });
    return { type, code: `${type}(${values.join(', ')})` };
  }
  /** Global constant selection cannot call helpers or use select on a struct. */
  select(type: string, yes: string, no: string, condition: string): string {
    const info = this.types.get(type);
    if (info) return `${type}(${info.fields.map(f => this.select(f.type, `(${yes}).${wgslIdentifier(f.name)}`, `(${no}).${wgslIdentifier(f.name)}`, condition)).join(', ')})`;
    if (matrix(type)) return `${type}(${Array.from({ length: matrixSize(type).columns }, (_, i) => `select((${no})[${i}], (${yes})[${i}], ${condition})`).join(', ')})`;
    return `select(${no}, ${yes}, ${condition})`;
  }
  compare(token: Token, left: Expression, right: Expression, constant: boolean): Expression {
    if (left.type !== right.type || !this.has(left.type) || !['==', '!='].includes(token.value)) {
      throw new TranslationError(token, '结构体仅支持相同类型之间的 == / != 比较，不能参与算术或逻辑运算。');
    }
    const equal = (type: string, a: string, b: string): string => {
      const info = this.types.get(type);
      if (info) return '(' + info.fields.map(f => equal(f.type, a + '.' + wgslIdentifier(f.name), b + '.' + wgslIdentifier(f.name))).join(' && ') + ')';
      if (matrix(type)) return '(' + Array.from({ length: matrixSize(type).columns }, (_, i) => `all(${a}[${i}] == ${b}[${i}])`).join(' && ') + ')';
      return type.startsWith('vec') ? `all(${a} == ${b})` : `(${a} == ${b})`;
    };
    const name = 'hy_equal_' + left.type;
    // Function arguments evaluate each operand once, even for nested structs.
    if (!constant) this.helpers.set(name, `fn ${name}(a: ${left.type}, b: ${left.type}) -> bool { return ${equal(left.type, 'a', 'b')}; }`);
    const code = constant ? equal(left.type, '(' + left.code + ')', '(' + right.code + ')') : `${name}(${left.code}, ${right.code})`;
    return { type: 'bool', code: token.value === '!=' ? `(!${code})` : code };
  }
}
