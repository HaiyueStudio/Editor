import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { performance } from 'node:perf_hooks';

import {
  DESIGNER_TEMPLATES,
  DesignerTaskCoordinator,
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  compileDesignerProject,
  createBasicAnimationNode,
  createDesignerHyaArtifact,
  createDesignerPackageArtifact,
  createDesignerProjectFileArtifact,
  createDesignerTemplateProject,
  createEmptyAnimationEditorProject,
  createTimelineKeyframe,
  designerProjectFamily,
  detectDesignerProjectFamily,
  parseDesignerProject,
  relinkAnimationEditorAsset,
  sampleAnimationEditorTrack,
  serializeDesignerProject,
} from '../dist-test/testing.js';

const budgets = JSON.parse(await readFile(new URL('../config/designer-candidate-budgets.json', import.meta.url), 'utf8'));

test('six designer templates are valid family-fixed projects that save, reopen, compile and package deterministically', async () => {
  assert.deepEqual(DESIGNER_TEMPLATES.map(template => template.id), [
    'tween-ui', 'spritesheet', 'path-vector', 'particle', 'native3d-camera-object', 'gltf-character',
  ]);
  for (const definition of DESIGNER_TEMPLATES) {
    const project = createDesignerTemplateProject(definition.id);
    assert.equal(designerProjectFamily(project), definition.family, definition.id);
    const serialized = serializeDesignerProject(project);
    assert.equal(detectDesignerProjectFamily(serialized), definition.family);
    const reopened = parseDesignerProject(serialized);
    assert.equal(serializeDesignerProject(reopened), serialized, `${definition.id} round trip`);
    const file = createDesignerProjectFileArtifact(reopened);
    assert.match(file.fileName, /\.hya-project\.json$/u);
    assert.equal(file.bytes, new TextEncoder().encode(file.text).byteLength);
    const compilation = compileDesignerProject(reopened);
    const hya = createDesignerHyaArtifact(reopened);
    const hyaBytes = 'binary' in hya ? new Uint8Array(hya.binary) : hya.bytes;
    assert.deepEqual(hyaBytes, new Uint8Array(compilation.binary), `${definition.id} exact export bytes`);
    const firstPackage = await createDesignerPackageArtifact(reopened);
    const secondPackage = await createDesignerPackageArtifact(reopened);
    assert.deepEqual(new Uint8Array(firstPackage.binary), new Uint8Array(secondPackage.binary), `${definition.id} deterministic package`);
    assert.equal(firstPackage.manifest.project.id, reopened.id);
  }
});

test('asset relink preserves stable identity and every authored reference while remaining undo-ready', async () => {
  const draft = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2 }));
  const original = new File([new Uint8Array([1, 2, 3, 4])], 'original.wav', { type: 'audio/wav' });
  const first = await relinkSeed(draft, original);
  const node = createBasicAnimationNode(first, 'audio');
  first.nodes.push(node);
  const assetId = first.assets[0].id;
  const next = await relinkAnimationEditorAsset(first, assetId, new File([new Uint8Array([5, 6, 7, 8])], 'replacement.wav', { type: 'audio/wav' }));
  assert.equal(next.assets[0].id, assetId);
  assert.equal(next.assets[0].name, 'replacement.wav');
  assert.equal(next.nodes[0].components[0].component.resource, assetId);
  assert.equal(first.assets[0].name, 'original.wav', 'source snapshot remains detached for undo');
});

test('node visibility is authored through the canonical compiler and task cancellation drains listeners', async () => {
  const draft = cloneAnimationEditorProject(createEmptyAnimationEditorProject());
  const node = createBasicAnimationNode(draft, 'rectangle');
  node.editor.hidden = true;
  draft.nodes.push(node);
  const compiled = compileAnimationEditorProject(draft);
  assert.equal(compiled.document.nodes[0].transform.opacity, 0);

  const tasks = new DesignerTaskCoordinator();
  const states = [];
  const snapshots = [];
  const unsubscribe = tasks.subscribe(snapshot => {
    states.push(snapshot.state);
    snapshots.push(snapshot);
  });
  const pending = tasks.run('long import', async ({ signal, report }) => {
    report(0.5, 'half');
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
  });
  await tasks.cancel();
  await assert.rejects(pending, error => error.name === 'AbortError');
  unsubscribe();
  await tasks.close();
  assert.equal(tasks.listenerCount, 0);
  assert.ok(states.includes('running') && states.includes('cancelled'));
  assert.ok(snapshots.some(snapshot => snapshot.state === 'running'
    && snapshot.progress === 0.5 && snapshot.detail === 'half'));
});

test('full-scale large-project candidate stays within scrub/drag/compile and heap budgets', () => {
  const project = largeCandidateProject();
  assert.equal(project.nodes.length, budgets.project.nodes);
  assert.equal(project.timeline.tracks.length, budgets.project.tracks);
  assert.equal(project.timeline.tracks.reduce((sum, track) => sum + track.keyframes.length, 0), budgets.project.keyframes);
  assert.equal(project.assets.length, budgets.project.resources);
  assert.equal(project.nodes[0].components[0].component.maxParticles, budgets.project.particleCapacity);
  const track = project.timeline.tracks[0];
  const heapBefore = process.memoryUsage().heapUsed;
  const scrub = Array.from({ length: 240 }, (_unused, index) => measure(() => sampleAnimationEditorTrack(track, index / 2)));
  const drag = Array.from({ length: 40 }, (_unused, index) => measure(() => {
    const draft = cloneAnimationEditorProject(project);
    const keyframe = draft.timeline.tracks[0].keyframes[index + 1];
    keyframe.time += 1 / 6000;
    return keyframe.time;
  }));
  const compileStarted = performance.now();
  const compilation = compileAnimationEditorProject(project);
  const compileMs = performance.now() - compileStarted;
  const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  const result = {
    scrubP95: percentile(scrub, 0.95), dragP95: percentile(drag, 0.95), compileMs,
    heapGrowth, hyaBytes: compilation.binary.byteLength,
    nodes: project.nodes.length, tracks: project.timeline.tracks.length,
    keyframes: project.timeline.tracks.reduce((sum, candidate) => sum + candidate.keyframes.length, 0),
    resources: project.assets.length, particleCapacity: project.nodes[0].components[0].component.maxParticles,
  };
  console.log(`[g09-candidate] ${JSON.stringify(result)}`);
  assert.ok(result.scrubP95 < budgets.interactionMs.scrubP95, JSON.stringify(result));
  assert.ok(result.dragP95 < budgets.interactionMs.dragP95, JSON.stringify(result));
  assert.ok(result.compileMs < budgets.interactionMs.compile, JSON.stringify(result));
  assert.ok(result.heapGrowth < budgets.memory.heapGrowthBytes, JSON.stringify(result));
});

async function relinkSeed(project, file) {
  const { createAnimationEditorAssetFromFile } = await import('../dist-test/testing.js');
  const asset = await createAnimationEditorAssetFromFile(file, project);
  project.assets.push(asset);
  return project;
}

function largeCandidateProject() {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 200, frameRate: 60 }));
  project.assets = Array.from({ length: budgets.project.resources }, (_unused, index) => ({
    id: `resource-${index}`,
    name: `Candidate Resource ${index}`,
    type: 'binary',
    source: { kind: 'external', uri: `https://example.invalid/candidate/resource-${index}.bin` },
    delivery: { uri: `https://example.invalid/candidate/resource-${index}.bin`, mimeType: 'application/octet-stream' },
  }));
  for (let index = 0; index < budgets.project.nodes; index++) {
    const node = createBasicAnimationNode(project, index === 0 ? 'particle' : 'group');
    node.id = `large-node-${index}`;
    node.name = `Large Node ${index}`;
    if (index === 0) node.components[0].component.maxParticles = budgets.project.particleCapacity;
    project.nodes.push(node);
  }
  const denseKeyCount = budgets.project.keyframes - (budgets.project.tracks - 1);
  project.timeline.tracks = Array.from({ length: budgets.project.tracks }, (_unused, index) => {
    const node = project.nodes[Math.floor(index / 2)];
    const property = index % 2 === 0 ? 'opacity' : 'position';
    const keyCount = index === 0 ? denseKeyCount : 1;
    return {
      id: `track-${index}`,
      name: `${node.name} · ${property}`,
      target: { kind: 'node-transform', nodeId: node.id, property },
      valueSize: property === 'position' ? 2 : 1,
      enabled: true,
      keyframes: Array.from({ length: keyCount }, (_key, keyIndex) => ({
        id: `track-${index}-key-${keyIndex}`,
        time: keyIndex / 60,
        value: property === 'position'
          ? [keyIndex % 100, Math.floor(keyIndex / 100) % 100]
          : [keyIndex / Math.max(1, keyCount - 1)],
        interpolation: 'linear',
      })),
    };
  });
  return project;
}

function measure(callback) { const started = performance.now(); callback(); return performance.now() - started; }
function percentile(values, ratio) { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]; }
