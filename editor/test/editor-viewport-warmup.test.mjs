import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorRendererWarmupDegradationPolicy,
  disableOptionalRendererCapability,
} from '../dist-test/testing.js';

test('editor warmup degrades optional renderers once and preserves required failures', () => {
  const disabled = [];
  const policy = createEditorRendererWarmupDegradationPolicy(capability => disabled.push(capability));
  const volumeError = new Error('volume shader failed');

  assert.equal(policy.tolerate(volumeError, {
    id: 'VolumeRenderer#1:normal',
    label: 'Volume normal',
    owner: 'VolumeRenderer',
    compile: async () => {},
  }), true);
  assert.equal(policy.tolerate(new Error('second volume variant failed'), {
    id: 'VolumeRenderer#1:additive',
    label: 'Volume additive',
    owner: 'VolumeRenderer',
    compile: async () => {},
  }), true);
  assert.equal(policy.tolerate(new Error('core shader failed'), {
    id: 'PbrRenderer#1:opaque',
    label: 'PBR opaque',
    owner: 'PbrRenderer',
    compile: async () => {},
  }), false);

  assert.deepEqual(disabled, ['volume']);
  assert.deepEqual(policy.snapshot(), [{
    capability: 'volume',
    label: 'Volume',
    renderer: 'VolumeRenderer',
    task: 'Volume normal',
    error: volumeError,
  }]);
});

test('editor capability fallback skips unavailable materials and disables related systems', () => {
  const registrations = [];
  const render3D = {
    planarMirrorsEnabled: true,
    registerMaterialRenderer(registration) {
      registrations.push(registration);
      return this;
    },
  };
  const blinnPhongSystem = { disabled: false };
  const toonSystem = { disabled: false };

  for (const capability of ['volume', 'planar-mirror', 'blinn-phong', 'toon']) {
    disableOptionalRendererCapability(capability, render3D, blinnPhongSystem, toonSystem);
  }

  assert.equal(render3D.planarMirrorsEnabled, false);
  assert.equal(blinnPhongSystem.disabled, true);
  assert.equal(toonSystem.disabled, true);
  assert.deepEqual(
    registrations.map(registration => registration.materialType.name),
    ['VolumeMaterial', 'PlanarMirrorMaterial', 'BlinnPhongMaterial', 'ToonMaterial'],
  );
  for (const registration of registrations) {
    assert.doesNotThrow(() => registration.renderItem());
    assert.doesNotThrow(() => registration.renderBatch());
  }
});
