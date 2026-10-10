import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, validateProject, passOf, LIMITS } from '../dist/model.js';
import { wrapShader } from '../dist/shaders.js';
import { resolveChannelBindings } from '../dist/channelBindings.js';
import { ShaderWorkspace } from '../dist/workspace.js';

test('Common persists, upgrades legacy projects, and rejects invalid shared source', () => {
  const project = createProject(); project.common = 'const SCALE = 0.5;';
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
  const legacy = structuredClone(project); delete legacy.common;
  assert.equal(validateProject(legacy).common, ''); assert.equal(legacy.common, undefined);
  for (const common of [null, 17, {}, 'x'.repeat(LIMITS.code + 1)])
    assert.throws(() => validateProject({...project, common}), /Common/);
});
test('shared source and pass source preserve line mappings with or without a final newline', () => {
  const pass = passOf(createProject(), 'image'); pass.code = 'line1\nline2';
  for (const common of ['', 'const A=1;\nfn sampleShared() {}', 'const A=1;\n']) {
    const wrapped = wrapShader(pass, common);
    assert.equal(wrapped.code.split('\n')[wrapped.lineOffset], 'line1');
    assert.deepEqual(wrapped.sourceLocation(wrapped.lineOffset + 2), {pass:'image', line:2});
    if (common) {
      const start = wrapped.lineOffset - common.split('\n').length;
      assert.deepEqual(wrapped.sourceLocation(start + 1), {pass:'common', line:1});
      assert.deepEqual(wrapped.sourceLocation(start + 2), {pass:'common', line:2});
    }
  }
});
test('Common texture requirements merge with local requirements and report source ownership', () => {
  const pass = passOf(createProject(), 'image');
  const common = '// @haiyue-channel iChannel0 cube\nfn sample(d:vec3f)->vec4f{return channel0(d);}';
  assert.equal(resolveChannelBindings(pass, common).dimensions[0], 'cube');
  assert.match(wrapShader(pass, common).code, /iChannel0: texture_cube/);
  pass.code = '// @haiyue-channel iChannel0 2d\n' + pass.code;
  assert.ok(resolveChannelBindings(pass, common).diagnostics.some(d=>d.pass==='image' && d.severity==='error' && d.message.includes('Common')));
  pass.code = 'fn mainImage(p:vec2f)->vec4f{return vec4f(1.0);}';
  pass.channels[0] = {kind:'buffer',pass:'buffer-a'};
  assert.ok(resolveChannelBindings(pass, common).diagnostics.some(d=>d.pass==='common' && d.line===1 && d.severity==='error'));
});
test('Common uses revision-aware API writes, exports, and rejects pass-only operations', async () => {
  const workspace = new ShaderWorkspace(); await workspace.start();
  try {
    const call = (operation,params={},revision=workspace.document.revision)=>workspace.api.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:workspace.document.identity.id,expectedRevision:revision,operation,params});
    const before = workspace.document.revision, code = 'fn sampleShared()->f32{return 0.5;}';
    assert.equal((await call('shader.code.set',{pass:'common',code})).status,'completed');
    assert.equal(workspace.document.revision,before+1);
    await call('shader.code.set',{pass:'common',code}); assert.equal(workspace.document.revision,before+1);
    assert.equal((await call('shader.code.set',{pass:'common',code:''},before)).error.code,'REVISION_CONFLICT');
    assert.equal((await call('shader.query')).value.common,code);
    for (const [operation,params] of [['shader.pass.enable',{pass:'common',enabled:false}],['shader.channel.set',{pass:'common',index:0,channel:{kind:'none'}}]]) {
      assert.equal((await call(operation,params)).status,'failed');
      assert.equal(workspace.document.state.common,code);
    }
    const saved = (await call('shader.project.export')).value;
    await call('shader.code.set',{pass:'common',code:''});
    await call('shader.project.open',{resourceId:saved.resourceId});
    assert.equal(workspace.document.state.common,code);
    workspace.api.releaseResource(saved.resourceId);
  } finally { await workspace.dispose(); }
});
