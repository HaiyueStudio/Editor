import type { BasicMaterial, PbrMaterial } from '@haiyue/engine';
import type { MaterialTextureSource } from '@haiyue/engine/material';
import type { ScriptResource } from '@haiyue/engine/components';
import type { ResourcePool } from '../../resources/ResourcePool';
import type {
  ModelResourceItem,
  PrefabResourceItem,
  PrefabVariantOverride,
} from '../../types';
import type { ResourceSelectionState } from './resourceRenderer';

export interface ResourceDetailElements {
  entityInspectorPanel: HTMLElement | null;
  resourceDetail: HTMLElement | null;
  resourceDetailTitle: HTMLElement | null;
  resourceDetailGrid: HTMLElement | null;
}

export interface ResourceDetailDeps {
  elements: ResourceDetailElements;
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  formatNumber: (value: number) => string;
  renderResourcePool: () => void;
  setSelection: (state: ResourceSelectionState, activeScriptResource: ScriptResource | null) => void;
  updateSelectionStates: () => void;
  enrichModelResource: (item: ModelResourceItem) => Promise<void>;
  instantiateModel: (item: ModelResourceItem) => void;
  createPrefabFromModel: (item: ModelResourceItem) => void;
  createPrefabVariant: (item: PrefabResourceItem) => void;
  rebasePrefabVariant: (item: PrefabResourceItem) => void;
  capturePrefabVariantOverrides: (item: PrefabResourceItem) => void;
  updatePrefabVariantOverride: (item: PrefabResourceItem, index: number, override: PrefabVariantOverride) => void;
  resolvePrefabVariantFieldConflict: (
    item: PrefabResourceItem,
    path: number[],
    field: string,
    resolution: 'accept-base' | 'keep-override',
  ) => void;
  syncPrefabInstances: (item: PrefabResourceItem) => void;
  syncSelectedPrefabInstances: (item: PrefabResourceItem) => void;
  editMaterialTexture: (material: BasicMaterial, texture: MaterialTextureSource) => void;
  editPbrMaterial: (
    material: PbrMaterial,
    label: string,
    execute: () => void,
    undo: () => void,
  ) => void;
  refreshSceneTree: () => void;
}

export function selectResource(
  deps: ResourceDetailDeps,
  selection: Partial<ResourceSelectionState>,
  activeScriptResource: ScriptResource | null = null,
): void {
  deps.setSelection({
    selectedGeometryId: null,
    selectedGeometry2DId: null,
    selectedMaterialId: null,
    selectedMaterial2DId: null,
    selectedTextureId: null,
    selectedModelId: null,
    selectedPrefabId: null,
    activeScriptResourceId: null,
    ...selection,
  }, activeScriptResource);
  deps.updateSelectionStates();
}

export function prepareDetailPanel(deps: ResourceDetailDeps, title: string): void {
  const { entityInspectorPanel, resourceDetail, resourceDetailTitle, resourceDetailGrid } = deps.elements;
  if (entityInspectorPanel) entityInspectorPanel.hidden = true;
  if (resourceDetail) resourceDetail.hidden = false;
  if (resourceDetailTitle) resourceDetailTitle.textContent = title;
  resourceDetailGrid?.replaceChildren();
}

export function addDetailRow(deps: ResourceDetailDeps, label: string, value: string | number): void {
  const { resourceDetailGrid } = deps.elements;
  if (!resourceDetailGrid) return;
  const row = document.createElement('div');
  const labelEl = document.createElement('div');
  const valueEl = document.createElement('div');
  row.className = 'detail-row';
  labelEl.className = 'detail-label';
  valueEl.className = 'detail-value';
  labelEl.textContent = label;
  valueEl.textContent = String(value);
  row.append(labelEl, valueEl);
  resourceDetailGrid.append(row);
}

export function addDetailControl(deps: ResourceDetailDeps, label: string, control: HTMLElement): void {
  const { resourceDetailGrid } = deps.elements;
  if (!resourceDetailGrid) return;
  const row = document.createElement('div');
  const labelEl = document.createElement('div');
  row.className = 'detail-row';
  labelEl.className = 'detail-label';
  labelEl.textContent = label;
  row.append(labelEl, control);
  resourceDetailGrid.append(row);
}

export function createDetailSelect<T extends string>(
  value: T | '',
  options: Array<{ label: string; value: T | '' }>,
  onChange: (value: T | '') => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'detail-select';
  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value as T | ''));
  return select;
}

export function setDetailTitle(deps: ResourceDetailDeps, title: string): void {
  if (deps.elements.resourceDetailTitle) deps.elements.resourceDetailTitle.textContent = title;
}

export function createNameInput(
  value: string,
  onRename: (name: string) => string | void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'detail-input';
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => {
    const nextName = onRename(input.value.trim());
    if (typeof nextName === 'string') input.value = nextName;
  });
  return input;
}
