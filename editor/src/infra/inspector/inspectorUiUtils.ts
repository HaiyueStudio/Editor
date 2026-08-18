import type { GEDropdownItem, GESelectOption } from '@haiyue/ui';
import type { Entity } from '@haiyue/engine';
import type { EditorComponentDescriptor } from '../../types';

export function getComponentOptions(entity: Entity): GESelectOption[] {
  const options: GESelectOption[] = [];
  for (const component of entity.components.values()) {
    const value = component.constructor.name;
    options.push({ label: value, value });
  }
  return options;
}

export function getAddComponentDropdownItems(descriptors: readonly EditorComponentDescriptor[]): GEDropdownItem[] {
  return descriptors.map(item => ({ label: item.name, value: item.name }));
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function setButtonDisabled(button: HTMLElement | null, disabled: boolean): void {
  if (!button) return;
  if (disabled) button.setAttribute('disabled', '');
  else button.removeAttribute('disabled');
}
