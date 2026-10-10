import test from 'node:test';
import assert from 'node:assert/strict';
import {preprocessGlsl,TranslationError} from '../dist/glslPreprocessor.js';
import {translateGlsl} from '../dist/glsl.js';
import {readFileSync} from 'node:fs';
const tokens=source=>preprocessGlsl(source).slice(0,-1).map(t=>t.value).join(' ');
const choose=condition=>tokens(`#if ${condition}\nYES\n#else\nNO\n#endif`);
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;

test('if/elif/else select only the first matching branch, including nested groups',()=>{
  assert.equal(tokens('#if 0\nNO\n#elif 2\nYES\n#elif MISSING\nNO\n#else\nNO\n#endif'),'YES');
  assert.equal(tokens('#if 0\n#if MISSING(\nNO\n#else\nNO\n#endif\n#else\n#if 1\nYES\n#else\nNO\n#endif\n#endif'),'YES');
  assert.equal(tokens('#if 0\nNO\n#endif\nALWAYS'),'ALWAYS');
  assert.equal(choose('-7'),'YES');assert.equal(choose('0'),'NO');
});

test('defined operands are not macro-expanded and ifdef/ifndef test existence, not macro value',()=>{
  assert.equal(tokens('#define FLAG 0\n#define EMPTY\n#define FN(x) (x)\n#if defined FLAG && defined(EMPTY) && defined(FN) && !defined(MISSING)\nYES\n#endif\n#ifdef FLAG\nZERO_EXISTS\n#endif\n#ifndef MISSING\nABSENT\n#endif'),'YES ZERO_EXISTS ABSENT');
  assert.equal(tokens('#define ALIAS MISSING\n#if defined(ALIAS) && !defined MISSING\nYES\n#endif'),'YES');
});

test('integer macro expressions honor arithmetic, comparison, bitwise and logical precedence',()=>{
  assert.equal(tokens('#define MODE 2\n#define DOUBLE(x) ((x)*2)\n#define ALIAS DOUBLE\n#if ALIAS(MODE+1)==6 && ((1<<MODE)&4)==4\nYES\n#endif'),'YES');
  for(const expr of ['1+2*3==7','8>>1+1==2','1|2^3&4','-7/3==-2','-7%3==-1','~0==-1','0x10==020 && 0xffU==255u','(0xffffffffu>>31)==1u','1 || 0 && 0','2<3 && 3<=3 && 4>3 && 4>=4 && 1!=2'])assert.equal(choose(expr),'YES',expr);
  assert.equal(choose('3*2==5 || (1&2)'),'NO');
});

test('logical short-circuit suppresses undefined-name, division and shift errors on unevaluated paths',()=>{
  assert.equal(choose('defined(OPTION) && OPTION>0'),'NO');
  assert.equal(choose('!defined(OPTION) || OPTION>0'),'YES');
  assert.equal(choose('0 && (1/0 + UNKNOWN + (1<<32))'),'NO');
  assert.equal(choose('1 || (1%0)'),'YES');
  assert.throws(()=>choose('1 && UNKNOWN'),/未定义的宏/);
  assert.throws(()=>choose('0 || (1/0)'),/除以零/);
});

test('inactive code/directives never expand macros or change definitions',()=>{
  assert.equal(tokens('#define VALUE 2\n#define F(x,y) x+y\n#if 0\n#undef VALUE\n#define VALUE 8\n#define LEAK 1\n#define INVALID(a,b) a##b\n#include "missing.glsl"\n#error 中文消息 ignored\n@ arbitrary unsupported code F(1)\n#endif\n#if VALUE==2 && !defined(LEAK)\nVALUE\n#endif'),'2');
  const code='#define VALUE 1\nVALUE\n#if VALUE\n#undef VALUE\n#define VALUE 2\n#endif\nVALUE\n#if VALUE==2\nYES\n#endif';
  assert.equal(tokens(code),'1 2 YES');
  const source='#if 0\nstruct NotSupported { samplerCube t; };\nvoid mainImage(garbage) {\n#endif\n'+main('c=vec4(1.0);');
  assert.deepEqual(translateGlsl(source).diagnostics,[]);
});

test('GLSL ES import predefines and invocation-based line numbers are available and protected',()=>{
  assert.equal(tokens('#if GL_ES && __VERSION__==300 && GL_FRAGMENT_PRECISION_HIGH && __FILE__==0\nYES\n#endif'),'YES');
  assert.equal(tokens('#define LINE __LINE__\nLINE\n#if __LINE__==3\nYES\n#endif\nLINE'),'2 YES 6');
  for(const name of ['GL_ES','GL_FRAGMENT_PRECISION_HIGH','__VERSION__','__LINE__','__FILE__']){
    assert.equal(tokens(`#ifdef ${name}\nYES\n#endif`),'YES');
    assert.throws(()=>tokens(`#undef ${name}`),/保留/);
  }
});

test('comments, continued conditions, CRLF and surviving diagnostics preserve physical source positions',()=>{
  assert.equal(tokens(['#define A 2','#if defined(A) && \\',' A == 2 // ignored','#define X 3','/*comment*/ #else','NO','#endif','X'].join('\r\n')),'3');
  const source='#if 0\nunknown;\n#else\n'+main('c=vec4(unknown);')+'\n#endif';
  assert.equal(translateGlsl(source).diagnostics[0].line,4);
  assert.equal(preprocessGlsl('#if 1\n  token\n#endif')[0].column,3);
  assert.throws(()=>preprocessGlsl('#define DIV (1/0)\n#if DIV\n#endif'),error=>error instanceof TranslationError && error.token.line===2 && /除以零/.test(error.message));
});

test('malformed directives and conditions fail atomically with source locations',()=>{
  for(const[source,message]of[
    ['#else',/没有对应/],['#elif 1',/没有对应/],['#endif',/没有对应/],
    ['#if 1',/缺少 #endif/],['#if 0\n#else\n#else\n#endif',/多个 #else/],
    ['#if 0\n#else\n#elif 1\n#endif',/#else 后/],['#if 1\n#else junk\n#endif',/额外内容/],
    ['#if 1\n#endif junk',/额外内容/],['#if\n#endif',/完整的整数/],['#ifdef\n#endif',/一个宏名称/],
    ['#ifndef A B\n#endif',/一个宏名称/],['#if defined()\n#endif',/defined 后/],
    ['#if defined(A\n#endif',/缺少/],['#if (1\n#endif',/缺少/],
    ['#if 1.0\n#endif',/整数常量表达式/],['#if true\n#endif',/未定义的宏/],
    ['#if UNKNOWN\n#endif',/未定义的宏/],['#if 1/0\n#endif',/除以零/],
    ['#if 1<<32\n#endif',/0–31/],['#if 1?-1:0\n#endif',/不支持/],
    ['#define EMPTY\n#if EMPTY\n#endif',/完整的整数/],['#if 08\n#endif',/整数常量/],
    ['#if 4294967296\n#endif',/32 位/],['#define defined 1',/运算符/],
    ['#if 1\n#error selected failure\n#endif',/#error: selected failure/],
    ['#if 1\n@\n#endif',/无法识别字符/],
  ]){
    const result=translateGlsl('\n'+source+'\n'+main('c=vec4(1.0);'));
    assert.equal(result.code,null,source);assert.match(result.diagnostics[0].message,message,source);assert.ok(result.diagnostics[0].line>=2);
  }
});

test('condition nesting and macro expansion remain bounded, while skipped bombs are harmless',()=>{
  assert.throws(()=>tokens('#if 0\n'.repeat(65)+'#endif\n'.repeat(65)),/分支嵌套不能超过/);
  assert.throws(()=>choose('('.repeat(65)+'1'+')'.repeat(65)),/表达式嵌套不能超过/);
  const bomb='#define A0 1\n'+Array.from({length:20},(_,i)=>`#define A${i+1} A${i}+A${i}`).join('\n');
  assert.throws(()=>tokens(bomb+'\n#if A20\nYES\n#endif'),/上限/);
  assert.equal(tokens(bomb+'\n#if 0\n#if A20\nNO\n#endif\n#endif\nYES'),'YES');
});

test('integer macro literals keep the same value in conditional and shader expressions',()=>{
  const result=translateGlsl('#define HEX 0xFFu\n#define OCT 010\n#if HEX==255u && OCT==8\n'+main('c=vec4(float(HEX),float(OCT),float(0xffffffff),1.0);')+'\n#endif');
  assert.deepEqual(result.diagnostics,[]);assert.match(result.code,/f32\(255u\)/);assert.match(result.code,/f32\(8\)/);assert.match(result.code,/f32\(-1\)/);
});

test('full conditional-compilation GPU fixture translates only selected functions and shader branches',()=>{
  const result=translateGlsl(readFileSync(new URL('./fixtures/preprocessor-conditions.glsl',import.meta.url),'utf8'));
  assert.deepEqual(result.diagnostics,[]);assert.doesNotMatch(result.code,/unsupported|missing|struct Wrong|#if/);
});
