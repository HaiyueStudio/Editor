import {
  MAX_SCENE_AXIS,
  packVoxelKey,
  voxelKey,
  type PackedVoxelKey,
  type PbrPaletteMaterial,
  type Voxel,
} from './VoxelDocumentContract';

/** Read-only string-key adapter kept at the editor/API boundary over packed storage. */
export class StringKeyVoxelMapView<T extends Voxel> implements ReadonlyMap<string, T> {
  constructor(private readonly _source: ReadonlyMap<PackedVoxelKey, T>) {}

  get size(): number { return this._source.size; }

  get(key: string): T | undefined {
    const packed = packedVoxelKeyFromString(key);
    return packed === null ? undefined : this._source.get(packed);
  }

  has(key: string): boolean { return this.get(key) !== undefined; }

  *entries(): MapIterator<[string, T]> {
    for (const voxel of this._source.values()) {
      yield [voxelKey(voxel.x, voxel.y, voxel.z), voxel];
    }
  }

  *keys(): MapIterator<string> {
    for (const voxel of this._source.values()) yield voxelKey(voxel.x, voxel.y, voxel.z);
  }

  values(): MapIterator<T> { return this._source.values(); }

  forEach(
    callbackfn: (value: T, key: string, map: ReadonlyMap<string, T>) => void,
    thisArg?: unknown,
  ): void {
    for (const voxel of this._source.values()) {
      callbackfn.call(thisArg, voxel, voxelKey(voxel.x, voxel.y, voxel.z), this);
    }
  }

  [Symbol.iterator](): MapIterator<[string, T]> { return this.entries(); }
}

export function normalizeVoxelAxis(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_SCENE_AXIS, Math.round(value)));
}

export function normalizeVoxelUnit(value: number, fallback: number, minimum = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(1, value));
}

export function isVoxelRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseVoxMaterialExtension(
  value: Record<string, unknown>,
): NonNullable<PbrPaletteMaterial['vox']> {
  const rawType = String(value.type ?? 'unknown');
  const type = new Set(['diffuse', 'metal', 'glass', 'emit', 'media']).has(rawType)
    ? rawType as NonNullable<PbrPaletteMaterial['vox']>['type']
    : 'unknown';
  const rawProperties = isVoxelRecord(value.properties) ? value.properties : {};
  const properties = Object.fromEntries(
    Object.entries(rawProperties).map(([key, item]) => [key, String(item)]),
  );
  return {
    type,
    properties,
    compatibility: type === 'diffuse' || type === 'metal' ? 'full' : 'partial',
  };
}

export function cloneVoxMaterialExtension(
  value: NonNullable<PbrPaletteMaterial['vox']>,
): NonNullable<PbrPaletteMaterial['vox']> {
  return { ...value, properties: { ...value.properties } };
}

function packedVoxelKeyFromString(key: string): PackedVoxelKey | null {
  const match = /^(\d+),(\d+),(\d+)$/.exec(key);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  const z = Number(match[3]);
  return x <= 255 && y <= 255 && z <= 255 ? packVoxelKey(x, y, z) : null;
}
