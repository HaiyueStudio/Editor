import type { EditorComponentDescriptor } from '../../types';

export type OptionalEditorCapability = 'gltf' | 'spine' | 'tilemap' | 'tween';

export interface OptionalComponentManifestEntry {
  readonly id: OptionalEditorCapability;
  readonly componentTypes: readonly string[];
}

export const OPTIONAL_COMPONENT_MANIFEST: readonly OptionalComponentManifestEntry[] = Object.freeze([
  Object.freeze({ id: 'gltf', componentTypes: Object.freeze(['GltfModelComponent']) }),
  Object.freeze({ id: 'spine', componentTypes: Object.freeze(['Spine2DComponent']) }),
  Object.freeze({ id: 'tilemap', componentTypes: Object.freeze(['Tilemap2DComponent']) }),
  Object.freeze({ id: 'tween', componentTypes: Object.freeze(['Tween2DComponent']) }),
]);

const capabilityByComponentType = new Map<string, OptionalEditorCapability>();
for (const entry of OPTIONAL_COMPONENT_MANIFEST) {
  for (const type of entry.componentTypes) capabilityByComponentType.set(type, entry.id);
}

/**
 * Keeps optional component names visible in Add Component without evaluating
 * their constructors or render systems. The real contribution replaces the
 * null factory before the add command is dispatched.
 */
export function createOptionalComponentDescriptors(): EditorComponentDescriptor[] {
  return OPTIONAL_COMPONENT_MANIFEST.flatMap(entry => entry.componentTypes.map(name => ({
    name,
    create: () => null,
  })));
}

export function getOptionalCapabilityForComponentType(
  componentType: string,
): OptionalEditorCapability | null {
  return capabilityByComponentType.get(componentType) ?? null;
}

/**
 * Serialized projects are plain JSON trees. Inspecting their `type` fields is
 * enough to activate deserializers before the project payload is committed.
 */
export function collectOptionalCapabilitiesForProject(
  project: unknown,
): OptionalEditorCapability[] {
  const required = new Set<OptionalEditorCapability>();
  const pending: unknown[] = [project];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;
    const resources = record.resources;
    if (typeof resources === 'object' && resources !== null) {
      const models = (resources as Record<string, unknown>).models;
      if (Array.isArray(models) && models.length > 0) required.add('gltf');
    }
    if (typeof record.type === 'string') {
      const capability = getOptionalCapabilityForComponentType(record.type);
      if (capability) required.add(capability);
    }
    for (const child of Object.values(record)) pending.push(child);
  }
  return OPTIONAL_COMPONENT_MANIFEST
    .map(entry => entry.id)
    .filter(capability => required.has(capability));
}
