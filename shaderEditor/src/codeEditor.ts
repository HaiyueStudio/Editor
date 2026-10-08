import { basicSetup } from 'codemirror';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { setDiagnostics } from '@codemirror/lint';
import { autocompletion } from '@codemirror/autocomplete';
import type { PassId, ShaderDiagnostic } from './model.js';
import { glslParser } from './glslLanguage.js';

export const BUILTINS = ['iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iFrameRate', 'iMouse', 'iDate', 'iSampleRate', 'iChannelResolution', 'iChannelTime', 'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3', 'iSampler', 'channel0', 'channel1', 'channel2', 'channel3'];
const keywords = new Set('fn var let const override struct return if else for while loop continuing break continue switch case default discard enable requires diagnostic true false'.split(' '));
const types = /^(?:[fiub]32|f16|bool|vec[234][fhiu]?|mat[234]x[234][fh]?|array|ptr|atomic|sampler|texture_\w+)$/;
export const wgslParser: StreamParser<{ depth: number }> = {
  startState: () => ({ depth: 0 }),
  token(stream, state) {
    if (state.depth || stream.match('/*')) {
      if (!state.depth) state.depth = 1;
      while (!stream.eol()) { if (stream.match('/*')) state.depth++; else if (stream.match('*/')) { if (--state.depth === 0) break; } else stream.next(); }
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/@\w+/)) return 'meta';
    if (stream.match(/(?:0x[\da-f]+(?:\.[\da-f]*)?(?:p[+-]?\d+)?|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)[fhiu]?/i)) return 'number';
    if (stream.match(/[A-Za-z_]\w*/)) { const token = stream.current(); return keywords.has(token) ? 'keyword' : types.test(token) ? 'typeName' : BUILTINS.includes(token) ? 'variableName.special' : stream.match(/^\s*\(/, false) ? 'variableName.function' : 'variableName'; }
    stream.next(); return 'operator';
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } }, closeBrackets: { brackets: ['(', '[', '{'] } },
};
const colors = HighlightStyle.define([
  { tag: tags.keyword, color: '#c4a5fa' }, { tag: tags.typeName, color: '#8ad9cd' },
  { tag: tags.number, color: '#efbd85' }, { tag: tags.comment, color: '#697789', fontStyle: 'italic' },
  { tag: tags.special(tags.variableName), color: '#aee879' }, { tag: tags.function(tags.variableName), color: '#a6caff' },
  { tag: [tags.meta, tags.macroName], color: '#e6a0b5' }, { tag: tags.string, color: '#b5d68b' },
]);
const editorTheme = EditorView.theme({ '&': { height: '100%', backgroundColor: '#13161d', color: '#d4dbe5', fontSize: '13px' }, '.cm-scroller': { fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace', lineHeight: '1.85' }, '.cm-gutters': { backgroundColor: '#13161d', color: '#505d70', border: 'none' }, '.cm-activeLineGutter': { backgroundColor: '#202630', color: '#b5ef6b' }, '.cm-activeLine': { backgroundColor: '#1b202a80' }, '.cm-cursor': { borderLeftColor: '#b5ef6b' }, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#354251' }, '.cm-content': { padding: '16px 0' }, '.cm-line': { padding: '0 20px' }, '.cm-tooltip': { backgroundColor: '#202630', color: '#d4dbe5', borderColor: '#3a4552' } }, { dark: true });
export class CodeEditor {
  readonly view: EditorView;
  private pass: PassId = 'image';
  private states = new Map<PassId, EditorState>();
  private replacing = false;
  constructor(parent: HTMLElement, onChange: (pass: PassId, code: string) => void, compile: () => void) {
    // Split panes use slots. Mount styles in the actual DOM root, not the split's
    // composed ShadowRoot, whose styles cannot reach slotted editor descendants.
    this.view = new EditorView({ parent, root: parent.getRootNode() as Document | ShadowRoot, state: this.createState('', onChange, compile) });
    this.onChange = onChange; this.compile = compile;
  }
  private readonly onChange: (pass: PassId, code: string) => void;
  private readonly compile: () => void;
  private createState(code: string, onChange: (pass: PassId, code: string) => void, compile: () => void) {
    return EditorState.create({ doc: code, extensions: [basicSetup, StreamLanguage.define(wgslParser), syntaxHighlighting(colors),
      autocompletion({ override: [context => { const word = context.matchBefore(/\w*/); return !word || word.from === word.to && !context.explicit ? null : { from: word.from, options: [...BUILTINS, 'vec2f', 'vec3f', 'vec4f', 'mainImage', 'sin', 'cos', 'tanh', 'mix', 'smoothstep', 'length', 'normalize', 'dot', 'textureSampleLevel'].map(label => ({ label, type: label.startsWith('i') ? 'variable' : 'function' })) }; }] }),
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { compile(); return true; } }])),
      EditorView.contentAttributes.of({ 'aria-label': 'WGSL 代码编辑器', spellcheck: 'false' }),
      EditorView.updateListener.of(update => { if (update.docChanged && !this.replacing) onChange(this.pass, update.state.doc.toString()); }),
      editorTheme] });
  }
  show(pass: PassId, code: string) {
    this.states.set(this.pass, this.view.state); this.pass = pass;
    let state = this.states.get(pass);
    if (!state || state.doc.toString() !== code) state = this.createState(code, this.onChange, this.compile);
    this.replacing = true; this.view.setState(state); this.replacing = false;
  }
  reset() { this.states.clear(); this.replacing = true; this.view.setState(this.createState('', this.onChange, this.compile)); this.replacing = false; }
  diagnostics(diagnostics: ShaderDiagnostic[]) {
    this.view.dispatch(setDiagnostics(this.view.state, diagnostics.filter(d => d.pass === this.pass).map(d => {
      const line = this.view.state.doc.line(Math.max(1, Math.min(this.view.state.doc.lines, d.line)));
      const from = Math.min(line.to, line.from + d.column - 1);
      return { from, to: Math.min(line.to, from + 1), severity: d.severity, message: d.message };
    })));
  }
  focusLine(line: number) { const position = this.view.state.doc.line(Math.max(1, Math.min(line, this.view.state.doc.lines))).from; this.view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) }); this.view.focus(); }
  destroy() { this.view.destroy(); }
}

export class GlslEditor {
  readonly view: EditorView;
  constructor(parent: HTMLElement, onChange: () => void, translate: () => void) {
    this.view = new EditorView({ parent, root: parent.getRootNode() as Document | ShadowRoot,
      state: EditorState.create({ extensions: [basicSetup, StreamLanguage.define(glslParser), syntaxHighlighting(colors), editorTheme,
        placeholder('void mainImage(out vec4 fragColor, in vec2 fragCoord) { ... }'),
        EditorView.contentAttributes.of({ 'aria-label': 'Shadertoy GLSL 源码', spellcheck: 'false' }),
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { translate(); return true; } }])),
        EditorView.updateListener.of(update => { if (update.docChanged) onChange(); }),
      ] }),
    });
  }
  get value() { return this.view.state.doc.toString(); }
  focus() { this.view.requestMeasure(); this.view.focus(); }
  destroy() { this.view.destroy(); }
}

export class WgslPreview {
  readonly view: EditorView;
  constructor(parent: HTMLElement) {
    this.view = new EditorView({ parent, root: parent.getRootNode() as Document | ShadowRoot,
      state: EditorState.create({ extensions: [basicSetup, StreamLanguage.define(wgslParser), syntaxHighlighting(colors), editorTheme,
        EditorState.readOnly.of(true), EditorView.editable.of(false),
        EditorView.contentAttributes.of({ 'aria-label': '转换后的 WGSL 代码', tabindex: '0' }),
      ] }),
    });
  }
  show(code: string) { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: code } }); }
  destroy() { this.view.destroy(); }
}
