/** Deliberately bounded, tokenized GLSL importer. Unsupported constructs fail with source locations. */
import { preprocessGlsl, TranslationError, type Token } from './glslPreprocessor.js';
import { FunctionTable, type FunctionParameter, type FunctionSignature } from './glslFunctions.js';
import { Updates, discardExpression, type Expression as Expr, type Reference } from './glslUpdates.js';
import { Matrices, MATRIX_TYPES, MATRIX_FUNCTIONS, matrix, matrixSize } from './glslMatrices.js';
import { Textures, TEXTURE_FUNCTIONS, SAMPLER_2D, SAMPLER_CUBE, isSampler, wgslType } from './glslTextures.js';
import { Conditionals, type LocalBinding } from './glslConditionals.js';
import { OutputCalls, outputParameter, hasOutputs, outputLocal, outputType, outputDeclaration, outputReturn } from './glslOutputs.js';
import { lowerSwitch, type SwitchCase, type SwitchScope } from './glslSwitches.js';
import { constantCast, constantUnary, constantBinary, constantBuiltin, type ScalarConstant } from './glslConstants.js';
import { bitwiseBinary, bitwiseUnary, BITWISE_BINARY, BITWISE_ASSIGNMENT } from './glslBitwise.js';
import { predicate, booleanVector, PREDICATE_FUNCTIONS } from './glslPredicates.js';
import { Structures, type StructField } from './glslStructs.js';
import { wgslIdentifier } from './glslNames.js';
import { cubemapRequirements } from './channelBindings.js';
import { ChannelTypes, ChannelRetry, builtinChannel, type TranslationOptions } from './glslChannels.js';
export type { TranslationOptions } from './glslChannels.js';
export interface TranslationResult { code: string | null; diagnostics: { line: number; column: number; message: string }[]; warnings: string[]; channelTypes?: ('2d' | 'cube')[] }
const TYPES: Record<string, string> = { ...MATRIX_TYPES, sampler2D: SAMPLER_2D, samplerCube: SAMPLER_CUBE, void: 'void', float: 'f32', int: 'i32', uint: 'u32', bool: 'bool', bvec2: 'vec2<bool>', bvec3: 'vec3<bool>', bvec4: 'vec4<bool>', vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f', ivec2: 'vec2i', ivec3: 'vec3i', ivec4: 'vec4i', uvec2: 'vec2u', uvec3: 'vec3u', uvec4: 'vec4u' };
const PRIORITY: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const vector = (type: string) => /^vec[234][fiu]$/.test(type) || booleanVector(type);
const scalar = (type: string) => booleanVector(type) ? 'bool' : type.endsWith('i') ? 'i32' : type.endsWith('u') ? 'u32' : 'f32';
const vectorType = (size: string | number, element: string) => element === 'bool' ? `vec${size}<bool>` : `vec${size}${element[0]}`;
const MATH_FUNCTIONS = new Set('sin cos tan tanh asin acos atan abs sign floor ceil round trunc fract exp exp2 log log2 sqrt inversesqrt normalize length distance dot cross reflect refract min max pow clamp mix smoothstep step mod dFdx dFdy fwidth radians degrees'.split(' '));
for (const name of [...MATRIX_FUNCTIONS, ...PREDICATE_FUNCTIONS]) MATH_FUNCTIONS.add(name);
class Parser {
  private index = 0;
  private locals = new Map<string, LocalBinding>();
  private globals = new Map<string, string>([
    ['gl_FragCoord', 'vec4f'], ['iResolution', 'vec3f'], ['iTime', 'f32'], ['iTimeDelta', 'f32'], ['iFrame', 'i32'], ['iFrameRate', 'f32'], ['iMouse', 'vec4f'], ['iDate', 'vec4f'], ['iSampleRate', 'f32'],
    ...[0, 1, 2, 3].map(i => [`iChannel${i}`, SAMPLER_2D] as [string, string]), ['iChannelResolution', 'array:vec3f'], ['iChannelTime', 'array:f32'],
  ]);
  private readonly functions = new FunctionTable();
  private readonly helpers = new Map<string, string>();
  private readonly structures = new Structures(this.helpers);
  private readonly updates = new Updates(this.helpers);
  private readonly outputCalls = new OutputCalls(this.helpers);
  private readonly conditionals = new Conditionals(this.helpers, this.structures);
  private readonly matrices = new Matrices(this.helpers);
  private readonly textures = new Textures(this.helpers, (token, expr, dimension) => {
    const index = builtinChannel(expr);
    if (index !== undefined) this.channels.require(token, index, dimension, expr.type);
  });
  private readonly declaredChannels = new Set<string>();
  private readonly globalNames = new Map<string, string>();
  private readonly globalConstants = new Set<string>();
  private readonly constantValues = new Map<string, ScalarConstant | undefined>();
  private readonly control: ('loop' | 'switch')[] = [];
  private readonly globalInitializers: string[] = [];
  private readonly initializerFunction: FunctionSignature = { name: 'hy_init_globals', emittedName: 'hy_init_globals', type: 'void', params: [], defined: true };
  private constantInitializer = false;
  private usesFragCoord = false;
  private currentFunction: FunctionSignature | null = null;
  private main = false;
  private output = '';
  private returnType = 'void';
  private temporary = 0;
  constructor(private readonly tokens: Token[], private readonly channels: ChannelTypes) {
    for (let i = 0; i < 4; i++) this.globals.set('iChannel' + i, channels.sampler(i));
  }
  private get token() { return this.tokens[this.index]!; }
  private is(value: string) { return this.token.value === value; }
  private take() { return this.tokens[this.index++]!; }
  private eat(value: string) { if (this.is(value)) { this.take(); return true; } return false; }
  private expect(value: string) { if (!this.eat(value)) this.fail(`预期 “${value}”，实际为 “${this.token.value}”。`); }
  private fail(message: string): never { throw new TranslationError(this.token, message); }
  private identifier() { const t = this.take(); if (!/^[A-Za-z_]\w*$/.test(t.value)) throw new TranslationError(t, '预期标识符。'); if (t.value.startsWith('hy_')) throw new TranslationError(t, 'hy_ 前缀由编辑器保留。'); return t.value; }
  private isType(name: string) { return name === 'struct' || Object.hasOwn(TYPES, name) || !!this.structures.lookup(name); }
  private declarationType() {
    return this.isType(this.token.value) && this.tokens[this.index + 1]?.value !== '(' &&
      !(this.structures.lookup(this.token.value) && this.locals.has(this.token.value));
  }
  private type(): string {
    while (['highp', 'mediump', 'lowp'].includes(this.token.value)) this.take();
    if (this.eat('struct')) return this.structure();
    const t = this.take(), type = Object.hasOwn(TYPES, t.value) ? TYPES[t.value] : this.structures.lookup(t.value);
    if (!type) throw new TranslationError(t, `暂不支持类型 “${t.value}”。`); return type;
  }
  private structure(): string {
    const token = this.token;
    if (this.is('{')) this.fail('结构体需要名称，例如 struct Material { vec3 color; };。');
    const name = this.identifier();
    if (Object.hasOwn(TYPES, name) || MATH_FUNCTIONS.has(name) || TEXTURE_FUNCTIONS.has(name) || name.startsWith('gl_') || name === 'mainImage') throw new TranslationError(token, '结构体名称不能使用 GLSL 内置或保留名称。');
    if (!this.currentFunction && (this.functions.has(name) || this.globals.has(name))) throw new TranslationError(token, `结构体 “${name}” 与全局变量或函数重名。`);
    this.expect('{'); const fields: StructField[] = [], names = new Set<string>();
    while (!this.is('}')) {
      if (this.is('<eof>')) this.fail('结构体缺少 }。');
      if (this.is('struct')) this.fail('请先单独定义成员使用的结构体，再通过类型名称声明嵌套成员。');
      const typeToken = this.token, type = this.type();
      if (type === 'void' || isSampler(type)) throw new TranslationError(typeToken, '结构体成员需要值类型，暂不支持 void 或 sampler2D / samplerCube 成员。');
      do {
        const fieldToken = this.token, field = this.identifier();
        if (names.has(field)) throw new TranslationError(fieldToken, `结构体成员 “${field}” 重复声明。`);
        names.add(field);
        if (this.is('[')) this.fail('暂不支持结构体中的数组成员。');
        if (this.is('=')) this.fail('结构体成员不能在类型声明中初始化，请使用结构体构造函数。');
        fields.push({ name: field, type });
      } while (this.eat(','));
      this.expect(';');
    }
    this.expect('}'); return this.structures.declare(token, fields);
  }
  parse() {
    const declarations: string[] = []; let hasMain = false;
    let entry: { index: number; body: string } | undefined;
    while (!this.is('<eof>')) {
      if (this.eat(';')) continue;
      if (this.eat('precision')) { this.take(); this.type(); this.expect(';'); continue; }
      if (this.eat('uniform')) { this.uniform(); continue; }
      const constant = this.eat('const'), structure = this.is('struct'), type = this.type();
      if (structure && this.is(';')) { if (constant) this.fail('const 需要声明变量并提供初始值。'); this.take(); continue; }
      const nameToken = this.token, name = this.identifier();
      if (!this.eat('(')) {
        this.globalDeclaration(declarations, constant, type, nameToken, name); continue;
      }
      if (constant) this.fail('函数不能使用 const。');
      if (isSampler(type)) throw new TranslationError(nameToken, 'sampler2D / samplerCube 只能作为 uniform 或只读函数参数，不能作为返回值。');
      if (this.isType(name) || MATH_FUNCTIONS.has(name) || TEXTURE_FUNCTIONS.has(name) || name.startsWith('gl_')) throw new TranslationError(nameToken, '暂不支持重定义或重载 GLSL 内置函数，请使用其他函数名。');
      if (this.globals.has(name)) throw new TranslationError(nameToken, `函数 “${name}” 与全局变量重名。`);
      const params = this.parameters(), prototype = this.eat(';');
      this.main = name === 'mainImage'; this.returnType = this.main ? 'vec4f' : type;
      if (this.main) {
        if (type !== 'void' || params.length !== 2 || params[0]!.qualifier !== 'out' || params[0]!.type !== 'vec4f' || params[1]!.type !== 'vec2f' || !['in', 'const'].includes(params[1]!.qualifier)) throw new TranslationError(nameToken, '需要 void mainImage(out vec4 color, in vec2 coord)，入口不能重载。');
        if (!prototype) {
          if (params.some(p => p.name === null)) throw new TranslationError(nameToken, 'mainImage 定义需要命名输出颜色和像素坐标参数。');
          hasMain = true; this.output = wgslIdentifier(params[0]!.name!);
        }
      }
      const signature = this.functions.declare(nameToken, type, params, !prototype);
      if (prototype) continue;
      this.currentFunction = signature;
      this.locals = new Map(params.flatMap((p, i) => p.name === null ? [] : [[p.name, { type: p.type, writable: p.qualifier !== 'const' && !isSampler(p.type), code: !this.main && outputParameter(p) ? outputLocal(i) : wgslIdentifier(p.name) }]]));
      const body = this.block();
      this.currentFunction = null; this.locals.clear();
      if (this.main) {
        entry = { index: declarations.length, body: `  var ${wgslIdentifier(params[1]!.name!)} = hy_coord;\n  var ${this.output} = vec4f(0.0);\n${body.slice(1, -1)}\n  return ${this.output};\n}` };
        declarations.push('');
      }
      else {
        // Keep all user parameters as local copies, including out / inout.
        const copies: string[] = [], inputs: string[] = [];
        params.forEach((p, i) => {
          if (outputParameter(p)) {
            copies.push(p.qualifier === 'out' ? `var ${outputLocal(i)}: ${p.type};` : `var ${outputLocal(i)} = hy_arg_${i};`);
            if (p.qualifier === 'inout') inputs.push(`hy_arg_${i}: ${p.type}`);
          } else {
            const input = p.name === null ? `hy_unused_${i}` : p.qualifier === 'const' || isSampler(p.type) ? wgslIdentifier(p.name) : `hy_arg_${p.name}`;
            inputs.push(`${input}: ${wgslType(p.type)}`);
            if (p.name !== null && p.qualifier !== 'const' && !isSampler(p.type)) copies.push(`var ${wgslIdentifier(p.name)} = ${input};`);
          }
        });
        const outputs = hasOutputs(signature), result = outputs ? outputType(signature) : type;
        if (outputs) declarations.push(outputDeclaration(signature));
        const tail = outputs && type === 'void' ? outputReturn(signature) : '';
        declarations.push(`fn ${signature.emittedName}(${inputs.join(', ')})${result === 'void' ? '' : ` -> ${result}`} {\n${copies.join('\n')}\n${body.slice(1, -1)}\n${tail}\n}`);
      }
    }
    if (!hasMain) this.fail('未找到 mainImage(out vec4, in vec2)。');
    this.functions.validate();
    // Delay assembling the entry: globals declared after mainImage still need
    // initialization before its body, after the runtime has populated builtins.
    const initialize = this.globalInitializers.length ? '  hy_init_globals();\n' : '';
    // The playground draws a fullscreen primitive (GLSL clip z=0, w=1),
    // including in material preview mode. Capture coordinates before any user
    // initialization or mutation of mainImage's local coordinate parameter.
    const coordinates = this.usesFragCoord ? '  hy_gl_frag_coord = vec4f(hy_coord, 0.5, 1.0);\n' : '';
    declarations[entry!.index] = `fn mainImage(hy_coord: vec2f) -> vec4f {\n${coordinates}${initialize}${entry!.body}`;
    if (this.usesFragCoord) declarations.unshift('var<private> hy_gl_frag_coord: vec4f;');
    if (initialize) declarations.push(`fn hy_init_globals() {\n${this.globalInitializers.map(s => '  ' + s).join('\n')}\n}`);
    const code = declarations.join('\n\n');
    // Bridges can call other generated helpers or mention generated types.
    // Follow dependencies transitively, while omitting unused update helpers.
    const included = new Set<string>(), pending = [code], generated: string[] = [];
    while (pending.length) {
      const identifiers = new Set(pending.pop()!.match(/[A-Za-z_]\w*/g));
      for (const [name, body] of this.helpers) if (!included.has(name) && identifiers.has(name)) {
        included.add(name); generated.push(body); pending.push(body);
      }
    }
    return [code, ...generated].join('\n\n');
  }
  private uniform() {
    const typeToken = this.token, type = this.type();
    if (!isSampler(type)) throw new TranslationError(typeToken, '内置变量无需声明；自定义 uniform 请改为 WGSL 常量。');
    do {
      const token = this.token, name = this.identifier();
      if (!/^iChannel[0-3]$/.test(name)) throw new TranslationError(token, 'sampler2D / samplerCube uniform 请使用 iChannel0–3，并在通道面板绑定纹理；自定义名称可通过 #define 映射到通道。');
      if (this.is('[')) this.fail('暂不支持 sampler2D / samplerCube 数组；请分别使用 iChannel0–3。');
      if (this.is('=')) this.fail('sampler2D / samplerCube uniform 不能在代码中初始化，请在通道面板绑定纹理。');
      if (this.declaredChannels.has(name)) throw new TranslationError(token, `纹理通道 ${name} 重复声明。`);
      this.declaredChannels.add(name);
      this.channels.require(token, Number(name.at(-1)), type === SAMPLER_CUBE ? 'cube' : '2d', this.globals.get(name)!);
    } while (this.eat(','));
    this.expect(';');
  }
  private globalDeclaration(declarations: string[], constant: boolean, type: string, firstToken: Token, firstName: string) {
    let token = firstToken, name = firstName;
    if (type === 'void') throw new TranslationError(token, '全局变量不能使用 void 类型。');
    if (isSampler(type)) throw new TranslationError(token, 'sampler2D / samplerCube 全局变量需要 uniform，并绑定到 iChannel0–3。');
    while (true) {
      if (this.functions.has(name)) throw new TranslationError(token, `变量 “${name}” 与函数重名。`);
      if (this.globals.has(name)) throw new TranslationError(token, `全局变量 “${name}” 重复声明或与内置变量重名。`);
      if (this.isType(name) || MATH_FUNCTIONS.has(name) || TEXTURE_FUNCTIONS.has(name) || name.startsWith('gl_') || name === 'mainImage') throw new TranslationError(token, `全局变量 “${name}” 使用了保留名称。`);
      if (this.is('[')) this.fail('暂不支持数组声明。');
      let value: string | undefined, constantValue: ScalarConstant | undefined;
      if (this.eat('=')) {
        this.constantInitializer = constant;
        this.currentFunction = constant ? null : this.initializerFunction;
        const expression = this.expression();
        value = this.coerce(expression, type); constantValue = constantCast(expression.constant, type);
        this.currentFunction = null; this.constantInitializer = false;
      } else if (constant) throw new TranslationError(token, '全局 const 必须提供常量初始值。');
      this.globals.set(name, type);
      if (constant) {
        this.globalConstants.add(name); this.constantValues.set(name, constantValue); this.globalNames.set(name, wgslIdentifier(name));
        declarations.push(`const ${wgslIdentifier(name)}: ${type} = ${value};`);
      } else {
        // Separate names preserve references when a parameter or local shadows
        // a global, and keep imported globals clear of the runtime shader ABI.
        const emitted = `hy_global_${name}`;
        this.globalNames.set(name, emitted); declarations.push(`var<private> ${emitted}: ${type};`);
        if (value !== undefined) this.globalInitializers.push(`${emitted} = ${value};`);
      }
      if (!this.eat(',')) break;
      token = this.token; name = this.identifier();
    }
    this.expect(';');
  }
  private parameters(): FunctionParameter[] {
    const params: FunctionParameter[] = [];
    if (this.is('void') && this.tokens[this.index + 1]?.value === ')') this.take();
    else if (!this.is(')')) do {
      let qualifier = 'in', constant = false, direction = false;
      while (['in', 'out', 'inout', 'const'].includes(this.token.value)) {
        const token = this.take();
        if (token.value === 'const') { if (constant) throw new TranslationError(token, 'const 限定符重复。'); constant = true; }
        else { if (direction) throw new TranslationError(token, '参数方向限定符重复。'); direction = true; qualifier = token.value; }
      }
      if (constant && qualifier !== 'in') this.fail('const 不能与 out / inout 一起使用。');
      const type = this.type(); if (type === 'void') this.fail('void 只能单独表示空参数列表。');
      if (isSampler(type) && qualifier !== 'in') this.fail('sampler2D / samplerCube 参数只能使用 in，不能使用 out / inout。');
      const nameToken = this.token, name = this.is(',') || this.is(')') ? null : this.identifier();
      if (name === 'gl_FragCoord') throw new TranslationError(nameToken, 'gl_FragCoord 是只读内置变量，不能声明为函数参数。');
      if (name !== null && params.some(p => p.name === name)) this.fail(`参数 “${name}” 重复。`);
      if (this.is('[')) this.fail('暂不支持数组参数。');
      params.push({ name, type, qualifier: constant ? 'const' : qualifier });
    } while (this.eat(','));
    this.expect(')'); return params;
  }
  private block(): string {
    this.expect('{'); this.structures.enter(); const saved = new Map(this.locals), body: string[] = [];
    while (!this.is('}')) { if (this.is('<eof>')) this.fail('缺少 }。'); const statement = this.statement(); if (statement) body.push(statement); }
    this.expect('}'); this.locals = saved; this.structures.leave(); return `{\n${body.map(s => '  ' + s.replaceAll('\n', '\n  ')).join('\n')}\n}`;
  }
  private statement(): string {
    if (this.eat(';')) return '';
    if (this.is('{')) return this.block();
    if (this.eat('if')) { this.expect('('); const condition = this.expression(); this.expect(')'); const yes = this.body(); const no = this.eat('else') ? ` else ${this.body()}` : ''; return `if (${condition.code}) ${yes}${no}`; }
    if (this.is('switch')) return this.switchStatement();
    if (this.is('case') || this.is('default')) this.fail('case / default 必须直接位于 switch 的语句块中。');
    if (this.eat('for')) {
      const saved = new Map(this.locals); this.structures.enter(); this.expect('('); const init = this.is(';') ? [] : this.simple(); this.expect(';'); const condition = this.is(';') ? { code: 'true' } : this.expression(); this.expect(';'); const update = this.is(')') ? [] : this.simple(); this.expect(')'); const body = this.loopBody(); this.locals = saved; this.structures.leave();
      if (update.length > 1) return `{\n${init.map(s => s + ';').join('\n')}\nloop {\nif (!(${condition.code})) { break; }\n${body}\ncontinuing {\n${update.map(s => s + ';').join('\n')}\n}\n}\n}`;
      const loop = `for (${init.length === 1 ? init[0] : ''}; ${condition.code}; ${update[0] ?? ''}) ${body}`;
      return init.length > 1 ? `{\n${init.map(s => s + ';').join('\n')}\n${loop}\n}` : loop;
    }
    if (this.eat('while')) { this.expect('('); const condition = this.expression(); this.expect(')'); return `while (${condition.code}) ${this.loopBody()}`; }
    if (this.eat('return')) {
      if (this.eat(';')) {
        if (this.main) return `return ${this.output};`;
        if (this.returnType !== 'void') this.fail('非 void 函数的 return 需要返回值。');
        return this.currentFunction && hasOutputs(this.currentFunction) ? outputReturn(this.currentFunction) : 'return;';
      }
      if (this.main) this.fail('GLSL mainImage 应通过 out 参数输出颜色。');
      if (this.returnType === 'void') this.fail('void 函数不能返回值。');
      const value = this.expression(); this.expect(';'); const converted = this.coerce(value, this.returnType);
      return this.currentFunction && hasOutputs(this.currentFunction) ? outputReturn(this.currentFunction, converted) : `return ${converted};`;
    }
    if (['break', 'continue', 'discard'].includes(this.token.value)) {
      const token = this.take(), keyword = token.value;
      if (keyword === 'break' && !this.control.length) throw new TranslationError(token, 'break 必须位于循环或 switch 中。');
      if (keyword === 'continue' && !this.control.includes('loop')) throw new TranslationError(token, 'continue 必须位于循环中；switch 本身不是循环。');
      this.expect(';'); return `${keyword};`;
    }
    const simple = this.simple(); this.expect(';'); return simple.map(s => s + ';').join('\n');
  }
  private loopBody(): string {
    this.control.push('loop'); const body = this.body(); this.control.pop(); return body;
  }
  private switchStatement(): string {
    const token = this.take(); this.expect('('); const selector = this.expression(); this.expect(')');
    const type = selector.type === 'number' ? 'i32' : selector.type;
    if (type !== 'i32' && type !== 'u32') throw new TranslationError(token, 'switch 表达式必须是 int 或 uint 标量。');
    this.expect('{'); this.structures.enter();
    const saved = new Map(this.locals), cases: SwitchCase[] = [], values = new Set<number>();
    const scope: SwitchScope = { prefix: `hy_switch_${this.temporary++}`, declarations: [], names: new Set() };
    let branch: SwitchCase | undefined, hasDefault = false;
    this.control.push('switch');
    while (!this.is('}')) {
      if (this.is('<eof>')) this.fail('switch 缺少 }。');
      if (this.is('case') || this.is('default')) {
        const label = this.take(); let value = 'default';
        if (label.value === 'default') {
          if (hasDefault) throw new TranslationError(label, 'switch 只能有一个 default 分支。');
          hasDefault = true;
        } else {
          const expression = this.expression(), caseType = expression.type === 'number' ? 'i32' : expression.type;
          if (caseType !== type) throw new TranslationError(label, 'case 必须是与 switch 表达式同类型的整数常量（int / uint）。');
          if (typeof expression.constant !== 'number' || !Number.isInteger(expression.constant)) throw new TranslationError(label, 'case 需要可计算的整数常量；支持字面量、常量宏、const、标量转换、算术及三元表达式，不能依赖运行时变量或用户函数。');
          if (values.has(expression.constant)) throw new TranslationError(label, `case 常量值 ${expression.constant} 重复。`);
          values.add(expression.constant);
          value = String(expression.constant) + (type === 'u32' ? 'u' : '');
        }
        this.expect(':'); branch = { selectors: [value], body: [], stops: false, hasStatement: false }; cases.push(branch);
        continue;
      }
      if (!branch) this.fail('switch 的语句必须位于 case / default 标签之后。');
      const first = this.token.value;
      const declaration = first === 'const' || this.declarationType() || ['highp', 'mediump', 'lowp'].includes(first);
      let statement: string;
      if (declaration) { statement = this.simple(scope).map(s => s + ';').join('\n'); this.expect(';'); }
      else statement = this.statement();
      branch.hasStatement = true;
      if (!branch.stops) {
        if (statement) branch.body.push(statement);
        if (['break', 'continue', 'return', 'discard'].includes(first)) branch.stops = true;
      }
    }
    if (branch && !branch.hasStatement) this.fail('switch 的最后一个标签后需要语句；空分支请写 break 或分号。');
    this.expect('}'); this.control.pop(); this.locals = saved; this.structures.leave();
    return lowerSwitch(token, selector.code, cases, scope);
  }
  private body() {
    if (this.is('{')) return this.block();
    const saved = new Map(this.locals); this.structures.enter();
    const statement = this.statement(); this.locals = saved; this.structures.leave();
    return statement ? `{ ${statement} }` : '{}';
  }
  private simple(scope?: SwitchScope): string[] {
    const constant = this.eat('const');
    if (this.declarationType() || ['highp', 'mediump', 'lowp'].includes(this.token.value)) {
      const structure = this.is('struct'), type = this.type();
      if (structure && this.is(';')) { if (constant) this.fail('const 需要声明变量并提供初始值。'); return []; }
      const declarations: string[] = [], names = new Set<string>();
      if (type === 'void') this.fail('变量不能使用 void 类型。');
      if (isSampler(type)) this.fail('sampler2D / samplerCube 不能声明为局部变量，请直接传递 iChannel0–3 或已有的 sampler2D / samplerCube 参数。');
      do {
        const token = this.token, name = this.identifier();
        if (name === 'gl_FragCoord') throw new TranslationError(token, 'gl_FragCoord 是只读内置变量，不能声明为局部变量。');
        if (names.has(name)) throw new TranslationError(token, `同一声明中的变量 “${name}” 重复。`);
        names.add(name);
        if (this.is('[')) this.fail('暂不支持数组声明。');
        const assigned = this.eat('=');
        if (constant && !assigned) throw new TranslationError(token, 'const 必须提供初始值。');
        const expression = assigned ? this.expression() : undefined;
        const initializer = expression ? this.coerce(expression, type) : `${type}()`;
        const constantValue = constant ? constantCast(expression?.constant, type) : undefined;
        if (scope) {
          if (scope.names.has(name)) throw new TranslationError(token, `switch 作用域中的变量 “${name}” 重复声明；请用花括号分隔分支作用域。`);
          scope.names.add(name);
          const code = `${scope.prefix}_local_${scope.declarations.length}`;
          scope.declarations.push(`var ${code}: ${type};`);
          this.locals.set(name, { type, writable: !constant, code, constant: constantValue });
          if (assigned) declarations.push(`${code} = ${initializer}`);
        } else {
          this.locals.set(name, { type, writable: !constant, code: wgslIdentifier(name), constant: constantValue });
          declarations.push(`${constant ? 'let' : 'var'} ${wgslIdentifier(name)}: ${type} = ${initializer}`);
        }
      } while (this.eat(','));
      return declarations;
    }
    if (constant) this.fail('const 后需要类型。');
    // Commas here sequence complete expression statements, unlike the commas
    // inside declarations or call/constructor arguments. Keep every lowered
    // statement in its original branch or loop clause, in source order.
    const statements = this.expressionStatement();
    while (this.eat(',')) statements.push(...this.expressionStatement());
    return statements;
  }
  private expressionStatement(): string[] {
    const lhs = this.expression();
    if (['=', '+=', '-=', '*=', '/='].includes(this.token.value) || BITWISE_ASSIGNMENT.has(this.token.value)) {
      const token = this.take(), operator = token.value, rhs = this.expression();
      if (!lhs.reference?.writable) throw new TranslationError(token, '赋值需要可写变量或不重复的向量分量。');
      if (operator !== '=' && (this.structures.has(lhs.type) || this.structures.has(rhs.type))) throw new TranslationError(token, '结构体仅支持同类型赋值，不能使用复合赋值。');
      if (BITWISE_ASSIGNMENT.has(operator)) {
        const operation = { ...token, value: operator.slice(0, -1) };
        const checked = bitwiseBinary(operation, lhs, rhs);
        if (checked.type !== lhs.type) throw new TranslationError(token, '按位复合赋值的结果类型必须与左侧变量一致。');
        return [this.updates.assign(token, lhs, rhs, (left, right) => bitwiseBinary(operation, left, right))];
      }
      if (matrix(lhs.type) || matrix(rhs.type) || lhs.reference.column || lhs.reference.members) {
        return [this.updates.assign(token, lhs, rhs, (left, right) => {
          if (operator === '=') return { code: this.coerce(right, left.type), type: left.type };
          if (matrix(left.type) || matrix(right.type)) return this.matrices.binary({ ...token, value: operator[0]! }, left, right, true);
          return { code: `(${left.code} ${operator[0]} ${this.coerce(right, left.type)})`, type: left.type };
        })];
      }
      if (!/^[A-Za-z_]\w*(?:\.[xyzwrgba]{1,4}|\[[^\]]+\])?$/.test(lhs.code)) this.fail('暂不支持此赋值目标。');
      const swizzle = /^(\w+)\.([xyzwrgba]{2,4})$/.exec(lhs.code);
      const converted = this.coerce(rhs, lhs.type);
      if (swizzle) {
        const parts = swizzle[2]!.replaceAll('r', 'x').replaceAll('g', 'y').replaceAll('b', 'z').replaceAll('a', 'w');
        if (new Set(parts).size !== parts.length) this.fail('赋值的 swizzle 分量不能重复。');
        const temporary = `hy_swizzle_${this.temporary++}`;
        return [`let ${temporary} = ${operator === '=' ? converted : `(${lhs.code} ${operator[0]} ${converted})`}`, ...[...parts].map((p, i) => `${swizzle[1]}.${p} = ${temporary}.${'xyzw'[i]}`)];
      }
      return [`${lhs.code} ${operator} ${converted}`];
    }
    if (isSampler(lhs.type)) this.fail('sampler2D / samplerCube 只能传递给采样函数或匹配的函数参数。');
    return [discardExpression(lhs)];
  }
  private coerce(expr: Expr, type: string): string {
    if (expr.type === type) return expr.code;
    if (this.structures.has(type) || this.structures.has(expr.type)) this.fail('结构体类型必须一致，不能与数值或其他结构体隐式转换。');
    if (isSampler(expr.type) || isSampler(type)) this.fail('sampler2D / samplerCube 不能与数值类型相互转换。');
    if (matrix(type) || matrix(expr.type)) this.fail(`矩阵类型不匹配：${expr.type} 不能隐式转换为 ${type}，请显式使用矩阵构造函数。`);
    if (vector(type) && !vector(expr.type)) return `${type}(${expr.code})`;
    if (expr.type === 'number') return expr.code;
    if (!vector(type) && !vector(expr.type) && ['i32', 'u32', 'f32'].includes(type)) return `${type}(${expr.code})`;
    return expr.code;
  }
  private expression(min = 0): Expr {
    let lhs = this.unary();
    while ((PRIORITY[this.token.value] ?? -1) >= min) {
      const token = this.take(), op = token.value, rhs = this.expression(PRIORITY[op]! + 1);
      if (this.structures.has(lhs.type) || this.structures.has(rhs.type)) { lhs = this.structures.compare(token, lhs, rhs, this.constantInitializer); continue; }
      if (BITWISE_BINARY.has(op)) { lhs = bitwiseBinary(token, lhs, rhs); continue; }
      if (isSampler(lhs.type) || isSampler(rhs.type)) throw new TranslationError(token, 'sampler2D / samplerCube 不能参与算术、比较或逻辑运算。');
      if (matrix(lhs.type) || matrix(rhs.type)) { lhs = this.matrices.binary(token, lhs, rhs, this.constantInitializer); continue; }
      const type = vector(lhs.type) ? lhs.type : vector(rhs.type) ? rhs.type : lhs.type === 'number' ? rhs.type : lhs.type;
      const left = this.coerce(lhs, type), right = this.coerce(rhs, type);
      if (op === '%' && !['i32', 'u32', 'number'].includes(type)) this.fail('浮点取余请使用 mod()。');
      const comparison = ['<', '>', '<=', '>=', '==', '!=', '&&', '||'].includes(op);
      if (comparison && vector(type)) this.fail('暂不支持向量比较。');
      lhs = { code: `(${left} ${op} ${right})`, type: comparison ? 'bool' : type, constant: constantBinary(op, constantCast(lhs.constant, type), constantCast(rhs.constant, type), type) };
    }
    // ?: binds below every binary operator and associates to the right.
    if (min === 0 && this.is('?')) {
      const token = this.take(), yes = this.expression(); this.expect(':'); const no = this.expression();
      const value = typeof lhs.constant === 'boolean' && yes.constant !== undefined && no.constant !== undefined ? (lhs.constant ? yes.constant : no.constant) : undefined;
      lhs = { ...this.conditionals.lower(token, lhs, yes, no, this.locals, this.constantInitializer), constant: value };
    }
    return lhs;
  }
  private unary(): Expr {
    if (this.is('++') || this.is('--')) { const token = this.take(); return this.updates.lower(token, this.unary(), true); }
    if (this.is('~')) { const token = this.take(); return bitwiseUnary(token, this.unary()); }
    if (['-', '!', '+'].includes(this.token.value)) { const token = this.take(), op = token.value, expr = this.unary();
      if (this.structures.has(expr.type)) throw new TranslationError(token, '结构体不能参与一元运算。');
      if (isSampler(expr.type)) throw new TranslationError(token, 'sampler2D / samplerCube 不能参与一元运算。');
      if (matrix(expr.type)) return this.matrices.unary(token, expr, this.constantInitializer);
      return { code: op === '+' ? expr.code : `(${op}${expr.code})`, type: expr.type, constant: constantUnary(op, expr.constant, expr.type) }; }
    let expr: Expr;
    if (this.eat('(')) { expr = this.expression(); this.expect(')'); expr = { ...expr, code: `(${expr.code})` }; }
    else if (/^(\d|\.\d)/.test(this.token.value)) {
      const token = this.take(); let value = token.value;
      if (/^0[xX]/.test(value) || /^0[0-9]+[uU]?$/.test(value)) {
        const unsigned = /[uU]$/.test(value), digits = value.replace(/[uU]$/, '');
        if (!/^0[xX]/.test(digits) && /[89]/.test(digits)) throw new TranslationError(token, '八进制整数只能包含 0–7。');
        const bits = BigInt(/^0[xX]/.test(digits) ? digits : '0o' + digits.slice(1));
        if (bits > 0xffffffffn) throw new TranslationError(token, '整数文字不能超过 32 位。');
        value = String(unsigned ? bits : BigInt.asIntN(32, bits)) + (unsigned ? 'u' : '');
      }
      value = value.replace(/U$/, 'u');
      expr = { code: value.replace(/f$/, '').replace(/\.(?=$|[eE])/, '.0'), type: value.endsWith('u') ? 'u32' : /[.eEf]/.test(value) ? 'f32' : 'number' };
      expr.constant = constantCast(Number(value.replace(/[uf]$/, '')), expr.type);
    }
    else {
      const nameToken = this.token, name = this.identifier();
      if (this.eat('(')) { const args: Expr[] = []; if (!this.is(')')) do { args.push(this.expression()); } while (this.eat(',')); this.expect(')'); expr = this.call(nameToken, args); }
      else {
        const local = this.locals.get(name), type = local?.type ?? this.globals.get(name) ?? (['true', 'false'].includes(name) ? 'bool' : null);
        if (!type) throw new TranslationError(nameToken, `未知标识符 “${name}”。请先定义函数或变量。`);
        if (this.constantInitializer && this.globals.has(name) && !this.globalConstants.has(name)) throw new TranslationError(nameToken, `全局 const 的初始值不能依赖运行时变量 “${name}”；请移除 const。`);
        if (name === 'gl_FragCoord') this.usesFragCoord = true;
        const code = local ? local.code ?? name : name === 'gl_FragCoord' ? 'hy_gl_frag_coord' : this.globalNames.get(name) ?? name;
        const reference: Reference | undefined = local || this.globals.has(name)
          ? { root: code, type, space: local ? 'function' : 'private', writable: local ? local.writable : this.globalNames.has(name) && !this.globalConstants.has(name) }
          : undefined;
        expr = { code, type, reference, constant: local ? local.constant : name === 'true' ? true : name === 'false' ? false : this.constantValues.get(name) };
      }
    }
    while (this.is('.') || this.is('[') || this.is('++') || this.is('--')) {
      if (this.eat('.')) {
        const fieldToken = this.token, field = this.identifier();
        if (this.structures.has(expr.type)) { expr = this.structures.member(fieldToken, expr); continue; }
        if (!vector(expr.type) || !/^(?:[xyzw]{1,4}|[rgba]{1,4})$/.test(field)) this.fail('暂只支持向量 swizzle。');
        const canonical = field.replaceAll('r', 'x').replaceAll('g', 'y').replaceAll('b', 'z').replaceAll('a', 'w');
        if ([...canonical].some(c => 'xyzw'.indexOf(c) >= Number(expr.type[3]))) this.fail('swizzle 分量超出向量范围。');
        const ref = expr.reference, parts = ref?.components ?? 'xyzw';
        const components = [...canonical].map(c => parts['xyzw'.indexOf(c)]).join('');
        expr = { code: `${expr.code}.${canonical}`, type: field.length === 1 ? scalar(expr.type) : vectorType(field.length, scalar(expr.type)),
          reference: ref ? { ...ref, components, writable: ref.writable && new Set(components).size === components.length } : undefined };
      } else if (this.eat('[')) {
        const index = this.expression(); this.expect(']');
        if (!matrix(expr.type) && !vector(expr.type) && !expr.type.startsWith('array:')) this.fail('下标仅支持矩阵、向量或内置数组。');
        if (!['i32', 'u32', 'number'].includes(index.type)) this.fail('下标需要整数标量。');
        const isMatrix = matrix(expr.type);
        expr = { code: `${expr.code}[${index.code}]`, type: isMatrix ? `vec${matrixSize(expr.type).rows}f` : expr.type.startsWith('array:') ? expr.type.slice(6) : scalar(expr.type),
          reference: expr.reference ? { ...expr.reference, ...(isMatrix ? { column: index } : { index }) } : undefined };
      } else expr = this.updates.lower(this.take(), expr, false);
    }
    return expr;
  }
  private call(token: Token, args: Expr[]): Expr {
    const name = token.value;
    if (this.locals.has(name) || this.globals.has(name)) throw new TranslationError(token, `“${name}” 是变量，不能作为函数调用。`);
    const structure = this.structures.lookup(name);
    if (structure) return this.structures.construct(token, structure, args);
    if (Object.hasOwn(TYPES, name) && TYPES[name] !== 'void') {
      if (args.some(a => this.structures.has(a.type))) throw new TranslationError(token, '结构体不能转换为标量、向量或矩阵。');
      const type = TYPES[name]!;
      if (isSampler(type) || args.some(a => isSampler(a.type))) throw new TranslationError(token, 'sampler2D / samplerCube 不能构造或转换为其他类型。');
      if (matrix(type)) return this.matrices.construct(token, type, args, this.constantInitializer);
      if (args.some(a => matrix(a.type))) return this.matrices.convert(token, type, args, this.constantInitializer);
      if (vector(type)) {
        if (args.length === 1 && vector(args[0]!.type)) {
          const arg = args[0]!, truncate = Number(type[3]) < Number(arg.type[3]);
          const code = truncate ? `${arg.code}.${'xyzw'.slice(0, Number(type[3]))}` : arg.code;
          return { code: truncate && scalar(type) === scalar(arg.type) ? code : `${type}(${code})`, type };
        }
        // GLSL vector constructors convert every supplied component. WGSL
        // multi-argument constructors require already matching scalar types.
        const components = args.map(arg => {
          const target = vector(arg.type) ? vectorType(arg.type[3]!, scalar(type)) : scalar(type);
          return arg.type === target || arg.type === 'number' ? arg.code : `${target}(${arg.code})`;
        });
        return { code: `${type}(${components.join(', ')})`, type };
      }
      return { code: `${type}(${args.map(a => a.code).join(', ')})`, type, constant: args.length === 1 ? constantCast(args[0]!.constant, type) : undefined };
    }
    if ((TEXTURE_FUNCTIONS.has(name) || PREDICATE_FUNCTIONS.has(name)) && args.some(a => this.structures.has(a.type))) throw new TranslationError(token, `函数 ${name} 不接受结构体参数。`);
    if (TEXTURE_FUNCTIONS.has(name)) return this.textures.call(token, args);
    if (PREDICATE_FUNCTIONS.has(name)) return predicate(token, args);
    const inferred = this.functions.samplerArguments(name, args.map(a => a.type), args.map(a => builtinChannel(a) !== undefined));
    if (inferred) inferred.forEach((type, i) => {
      const index = builtinChannel(args[i]!);
      if (index !== undefined && isSampler(type)) this.channels.require(token, index, type === SAMPLER_CUBE ? 'cube' : '2d', args[i]!.type);
    });
    const signature = this.functions.resolve(token, args.map(a => a.type), this.currentFunction);
    if (signature && hasOutputs(signature)) return this.outputCalls.call(token, signature, args);
    if (signature) return { code: `${signature.emittedName}(${args.map((a, i) => this.coerce(a, signature.params[i]!.type)).join(', ')})`, type: signature.type };
    if (args.some(a => this.structures.has(a.type))) throw new TranslationError(token, `函数 ${name} 不接受结构体参数。`);
    if (args.some(a => isSampler(a.type))) throw new TranslationError(token, `函数 ${name} 不接受 sampler2D / samplerCube 参数。`);
    if (MATRIX_FUNCTIONS.has(name)) return this.matrices.call(token, args, this.constantInitializer);
    if (args.some(a => matrix(a.type))) throw new TranslationError(token, `函数 ${name} 不接受矩阵参数。`);
    if (!MATH_FUNCTIONS.has(name) || !args.length) throw new TranslationError(token, `暂不支持或未声明函数 “${name}”，请先定义辅助函数或声明其原型。`);
    if (name === 'tanh' && (args.length !== 1 || !['number', 'f32', 'vec2f', 'vec3f', 'vec4f'].includes(args[0]!.type)))
      throw new TranslationError(token, 'tanh 需要一个 float 或 vec2/vec3/vec4 参数。');
    const type = args.find(a => vector(a.type))?.type ?? args.find(a => a.type !== 'number')?.type ?? (['abs', 'sign', 'min', 'max', 'clamp'].includes(name) ? 'i32' : 'f32');
    if (name === 'mod') {
      if (args.length !== 2) this.fail('mod 需要两个参数。');
      const x = this.coerce(args[0]!, type), y = this.coerce(args[1]!, type);
      const helper = `hy_mod_${type}`;
      this.helpers.set(helper, `fn ${helper}(x: ${type}, y: ${type}) -> ${type} {\n  return x - y * floor(x / y);\n}`);
      return { code: `${helper}(${x}, ${y})`, type };
    }
    const mapped = ({ inversesqrt: 'inverseSqrt', dFdx: 'dpdx', dFdy: 'dpdy' } as Record<string, string>)[name] ?? (name === 'atan' && args.length === 2 ? 'atan2' : name);
    const scalarResult = ['length', 'distance', 'dot'].includes(name);
    const call = `${mapped}(${args.map((a, i) => name === 'refract' && i === 2 ? a.code : this.coerce(a, type)).join(', ')})`;
    // WebGPU framebuffer Y points downward, GLSL/Shadertoy framebuffer Y upward.
    return { code: name === 'dFdy' ? `(-${call})` : call, type: scalarResult ? 'f32' : type, constant: constantBuiltin(name, args.map(a => a.constant), type) };
  }
}
export function translateGlsl(source: string, options: TranslationOptions = {}): TranslationResult {
  if (source.length > 100_000) return { code: null, diagnostics: [{ line: 1, column: 1, message: 'GLSL 不能超过 100 KB。' }], warnings: [] };
  try {
    const tokens = preprocessGlsl(source), channels = new ChannelTypes(options);
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      try { code = new Parser(tokens, channels).parse(); break; }
      catch (error) { if (!(error instanceof ChannelRetry) || attempt === 4) throw error; }
    }
    const channelTypes = channels.types.map(t => t ?? '2d');
    code = cubemapRequirements(channelTypes) + code;
    const cubeWarnings = channelTypes.flatMap((t, i) => t === 'cube' ? [`iChannel${i} 使用 Cubemap，请在该 Pass 的通道面板绑定六面立方体贴图。`] : []);
    return { code, channelTypes, diagnostics: [], warnings: [...cubeWarnings,'支持 #define 常量宏/带参数宏、#undef、#if/#ifdef/#ifndef/#elif/#else/#endif 条件编译及 defined、标量/向量/矩阵/结构体全局变量、具名结构体（含嵌套成员、构造、成员读写、参数与返回值）、矩阵构造、乘法、索引与常用矩阵函数、函数重载与原型、辅助函数 out/inout 参数、惰性三元表达式、整数移位及按位运算、isnan/isinf 与布尔向量、条件、for/while、switch/case/default（含贯穿执行）、只读 gl_FragCoord、sampler2D / samplerCube 函数参数及 texture/texture2D/textureCube/textureLod/textureSize/texelFetch。可变全局变量按像素独立初始化；重载按 GLSL ES 参数类型精确匹配并改名。WGSL 保留名称自动改名并同步引用。不支持 include、宏标记拼接/字符串化、数组声明及含 sampler2D / samplerCube 的结构体。转换后需通过 WGSL 编译；不保证与原作逐像素一致。'] }; }
  catch (error) { return { code: null, diagnostics: [{ line: error instanceof TranslationError ? error.token.line : 1, column: error instanceof TranslationError ? error.token.column : 1, message: error instanceof Error ? error.message : String(error) }], warnings: [] }; }
}
