import { TranslationError, type Token } from './glslPreprocessor.js';

export type FunctionParameter = { name: string | null; type: string; qualifier: string };
export type FunctionSignature = {
  name: string; emittedName: string; type: string; params: FunctionParameter[]; defined: boolean;
};
type Call = { from: FunctionSignature; to: FunctionSignature; token: Token };
const typeName = (type: string): string => ({ f32: 'float', i32: 'int', u32: 'uint', number: 'int' } as Record<string, string>)[type]
  ?? type.replace(/^vec([234])<bool>$/, 'bvec$1').replace(/^mat([234])x([234])f$/, (_, columns: string, rows: string) => columns === rows ? `mat${columns}` : `mat${columns}x${rows}`).replace(/^vec([234])([fiu])$/, (_, size: string, scalar: string) => `${scalar === 'f' ? '' : scalar}vec${size}`);
const describe = (name: string, params: string[]) => `${name}(${params.map(typeName).join(', ')})`;

/** GLSL ES overloads require exact parameter types; return types never select a candidate. */
export class FunctionTable {
  private readonly entries = new Map<string, FunctionSignature[]>();
  private readonly calls: Call[] = [];

  declare(token: Token, type: string, params: FunctionParameter[], defined: boolean): FunctionSignature {
    const overloads = this.entries.get(token.value) ?? [];
    const previous = overloads.find(fn => fn.params.length === params.length && fn.params.every((p, i) => p.type === params[i]!.type));
    if (previous) {
      if (previous.type !== type) throw new TranslationError(token, `函数 ${describe(token.value, params.map(p => p.type))} 不能仅按返回类型重载。`);
      if (previous.params.some((p, i) => p.qualifier !== params[i]!.qualifier)) throw new TranslationError(token, `函数 ${token.value} 的参数限定符与之前的声明不一致；限定符不能区分重载。`);
      if (previous.defined && defined) throw new TranslationError(token, `函数 ${describe(token.value, params.map(p => p.type))} 重复定义。`);
      if (defined) previous.defined = true;
      return previous;
    }
    const signature: FunctionSignature = {
      name: token.value, type, params, defined,
      // Arity separates the user name from the type suffix, avoiding collisions
      // even for identifiers such as foo_1_f32. Users cannot declare hy_ names.
      emittedName: token.value === 'mainImage' ? 'mainImage' : `hy_fn_${token.value}_${params.length}${params.map(p => `_${p.type.replace(/[^A-Za-z0-9_]/g, '_')}`).join('')}`,
    };
    overloads.push(signature); this.entries.set(token.value, overloads); return signature;
  }

  has(name: string) { return this.entries.has(name); }

  samplerArguments(name: string, types: string[], channels: boolean[]): string[] | null {
    const candidates = (this.entries.get(name) ?? []).filter(fn => fn.params.length === types.length && fn.params.every((p, i) =>
      p.type === (types[i] === 'number' ? 'i32' : types[i]) || (channels[i] && ['sampler2D', 'samplerCube'].includes(p.type))));
    return candidates.length === 1 ? candidates[0]!.params.map(p => p.type) : null;
  }

  resolve(token: Token, types: string[], from: FunctionSignature | null): FunctionSignature | null {
    const overloads = this.entries.get(token.value);
    if (!overloads) return null;
    if (token.value === 'mainImage') throw new TranslationError(token, 'mainImage 是渲染入口，不能作为辅助函数调用。');
    const argumentsTypes = types.map(type => type === 'number' ? 'i32' : type);
    const signature = overloads.find(fn => fn.params.length === argumentsTypes.length && fn.params.every((p, i) => p.type === argumentsTypes[i]));
    if (!signature) {
      const candidates = overloads.slice(0, 8).map(fn => describe(fn.name, fn.params.map(p => p.type))).join('、');
      throw new TranslationError(token, `没有匹配的重载 ${describe(token.value, argumentsTypes)}。已声明：${candidates}${overloads.length > 8 ? '…' : ''}。参数类型必须精确匹配，请使用 float()/int()/vecN() 等显式转换。`);
    }
    if (!from) throw new TranslationError(token, '全局 const 初始化不能调用用户函数。');
    this.calls.push({ from, to: signature, token }); return signature;
  }

  validate() {
    const outgoing = new Map<FunctionSignature, Call[]>();
    for (const call of this.calls) {
      if (!call.to.defined) throw new TranslationError(call.token, `函数 ${describe(call.to.name, call.to.params.map(p => p.type))} 只有声明，缺少定义。`);
      const edges = outgoing.get(call.from) ?? []; edges.push(call); outgoing.set(call.from, edges);
    }
    // Traverse signatures (not just function names): one overload may legally
    // call another overload, but direct or indirect recursion cannot become WGSL.
    const state = new Map<FunctionSignature, 'visiting' | 'done'>();
    for (const overloads of this.entries.values()) for (const start of overloads) {
      if (state.has(start)) continue;
      const stack = [{ fn: start, next: 0 }]; state.set(start, 'visiting');
      while (stack.length) {
        const frame = stack.at(-1)!, edge = outgoing.get(frame.fn)?.[frame.next++];
        if (!edge) { state.set(frame.fn, 'done'); stack.pop(); continue; }
        if (state.get(edge.to) === 'visiting') throw new TranslationError(edge.token, `函数 ${describe(edge.to.name, edge.to.params.map(p => p.type))} 存在递归调用，不能转换为 WGSL。`);
        if (!state.has(edge.to)) { state.set(edge.to, 'visiting'); stack.push({ fn: edge.to, next: 0 }); }
      }
    }
  }
}
