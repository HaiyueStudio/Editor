import { TranslationError, type Token } from './glslPreprocessor.js';
import type { FunctionParameter, FunctionSignature } from './glslFunctions.js';
import { referenceAccess, writeReference, type Expression } from './glslUpdates.js';
import { wgslType } from './glslTextures.js';

export const outputParameter = (p: FunctionParameter) => p.qualifier === 'out' || p.qualifier === 'inout';
export const hasOutputs = (fn: FunctionSignature) => fn.params.some(outputParameter);
export const outputLocal = (index: number) => `hy_param_${index}`;
export const outputType = (fn: FunctionSignature) => `${fn.emittedName}_result`;
export function outputDeclaration(fn: FunctionSignature): string {
  const fields = fn.type === 'void' ? [] : [`  value: ${fn.type},`];
  fn.params.forEach((p, i) => { if (outputParameter(p)) fields.push(`  out_${i}: ${p.type},`); });
  return `struct ${outputType(fn)} {\n${fields.join('\n')}\n}`;
}
export function outputReturn(fn: FunctionSignature, value?: string): string {
  const outputs = fn.params.flatMap((p, i) => outputParameter(p) ? [outputLocal(i)] : []);
  // Evaluate a return expression before reading the outputs: it may mutate them.
  if (value !== undefined) return `{ let hy_return_value = ${value}; return ${outputType(fn)}(${['hy_return_value', ...outputs].join(', ')}); }`;
  return `return ${outputType(fn)}(${outputs.join(', ')});`;
}

/** GLSL uses independent parameter copies, then copies outputs back on return.
 * Keep calls as expressions so short-circuiting and loop conditions retain their
 * evaluation sites. Only the bridge holds destination pointers, one per root;
 * the user's function receives values and returns an aggregate, never aliases.
 * https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html#function-calling-conventions
 */
export class OutputCalls {
  private serial = 0;
  constructor(private readonly helpers: Map<string, string>) {}

  call(token: Token, fn: FunctionSignature, args: Expression[]): Expression {
    const name = `hy_call_${this.serial++}`;
    const roots = new Map<string, string>();
    const pointerParams: string[] = [], pointerArgs: string[] = [];
    const params: string[] = [], values: string[] = [], inputs: string[] = [], writes: string[] = [];
    fn.params.forEach((p, i) => {
      const arg = args[i]!, param = `hy_arg_${i}`;
      if (!outputParameter(p)) {
        params.push(`${param}: ${wgslType(p.type)}`); values.push(arg.code); inputs.push(param); return;
      }
      const ref = arg.reference;
      if (!ref?.writable) throw new TranslationError(token, `函数 ${fn.name} 的第 ${i + 1} 个 ${p.qualifier} 参数需要可写变量或不重复的向量分量，不能传入常量、只读内置量或临时表达式。`);
      // Access private globals by name, avoiding WGSL pointer/global aliasing
      // when the callee also reads or writes that same global directly.
      let root = ref.root;
      if (ref.space === 'function') {
        let pointer = roots.get(ref.root);
        if (!pointer) {
          pointer = `hy_root_${roots.size}`; roots.set(ref.root, pointer);
          pointerParams.push(`${pointer}: ptr<function, ${ref.type}>`); pointerArgs.push(`&${ref.root}`);
        }
        root = `(*${pointer})`;
      }
      const kinds = (['column', 'index'] as const).filter(kind => ref[kind]);
      const indices = { column: `${param}_column`, index: `${param}_index` };
      if (p.qualifier === 'inout' && kinds.length) {
        // Capture the old value AND dynamic indices at this argument's original
        // position, before later arguments can change either the root or indices.
        const capture = `${name}_capture_${i}`, type = `${capture}_value`;
        const fields = kinds.map(kind => `  ${kind}: ${ref[kind]!.type === 'u32' ? 'u32' : 'i32'},`);
        this.helpers.set(type, `struct ${type} {\n  value: ${p.type},\n${fields.join('\n')}\n}`);
        const indexParams = kinds.map(kind => `${kind}: ${ref[kind]!.type === 'u32' ? 'u32' : 'i32'}`);
        const captureParams = ref.space === 'function' ? [`hy_value: ptr<function, ${ref.type}>`, ...indexParams] : indexParams;
        const captureArgs = ref.space === 'function' ? [`&${ref.root}`] : [];
        captureArgs.push(...kinds.map(kind => ref[kind]!.code));
        const access = referenceAccess(ref, ref.space === 'function' ? '(*hy_value)' : ref.root, { column: 'column', index: 'index' });
        this.helpers.set(capture, `fn ${capture}(${captureParams.join(', ')}) -> ${type} {\n  return ${type}(${[access.target, ...kinds].join(', ')});\n}`);
        params.push(`${param}: ${type}`); values.push(`${capture}(${captureArgs.join(', ')})`); inputs.push(`${param}.value`);
        for (const kind of kinds) indices[kind] = `${param}.${kind}`;
      } else {
        for (const kind of kinds) {
          params.push(`${indices[kind]}: ${ref[kind]!.type === 'u32' ? 'u32' : 'i32'}`); values.push(ref[kind]!.code);
        }
        if (p.qualifier === 'inout') { params.push(`${param}: ${p.type}`); values.push(arg.code); inputs.push(param); }
      }
      writes.push(writeReference(ref, referenceAccess(ref, root, indices), `hy_result.out_${i}`));
    });
    this.helpers.set(name, `fn ${name}(${[...pointerParams, ...params].join(', ')})${fn.type === 'void' ? '' : ` -> ${fn.type}`} {\n  let hy_result = ${fn.emittedName}(${inputs.join(', ')});\n${writes.join('\n')}\n${fn.type === 'void' ? '' : '  return hy_result.value;\n'}}`);
    return { code: `${name}(${[...pointerArgs, ...values].join(', ')})`, type: fn.type };
  }
}
