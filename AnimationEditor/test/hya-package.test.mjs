import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HYA_PACKAGE_FORMAT,
  HyaPackageError,
  cloneAnimationEditorProject,
  createEmptyAnimationEditorProject,
  createHyaPackageArtifact,
  hyaPackageFileName,
} from '../dist-test/testing.js';

test('delivery package externalizes embedded bytes and compiles matching relative HYA resources', async () => {
  const project = projectWithAssets();
  const before = JSON.stringify(project);

  const artifact = await createHyaPackageArtifact(project);

  assert.equal(JSON.stringify(project), before, 'packaging must not mutate or dirty the editable project');
  assert.equal(artifact.fileName, 'Package-Demo.hya-package.zip');
  assert.equal(artifact.rootDirectory, 'Package-Demo');
  assert.equal(artifact.mimeType, 'application/zip');
  assert.equal(artifact.manifest.format, HYA_PACKAGE_FORMAT);
  assert.equal(artifact.bundledAssetCount, 2);
  assert.equal(artifact.externalAssetCount, 1);
  assert.equal(artifact.hya.compilation.parsed.resources[0].uri, 'assets/payload.bin');
  assert.equal(artifact.hya.compilation.parsed.resources[1].uri, 'assets/payload-2.bin');
  assert.equal(artifact.hya.compilation.parsed.resources[2].uri, 'https://cdn.example.test/remote.png');
  assert.match(artifact.hya.compilation.parsed.resources[0].integrity, /^sha256-[A-Za-z0-9+/]+={0,2}$/u);

  const entries = readStoredZip(artifact.binary);
  assert.deepEqual([...entries.keys()], [
    'Package-Demo/Package-Demo.hya',
    'Package-Demo/assets/payload-2.bin',
    'Package-Demo/assets/payload.bin',
    'Package-Demo/manifest.json',
  ]);
  assert.deepEqual([...entries.get('Package-Demo/assets/payload.bin')], [1, 2, 3]);
  assert.deepEqual([...entries.get('Package-Demo/assets/payload-2.bin')], [4, 5]);
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(entries.get('Package-Demo/manifest.json'))),
    artifact.manifest,
  );
});

test('delivery package bytes and manifest are deterministic', async () => {
  const project = projectWithAssets();

  const first = await createHyaPackageArtifact(project);
  const second = await createHyaPackageArtifact(project);

  assert.deepEqual(new Uint8Array(first.binary), new Uint8Array(second.binary));
  assert.deepEqual(first.manifest, second.manifest);
});

test('delivery package externalizes non-base64 data URIs and sanitizes portable names', async () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ name: 'Unsafe:/ Package' }));
  project.assets.push({
    id: 'greeting',
    name: 'Greeting #世界',
    type: 'binary',
    source: { kind: 'external', uri: 'memory:greeting' },
    delivery: { uri: 'data:text/plain,hello%20%E4%B8%96%E7%95%8C', mimeType: 'text/plain' },
  });

  const artifact = await createHyaPackageArtifact(project);

  assert.equal(hyaPackageFileName(project.name), 'Unsafe-- Package.hya-package.zip');
  assert.equal(artifact.manifest.resources[0].delivery, 'bundled');
  assert.equal(artifact.manifest.resources[0].uri, 'assets/Greeting%20%23%E4%B8%96%E7%95%8C.bin');
  assert.equal(artifact.hya.compilation.parsed.resources[0].uri, artifact.manifest.resources[0].uri);
  assert.equal(
    new TextDecoder().decode(artifact.files.find(file => file.path === 'assets/Greeting #世界.bin').bytes),
    'hello 世界',
  );
});

test('delivery package reports malformed data resources with a stable project path', async () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject());
  project.assets.push({
    id: 'broken',
    name: 'Broken resource',
    type: 'binary',
    source: { kind: 'external', uri: 'memory:broken' },
    delivery: { uri: 'data:missing-comma' },
  });

  await assert.rejects(
    createHyaPackageArtifact(project),
    error => error instanceof HyaPackageError
      && error.code === 'E_PACKAGE_ASSET_DECODE'
      && error.path === '$.assets[0]',
  );
});

function projectWithAssets() {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ name: 'Package/Demo' }));
  project.assets.push(
    {
      id: 'payload-a',
      name: 'Payload A',
      type: 'binary',
      source: {
        kind: 'embedded', fileName: '../payload.bin', mimeType: 'application/octet-stream', encoding: 'base64', data: 'AQID',
      },
      delivery: { uri: 'data:application/octet-stream;base64,AQID', mimeType: 'application/octet-stream' },
    },
    {
      id: 'payload-b',
      name: 'Payload B',
      type: 'binary',
      source: {
        kind: 'embedded', fileName: 'payload.bin', mimeType: 'application/octet-stream', encoding: 'base64', data: 'BAU=',
      },
      delivery: { uri: 'data:application/octet-stream;base64,BAU=', mimeType: 'application/octet-stream' },
    },
    {
      id: 'remote-image',
      name: 'Remote image',
      type: 'image',
      source: { kind: 'external', uri: 'https://cdn.example.test/remote.png' },
      delivery: { uri: 'https://cdn.example.test/remote.png', mimeType: 'image/png', width: 1, height: 1 },
    },
  );
  return project;
}

function readStoredZip(binary) {
  const bytes = new Uint8Array(binary);
  const view = new DataView(binary);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, 'stage-9 packages use deterministic ZIP store entries');
    const byteLength = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    entries.set(name, bytes.slice(dataOffset, dataOffset + byteLength));
    offset = dataOffset + byteLength;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50, 'central directory must immediately follow local entries');
  return entries;
}
