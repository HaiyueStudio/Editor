import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnimationEditorStore,
  CommandHistory,
  cloneAnimationEditorProject,
  compileAnimationEditorProject,
  createBasicAnimationNode,
  createCoreTransformTrack,
  createEmptyAnimationEditorProject,
  createProjectMutationCommand,
  createTimelineKeyframe,
  parseAnimationEditorProject,
  serializeAnimationEditorProject,
} from '../dist-test/testing.js';

const domain = await import('../dist-test/path-authoring.js');
const { PathGeometryCache } = await import('../dist-test/path-geometry-cache.js');

test('M/L/Q/C/Z editing preserves stable commands and supports split, tangent, delete, open, reverse and duplicate', () => {
  let path = domain.createAuthoringPath('mixed', [20, 20]);
  path = domain.appendPathCommand(path, { kind: 'L', end: [100, 20] });
  path = domain.appendPathCommand(path, { kind: 'Q', control: [140, 20], end: [140, 60] });
  path = domain.appendPathCommand(path, {
    kind: 'C', controlOut: [140, 100], controlIn: [100, 140], end: [60, 140],
  });
  path = domain.closeAuthoringPath(path);
  assert.equal(domain.serializeAuthoringPath(path).commands, 'MLQCZ');

  const cubic = path.commands.find(command => command.kind === 'C');
  const moved = domain.movePathPoint(path, { commandId: cubic.id, part: 'control-in' }, [80, 150], 'unified');
  assert.deepEqual(moved.commands.find(command => command.id === cubic.id).controlIn, [80, 150]);
  const split = domain.splitPathCommand(moved, cubic.id, 0.5);
  assert.equal(domain.serializeAuthoringPath(split).commands, 'MLQCCZ');
  assert.equal(split.commands.find(command => command.id === cubic.id).id, cubic.id);

  const downgraded = domain.deletePathPoint(split, { commandId: cubic.id, part: 'control-out' });
  assert.equal(downgraded.commands.find(command => command.id === cubic.id).kind, 'Q');
  const opened = domain.openAuthoringPath(downgraded);
  assert.equal(domain.serializeAuthoringPath(opened).commands.endsWith('Z'), false);
  const reversed = domain.reverseAuthoringPath(domain.closeAuthoringPath(opened));
  assert.equal(domain.pathTopologySignature(reversed).closedContours, 1);
  assert.equal(domain.pathTopologySignature(reversed).pointCount, domain.pathTopologySignature(downgraded).pointCount);
  const duplicate = domain.duplicateAuthoringPath(reversed, 'mixed-copy');
  assert.equal(duplicate.id, 'mixed-copy');
  assert.notEqual(duplicate.commands[0].id, reversed.commands[0].id);
  assert.deepEqual(domain.serializeAuthoringPath(duplicate), domain.serializeAuthoringPath(reversed));
});

test('screen-space hit testing stays on the same point across zoom/pan changes', () => {
  const path = closedTriangle();
  const reference = { commandId: path.commands[1].id, part: 'end' };
  const views = [
    { zoom: 1, pan: [0, 0] },
    { zoom: 3.5, pan: [140, -35] },
    { zoom: 0.4, pan: [-16, 230] },
  ];
  for (const view of views) {
    const screen = domain.worldToPathScreen(path.commands[1].end, view);
    const hit = domain.hitTestAuthoringPath(path, [screen[0] + 2, screen[1] - 2], view, 8);
    assert.equal(hit.kind, 'point');
    assert.deepEqual(hit.reference, reference);
  }
});

test('Morph accepts stable topology, exposes correspondence and diagnoses command/count mismatches precisely', () => {
  const base = closedTriangle();
  const target = domain.movePathPoint(base, { commandId: base.commands[1].id, part: 'end' }, [180, 32]);
  assert.equal(domain.validatePathMorphTopology(base, target).commands, 'MLLZ');
  assert.equal(domain.pathMorphCorrespondence(base, target).length, 3);
  const commandMismatch = domain.parseAuthoringPath('other', 'MQZ', [0, 0, 40, 0, 100, 20]);
  assert.throws(
    () => domain.validatePathMorphTopology(base, commandMismatch),
    error => error.code === 'E_PATH_MORPH_COMMAND_MISMATCH' && error.path === '$.morph.commands[1]',
  );
  const pointMismatch = domain.parseAuthoringPath('short', 'ML', [0, 0, 100, 20]);
  assert.throws(
    () => domain.validatePathMorphTopology(base, pointMismatch),
    error => error.code === 'E_PATH_MORPH_POINT_COUNT_MISMATCH' && error.path === '$.morph.values',
  );
});

test('authored vector, Morph and paint survive save/reopen and compiler binary round trip exactly', () => {
  let fixture = vectorProject();
  const target = domain.movePathPoint(fixture.path, { commandId: fixture.path.commands[1].id, part: 'end' }, [210, 45]);
  const morph = domain.createPathMorphKeyframe(fixture.project, fixture.nodeId, fixture.componentId, 1, target);
  let project = domain.editProjectPathVectorStyle(morph.project, fixture.nodeId, fixture.componentId, {
    kind: 'fill-gradient', gradientKind: 'linear-gradient', start: [0, 0], end: [180, 120],
    stops: [0, 0.1, 0.9, 0.7, 1, 1, 0.65, 0.1, 0.9, 1], opacity: 0.85,
  });
  project = domain.editProjectPathVectorStyle(project, fixture.nodeId, fixture.componentId, {
    kind: 'trim', value: { start: 0.1, end: 0.8, offset: 0.05, mode: 'simultaneous' },
  });
  project = domain.editProjectPathVectorStyle(project, fixture.nodeId, fixture.componentId, { kind: 'round', radius: 9 });

  const sampled = domain.sampleProjectMorphPath(project, fixture.nodeId, fixture.componentId, 0.5);
  assert.ok(sampled.commands[1].end[0] > fixture.path.commands[1].end[0]);
  assert.ok(sampled.commands[1].end[0] < target.commands[1].end[0]);
  const reopened = parseAnimationEditorProject(JSON.parse(serializeAnimationEditorProject(project)));
  const compilation = compileAnimationEditorProject(reopened);
  const component = compilation.document.nodes[0].components[0];
  assert.equal(component.commands, 'MLLZ');
  assert.deepEqual(component.values, domain.serializeAuthoringPath(fixture.path).values);
  assert.equal(component.morph.valueSize, 6);
  assert.equal(component.fill.kind, 'linear-gradient');
  assert.deepEqual(component.modifiers.map(modifier => modifier.kind), ['trim-path', 'round-corners']);
  assert.deepEqual(Array.from(compilation.parsed.nodes[0].components[0].values), component.values);
  assert.deepEqual(Array.from(compilation.parsed.nodes[0].components[0].morph.values), component.morph.values);
});

test('style sampling and ordered Trim/Round overlays are deterministic', () => {
  const fixture = vectorProject();
  let project = domain.editProjectPathVectorStyle(fixture.project, fixture.nodeId, fixture.componentId, {
    kind: 'stroke', value: {
      color: [1, 0.4, 0.1, 1], width: 8, opacity: 0.75,
      lineCap: 'round', lineJoin: 'bevel', miterLimit: 3, dash: [12, 6], dashOffset: 2,
    },
  });
  project = domain.editProjectPathVectorStyle(project, fixture.nodeId, fixture.componentId, {
    kind: 'trim', value: { start: 0.15, end: 0.7, offset: 0, mode: 'individual' },
  });
  project = domain.editProjectPathVectorStyle(project, fixture.nodeId, fixture.componentId, { kind: 'round', radius: 12 });
  const style = domain.resolveProjectPathVectorStyle(project, fixture.nodeId, fixture.componentId, 0);
  assert.deepEqual(style.modifiers.map(modifier => modifier.kind), ['trim-path', 'round-corners']);
  assert.deepEqual(style.stroke.dash, [12, 6]);
  const first = domain.buildPathOverlayContours(fixture.path, style.modifiers, 0.35);
  const second = domain.buildPathOverlayContours(fixture.path, style.modifiers, 0.35);
  assert.deepEqual(first, second);
  assert.ok(first.length > 0 && first.every(contour => contour.closed === false));
});

test('one gesture produces one undo unit and cancel/stale replacement fully roll back', () => {
  const fixture = vectorProject();
  const transaction = new domain.PathGestureTransaction(fixture.project);
  const once = domain.movePathPoint(fixture.path, { commandId: fixture.path.commands[1].id, part: 'end' }, [170, 30]);
  const twice = domain.movePathPoint(fixture.path, { commandId: fixture.path.commands[1].id, part: 'end' }, [190, 40]);
  transaction.previewPath(fixture.nodeId, fixture.componentId, once);
  transaction.previewPath(fixture.nodeId, fixture.componentId, twice);
  const completed = transaction.complete(fixture.project);
  assert.equal(transaction.state, 'committed');
  assert.deepEqual(domain.readProjectAuthoringPath(completed, fixture.nodeId, fixture.componentId).commands[1].end, [190, 40]);

  const store = new AnimationEditorStore(fixture.project);
  const history = new CommandHistory();
  assert.equal(history.execute(createProjectMutationCommand(store, 'Move path point', draft => {
    const source = completed.nodes[0].components[0].component;
    draft.nodes[0].components[0].component.commands = source.commands;
    draft.nodes[0].components[0].component.values = [...source.values];
  })), true);
  assert.equal(history.undoLabel, 'Move path point');
  history.undo(); assert.deepEqual(domain.readProjectAuthoringPath(store.project, fixture.nodeId, fixture.componentId).commands[1].end, [150, 20]);
  history.redo(); assert.deepEqual(domain.readProjectAuthoringPath(store.project, fixture.nodeId, fixture.componentId).commands[1].end, [190, 40]);

  const cancelled = new domain.PathGestureTransaction(fixture.project);
  cancelled.previewPath(fixture.nodeId, fixture.componentId, twice);
  assert.equal(cancelled.cancel(), fixture.project);
  assert.equal(cancelled.previewProject, null);
  const stale = new domain.PathGestureTransaction(fixture.project);
  stale.previewPath(fixture.nodeId, fixture.componentId, once);
  assert.equal(stale.complete(completed), null);
  assert.equal(stale.state, 'cancelled');
});

test('motion path selection and spatial edits use the canonical position sampler', () => {
  const fixture = vectorProject();
  const draft = cloneAnimationEditorProject(fixture.project);
  const track = createCoreTransformTrack(draft, fixture.nodeId, 'position', 0);
  track.keyframes[0].spatialOut = [45, 0];
  draft.timeline.tracks.push(track);
  const end = createTimelineKeyframe(draft, track.id, 1, [220, 120]);
  end.spatialIn = [-30, 0];
  const overlay = domain.buildPathMotionOverlay(draft, track.id, [{ trackId: track.id, keyframeId: end.id }]);
  assert.equal(overlay.selectedKeyframeIds.has(end.id), true);
  assert.ok(overlay.points.length > 2);
  const moved = domain.movePathMotionKey(draft, { trackId: track.id, keyframeId: end.id }, [240, 140]);
  const handled = domain.movePathMotionHandle(moved, {
    trackId: track.id, keyframeId: end.id, handle: 'incoming',
  }, [-50, 10], 'unified');
  const edited = handled.timeline.tracks.find(candidate => candidate.id === track.id).keyframes.find(key => key.id === end.id);
  assert.deepEqual(edited.value, [240, 140]);
  assert.deepEqual(edited.spatialIn, [-50, 10]);
});

test('geometry cache ignores view/style churn and stays bounded during drag-like geometry updates', () => {
  const cache = new PathGeometryCache({ maxEntries: 4, maxFlattenedPoints: 500 });
  const base = closedTriangle();
  cache.get(base, 0.35);
  for (let index = 0; index < 40; index++) {
    domain.hitTestAuthoringPath(base, domain.worldToPathScreen([150, 20], {
      zoom: 0.5 + index / 10, pan: [index * 2, -index],
    }), { zoom: 0.5 + index / 10, pan: [index * 2, -index] });
    cache.get(base, 0.35);
  }
  assert.equal(cache.metrics.rebuilds, 1);
  assert.equal(cache.metrics.entries, 1);
  for (let index = 0; index < 12; index++) {
    cache.get(domain.movePathPoint(base, { commandId: base.commands[1].id, part: 'end' }, [150 + index, 20]), 0.35);
  }
  assert.ok(cache.metrics.entries <= 4);
  assert.ok(cache.metrics.evictions > 0);
  assert.ok(cache.metrics.flattenedPoints <= 500);
});

function closedTriangle() {
  let path = domain.createAuthoringPath('triangle', [40, 120]);
  path = domain.appendPathCommand(path, { kind: 'L', end: [150, 20] });
  path = domain.appendPathCommand(path, { kind: 'L', end: [230, 140] });
  return domain.closeAuthoringPath(path);
}

function vectorProject() {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({ duration: 2, frameRate: 30 }));
  const node = createBasicAnimationNode(project, 'vector');
  const path = closedTriangle();
  const component = domain.createAuthoredPathComponent('vector-path', path, {
    stroke: {
      color: [1, 0.7, 0.15, 1], width: 5, opacity: 1,
      lineCap: 'round', lineJoin: 'round', miterLimit: 4, dash: [], dashOffset: 0,
    },
  });
  node.components = [component]; project.nodes.push(node);
  return { project, path, nodeId: node.id, componentId: component.id };
}
