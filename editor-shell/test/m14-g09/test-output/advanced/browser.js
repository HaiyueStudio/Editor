function createEditorServiceToken(id) {
    const normalized = requireIdentifier(id, 'service token');
    return Object.freeze({ id: normalized, key: Symbol.for(`@haiyue/editor-service/${normalized}`) });
}
Object.freeze({
    document: createEditorServiceToken('document'),
    history: createEditorServiceToken('history'),
    selection: createEditorServiceToken('selection'),
    tasks: createEditorServiceToken('tasks'),
    projectSession: createEditorServiceToken('project-session'),
    diagnostics: createEditorServiceToken('diagnostics'),
});
function requireIdentifier(value, kind) {
    const normalized = value.trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
        throw new TypeError(`Invalid ${kind} identifier "${value}".`);
    }
    return normalized;
}

class EditorHistoryService {
    undoEntries = [];
    redoEntries = [];
    groups = [];
    listeners = new Set();
    byteBudget;
    maxEntries;
    nextId = 1;
    revision = 0;
    busy = false;
    disposed = false;
    constructor(options = {}) {
        this.byteBudget = Math.max(1, options.byteBudget ?? 32 * 1024 * 1024);
        this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 200));
        if (options.changed)
            this.listeners.add(options.changed);
    }
    get canUndo() { return !this.busy && this.groups.length === 0 && this.undoEntries.length > 0; }
    get canRedo() { return !this.busy && this.groups.length === 0 && this.redoEntries.length > 0; }
    get activeGroupDepth() { return this.groups.length; }
    execute(command) {
        this.assertReadyForMutation();
        const entry = this.createEntry(command);
        this.assertFitsActiveGroup(entry.estimatedBytes);
        const applied = this.withBusy(() => command.execute() !== false);
        if (!applied)
            return false;
        this.recordEntry(entry);
        return true;
    }
    recordApplied(command) {
        this.assertReadyForMutation();
        const entry = this.createEntry(command);
        this.assertFitsActiveGroup(entry.estimatedBytes);
        this.recordEntry(entry);
    }
    beginGroup(label) {
        this.assertReadyForMutation();
        if (!label.trim())
            throw new TypeError('History group label is required.');
        this.groups.push({ label, entries: [], estimatedBytes: 0 });
        this.emit();
    }
    endGroup() {
        this.assertActive();
        const group = this.groups.pop();
        if (!group)
            throw new Error('No history group is active.');
        if (group.entries.length === 0) {
            this.emit();
            return;
        }
        const entry = this.createCompositeEntry(group);
        const parent = this.groups.at(-1);
        if (parent) {
            parent.entries.push(entry);
            parent.estimatedBytes += entry.estimatedBytes;
        }
        else {
            this.pushUndo(entry);
        }
        this.emit();
    }
    cancelGroup() {
        this.assertActive();
        const group = this.groups.pop();
        if (!group)
            throw new Error('No history group is active.');
        this.withBusy(() => {
            for (const entry of group.entries.slice().reverse())
                entry.command.undo();
        });
        for (const entry of group.entries)
            entry.command.dispose?.();
        this.emit();
    }
    runGroup(label, operation) {
        this.beginGroup(label);
        try {
            const result = operation();
            this.endGroup();
            return result;
        }
        catch (error) {
            this.cancelGroup();
            throw error;
        }
    }
    undo() {
        this.assertReadyForMutation();
        const entry = this.undoEntries.pop();
        if (!entry)
            return false;
        try {
            this.withBusy(() => entry.command.undo());
            this.redoEntries.push(entry);
            this.emit();
            return true;
        }
        catch (error) {
            this.undoEntries.push(entry);
            this.emit();
            throw error;
        }
    }
    redo() {
        this.assertReadyForMutation();
        const entry = this.redoEntries.pop();
        if (!entry)
            return false;
        try {
            const applied = this.withBusy(() => (entry.command.redo?.() ?? entry.command.execute()) !== false);
            if (!applied)
                throw new Error(`History command ${entry.label} rejected redo.`);
            this.undoEntries.push(entry);
            this.enforceBudget();
            this.emit();
            return true;
        }
        catch (error) {
            this.redoEntries.push(entry);
            this.emit();
            throw error;
        }
    }
    clear() {
        this.assertActive();
        if (this.groups.length > 0)
            throw new Error('Cannot clear history while a group is active.');
        this.disposeEntries(this.undoEntries.splice(0));
        this.disposeEntries(this.redoEntries.splice(0));
        this.emit();
    }
    snapshot() {
        const undo = this.undoEntries.at(-1);
        const redo = this.redoEntries.at(-1);
        const entries = Object.freeze(this.undoEntries.map(entry => Object.freeze({
            id: entry.id,
            label: entry.label,
            estimatedBytes: entry.estimatedBytes,
        })));
        return Object.freeze({
            revision: this.revision,
            canUndo: this.canUndo,
            canRedo: this.canRedo,
            ...(undo ? { undoLabel: undo.label } : {}),
            ...(redo ? { redoLabel: redo.label } : {}),
            busy: this.busy,
            estimatedBytes: this.totalBytes(),
            entries,
        });
    }
    subscribe(listener, emitInitial = false) {
        this.assertActive();
        this.listeners.add(listener);
        if (emitInitial)
            listener(this.snapshot());
        return disposable$1(() => this.listeners.delete(listener));
    }
    dispose() {
        if (this.disposed)
            return;
        while (this.groups.length > 0)
            this.cancelGroup();
        this.disposeEntries(this.undoEntries.splice(0));
        this.disposeEntries(this.redoEntries.splice(0));
        this.listeners.clear();
        this.disposed = true;
    }
    createEntry(command) {
        if (!command.label.trim())
            throw new TypeError('History command label is required.');
        const estimatedBytes = Math.max(0, Math.floor(command.estimatedBytes ?? 0));
        if (estimatedBytes > this.byteBudget) {
            throw new RangeError(`History command ${command.label} exceeds the ${this.byteBudget} byte budget.`);
        }
        return { id: this.nextId++, command, label: command.label, estimatedBytes };
    }
    createCompositeEntry(group) {
        const entries = Object.freeze([...group.entries]);
        const command = {
            label: group.label,
            estimatedBytes: group.estimatedBytes,
            execute() {
                for (const entry of entries) {
                    if ((entry.command.redo?.() ?? entry.command.execute()) === false) {
                        throw new Error(`Grouped history command ${entry.label} rejected execution.`);
                    }
                }
            },
            undo() { for (const entry of entries.slice().reverse())
                entry.command.undo(); },
            dispose() { for (const entry of entries)
                entry.command.dispose?.(); },
        };
        return { id: this.nextId++, command, label: group.label, estimatedBytes: group.estimatedBytes };
    }
    assertFitsActiveGroup(bytes) {
        const group = this.groups.at(-1);
        if (group && group.estimatedBytes + bytes > this.byteBudget) {
            throw new RangeError(`History group ${group.label} exceeds the ${this.byteBudget} byte budget.`);
        }
    }
    recordEntry(entry) {
        const group = this.groups.at(-1);
        if (group) {
            group.entries.push(entry);
            group.estimatedBytes += entry.estimatedBytes;
            this.emit();
            return;
        }
        this.pushUndo(entry);
        this.emit();
    }
    pushUndo(entry) {
        this.disposeEntries(this.redoEntries.splice(0));
        const previous = this.undoEntries.at(-1);
        const merged = previous?.command.mergeWith?.(entry.command) ?? null;
        if (previous && merged) {
            const mergedEntry = this.createEntry(merged);
            this.undoEntries[this.undoEntries.length - 1] = mergedEntry;
            this.enforceBudget();
            return;
        }
        this.undoEntries.push(entry);
        this.enforceBudget();
    }
    enforceBudget() {
        while ((this.totalBytes() > this.byteBudget || this.undoEntries.length > this.maxEntries) && this.undoEntries.length > 1) {
            const removed = this.undoEntries.shift();
            removed?.command.dispose?.();
        }
    }
    totalBytes() {
        return [...this.undoEntries, ...this.redoEntries].reduce((sum, entry) => sum + entry.estimatedBytes, 0);
    }
    disposeEntries(entries) {
        for (const entry of entries)
            entry.command.dispose?.();
    }
    withBusy(operation) {
        if (this.busy)
            throw new Error('History is already executing a command.');
        this.busy = true;
        this.emit();
        try {
            return operation();
        }
        finally {
            this.busy = false;
            this.emit();
        }
    }
    emit() {
        this.revision++;
        const snapshot = this.snapshot();
        for (const listener of [...this.listeners])
            listener(snapshot);
    }
    assertReadyForMutation() {
        this.assertActive();
        if (this.busy)
            throw new Error('History is busy.');
        if (this.groups.length > 0 && (this.canUndo || this.canRedo))
            throw new Error('Invalid history group state.');
    }
    assertActive() {
        if (this.disposed)
            throw new Error('History is disposed.');
    }
}
function disposable$1(dispose) {
    let active = true;
    return Object.freeze({ dispose() { if (active) {
            active = false;
            dispose();
        } } });
}

class EditorSelectionService {
    resolvers = new Map();
    listeners = new Set();
    items = Object.freeze([]);
    active = null;
    revision = 0;
    disposed = false;
    set(items, active = items[0] ?? null) {
        this.assertActive();
        const normalized = dedupe(items.map(freezeReference));
        const normalizedActive = active ? freezeReference(active) : null;
        if (normalizedActive && !normalized.some(item => referenceKey(item) === referenceKey(normalizedActive))) {
            throw new Error('Active selection must be present in the selection set.');
        }
        this.items = Object.freeze(normalized);
        this.active = normalizedActive;
        this.emit();
    }
    clear() { this.set([], null); }
    registerResolver(kind, ownerId, resolver) {
        this.assertActive();
        if (this.resolvers.has(kind))
            throw new Error(`Selection resolver ${kind} is already registered.`);
        this.resolvers.set(kind, { ownerId, resolve: resolver });
        return disposable(() => {
            const current = this.resolvers.get(kind);
            if (current?.ownerId === ownerId)
                this.resolvers.delete(kind);
        });
    }
    resolve(reference) {
        return this.resolvers.get(reference.kind)?.resolve(reference);
    }
    snapshot() {
        return Object.freeze({ revision: this.revision, active: this.active, items: this.items });
    }
    subscribe(listener, emitInitial = false) {
        this.assertActive();
        this.listeners.add(listener);
        if (emitInitial)
            listener(this.snapshot());
        return disposable(() => this.listeners.delete(listener));
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.resolvers.clear();
        this.listeners.clear();
        this.items = Object.freeze([]);
        this.active = null;
    }
    emit() {
        this.revision++;
        const snapshot = this.snapshot();
        for (const listener of [...this.listeners])
            listener(snapshot);
    }
    assertActive() { if (this.disposed)
        throw new Error('Selection service is disposed.'); }
}
function freezeReference(reference) {
    if (!reference.kind.trim() || !reference.id.trim())
        throw new TypeError('Selection kind and id are required.');
    return Object.freeze({ kind: reference.kind, id: reference.id, ...(reference.documentId ? { documentId: reference.documentId } : {}) });
}
function dedupe(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = referenceKey(item);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function referenceKey(reference) {
    return `${reference.documentId ?? ''}\u0000${reference.kind}\u0000${reference.id}`;
}
function disposable(dispose) {
    let active = true;
    return Object.freeze({ dispose() { if (active) {
            active = false;
            dispose();
        } } });
}

class AdvancedAuthoringError extends Error {
    code;
    constructor(code) {
        super(`advanced-authoring.${code}`);
        this.code = code;
        this.name = 'AdvancedAuthoringError';
    }
}
function fail(code) { throw new AdvancedAuthoringError(code); }
function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const item of Object.values(value))
            freeze(item);
        Object.freeze(value);
    }
    return value;
}
function object(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function text(value, max = 256) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function integer(value) { return finite(value) && Number.isSafeInteger(value) && value >= 0; }
/** Clone JSON without invoking accessors; reject live objects and enforce budgets. */
function json(value, maxBytes = 4 * 1024 * 1024) {
    let nodes = 300_000;
    const visit = (value, depth) => {
        if (--nodes < 0 || depth > 64)
            fail('budget');
        if (value === null || typeof value === 'boolean' || typeof value === 'string' || finite(value))
            return value;
        if (!object(value) && !Array.isArray(value))
            return fail('json');
        if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
            fail('json');
        const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
        if (Object.getOwnPropertySymbols(value).length)
            fail('json');
        if (entries.some(([key, descriptor]) => !('value' in descriptor) || ['__proto__', 'prototype', 'constructor'].includes(key)))
            fail('json');
        if (Array.isArray(value)) {
            if (value.length > 50_000 || Object.keys(value).length !== value.length)
                fail('budget');
            return value.map(item => visit(item, depth + 1));
        }
        return Object.fromEntries(entries.map(([key, descriptor]) => [key, visit(descriptor.value, depth + 1)]));
    };
    const result = visit(value, 0);
    if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes)
        fail('budget');
    return freeze(result);
}
function keys(value, required, optional = []) {
    if (!object(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)))
        fail('shape');
    return value;
}
function array(value, limit) { if (!Array.isArray(value) || value.length > limit)
    fail('array'); return value; }
function labels(value) { if (array(value, 100).some(value => !text(value, 2048)))
    fail('label'); }
function reference(value, documentId) {
    const row = keys(value, ['id', 'kind'], ['documentId']);
    if (!text(row.id) || !text(row.kind, 128) || row.documentId !== documentId)
        fail('reference');
}
function vector(value, size) { if (!Array.isArray(value) || value.length !== size || value.some(value => !finite(value)))
    fail('vector'); }
function transform$1(value) {
    const row = keys(value, ['position', 'rotationDegrees', 'scale']);
    for (const key of ['position', 'rotationDegrees', 'scale'])
        vector(row[key], 3);
    if (row.scale.some(value => value < 0.000001 || value > 1_000_000))
        fail('scale');
    return value;
}
function field(input, forceReadOnly = false) {
    const row = keys(input, ['id', 'label', 'kind', 'value', 'readOnly'], ['minimum', 'maximum', 'options']);
    if (!text(row.id) || !text(row.label) || !['number', 'boolean', 'string', 'enum', 'json'].includes(String(row.kind)) || typeof row.readOnly !== 'boolean' || forceReadOnly && !row.readOnly)
        fail('field');
    if (row.minimum !== undefined && !finite(row.minimum) || row.maximum !== undefined && !finite(row.maximum) || finite(row.minimum) && finite(row.maximum) && row.minimum > row.maximum)
        fail('field');
    if (row.kind === 'number' && !finite(row.value) || row.kind === 'boolean' && typeof row.value !== 'boolean' || row.kind === 'string' && typeof row.value !== 'string')
        fail('field');
    if (row.kind === 'enum') {
        if (!array(row.options, 256).length || row.options.some(option => { const value = keys(option, ['label', 'value']); return !text(value.label); }))
            fail('field');
    }
    else if (row.options !== undefined)
        fail('field');
}
function unique(items, id) { if (new Set(items.map(id)).size !== items.length)
    fail('duplicate'); }
function parseAdvancedAuthoringView(input) {
    const view = keys(json(input), ['schemaVersion', 'binding', 'hierarchy', 'selection', 'history', 'sections', 'additions', 'gizmo', 'runtime', 'diagnostics', 'capabilities']);
    if (view.schemaVersion !== 1)
        fail('version');
    let documentId = null;
    if (view.binding !== null) {
        const binding = keys(view.binding, ['documentId', 'revision', 'epoch']);
        if (!text(binding.documentId) || !text(binding.epoch) || !integer(binding.revision))
            fail('binding');
        documentId = binding.documentId;
    }
    const hierarchy = array(view.hierarchy, 10_000).map(value => {
        const row = keys(value, ['reference', 'parentId', 'order', 'label', 'editable']);
        reference(row.reference, documentId);
        if (!(row.parentId === null || text(row.parentId)) || !integer(row.order) || !text(row.label) || typeof row.editable !== 'boolean')
            fail('hierarchy');
        return row;
    });
    unique(hierarchy, row => String(row.reference.id));
    const parents = new Map(hierarchy.map(row => [row.reference.id, row.parentId]));
    const visited = new Set();
    for (const row of hierarchy) {
        let id = row.reference.id;
        const seen = new Set();
        while (id !== null && !visited.has(id)) {
            if (seen.has(id) || !parents.has(id))
                fail('hierarchy-cycle');
            seen.add(id);
            id = parents.get(id);
        }
        for (const id of seen)
            visited.add(id);
    }
    const selection = keys(view.selection, ['revision', 'active', 'items']);
    if (!integer(selection.revision))
        fail('selection');
    const references = new Map(hierarchy.map(row => [row.reference.id, row.reference]));
    const items = array(selection.items, 10_000);
    for (const item of items) {
        reference(item, documentId);
        if (!sameReference(item, references.get(item.id)))
            fail('selection');
    }
    unique(items, item => item.id);
    if (selection.active !== null) {
        reference(selection.active, documentId);
        if (!items.some(item => sameReference(item, selection.active)))
            fail('selection');
    }
    const history = keys(view.history, ['revision', 'canUndo', 'canRedo', 'busy', 'estimatedBytes', 'entries'], ['undoLabel', 'redoLabel']);
    if (!integer(history.revision) || !integer(history.estimatedBytes) || ['canUndo', 'canRedo', 'busy'].some(key => typeof history[key] !== 'boolean'))
        fail('history');
    for (const value of array(history.entries, 1000)) {
        const entry = keys(value, ['id', 'label', 'estimatedBytes']);
        if (!integer(entry.id) || !text(entry.label) || !integer(entry.estimatedBytes))
            fail('history');
    }
    for (const key of ['undoLabel', 'redoLabel'])
        if (history[key] !== undefined && !text(history[key]))
            fail('history');
    const sections = array(view.sections, 1000).map(value => {
        const row = keys(value, ['id', 'title', 'description', 'enabled', 'editable', 'removable', 'fields']);
        if (!text(row.id) || !text(row.title) || typeof row.description !== 'string' || row.description.length > 2048 || ['enabled', 'editable', 'removable'].some(key => typeof row[key] !== 'boolean'))
            fail('section');
        const fields = array(row.fields, 1000);
        for (const value of fields)
            field(value);
        unique(fields, value => value.id);
        return row;
    });
    unique(sections, row => String(row.id));
    const additions = array(view.additions, 1000).map(value => { const row = keys(value, ['id', 'label', 'description', 'enabled']); if (!text(row.id) || !text(row.label) || typeof row.description !== 'string' || row.description.length > 2048 || typeof row.enabled !== 'boolean')
        fail('addition'); return row; });
    unique(additions, row => String(row.id));
    const gizmo = keys(view.gizmo, ['enabled', 'transforms', 'projection']);
    if (typeof gizmo.enabled !== 'boolean')
        fail('gizmo');
    const transforms = array(gizmo.transforms, 10_000).map(value => { const row = keys(value, ['id', 'parentId', 'value']); if (!text(row.id) || !parents.has(row.id) || row.parentId !== parents.get(row.id))
        fail('transform'); transform$1(row.value); return row; });
    unique(transforms, row => String(row.id));
    if (gizmo.projection !== null) {
        const projection = keys(gizmo.projection, ['origin', 'axes', 'unitsPerPixel']);
        vector(projection.origin, 2);
        const axes = keys(projection.axes, ['x', 'y', 'z']);
        for (const axis of Object.values(axes))
            vector(axis, 2);
        if (!finite(projection.unitsPerPixel) || projection.unitsPerPixel <= 0 || projection.unitsPerPixel > 100_000)
            fail('projection');
    }
    const runtime = keys(view.runtime, ['status', 'instanceId', 'documentRevision', 'frame', 'tick', 'diagnostics', 'fields']);
    if (!['unavailable', 'stopped', 'current', 'historical'].includes(String(runtime.status)) || !(runtime.instanceId === null || text(runtime.instanceId)))
        fail('runtime');
    for (const key of ['documentRevision', 'frame', 'tick'])
        if (!(runtime[key] === null || integer(runtime[key])))
            fail('runtime');
    if (runtime.status === 'current' && (!runtime.instanceId || runtime.documentRevision !== view.binding?.revision || runtime.frame === null || runtime.tick === null))
        fail('runtime-stale');
    for (const value of array(runtime.fields, 1000))
        field(value, true);
    labels(runtime.diagnostics);
    labels(view.diagnostics);
    const capabilities = keys(view.capabilities, ['multiSelection', 'rename', 'reparent', 'addSection']);
    if (Object.values(capabilities).some(value => typeof value !== 'boolean'))
        fail('capability');
    if (!capabilities.multiSelection && items.length > 1 || !documentId && (hierarchy.length || sections.length || additions.length || transforms.length))
        fail('document-unavailable');
    return freeze(view);
}
function sameReference(left, right) { return object(left) && object(right) && left.id === right.id && left.kind === right.kind && left.documentId === right.documentId; }
function parseFieldInput(field, input) {
    if (field.readOnly)
        fail('field-readonly');
    let value;
    if (field.kind === 'number') {
        if (typeof input !== 'string' || !input.trim())
            fail('field-number');
        value = Number(input);
        if (!finite(value) || field.minimum !== undefined && value < field.minimum || field.maximum !== undefined && value > field.maximum)
            fail('field-number');
    }
    else if (field.kind === 'boolean') {
        if (typeof input !== 'boolean')
            fail('field-boolean');
        value = input;
    }
    else if (field.kind === 'enum') {
        const index = Number(input);
        if (typeof input !== 'string' || !/^\d+$/u.test(input) || !integer(index) || !field.options?.[index])
            fail('field-enum');
        value = field.options[index].value;
    }
    else if (field.kind === 'json') {
        if (typeof input !== 'string')
            fail('field-json');
        try {
            value = json(JSON.parse(input), 64 * 1024);
        }
        catch {
            return fail('field-json');
        }
    }
    else {
        if (typeof input !== 'string' || input.length > 16_384)
            fail('field-string');
        value = input;
    }
    return freeze(value);
}

const transform = (position = [0, 0, 0], rotationDegrees = [0, 0, 0], scale = [1, 1, 1]) => ({ position, rotationDegrees, scale });
function fixture(count = 3) {
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

/** Real dynamic import: browser presentation stays outside the initial module closure. */
async function mountAdvancedAuthoring(options, signal) {
    if (signal?.aborted)
        throw new AdvancedAuthoringError('mount-cancelled');
    const { AdvancedAuthoringPanel } = await import('./panel-DaFakE2F.js');
    if (signal?.aborted)
        throw new AdvancedAuthoringError('mount-cancelled');
    const panel = new AdvancedAuthoringPanel(options);
    if (signal?.aborted) {
        panel.dispose();
        throw new AdvancedAuthoringError('mount-cancelled');
    }
    const dispose = () => { signal?.removeEventListener('abort', dispose); panel.dispose(); };
    signal?.addEventListener('abort', dispose, { once: true });
    return Object.freeze({ update: panel.update.bind(panel), reveal: panel.reveal.bind(panel), cancel: panel.cancel.bind(panel), dispose });
}

const host = document.querySelector('#panel'), viewportHost = document.querySelector('#viewport');
let f, panel, previews = [], intents = [], held = null, failure = false;
const pause = () => new Promise(resolve => requestAnimationFrame(resolve));
const update = () => panel.update(f.view());
async function reset(count = 1000) {
  panel?.dispose(); f?.close(); f = fixture(count); previews = []; intents = []; failure = false;
  panel = await mountAdvancedAuthoring({ host, viewportHost, initial: f.view(), preview(value) { previews.push(value); }, async dispatch(intent, signal) {
    intents.push(intent); if (held) await held.promise; if (signal.aborted) return;
    if (failure) throw Error('injected');
    if (intent.type === 'selection') f.selection.set(intent.references, intent.active);
    if (intent.type === 'transform') f.commit(intent);
    if (intent.type === 'undo') f.history.undo();
    if (intent.type === 'redo') f.history.redo();
    update();
  } });
}
window.advancedTest = {
  reset, update, pause,
  state: () => ({ view:f.view(), previews, intents, roots:host.children.length, overlays:viewportHost.children.length, busy:host.firstElementChild?.getAttribute('aria-busy'), position:viewportHost.style.position }),
  reveal: id => panel.reveal(f.reference(id)),
  changeEpoch: () => { f.setEpoch('open:2'); update(); },
  select: id => { f.selection.set([f.reference(id)]); update(); },
  hold: () => { let resolve; const promise = new Promise(r => resolve = r); held = {promise,resolve}; },
  release: () => { held?.resolve(); held = null; },
  fail: () => failure = true,
  dispose: () => panel.dispose(),
  dense: () => { const view = f.view(); panel.update({ ...view, sections:[{...view.sections[0],fields:Array.from({length:1000},(_,i)=>({...view.sections[0].fields[0],id:`field:${i}`}))}] }); },
  historical: () => { f.setRuntime({ status:'historical',instanceId:'play:previous',documentRevision:0,frame:2,tick:2,diagnostics:[],fields:[{id:'runtime:value',label:'Runtime value',kind:'json',value:{speed:3},readOnly:true}] }); update(); },
  lazyAbort: async () => { const abort = new AbortController(); abort.abort(); let rejected = false; try { await mountAdvancedAuthoring({host,viewportHost,initial:f.view(),dispatch(){},preview(){}},abort.signal); } catch { rejected = true; } return rejected; },
  faultCleanup: async () => { panel.dispose(); const mounted = await mountAdvancedAuthoring({host,viewportHost,initial:f.view(),dispatch(){},preview(){throw Error('host failure');}}); mounted.dispose(); mounted.dispose(); return host.children.length === 0 && viewportHost.children.length === 0; },
};
void reset().then(()=>{window.advancedReady = true;}).catch(error=>console.error(error));

export { finite as a, freeze as b, parseFieldInput as c, fail as f, parseAdvancedAuthoringView as p, transform$1 as t };
