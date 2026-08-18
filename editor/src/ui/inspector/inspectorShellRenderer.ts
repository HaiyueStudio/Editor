import type { Entity } from '@haiyue/engine';
import type { GESelectOption } from '@haiyue/ui';
import { t } from '../../infra/options/editorOptions';

interface SelectLikeElement extends HTMLElement {
  options: GESelectOption[];
  value: string;
  disabled: boolean;
}

export interface InspectorShellElements {
  entityInspectorPanel: HTMLElement | null;
  resourceDetail: HTMLElement | null;
  resourceDetailGrid: HTMLElement | null;
  inspectorEmpty: HTMLElement | null;
  inspectorForm: HTMLElement | null;
  entityNameInput: HTMLInputElement | null;
  entityIdValue: HTMLElement | null;
  selectedComponents: SelectLikeElement | null;
  addComponentDropdown: { items: unknown[] } | null;
  removeComponentButton: HTMLButtonElement | null;
}

export interface InspectorShellRenderOptions {
  entity: Entity | null;
  selectionCount: number;
  selectedComponentName: string;
  componentOptions: GESelectOption[];
  addComponentItems: unknown[];
  clearResourceSelection: () => void;
  clearActiveScriptResource: () => void;
  updateAllResourceSelectionStates: () => void;
  setSelectedComponentName: (name: string) => void;
}

export interface InspectorShellRenderResult {
  canRenderEntity: boolean;
  multi: boolean;
  selectedComponentName: string;
}

export function renderInspectorShell(
  elements: InspectorShellElements,
  options: InspectorShellRenderOptions,
): InspectorShellRenderResult {
  const { entity, selectionCount } = options;
  options.clearResourceSelection();
  options.clearActiveScriptResource();
  options.updateAllResourceSelectionStates();

  if (elements.entityInspectorPanel) elements.entityInspectorPanel.hidden = false;
  if (elements.resourceDetail) elements.resourceDetail.hidden = true;
  elements.resourceDetailGrid?.replaceChildren();

  const hasEntity = Boolean(entity);
  if (elements.inspectorEmpty) {
    elements.inspectorEmpty.hidden = hasEntity;
    elements.inspectorEmpty.textContent = selectionCount > 1 ? t('inspector.multiSelected', { count: selectionCount }) : t('inspector.empty');
  }
  if (elements.inspectorForm) elements.inspectorForm.hidden = !hasEntity;
  if (!entity) {
    return { canRenderEntity: false, multi: false, selectedComponentName: options.selectedComponentName };
  }

  const multi = selectionCount > 1;
  if (elements.entityNameInput) {
    elements.entityNameInput.value = multi ? '' : entity.name;
    elements.entityNameInput.placeholder = multi ? t('inspector.mixed') : '';
    elements.entityNameInput.disabled = multi;
  }
  if (elements.entityIdValue) elements.entityIdValue.textContent = multi ? `${selectionCount} selected` : String(entity.id);

  let selectedComponentName = options.selectedComponentName;
  if (elements.selectedComponents) {
    elements.selectedComponents.options = options.componentOptions.length
      ? options.componentOptions
      : [{ label: t('inspector.noComponents'), value: '', disabled: true }];
    if (!options.componentOptions.some(item => item.value === selectedComponentName)) {
      selectedComponentName = options.componentOptions[0]?.value ?? '';
      options.setSelectedComponentName(selectedComponentName);
    }
    elements.selectedComponents.value = selectedComponentName;
    elements.selectedComponents.disabled = options.componentOptions.length === 0;
  }
  if (elements.addComponentDropdown) elements.addComponentDropdown.items = options.addComponentItems;
  if (elements.removeComponentButton) {
    elements.removeComponentButton.disabled = multi || options.componentOptions.length === 0 || !selectedComponentName;
  }

  return { canRenderEntity: true, multi, selectedComponentName };
}
