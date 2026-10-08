import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated=source=>{const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.ok(result.code);return result.code;};

test('gl_FragCoord exposes a vec4 captured from the original per-pixel coordinate',()=>{
  const code=translated(main('p=vec2(0.0);vec2 uv=gl_FragCoord.xy/iResolution.xy;c=vec4(uv,gl_FragCoord.z,gl_FragCoord[3]);'));
  assert.match(code,/var<private> hy_gl_frag_coord: vec4f;/);
  assert.match(code,/fn mainImage\(hy_coord: vec2f\) -> vec4f \{\n  hy_gl_frag_coord = vec4f\(hy_coord, 0.5, 1.0\);\n  var p = hy_coord;/);
  assert.match(code,/p = vec2f\(0.0\);[^]*hy_gl_frag_coord.xy/);
  assert.match(code,/vec4f\(uv, hy_gl_frag_coord.z, hy_gl_frag_coord\[3\]\)/);
  assert.doesNotMatch(code,/\bgl_FragCoord\b/);
});

test('helpers and mutable-global initializers see coordinates before mainImage local setup',()=>{
  const code=translated('vec4 coord(){return gl_FragCoord;}vec2 uv=coord().xy/iResolution.xy;'+main('c=vec4(uv,0.0,1.0);'));
  assert.match(code,/return hy_gl_frag_coord;/);
  assert.match(code,/hy_gl_frag_coord = vec4f\(hy_coord, 0.5, 1.0\);\n  hy_init_globals\(\);\n  var p/);
  assert.match(code,/hy_global_uv = \(hy_fn_coord_0\(\).xy \/ iResolution.xy\);/);
});

test('coordinates are only emitted when used, including through macros and late helper definitions',()=>{
  const plain=translated(main('/* gl_FragCoord */c=vec4(1.0);'));
  assert.doesNotMatch(plain,/hy_gl_frag_coord/);
  const macro=translated('#define PIXEL gl_FragCoord\n'+main('c=PIXEL;'));
  assert.equal(macro,translated(main('c=gl_FragCoord;')));
  const late=translated('vec4 coord();'+main('c=coord();')+'vec4 coord(){return gl_FragCoord;}');
  assert.match(late,/hy_gl_frag_coord = vec4f\(hy_coord, 0.5, 1.0\)/);
});

test('gl_FragCoord is readonly and cannot be redeclared or used as a constant initializer',()=>{
  for(const [source,pattern] of [
    [main('gl_FragCoord=vec4(0.0);'),/可写变量/],
    [main('gl_FragCoord.xy=vec2(0.0);'),/可写变量/],
    [main('gl_FragCoord[0]+=1.0;'),/可写变量/],
    [main('++gl_FragCoord.x;'),/可写变量/],
    [main('vec4 gl_FragCoord=vec4(0.0);'),/内置变量/],
    ['vec4 bad(vec4 gl_FragCoord){return gl_FragCoord;}'+main('c=vec4(1.0);'),/内置变量/],
    ['vec4 gl_FragCoord;'+main('c=vec4(1.0);'),/内置变量/],
    ['const vec2 uv=gl_FragCoord.xy;'+main('c=vec4(1.0);'),/不能依赖运行时变量/],
  ]){
    const result=translateGlsl('\n'+source);assert.equal(result.code,null,source);assert.match(result.diagnostics[0].message,pattern,source);assert.equal(result.diagnostics[0].line,2,source);
  }
});

test('the supplied mainImage shape translates with its res alias and a sampler2D dof helper',()=>{
  const code=translated(readFileSync(new URL('./fixtures/fragcoord.glsl',import.meta.url),'utf8'));
  assert.match(code,/var uv: vec2f = \(hy_gl_frag_coord.xy \/ iResolution.xy\)/);
  assert.match(code,/hy_fn_dof_3_sampler2D_vec2f_f32\(iChannel0, uv, channel0\(uv\).w\)/);
});
