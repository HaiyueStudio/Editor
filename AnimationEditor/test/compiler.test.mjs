import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AnimationEditorCompileError,
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  availableAdvancedPropertyBindings,
  createAdvancedEffect,
  createAdvancedPropertyTrack,
  createHyaFileArtifact,
  hyaFileName,
  parseAnimationEditorProject,
} from '../dist-test/testing.js';

const STATE_MACHINE_EXTENSION_ID = 'org.haiyue.animation-state-machine@1';
const fixtureSource = readFileSync(
  new URL('../examples/state-machine-multitrack.hya-project.json', import.meta.url),
  'utf8',
);

test('compiler lowers the canonical project and validates the HYA binary round trip', () => {
  const project = parseAnimationEditorProject(JSON.parse(fixtureSource));
  const result = compileAnimationEditorProject(project);

  assert.equal(result.document.name, project.name);
  assert.equal(result.parsed.nodes.length, 2);
  assert.equal(result.parsed.tracks.length, 2);
  assert.deepEqual(result.parsed.extensionsRequired, [STATE_MACHINE_EXTENSION_ID]);
  assert.ok(result.binary.byteLength > 0);
  assert.ok(result.diagnostics.some(({ code }) => code === 'W_TRACK_MIXED_INTERPOLATION_BAKED'));

  const extension = result.document.extensions[STATE_MACHINE_EXTENSION_ID];
  assert.equal(extension.clips.length, 2);
  assert.equal(extension.stateMachine.layers[0].states[0].editorPosition, undefined);
});

test('compiler output is deterministic for identical project content', () => {
  const project = parseAnimationEditorProject(JSON.parse(fixtureSource));
  const first = new Uint8Array(compileAnimationEditorProject(project).binary);
  const second = new Uint8Array(compileAnimationEditorProject(project).binary);

  assert.deepEqual(first, second);
});

test('compiler rejects advanced targets that do not match their component payload', () => {
  const project = cloneFixture();
  project.timeline.tracks[1].target = {
    kind: 'component-property',
    nodeId: 'body',
    componentId: 'body-shape',
    property: 'vector.fill.opacity',
  };

  assertCompileDiagnostic(project, 'E_COMPILE_UNSUPPORTED_TRACK_TARGET', '$.timeline.tracks[1].target');
});

test('compiler rejects temporary delivery URLs in standalone HYA assets', () => {
  const project = cloneFixture();
  project.assets.push({
    id: 'temporary-image',
    name: 'Temporary image',
    type: 'image',
    source: { kind: 'external', uri: 'blob:https://editor.invalid/source' },
    delivery: { uri: 'blob:https://editor.invalid/runtime', mimeType: 'image/png' },
  });

  assertCompileDiagnostic(project, 'E_COMPILE_NON_DEPLOYABLE_URI', '$.assets[0].delivery.uri');
});

test('compiler accepts imported data delivery without externalization warnings', () => {
  const project = cloneFixture();
  project.assets.push({
    id: 'portable-image',
    name: 'Portable image',
    type: 'image',
    source: {
      kind: 'embedded', fileName: 'portable.png', mimeType: 'image/png', encoding: 'base64', data: 'AA==',
    },
    delivery: { uri: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 1, height: 1 },
  });

  const result = compileAnimationEditorProject(project);
  assert.equal(result.parsed.resources[0].uri, 'data:image/png;base64,AA==');
  assert.equal(result.diagnostics.some(({ code }) => code === 'W_EMBEDDED_ASSET_EXTERNALIZED'), false);
});

test('compiler maps HYA component validation errors back to project records', () => {
  const project = cloneFixture();
  project.nodes[1].components[0].component.size = [80];

  assertCompileDiagnostic(
    project,
    'E_COMPILE_RUNTIME_VALIDATION',
    '$.nodes[1].components[0].component.size',
  );
});

test('compiler reports the exact unmixable audio transition range', () => {
  const project = cloneFixture();
  project.nodes[0].components.push({
    id: 'timeline-audio',
    component: { type: 'audio', resource: 'missing-audio' },
  });

  assertCompileDiagnostic(
    project,
    'E_COMPILE_STATE_MACHINE_AUDIO_UNMIXABLE_RANGE',
    '$.stateMachine.layers[0].transitions[0].duration',
  );
});

test('compiler accepts topology-stable path morphs in the shared state-machine runtime', () => {
  const project = cloneFixture();
  project.nodes[0].components.push({
    id: 'animated-morph',
    component: {
      type: 'org.haiyue.vector-path-morph@1',
      commands: 'MLLZ',
      times: [0, 1],
      values: [0, 0, 20, 0, 10, 20, 0, 0, 30, 0, 15, 30],
      valueSize: 6,
      interpolation: 'linear',
      fill: [0.2, 0.8, 1, 1],
      fillRule: 'nonzero',
    },
  });

  const result = compileAnimationEditorProject(project);
  assert.equal(result.parsed.nodes[0].components[0].type, 'org.haiyue.vector-path-morph@1');
});

test('compiler diagnoses advanced inline tracks that the state-machine mixer cannot blend', () => {
  const project = cloneFixture();
  const node = project.nodes.find(candidate => candidate.id === 'body');
  node.effects.push(createAdvancedEffect(project, node.id, 'blur'));
  const binding = availableAdvancedPropertyBindings(project, node.id)
    .find(candidate => candidate.target.property === 'blur.radius');
  project.timeline.tracks.push(createAdvancedPropertyTrack(project, node.id, binding.key, 0));

  assertCompileDiagnostic(
    project,
    'E_COMPILE_STATE_MACHINE_UNSUPPORTED_CHANNEL',
    `$.timeline.tracks[${project.timeline.tracks.length - 1}].target`,
  );
});

test('mixed-track baking rejects oversized frame grids before sampling them', () => {
  const project = cloneFixture();
  project.composition.frameRate = Number.MAX_SAFE_INTEGER;

  assertCompileDiagnostic(project, 'E_COMPILE_BAKE_LIMIT', '$.timeline.tracks[0]');
});

test('HYA file artifacts expose a sanitized name and the compiled binary', () => {
  const project = parseAnimationEditorProject(JSON.parse(fixtureSource));
  const artifact = createHyaFileArtifact(project);

  assert.equal(artifact.fileName, 'Multi-track State Demo.hya');
  assert.equal(artifact.bytes, artifact.binary.byteLength);
  assert.equal(artifact.compilation.parsed.name, project.name);
  assert.equal(hyaFileName('  Demo:/Take.hya  '), 'Demo--Take.hya');
  assert.equal(hyaFileName('...'), 'untitled-animation.hya');
});

function cloneFixture() {
  return cloneAnimationEditorProject(parseAnimationEditorProject(JSON.parse(fixtureSource)));
}

function assertCompileDiagnostic(project, code, path) {
  assert.throws(
    () => compileAnimationEditorProject(project),
    error => {
      assert.ok(error instanceof AnimationEditorCompileError);
      const diagnostic = error.diagnostics.find(candidate => candidate.code === code);
      assert.ok(diagnostic, `missing ${code}: ${JSON.stringify(error.diagnostics)}`);
      assert.equal(diagnostic.path, path);
      return true;
    },
  );
}
