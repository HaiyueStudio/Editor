import type { PrefabVariantOverride } from '../types';
import type { SerializedEntity } from '../export/RuntimeSceneContract';

/** Pure prefab-variant operations; ResourcePool owns persistence and reference counts. */
export function cloneSerializedEntity(entity: SerializedEntity): SerializedEntity {
  return {
    name: entity.name,
    disabled: entity.disabled,
    components: entity.components.map(component => structuredClone(component)),
    children: entity.children.map(cloneSerializedEntity),
  };
}

export function cloneVariantOverrides(overrides: PrefabVariantOverride[]): PrefabVariantOverride[] {
  return overrides.map(cloneVariantOverride);
}

export function cloneVariantOverride(override: PrefabVariantOverride): PrefabVariantOverride {
  const cloned: PrefabVariantOverride = { path: [...override.path] };
  if (override.name !== undefined) cloned.name = override.name;
  if (override.disabled !== undefined) cloned.disabled = override.disabled;
  if (override.components !== undefined) cloned.components = override.components.map(component => structuredClone(component));
  if (override.children !== undefined) cloned.children = override.children.map(cloneSerializedEntity);
  return cloned;
}

export function applyVariantOverrides(base: SerializedEntity, overrides: PrefabVariantOverride[]): SerializedEntity {
  const root = cloneSerializedEntity(base);
  for (const override of overrides) {
    const target = getSerializedEntityAtPath(root, override.path);
    if (!target) continue;
    if (override.name !== undefined) target.name = override.name;
    if (override.disabled !== undefined) target.disabled = override.disabled;
    if (override.components) target.components = override.components.map(component => structuredClone(component));
    if (override.children) target.children = override.children.map(cloneSerializedEntity);
  }
  return root;
}

export function diffSerializedEntity(
  base: SerializedEntity,
  variant: SerializedEntity,
  path: number[] = [],
): PrefabVariantOverride[] {
  const overrides: PrefabVariantOverride[] = [];
  const override: PrefabVariantOverride = { path };
  if (base.name !== variant.name) override.name = variant.name;
  if (base.disabled !== variant.disabled) override.disabled = variant.disabled;
  if (!jsonEqual(base.components, variant.components)) {
    override.components = variant.components.map(component => structuredClone(component));
  }
  if (base.children.length !== variant.children.length) {
    override.children = variant.children.map(cloneSerializedEntity);
  }
  if (hasVariantOverridePayload(override)) overrides.push(override);
  if (override.children === undefined) {
    for (let i = 0; i < base.children.length; i++) {
      const baseChild = base.children[i];
      const variantChild = variant.children[i];
      if (baseChild && variantChild) overrides.push(...diffSerializedEntity(baseChild, variantChild, [...path, i]));
    }
  }
  return overrides;
}

export function hasVariantOverridePayload(override: PrefabVariantOverride): boolean {
  return override.name !== undefined
    || override.disabled !== undefined
    || override.components !== undefined
    || override.children !== undefined;
}

export function getVariantOverrideFields(override: PrefabVariantOverride): string[] {
  const fields: string[] = [];
  if (override.name !== undefined) fields.push('name');
  if (override.disabled !== undefined) fields.push('disabled');
  if (override.components !== undefined) fields.push('components');
  if (override.children !== undefined) fields.push('children');
  return fields;
}

export function clearVariantOverrideField(override: PrefabVariantOverride, field: string): void {
  if (field === 'name') delete override.name;
  if (field === 'disabled') delete override.disabled;
  if (field === 'components') delete override.components;
  if (field === 'children') delete override.children;
}

export function pathsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function getPrefabAssetKey(prefabId: number): string {
  return `editor:prefab:${prefabId}`;
}

function getSerializedEntityAtPath(root: SerializedEntity, path: readonly number[]): SerializedEntity | null {
  let current: SerializedEntity = root;
  for (const index of path) {
    const child = current.children[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
