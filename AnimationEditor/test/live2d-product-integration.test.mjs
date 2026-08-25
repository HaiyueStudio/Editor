import assert from 'node:assert/strict';
import test from 'node:test';

const subject = await import('../dist-test/live2d-product-integration.js');

test('lazy Live2D importer registers a caller-injected production factory', async () => {
  const registrations = [];
  await subject.live2dClipBakedImportPlugin.activate({
    pluginId: subject.live2dClipBakedImportPlugin.id,
    contributions: { register(contribution) { registrations.push(contribution); return { dispose() {} }; } },
    optionalCapabilities: Object.freeze({}),
    report() {},
    scope: { id: 'test', disposed: false, own(value) { return value; }, defer(dispose) { return dispose; }, assertActive() {}, dispose() {} },
    services: { register() { return { dispose() {} }; }, get() { throw new Error('unused'); }, optional() {}, has() { return false; } },
  });

  assert.equal(registrations.length, 1);
  const contribution = registrations[0];
  assert.equal(contribution.kind, 'importer');
  assert.equal(contribution.id, 'animation.live2d-runtime-asset-set');
  assert.equal(contribution.value.conversionOwnership, 'caller-injected');
  assert.equal(typeof contribution.value.createSession, 'function');
  assert.equal(typeof contribution.value.mount, 'function');

  const converter = Object.freeze({
    id: 'test.converter', version: '1.0.0',
    async convert() { throw new Error('not invoked'); },
  });
  const session = contribution.value.createSession({ converter });
  assert.equal(session.snapshot.phase, 'idle');
  await session.close();
  assert.equal(session.snapshot.phase, 'closed');
});
