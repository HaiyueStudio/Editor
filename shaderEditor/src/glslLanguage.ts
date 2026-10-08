import type { StreamParser } from '@codemirror/language';

export const GLSL_BUILTINS = ['iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iFrameRate', 'iMouse', 'iDate', 'iSampleRate', 'iChannelResolution', 'iChannelTime', 'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3'];
const keywords = new Set('const uniform in out inout attribute varying buffer shared coherent volatile restrict readonly writeonly layout centroid flat smooth noperspective patch sample invariant precise precision highp mediump lowp if else switch case default for while do break continue return discard struct true false'.split(' '));
const types = /^(?:void|bool|int|uint|float|double|[biud]?vec[234]|d?mat[234](?:x[234])?|[iu]?(?:sampler|image)(?:1D|2D|3D|Cube|2DRect|Buffer)(?:Array)?(?:MS)?(?:Shadow)?|atomic_uint)$/;
type State = { blockComment: boolean; macros: Set<string>; macroName: 'define' | 'undef' | null; continued: boolean };

/** Highlight GLSL independently of the bounded translation subset. */
export const glslParser: StreamParser<State> = {
  startState: () => ({ blockComment: false, macros: new Set(), macroName: null, continued: false }),
  copyState: state => ({ ...state, macros: new Set(state.macros) }),
  blankLine(state) { state.macroName = null; state.continued = false; },
  token(stream, state) {
    if (stream.sol()) { if (!state.continued) state.macroName = null; state.continued = false; }
    if (state.blockComment || stream.match('/*')) {
      state.blockComment = true;
      while (!stream.eol()) { if (stream.match('*/')) { state.blockComment = false; break; } stream.next(); }
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/#\s*[A-Za-z_]\w*/)) {
      const directive = stream.current().replace(/^#\s*/, '');
      state.macroName = directive === 'define' || directive === 'undef' ? directive : null;
      return 'meta';
    }
    if (stream.match(/\\$/)) { state.continued = true; return 'meta'; }
    if (stream.match(/"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/(?:0x[\da-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:lf|[fu])?/i)) return 'number';
    if (stream.match(/[A-Za-z_]\w*/)) {
      const token = stream.current();
      if (state.macroName) {
        if (state.macroName === 'define') state.macros.add(token); else state.macros.delete(token);
        state.macroName = null; return 'macroName';
      }
      if (state.macros.has(token)) return 'macroName';
      return keywords.has(token) ? 'keyword' : types.test(token) ? 'typeName'
        : GLSL_BUILTINS.includes(token) || token.startsWith('gl_') ? 'variableName.special'
        : stream.match(/^\s*\(/, false) ? 'variableName.function' : 'variableName';
    }
    stream.next(); return 'operator';
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } }, closeBrackets: { brackets: ['(', '[', '{'] } },
};
