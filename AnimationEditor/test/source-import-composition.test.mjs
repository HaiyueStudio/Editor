import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const g07 = await import('../dist-test/source-import-entry.js');
const REAL_PRECOMP = new URL('./source-import-fixtures/real-precomp.json', import.meta.url);
const animationSpecRoot = new URL('../', import.meta.resolve('@haiyue/animation-spec'));
const extensionsRoot = new URL('../', import.meta.resolve('@haiyue/extensions'));
const BASIC_LOTTIE = new URL('test/fixtures/basic-lottie.json', animationSpecRoot);
const REAL_GLTF = new URL('test/fixtures/gltf/animation-characterization.gltf', extensionsRoot);

test('real CC0 Lottie precomp maps through the package converter with stable provenance and editable project identity', async () => {
  const text = await readFile(REAL_PRECOMP, 'utf8');
  const firstCoordinator = new g07.SourceImportCoordinator();
  const first = await firstCoordinator.import({
    kind: 'lottie', input: { kind: 'text', text }, sourceUri: 'https://assets.example.test/layers/precomp.json',
  });
  const secondCoordinator = new g07.SourceImportCoordinator();
  const second = await secondCoordinator.import({
    kind: 'lottie', input: { kind: 'text', text }, sourceUri: 'https://assets.example.test/layers/precomp.json',
  });

  assert.equal(first.source.family, '2d');
  assert.equal(first.source.project.name, 'Comp 1');
  assert.ok(first.source.project.nodes.some(node => node.id.includes('layer:1-layer:1')), 'precomp descendants remain editable nodes');
  assert.equal(first.source.id, second.source.id, 'content-addressed source identity is deterministic');
  assert.match(first.provenance.sourceHash, /^sha256-[a-f0-9]{64}$/u);
  assert.equal(first.provenance.importer, '@haiyue/animation-spec/lottie');
  assert.deepEqual(first.diagnostics, second.diagnostics);

  const saved = g07.serializeAnimationEditorProject(first.source.project);
  const reopened = g07.parseAnimationEditorProject(saved);
  assert.deepEqual(reopened.timeline.tracks.map(track => track.id), first.source.project.timeline.tracks.map(track => track.id));
  const one = g07.compileAnimationEditorProject(reopened);
  const two = g07.compileAnimationEditorProject(g07.parseAnimationEditorProject(saved));
  assert.deepEqual(new Uint8Array(one.binary), new Uint8Array(two.binary));
  await firstCoordinator.close();
  await secondCoordinator.close();
});

test('Lottie unsupported/fidelity diagnostics preserve converter code and exact JSON path; strict mode retains them', async () => {
  const source = {
    v: '5.12.0', nm: 'Unsupported', fr: 30, ip: 0, op: 30, w: 64, h: 64,
    layers: [{ ind: 1, ty: 99, nm: 'Future layer', ip: 0, op: 30, ks: {} }],
  };
  const coordinator = new g07.SourceImportCoordinator();
  const result = await coordinator.import({ kind: 'lottie', input: { kind: 'json', value: source } });
  assert.ok(result.diagnostics.length > 0);
  assert.ok(result.diagnostics.every(diagnostic => diagnostic.code && diagnostic.path.startsWith('$.')));
  const unsupportedPath = result.diagnostics.find(diagnostic => diagnostic.path.startsWith('$.layers[0]'))?.path;
  assert.ok(unsupportedPath);
  await assert.rejects(
    new g07.SourceImportCoordinator().import({ kind: 'lottie', input: { kind: 'json', value: source }, strict: true }),
    error => error.code === 'E_IMPORT_STRICT_DIAGNOSTIC'
      && error.diagnostics.some(diagnostic => diagnostic.path === unsupportedPath),
  );
});

test('SpriteSheet stays delegated to G03 while shared importer owns source identity, provenance and 2D commit', async () => {
  const atlasUri = 'https://assets.example.test/packages/atlas.svg';
  const adapter = spriteSheetAdapter(atlasUri);
  let committed = null;
  const result = await new g07.SourceImportCoordinator().import({
    kind: 'spritesheet',
    input: { kind: 'text', text: '<svg width="4" height="2"/>' },
    sourceUri: atlasUri,
    adapter,
  }, value => { committed = value.source.project; });
  assert.equal(result.source.family, '2d');
  assert.equal(result.source.project.assets[0].delivery.uri, atlasUri);
  assert.equal(result.source.project.timeline.tracks[0].target.property, 'sprite.uv-rect');
  assert.equal(result.source.project.timeline.tracks[0].keyframes.length, 2);
  assert.equal(committed.id, result.source.id);
  const compiled = g07.compileAnimationEditorProject(result.source.project);
  assert.equal(compiled.parsed.resources.length, 1);
  assert.equal(compiled.parsed.resources[0].uri, atlasUri);
});

test('real glTF stays delegated to G06 and enters a separate native 3D project with editable clips', async () => {
  const text = await readFile(REAL_GLTF, 'utf8');
  const parsedGltf = JSON.parse(text);
  const coordinator = new g07.SourceImportCoordinator();
  const result = await coordinator.import({
    kind: 'gltf',
    input: { kind: 'text', text, contentType: 'model/gltf+json' },
    sourceUri: 'https://assets.example.test/models/animation-characterization.gltf',
    adapter: gltfAdapter(parsedGltf.animations.length),
  });
  assert.equal(result.source.family, '3d');
  assert.equal(result.source.project.mode, '3d');
  assert.equal(result.source.project.assets[0].type, 'model');
  assert.equal(result.source.project.timeline.clips.length, parsedGltf.animations.length);
  assert.equal(result.provenance.importer, 'G06/glTF');
  const reopened = g07.parseNative3dProject(g07.serializeNative3dProject(result.source.project));
  const one = g07.compileNative3dProject(reopened);
  const two = g07.compileNative3dProject(reopened);
  assert.deepEqual(new Uint8Array(one.binary), new Uint8Array(two.binary));
});

test('nested composition uses references, stable overrides, parent opacity and deterministic time contract before lowering', async () => {
  const real = await new g07.SourceImportCoordinator().import({
    kind: 'lottie', input: { kind: 'text', text: await readFile(REAL_PRECOMP, 'utf8') }, sourceId: 'root',
  });
  const animated = await new g07.SourceImportCoordinator().import({
    kind: 'lottie', input: { kind: 'text', text: await readFile(BASIC_LOTTIE, 'utf8') }, sourceId: 'child',
  });
  let workspace = g07.createReusableCompositionWorkspace({ id: 'nested-demo', name: 'Nested Demo', root: real.source });
  workspace = g07.addCompositionSource(workspace, animated.source);
  workspace = g07.addCompositionTemplate(workspace, {
    id: 'template:child', name: 'Moving child', sourceId: 'child', tags: ['motion'], provenance: animated.provenance,
  });
  const instance = g07.createCompositionInstanceFromTemplate(workspace, 'template:child', {
    id: 'instance:child', name: 'Moving child instance',
    parent: { family: '2d', transform: { position: [8, 12], scale: [0.5, 0.5], opacity: 0.8 }, opacity: 0.5 },
    timing: { startTime: 0, localIn: 0, localOut: 1, timeScale: 1, timeOffset: 0, loop: { mode: 'ping-pong', count: 2 } },
    overrides: [{
      id: 'override:child-transform', kind: 'node-transform-2d',
      sourceNodeId: animated.source.project.nodes[0].id, transform: { opacity: 0.5 },
    }],
  });
  workspace = g07.addCompositionInstance(workspace, 'root', instance);
  const sampleForward = g07.sampleCompositionInstanceTime(instance.timing, 0.25);
  const sampleReverse = g07.sampleCompositionInstanceTime(instance.timing, 1.25);
  assert.deepEqual(sampleForward, { active: true, localTime: 0.25, traversal: 0, reversed: false });
  assert.deepEqual(sampleReverse, { active: true, localTime: 0.75, traversal: 1, reversed: true });

  const serialized = g07.serializeReusableCompositionWorkspace(workspace);
  const reopened = g07.parseReusableCompositionWorkspace(serialized);
  assert.equal(g07.serializeReusableCompositionWorkspace(reopened), serialized);
  assert.equal(reopened.sources.find(source => source.id === 'root').instances[0].id, 'instance:child');
  assert.equal(reopened.sources.find(source => source.id === 'root').instances[0].overrides[0].id, 'override:child-transform');
  assert.equal(reopened.sources.length, 2, 'authoring workspace retains two sources instead of copied nodes/tracks');
  const instantiated = g07.instantiateReusableComposition(reopened);
  assert.equal(instantiated.family, '2d');
  assert.ok(instantiated.project.nodes.some(node => node.id.includes('instance:child') && node.transform.opacity === 0.4));
  assert.ok(instantiated.diagnostics.some(diagnostic => diagnostic.code === 'W_COMPOSITION_TIME_MAPPING_BAKED'));
  const saved = g07.serializeAnimationEditorProject(instantiated.project);
  const one = g07.compileAnimationEditorProject(g07.parseAnimationEditorProject(saved));
  const two = g07.compileAnimationEditorProject(g07.parseAnimationEditorProject(saved));
  assert.deepEqual(new Uint8Array(one.binary), new Uint8Array(two.binary));

  const cycle = { ...instance, id: 'instance:cycle', sourceId: 'root', timing: { ...instance.timing, loop: { mode: 'none', count: 1 } } };
  assert.throws(
    () => g07.addCompositionInstance(workspace, 'child', cycle),
    error => error.diagnostics.some(diagnostic => diagnostic.code === 'E_COMPOSITION_CYCLE'),
  );
  const dangling = { ...instance, id: 'instance:dangling', sourceId: 'missing' };
  assert.throws(
    () => g07.addCompositionInstance(workspace, 'root', dangling),
    error => error.diagnostics.some(diagnostic => diagnostic.code === 'E_COMPOSITION_DANGLING_REFERENCE'),
  );
  const tooShallow = g07.validateReusableCompositionWorkspace(workspace, 1);
  assert.ok(tooShallow.some(diagnostic => diagnostic.code === 'E_COMPOSITION_DEPTH_LIMIT'));
});

test('asset missing diagnostics, relink and referenced delete are atomic and preserve stable ids', async () => {
  const imported = await new g07.SourceImportCoordinator().import({
    kind: 'spritesheet', input: { kind: 'text', text: '<svg width="4" height="2"/>' },
    sourceId: 'sprites', sourceUri: 'https://old.example.test/atlas.svg', adapter: spriteSheetAdapter('https://old.example.test/atlas.svg'),
  });
  let workspace = g07.createReusableCompositionWorkspace({ id: 'asset-demo', name: 'Asset Demo', root: imported.source });
  const assetId = workspace.assets[0].id;
  const missing = g07.markCompositionAssetMissing(workspace, assetId);
  assert.ok(g07.compositionLibraryDiagnostics(missing).some(diagnostic => diagnostic.path === '$.assets[0]'));
  assert.throws(() => g07.instantiateReusableComposition(missing), error => error.diagnostics[0].code === 'E_COMPOSITION_ASSET_MISSING');
  const replacement = {
    ...workspace.assets[0].asset,
    source: { kind: 'external', uri: 'https://cdn.example.test/atlas-v2.svg' },
    delivery: { ...workspace.assets[0].asset.delivery, uri: 'https://cdn.example.test/atlas-v2.svg', integrity: 'sha256-v2' },
  };
  workspace = g07.relinkCompositionAsset(workspace, assetId, replacement, 'sha256-v2', {
    importer: 'project', sourceFormat: 'image/svg+xml', sourceHash: 'sha256-v2', sourceUri: replacement.delivery.uri,
  });
  assert.equal(workspace.assets[0].id, assetId);
  assert.equal(workspace.assets[0].sourceAssetId, imported.source.project.assets[0].id);
  assert.equal(workspace.sources[0].project.assets[0].delivery.uri, replacement.delivery.uri);
  assert.throws(() => g07.deleteCompositionAsset(workspace, assetId), error => error.diagnostics[0].code === 'E_COMPOSITION_ASSET_REFERENCED');
  assert.equal(workspace.assets.length, 1, 'failed delete leaves immutable workspace unchanged');
  const compiled = g07.compileAnimationEditorProject(g07.instantiateReusableComposition(workspace).project);
  assert.equal(compiled.parsed.resources[0].uri, replacement.delivery.uri);
});

test('HYA opens as delivery data with limited authoring truth and deterministic save/reopen/export bytes', async () => {
  const lottie = await new g07.SourceImportCoordinator().import({
    kind: 'lottie', input: { kind: 'text', text: await readFile(BASIC_LOTTIE, 'utf8') }, sourceId: 'delivery-source',
  });
  const original = g07.compileAnimationEditorProject(lottie.source.project).binary;
  const imported = await new g07.SourceImportCoordinator().import({ kind: 'hya', input: { kind: 'bytes', bytes: original } });
  assert.equal(imported.source.authoring, 'limited-delivery');
  assert.equal(imported.deliveryData.authoringMetadataRecovered, false);
  assert.equal(imported.deliveryData.preview.source, 'binary');
  assert.ok(imported.diagnostics.some(diagnostic => diagnostic.code === 'W_HYA_DELIVERY_LIMITED_PROJECT' && diagnostic.risk === 'delivery-data'));
  const saved = g07.serializeAnimationEditorProject(imported.source.project);
  const reopened = g07.parseAnimationEditorProject(saved);
  const one = g07.compileAnimationEditorProject(reopened);
  const two = g07.compileAnimationEditorProject(g07.parseAnimationEditorProject(saved));
  assert.deepEqual(new Uint8Array(one.binary), new Uint8Array(two.binary));
});

test('cancel, supersede and close drain workers/handles and prevent stale commits', async () => {
  const coordinator = new g07.SourceImportCoordinator();
  const started = Promise.withResolvers();
  const counters = { workers: 0, handles: 0, commits: 0 };
  const slowAdapter = {
    kind: 'spritesheet', importer: 'test/G03', sourceFormat: 'test',
    async import(_payload, context) {
      context.trackWorker({ terminate: () => { counters.workers++; } });
      context.trackAssetHandle({ dispose: () => { counters.handles++; } });
      started.resolve();
      await new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    },
  };
  const stale = coordinator.import({ kind: 'spritesheet', input: { kind: 'text', text: 'slow' }, adapter: slowAdapter }, () => { counters.commits++; });
  await started.promise;
  const fast = coordinator.import({
    kind: 'spritesheet', input: { kind: 'text', text: '<svg/>' }, sourceId: 'fast',
    adapter: spriteSheetAdapter('https://assets.example.test/fast.svg'),
  }, () => { counters.commits++; });
  await assert.rejects(stale, error => error.code === 'E_IMPORT_ABORTED');
  const result = await fast;
  assert.equal(result.source.id, 'fast');
  assert.deepEqual(counters, { workers: 1, handles: 1, commits: 1 });
  await coordinator.close();
  assert.equal(coordinator.active, false);
  await assert.rejects(
    coordinator.import({ kind: 'spritesheet', input: { kind: 'text', text: '<svg/>' }, adapter: spriteSheetAdapter('https://x.test/a.svg') }),
    error => error.code === 'E_IMPORT_ABORTED',
  );
});

function spriteSheetAdapter(uri) {
  return {
    kind: 'spritesheet', importer: 'G03/SpriteSheet', sourceFormat: 'spritesheet-grid',
    import(_payload, context) {
      let project = g07.cloneAnimationEditorProject(g07.createEmptyAnimationEditorProject({
        id: context.sourceId, name: 'SpriteSheet', width: 64, height: 64, duration: 1, frameRate: 4,
      }));
      project.assets.push({
        id: 'atlas', name: 'atlas.svg', type: 'image', source: { kind: 'external', uri },
        delivery: { uri, mimeType: 'image/svg+xml', width: 4, height: 2, colorSpace: 'srgb' },
      });
      const node = g07.createBasicAnimationNode(project, 'sprite', { imageAssetId: 'atlas' });
      project.nodes.push(node);
      const map = g07.createRegularSpriteSheetFrameMap('atlas', 4, 2, { columns: 2, rows: 1 });
      const sequence = g07.createSpriteSheetSequence(map, { start: 0, end: 1, fps: 2, loop: true, mode: 'forward' });
      project = g07.generateSpriteSheetProjectAnimation(project, node.id, node.components[0].id, map, sequence).project;
      return { family: '2d', project, authoring: 'converted-source' };
    },
  };
}

function gltfAdapter(animationCount) {
  return {
    kind: 'gltf', importer: 'G06/glTF', sourceFormat: 'gltf-2.0',
    import(payload, context) {
      let project = g07.createNative3dProject({ id: context.sourceId, name: 'glTF import', duration: 1, frameRate: 30 });
      project = g07.addNative3dAsset(project, {
        id: 'model', name: 'animation-characterization.gltf', type: 'model',
        source: { kind: 'external', uri: payload.sourceUri },
        delivery: { uri: payload.sourceUri, mimeType: 'model/gltf+json' },
        provenance: { importer: 'gltf', sourceFormat: 'gltf-2.0', sourceHash: context.provenance.sourceHash },
      });
      project = g07.addNative3dModel(project, { nodeId: 'character', componentId: 'character:model', resource: 'model' });
      const clips = Array.from({ length: animationCount }, (_unused, index) => ({
        format: 'haiyue-animation3d-clip@1', id: `source:${index}`, name: `Take ${index + 1}`, duration: 1,
        tracks: [{
          id: `source:${index}:translation`,
          binding: { id: `binding:${index}`, target: { kind: 'node-id', nodeId: 'AnimatedTRS' }, path: 'transform.translation', valueType: 'vec3', valueSize: 3 },
          interpolation: 'linear', times: [0, 1], values: [0, 0, 0, index + 1, 0, 0],
        }],
        events: [],
      }));
      project = g07.importNative3dGltfClips(project, 'character', clips, { extendComposition: true });
      return { family: '3d', project, authoring: 'converted-source' };
    },
  };
}
