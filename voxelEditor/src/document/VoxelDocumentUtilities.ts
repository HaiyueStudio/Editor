import { DEFAULT_LAYER_ID, type VoxelLayer } from './VoxelDocumentContract';

export function replaceMap<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

export function numericIdSuffix(id: string, prefix: string): number {
  if (!id.startsWith(prefix)) return 0;
  const value = Number(id.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function normalizedVoxelLayerId(
  layerId: string | null | undefined,
  layers: ReadonlyMap<string, VoxelLayer>,
): string {
  return layerId && layers.has(layerId) ? layerId : DEFAULT_LAYER_ID;
}
