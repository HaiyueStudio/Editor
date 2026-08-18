import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AnimationEditorProjectFormatError,
  createProjectFileArtifact,
  decodeAnimationEditorProject,
  parseAnimationEditorProject,
  projectFileName,
  serializeAnimationEditorProject,
} from '../dist-test/testing.js';

const fixtureText = readFileSync(
  new URL('../examples/state-machine-multitrack.hya-project.json', import.meta.url),
  'utf8',
);

test('project codec accepts the canonical fixture and serializes deterministically', () => {
  const decoded = decodeAnimationEditorProject(fixtureText);
  assert.equal(decoded.sourceSchemaVersion, 1);
  assert.equal(decoded.migrated, false);
  assert.equal(decoded.project.nodes.length, 2);
  assert.equal(Object.isFrozen(decoded.project), true);

  const first = serializeAnimationEditorProject(decoded.project);
  const second = serializeAnimationEditorProject(parseAnimationEditorProject(first));
  assert.equal(first, second);
  assert.ok(first.endsWith('\n'));
  assert.equal(first.indexOf('"assets"'), 4, 'canonical object keys are sorted');

  const artifact = createProjectFileArtifact(decoded.project);
  assert.equal(artifact.fileName, 'Multi-track State Demo.hya-project.json');
  assert.equal(artifact.bytes, new TextEncoder().encode(artifact.text).byteLength);
  assert.equal(artifact.mimeType, 'application/vnd.haiyue.animation-project+json');
});

test('project codec canonicalizes optional stateMachine and sanitizes portable names', () => {
  const input = JSON.parse(fixtureText);
  delete input.stateMachine;
  const project = parseAnimationEditorProject(input);
  assert.equal(project.stateMachine, null);
  assert.equal(projectFileName(' Hero:Walk?.hya-project.json '), 'Hero-Walk-.hya-project.json');
});

test('project codec reports stable codes and paths without replacing the active value', () => {
  const unknown = JSON.parse(fixtureText);
  unknown.composition.canvas.pixelRatio = 2;
  assert.throws(
    () => parseAnimationEditorProject(unknown),
    error => error instanceof AnimationEditorProjectFormatError
      && error.diagnostics[0].code === 'E_PROJECT_UNKNOWN_FIELD'
      && error.diagnostics[0].path === '$.composition.canvas.pixelRatio',
  );

  const duplicate = JSON.parse(fixtureText);
  duplicate.timeline.tracks[1].id = duplicate.timeline.tracks[0].id;
  assert.throws(
    () => parseAnimationEditorProject(duplicate),
    error => error.diagnostics[0].code === 'E_PROJECT_DUPLICATE_ID'
      && error.diagnostics[0].path === '$.timeline.tracks[1].id',
  );

  assert.throws(
    () => parseAnimationEditorProject('{broken'),
    error => error.diagnostics[0].code === 'E_PROJECT_INVALID_JSON'
      && error.diagnostics[0].path === '$',
  );

  const notJson = JSON.parse(fixtureText);
  notJson.editor = undefined;
  assert.throws(
    () => parseAnimationEditorProject(notJson),
    error => error.diagnostics[0].code === 'E_PROJECT_INVALID_VALUE'
      && error.diagnostics[0].path === '$.editor',
  );
});

test('project codec rejects future schemas and cross-document reference failures', () => {
  const future = JSON.parse(fixtureText);
  future.schemaVersion = 2;
  assert.throws(
    () => parseAnimationEditorProject(future),
    error => error.diagnostics[0].code === 'E_PROJECT_UNSUPPORTED_VERSION'
      && error.diagnostics[0].path === '$.schemaVersion',
  );

  const missing = JSON.parse(fixtureText);
  missing.timeline.tracks[0].target.nodeId = 'missing-node';
  assert.throws(
    () => parseAnimationEditorProject(missing),
    error => error.diagnostics[0].code === 'E_PROJECT_UNKNOWN_REFERENCE'
      && error.diagnostics[0].path === '$.timeline.tracks[0].target.nodeId',
  );
});
