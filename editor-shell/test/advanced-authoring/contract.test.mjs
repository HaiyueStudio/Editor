import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { parseAdvancedAuthoringView, parseFieldInput } from '../../dist/advanced-authoring/validation.js';
import { projectAuthoringHierarchy, canReparent } from '../../dist/advanced-authoring/hierarchy.js';

test('authoring read model preserves public Selection/History and rejects unknown versions, cycles, mixed ownership and live values', t => {
  const f = fixture(); t.after(f.close); const view = f.view();
  assert.ok(Object.isFrozen(view)); assert.deepEqual(view.selection, f.selection.snapshot()); assert.deepEqual(view.history, f.history.snapshot());
  for (const patch of [ { schemaVersion: 2 }, { unexpected: true }, { hierarchy: [...view.hierarchy, view.hierarchy[0]] },
    { hierarchy: view.hierarchy.map((row, i) => i === 0 ? { ...row, parentId: 'entity:2' } : row) },
    { selection: { ...view.selection, active: { ...view.selection.active, documentId: 'foreign' } } },
    { selection: { ...view.selection, items: [{ kind: 'entity', id: 'entity:missing', documentId: view.binding.documentId }] } },
    { binding: { ...view.binding, revision: -1 } },
    { runtime: { ...view.runtime, status: 'current', instanceId: 'play:stale', documentRevision: 99, frame: 1, tick: 1 } },
    { sections: [{ ...view.sections[0], fields: [{ ...view.sections[0].fields[0], value: Infinity }] }] },
  ]) assert.throws(() => parseAdvancedAuthoringView({ ...view, ...patch }));
  let reads = 0; assert.throws(() => parseAdvancedAuthoringView({ ...view, get diagnostics() { reads++; return []; } })); assert.equal(reads, 0);
  assert.throws(() => parseAdvancedAuthoringView({ ...view, diagnostics: [new Date()] }));
  assert.throws(() => parseAdvancedAuthoringView({ ...view, diagnostics: ['x'.repeat(5 * 1024 * 1024)] }), /budget/);
});

test('complete hierarchy handles 0/1/100/1000 entities, deterministic ordering, ancestor search and pages without dropping deep rows', t => {
  for (const count of [0,1,100,1000]) {
    const f = fixture(count); t.after(f.close); const view = f.view();
    const seen = new Set(); for (let offset = 0; offset < count; offset += 50) for (const row of projectAuthoringHierarchy(view.hierarchy, { offset }).rows) { assert.ok(!seen.has(row.item.reference.id)); seen.add(row.item.reference.id); }
    assert.equal(seen.size, count);
    if (count > 2) {
      const selected = projectAuthoringHierarchy(view.hierarchy, { search: 'Entity 2' }); assert.equal(selected.rows[0].item.reference.id, 'entity:0'); assert.ok(selected.rows.some(row => row.depth === 1));
      assert.equal(projectAuthoringHierarchy(view.hierarchy, { collapsed: new Set(['entity:0']) }).total, count - 1);
      assert.equal(canReparent(view.hierarchy, 'entity:0', 'entity:2'), false); assert.equal(canReparent(view.hierarchy, 'entity:2', 'entity:1'), true);
    }
  }
  const f = fixture(1000); t.after(f.close); for (let i = 1; i < f.source.length; i++) f.source[i].parentId = f.source[i-1].id;
  const deep = projectAuthoringHierarchy(f.view().hierarchy, { search: 'Entity 999', offset: 950 }); assert.equal(deep.rows.at(-1).depth, 999);
});

test('inspector input rejects invalid numeric, enum and JSON edits while keeping nested fields editable through their schema owner', t => {
  const f = fixture(); t.after(f.close); const fields = f.view().sections[0].fields;
  assert.equal(parseFieldInput(fields[0], '7.5'), 7.5);
  for (const value of ['', 'NaN', '-1', '21', 'Infinity']) assert.throws(() => parseFieldInput(fields[0], value));
  assert.deepEqual(parseFieldInput(fields[1], '{"data":[3,{"nested":true}]}'), { data: [3, { nested: true }] });
  assert.throws(() => parseFieldInput(fields[1], '{"__proto__":{}}'));
  assert.throws(() => parseFieldInput({ ...fields[0], readOnly: true }, '5'));
  const choice = { id: 'enum', label: 'Choice', kind: 'enum', value: 'a', options: [{ label: 'A', value: 'a' }, { label: 'B', value: { mode: 'b' } }], readOnly: false };
  assert.deepEqual(parseFieldInput(choice, '1'), { mode: 'b' }); for (const value of ['-1','2','','0.5']) assert.throws(() => parseFieldInput(choice, value));
});
