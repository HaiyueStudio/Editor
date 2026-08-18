import { Camera2D, Camera3D, ColorSRGB, Component } from '@haiyue/engine';
import { LightComponent } from '@haiyue/engine/lighting';
import { Tilemap2DComponent } from '@haiyue/extensions/tilemap';
import type { GenericComponentEditorSchema, GenericEditorFieldSchema } from '../../types';

export interface GenericComponentEditorElements {
  section: HTMLElement | null;
  title: HTMLElement | null;
  fields: HTMLElement | null;
}

export interface RenderGenericComponentEditorOptions {
  component: Component;
  schema: GenericComponentEditorSchema;
  elements: GenericComponentEditorElements;
  formatNumber: (value: number) => string;
  onCommit: () => void;
  getAssetRefOptions?: (assetType: string) => Array<{ label: string; value: string }>;
}

const ASSET_DRAG_MIME: Record<string, string[]> = {
  geometry: ['application/x-haiyue-geometry-id', 'application/x-haiyue-mesh-id'],
  geometry3d: ['application/x-haiyue-geometry-id', 'application/x-haiyue-mesh-id'],
  geometry2d: ['application/x-haiyue-geometry2d-id'],
  material: ['application/x-haiyue-material-id'],
  material3d: ['application/x-haiyue-material-id'],
  material2d: ['application/x-haiyue-material2d-id'],
  texture: ['application/x-haiyue-texture-id'],
  model: ['application/x-haiyue-model-id'],
  gltf: ['application/x-haiyue-model-id'],
  script: ['application/x-haiyue-script-id'],
  prefab: ['application/x-haiyue-prefab-id'],
};

let assetListId = 0;

export function getGenericEditorSchema(component: Component): GenericComponentEditorSchema | null {
  const schema = (component.constructor as typeof Component & { editor?: GenericComponentEditorSchema }).editor;
  return schema?.fields ? schema : null;
}

export function cloneGenericFieldValue(value: unknown): unknown {
  if (value instanceof ColorSRGB) {
    return value.clone();
  }
  if (value instanceof Int16Array || value instanceof Int32Array || value instanceof Uint16Array || value instanceof Uint32Array || value instanceof Float32Array) {
    return Array.from(value);
  }
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return structuredClone(value);
  }
  return value;
}

export function getGenericFieldValue(
  component: Component,
  field: string,
  fieldSchema = getGenericEditorSchema(component)?.fields[field],
): unknown {
  return fieldSchema?.get ? fieldSchema.get(component) : (component as unknown as Record<string, unknown>)[field];
}

export function setGenericFieldValue(
  component: Component,
  field: string,
  value: unknown,
  fieldSchema = getGenericEditorSchema(component)?.fields[field],
): void {
  if (fieldSchema?.set) {
    fieldSchema.set(component, value);
    return;
  }
  if (component instanceof Tilemap2DComponent && field === 'cells') {
    component.cells = new Int16Array(component.columns * component.rows);
    component.cells.set((Array.isArray(value) ? value : []).slice(0, component.cells.length).map(item => Math.trunc(Number(item) || 0)));
    return;
  }
  (component as unknown as Record<string, unknown>)[field] = value;
}

export function snapshotGenericComponent(component: Component, schema: GenericComponentEditorSchema): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const [field, fieldSchema] of Object.entries(schema.fields)) {
    snapshot[field] = cloneGenericFieldValue(getGenericFieldValue(component, field, fieldSchema));
  }
  return snapshot;
}

export function applyGenericComponentSnapshot(component: Component, snapshot: Record<string, unknown>, schema: GenericComponentEditorSchema): void {
  for (const [field, fieldSchema] of Object.entries(schema.fields)) {
    setGenericFieldValue(component, field, cloneGenericFieldValue(snapshot[field]), fieldSchema);
  }
  if (component instanceof Tilemap2DComponent) {
    component.resize(component.columns, component.rows);
  }
  if (component instanceof Camera2D) {
    component.resize(component.width, component.height);
  }
  if (component instanceof Camera3D) {
    component.setDirty();
  }
  if (component instanceof LightComponent) {
    component.markDirty();
  }
}

function formatGenericValue(value: unknown, field: GenericEditorFieldSchema, formatNumber: (value: number) => string): string {
  if (field.type === 'json' || field.type === 'int-array' || field.type === 'object' || field.type === 'array') {
    return JSON.stringify(cloneGenericFieldValue(value), null, 2);
  }
  if (field.type === 'vector') {
    const values = Array.from(value as ArrayLike<number> | number[] | undefined ?? []);
    return values.map(item => formatNumber(Number(item) || 0)).join(', ');
  }
  if (field.type === 'color') {
    if (value instanceof ColorSRGB) return value.toHex();
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return new ColorSRGB(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0, Number(value[3] ?? 1)).toHex();
    }
    return '#ffffff';
  }
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return String(value);
  return value == null ? '' : String(value);
}

function shouldRenderGenericField(component: Component, field: GenericEditorFieldSchema): boolean {
  return field.visibleWhen ? field.visibleWhen(component) : true;
}

function setInputValidation(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, message: string | null | undefined): boolean {
  input.setCustomValidity(message ?? '');
  if (message) {
    input.reportValidity();
    return false;
  }
  return true;
}

function validateStructuredValue(value: unknown, field: GenericEditorFieldSchema, path: string): string | null {
  if (field.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object.`;
    for (const [childName, childField] of Object.entries(field.fields ?? {})) {
      const message = validateStructuredValue((value as Record<string, unknown>)[childName], childField, `${path}.${childName}`);
      if (message) return message;
    }
    return null;
  }
  if (field.type === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array.`;
    if (field.item) {
      for (let i = 0; i < value.length; i++) {
        const message = validateStructuredValue(value[i], field.item, `${path}[${i}]`);
        if (message) return message;
      }
    }
    return null;
  }
  if (field.type === 'number') return Number.isFinite(Number(value)) ? null : `${path} must be a number.`;
  if (field.type === 'boolean') return typeof value === 'boolean' ? null : `${path} must be a boolean.`;
  if (field.type === 'string' || field.type === 'text' || field.type === 'asset-ref') return typeof value === 'string' ? null : `${path} must be a string.`;
  if (field.type === 'vector') return Array.isArray(value) || ArrayBuffer.isView(value as ArrayBufferView) ? null : `${path} must be a vector array.`;
  return null;
}

function renderGenericFieldControl(
  component: Component,
  fieldName: string,
  field: GenericEditorFieldSchema,
  formatNumber: (value: number) => string,
  onCommit: () => void,
  getAssetRefOptions?: (assetType: string) => Array<{ label: string; value: string }>,
): HTMLElement {
  if (field.type === 'custom' && field.render) {
    const element = field.render({
      component,
      fieldName,
      field,
      value: getGenericFieldValue(component, fieldName, field),
      onCommit,
      formatNumber,
    });
    element.dataset.field = fieldName;
    element.dataset.fieldType = 'custom';
    return element;
  }

  if (field.type === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.field = fieldName;
    input.checked = Boolean(getGenericFieldValue(component, fieldName, field));
    input.addEventListener('change', onCommit);
    return input;
  }

  if (field.type === 'select') {
    const select = document.createElement('select');
    select.dataset.field = fieldName;
    for (const option of field.options ?? []) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      select.append(item);
    }
    select.value = formatGenericValue(getGenericFieldValue(component, fieldName, field), field, formatNumber);
    select.addEventListener('change', onCommit);
    return select;
  }

  if (field.type === 'json' || field.type === 'int-array' || field.type === 'object' || field.type === 'array') {
    const textarea = document.createElement('textarea');
    textarea.className = 'detail-input';
    textarea.rows = field.rows ?? (field.type === 'object' || field.type === 'array' ? 8 : 6);
    textarea.dataset.field = fieldName;
    textarea.dataset.fieldType = field.type;
    textarea.value = formatGenericValue(getGenericFieldValue(component, fieldName, field), field, formatNumber);
    textarea.addEventListener('change', onCommit);
    textarea.addEventListener('blur', onCommit);
    return textarea;
  }

  const input = document.createElement('input');
  input.dataset.field = fieldName;
  input.type = field.type === 'number' ? 'number' : field.type === 'color' ? 'color' : 'text';
  let datalist: HTMLDataListElement | null = null;
  if (field.type === 'number') {
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    input.step = String(field.step ?? 0.01);
  }
  if (field.type === 'asset-ref') {
    input.dataset.fieldType = 'asset-ref';
    if (field.assetType) input.dataset.assetType = field.assetType;
    input.placeholder = field.placeholder ?? (field.assetType ? `${field.assetType} asset` : 'Asset reference');
    const options = field.assetType ? (field.options ?? getAssetRefOptions?.(field.assetType) ?? []) : field.options ?? [];
    if (options.length > 0) {
      datalist = document.createElement('datalist');
      datalist.id = `asset-ref-options-${++assetListId}`;
      for (const option of options) {
        const item = document.createElement('option');
        item.value = option.value;
        item.label = option.label;
        item.textContent = option.label;
        datalist.append(item);
      }
      input.setAttribute('list', datalist.id);
      input.dataset.optionLabels = JSON.stringify(options);
    }
    const picker = document.createElement('select');
    picker.className = 'asset-ref-picker';
    picker.title = 'Browse assets';
    picker.setAttribute('aria-label', `Browse ${field.assetType ?? 'asset'} references`);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = options.length ? 'Browse...' : 'No assets';
    placeholder.disabled = true;
    placeholder.selected = true;
    picker.append(placeholder);
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      picker.append(item);
    }
    picker.disabled = options.length === 0;
    picker.addEventListener('change', () => {
      if (!picker.value) return;
      input.value = picker.value;
      picker.value = '';
      onCommit();
    });
    const dragTypes = field.assetType ? ASSET_DRAG_MIME[field.assetType.toLowerCase()] ?? [] : [];
    if (dragTypes.length > 0) {
      input.addEventListener('dragover', (event) => {
        const types = event.dataTransfer?.types;
        if (!types || !dragTypes.some(type => types.includes(type))) return;
        event.preventDefault();
        event.dataTransfer!.dropEffect = 'copy';
      });
      input.addEventListener('drop', (event) => {
        const value = dragTypes.map(type => event.dataTransfer?.getData(type)).find(Boolean);
        if (!value) return;
        event.preventDefault();
        input.value = value;
        onCommit();
      });
    }
    input.value = formatGenericValue(getGenericFieldValue(component, fieldName, field), field, formatNumber);
    input.addEventListener('change', onCommit);
    input.addEventListener('blur', onCommit);
    const container = document.createElement('span');
    container.className = 'asset-ref-field';
    container.append(input, picker);
    if (datalist) container.append(datalist);
    return container;
  }
  input.value = formatGenericValue(getGenericFieldValue(component, fieldName, field), field, formatNumber);
  input.addEventListener('change', onCommit);
  input.addEventListener('blur', onCommit);
  return input;
}

export function renderGenericComponentEditor(options: RenderGenericComponentEditorOptions): void {
  const { component, schema, elements, formatNumber, onCommit, getAssetRefOptions } = options;
  const { section, title, fields } = elements;
  if (!section || !fields) return;
  section.hidden = false;
  if (title) title.textContent = component.constructor.name;
  fields.replaceChildren();

  let currentGroup = '';
  for (const [fieldName, field] of Object.entries(schema.fields)) {
    if (!shouldRenderGenericField(component, field)) continue;
    if ((field.group ?? '') !== currentGroup) {
      currentGroup = field.group ?? '';
      if (currentGroup) {
        const group = document.createElement('div');
        group.className = 'generic-field-group';
        group.textContent = currentGroup;
        fields.append(group);
      }
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const label = document.createElement('label');
    label.textContent = field.unit ? `${field.label ?? fieldName} (${field.unit})` : field.label ?? fieldName;
    wrapper.append(label);
    wrapper.append(renderGenericFieldControl(component, fieldName, field, formatNumber, onCommit, getAssetRefOptions));
    fields.append(wrapper);
  }
}

export function readGenericComponentInputs(
  component: Component,
  schema: GenericComponentEditorSchema,
  fields: HTMLElement | null,
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  const columnsInput = fields?.querySelector<HTMLInputElement>('[data-field="columns"]');
  const rowsInput = fields?.querySelector<HTMLInputElement>('[data-field="rows"]');
  const dynamicComponent = component as unknown as Record<string, unknown>;
  const expectedLength = Math.max(1, Math.floor(Number(columnsInput?.value ?? dynamicComponent.columns ?? 1)))
    * Math.max(1, Math.floor(Number(rowsInput?.value ?? dynamicComponent.rows ?? 1)));

  for (const [fieldName, field] of Object.entries(schema.fields)) {
    if (!shouldRenderGenericField(component, field)) {
      result[fieldName] = getGenericFieldValue(component, fieldName, field);
      continue;
    }
    const input = fields?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement>(`[data-field="${fieldName}"]`);
    if (!input) {
      result[fieldName] = getGenericFieldValue(component, fieldName, field);
      continue;
    }
    if (field.type === 'custom') {
      result[fieldName] = field.readValue ? field.readValue(input, component) : getGenericFieldValue(component, fieldName, field);
      if (!setInputValidation(input as HTMLInputElement, field.validate?.(result[fieldName], component))) return null;
      continue;
    }
    if (field.type === 'number') {
      let value = Number((input as HTMLInputElement).value);
      if (!Number.isFinite(value)) value = Number(getGenericFieldValue(component, fieldName, field) ?? 0);
      if (field.min !== undefined) value = Math.max(field.min, value);
      if (field.max !== undefined) value = Math.min(field.max, value);
      if ((field.step ?? 0) >= 1) value = Math.floor(value);
      result[fieldName] = value;
      if (!setInputValidation(input as HTMLInputElement, field.validate?.(value, component))) return null;
      continue;
    }
    if (field.type === 'boolean') {
      result[fieldName] = Boolean((input as HTMLInputElement).checked);
      if (!setInputValidation(input as HTMLInputElement, field.validate?.(result[fieldName], component))) return null;
      continue;
    }
    if (field.type === 'select') {
      result[fieldName] = (input as HTMLSelectElement).value;
      if (!setInputValidation(input as HTMLSelectElement, field.validate?.(result[fieldName], component))) return null;
      continue;
    }
    if (field.type === 'color') {
      result[fieldName] = ColorSRGB.fromHex((input as HTMLInputElement).value);
      if (!setInputValidation(input as HTMLInputElement, field.validate?.(result[fieldName], component))) return null;
      continue;
    }
    if (field.type === 'vector') {
      const expectedSize = field.size ?? 3;
      const values = (input as HTMLInputElement).value.split(/[\s,]+/).filter(Boolean).map(item => Number(item));
      const vector = new Array(expectedSize).fill(0);
      const current = getGenericFieldValue(component, fieldName, field) as ArrayLike<number> | undefined;
      for (let i = 0; i < expectedSize; i++) {
        const value = values[i] ?? current?.[i] ?? 0;
        vector[i] = Number.isFinite(value) ? value : 0;
      }
      result[fieldName] = vector;
      if (!setInputValidation(input as HTMLInputElement, field.validate?.(vector, component))) return null;
      continue;
    }
    if (field.type === 'json' || field.type === 'int-array' || field.type === 'object' || field.type === 'array') {
      try {
        const value = JSON.parse((input as HTMLTextAreaElement).value || (field.type === 'int-array' || field.type === 'array' ? '[]' : 'null'));
        if (field.type === 'int-array') {
          if (!Array.isArray(value)) throw new Error(`${field.label ?? fieldName} must be an array.`);
          const cells = new Array(expectedLength).fill(0);
          for (let i = 0; i < Math.min(value.length, expectedLength); i++) {
            const item = Number(value[i] ?? 0);
            cells[i] = Number.isFinite(item) ? Math.trunc(item) : 0;
          }
          result[fieldName] = cells;
        } else if (field.type === 'array') {
          const message = validateStructuredValue(value, field, field.label ?? fieldName);
          if (message) throw new Error(message);
          result[fieldName] = value;
        } else if (field.type === 'object') {
          const message = validateStructuredValue(value, field, field.label ?? fieldName);
          if (message) throw new Error(message);
          result[fieldName] = value;
        } else {
          result[fieldName] = value;
        }
        if (!setInputValidation(input as HTMLTextAreaElement, field.validate?.(result[fieldName], component))) return null;
      } catch (error) {
        setInputValidation(input as HTMLTextAreaElement, error instanceof Error ? error.message : 'Invalid JSON');
        return null;
      }
      continue;
    }
    result[fieldName] = (input as HTMLInputElement).value;
    if (!setInputValidation(input as HTMLInputElement, field.validate?.(result[fieldName], component))) return null;
  }
  return result;
}
