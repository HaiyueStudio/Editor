import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated=source=>{const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.ok(result.code);return result.code;};

test('switch emits native WGSL cases, with a required default even when GLSL omits it',()=>{
  const code=translated(main('switch(iFrame){case 0:c=vec4(0.25);break;case 2:c=vec4(0.5);break;}'));
  assert.match(code,/switch \(iFrame\)/);assert.match(code,/case 0: \{/);assert.match(code,/case 2: \{/);assert.match(code,/default: \{\}/);
  assert.equal((code.match(/c = vec4f\(0.5\)/g)??[]).length,1,'break prevents copying a later branch');
  assert.doesNotMatch(code,/\bloop\b/);
});

test('fallthrough suffixes preserve conditional break and default in the middle',()=>{
  const code=translated(main('switch(iFrame){case 0:c.x=0.25;default:c.y=0.5;if(iFrame>2)break;case 2:c.z=0.75;break;case 3:c.w=1.0;}'));
  assert.equal((code.match(/c.y = 0.5/g)??[]).length,2);
  assert.equal((code.match(/c.z = 0.75/g)??[]).length,3);
  assert.equal((code.match(/c.w = 1.0/g)??[]).length,1);
  assert.equal((code.match(/if \(\(iFrame > 2\)\) \{ break; \}/g)??[]).length,2);
});

test('adjacent selectors, empty statements, and default aliases merge without extra execution',()=>{
  const code=translated(main('switch(iFrame){case 0:;case 1:default:;c=vec4(0.5);break;case 2:;}'));
  assert.match(code,/case 0, 1, default: \{/);assert.equal((code.match(/c = vec4f\(0.5\)/g)??[]).length,1);
});

test('selector side effects evaluate once; empty switch is valid',()=>{
  const code=translated(main('int i=0;switch(i++){}c=vec4(float(i));'));
  assert.equal((code.match(/hy_update_post_inc_function_i32\(&i\)/g)??[]).length,1);
  assert.match(code,/switch \([^]*?default: \{\}/);
});

test('GLSL case scope hoists renamed storage while keeping initializers at their execution site',()=>{
  const code=translated(main('float x=9.0;switch(iFrame){case 0:float x=2.0,y=x+1.0;case 1:x=4.0;y=5.0;c=vec4(x+y);break;default:break;}c.a=x;'));
  assert.match(code,/var hy_switch_0_local_0: f32;/);assert.match(code,/var hy_switch_0_local_1: f32;/);
  assert.match(code,/hy_switch_0_local_1 = \(hy_switch_0_local_0 \+ 1.0\)/);
  assert.equal((code.match(/hy_switch_0_local_0 = 2.0/g)??[]).length,1);
  assert.match(code,/c.w = x;/);
  const blocks=translated(main('switch(iFrame){case 0:{float x=1.0;c=vec4(x);}break;case 1:{float x=2.0;c=vec4(x);}break;}'));
  assert.doesNotMatch(blocks,/hy_switch_\d+_local/);
});

test('case constants include macros, local/global const, arithmetic, casts, builtins and ternaries',()=>{
  const code=translated('#define BASE (2*3)\nconst int GLOBAL=BASE-1;'+main('const int LOCAL=GLOBAL+2;switch(iFrame){case -1:break;case LOCAL:break;case true?max(8,9):10:break;case int(2.75):break;}'));
  for(const value of [-1,7,9,2])assert.ok(code.includes(`case ${value}: {`));
  const unsigned=translated(main('const uint C=3u;switch(uint(iFrame)){case C:break;case 0u-1u:break;}'));
  assert.match(unsigned,/case 3u: \{/);assert.match(unsigned,/case 4294967295u: \{/);
  const scoped=translated(main('const int C=2;{const int C=3;switch(iFrame){case C:break;}}switch(iFrame){case C:break;}'));
  assert.match(scoped,/case 3: \{/);assert.match(scoped,/case 2: \{/);
});

test('loop continue, nested switches, returns and output parameters keep native control targets',()=>{
  const code=translated('int f(int n,inout float x){for(int i=0;i<3;i++){switch(i){case 0:continue;case 1:switch(n){case 1:x+=1.0;break;default:break;}break;default:return 3;}}return 0;}'+main('float x=0.0;int n=f(0,x);c=vec4(x);'));
  assert.match(code,/case 0: \{\n\s+continue;/);assert.equal((code.match(/\bswitch \(/g)??[]).length,2);
  assert.match(code,/return hy_fn_f_2_i32_f32_result/);assert.doesNotMatch(code,/\bloop\b/);
  const returning=translated('int f(int n){switch(n){case 0:return 1;default:return 2;}}'+main('c=vec4(float(f(0)));'));
  assert.match(returning,/case 0: \{\n\s+return 1;/);assert.match(returning,/default: \{\n\s+return 2;/);
});

test('invalid switches fail atomically with original source positions and useful diagnostics',()=>{
  for(const [body,pattern] of [
    ['switch(iTime){case 0:break;}',/int 或 uint/],
    ['switch(true){}',/int 或 uint/],
    ['switch(vec2(1.0)){}',/int 或 uint/],
    ['switch(iFrame){case 1.0:break;}',/同类型/],
    ['switch(uint(iFrame)){case 1:break;}',/同类型/],
    ['switch(iFrame){case iFrame:break;}',/整数常量/],
    ['int n=2;switch(iFrame){case n:break;}',/整数常量/],
    ['const int n=iFrame;switch(iFrame){case n:break;}',/整数常量/],
    ['const int n=1;{int n=2;switch(iFrame){case n:break;}}',/整数常量/],
    ['switch(iFrame){case 1+1:break;case 2:break;}',/重复/],
    ['switch(iFrame){default:break;default:break;}',/一个 default/],
    ['switch(iFrame){c=vec4(1.0);case 0:break;}',/标签之后/],
    ['switch(iFrame){case 0:}',/最后一个标签/],
    ['switch(iFrame){case 0 break;}',/预期.*:/],
    ['switch(iFrame){case 0:continue;}',/continue 必须位于循环/],
    ['break;',/break 必须位于/],
    ['continue;',/continue 必须位于循环/],
    ['case 0:c=vec4(1.0);',/直接位于 switch/],
    ['switch(iFrame){case 0:{case 1:break;}}',/直接位于 switch/],
    ['switch(iFrame){case 0:float x=0.0;break;case 1:float x=1.0;break;}',/重复声明/],
    ['switch(iFrame){case 0:const float x=1.0;x++;break;}',/不能修改常量/],
    ['switch(iFrame){case 0:float x=1.0;break;}c=vec4(x);',/未知标识符/],
  ]){
    const result=translateGlsl('\n'+main(body));assert.equal(result.code,null,body);assert.match(result.diagnostics[0].message,pattern,body);assert.ok(result.diagnostics[0].line>=2);
  }
});

test('case expansion is bounded while long groups of aliases remain compact',()=>{
  const large=translateGlsl(main('switch(iFrame){'+Array.from({length:200},(_,i)=>`case ${i}:c+=vec4(1.0);`).join('')+'}'));
  assert.equal(large.code,null);assert.match(large.diagnostics[0].message,/展开后超过 100 KB/);
  const aliases=translated(main('switch(iFrame){'+Array.from({length:300},(_,i)=>`case ${i}:`).join('')+'c=vec4(1.0);break;}'));
  assert.equal((aliases.match(/c = vec4f\(1.0\)/g)??[]).length,1);
});

test('complete switch GPU fixture translates control flow, constants, shared scope and side effects',()=>{
  const code=translated(readFileSync(new URL('./fixtures/switches.glsl',import.meta.url),'utf8'));
  assert.match(code,/switch \(/);assert.match(code,/hy_switch_\d+_local/);assert.match(code,/continue;/);
});
