import test from 'node:test';
import assert from 'node:assert/strict';
import { ShaderWorkspace } from '../dist/workspace.js';

test('automation honors revisions, validates channel writes, and round-trips via owned resources', async () => {
  const workspace = new ShaderWorkspace(); await workspace.start();
  try {
    const call = (operation, params = {}, revision = workspace.document.revision) => workspace.api.execute({ apiVersion: '1', requestId: crypto.randomUUID(), operation, documentId: workspace.document.identity.id, expectedRevision: revision, params });
    const original = workspace.document.serialize(), rev = workspace.document.revision;
    const bad = await call('shader.channel.set', {pass:'image',index:4,channel:{kind:'none'}}); assert.equal(bad.status, 'failed'); assert.deepEqual(workspace.document.serialize(), original);
    const invalid = await call('shader.channel.set', {pass:'image',index:0,channel:{kind:'image',assetId:'absent'}}); assert.equal(invalid.status, 'failed'); assert.equal(workspace.document.revision, rev);
    const good = await call('shader.code.set', {pass:'image',code:'fn mainImage(p: vec2f) -> vec4f { return vec4f(1.0); }'}); assert.equal(good.status,'completed');
    const stale = await call('shader.code.set',{pass:'image',code:'invalid'},rev); assert.equal(stale.error.code,'REVISION_CONFLICT');
    assert.equal((await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}})).status,'completed');
    assert.equal(workspace.document.state.passes[0].enabled,true);
    await call('shader.pass.enable',{pass:'buffer-a',enabled:false}); assert.equal(workspace.document.state.passes[4].channels[0].kind,'none');
    const exported = await call('shader.project.export'); assert.equal(exported.status,'completed');
    const bytes = workspace.api.readResource(exported.value.resourceId); assert.equal(JSON.parse(new TextDecoder().decode(bytes)).name,original.name);
    const imported = await call('shader.project.open',{resourceId:exported.value.resourceId}); assert.equal(imported.status,'completed'); workspace.api.releaseResource(exported.value.resourceId);
    const glsl = await call('shader.glsl.translate',{code:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.0);}'}); assert.equal(glsl.status,'completed'); assert.ok(glsl.value.code);
    const discovery = await workspace.platform.rpc.request('test-client',{jsonrpc:'2.0',id:'1',method:'operations.list',params:{}}); assert.ok(discovery.result.some(op=>op.descriptor.id==='shader.compile'));
  } finally { await workspace.dispose(); }
});
