import type { AssetId } from '../types';
import type { ResourceKind } from './ResourceChangeJournal';

/** Resource ids referenced by one entity or serialized prefab tree. */
export interface EntityResourceUsage {
  geometries: Set<number>;
  geometries2D: Set<number>;
  materials: Set<number>;
  materials2D: Set<number>;
  textures: Set<number>;
  models: Set<number>;
  prefabs: Set<number>;
  scripts: Set<number>;
}

export function createEmptyEntityResourceUsage(): EntityResourceUsage {
  return {
    geometries: new Set(),
    geometries2D: new Set(),
    materials: new Set(),
    materials2D: new Set(),
    textures: new Set(),
    models: new Set(),
    prefabs: new Set(),
    scripts: new Set(),
  };
}

export function addAssetIdToUsage(usage: EntityResourceUsage, assetId: AssetId): void {
  const separator = assetId.lastIndexOf(':');
  if (separator <= 0) return;
  const kind = assetId.slice(0, separator) as ResourceKind;
  const id = Number(assetId.slice(separator + 1));
  if (!Number.isSafeInteger(id)) return;
  if (kind === 'geometry3d') usage.geometries.add(id);
  else if (kind === 'geometry2d') usage.geometries2D.add(id);
  else if (kind === 'material3d') usage.materials.add(id);
  else if (kind === 'material2d') usage.materials2D.add(id);
  else if (kind === 'texture') usage.textures.add(id);
  else if (kind === 'model') usage.models.add(id);
  else if (kind === 'prefab') usage.prefabs.add(id);
  else if (kind === 'script') usage.scripts.add(id);
}
