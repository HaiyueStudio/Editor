import test from 'node:test';
import assert from 'node:assert/strict';
import { translateGlsl } from '../dist/glsl.js';
test('tanh accepts float, literal and vec2/3/4 without changing expression evaluation',()=>{
  const source='const float C=tanh(0.0); float x=0.0; float next(){x+=1.0;return x;} void mainImage(out vec4 c,in vec2 p){float s=tanh(next());vec2 a=tanh(vec2(-1.0,1.0));vec3 b=tanh(vec3(0.0));c=tanh(vec4(s,a,C+b.x+tanh(1)));}';
  const r=translateGlsl(source);assert.equal(r.code!==null,true,JSON.stringify(r.diagnostics));
  assert.match(r.code,/tanh\(hy_fn_next_0\(\)\)/);assert.equal((r.code.match(/tanh\(hy_fn_next_0\(\)\)/g)||[]).length,1);
  for(const size of [2,3,4])assert.match(r.code,new RegExp('tanh\\(vec'+size+'f'));
});
test('invalid tanh argument count and types fail at the original call',()=>{
  for(const args of ['', '1.0,2.0','true','ivec2(1)','mat2(1.0)']){
    const r=translateGlsl('void mainImage(out vec4 c,in vec2 p){\n c=vec4(tanh('+args+'));\n}');
    assert.equal(r.code,null);assert.equal(r.diagnostics[0].line,2);assert.match(r.diagnostics[0].message,/tanh/);
  }
});
