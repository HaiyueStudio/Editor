import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated=source=>{const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.ok(result.code);return result.code;};

test('sampler2D parameters become immutable WGSL texture handles and forward through prototypes and overloads',()=>{
  const code=translated(`vec4 read(sampler2D,vec2);vec4 read(vec4 color,vec2 uv){return color;}
vec4 forward(const in highp sampler2D source,vec2 uv){return read(source,uv);}
vec4 read(sampler2D tex,vec2 uv){uv*=0.5;return texture2D(tex,uv);}
${main('c=forward(iChannel0,p/iResolution.xy)+read(vec4(0.0),p);')}`);
  assert.match(code,/fn hy_fn_read_2_sampler2D_vec2f\(tex: texture_2d<f32>, hy_arg_uv: vec2f\)/);
  assert.match(code,/fn hy_fn_forward_2_sampler2D_vec2f\(source: texture_2d<f32>, hy_arg_uv: vec2f\)/);
  assert.match(code,/var uv = hy_arg_uv/);assert.doesNotMatch(code,/var (?:tex|source)\b/);
  assert.match(code,/hy_fn_read_2_sampler2D_vec2f\(source, uv\)/);assert.match(code,/hy_fn_read_2_vec4f_vec2f\(vec4f\(0.0\), p\)/);
  assert.match(code,/textureSampleLevel\(tex, iSampler, vec2f\(uv.x, 1.0 - uv.y\), 0.0\)/);
});

test('explicit builtin uniforms and sampler precision declarations reuse channel bindings',()=>{
  const source=main('c=texture(iChannel0,p)+texture2D(iChannel1,p)+textureLod(iChannel2,p,0.0)+texture(iChannel3,p);');
  const withUniforms='precision mediump sampler2D;\nuniform highp sampler2D iChannel0,iChannel1;\nuniform sampler2D iChannel2,iChannel3;\n'+source;
  assert.equal(translated(withUniforms),translated(source));
  assert.equal(translated('#define SOURCE iChannel0\nuniform sampler2D SOURCE;\n'+main('c=texture(SOURCE,p);')),translated(main('c=texture(iChannel0,p);')));
});

test('a sampler parameter shadowing iChannel0 samples the passed handle instead of the global',()=>{
  const code=translated('vec4 sampleShadow(sampler2D iChannel0,vec2 uv){return texture((iChannel0),uv);}'+main('c=sampleShadow(iChannel1,p)+texture((iChannel0),p);'));
  assert.match(code,/hy_texture_2d\(\(iChannel0\), uv\)/);assert.match(code,/hy_fn_sampleShadow_2_sampler2D_vec2f\(iChannel1, p\)/);
  assert.match(code,/channel0\(p\)/);
});

test('textureLod, textureSize and texelFetch accept sampler parameters and preserve single evaluation',()=>{
  const code=translated('vec4 fetch(sampler2D tex,vec2 uv){int level=0;ivec2 size=textureSize(tex,level++),p=ivec2(0);float lod=0.0;return textureLod(tex,uv++,lod++)+texelFetch(tex,p++,0); }'+main('c=fetch(iChannel3,p);'));
  assert.match(code,/vec2i\(textureDimensions\(tex, hy_update_post_inc_function_i32\(&level\)\)\)/);
  assert.match(code,/hy_texture_lod_2d\(tex, hy_update_post_inc_function_vec2f\(&uv\), hy_update_post_inc_function_f32\(&lod\)\)/);
  assert.match(code,/hy_texel_fetch_2d\(tex, hy_update_post_inc_function_vec2i\(&p\), 0\)/);
  assert.match(code,/textureLoad\(tex, vec2i\(coord.x, i32\(size.y\) - 1 - coord.y\), lod\)/);
  for(const variable of ['level','uv','lod','p'])assert.equal(code.split('&'+variable+')').length-1,1);
});

test('unused sampler arguments and mutable-global initializers retain valid declarations',()=>{
  const code=translated('float ignore(sampler2D){return 1.0;}vec4 read(sampler2D tex){return texture(tex,vec2(0.5));}vec4 color=read(iChannel0);'+main('c=color*ignore(iChannel1);'));
  assert.match(code,/hy_unused_0: texture_2d<f32>/);assert.match(code,/hy_global_color = hy_fn_read_1_sampler2D\(iChannel0\)/);
});

test('invalid sampler declarations, writes, conversions and sampling signatures report GLSL locations',()=>{
  for(const [source,pattern] of [
    ['uniform sampler2D custom;'+main('c=vec4(1.0);'),/iChannel0–3/],
    ['uniform sampler2D iChannel0[2];'+main('c=vec4(1.0);'),/数组/],
    ['uniform sampler2D iChannel0=iChannel1;'+main('c=vec4(1.0);'),/初始化/],
    ['uniform sampler2D iChannel0;uniform sampler2D iChannel0;'+main('c=vec4(1.0);'),/重复声明/],
    ['sampler2D tex;'+main('c=vec4(1.0);'),/uniform/],
    ['sampler2D get(){return iChannel0;}'+main('c=vec4(1.0);'),/返回值/],
    ['void write(out sampler2D tex){}'+main('c=vec4(1.0);'),/只能使用 in/],
    ['void write(sampler2D tex){tex=iChannel0;}'+main('c=vec4(1.0);'),/可写变量/],
    [main('sampler2D tex=iChannel0;'),/局部变量/],
    [main('c=vec4(iChannel0);'),/不能构造或转换/],
    [main('c=texture(vec4(1.0),p);'),/第一个参数/],
    ['uniform sampler2D iChannel0;'+main('c=texture(iChannel0,vec3(p,0.0));'),/类型冲突/],
    [main('c=texture(iChannel0,p,0.0,0.0);'),/需要 2 或 3 个参数/],
    [main('c=textureLod(iChannel0,p,vec2(0.0));'),/层级需要 float/],
    [main('ivec2 size=textureSize(iChannel0,0.0);'),/层级需要 int/],
    [main('c=texelFetch(iChannel0,p,0);'),/ivec2/],
    [main('bool same=iChannel0==iChannel1;'),/不能参与/],
    [main('c=sin(iChannel0);'),/不接受 sampler2D/],
    ['vec4 read(sampler2D tex){return texture(tex,vec2(0.0));}'+main('c=read(vec4(0.0));'),/没有匹配的重载.*sampler2D/],
  ]){
    const result=translateGlsl('\n'+source);assert.equal(result.code,null,source);assert.match(result.diagnostics[0].message,pattern,source);assert.equal(result.diagnostics[0].line,2,source);
  }
});

test('the sampler GPU fixture translates shared image/framebuffer handles and nested sampling calls',()=>{
  translated(readFileSync(new URL('./fixtures/samplers.glsl',import.meta.url),'utf8'));
});
