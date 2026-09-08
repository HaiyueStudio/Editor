import { EditorHistoryService, EditorSelectionService } from '@haiyue/editor-platform';
import { parseAdvancedAuthoringView } from '../../dist/advanced-authoring/validation.js';

export const transform = (position = [0, 0, 0], rotationDegrees = [0, 0, 0], scale = [1, 1, 1]) => ({ position, rotationDegrees, scale });
export function fixture(count = 3) {
  const selection = new EditorSelectionService(), history = new EditorHistoryService();
  const source = Array.from({ length: count }, (_, i) => ({ id: `entity:${i}`, parentId: i === 2 ? 'entity:0' : null, value: transform([i,0,0]) }));
  let revision = 1, epoch = 'open:1', runtime = { status: 'stopped', instanceId: null, documentRevision: null, frame: null, tick: null, diagnostics: [], fields: [] };
  const reference = id => ({ kind: 'entity', id, documentId: 'document:fixture' });
  if (count) selection.set([reference('entity:0')]);
  const view = () => parseAdvancedAuthoringView({ schemaVersion: 1, binding: { documentId: 'document:fixture', revision, epoch },
    hierarchy: source.map((item, i) => ({ reference: reference(item.id), label: `Entity ${i}`, parentId: item.parentId, order: i, editable: true })), selection: selection.snapshot(), history: history.snapshot(),
    sections: count ? [{ id: 'component:settings', title: 'Settings', description: 'Registered settings', enabled: true, editable: true, removable: true, fields: [{ id: '/speed', label: 'Speed', kind: 'number', value: 4, minimum: 0, maximum: 20, readOnly: false }, { id: '/options', label: 'Options', kind: 'json', value: { data: [1,2] }, readOnly: false }] }] : [],
    additions: [{ id: 'settings@1', label: 'Settings', description: 'Registered schema', enabled: true }],
    gizmo: { enabled: Boolean(count), transforms: source, projection: { origin: [200, 180], axes: { x: [70,0], y: [0,-70], z: [-45,35] }, unitsPerPixel: .1 } }, runtime, diagnostics: [], capabilities: { multiSelection: true, rename: true, reparent: true, addSection: true } });
  return { selection, history, source, view, reference, setEpoch: value => epoch = value, setRuntime: value => runtime = value,
    commit(intent) {
      const before = JSON.parse(JSON.stringify(source)), after = source.map(item => ({ ...item, value: intent.changes.find(change => change.reference.id === item.id)?.after ?? item.value }));
      history.execute({ label: 'Transform selection', execute() { source.splice(0, source.length, ...after); revision++; }, undo() { source.splice(0, source.length, ...before); revision++; }, redo() { source.splice(0, source.length, ...after); revision++; } });
    }, close() { selection.dispose(); history.dispose(); },
  };
}
