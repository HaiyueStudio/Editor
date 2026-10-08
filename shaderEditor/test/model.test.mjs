import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject, parseProject, passOf, usesCurrentFrame } from '../dist/model.js';
import { examples } from '../dist/examples.js';
import { wrapShader } from '../dist/shaders.js';

test('project round-trip and built-in examples satisfy the serialized contract', () => {
  for (const project of [createProject(), ...examples().map(e => e.project)]) assert.deepEqual(parseProject(JSON.stringify(project)), project);
});
test('rejects excess channels, duplicate passes, missing assets, disabled buffers and unknown versions atomically', () => {
  for (const change of [p => p.version = 99, p => p.passes[0].id = 'image', p => p.passes[4].channels.push({kind:'none'}),
    p => p.passes[4].channels[0] = {kind:'image',assetId:'missing'}, p => p.passes[4].channels[0] = {kind:'buffer',pass:'buffer-a'},
    p => p.preview.scale = -1, p => p.name = '', p => p.passes[4].enabled = false]) {
    const project = createProject(); change(project); assert.throws(() => validateProject(project));
  }
});
test('cycles have deterministic Shadertoy ordering, including self-feedback', () => {
  assert.equal(usesCurrentFrame('buffer-a', 'buffer-a'), false);
  assert.equal(usesCurrentFrame('buffer-a', 'buffer-d'), false);
  assert.equal(usesCurrentFrame('buffer-c', 'buffer-b'), true);
  assert.equal(usesCurrentFrame('image', 'buffer-d'), true);
  const p = createProject(); p.passes[0].enabled = p.passes[1].enabled = true;
  p.passes[0].channels[0] = {kind:'buffer',pass:'buffer-b'}; p.passes[1].channels[0] = {kind:'buffer',pass:'buffer-a'};
  assert.doesNotThrow(() => validateProject(p));
});
test('WGSL diagnostics map back to user source without exposing wrapper offsets', () => {
  const p = passOf(createProject(), 'image'); p.code = 'line1\nline2\nline3';
  const wrapped = wrapShader(p), lines = wrapped.code.split('\n');
  assert.equal(lines[wrapped.lineOffset], 'line1'); assert.equal(lines[wrapped.lineOffset + 2], 'line3'); assert.equal(wrapped.lines, 3);
});
