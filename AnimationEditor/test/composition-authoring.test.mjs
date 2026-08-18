import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneAnimationEditorProject,
  createEmptyAnimationEditorProject,
  minimumCompositionDuration,
  setCompositionDuration,
} from '../dist-test/testing.js';

test('composition duration expands on the frame grid and clamps the editor playhead', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 1, frameRate: 30 }));
  project.editor.timeline.playhead = 1;

  assert.equal(setCompositionDuration(project, 2.01), 61 / 30);
  assert.equal(project.composition.duration, 61 / 30);
  assert.equal(setCompositionDuration(project, 0.01), 1 / 30);
  assert.equal(project.editor.timeline.playhead, 1 / 30);
});

test('composition duration never truncates authored nodes, keyframes or clips', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 4, frameRate: 20 }));
  project.nodes.push({
    id: 'node', name: 'Node', start: 0.5, duration: 1,
    transform: { position: [0, 0], rotation: 0, scale: [1, 1], anchor: [0, 0], opacity: 1 },
    components: [], effects: [], compositeLayers: [],
  });
  project.timeline.tracks.push({
    id: 'track', name: 'Track', enabled: true,
    target: { kind: 'node-transform', nodeId: 'node', property: 'position' },
    keyframes: [{ id: 'key', time: 1.75, value: [0, 0], interpolation: 'linear' }],
  });
  project.timeline.clips.push({ id: 'clip', name: 'Clip', start: 1, duration: 1.2 });

  assert.equal(minimumCompositionDuration(project), 2.2);
  assert.equal(setCompositionDuration(project, 1), 2.2);
});
