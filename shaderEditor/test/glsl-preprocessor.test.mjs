import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessGlsl, TranslationError } from '../dist/glslPreprocessor.js';
import { translateGlsl } from '../dist/glsl.js';

const tokens = source => preprocessGlsl(source).slice(0, -1).map(token => token.value).join(' ');
const shader = body => `void mainImage(out vec4 c,in vec2 p){${body}}`;

test('object macros expand whole tokens, preserve precedence and resolve names at use time', () => {
  assert.equal(tokens(`#define A 1.0 + 2.0
#define B A
#define R iResolution
#define UNUSED
B * 3.0; AA; R.xy; UNUSED
#undef A
#define A 4.0
B; A;`), '1.0 + 2.0 * 3.0 ; AA ; iResolution . xy ; 4.0 ; 4.0 ;');
  assert.equal(tokens('X;\n#define X 1\nX;\n#undef X\nX;'), 'X ; 1 ; X ;');
});

test('parameter macros handle nested calls, comma-containing constructors, aliases and multiline invocations', () => {
  assert.equal(tokens(`#define DOUBLE(x) ((x)+(x))
#define ID(x) x
#define ALIAS DOUBLE
#define ZERO() 0.0
#define PAIR(a,b) vec4(a,b)
PAIR(vec2(1.0,2.0), vec2(3.0,4.0)); ALIAS
(ID(ZERO())); DOUBLE(DOUBLE(1.0));`),
  'vec4 ( vec2 ( 1.0 , 2.0 ) , vec2 ( 3.0 , 4.0 ) ) ; ( ( 0.0 ) + ( 0.0 ) ) ; ( ( ( ( 1.0 ) + ( 1.0 ) ) ) + ( ( ( 1.0 ) + ( 1.0 ) ) ) ) ;');
});

test('comments, continuations, CRLF and adjacent macro parentheses follow preprocessing order', () => {
  const source = [
    '/* #define FAKE 9 */',
    '#define OBJ (2.0)',
    '#define COMMENT/* gap */(3.0)',
    '#define ADD(x,y) ((x) + \\',
    ' (y)) // trailing comment',
    '#define JOINED va\\',
    'lue',
    '#define BLOCK 1.0 /* two',
    ' lines */ + 2.0',
    '// #define IGNORED 8 \\',
    '#define ALSO_IGNORED 7',
    'OBJ COMMENT ADD(1.0,2.0) JOINED BLOCK FAKE IGNORED ALSO_IGNORED',
  ].join('\r\n');
  assert.equal(tokens(source), '( 2.0 ) ( 3.0 ) ( ( 1.0 ) + ( 2.0 ) ) value 1.0 + 2.0 FAKE IGNORED ALSO_IGNORED');
  assert.equal(tokens('#define F\\\n(x) x\nF(2)'), '2');
});

test('empty parameters, unused arguments and macros producing statements are supported', () => {
  assert.equal(tokens(`#define EMPTY
#define ID(x) x
#define IGNORE(x) 1.0
#define NEEDS(a,b) a+b
ID(); IGNORE(NEEDS(1)); EMPTY`), '; 1.0 ;');
  const result = translateGlsl(`#define OUTPUT(x) { c = vec4(x); }
${shader('OUTPUT(0.5)')}`);
  assert.deepEqual(result.diagnostics, []); assert.match(result.code, /c = vec4f\(0.5\)/);
});

test('recursion is suppressed without stopping unrelated macro expansion', () => {
  assert.equal(tokens('#define A B\n#define B A\n#define C 1\nA C'), 'A 1');
  const result = translateGlsl(`#define sin(x) sin(x)
${shader('c = vec4(sin(0.5));')}`);
  assert.deepEqual(result.diagnostics, []); assert.match(result.code, /sin\(0.5\)/);
  assert.equal(translateGlsl(`#define A B\n#define B A\n${shader('c=vec4(A);')}`).code, null);
});

test('identical definitions are accepted and changing a definition requires undef', () => {
  assert.equal(tokens('#define A(x) ((x))\n#define A(x) (( x ))\nA(2)'), '( ( 2 ) )');
  assert.throws(() => tokens('#define A 1\n#define A 2'), /请先 #undef/);
  assert.equal(tokens('#undef MISSING\n#define A 1\n#undef A\n#define A(x) x\nA(2)'), '2');
});

test('source coordinates survive removed directives, expanded macro bodies and continuations', () => {
  const source = '#define VALUE 1.0 + \\\n  2.0\n\n  VALUE;\n  missing;';
  const result = preprocessGlsl(source);
  assert.deepEqual(result.filter(token => ['1.0', '+', '2.0'].includes(token.value)).map(({line,column}) => [line,column]), [[4,3],[4,3],[4,3]]);
  assert.deepEqual(result.filter(token => token.value === 'missing').map(({line,column}) => [line,column]), [[5,3]]);
  assert.deepEqual(translateGlsl('#define A 1.0\n\n' + shader('c = vec4(A);\n c = vec4(unknown);')).diagnostics.map(d => d.line), [4]);
  const argument = preprocessGlsl('#define ID(x) x\nID(\n unknown\n)');
  assert.equal(argument[0].line, 3); assert.equal(argument[0].column, 2);
});

test('invalid macro syntax and unsupported directives fail atomically at the source location', () => {
  for (const [source, message] of [
    ['#define', /宏名称/], ['#define 3 1', /宏名称/],
    ['#define F(x,x) x', /重复/], ['#define F(x,)', /标识符/],
    ['#define F(x', /缺少/], ['#define F(...) 1', /可变参数/],
    ['#define F(a,b) a\nF(1)', /需要 2 个参数/],
    ['#define F(a) a\nF(1,2)', /实际为 2 个/],
    ['#define F(a) a\nF(1', /缺少/],
    ['#define F(a) #a', /字符串化/], ['#define F(a,b) a##b', /拼接/],
    ['#undef A B', /只能有一个/], ['#define GL_FOO 1', /保留/],
    ['float x; #define A 1', /行首/], ['/* missing', /块注释/],
    ['#if 1', /缺少 #endif/], ['#ifdef A', /缺少 #endif/],
    ['#include "other.glsl"', /暂不支持 #include/],
  ]) {
    assert.throws(() => preprocessGlsl('\n' + source), error => error instanceof TranslationError && error.token.line >= 2 && message.test(error.message), source);
    const result = translateGlsl('\n' + source + '\n' + shader('c=vec4(1.0);'));
    assert.equal(result.code, null, source); assert.ok(result.diagnostics[0].line >= 2, source);
  }
});

test('macro expansion and nesting are bounded before reaching the GLSL parser', () => {
  const repeated = '#define A0 1.0\n' + Array.from({length:20}, (_,i) => `#define A${i+1} A${i}+A${i}`).join('\n');
  const bomb = translateGlsl(repeated + '\n' + shader('c=vec4(A20);'));
  assert.equal(bomb.code, null); assert.match(bomb.diagnostics[0].message, /上限/); assert.equal(bomb.diagnostics[0].line, 22);
  const nested = '#define ID(x) x\n' + shader(`c=vec4(${'ID('.repeat(66)}1.0${')'.repeat(66)});`);
  assert.match(translateGlsl(nested).diagnostics[0].message, /嵌套不能超过/);
  const chain = Array.from({length:66}, (_,i) => `#define A${i} A${i+1}`).join('\n');
  assert.match(translateGlsl(chain + '\n' + shader('c=vec4(A0);')).diagnostics[0].message, /引用不能超过/);
});
