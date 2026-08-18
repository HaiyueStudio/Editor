import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableAdvancedPropertyBindings,
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  createAdvancedEffect,
  createAdvancedPropertyTrack,
  createBasicAnimationNode,
  createCompositeLayer,
  createEmptyAnimationEditorProject,
  createTimelineKeyframe,
  generateSpriteSheetAnimation,
  inferSpriteSheetGrid,
  parseAnimationEditorProject,
  serializeAnimationEditorProject,
  setSpriteSheetFrame,
  spriteSheetFrameIndex,
} from '../dist-test/testing.js';

test('advanced authoring creates stable vector/text parts and static particle/audio payloads', () => {
  const project = advancedProject();
  const vector = project.nodes.find(node => node.id === 'vector');
  const text = project.nodes.find(node => node.id === 'text');

  assert.equal(vector.components[0].component.type, 'org.haiyue.vector-shape@1');
  assert.deepEqual(vector.components[0].parts.map(part => [part.id, part.role, part.index]), [
    ['vector-vector-fill', 'fill', undefined],
    ['vector-vector-stroke', 'stroke', undefined],
    ['vector-vector-trim', 'modifier', 0],
    ['vector-vector-round', 'modifier', 1],
  ]);
  assert.deepEqual(text.components[0].parts.map(part => part.role), ['text-selector', 'text-animator']);
  assert.equal(project.nodes.find(node => node.id === 'particle').components[0].component.type, 'particle2d');
  assert.equal(project.nodes.find(node => node.id === 'audio').components[0].component.type, 'audio');

  const reopened = parseAnimationEditorProject(JSON.parse(serializeAnimationEditorProject(project)));
  assert.equal(reopened.nodes.length, 4);
});

test('component, text, effect and composite tracks lower to typed inline HYA tracks', () => {
  const project = advancedProject();
  const vector = project.nodes.find(node => node.id === 'vector');
  vector.effects.push(createAdvancedEffect(project, vector.id, 'blur'));
  vector.effects.push(createAdvancedEffect(project, vector.id, 'drop-shadow'));
  vector.compositeLayers.push(createCompositeLayer(project, vector.id, 'text'));

  addBinding(project, vector.id, binding => binding.target.property === 'vector.stroke.width', [14]);
  addBinding(project, vector.id, binding => binding.target.property === 'vector.modifier.trim-end', [0.35]);
  addBinding(project, vector.id, binding => binding.target.property === 'blur.radius', [18, 8]);
  addBinding(project, vector.id, binding => binding.target.property === 'drop-shadow.offset', [22, 30]);
  addBinding(project, vector.id, binding => binding.target.kind === 'composite-property', [10]);
  addBinding(project, 'text', binding => binding.target.property === 'text.selector.end', [40]);
  addBinding(project, 'text', binding => binding.target.property === 'text.animator.position', [0, -32]);

  const compilation = compileAnimationEditorProject(project);
  const vectorNode = compilation.document.nodes.find(node => node.id === vector.id);
  const vectorComponent = vectorNode.components[0];
  assert.equal(vectorComponent.stroke.widthTrack.valueSize, 1);
  assert.deepEqual(vectorComponent.stroke.widthTrack.times, [0, 1]);
  assert.equal(vectorComponent.modifiers[0].endTrack.values[1], 0.35);
  assert.equal(vectorNode.effects[0].radiusTrack.valueSize, 2);
  assert.equal(vectorNode.effects[1].offsetTrack.values[3], 30);
  assert.equal(vectorNode.composite.layers[0].expansionTrack.values[1], 10);

  const textNode = compilation.document.nodes.find(node => node.id === 'text');
  assert.equal(textNode.components[0].animators[0].selector.endTrack.values[1], 40);
  assert.deepEqual(textNode.components[0].animators[0].positionTrack.values, [0, 0, 0, -32]);
  assert.ok(compilation.parsed.extensionsUsed.includes('org.haiyue.vector-shape@1'));
  assert.equal(compilation.parsed.tracks.length, 0, 'inline properties do not become core transform tracks');
});

test('sprite atlas animation is authored as a step-only UV track', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2, frameRate: 12 }));
  project.assets.push({
    id: 'atlas', name: 'Atlas', type: 'image',
    source: { kind: 'external', uri: 'atlas.png' },
    delivery: { uri: 'atlas.png', mimeType: 'image/png', width: 256, height: 128 },
  });
  const sprite = createBasicAnimationNode(project, 'sprite');
  project.nodes.push(sprite);
  const binding = availableAdvancedPropertyBindings(project, sprite.id).find(item => item.target.property === 'sprite.uv-rect');
  const track = createAdvancedPropertyTrack(project, sprite.id, binding.key, 0);
  project.timeline.tracks.push(track);
  createTimelineKeyframe(project, track.id, 1, [0.5, 0, 0.5, 1]);

  assert.equal(track.keyframes[0].interpolation, 'step');
  const compilation = compileAnimationEditorProject(project);
  assert.equal(compilation.document.nodes[0].components[0].uvRectTrack.interpolation, 'step');
  assert.deepEqual(compilation.document.nodes[0].components[0].uvRectTrack.values, [0, 0, 1, 1, 0.5, 0, 0.5, 1]);
});

test('spritesheet editor selects grid cells and generates an evenly timed Step track', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2, frameRate: 12 }));
  project.assets.push({
    id: 'sheet', name: 'Sheet', type: 'image',
    source: { kind: 'external', uri: 'sheet.png' },
    delivery: { uri: 'sheet.png', mimeType: 'image/png', width: 256, height: 128 },
  });
  const sprite = createBasicAnimationNode(project, 'sprite');
  project.nodes.push(sprite);
  const component = sprite.components[0];

  assert.deepEqual(inferSpriteSheetGrid(component.component.uvRect), { columns: 1, rows: 1 });
  setSpriteSheetFrame(project, sprite.id, component.id, 4, 2, 5);
  assert.deepEqual(component.component.uvRect, [0.25, 0.5, 0.25, 0.5]);
  assert.equal(spriteSheetFrameIndex(component.component.uvRect, 4, 2), 5);

  const trackId = generateSpriteSheetAnimation(project, sprite.id, component.id, 4, 2);
  const track = project.timeline.tracks.find(candidate => candidate.id === trackId);
  assert.equal(track.keyframes.length, 8);
  assert.deepEqual(track.keyframes.map(keyframe => keyframe.time), [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
  assert.ok(track.keyframes.every(keyframe => keyframe.interpolation === 'step'));

  setSpriteSheetFrame(project, sprite.id, component.id, 4, 2, 2, 1);
  assert.deepEqual(track.keyframes.find(keyframe => keyframe.time === 1).value, [0.5, 0, 0.25, 0.5]);
  assert.equal(track.keyframes.length, 8);
  const compilation = compileAnimationEditorProject(project);
  assert.equal(compilation.document.nodes[0].components[0].uvRectTrack.times.length, 8);
  assert.equal(compilation.document.nodes[0].components[0].uvRectTrack.interpolation, 'step');
  assert.throws(() => generateSpriteSheetAnimation(project, sprite.id, component.id, 16, 16), /只能容纳 24/);
});

test('gradient paint exposes dynamic start, end and stop-width bindings', () => {
  const project = advancedProject();
  const vector = project.nodes.find(node => node.id === 'vector');
  vector.components[0].component.fill = {
    kind: 'linear-gradient', start: [-50, 0], end: [50, 0],
    stops: [0, 1, 0, 0, 1, 1, 0, 0, 1, 1], opacity: 1,
  };
  addBinding(project, vector.id, binding => binding.target.property === 'vector.gradient.start', [-80, -20]);
  addBinding(project, vector.id, binding => binding.target.property === 'vector.gradient.stops', [0, 1, 1, 0, 1, 1, 0, 1, 1, 1]);

  const compilation = compileAnimationEditorProject(project);
  const fill = compilation.document.nodes.find(node => node.id === vector.id).components[0].fill;
  assert.equal(fill.startTrack.valueSize, 2);
  assert.equal(fill.stopsTrack.valueSize, 10);
  assert.equal(fill.stopsTrack.values.length, 20);
});

function advancedProject() {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2, frameRate: 30 }));
  project.assets.push({
    id: 'sound', name: 'Sound', type: 'audio',
    source: { kind: 'external', uri: 'sound.ogg' },
    delivery: { uri: 'sound.ogg', mimeType: 'audio/ogg' },
  });
  project.nodes.push(
    createBasicAnimationNode(project, 'vector'),
    createBasicAnimationNode(project, 'text'),
    createBasicAnimationNode(project, 'particle'),
    createBasicAnimationNode(project, 'audio'),
  );
  return project;
}

function addBinding(project, nodeId, predicate, secondValue) {
  const binding = availableAdvancedPropertyBindings(project, nodeId).find(predicate);
  assert.ok(binding, `missing advanced binding for ${nodeId}`);
  const track = createAdvancedPropertyTrack(project, nodeId, binding.key, 0);
  project.timeline.tracks.push(track);
  createTimelineKeyframe(project, track.id, 1, secondValue);
  return track;
}
