import type { EditorSelectionReference } from '@haiyue/editor-plugin-sdk';
import type { AdvancedAuthoringIntent, AdvancedAuthoringMount, AdvancedAuthoringOptions, AdvancedAuthoringView, AuthoringField, AuthoringGizmoMode, AuthoringGizmoSpace } from './types.js';
import { parseAdvancedAuthoringView, parseFieldInput } from './validation.js';
import { projectAuthoringHierarchy, canReparent } from './hierarchy.js';
import { AdvancedTransformGizmo } from './gizmo.js';

/** Controlled presentation. The host owns Selection, Document, approvals and History. */
export class AdvancedAuthoringPanel implements AdvancedAuthoringMount {
  readonly root: HTMLElement;
  private view: AdvancedAuthoringView;
  private readonly lifetime = new AbortController();
  private readonly gizmo: AdvancedTransformGizmo;
  private task: AbortController | null = null;
  private generation = 0;
  private closed = false;
  private busy = false;
  private message = '';
  private offset = 0;
  private sectionOffset = 0;
  private readonly fieldOffsets = new Map<string, number>();
  private readonly collapsed = new Set<string>();
  private inspectorKey = '';
  private hierarchyKey = '';
  private readonly document: Document;
  constructor(private readonly options: AdvancedAuthoringOptions) {
    this.view = parseAdvancedAuthoringView(options.initial); this.document = options.host.ownerDocument;
    this.root = this.document.createElement('section'); this.root.className = 'advanced-authoring-panel'; this.root.setAttribute('aria-label', 'Advanced authoring');
    this.root.innerHTML = `<header><h2>Advanced authoring</h2><div class="advanced-actions"><button type="button" data-advanced="undo">Undo</button><button type="button" data-advanced="redo">Redo</button><button type="button" data-advanced="cancel">Cancel</button></div></header><p role="status" aria-live="polite" data-advanced="status"></p><p role="alert" data-advanced="error" hidden></p>
<section class="advanced-gizmo-toolbar" aria-label="Transform controls"><label>Mode<select data-advanced="mode"><option value="translate">Move</option><option value="rotate">Rotate</option><option value="scale">Scale</option></select></label><label>Space<select data-advanced="space"><option value="world">World</option><option value="local">Local</option></select></label><label>Pivot<select data-advanced="pivot"><option value="active">Active</option><option value="center">Center</option></select></label><label>Snap step (0 = off)<input data-advanced="snap" type="number" min="0" step="any" value="0"></label><button type="button" data-advanced="focus">Focus selection</button></section>
<div class="advanced-columns"><section aria-label="Full hierarchy"><h3>Hierarchy</h3><label>Search hierarchy<input type="search" data-advanced="search" maxlength="256"></label><p data-advanced="hierarchy-count"></p><div data-advanced="tree" role="tree" aria-label="Scene hierarchy"></div><div class="advanced-actions"><button type="button" data-advanced="previous">Previous</button><button type="button" data-advanced="next">Next</button></div><form data-advanced-form="rename"><label>Selected name<input name="name" maxlength="256" required></label><button type="submit" data-advanced="rename">Rename</button></form><form data-advanced-form="reparent"><label>Find parent<input data-advanced="parent-search" type="search" maxlength="256"></label><label>Parent<select name="parent" data-advanced="parent"></select></label><label>Sibling order<input name="order" type="number" min="0" step="1" value="0" required></label><button type="submit" data-advanced="reparent">Apply hierarchy</button></form></section>
<section aria-label="Component inspector"><h3>Inspector</h3><p data-advanced="selection"></p><div data-advanced="sections"></div><div class="advanced-actions"><button type="button" data-advanced="sections-previous">Previous components</button><button type="button" data-advanced="sections-next">Next components</button></div><form data-advanced-form="add"><label>Add registered component<select name="addition" data-advanced="addition"></select></label><button type="submit" data-advanced="add">Add</button></form></section></div>
<details class="advanced-runtime" open><summary>Runtime inspector (read only)</summary><p data-advanced="runtime-state"></p><button type="button" data-advanced="runtime">Refresh runtime</button><div data-advanced="runtime"></div></details>`;
    if (options.host === options.viewportHost || options.host.ownerDocument !== options.viewportHost.ownerDocument || options.host.querySelector('.advanced-authoring-panel')) throw Error('advanced-authoring.invalid-host');
    options.host.append(this.root);
    let constructedGizmo: AdvancedTransformGizmo | undefined;
    try {
      this.gizmo = constructedGizmo = new AdvancedTransformGizmo(options.viewportHost, this.view, options.preview, intent => this.send(intent), message => { this.message = message; this.controls(); });
      this.root.addEventListener('click', event => this.click(event), { signal: this.lifetime.signal });
      this.root.addEventListener('submit', event => this.submit(event), { signal: this.lifetime.signal });
      this.root.addEventListener('change', event => this.change(event), { signal: this.lifetime.signal });
      this.get('search').addEventListener('input', () => { this.offset = 0; this.renderHierarchy(true); }, { signal: this.lifetime.signal });
      this.get('parent-search').addEventListener('input', () => this.renderParents(), { signal: this.lifetime.signal });
      this.root.addEventListener('keydown', event => this.key(event), { signal: this.lifetime.signal });
      options.viewportHost.addEventListener('keydown', event => {
        if (isEditing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
        const mode = ({ w: 'translate', e: 'rotate', r: 'scale' } as Record<string, string>)[event.key.toLowerCase()];
        if (mode) { event.preventDefault(); this.get<HTMLSelectElement>('mode').value = mode; this.configureGizmo(); }
        if (event.key.toLowerCase() === 'f' && this.view.binding) { event.preventDefault(); this.send({ type: 'focus-selection', binding: this.view.binding }); }
      }, { signal: this.lifetime.signal });
      this.render();
    } catch (error) { this.lifetime.abort(); constructedGizmo?.dispose(); this.root.remove(); throw error; }
  }
  update(input: unknown): void {
    if (this.closed) return;
    const next = parseAdvancedAuthoringView(input), ownerChanged = next.binding?.epoch !== this.view.binding?.epoch || next.binding?.documentId !== this.view.binding?.documentId;
    if (ownerChanged) { this.cancel(); this.offset = 0; this.sectionOffset = 0; this.collapsed.clear(); this.get<HTMLInputElement>('search').value = ''; this.get<HTMLInputElement>('parent-search').value = ''; this.message = ''; }
    if (next.selection.revision !== this.view.selection.revision) { this.cancel(); this.sectionOffset = 0; this.fieldOffsets.clear(); this.message = ''; }
    this.view = next; this.gizmo.update(next, this.busy); this.render();
  }
  reveal(reference: EditorSelectionReference): boolean {
    if (this.closed || reference.documentId !== this.view.binding?.documentId) return false;
    const item = this.view.hierarchy.find(item => item.reference.id === reference.id && item.reference.kind === reference.kind); if (!item) return false;
    this.get<HTMLInputElement>('search').value = ''; const index = new Map(this.view.hierarchy.map(item => [item.reference.id, item])); let cursor = item.parentId;
    while (cursor) { this.collapsed.delete(cursor); cursor = index.get(cursor)?.parentId ?? null; }
    for (let offset = 0; offset < this.view.hierarchy.length; offset += 50) if (projectAuthoringHierarchy(this.view.hierarchy, { collapsed: this.collapsed, offset }).rows.some(row => row.item.reference.id === reference.id)) { this.offset = offset; break; }
    this.renderHierarchy(true); this.entityButton(reference.id)?.focus(); return true;
  }
  cancel(): void { this.generation++; this.task?.abort(); this.task = null; this.busy = false; this.gizmo?.cancel(); if (!this.closed) { this.gizmo?.update(this.view, false); this.message = 'Operation cancelled.'; this.controls(); } }
  dispose(): void { if (this.closed) return; this.closed = true; this.generation++; this.task?.abort(); this.task = null; this.lifetime.abort(); try { this.gizmo.dispose(); } finally { this.root.remove(); } }
  private get<T extends HTMLElement = HTMLElement>(id: string): T { return this.root.querySelector<T>(`[data-advanced="${id}"]`)!; }
  private entityButton(id: string): HTMLElement | undefined { return [...this.get('tree').querySelectorAll<HTMLElement>('[data-entity]')].find(button => button.dataset.entity === id); }
  private form(name: string): HTMLFormElement { return this.root.querySelector<HTMLFormElement>(`form[data-advanced-form="${name}"]`)!; }
  private node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] { const node = this.document.createElement(tag); node.textContent = text; return node; }
  private click(event: Event): void {
    const target = event.target instanceof this.document.defaultView!.HTMLElement ? event.target.closest<HTMLElement>('button') : null; if (!target || !this.root.contains(target)) return;
    if ((target as HTMLButtonElement).disabled || this.closed) return;
    if (target.dataset.fieldPage) { const id = target.dataset.fieldPage; this.fieldOffsets.set(id, Math.max(0, (this.fieldOffsets.get(id) ?? 0) + Number(target.dataset.step))); this.renderInspector(true); return; }
    if (target.dataset.collapse) { const id = target.dataset.collapse; this.collapsed.has(id) ? this.collapsed.delete(id) : this.collapsed.add(id); this.renderHierarchy(true); this.entityButton(id)?.focus(); return; }
    if (target.dataset.entity && this.view.binding) {
      const reference = this.view.hierarchy.find(item => item.reference.id === target.dataset.entity)!.reference;
      const additive = this.view.capabilities.multiSelection && (event as MouseEvent).ctrlKey;
      const references = additive ? this.view.selection.items.some(item => item.id === reference.id) ? this.view.selection.items.filter(item => item.id !== reference.id) : [...this.view.selection.items, reference] : [reference];
      this.send({ type: 'selection', binding: this.view.binding, references, active: references.find(item => item.id === reference.id) ?? references[0] ?? null }); return;
    }
    if (target.dataset.remove && this.view.binding) { this.send({ type: 'section.remove', binding: this.view.binding, sectionId: target.dataset.remove }); return; }
    switch (target.dataset.advanced) {
      case 'cancel': this.cancel(); break;
      case 'previous': this.offset = Math.max(0, this.offset-50); this.renderHierarchy(true); this.get('tree').querySelector<HTMLElement>('[data-entity]')?.focus(); break;
      case 'next': this.offset += 50; this.renderHierarchy(true); this.get('tree').querySelector<HTMLElement>('[data-entity]')?.focus(); break;
      case 'sections-previous': this.sectionOffset = Math.max(0, this.sectionOffset-10); this.renderInspector(true); break;
      case 'sections-next': this.sectionOffset += 10; this.renderInspector(true); break;
      case 'undo': case 'redo': if (this.view.binding) this.send({ type: target.dataset.advanced, binding: this.view.binding }); break;
      case 'runtime': if (this.view.binding) this.send({ type: 'runtime.inspect', binding: this.view.binding }); break;
      case 'focus': if (this.view.binding) this.send({ type: 'focus-selection', binding: this.view.binding }); break;
    }
  }
  private submit(event: Event): void {
    event.preventDefault(); if (this.busy || !this.view.binding) return;
    const form = event.target as HTMLFormElement, values = new FormData(form), binding = this.view.binding, active = this.view.selection.active;
    try {
      if (form.dataset.section && form.dataset.field) {
        const section = this.view.sections.find(section => section.id === form.dataset.section), field = section?.fields.find(field => field.id === form.dataset.field);
        if (!section?.editable || !field) return;
        const value = parseFieldInput(field, field.kind === 'boolean' ? values.has('value') : String(values.get('value') ?? ''));
        this.send({ type: 'field.edit', binding, sectionId: section.id, fieldId: field.id, value });
      } else if (form.dataset.advancedForm === 'rename' && active && this.view.capabilities.rename) this.send({ type: 'rename', binding, reference: active, name: String(values.get('name')).trim() });
      else if (form.dataset.advancedForm === 'reparent' && active && this.view.capabilities.reparent) {
        const parentId = String(values.get('parent')) || null, order = Number(values.get('order')); if (!canReparent(this.view.hierarchy, active.id, parentId) || !Number.isSafeInteger(order) || order < 0) throw Error('invalid');
        this.send({ type: 'reparent', binding, reference: active, parent: this.view.hierarchy.find(item => item.reference.id === parentId)?.reference ?? null, order });
      } else if (form.dataset.advancedForm === 'add' && this.view.capabilities.addSection && this.view.additions.some(item => item.id === values.get('addition') && item.enabled)) this.send({ type: 'section.add', binding, additionId: String(values.get('addition')) });
    } catch { this.message = 'Invalid field value. Check its type and allowed range.'; this.controls(); }
  }
  private change(event: Event): void {
    const target = event.target as HTMLElement;
    if (['mode','space','pivot','snap'].includes(target.dataset.advanced ?? '')) this.configureGizmo();
    if (target.dataset.toggle && this.view.binding && this.view.sections.some(section => section.id === target.dataset.toggle && section.editable)) this.send({ type: 'section.toggle', binding: this.view.binding, sectionId: target.dataset.toggle, enabled: (target as HTMLInputElement).checked });
  }
  private configureGizmo(): void {
    const mode = this.get<HTMLSelectElement>('mode').value as AuthoringGizmoMode, space = this.get<HTMLSelectElement>('space'); if (mode === 'scale') space.value = 'local';
    const snap = Number(this.get<HTMLInputElement>('snap').value); if (!Number.isFinite(snap) || snap < 0) { this.message = 'Snap must be zero or a positive number.'; this.controls(); return; }
    this.gizmo.configure({ mode, space: space.value as AuthoringGizmoSpace, pivot: this.get<HTMLSelectElement>('pivot').value as 'active' | 'center', snap }); this.controls();
  }
  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape') { this.cancel(); return; }
    if (isEditing(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && this.view.binding && ['z','y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); const type = event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'; this.send({ type, binding: this.view.binding }); return;
    }
    const target = event.target as HTMLElement; if (!target.dataset.entity) return;
    const buttons = [...this.get('tree').querySelectorAll<HTMLElement>('[data-entity]')], index = buttons.indexOf(target);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length-1, index+(event.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); buttons[event.key === 'Home' ? 0 : buttons.length-1]?.focus(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.key === 'ArrowLeft' ? this.collapsed.add(target.dataset.entity) : this.collapsed.delete(target.dataset.entity); this.renderHierarchy(true); this.entityButton(target.dataset.entity)?.focus(); }
  }
  private send(intent: AdvancedAuthoringIntent): void {
    if (this.closed || this.busy) return;
    if (intent.type === 'undo' && (!this.view.history.canUndo || this.view.history.busy) || intent.type === 'redo' && (!this.view.history.canRedo || this.view.history.busy)) return;
    const controller = new AbortController(), generation = ++this.generation; this.task = controller; this.busy = true; this.message = ''; this.controls(); this.gizmo.update(this.view, true);
    Promise.resolve().then(() => { if (!controller.signal.aborted && !this.closed) return this.options.dispatch(intent, controller.signal); }).catch(() => {
      if (!this.closed && generation === this.generation) { this.message = 'Operation failed or its source changed. Refresh and try again.'; this.renderInspector(true); }
    }).finally(() => { if (!this.closed && generation === this.generation) { this.busy = false; this.task = null; this.controls(); this.gizmo.update(this.view, false); } });
  }
  private render(): void { this.renderHierarchy(); this.renderInspector(); this.renderRuntime(); this.controls(); }
  private renderHierarchy(force = false): void {
    const key = JSON.stringify([this.view.binding, this.view.hierarchy, this.view.selection]); if (!force && key === this.hierarchyKey) return; this.hierarchyKey = key;
    const focused = (this.document.activeElement as HTMLElement | null)?.dataset.entity, page = projectAuthoringHierarchy(this.view.hierarchy, { search: this.get<HTMLInputElement>('search').value, collapsed: this.collapsed, offset: this.offset });
    if (!page.rows.length && this.offset && page.total) { this.offset = Math.floor((page.total-1)/50)*50; this.renderHierarchy(true); return; }
    const tree = this.get('tree'); tree.replaceChildren();
    for (const row of page.rows) {
      const line = this.node('div', ''); line.className = 'advanced-tree-row'; line.style.paddingLeft = `${Math.min(row.depth, 12)*12}px`;
      if (row.hasChildren) { const collapse = this.node('button', row.expanded ? '▾' : '▸'); collapse.type = 'button'; collapse.dataset.collapse = row.item.reference.id; collapse.setAttribute('aria-label', `${row.expanded ? 'Collapse' : 'Expand'} ${row.item.label}`); line.append(collapse); }
      const button = this.node('button', row.item.label); button.type = 'button'; button.dataset.entity = row.item.reference.id; button.setAttribute('role', 'treeitem'); button.setAttribute('aria-level', String(row.depth+1)); button.setAttribute('aria-selected', String(this.view.selection.items.some(item => item.id === row.item.reference.id)));
      if (row.hasChildren) button.setAttribute('aria-expanded', String(row.expanded)); line.append(button); tree.append(line);
    }
    if (!page.rows.length) tree.append(this.node('p', this.view.binding ? 'No matching items.' : 'Open a document to inspect its hierarchy.'));
    this.get('hierarchy-count').textContent = `${page.total} visible items · ${page.total ? this.offset+1 : 0}–${this.offset+page.rows.length}`;
    this.get('previous').dataset.unavailable = String(this.offset === 0); this.get('next').dataset.unavailable = String(!page.next);
    const active = this.view.hierarchy.find(item => item.reference.id === this.view.selection.active?.id);
    (this.form('rename').elements.namedItem('name') as HTMLInputElement).value = active?.label ?? '';
    (this.form('reparent').elements.namedItem('order') as HTMLInputElement).value = String(active?.order ?? 0); this.renderParents(); this.controls(); if (focused) this.entityButton(focused)?.focus({ preventScroll: true });
  }
  private renderParents(): void {
    const active = this.view.selection.active, search = this.get<HTMLInputElement>('parent-search').value.toLocaleLowerCase(), parent = this.get<HTMLSelectElement>('parent'); parent.replaceChildren();
    const root = this.node('option', 'Scene root'); root.value = ''; parent.append(root);
    if (!active) return;
    const children = new Map<string, string[]>(); for (const item of this.view.hierarchy) if (item.parentId) { const ids = children.get(item.parentId) ?? []; ids.push(item.reference.id); children.set(item.parentId, ids); }
    const excluded = new Set<string>(), queue = [active.id]; while (queue.length) { const id = queue.pop()!; excluded.add(id); queue.push(...children.get(id) ?? []); }
    const items = this.view.hierarchy.filter(item => !excluded.has(item.reference.id) && `${item.label} ${item.reference.id}`.toLocaleLowerCase().includes(search)).slice(0,100);
    const currentId = this.view.hierarchy.find(item => item.reference.id === active.id)?.parentId, current = this.view.hierarchy.find(item => item.reference.id === currentId);
    if (current && !items.includes(current)) items.unshift(current);
    for (const item of items) { const option = this.node('option', item.label); option.value = item.reference.id; parent.append(option); } parent.value = currentId ?? '';
  }
  private renderInspector(force = false): void {
    this.sectionOffset = Math.min(this.sectionOffset, Math.max(0, Math.floor((this.view.sections.length-1)/10)*10));
    const key = JSON.stringify([this.view.binding, this.view.selection, this.view.sections, this.view.additions, this.sectionOffset]); if (!force && key === this.inspectorKey) return; this.inspectorKey = key;
    const selected = this.view.hierarchy.find(item => item.reference.id === this.view.selection.active?.id);
    this.get('selection').textContent = selected ? `${selected.label} · ${this.view.selection.items.length} selected` : 'Select an item to inspect.';
    const sections = this.get('sections'); sections.replaceChildren();
    for (const section of this.view.sections.slice(this.sectionOffset, this.sectionOffset+10)) {
      const details = this.document.createElement('details'); details.open = true; details.append(this.node('summary', section.title), this.node('p', section.description));
      const label = this.node('label', 'Enabled'), enabled = this.document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = section.enabled; enabled.dataset.toggle = section.id; enabled.dataset.unavailable = String(!section.editable); label.append(enabled); details.append(label);
      const offset = Math.min(this.fieldOffsets.get(section.id) ?? 0, Math.max(0, Math.floor((section.fields.length-1)/50)*50));
      this.fieldOffsets.set(section.id,offset);
      for (const field of section.fields.slice(offset, offset+50)) details.append(this.fieldForm(section.id, field, !section.editable));
      if (section.fields.length > 50) { details.append(this.node('p', `Fields ${offset+1}–${Math.min(offset+50, section.fields.length)} of ${section.fields.length}`)); for (const step of [-50, 50]) { const button = this.node('button', step < 0 ? 'Previous fields' : 'Next fields'); button.type = 'button'; button.dataset.fieldPage = section.id; button.dataset.step = String(step); button.dataset.unavailable = String(step < 0 ? offset === 0 : offset+50 >= section.fields.length); details.append(button); } }
      if (section.removable) { const remove = this.node('button', 'Remove component'); remove.type = 'button'; remove.dataset.remove = section.id; remove.dataset.unavailable = String(!section.editable); details.append(remove); } sections.append(details);
    }
    this.get('sections-previous').dataset.unavailable = String(this.sectionOffset === 0); this.get('sections-next').dataset.unavailable = String(this.sectionOffset+10 >= this.view.sections.length);
    const additions = this.get<HTMLSelectElement>('addition'); additions.replaceChildren(); for (const addition of this.view.additions) { const option = this.node('option', addition.label); option.value = addition.id; option.disabled = !addition.enabled; additions.append(option); }
    this.controls();
  }
  private fieldForm(sectionId: string, field: AuthoringField, disabled: boolean): HTMLFormElement {
    const form = this.document.createElement('form'); form.dataset.section = sectionId; form.dataset.field = field.id; form.className = 'advanced-field';
    const label = this.node('label', field.label); let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (field.kind === 'json') { input = this.document.createElement('textarea'); input.value = JSON.stringify(field.value, null, 2); input.maxLength = 65536; }
    else if (field.kind === 'enum') { input = this.document.createElement('select'); field.options?.forEach((option, index) => { const node = this.node('option', option.label); node.value = String(index); node.selected = JSON.stringify(option.value) === JSON.stringify(field.value); (input as HTMLSelectElement).append(node); }); }
    else { input = this.document.createElement('input'); input.type = field.kind === 'number' ? 'number' : field.kind === 'boolean' ? 'checkbox' : 'text'; if (field.kind === 'boolean') input.checked = Boolean(field.value); else input.value = String(field.value); if (field.kind === 'number') { input.step = 'any'; if (field.minimum !== undefined) input.min = String(field.minimum); if (field.maximum !== undefined) input.max = String(field.maximum); } }
    input.name = 'value'; input.dataset.unavailable = String(field.readOnly || disabled); label.append(input); form.append(label);
    const button = this.node('button', 'Apply'); button.type = 'submit'; button.dataset.unavailable = String(field.readOnly || disabled); form.append(button); return form;
  }
  private renderRuntime(): void {
    const runtime = this.view.runtime;
    this.get('runtime-state').textContent = `${runtime.status}${runtime.instanceId ? ` · ${runtime.instanceId}` : ''}${runtime.frame === null ? '' : ` · frame ${runtime.frame} · tick ${runtime.tick}`}${runtime.status === 'historical' ? ' · Previous run or document revision' : ''}`;
    const target = this.get('runtime'); target.replaceChildren(); for (const diagnostic of runtime.diagnostics) target.append(this.node('p', diagnostic));
    const rows = this.document.createElement('dl'); for (const field of runtime.fields) rows.append(this.node('dt', field.label), this.node('dd', typeof field.value === 'string' ? field.value : JSON.stringify(field.value))); target.append(rows);
  }
  private controls(): void {
    if (this.closed) return;
    this.root.setAttribute('aria-busy', String(this.busy)); this.get('status').textContent = this.message || (this.busy ? 'Working…' : this.view.binding ? `Document revision ${this.view.binding.revision}` : 'No open document.');
    this.get('error').textContent = this.view.diagnostics.join('\n'); this.get('error').hidden = !this.view.diagnostics.length;
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea')) {
      const key = control.dataset.advanced;
      control.disabled = key === 'cancel' ? !this.busy : this.busy || control.dataset.unavailable === 'true' || !this.view.binding;
      if (key === 'undo') control.disabled ||= !this.view.history.canUndo || this.view.history.busy;
      if (key === 'redo') control.disabled ||= !this.view.history.canRedo || this.view.history.busy;
      if (key === 'rename') control.disabled ||= !this.view.capabilities.rename || !this.view.selection.active;
      if (key === 'reparent') control.disabled ||= !this.view.capabilities.reparent || !this.view.selection.active;
      if (key === 'add') control.disabled ||= !this.view.capabilities.addSection || !this.view.selection.active || !this.view.additions.some(item => item.enabled);
      if (key === 'focus') control.disabled ||= !this.view.selection.active;
      if (key === 'space') control.disabled ||= this.get<HTMLSelectElement>('mode').value === 'scale';
    }
  }
}
function isEditing(target: EventTarget | null): boolean { return Boolean(target && 'closest' in target && typeof target.closest === 'function' && target.closest('input,textarea,select,[contenteditable="true"]')); }
