import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorPlatform } from '@haiyue/editor-platform';
import { AnimationEditorStore, parseAnimationEditorProject, serializeAnimationEditorProject } from '../dist-test/testing.js';
import { registerAnimationEditorOperations } from '../dist-test/operations.js';
import { parseAnimation } from '@haiyue/animation-spec';
import { operationClient, textResource, readText } from '../../scripts/editor-e2e/operationWorkflow.mjs';

const fixture = readFileSync(new URL('../examples/state-machine-multitrack.hya-project.json', import.meta.url), 'utf8');
test('HYA open/query/edit/undo/export shares authoring state and compiles real HYA', async () => {
  const platform = new EditorPlatform(), initial = parseAnimationEditorProject(fixture);
  const store = new AnimationEditorStore({ ...initial, name: 'Prior project' });
  platform.documents.attach({ identity: { id: 'animation.current', kind: 'haiyue.animation-project', name: 'test' },
    get revision() { return store.revision; }, get savedRevision() { return store.isDirty ? -1 : store.revision; },
    serialize: () => store.project, markSaved() {}, subscribe(listener) { return { dispose: store.subscribe(listener) }; }, dispose() {} });
  const bindings = registerAnimationEditorOperations(platform, store), call = operationClient(platform, 'animation.current');
  try {
    const input = JSON.parse(fixture); delete input.editor;
    await call('hya.document.open', { resourceId: textResource(platform, JSON.stringify(input)) });
    assert.equal(store.project.editor, undefined, 'open drops metadata absent from the new project');
    const before = serializeAnimationEditorProject(store.project), query = await call('hya.document.query');
    assert.equal(query.name, initial.name);
    await call('hya.node.opacity', { nodeId: query.nodes[0].id, opacity: 0.25 });
    assert.equal(store.project.nodes[0].transform.opacity, 0.25);
    const edited = await call('hya.document.export', { format: 'hya' });
    assert.ok(parseAnimation(platform.resources.read(edited.resourceId).buffer));
    await call('hya.history.undo'); assert.equal(serializeAnimationEditorProject(store.project), before);
    const exported = await call('hya.document.export', { format: 'project' });
    assert.equal(readText(platform, exported), before);
    const node = await call('hya.node.create', { kind: 'rectangle', name: 'RPC node' });
    await call('hya.node.transform', { nodeId: node.nodeId, patch: { x: 12, y: 34, rotation: 0.5 } });
    assert.deepEqual(store.project.nodes.find(n => n.id === node.nodeId).transform.position, [12, 34]);
    const track = await call('hya.track.create', { nodeId: node.nodeId, property: 'position' });
    const key = await call('hya.keyframe.set', { trackId: track.trackId, time: 1, value: [55, 66] });
    assert.ok((await call('hya.keyframes.query', { trackId: track.trackId })).keyframes.some(k => k.id === key.keyframeId && k.value[0] === 55));
    assert.ok((await call('hya.tracks.query')).tracks.some(t => t.id === track.trackId));
    assert.ok(parseAnimation(platform.resources.read((await call('hya.document.export', { format: 'hya' })).resourceId).buffer));
    await call('hya.history.undo'); await call('hya.history.redo');
    assert.equal(store.project.timeline.tracks.find(t => t.id === track.trackId).keyframes.length, 2);
    for (let i = 0; i < 4; i++) await call('hya.history.undo');
    assert.equal(serializeAnimationEditorProject(store.project), before);
    const redo = platform.history.snapshot();
    const sub = store.subscribe(() => { throw new Error('injected observer failure'); });
    const result = await platform.operations.execute({ apiVersion: '1', requestId: 'fault', operation: 'hya.node.opacity', documentId: 'animation.current', expectedRevision: store.revision, params: { nodeId: query.nodes[0].id, opacity: 0.1 } });
    sub(); assert.equal(result.status, 'failed'); assert.equal(serializeAnimationEditorProject(store.project), before); assert.deepEqual(platform.history.snapshot(), redo);
    await call('hya.history.undo'); assert.equal(store.project.name, 'Prior project');
    const bad = await platform.operations.execute({ apiVersion: '1', requestId: 'invalid', operation: 'hya.document.open', documentId: 'animation.current', expectedRevision: store.revision, params: { resourceId: textResource(platform, '{}') } });
    assert.equal(bad.status, 'failed'); assert.equal(store.project.name, 'Prior project');
  } finally { await bindings.dispose(); await platform.dispose(); }
});
