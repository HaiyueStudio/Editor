import assert from 'node:assert/strict';
import test from 'node:test';

import {
  animationAssetIdForFile,
  animationAssetReferences,
  animationNodeContentKind,
  applyAnimationNodeHierarchy,
  buildAnimationNodeHierarchy,
  classifyAnimationAssetFile,
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  createAnimationEditorAssetFromFile,
  createBasicAnimationNode,
  createEmptyAnimationEditorProject,
  deleteAnimationNodeSubtrees,
  duplicateAnimationNodes,
} from '../dist-test/testing.js';

test('basic content factories create HYA-valid group, shape, path, text and sprite nodes', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject());
  project.assets.push(imageAsset());
  const kinds = ['group', 'rectangle', 'ellipse', 'path', 'text', 'sprite'];

  for (const kind of kinds) project.nodes.push(createBasicAnimationNode(project, kind));

  assert.deepEqual(project.nodes.map(animationNodeContentKind), [
    'Group', 'Rectangle', 'Ellipse', 'Path', 'Text', 'Sprite',
  ]);
  const compilation = compileAnimationEditorProject(project);
  assert.equal(compilation.parsed.nodes.length, 6);
  assert.equal(compilation.parsed.resources.length, 1);
});

test('hierarchy projection preserves visual order and applies reparenting deterministically', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject());
  const group = createBasicAnimationNode(project, 'group');
  project.nodes.push(group);
  const rectangle = createBasicAnimationNode(project, 'rectangle', { parentId: group.id });
  project.nodes.push(rectangle);
  const text = createBasicAnimationNode(project, 'text');
  project.nodes.push(text);

  const initial = buildAnimationNodeHierarchy(project.nodes);
  assert.deepEqual(initial.map(node => node.id), [group.id, text.id]);
  assert.deepEqual(initial[0].children.map(node => node.id), [rectangle.id]);

  applyAnimationNodeHierarchy(project, [
    { id: text.id, label: text.name, sourceNodeId: text.id },
    {
      id: group.id,
      label: group.name,
      sourceNodeId: group.id,
      children: [{ id: rectangle.id, label: rectangle.name, sourceNodeId: rectangle.id }],
    },
  ]);
  assert.deepEqual(project.nodes.map(node => node.id), [text.id, group.id, rectangle.id]);
  assert.equal(project.nodes[0].parent, undefined);
  assert.equal(project.nodes[2].parent, group.id);
});

test('tree paste duplicates static subtrees with stable copied ids and parent references', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject());
  const group = createBasicAnimationNode(project, 'group');
  project.nodes.push(group);
  const child = createBasicAnimationNode(project, 'rectangle', { parentId: group.id });
  project.nodes.push(child);
  const pasted = [{
    id: `${group.id}-copy`,
    label: group.name,
    sourceNodeId: group.id,
    children: [{
      id: `${child.id}-copy`,
      label: child.name,
      sourceNodeId: child.id,
    }],
  }];
  const hierarchy = [...buildAnimationNodeHierarchy(project.nodes), ...pasted];

  const copiedIds = duplicateAnimationNodes(project, hierarchy, pasted);

  assert.deepEqual(copiedIds, [`${group.id}-copy`, `${child.id}-copy`]);
  assert.equal(project.nodes.at(-1).parent, `${group.id}-copy`);
  assert.deepEqual(project.nodes.at(-1).transform.position, [child.transform.position[0] + 16, child.transform.position[1] + 16]);
  assert.equal(compileAnimationEditorProject(project).parsed.nodes.length, 4);
});

test('subtree deletion cleans tracks, composites and state-machine masks', () => {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject());
  const group = createBasicAnimationNode(project, 'group');
  project.nodes.push(group);
  const child = createBasicAnimationNode(project, 'rectangle', { parentId: group.id });
  project.nodes.push(child);
  const survivor = createBasicAnimationNode(project, 'ellipse');
  survivor.compositeLayers.push({
    id: 'child-mask', kind: 'mask', sourceNodeId: child.id, mode: 'alpha', operation: 'add',
  });
  project.nodes.push(survivor);
  project.timeline.tracks.push({
    id: 'child-opacity',
    name: 'Child opacity',
    target: { kind: 'node-transform', nodeId: child.id, property: 'opacity' },
    valueSize: 1,
    keyframes: [{ id: 'child-opacity-0', time: 0, value: [1], interpolation: 'linear' }],
  });
  project.stateMachine = {
    format: 'haiyue-animation-state-machine@1',
    id: 'machine',
    name: 'Machine',
    parameters: [],
    layers: [{
      id: 'base', name: 'Base', initialStateId: 'idle',
      states: [{ id: 'idle', name: 'Idle', motion: { kind: 'clip', clipId: 'idle' } }],
      transitions: [],
      mask: { include: [group.id, child.id, survivor.id] },
    }],
  };

  const result = deleteAnimationNodeSubtrees(project, [group.id]);

  assert.deepEqual([...result.deletedNodeIds], [group.id, child.id]);
  assert.equal(result.deletedTrackCount, 1);
  assert.equal(result.deletedCompositeCount, 1);
  assert.deepEqual(project.nodes.map(node => node.id), [survivor.id]);
  assert.deepEqual(project.stateMachine.layers[0].mask.include, [survivor.id]);
});

test('asset helpers classify files, create stable ids and report component references', () => {
  assert.equal(classifyAnimationAssetFile('photo.PNG', ''), 'image');
  assert.equal(classifyAnimationAssetFile('voice.bin', 'audio/ogg'), 'audio');
  assert.equal(classifyAnimationAssetFile('payload.bin', ''), 'binary');
  assert.equal(animationAssetIdForFile('Hero Portrait.PNG', new Set()), 'hero-portrait');
  assert.equal(animationAssetIdForFile('Hero Portrait.PNG', new Set(['hero-portrait'])), 'hero-portrait-2');

  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject());
  project.assets.push(imageAsset());
  project.nodes.push(createBasicAnimationNode(project, 'sprite'));
  assert.deepEqual(animationAssetReferences(project, 'image-1'), [{
    nodeId: 'sprite', componentId: 'sprite-sprite', field: 'resource',
  }]);
});

test('binary file import produces a portable project source and HYA data URI', async () => {
  const project = createEmptyAnimationEditorProject();
  const asset = await createAnimationEditorAssetFromFile(
    new File([new Uint8Array([1, 2, 3])], 'payload.bin', { type: 'application/octet-stream' }),
    project,
  );
  assert.equal(asset.id, 'payload');
  assert.equal(asset.source.data, 'AQID');
  assert.equal(asset.delivery.uri, 'data:application/octet-stream;base64,AQID');

  const draft = cloneAnimationEditorProject(project);
  draft.assets.push(asset);
  const compilation = compileAnimationEditorProject(draft);
  assert.equal(compilation.parsed.resources[0].uri, asset.delivery.uri);
});

function imageAsset() {
  return {
    id: 'image-1',
    name: 'Image.png',
    type: 'image',
    source: { kind: 'external', uri: 'https://example.test/image.png' },
    delivery: {
      uri: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 64, height: 32, colorSpace: 'srgb',
    },
  };
}
