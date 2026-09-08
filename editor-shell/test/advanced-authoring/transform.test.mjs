import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, transform } from './fixture.mjs';
import { AuthoringTransformGesture, authoringWorldMatrices, authoringProjectedAxes } from '../../dist/advanced-authoring/transform.js';
const options = patch => ({ mode: 'translate', space: 'world', axis: 'x', pivot: 'active', snap: 0, ...patch });
const near = (actual, expected) => assert.ok(Math.abs(actual-expected) < 1e-6, `${actual} ≈ ${expected}`);

test('a complete drag creates one shared History entry; preview, no-op and cancellation never mutate the source', t => {
  const f = fixture(); t.after(f.close); const view = f.view(), before = JSON.stringify(f.source);
  const drag = new AuthoringTransformGesture(view, options({ snap: .5 }));
  for (const pixels of [1,3,6,11]) drag.update(pixels, 0);
  assert.equal(JSON.stringify(f.source), before); assert.equal(f.history.snapshot().entries.length, 0);
  const intent = drag.finish(f.view()); near(intent.changes[0].after.position[0], 1); f.commit(intent);
  assert.equal(f.history.snapshot().entries.length, 1); near(f.source[0].value.position[0], 1);
  f.history.undo(); assert.equal(JSON.stringify(f.source), before); f.history.redo(); near(f.source[0].value.position[0], 1);
  const cancelled = new AuthoringTransformGesture(f.view(), options({})); cancelled.update(20, 0); cancelled.cancel(); cancelled.cancel(); assert.throws(() => cancelled.finish(f.view()), /stale/); assert.equal(f.history.snapshot().entries.length, 1);
  f.source[0].value = transform([1,0,0], [0,359,0]);
  const noop = new AuthoringTransformGesture(f.view(), options({ mode: 'rotate', space: 'local', snap: 15 })); noop.update(1, 0); assert.equal(noop.finish(f.view()), null);
});

test('world translation honors rotated/scaled parents and selected ancestors are not transformed twice', t => {
  const f = fixture(); t.after(f.close); f.source[0].value = transform([1,2,3], [0,90,0], [2,2,2]);
  f.selection.set([f.reference('entity:2')]);
  const before = authoringWorldMatrices(f.source).get('entity:2');
  const drag = new AuthoringTransformGesture(f.view(), options({})); drag.update(10,0); const intent = drag.finish(f.view()); f.commit(intent);
  const after = authoringWorldMatrices(f.source).get('entity:2'); near(after[12]-before[12], 1); near(after[13]-before[13], 0); near(after[14]-before[14], 0);
  f.selection.set([f.reference('entity:0'), f.reference('entity:2')]);
  const group = new AuthoringTransformGesture(f.view(), options({})); assert.equal(group.update(10,0).changes.length, 1);
});

test('local translation, center rotation, local scale and zero-extent axes use explicit geometry semantics', t => {
  const f = fixture(); t.after(f.close); f.source[0].value = transform([0,0,0], [0,90,0]);
  const axis = authoringProjectedAxes(f.view(),'local').x, length = Math.hypot(...axis); near(axis[0],45); near(axis[1],-35);
  let drag = new AuthoringTransformGesture(f.view(), options({ space: 'local' })); const moved = drag.update(axis[0]*10/length,axis[1]*10/length).changes[0].after.position; near(moved[0],0); near(moved[2],-1); drag.cancel();
  f.source[0].value = transform([-1,0,0]); f.source[1].value = transform([1,0,0]); f.selection.set([f.reference('entity:0'), f.reference('entity:1')]);
  drag = new AuthoringTransformGesture(f.view(), options({ mode: 'rotate', axis: 'y', pivot: 'center', snap: 15 }));
  const rotated = drag.update(0,-180).changes; near(rotated[0].after.position[0],0); near(rotated[0].after.position[2],1); near(rotated[1].after.position[2],-1);
  drag.cancel();
  drag = new AuthoringTransformGesture(f.view(), options({ mode: 'scale', space: 'local', axis: 'all', pivot: 'center' })); const scaled = drag.update(100*Math.SQRT2,0).changes; near(scaled[0].after.scale[0], 2); near(scaled[0].after.position[0],-2);
  assert.throws(() => new AuthoringTransformGesture(f.view(), options({ mode: 'scale' })), /scale-local-only/);
  const view = f.view(), edgeOn = { ...view, gizmo: { ...view.gizmo, projection: { ...view.gizmo.projection, axes: { ...view.gizmo.projection.axes, x: [0,0] } } } };
  drag = new AuthoringTransformGesture(edgeOn, options({})); assert.throws(() => drag.update(10,0), /axis-edge-on/); drag.cancel();
});

test('selection, document revision and opening epoch changes invalidate drag commits', t => {
  const f = fixture(); t.after(f.close);
  let drag = new AuthoringTransformGesture(f.view(), options({})); drag.update(10,0); f.selection.set([f.reference('entity:1')]); assert.throws(() => drag.finish(f.view()), /gesture-stale/);
  drag = new AuthoringTransformGesture(f.view(), options({})); drag.update(10,0); f.setEpoch('open:2'); assert.throws(() => drag.finish(f.view()), /gesture-stale/);
  drag = new AuthoringTransformGesture(f.view(), options({})); drag.update(10,0); const old = f.view(); assert.throws(() => drag.finish({ ...old, binding: { ...old.binding, revision: old.binding.revision+1 } }), /gesture-stale/);
  assert.equal(f.history.snapshot().entries.length, 0);
});
