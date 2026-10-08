import test from 'node:test';
import assert from 'node:assert/strict';
import { translateGlsl } from '../dist/glsl.js';
import { createProject, CUBE_FACES, parseProject, validateProject, channelTypes } from '../dist/model.js';
import { wrapShader } from '../dist/shaders.js';
import { ShaderWorkspace } from '../dist/workspace.js';
const main = body => `void mainImage(out vec4 c,in vec2 p){${body}}`;
const good = (source, options) => { const result = translateGlsl(source, options); assert.deepEqual(result.diagnostics, []); assert.ok(result.code); return result; };

test('the supplied reflected direction infers cubemap without a Shadertoy uniform declaration', () => {
  const result = good(main('vec3 col=vec3(0.1),rd=vec3(0.2,0.3,1.0),n=vec3(0.0,1.0,0.0);float fres=0.5;col=mix(col,texture(iChannel0,reflect(rd,n)).rgb,fres);c=vec4(col,1.0);'));
  assert.equal(result.channelTypes[0], 'cube');
  assert.match(result.code, /channel0\(reflect\(rd, n\)\)/);
  assert.match(result.warnings[0], /iChannel0.*Cubemap/);
  assert.doesNotMatch(result.code, /1\.0 - .*\.y/);
});

test('explicit cube uniforms, four inferred channels and macros settle before WGSL generation', () => {
  const result = good('#define ENV iChannel2\nprecision highp samplerCube;\nuniform samplerCube iChannel0, iChannel1;\n'+main('c=textureCube(iChannel0,vec3(1.0))+textureLod(iChannel1,vec3(1.0),0.0)+texture(ENV,vec3(1.0))+texture(iChannel3,vec3(1.0));'));
  assert.deepEqual(result.channelTypes, ['cube','cube','cube','cube']);
  assert.match(result.code, /textureSampleLevel\(iChannel1, iSampler, uv, lod\)/);
});

test('cube parameters, prototypes, overloads, outputs and lazy captures remain readonly texture handles', () => {
  const result = good(`vec4 read(samplerCube,vec3);
vec4 read(sampler2D t,vec2 uv){return texture(t,uv);}
vec4 read(samplerCube t,vec3 dir){return textureLod(t,dir,0.0);}
void adjust(samplerCube t,vec3 dir,inout vec4 c){c+=dir.x>0.0?read(t,dir):textureCube(t,dir);}
${main('c=vec4(0.0);adjust(iChannel0,vec3(1.0),c);c+=read(iChannel1,p);')}`);
  assert.deepEqual(result.channelTypes, ['cube','2d','2d','2d']);
  assert.match(result.code, /t: texture_cube<f32>/);
  assert.match(result.code, /hy_capture_\d+: texture_cube<f32>/);
  assert.match(result.code, /hy_arg_0: texture_cube<f32>/);
  assert.match(result.code, /hy_fn_read_2_samplerCube_vec3f/);
  assert.match(result.code, /hy_fn_read_2_sampler2D_vec2f/);
  assert.doesNotMatch(result.code, /var t\b|ptr<function, sampler/);
});

test('parameter shadowing never infers or samples the identically named global channel', () => {
  const result = good('vec4 read(samplerCube iChannel0,vec3 d){return texture(iChannel0,d);}'+main('c=read(iChannel1,vec3(1.0))+texture(iChannel0,p);'));
  assert.deepEqual(result.channelTypes, ['2d','cube','2d','2d']);
  assert.match(result.code, /hy_texture_cube\(iChannel0, d\)/);
  assert.match(result.code, /channel0\(p\)/);
});

test('channel hints select cube overloads and cube dimensions without leaking between translations', () => {
  const source='float read(sampler2D t){return 0.0;}float read(samplerCube t){return float(textureSize(t,0).x);}'+main('c=vec4(read(iChannel0));');
  assert.match(good(source,{channelTypes:['cube',null,null,null]}).code,/hy_fn_read_1_samplerCube\(iChannel0\)/);
  assert.match(good(source).code,/hy_fn_read_1_sampler2D\(iChannel0\)/);
  assert.match(good(main('c=vec4(textureSize(iChannel0,0),0,1);'),{channelTypes:['cube',null,null,null]}).code,/vec2i\(textureDimensions/);
  assert.equal(translateGlsl(source,{channelTypes:['cube']}).code,null);
});

test('inconsistent dimensions and illegal opaque operations fail at GLSL locations', () => {
  for (const source of [
    'uniform sampler2D iChannel0;'+main('c=texture(iChannel0,vec3(1.0));'),
    'uniform samplerCube iChannel0;'+main('c=texture(iChannel0,p);'),
    main('c=texture(iChannel0,p)+texture(iChannel0,vec3(1.0));'),
    main('c=texture(iChannel0,vec3(1.0))+texture(iChannel0,p);'),
    'vec4 read(sampler2D t){return texture(t,vec2(0.5));}'+main('c=texture(iChannel0,vec3(1.0))+read(iChannel0);'),
    'samplerCube get(){return iChannel0;}'+main('c=vec4(0.0);'),
    'void set(out samplerCube t){}'+main('c=vec4(0.0);'),
    'struct S{samplerCube t;};'+main('c=vec4(0.0);'),
    main('samplerCube t=iChannel0;'),
    main('c=vec4(iChannel0);'),
    'uniform samplerCube iChannel0;'+main('c=texelFetch(iChannel0,ivec2(0),0);'),
    'vec4 read(samplerCube t){return texture2D(t,vec2(0.0));}'+main('c=read(iChannel0);'),
    'uniform samplerCube iChannel0;'+main('c=textureLod(iChannel0,vec3(1.0),vec2(0.0));'),
  ]) {
    const result=translateGlsl('\n'+source);
    assert.equal(result.code,null,source); assert.equal(result.diagnostics[0].line,2,source);
  }
  assert.match(translateGlsl(main('c=texture(iChannel0,vec3(1.0));'),{channelTypes:['2d',null,null,null]}).diagnostics[0].message,/类型冲突/);
});

function project() {
  const p=createProject(); p.assets.push({id:'cube',name:'Cube',kind:'cubemap',faces:Object.fromEntries(CUBE_FACES.map(f=>[f,'data:image/png;base64,AA==']))});
  p.passes[4].channels[0]={kind:'cubemap',assetId:'cube'}; return p;
}
test('six-face projects round-trip, reject malformed faces/type mismatches and preserve legacy image assets', () => {
  const p=project(); assert.deepEqual(parseProject(JSON.stringify(p)),p);
  for(const mutate of [
    p=>delete p.assets[0].faces.nz,
    p=>p.assets[0].faces.extra='data:image/png;base64,AA==',
    p=>p.assets[0].faces.px='https://example.com/texture.png',
    p=>p.passes[4].channels[0].kind='image',
    p=>p.assets[0].kind='unknown',
  ]) { const invalid=structuredClone(p); mutate(invalid); assert.throws(()=>validateProject(invalid)); }
  p.assets.push({id:'legacy',name:'Legacy',dataUrl:'data:image/png;base64,AA=='});
  p.passes[4].channels[1]={kind:'image',assetId:'legacy'};
  assert.deepEqual(channelTypes(p.passes[4].channels),['cube','2d',null,null]);
  assert.doesNotThrow(()=>validateProject(p));
  p.passes[4].channels[1].kind='cubemap';assert.throws(()=>validateProject(p));
});

test('shader wrappers bind mixed dimensions without shifting user diagnostics', () => {
  const pass=project().passes[4]; pass.code='first\nsecond';
  const result=wrapShader(pass);
  assert.match(result.code,/var iChannel0: texture_cube<f32>/);
  assert.match(result.code,/var iChannel1: texture_2d<f32>/);
  assert.match(result.code,/fn channel0\(direction: vec3f\)/);
  assert.match(result.code,/fn channel1\(uv: vec2f\)/);
  assert.equal(result.code.split('\n')[result.lineOffset],'first');
});

test('API/IPC advertises cube uploads and translates using the selected pass while preserving revisions',async()=>{
  const w=new ShaderWorkspace();await w.start();
  try{
    const p=project();w.open(p);
    const call=(operation,params)=>w.api.execute({apiVersion:'1',requestId:crypto.randomUUID(),operation,documentId:w.document.identity.id,expectedRevision:w.document.revision,params});
    const result=await call('shader.glsl.translate',{pass:'image',code:main('c=texture(iChannel0,vec3(1.0));')});
    assert.equal(result.status,'completed');assert.equal(result.value.channelTypes[0],'cube');
    const revision=w.document.revision;
    const invalid=await call('shader.cubemap.upload',{name:'Missing faces',faces:{}});
    assert.equal(invalid.status,'failed');assert.equal(w.document.revision,revision);
    const invalidBinding=await call('shader.channel.set',{pass:'image',index:1,channel:{kind:'image',assetId:'cube'}});
    assert.equal(invalidBinding.status,'failed');assert.equal(w.document.revision,revision);
    const exported=await call('shader.project.export',{});
    assert.deepEqual(JSON.parse(new TextDecoder().decode(w.api.readResource(exported.value.resourceId))),p);
    w.api.releaseResource(exported.value.resourceId);
    const rpc=await w.platform.rpc.request('cube-test',{jsonrpc:'2.0',id:'1',method:'operations.list',params:{}});
    assert.ok(rpc.result.some(o=>o.descriptor.id==='shader.cubemap.upload'));
  }finally{await w.dispose();}
});
