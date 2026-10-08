import test from 'node:test';
import assert from 'node:assert/strict';
import { channelRequirements, resolveChannelBindings, channelDiagnostic } from '../dist/channelBindings.js';
import { translateGlsl } from '../dist/glsl.js';
import { createProject, parseProject } from '../dist/model.js';
import { wrapShader } from '../dist/shaders.js';

const main = body => `void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated = source => { const result = translateGlsl(source); assert.deepEqual(result.diagnostics, []); return result.code; };
test('copying translated WGSL preserves cube ABI even when every channel is empty', () => {
  const project = createProject(), pass = project.passes[4];
  pass.code = translated(main('c=texture(iChannel0,reflect(vec3(1.0),vec3(0.0,1.0,0.0)));'));
  assert.match(pass.code, /^\/\/ @haiyue-channel iChannel0 cube\n/);
  const restored = parseProject(JSON.stringify(project)).passes[4];
  const binding = resolveChannelBindings(restored), wrapped = wrapShader(restored);
  assert.deepEqual(binding.dimensions, ['cube','2d','2d','2d']);
  assert.equal(binding.diagnostics.length, 1); assert.equal(binding.diagnostics[0].severity, 'warning');
  assert.match(binding.diagnostics[0].message, /Image.*iChannel0.*黑色占位/);
  assert.match(wrapped.code, /var iChannel0: texture_cube<f32>/);
  assert.match(wrapped.code, /fn channel0\(direction: vec3f\)/);
  assert.equal(wrapped.code.split('\n')[wrapped.lineOffset],pass.code.split('\n')[0]);
  assert.deepEqual(restored.channels,createProject().passes[4].channels);
});

test('textureLod, explicit uniforms and forwarded samplerCube arguments retain all four requirements', () => {
  const pass=createProject().passes[0];
  pass.code=translated('uniform samplerCube iChannel2;vec4 read(samplerCube t,vec3 p){return texture(t,p);}'+main('c=texture(iChannel0,vec3(1.0))+textureLod(iChannel1,vec3(1.0),0.0)+read(iChannel2,vec3(1.0))+textureCube(iChannel3,vec3(1.0));'));
  const result=resolveChannelBindings(pass);
  assert.deepEqual(result.dimensions,['cube','cube','cube','cube']);
  assert.equal(result.diagnostics.length,4);
  assert.ok(result.diagnostics.every(d=>d.severity==='warning' && d.message.includes('Buffer A')));
});

test('binding the required cube clears warnings; image or buffer mismatch never replaces the source', () => {
  const pass=createProject().passes[4];
  pass.code=translated(main('c=texture(iChannel0,vec3(1.0));'));
  for(const channel of [{kind:'image',assetId:'image'},{kind:'buffer',pass:'buffer-a'}]){
    pass.channels[0]=channel;
    const result=resolveChannelBindings(pass);
    assert.equal(result.diagnostics[0].severity,'error');
    assert.match(result.diagnostics[0].message,/Image.*iChannel0.*六面立方体贴图/);
    assert.strictEqual(pass.channels[0],channel);
  }
  pass.channels[0]={kind:'cubemap',assetId:'cube'};
  assert.deepEqual(resolveChannelBindings(pass).diagnostics,[]);
  assert.equal(resolveChannelBindings(pass).dimensions[0],'cube');
});

test('ordinary WGSL and image-only translations retain binding-driven channel types', () => {
  const pass=createProject().passes[4];
  pass.code=translated(main('c=texture(iChannel0,p);'));
  assert.doesNotMatch(pass.code,/@haiyue-channel/);
  assert.deepEqual(resolveChannelBindings(pass).dimensions,['2d','2d','2d','2d']);
  pass.code='fn mainImage(p:vec2f)->vec4f{return channel1(vec3f(1));}';
  pass.channels[1]={kind:'cubemap',assetId:'cube'};
  assert.equal(resolveChannelBindings(pass).dimensions[1],'cube');
  assert.deepEqual(resolveChannelBindings(pass).diagnostics,[]);
});

test('only leading standalone directives count, with nested comments, CRLF and original error positions', () => {
  const code='/*\n// @haiyue-channel iChannel1 cube\n/* nested */\n*/\r\n // @haiyue-channel iChannel0 cube\r\nfn f(){}\n// @haiyue-channel iChannel2 cube';
  const result=channelRequirements(code);
  assert.deepEqual(result.types,['cube',null,null,null]); assert.equal(result.locations[0],5);
  const malformed=channelRequirements('// @haiyue-channel iChannel4 cube\n// @haiyue-channel iChannel0 volume\n');
  assert.equal(malformed.errors.length,2); assert.equal(malformed.errors[1].line,2);
  const conflict=channelRequirements('// @haiyue-channel iChannel0 cube\n// @haiyue-channel iChannel0 2d\n');
  assert.match(conflict.errors[0].message,/冲突/);
  assert.deepEqual(channelRequirements('// @haiyue-channel iChannel0 cube\n// @haiyue-channel iChannel0 cube').errors,[]);
});

test('legacy vec3-to-vec2 channel diagnostics explain the missing binding without rewriting unrelated errors', () => {
  const pass=createProject().passes[4];
  const message="type mismatch for argument 1 in call to 'channel0', expected 'vec2<f32>', got 'vec3<f32>'";
  assert.match(channelDiagnostic(message,pass),/iChannel0.*无纹理.*重新翻译/);
  pass.channels[0]={kind:'buffer',pass:'buffer-b'};
  assert.match(channelDiagnostic(message,pass),/Buffer B/);
  assert.equal(channelDiagnostic('unresolved value unknown',pass),'unresolved value unknown');
});
