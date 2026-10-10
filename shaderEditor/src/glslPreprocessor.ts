/** Bounded GLSL macro expansion; tokens retain their original source locations. */
import { evaluateCondition } from './glslConditionalCompilation.js';
import { TranslationError, type Token } from './glslSource.js';
export { TranslationError, type Token } from './glslSource.js';
type PreToken = Token & { start: number; end: number; logicalLine: number; hidden: ReadonlySet<string>; invalid?: boolean };
type Branch = { token: Token; parent: boolean; active: boolean; taken: boolean; otherwise: boolean };
const BUILTINS: Readonly<Record<string, string>> = { GL_ES: '1', GL_FRAGMENT_PRECISION_HIGH: '1', __VERSION__: '300', __FILE__: '0' };
type Macro = { params: string[] | null; body: PreToken[] };
const identifier = (value: string) => /^[A-Za-z_]\w*$/.test(value);
const MAX_WORK = 100_000, MAX_TEXT = 100_000, MAX_DEPTH = 64;

function tokenize(source: string): PreToken[] {
  // GLSL joins backslash-newline pairs before recognizing comments or tokens.
  // Keep physical positions so neither continuations nor removed directives shift diagnostics.
  const chars: string[] = [], lines: number[] = [], columns: number[] = [];
  let line = 1, column = 1;
  const newlineLength = (at: number) => {
    const a = source[at], b = source[at + 1];
    if (a !== '\r' && a !== '\n') return 0;
    return b !== a && (b === '\r' || b === '\n') ? 2 : 1;
  };
  for (let i = 0; i < source.length;) {
    const continuation = source[i] === '\\' ? newlineLength(i + 1) : 0;
    if (continuation) { i += continuation + 1; line++; column = 1; continue; }
    const newline = newlineLength(i);
    chars.push(newline ? '\n' : source[i]!); lines.push(line); columns.push(column);
    if (newline) { i += newline; line++; column = 1; } else { i++; column++; }
  }
  const text = chars.join(''), tokens: PreToken[] = [], hidden = new Set<string>();
  let offset = 0, logicalLine = 1;
  while (offset < text.length) {
    const rest = text.slice(offset);
    const token: PreToken = { value: '', line: lines[offset]!, column: columns[offset]!, start: offset, end: offset, logicalLine, hidden };
    if (rest.startsWith('/*')) {
      const end = text.indexOf('*/', offset + 2);
      if (end < 0) throw new TranslationError(token, '块注释缺少 */。');
      offset = end + 2; continue;
    }
    const match = /^(\s+|\/\/[^\n]*|[A-Za-z_]\w*|0[xX][\da-fA-F]+[uU]?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[uUf]?|"[^"\n]*"|##|<<=|>>=|&=|\^=|\|=|\+\+|--|\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||<<|>>|[{}()[\];,.+\-*/%<>=!?:#&|^~])/.exec(rest);
    // Unrecognized characters in an inactive group (including #error text)
    // are never passed to the GLSL parser. Defer their errors until activation.
    if (!match) token.invalid = true;
    token.value = match?.[0] ?? rest[0]!; offset += token.value.length; token.end = offset;
    if (/^\s/.test(token.value)) logicalLine += token.value.split('\n').length - 1;
    else if (!token.value.startsWith('//')) tokens.push(token);
  }
  tokens.push({ value: '<eof>', line, column, start: text.length, end: text.length, logicalLine, hidden });
  return tokens;
}

class Preprocessor {
  private readonly macros = new Map<string, Macro>();
  private readonly branches: Branch[] = [];
  private get active() { return this.branches.at(-1)?.active ?? true; }
  private defined(name: string) { return this.macros.has(name) || Object.hasOwn(BUILTINS, name) || name === '__LINE__'; }
  private work = 0;
  private textSize = 0;

  run(source: string): Token[] {
    const tokens = tokenize(source), result: Token[] = [];
    let pending: PreToken[] = [];
    const flush = () => { for (const token of this.expand(pending)) result.push(token); pending = []; };
    for (let i = 0; i < tokens.length - 1;) {
      const token = tokens[i]!;
      if (token.value !== '#') { if (this.active) pending.push(token); i++; continue; }
      if (i > 0 && tokens[i - 1]!.logicalLine === token.logicalLine) {
        if (!this.active) { i++; continue; }
        throw new TranslationError(token, '预处理指令必须位于行首（可有空白或注释）。');
      }
      flush();
      const directive: PreToken[] = [];
      for (i++; i < tokens.length - 1 && tokens[i]!.logicalLine === token.logicalLine; i++) directive.push(tokens[i]!);
      this.directive(directive);
    }
    if (this.branches.length) throw new TranslationError(this.branches.at(-1)!.token, '条件编译分支缺少 #endif。');
    flush(); result.push(tokens.at(-1)!); return result;
  }

  private directive(tokens: PreToken[]) {
    const command = tokens[0];
    if (!command) return; // A bare # is an empty directive.
    if (['if', 'ifdef', 'ifndef', 'elif', 'else', 'endif'].includes(command.value)) {
      this.conditional(tokens); return;
    }
    if (!this.active) return;
    if (command.value === 'error') throw new TranslationError(command, '#error: ' + tokens.slice(1).map(t => t.value).join(' '));
    const invalid = tokens.find(t => t.invalid);
    if (invalid) throw new TranslationError(invalid, `无法识别字符 “${invalid.value}”。`);
    if (!['define', 'undef'].includes(command.value)) {
      throw new TranslationError(command, `暂不支持 #${command.value}；当前支持宏定义和 #if/#ifdef/#ifndef/#elif/#else/#endif 条件编译。`);
    }
    const name = tokens[1];
    if (!name || !identifier(name.value)) throw new TranslationError(name ?? command, `#${command.value} 后需要宏名称。`);
    if (name.value === 'defined') throw new TranslationError(name, 'defined 是条件编译运算符，不能定义或取消定义为宏。');
    if (name.value.startsWith('GL_') || name.value.includes('__')) throw new TranslationError(name, 'GL_ 前缀及含 __ 的宏名称由 GLSL 保留。');
    if (command.value === 'undef') {
      if (tokens.length !== 2) throw new TranslationError(tokens[2]!, '#undef 后只能有一个宏名称。');
      this.macros.delete(name.value); return;
    }
    let cursor = 2, params: string[] | null = null;
    // Whitespace/comments between the name and '(' make this an object-like macro.
    if (tokens[cursor]?.value === '(' && tokens[cursor]!.start === name.end) {
      params = []; cursor++;
      if (tokens[cursor]?.value !== ')') {
        while (true) {
          const param = tokens[cursor++];
          if (!param || !identifier(param.value)) throw new TranslationError(param ?? name, '宏参数需要标识符；暂不支持可变参数宏。');
          if (params.includes(param.value)) throw new TranslationError(param, `宏参数 “${param.value}” 重复。`);
          params.push(param.value);
          if (tokens[cursor]?.value !== ',') break;
          cursor++;
        }
      }
      if (tokens[cursor]?.value !== ')') throw new TranslationError(tokens[cursor] ?? name, '宏参数列表缺少 )。');
      cursor++;
    }
    const macro: Macro = { params, body: tokens.slice(cursor) };
    for (const token of macro.body) {
      if (token.value === '#' || token.value === '##') throw new TranslationError(token, '暂不支持宏中的 # 字符串化或 ## 标记拼接。');
    }
    const previous = this.macros.get(name.value);
    const signature = (value: Macro) => JSON.stringify([value.params, value.body.map(token => token.value)]);
    if (previous && signature(previous) !== signature(macro)) throw new TranslationError(name, `宏 “${name.value}” 已有不同定义，请先 #undef。`);
    this.macros.set(name.value, macro);
  }

  private conditional(tokens: PreToken[]) {
    const command = tokens[0]!, name = command.value, args = tokens.slice(1);
    const test = () => evaluateCondition(this.expand(args, 0, true), command);
    if (name === 'if' || name === 'ifdef' || name === 'ifndef') {
      if (this.branches.length >= MAX_DEPTH) throw new TranslationError(command, '条件编译分支嵌套不能超过 64 层。');
      const parent = this.active;
      let selected = false;
      if (parent) {
        if (name === 'if') selected = test();
        else {
          if (args.length !== 1 || !identifier(args[0]!.value)) throw new TranslationError(command, `#${name} 后需要且只能有一个宏名称。`);
          selected = this.defined(args[0]!.value) === (name === 'ifdef');
        }
      }
      this.branches.push({ token: command, parent, active: parent && selected, taken: selected, otherwise: false });
      return;
    }
    const branch = this.branches.at(-1);
    if (!branch) throw new TranslationError(command, `#${name} 没有对应的 #if / #ifdef / #ifndef。`);
    if (name === 'endif') {
      if (args.length) throw new TranslationError(args[0]!, '#endif 后不能有额外内容。');
      this.branches.pop(); return;
    }
    if (branch.otherwise) throw new TranslationError(command, name === 'else' ? '同一条件编译分支不能有多个 #else。' : '#else 后不能再出现 #elif。');
    if (name === 'else') {
      if (args.length) throw new TranslationError(args[0]!, '#else 后不能有额外内容。');
      branch.otherwise = true; branch.active = branch.parent && !branch.taken;
    } else branch.active = branch.parent && !branch.taken && test();
    branch.taken ||= branch.active;
  }

  private expand(input: PreToken[], depth = 0, conditional = false): PreToken[] {
    if (!input.length) return [];
    if (depth > MAX_DEPTH) throw new TranslationError(input[0]!, `宏参数嵌套不能超过 ${MAX_DEPTH} 层。`);
    // Rescan replacements together with the remaining input, so aliases such as
    // '#define COLOR vec4' and '#define APPLY F' also work when followed by (...).
    const pending = input.slice().reverse(), output: PreToken[] = [];
    while (pending.length) {
      const token = pending.pop()!;
      if (++this.work > MAX_WORK) throw new TranslationError(token, '宏展开超过处理上限，请简化宏或减少重复展开。');
      if (token.invalid) throw new TranslationError(token, `无法识别字符 “${token.value}”。`);
      if (conditional && token.value === 'defined') {
        const parenthesized = pending.at(-1)?.value === '(';
        if (parenthesized) pending.pop();
        const name = pending.pop();
        if (!name || !identifier(name.value)) throw new TranslationError(token, 'defined 后需要宏名称，支持 defined NAME 或 defined(NAME)。');
        if (parenthesized && pending.pop()?.value !== ')') throw new TranslationError(token, 'defined(...) 缺少 )。');
        output.push({ ...token, value: this.defined(name.value) ? '1' : '0' }); continue;
      }
      if (token.value === '__LINE__' || Object.hasOwn(BUILTINS, token.value)) {
        output.push({ ...token, value: token.value === '__LINE__' ? String(token.line) : BUILTINS[token.value]! }); continue;
      }
      const macro = this.macros.get(token.value);
      if (!macro || token.hidden.has(token.value) || (macro.params !== null && pending.at(-1)?.value !== '(')) {
        this.textSize += token.value.length + 1;
        if (this.textSize > MAX_TEXT) throw new TranslationError(token, '宏展开后的代码超过 100 KB 处理上限。');
        output.push(token); continue;
      }
      let hidden = new Set(token.hidden);
      const argumentsByName = new Map<string, PreToken[]>();
      if (macro.params !== null) {
        pending.pop(); // opening parenthesis
        const args: PreToken[][] = [[]];
        let nesting = 0, closing: PreToken | undefined;
        while (pending.length) {
          const next = pending.pop()!;
          if (next.value === ')' && nesting === 0) { closing = next; break; }
          if (next.value === ',' && nesting === 0) args.push([]);
          else {
            args.at(-1)!.push(next);
            if (next.value === '(') nesting++;
            if (next.value === ')') nesting--;
          }
        }
        if (!closing) throw new TranslationError(token, `宏 “${token.value}” 的调用缺少 )。`);
        if (macro.params.length === 0 && args.length === 1 && args[0]!.length === 0) args.pop();
        if (args.length !== macro.params.length) throw new TranslationError(token, `宏 “${token.value}” 需要 ${macro.params.length} 个参数，实际为 ${args.length} 个。`);
        hidden = new Set([...hidden].filter(name => closing!.hidden.has(name)));
        macro.params.forEach((name, i) => argumentsByName.set(name, args[i]!));
      }
      hidden.add(token.value);
      if (hidden.size > MAX_DEPTH) throw new TranslationError(token, `宏引用不能超过 ${MAX_DEPTH} 层。`);
      const expandedArguments = new Map<string, PreToken[]>(), replacement: PreToken[] = [];
      for (const part of macro.body) {
        let values: PreToken[];
        if (argumentsByName.has(part.value)) {
          if (!expandedArguments.has(part.value)) expandedArguments.set(part.value, this.expand(argumentsByName.get(part.value)!, depth + 1, conditional));
          values = expandedArguments.get(part.value)!;
        } else values = [{ ...part, line: token.line, column: token.column }];
        for (const value of values) {
          if (++this.work > MAX_WORK) throw new TranslationError(token, '宏展开超过处理上限，请简化宏或减少重复展开。');
          replacement.push({ ...value, hidden: new Set([...hidden, ...value.hidden]) });
        }
      }
      // Suppress recursive re-expansion, as in the GLSL/C preprocessor. A remaining
      // unsupported identifier is diagnosed by the parser, rather than looping.
      for (let i = replacement.length - 1; i >= 0; i--) pending.push(replacement[i]!);
    }
    return output;
  }
}

export function preprocessGlsl(source: string): Token[] { return new Preprocessor().run(source); }
