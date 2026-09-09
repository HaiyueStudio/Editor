import { f as fail, a as finite, b as freeze, t as transform, p as parseAdvancedAuthoringView, c as parseFieldInput } from './browser.js';

/** Complete hierarchy ordering with bounded DOM pages; matches keep their ancestors. */
function projectAuthoringHierarchy(items, options = {}) {
    const search = options.search?.trim().toLocaleLowerCase() ?? '', collapsed = options.collapsed ?? new Set();
    const index = new Map(items.map(item => [item.reference.id, item])), children = new Map();
    for (const item of items) {
        const rows = children.get(item.parentId) ?? [];
        rows.push(item);
        children.set(item.parentId, rows);
    }
    for (const rows of children.values())
        rows.sort((a, b) => a.order - b.order || a.reference.id.localeCompare(b.reference.id));
    const matches = new Set();
    if (search)
        for (const item of items)
            if (`${item.label} ${item.reference.id}`.toLocaleLowerCase().includes(search)) {
                let cursor = item;
                while (cursor && !matches.has(cursor.reference.id)) {
                    matches.add(cursor.reference.id);
                    cursor = cursor.parentId ? index.get(cursor.parentId) : undefined;
                }
            }
    const rows = [], stack = (children.get(null) ?? []).map(item => ({ item, depth: 0 })).reverse();
    while (stack.length) {
        const { item, depth } = stack.pop();
        if (search && !matches.has(item.reference.id))
            continue;
        const descendants = children.get(item.reference.id) ?? [], expanded = Boolean(search) || !collapsed.has(item.reference.id);
        rows.push({ item, depth, hasChildren: descendants.length > 0, expanded });
        if (expanded)
            for (let i = descendants.length - 1; i >= 0; i--)
                stack.push({ item: descendants[i], depth: depth + 1 });
    }
    const offset = Math.max(0, Math.min(rows.length, Math.floor(options.offset ?? 0))), limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
    return Object.freeze({ rows: Object.freeze(rows.slice(offset, offset + limit).map(row => Object.freeze(row))), total: rows.length, offset, next: offset + limit < rows.length });
}
function canReparent(items, id, parentId) {
    const index = new Map(items.map(item => [item.reference.id, item]));
    if (!index.get(id)?.editable || parentId !== null && !index.has(parentId))
        return false;
    const seen = new Set([id]);
    let cursor = parentId;
    while (cursor !== null) {
        if (seen.has(cursor))
            return false;
        seen.add(cursor);
        cursor = index.get(cursor)?.parentId ?? null;
    }
    return true;
}

const radians = Math.PI / 180;
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const clone = (value) => ({ position: [...value.position], rotationDegrees: [...value.rotationDegrees], scale: [...value.scale] });
function multiplyTransformMatrices(a, b) {
    const result = Array(16).fill(0);
    for (let column = 0; column < 4; column++)
        for (let row = 0; row < 4; row++)
            for (let k = 0; k < 4; k++)
                result[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    return result;
}
/** Euler order follows the existing authoring convention: Y * X * Z, degrees. */
function authoringTransformMatrix(value) {
    const [x, y, z] = value.rotationDegrees.map(value => value * radians), [sx, cx, sy, cy, sz, cz] = [Math.sin(x), Math.cos(x), Math.sin(y), Math.cos(y), Math.sin(z), Math.cos(z)];
    const [a, b, c] = value.scale;
    return [(cy * cz + sy * sx * sz) * a, cx * sz * a, (-sy * cz + cy * sx * sz) * a, 0,
        (-cy * sz + sy * sx * cz) * b, cx * cz * b, (sy * sz + cy * sx * cz) * b, 0,
        sy * cx * c, -sx * c, cy * cx * c, 0, ...value.position, 1];
}
function inverse(matrix) {
    const [a, b, c, d, e, f, g, h, i] = [matrix[0], matrix[4], matrix[8], matrix[1], matrix[5], matrix[9], matrix[2], matrix[6], matrix[10]];
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (!finite(determinant) || Math.abs(determinant) < 1e-18)
        fail('singular-transform');
    const result = [(e * i - f * h) / determinant, (f * g - d * i) / determinant, (d * h - e * g) / determinant, 0,
        (c * h - b * i) / determinant, (a * i - c * g) / determinant, (b * g - a * h) / determinant, 0,
        (b * f - c * e) / determinant, (c * d - a * f) / determinant, (a * e - b * d) / determinant, 0, 0, 0, 0, 1];
    const offset = direction(result, [-matrix[12], -matrix[13], -matrix[14]]);
    result[12] = offset[0];
    result[13] = offset[1];
    result[14] = offset[2];
    return result;
}
function direction(matrix, vector) {
    return [matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2], matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2], matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2]];
}
function point(matrix, vector) { const result = direction(matrix, vector); return [result[0] + matrix[12], result[1] + matrix[13], result[2] + matrix[14]]; }
const magnitude = (vector) => Math.hypot(...vector);
const normalize = (vector) => { const length = magnitude(vector); if (length < 1e-12 || !finite(length))
    fail('gizmo-axis'); return vector.map(value => value / length); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function rotationMatrix(axis, angle) {
    const [x, y, z] = normalize(axis), c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
}
function pureRotation(matrix, requireUniform = false) {
    const columns = [[matrix[0], matrix[1], matrix[2]], [matrix[4], matrix[5], matrix[6]], [matrix[8], matrix[9], matrix[10]]];
    const lengths = columns.map(magnitude), axes = columns.map(normalize);
    if (Math.abs(dot(axes[0], axes[1])) > 1e-5 || Math.abs(dot(axes[0], axes[2])) > 1e-5 || Math.abs(dot(axes[1], axes[2])) > 1e-5
        || requireUniform && lengths.some(length => Math.abs(length / lengths[0] - 1) > 1e-5))
        fail('world-rotation-not-representable');
    return [...axes[0], 0, ...axes[1], 0, ...axes[2], 0, 0, 0, 0, 1];
}
function angles(matrix) {
    const x = Math.asin(Math.max(-1, Math.min(1, -matrix[9]))), cx = Math.cos(x);
    const y = Math.abs(cx) > 1e-7 ? Math.atan2(matrix[8], matrix[10]) : Math.atan2(-matrix[2], matrix[0]);
    const z = Math.abs(cx) > 1e-7 ? Math.atan2(matrix[1], matrix[5]) : 0;
    return [x / radians, y / radians, z / radians];
}
function authoringWorldMatrices(items) {
    const byId = new Map(items.map(item => [item.id, item])), matrices = new Map();
    for (const item of items) {
        const chain = [], seen = new Set();
        let cursor = item;
        while (cursor && !matrices.has(cursor.id)) {
            if (seen.has(cursor.id))
                fail('hierarchy-cycle');
            seen.add(cursor.id);
            chain.push(cursor);
            if (cursor.parentId && !byId.has(cursor.parentId))
                fail('parent-transform-unavailable');
            cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
        }
        for (let index = chain.length - 1; index >= 0; index--) {
            const row = chain[index];
            matrices.set(row.id, freeze(multiplyTransformMatrices(row.parentId ? matrices.get(row.parentId) : identity(), authoringTransformMatrix(row.value))));
        }
    }
    return matrices;
}
/** The viewport supplies projected world axes; local handles follow the active transform. */
function authoringProjectedAxes(view, space) {
    const projection = view.gizmo.projection;
    if (!projection)
        return null;
    if (space === 'world')
        return projection.axes;
    try {
        const active = view.selection.active && authoringWorldMatrices(view.gizmo.transforms).get(view.selection.active.id);
        if (!active)
            return null;
        const projected = ([x, y, z]) => [projection.axes.x[0] * x + projection.axes.y[0] * y + projection.axes.z[0] * z, projection.axes.x[1] * x + projection.axes.y[1] * y + projection.axes.z[1] * z];
        return { x: projected(normalize(direction(active, [1, 0, 0]))), y: projected(normalize(direction(active, [0, 1, 0]))), z: projected(normalize(direction(active, [0, 0, 1]))) };
    }
    catch {
        return null;
    }
}
/** Owns only one temporary drag. It never accesses a product store or History. */
class AuthoringTransformGesture {
    view;
    options;
    closed = false;
    previewValue;
    matrices;
    targets;
    pivot;
    worldAxis;
    axisIndex;
    screen;
    constructor(view, options) {
        this.view = view;
        this.options = options;
        if (!view.binding || !view.gizmo.enabled || !view.gizmo.projection || !view.selection.active)
            fail('gizmo-unavailable');
        if (!['translate', 'rotate', 'scale'].includes(options.mode) || !['local', 'world'].includes(options.space) || !['x', 'y', 'z', 'all'].includes(options.axis) || !['active', 'center'].includes(options.pivot) || !finite(options.snap) || options.snap < 0)
            fail('gesture');
        if (options.mode === 'scale' && options.space !== 'local')
            fail('scale-local-only');
        const selected = new Set(view.selection.items.map(item => item.id)), transformIndex = new Map(view.gizmo.transforms.map(item => [item.id, item]));
        for (const id of selected)
            if (!transformIndex.has(id))
                fail('transform-unavailable');
        this.targets = view.gizmo.transforms.filter(item => {
            if (!selected.has(item.id))
                return false;
            let parent = item.parentId;
            while (parent) {
                if (selected.has(parent))
                    return false;
                parent = transformIndex.get(parent)?.parentId ?? null;
            }
            return true;
        });
        if (!this.targets.length || this.targets.length > 256)
            fail('selection-budget');
        this.matrices = authoringWorldMatrices(view.gizmo.transforms);
        this.axisIndex = options.axis === 'x' ? 0 : options.axis === 'z' ? 2 : 1;
        const axis = [0, 0, 0];
        axis[this.axisIndex] = 1;
        const active = this.matrices.get(view.selection.active.id);
        this.worldAxis = options.space === 'world' ? axis : normalize(direction(active, axis));
        const axes = authoringProjectedAxes(view, options.space);
        if (!axes)
            fail('gizmo-unavailable');
        this.screen = options.axis === 'all' ? [1, -1] : axes[options.axis];
        this.pivot = options.pivot === 'center' ? this.targets.map(item => point(this.matrices.get(item.id), [0, 0, 0])).reduce((sum, point) => [sum[0] + point[0] / this.targets.length, sum[1] + point[1] / this.targets.length, sum[2] + point[2] / this.targets.length], [0, 0, 0]) : point(active, [0, 0, 0]);
        this.previewValue = freeze({ binding: view.binding, changes: [] });
    }
    current(view) { return !this.closed && view.binding?.documentId === this.view.binding?.documentId && view.binding?.revision === this.view.binding?.revision && view.binding?.epoch === this.view.binding?.epoch && view.selection.revision === this.view.selection.revision; }
    update(dx, dy) {
        if (this.closed || !finite(dx) || !finite(dy) || Math.max(Math.abs(dx), Math.abs(dy)) > 1_000_000)
            fail('gesture');
        const projection = this.view.gizmo.projection, screen = this.screen;
        const length = Math.hypot(...screen);
        if (length < 1e-8)
            fail('axis-edge-on');
        const pixels = (dx * screen[0] + dy * screen[1]) / length;
        const snap = (value) => this.options.snap ? Math.round(value / this.options.snap) * this.options.snap : value;
        const amount = snap(pixels * (this.options.mode === 'translate' ? projection.unitsPerPixel : this.options.mode === 'rotate' ? .5 : .01));
        const unchanged = this.options.mode === 'translate' && this.options.axis === 'all' ? snap(dx * projection.unitsPerPixel) === 0 && snap(dy * projection.unitsPerPixel) === 0 : amount === 0;
        if (unchanged) {
            this.previewValue = freeze({ binding: this.view.binding, changes: this.targets.map(item => ({ reference: this.view.selection.items.find(reference => reference.id === item.id), before: item.value, after: item.value })) });
            return this.previewValue;
        }
        const rotation = rotationMatrix(this.worldAxis, amount * radians), factor = Math.max(.000001, 1 + amount);
        const changes = this.targets.map(item => {
            const next = clone(item.value), parent = item.parentId ? this.matrices.get(item.parentId) : identity(), inverseParent = inverse(parent);
            if (this.options.mode === 'translate') {
                const delta = this.options.axis === 'all' ? [snap(dx * projection.unitsPerPixel), -snap(dy * projection.unitsPerPixel), 0] : this.worldAxis.map(value => value * amount);
                const local = direction(inverseParent, delta);
                for (let i = 0; i < 3; i++)
                    next.position[i] += local[i];
            }
            else if (this.options.mode === 'rotate') {
                const local = authoringTransformMatrix({ position: [0, 0, 0], rotationDegrees: item.value.rotationDegrees, scale: [1, 1, 1] });
                if (this.options.space === 'local' && this.targets.length === 1 && this.options.pivot === 'active') {
                    const axis = [0, 0, 0];
                    axis[this.axisIndex] = 1;
                    next.rotationDegrees = angles(multiplyTransformMatrices(local, rotationMatrix(axis, amount * radians)));
                }
                else {
                    const parentRotation = pureRotation(parent, true);
                    next.rotationDegrees = angles(multiplyTransformMatrices(inverse(parentRotation), multiplyTransformMatrices(rotation, multiplyTransformMatrices(parentRotation, local))));
                }
                if (this.options.pivot === 'center') {
                    const beforeWorld = point(this.matrices.get(item.id), [0, 0, 0]), shifted = beforeWorld.map((value, index) => value - this.pivot[index]);
                    const rotated = direction(rotation, shifted);
                    next.position = point(inverseParent, rotated.map((value, index) => value + this.pivot[index]));
                }
            }
            else {
                if (this.options.axis === 'all')
                    next.scale = next.scale.map(value => value * factor);
                else
                    next.scale[this.axisIndex] *= factor;
                if (this.options.pivot === 'center') {
                    const beforeWorld = point(this.matrices.get(item.id), [0, 0, 0]), shifted = beforeWorld.map((value, index) => value - this.pivot[index]);
                    const scaled = this.options.axis === 'all' ? shifted.map(value => value * factor) : shifted.map((value, index) => value + this.worldAxis[index] * dot(shifted, this.worldAxis) * (factor - 1));
                    next.position = point(inverseParent, scaled.map((value, index) => value + this.pivot[index]));
                }
            }
            transform(next);
            return { reference: this.view.selection.items.find(reference => reference.id === item.id), before: item.value, after: next };
        });
        this.previewValue = freeze({ binding: this.view.binding, changes });
        return this.previewValue;
    }
    finish(current) {
        if (!this.current(current)) {
            this.cancel();
            return fail('gesture-stale');
        }
        this.closed = true;
        const changes = this.previewValue.changes.filter(change => !sameTransform(change.before, change.after));
        return changes.length ? freeze({ type: 'transform', binding: this.view.binding, changes }) : null;
    }
    cancel() { this.closed = true; this.previewValue = freeze({ binding: this.view.binding, changes: [] }); }
}
function sameTransform(left, right) { return ['position', 'rotationDegrees', 'scale'].every(key => left[key].every((value, index) => Math.abs(value - right[key][index]) < 1e-9)); }

const mounted = new WeakSet();
/** Pointer interaction is extracted from the product viewport; mutation stays with the host. */
class AdvancedTransformGizmo {
    host;
    preview;
    dispatch;
    diagnostic;
    root;
    view;
    options = { mode: 'translate', space: 'world', axis: 'x', pivot: 'active', snap: 0 };
    drag = null;
    lifetime = new AbortController();
    closed = false;
    busy = false;
    previousPosition;
    ownsPosition;
    constructor(host, initial, preview, dispatch, diagnostic) {
        this.host = host;
        this.preview = preview;
        this.dispatch = dispatch;
        this.diagnostic = diagnostic;
        if (mounted.has(host))
            throw Error('advanced-authoring.viewport-already-mounted');
        this.view = initial;
        const document = host.ownerDocument;
        this.previousPosition = host.style.position;
        this.ownsPosition = document.defaultView.getComputedStyle(host).position === 'static';
        if (this.ownsPosition)
            host.style.position = 'relative';
        mounted.add(host);
        this.root = document.createElement('div');
        this.root.className = 'advanced-transform-gizmo';
        this.root.setAttribute('aria-label', 'Transform gizmo');
        this.root.innerHTML = '<svg aria-hidden="true"></svg><button type="button" data-axis="x" aria-label="Transform X axis">X</button><button type="button" data-axis="y" aria-label="Transform Y axis">Y</button><button type="button" data-axis="z" aria-label="Transform Z axis">Z</button><button type="button" data-axis="all" aria-label="Transform XY / uniform scale">●</button>';
        host.append(this.root);
        try {
            for (const button of this.root.querySelectorAll('[data-axis]')) {
                button.addEventListener('pointerdown', event => this.begin(event, button), { signal: this.lifetime.signal });
                button.addEventListener('lostpointercapture', () => { if (this.drag?.handle === button)
                    this.cancel(); }, { signal: this.lifetime.signal });
                button.addEventListener('keydown', event => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || this.busy)
                        return;
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        const gesture = new AuthoringTransformGesture(this.view, { ...this.options, axis: button.dataset.axis });
                        const amount = event.shiftKey ? 10 : 1;
                        const sample = gesture.update(event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0);
                        this.preview(sample);
                        const intent = gesture.finish(this.view);
                        this.preview(null);
                        if (intent)
                            this.dispatch(intent);
                    }
                    catch {
                        this.cancel();
                        this.diagnostic('Transform is unavailable for this selection or coordinate space.');
                    }
                }, { signal: this.lifetime.signal });
            }
            const surface = document.defaultView;
            surface.addEventListener('pointermove', event => this.move(event), { signal: this.lifetime.signal });
            surface.addEventListener('pointerup', event => this.finish(event), { signal: this.lifetime.signal });
            surface.addEventListener('pointercancel', event => { if (event.pointerId === this.drag?.pointerId)
                this.cancel(); }, { signal: this.lifetime.signal });
            surface.addEventListener('blur', () => this.cancel(), { signal: this.lifetime.signal });
            host.addEventListener('keydown', event => {
                if (event.key === 'Escape' && this.drag) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.cancel();
                }
            }, { signal: this.lifetime.signal });
            this.render();
        }
        catch (error) {
            this.dispose();
            throw error;
        }
    }
    configure(options) { this.cancel(); this.options = { ...options, axis: 'x' }; this.render(); }
    update(view, busy = false) {
        if (this.closed)
            return;
        if (this.drag && (!this.drag.gesture.current(view) || !view.gizmo.enabled || !view.gizmo.projection || busy))
            this.cancel();
        this.view = view;
        this.busy = busy;
        this.render();
    }
    cancel() {
        const drag = this.drag;
        this.drag = null;
        if (drag) {
            drag.gesture.cancel();
            try {
                if (drag.handle.hasPointerCapture?.(drag.pointerId))
                    drag.handle.releasePointerCapture(drag.pointerId);
            }
            catch { /* Detached host. */ }
        }
        this.restorePreview();
    }
    restorePreview() { try {
        this.preview(null);
    }
    catch { /* Cleanup must release owned listeners even when the viewport host fails. */ } }
    dispose() { if (this.closed)
        return; this.closed = true; try {
        this.cancel();
    }
    finally {
        this.lifetime.abort();
        this.root.remove();
        mounted.delete(this.host);
        if (this.ownsPosition && this.host.style.position === 'relative')
            this.host.style.position = this.previousPosition;
    } }
    begin(event, handle) {
        if (this.closed || this.busy || this.drag || event.button !== 0)
            return;
        event.preventDefault();
        event.stopPropagation();
        try {
            const gesture = new AuthoringTransformGesture(this.view, { ...this.options, axis: handle.dataset.axis });
            this.drag = { gesture, pointerId: event.pointerId, x: event.clientX, y: event.clientY, handle };
            handle.setPointerCapture(event.pointerId);
        }
        catch {
            this.cancel();
            this.diagnostic('Transform is unavailable for this selection or coordinate space.');
        }
    }
    move(event) {
        const drag = this.drag;
        if (!drag || drag.pointerId !== event.pointerId)
            return;
        event.preventDefault();
        try {
            if (!drag.gesture.current(this.view))
                throw Error('stale');
            this.preview(drag.gesture.update(event.clientX - drag.x, event.clientY - drag.y));
        }
        catch {
            this.cancel();
            this.diagnostic('Transform preview cancelled. Refresh the selection before retrying.');
        }
    }
    finish(event) {
        const drag = this.drag;
        if (!drag || drag.pointerId !== event.pointerId)
            return;
        this.drag = null;
        try {
            // Include the final pointer position even if no last pointermove was delivered.
            drag.gesture.update(event.clientX - drag.x, event.clientY - drag.y);
            const intent = drag.gesture.finish(this.view);
            this.preview(null);
            if (intent)
                this.dispatch(intent);
        }
        catch {
            this.restorePreview();
            this.diagnostic('Transform was cancelled because its source changed.');
        }
        finally {
            if (drag.handle.hasPointerCapture?.(drag.pointerId))
                drag.handle.releasePointerCapture(drag.pointerId);
        }
    }
    render() {
        const projection = this.view.gizmo.projection;
        const axes = authoringProjectedAxes(this.view, this.options.space);
        this.root.hidden = !projection || !axes || !this.view.gizmo.enabled || !this.view.selection.active;
        this.root.dataset.mode = this.options.mode;
        if (!projection || !axes)
            return;
        const [x, y] = projection.origin, svg = this.root.querySelector('svg');
        svg.replaceChildren();
        const colors = { x: '#ff8e8e', y: '#84e5a4', z: '#98c4ff' };
        for (const axis of ['x', 'y', 'z']) {
            const [dx, dy] = axes[axis], button = this.root.querySelector(`[data-axis="${axis}"]`);
            button.style.left = `${x + dx}px`;
            button.style.top = `${y + dy}px`;
            button.disabled = this.busy || Math.hypot(dx, dy) < 1;
            const line = this.host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
            for (const [key, value] of Object.entries({ x1: x, y1: y, x2: x + dx, y2: y + dy, stroke: colors[axis], 'stroke-width': 3 }))
                line.setAttribute(key, String(value));
            svg.append(line);
            if (this.options.mode === 'rotate') {
                const others = ['x', 'y', 'z'].filter(value => value !== axis), a = axes[others[0]], b = axes[others[1]];
                const points = Array.from({ length: 49 }, (_, index) => { const t = index * Math.PI / 24; return `${x + a[0] * Math.cos(t) * .65 + b[0] * Math.sin(t) * .65},${y + a[1] * Math.cos(t) * .65 + b[1] * Math.sin(t) * .65}`; });
                const ring = this.host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                ring.setAttribute('points', points.join(' '));
                ring.setAttribute('stroke', colors[axis]);
                ring.setAttribute('stroke-width', '2');
                ring.setAttribute('fill', 'none');
                svg.append(ring);
            }
        }
        const all = this.root.querySelector('[data-axis="all"]');
        all.style.left = `${x}px`;
        all.style.top = `${y}px`;
        all.disabled = this.busy;
    }
}

/** Controlled presentation. The host owns Selection, Document, approvals and History. */
class AdvancedAuthoringPanel {
    options;
    root;
    view;
    lifetime = new AbortController();
    gizmo;
    task = null;
    generation = 0;
    closed = false;
    busy = false;
    message = '';
    offset = 0;
    sectionOffset = 0;
    fieldOffsets = new Map();
    collapsed = new Set();
    inspectorKey = '';
    hierarchyKey = '';
    document;
    constructor(options) {
        this.options = options;
        this.view = parseAdvancedAuthoringView(options.initial);
        this.document = options.host.ownerDocument;
        this.root = this.document.createElement('section');
        this.root.className = 'advanced-authoring-panel';
        this.root.setAttribute('aria-label', 'Advanced authoring');
        this.root.innerHTML = `<header><h2>Advanced authoring</h2><div class="advanced-actions"><button type="button" data-advanced="undo">Undo</button><button type="button" data-advanced="redo">Redo</button><button type="button" data-advanced="cancel">Cancel</button></div></header><p role="status" aria-live="polite" data-advanced="status"></p><p role="alert" data-advanced="error" hidden></p>
<section class="advanced-gizmo-toolbar" aria-label="Transform controls"><label>Mode<select data-advanced="mode"><option value="translate">Move</option><option value="rotate">Rotate</option><option value="scale">Scale</option></select></label><label>Space<select data-advanced="space"><option value="world">World</option><option value="local">Local</option></select></label><label>Pivot<select data-advanced="pivot"><option value="active">Active</option><option value="center">Center</option></select></label><label>Snap step (0 = off)<input data-advanced="snap" type="number" min="0" step="any" value="0"></label><button type="button" data-advanced="focus">Focus selection</button></section>
<div class="advanced-columns"><section aria-label="Full hierarchy"><h3>Hierarchy</h3><label>Search hierarchy<input type="search" data-advanced="search" maxlength="256"></label><p data-advanced="hierarchy-count"></p><div data-advanced="tree" role="tree" aria-label="Scene hierarchy"></div><div class="advanced-actions"><button type="button" data-advanced="previous">Previous</button><button type="button" data-advanced="next">Next</button></div><form data-advanced-form="rename"><label>Selected name<input name="name" maxlength="256" required></label><button type="submit" data-advanced="rename">Rename</button></form><form data-advanced-form="reparent"><label>Find parent<input data-advanced="parent-search" type="search" maxlength="256"></label><label>Parent<select name="parent" data-advanced="parent"></select></label><label>Sibling order<input name="order" type="number" min="0" step="1" value="0" required></label><button type="submit" data-advanced="reparent">Apply hierarchy</button></form></section>
<section aria-label="Component inspector"><h3>Inspector</h3><p data-advanced="selection"></p><div data-advanced="sections"></div><div class="advanced-actions"><button type="button" data-advanced="sections-previous">Previous components</button><button type="button" data-advanced="sections-next">Next components</button></div><form data-advanced-form="add"><label>Add registered component<select name="addition" data-advanced="addition"></select></label><button type="submit" data-advanced="add">Add</button></form></section></div>
<details class="advanced-runtime" open><summary>Runtime inspector (read only)</summary><p data-advanced="runtime-state"></p><button type="button" data-advanced="runtime">Refresh runtime</button><div data-advanced="runtime"></div></details>`;
        if (options.host === options.viewportHost || options.host.ownerDocument !== options.viewportHost.ownerDocument || options.host.querySelector('.advanced-authoring-panel'))
            throw Error('advanced-authoring.invalid-host');
        options.host.append(this.root);
        let constructedGizmo;
        try {
            this.gizmo = constructedGizmo = new AdvancedTransformGizmo(options.viewportHost, this.view, options.preview, intent => this.send(intent), message => { this.message = message; this.controls(); });
            this.root.addEventListener('click', event => this.click(event), { signal: this.lifetime.signal });
            this.root.addEventListener('submit', event => this.submit(event), { signal: this.lifetime.signal });
            this.root.addEventListener('change', event => this.change(event), { signal: this.lifetime.signal });
            this.get('search').addEventListener('input', () => { this.offset = 0; this.renderHierarchy(true); }, { signal: this.lifetime.signal });
            this.get('parent-search').addEventListener('input', () => this.renderParents(), { signal: this.lifetime.signal });
            this.root.addEventListener('keydown', event => this.key(event), { signal: this.lifetime.signal });
            options.viewportHost.addEventListener('keydown', event => {
                if (isEditing(event.target) || event.ctrlKey || event.metaKey || event.altKey)
                    return;
                const mode = { w: 'translate', e: 'rotate', r: 'scale' }[event.key.toLowerCase()];
                if (mode) {
                    event.preventDefault();
                    this.get('mode').value = mode;
                    this.configureGizmo();
                }
                if (event.key.toLowerCase() === 'f' && this.view.binding) {
                    event.preventDefault();
                    this.send({ type: 'focus-selection', binding: this.view.binding });
                }
            }, { signal: this.lifetime.signal });
            this.render();
        }
        catch (error) {
            this.lifetime.abort();
            constructedGizmo?.dispose();
            this.root.remove();
            throw error;
        }
    }
    update(input) {
        if (this.closed)
            return;
        const next = parseAdvancedAuthoringView(input), ownerChanged = next.binding?.epoch !== this.view.binding?.epoch || next.binding?.documentId !== this.view.binding?.documentId;
        if (ownerChanged) {
            this.cancel();
            this.offset = 0;
            this.sectionOffset = 0;
            this.collapsed.clear();
            this.get('search').value = '';
            this.get('parent-search').value = '';
            this.message = '';
        }
        if (next.selection.revision !== this.view.selection.revision) {
            this.cancel();
            this.sectionOffset = 0;
            this.fieldOffsets.clear();
            this.message = '';
        }
        this.view = next;
        this.gizmo.update(next, this.busy);
        this.render();
    }
    reveal(reference) {
        if (this.closed || reference.documentId !== this.view.binding?.documentId)
            return false;
        const item = this.view.hierarchy.find(item => item.reference.id === reference.id && item.reference.kind === reference.kind);
        if (!item)
            return false;
        this.get('search').value = '';
        const index = new Map(this.view.hierarchy.map(item => [item.reference.id, item]));
        let cursor = item.parentId;
        while (cursor) {
            this.collapsed.delete(cursor);
            cursor = index.get(cursor)?.parentId ?? null;
        }
        for (let offset = 0; offset < this.view.hierarchy.length; offset += 50)
            if (projectAuthoringHierarchy(this.view.hierarchy, { collapsed: this.collapsed, offset }).rows.some(row => row.item.reference.id === reference.id)) {
                this.offset = offset;
                break;
            }
        this.renderHierarchy(true);
        this.entityButton(reference.id)?.focus();
        return true;
    }
    cancel() { this.generation++; this.task?.abort(); this.task = null; this.busy = false; this.gizmo?.cancel(); if (!this.closed) {
        this.gizmo?.update(this.view, false);
        this.message = 'Operation cancelled.';
        this.controls();
    } }
    dispose() { if (this.closed)
        return; this.closed = true; this.generation++; this.task?.abort(); this.task = null; this.lifetime.abort(); try {
        this.gizmo.dispose();
    }
    finally {
        this.root.remove();
    } }
    get(id) { return this.root.querySelector(`[data-advanced="${id}"]`); }
    entityButton(id) { return [...this.get('tree').querySelectorAll('[data-entity]')].find(button => button.dataset.entity === id); }
    form(name) { return this.root.querySelector(`form[data-advanced-form="${name}"]`); }
    node(tag, text) { const node = this.document.createElement(tag); node.textContent = text; return node; }
    click(event) {
        const target = event.target instanceof this.document.defaultView.HTMLElement ? event.target.closest('button') : null;
        if (!target || !this.root.contains(target))
            return;
        if (target.disabled || this.closed)
            return;
        if (target.dataset.fieldPage) {
            const id = target.dataset.fieldPage;
            this.fieldOffsets.set(id, Math.max(0, (this.fieldOffsets.get(id) ?? 0) + Number(target.dataset.step)));
            this.renderInspector(true);
            return;
        }
        if (target.dataset.collapse) {
            const id = target.dataset.collapse;
            this.collapsed.has(id) ? this.collapsed.delete(id) : this.collapsed.add(id);
            this.renderHierarchy(true);
            this.entityButton(id)?.focus();
            return;
        }
        if (target.dataset.entity && this.view.binding) {
            const reference = this.view.hierarchy.find(item => item.reference.id === target.dataset.entity).reference;
            const additive = this.view.capabilities.multiSelection && event.ctrlKey;
            const references = additive ? this.view.selection.items.some(item => item.id === reference.id) ? this.view.selection.items.filter(item => item.id !== reference.id) : [...this.view.selection.items, reference] : [reference];
            this.send({ type: 'selection', binding: this.view.binding, references, active: references.find(item => item.id === reference.id) ?? references[0] ?? null });
            return;
        }
        if (target.dataset.remove && this.view.binding) {
            this.send({ type: 'section.remove', binding: this.view.binding, sectionId: target.dataset.remove });
            return;
        }
        switch (target.dataset.advanced) {
            case 'cancel':
                this.cancel();
                break;
            case 'previous':
                this.offset = Math.max(0, this.offset - 50);
                this.renderHierarchy(true);
                this.get('tree').querySelector('[data-entity]')?.focus();
                break;
            case 'next':
                this.offset += 50;
                this.renderHierarchy(true);
                this.get('tree').querySelector('[data-entity]')?.focus();
                break;
            case 'sections-previous':
                this.sectionOffset = Math.max(0, this.sectionOffset - 10);
                this.renderInspector(true);
                break;
            case 'sections-next':
                this.sectionOffset += 10;
                this.renderInspector(true);
                break;
            case 'undo':
            case 'redo':
                if (this.view.binding)
                    this.send({ type: target.dataset.advanced, binding: this.view.binding });
                break;
            case 'runtime':
                if (this.view.binding)
                    this.send({ type: 'runtime.inspect', binding: this.view.binding });
                break;
            case 'focus':
                if (this.view.binding)
                    this.send({ type: 'focus-selection', binding: this.view.binding });
                break;
        }
    }
    submit(event) {
        event.preventDefault();
        if (this.busy || !this.view.binding)
            return;
        const form = event.target, values = new FormData(form), binding = this.view.binding, active = this.view.selection.active;
        try {
            if (form.dataset.section && form.dataset.field) {
                const section = this.view.sections.find(section => section.id === form.dataset.section), field = section?.fields.find(field => field.id === form.dataset.field);
                if (!section?.editable || !field)
                    return;
                const value = parseFieldInput(field, field.kind === 'boolean' ? values.has('value') : String(values.get('value') ?? ''));
                this.send({ type: 'field.edit', binding, sectionId: section.id, fieldId: field.id, value });
            }
            else if (form.dataset.advancedForm === 'rename' && active && this.view.capabilities.rename)
                this.send({ type: 'rename', binding, reference: active, name: String(values.get('name')).trim() });
            else if (form.dataset.advancedForm === 'reparent' && active && this.view.capabilities.reparent) {
                const parentId = String(values.get('parent')) || null, order = Number(values.get('order'));
                if (!canReparent(this.view.hierarchy, active.id, parentId) || !Number.isSafeInteger(order) || order < 0)
                    throw Error('invalid');
                this.send({ type: 'reparent', binding, reference: active, parent: this.view.hierarchy.find(item => item.reference.id === parentId)?.reference ?? null, order });
            }
            else if (form.dataset.advancedForm === 'add' && this.view.capabilities.addSection && this.view.additions.some(item => item.id === values.get('addition') && item.enabled))
                this.send({ type: 'section.add', binding, additionId: String(values.get('addition')) });
        }
        catch {
            this.message = 'Invalid field value. Check its type and allowed range.';
            this.controls();
        }
    }
    change(event) {
        const target = event.target;
        if (['mode', 'space', 'pivot', 'snap'].includes(target.dataset.advanced ?? ''))
            this.configureGizmo();
        if (target.dataset.toggle && this.view.binding && this.view.sections.some(section => section.id === target.dataset.toggle && section.editable))
            this.send({ type: 'section.toggle', binding: this.view.binding, sectionId: target.dataset.toggle, enabled: target.checked });
    }
    configureGizmo() {
        const mode = this.get('mode').value, space = this.get('space');
        if (mode === 'scale')
            space.value = 'local';
        const snap = Number(this.get('snap').value);
        if (!Number.isFinite(snap) || snap < 0) {
            this.message = 'Snap must be zero or a positive number.';
            this.controls();
            return;
        }
        this.gizmo.configure({ mode, space: space.value, pivot: this.get('pivot').value, snap });
        this.controls();
    }
    key(event) {
        if (event.key === 'Escape') {
            this.cancel();
            return;
        }
        if (isEditing(event.target))
            return;
        if ((event.ctrlKey || event.metaKey) && this.view.binding && ['z', 'y'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            const type = event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo';
            this.send({ type, binding: this.view.binding });
            return;
        }
        const target = event.target;
        if (!target.dataset.entity)
            return;
        const buttons = [...this.get('tree').querySelectorAll('[data-entity]')], index = buttons.indexOf(target);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        }
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.key === 'ArrowLeft' ? this.collapsed.add(target.dataset.entity) : this.collapsed.delete(target.dataset.entity);
            this.renderHierarchy(true);
            this.entityButton(target.dataset.entity)?.focus();
        }
    }
    send(intent) {
        if (this.closed || this.busy)
            return;
        if (intent.type === 'undo' && (!this.view.history.canUndo || this.view.history.busy) || intent.type === 'redo' && (!this.view.history.canRedo || this.view.history.busy))
            return;
        const controller = new AbortController(), generation = ++this.generation;
        this.task = controller;
        this.busy = true;
        this.message = '';
        this.controls();
        this.gizmo.update(this.view, true);
        Promise.resolve().then(() => { if (!controller.signal.aborted && !this.closed)
            return this.options.dispatch(intent, controller.signal); }).catch(() => {
            if (!this.closed && generation === this.generation) {
                this.message = 'Operation failed or its source changed. Refresh and try again.';
                this.renderInspector(true);
            }
        }).finally(() => { if (!this.closed && generation === this.generation) {
            this.busy = false;
            this.task = null;
            this.controls();
            this.gizmo.update(this.view, false);
        } });
    }
    render() { this.renderHierarchy(); this.renderInspector(); this.renderRuntime(); this.controls(); }
    renderHierarchy(force = false) {
        const key = JSON.stringify([this.view.binding, this.view.hierarchy, this.view.selection]);
        if (!force && key === this.hierarchyKey)
            return;
        this.hierarchyKey = key;
        const focused = this.document.activeElement?.dataset.entity, page = projectAuthoringHierarchy(this.view.hierarchy, { search: this.get('search').value, collapsed: this.collapsed, offset: this.offset });
        if (!page.rows.length && this.offset && page.total) {
            this.offset = Math.floor((page.total - 1) / 50) * 50;
            this.renderHierarchy(true);
            return;
        }
        const tree = this.get('tree');
        tree.replaceChildren();
        for (const row of page.rows) {
            const line = this.node('div', '');
            line.className = 'advanced-tree-row';
            line.style.paddingLeft = `${Math.min(row.depth, 12) * 12}px`;
            if (row.hasChildren) {
                const collapse = this.node('button', row.expanded ? '▾' : '▸');
                collapse.type = 'button';
                collapse.dataset.collapse = row.item.reference.id;
                collapse.setAttribute('aria-label', `${row.expanded ? 'Collapse' : 'Expand'} ${row.item.label}`);
                line.append(collapse);
            }
            const button = this.node('button', row.item.label);
            button.type = 'button';
            button.dataset.entity = row.item.reference.id;
            button.setAttribute('role', 'treeitem');
            button.setAttribute('aria-level', String(row.depth + 1));
            button.setAttribute('aria-selected', String(this.view.selection.items.some(item => item.id === row.item.reference.id)));
            if (row.hasChildren)
                button.setAttribute('aria-expanded', String(row.expanded));
            line.append(button);
            tree.append(line);
        }
        if (!page.rows.length)
            tree.append(this.node('p', this.view.binding ? 'No matching items.' : 'Open a document to inspect its hierarchy.'));
        this.get('hierarchy-count').textContent = `${page.total} visible items · ${page.total ? this.offset + 1 : 0}–${this.offset + page.rows.length}`;
        this.get('previous').dataset.unavailable = String(this.offset === 0);
        this.get('next').dataset.unavailable = String(!page.next);
        const active = this.view.hierarchy.find(item => item.reference.id === this.view.selection.active?.id);
        this.form('rename').elements.namedItem('name').value = active?.label ?? '';
        this.form('reparent').elements.namedItem('order').value = String(active?.order ?? 0);
        this.renderParents();
        this.controls();
        if (focused)
            this.entityButton(focused)?.focus({ preventScroll: true });
    }
    renderParents() {
        const active = this.view.selection.active, search = this.get('parent-search').value.toLocaleLowerCase(), parent = this.get('parent');
        parent.replaceChildren();
        const root = this.node('option', 'Scene root');
        root.value = '';
        parent.append(root);
        if (!active)
            return;
        const children = new Map();
        for (const item of this.view.hierarchy)
            if (item.parentId) {
                const ids = children.get(item.parentId) ?? [];
                ids.push(item.reference.id);
                children.set(item.parentId, ids);
            }
        const excluded = new Set(), queue = [active.id];
        while (queue.length) {
            const id = queue.pop();
            excluded.add(id);
            queue.push(...children.get(id) ?? []);
        }
        const items = this.view.hierarchy.filter(item => !excluded.has(item.reference.id) && `${item.label} ${item.reference.id}`.toLocaleLowerCase().includes(search)).slice(0, 100);
        const currentId = this.view.hierarchy.find(item => item.reference.id === active.id)?.parentId, current = this.view.hierarchy.find(item => item.reference.id === currentId);
        if (current && !items.includes(current))
            items.unshift(current);
        for (const item of items) {
            const option = this.node('option', item.label);
            option.value = item.reference.id;
            parent.append(option);
        }
        parent.value = currentId ?? '';
    }
    renderInspector(force = false) {
        this.sectionOffset = Math.min(this.sectionOffset, Math.max(0, Math.floor((this.view.sections.length - 1) / 10) * 10));
        const key = JSON.stringify([this.view.binding, this.view.selection, this.view.sections, this.view.additions, this.sectionOffset]);
        if (!force && key === this.inspectorKey)
            return;
        this.inspectorKey = key;
        const selected = this.view.hierarchy.find(item => item.reference.id === this.view.selection.active?.id);
        this.get('selection').textContent = selected ? `${selected.label} · ${this.view.selection.items.length} selected` : 'Select an item to inspect.';
        const sections = this.get('sections');
        sections.replaceChildren();
        for (const section of this.view.sections.slice(this.sectionOffset, this.sectionOffset + 10)) {
            const details = this.document.createElement('details');
            details.open = true;
            details.append(this.node('summary', section.title), this.node('p', section.description));
            const label = this.node('label', 'Enabled'), enabled = this.document.createElement('input');
            enabled.type = 'checkbox';
            enabled.checked = section.enabled;
            enabled.dataset.toggle = section.id;
            enabled.dataset.unavailable = String(!section.editable);
            label.append(enabled);
            details.append(label);
            const offset = Math.min(this.fieldOffsets.get(section.id) ?? 0, Math.max(0, Math.floor((section.fields.length - 1) / 50) * 50));
            this.fieldOffsets.set(section.id, offset);
            for (const field of section.fields.slice(offset, offset + 50))
                details.append(this.fieldForm(section.id, field, !section.editable));
            if (section.fields.length > 50) {
                details.append(this.node('p', `Fields ${offset + 1}–${Math.min(offset + 50, section.fields.length)} of ${section.fields.length}`));
                for (const step of [-50, 50]) {
                    const button = this.node('button', step < 0 ? 'Previous fields' : 'Next fields');
                    button.type = 'button';
                    button.dataset.fieldPage = section.id;
                    button.dataset.step = String(step);
                    button.dataset.unavailable = String(step < 0 ? offset === 0 : offset + 50 >= section.fields.length);
                    details.append(button);
                }
            }
            if (section.removable) {
                const remove = this.node('button', 'Remove component');
                remove.type = 'button';
                remove.dataset.remove = section.id;
                remove.dataset.unavailable = String(!section.editable);
                details.append(remove);
            }
            sections.append(details);
        }
        this.get('sections-previous').dataset.unavailable = String(this.sectionOffset === 0);
        this.get('sections-next').dataset.unavailable = String(this.sectionOffset + 10 >= this.view.sections.length);
        const additions = this.get('addition');
        additions.replaceChildren();
        for (const addition of this.view.additions) {
            const option = this.node('option', addition.label);
            option.value = addition.id;
            option.disabled = !addition.enabled;
            additions.append(option);
        }
        this.controls();
    }
    fieldForm(sectionId, field, disabled) {
        const form = this.document.createElement('form');
        form.dataset.section = sectionId;
        form.dataset.field = field.id;
        form.className = 'advanced-field';
        const label = this.node('label', field.label);
        let input;
        if (field.kind === 'json') {
            input = this.document.createElement('textarea');
            input.value = JSON.stringify(field.value, null, 2);
            input.maxLength = 65536;
        }
        else if (field.kind === 'enum') {
            input = this.document.createElement('select');
            field.options?.forEach((option, index) => { const node = this.node('option', option.label); node.value = String(index); node.selected = JSON.stringify(option.value) === JSON.stringify(field.value); input.append(node); });
        }
        else {
            input = this.document.createElement('input');
            input.type = field.kind === 'number' ? 'number' : field.kind === 'boolean' ? 'checkbox' : 'text';
            if (field.kind === 'boolean')
                input.checked = Boolean(field.value);
            else
                input.value = String(field.value);
            if (field.kind === 'number') {
                input.step = 'any';
                if (field.minimum !== undefined)
                    input.min = String(field.minimum);
                if (field.maximum !== undefined)
                    input.max = String(field.maximum);
            }
        }
        input.name = 'value';
        input.dataset.unavailable = String(field.readOnly || disabled);
        label.append(input);
        form.append(label);
        const button = this.node('button', 'Apply');
        button.type = 'submit';
        button.dataset.unavailable = String(field.readOnly || disabled);
        form.append(button);
        return form;
    }
    renderRuntime() {
        const runtime = this.view.runtime;
        this.get('runtime-state').textContent = `${runtime.status}${runtime.instanceId ? ` · ${runtime.instanceId}` : ''}${runtime.frame === null ? '' : ` · frame ${runtime.frame} · tick ${runtime.tick}`}${runtime.status === 'historical' ? ' · Previous run or document revision' : ''}`;
        const target = this.get('runtime');
        target.replaceChildren();
        for (const diagnostic of runtime.diagnostics)
            target.append(this.node('p', diagnostic));
        const rows = this.document.createElement('dl');
        for (const field of runtime.fields)
            rows.append(this.node('dt', field.label), this.node('dd', typeof field.value === 'string' ? field.value : JSON.stringify(field.value)));
        target.append(rows);
    }
    controls() {
        if (this.closed)
            return;
        this.root.setAttribute('aria-busy', String(this.busy));
        this.get('status').textContent = this.message || (this.busy ? 'Working…' : this.view.binding ? `Document revision ${this.view.binding.revision}` : 'No open document.');
        this.get('error').textContent = this.view.diagnostics.join('\n');
        this.get('error').hidden = !this.view.diagnostics.length;
        for (const control of this.root.querySelectorAll('button,input,select,textarea')) {
            const key = control.dataset.advanced;
            control.disabled = key === 'cancel' ? !this.busy : this.busy || control.dataset.unavailable === 'true' || !this.view.binding;
            if (key === 'undo')
                control.disabled ||= !this.view.history.canUndo || this.view.history.busy;
            if (key === 'redo')
                control.disabled ||= !this.view.history.canRedo || this.view.history.busy;
            if (key === 'rename')
                control.disabled ||= !this.view.capabilities.rename || !this.view.selection.active;
            if (key === 'reparent')
                control.disabled ||= !this.view.capabilities.reparent || !this.view.selection.active;
            if (key === 'add')
                control.disabled ||= !this.view.capabilities.addSection || !this.view.selection.active || !this.view.additions.some(item => item.enabled);
            if (key === 'focus')
                control.disabled ||= !this.view.selection.active;
            if (key === 'space')
                control.disabled ||= this.get('mode').value === 'scale';
        }
    }
}
function isEditing(target) { return Boolean(target && 'closest' in target && typeof target.closest === 'function' && target.closest('input,textarea,select,[contenteditable="true"]')); }

export { AdvancedAuthoringPanel };
