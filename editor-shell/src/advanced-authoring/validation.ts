import type { AdvancedAuthoringView, AuthoringField, AuthoringTransform, AuthoringValue } from './types.js';

export class AdvancedAuthoringError extends Error {
  constructor(readonly code: string) { super(`advanced-authoring.${code}`); this.name = 'AdvancedAuthoringError'; }
}
export function fail(code: string): never { throw new AdvancedAuthoringError(code); }
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
export function text(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
export function integer(value: unknown): value is number { return finite(value) && Number.isSafeInteger(value) && value >= 0; }
/** Clone JSON without invoking accessors; reject live objects and enforce budgets. */
export function json(value: unknown, maxBytes = 4 * 1024 * 1024): AuthoringValue {
  let nodes = 300_000;
  const visit = (value: unknown, depth: number): AuthoringValue => {
    if (--nodes < 0 || depth > 64) fail('budget');
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || finite(value)) return value;
    if (!object(value) && !Array.isArray(value)) return fail('json');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('json');
    const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
    if (Object.getOwnPropertySymbols(value).length) fail('json');
    if (entries.some(([key, descriptor]) => !('value' in descriptor) || ['__proto__', 'prototype', 'constructor'].includes(key))) fail('json');
    if (Array.isArray(value)) {
      if (value.length > 50_000 || Object.keys(value).length !== value.length) fail('budget');
      return value.map(item => visit(item, depth + 1));
    }
    return Object.fromEntries(entries.map(([key, descriptor]) => [key, visit(descriptor.value, depth + 1)]));
  };
  const result = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes) fail('budget');
  return freeze(result);
}
export function keys(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('shape');
  return value;
}
function array(value: unknown, limit: number): readonly unknown[] { if (!Array.isArray(value) || value.length > limit) fail('array'); return value; }
function labels(value: unknown): void { if (array(value, 100).some(value => !text(value, 2048))) fail('label'); }
function reference(value: unknown, documentId: string | null): void {
  const row = keys(value, ['id', 'kind'], ['documentId']);
  if (!text(row.id) || !text(row.kind, 128) || row.documentId !== documentId) fail('reference');
}
function vector(value: unknown, size: number): void { if (!Array.isArray(value) || value.length !== size || value.some(value => !finite(value))) fail('vector'); }
export function transform(value: unknown): AuthoringTransform {
  const row = keys(value, ['position', 'rotationDegrees', 'scale']);
  for (const key of ['position', 'rotationDegrees', 'scale']) vector(row[key], 3);
  if ((row.scale as number[]).some(value => value < 0.000001 || value > 1_000_000)) fail('scale');
  return value as AuthoringTransform;
}
function field(input: unknown, forceReadOnly = false): void {
  const row = keys(input, ['id', 'label', 'kind', 'value', 'readOnly'], ['minimum', 'maximum', 'options']);
  if (!text(row.id) || !text(row.label) || !['number', 'boolean', 'string', 'enum', 'json'].includes(String(row.kind)) || typeof row.readOnly !== 'boolean' || forceReadOnly && !row.readOnly) fail('field');
  if (row.minimum !== undefined && !finite(row.minimum) || row.maximum !== undefined && !finite(row.maximum) || finite(row.minimum) && finite(row.maximum) && row.minimum > row.maximum) fail('field');
  if (row.kind === 'number' && !finite(row.value) || row.kind === 'boolean' && typeof row.value !== 'boolean' || row.kind === 'string' && typeof row.value !== 'string') fail('field');
  if (row.kind === 'enum') {
    if (!array(row.options, 256).length || (row.options as unknown[]).some(option => { const value = keys(option, ['label', 'value']); return !text(value.label); })) fail('field');
  } else if (row.options !== undefined) fail('field');
}
function unique<T>(items: readonly T[], id: (value: T) => string): void { if (new Set(items.map(id)).size !== items.length) fail('duplicate'); }

export function parseAdvancedAuthoringView(input: unknown): AdvancedAuthoringView {
  const view = keys(json(input), ['schemaVersion', 'binding', 'hierarchy', 'selection', 'history', 'sections', 'additions', 'gizmo', 'runtime', 'diagnostics', 'capabilities']);
  if (view.schemaVersion !== 1) fail('version');
  let documentId: string | null = null;
  if (view.binding !== null) { const binding = keys(view.binding, ['documentId', 'revision', 'epoch']); if (!text(binding.documentId) || !text(binding.epoch) || !integer(binding.revision)) fail('binding'); documentId = binding.documentId; }
  const hierarchy = array(view.hierarchy, 10_000).map(value => {
    const row = keys(value, ['reference', 'parentId', 'order', 'label', 'editable']); reference(row.reference, documentId);
    if (!(row.parentId === null || text(row.parentId)) || !integer(row.order) || !text(row.label) || typeof row.editable !== 'boolean') fail('hierarchy'); return row;
  });
  unique(hierarchy, row => String((row.reference as { id: string }).id));
  const parents = new Map(hierarchy.map(row => [(row.reference as { id: string }).id, row.parentId as string | null]));
  const visited = new Set<string>();
  for (const row of hierarchy) {
    let id: string | null = (row.reference as { id: string }).id; const seen = new Set<string>();
    while (id !== null && !visited.has(id)) { if (seen.has(id) || !parents.has(id)) fail('hierarchy-cycle'); seen.add(id); id = parents.get(id)!; }
    for (const id of seen) visited.add(id);
  }
  const selection = keys(view.selection, ['revision', 'active', 'items']); if (!integer(selection.revision)) fail('selection');
  const references = new Map(hierarchy.map(row => [(row.reference as { id: string }).id,row.reference]));
  const items = array(selection.items, 10_000); for (const item of items) { reference(item, documentId); if (!sameReference(item,references.get((item as { id: string }).id))) fail('selection'); }
  unique(items, item => (item as { id: string }).id);
  if (selection.active !== null) { reference(selection.active, documentId); if (!items.some(item => sameReference(item, selection.active))) fail('selection'); }
  const history = keys(view.history, ['revision', 'canUndo', 'canRedo', 'busy', 'estimatedBytes', 'entries'], ['undoLabel', 'redoLabel']);
  if (!integer(history.revision) || !integer(history.estimatedBytes) || ['canUndo', 'canRedo', 'busy'].some(key => typeof history[key] !== 'boolean')) fail('history');
  for (const value of array(history.entries, 1000)) { const entry = keys(value, ['id', 'label', 'estimatedBytes']); if (!integer(entry.id) || !text(entry.label) || !integer(entry.estimatedBytes)) fail('history'); }
  for (const key of ['undoLabel', 'redoLabel']) if (history[key] !== undefined && !text(history[key])) fail('history');
  const sections = array(view.sections, 1000).map(value => {
    const row = keys(value, ['id', 'title', 'description', 'enabled', 'editable', 'removable', 'fields']);
    if (!text(row.id) || !text(row.title) || typeof row.description !== 'string' || row.description.length > 2048 || ['enabled', 'editable', 'removable'].some(key => typeof row[key] !== 'boolean')) fail('section');
    const fields = array(row.fields, 1000); for (const value of fields) field(value); unique(fields, value => (value as { id: string }).id); return row;
  }); unique(sections, row => String(row.id));
  const additions = array(view.additions, 1000).map(value => { const row = keys(value, ['id', 'label', 'description', 'enabled']); if (!text(row.id) || !text(row.label) || typeof row.description !== 'string' || row.description.length > 2048 || typeof row.enabled !== 'boolean') fail('addition'); return row; }); unique(additions, row => String(row.id));
  const gizmo = keys(view.gizmo, ['enabled', 'transforms', 'projection']); if (typeof gizmo.enabled !== 'boolean') fail('gizmo');
  const transforms = array(gizmo.transforms, 10_000).map(value => { const row = keys(value, ['id', 'parentId', 'value']); if (!text(row.id) || !parents.has(row.id) || row.parentId !== parents.get(row.id)) fail('transform'); transform(row.value); return row; }); unique(transforms, row => String(row.id));
  if (gizmo.projection !== null) {
    const projection = keys(gizmo.projection, ['origin', 'axes', 'unitsPerPixel']); vector(projection.origin, 2); const axes = keys(projection.axes, ['x', 'y', 'z']); for (const axis of Object.values(axes)) vector(axis, 2);
    if (!finite(projection.unitsPerPixel) || projection.unitsPerPixel <= 0 || projection.unitsPerPixel > 100_000) fail('projection');
  }
  const runtime = keys(view.runtime, ['status', 'instanceId', 'documentRevision', 'frame', 'tick', 'diagnostics', 'fields']);
  if (!['unavailable', 'stopped', 'current', 'historical'].includes(String(runtime.status)) || !(runtime.instanceId === null || text(runtime.instanceId))) fail('runtime');
  for (const key of ['documentRevision', 'frame', 'tick']) if (!(runtime[key] === null || integer(runtime[key]))) fail('runtime');
  if (runtime.status === 'current' && (!runtime.instanceId || runtime.documentRevision !== (view.binding as { revision?: number } | null)?.revision || runtime.frame === null || runtime.tick === null)) fail('runtime-stale');
  for (const value of array(runtime.fields, 1000)) field(value, true); labels(runtime.diagnostics); labels(view.diagnostics);
  const capabilities = keys(view.capabilities, ['multiSelection', 'rename', 'reparent', 'addSection']); if (Object.values(capabilities).some(value => typeof value !== 'boolean')) fail('capability');
  if (!capabilities.multiSelection && items.length > 1 || !documentId && (hierarchy.length || sections.length || additions.length || transforms.length)) fail('document-unavailable');
  return freeze(view as unknown as AdvancedAuthoringView);
}
function sameReference(left: unknown, right: unknown): boolean { return object(left) && object(right) && left.id === right.id && left.kind === right.kind && left.documentId === right.documentId; }

export function parseFieldInput(field: AuthoringField, input: string | boolean): AuthoringValue {
  if (field.readOnly) fail('field-readonly');
  let value: AuthoringValue;
  if (field.kind === 'number') { if (typeof input !== 'string' || !input.trim()) fail('field-number'); value = Number(input); if (!finite(value) || field.minimum !== undefined && value < field.minimum || field.maximum !== undefined && value > field.maximum) fail('field-number'); }
  else if (field.kind === 'boolean') { if (typeof input !== 'boolean') fail('field-boolean'); value = input; }
  else if (field.kind === 'enum') { const index = Number(input); if (typeof input !== 'string' || !/^\d+$/u.test(input) || !integer(index) || !field.options?.[index]) fail('field-enum'); value = field.options[index]!.value; }
  else if (field.kind === 'json') { if (typeof input !== 'string') fail('field-json'); try { value = json(JSON.parse(input), 64 * 1024); } catch { return fail('field-json'); } }
  else { if (typeof input !== 'string' || input.length > 16_384) fail('field-string'); value = input; }
  return freeze(value);
}
