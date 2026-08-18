import { flattenAuthoringPath, pathGeometryFingerprint } from '../../domain/PathCommandAuthoring';
import {
  MAX_PATH_FLATTENED_POINTS,
  PathAuthoringError,
  type AuthoringPath,
  type FlattenedPath,
  type PathGeometryCacheMetrics,
} from '../../domain/PathAuthoringTypes';

export interface PathGeometryCacheOptions {
  readonly maxEntries?: number;
  readonly maxFlattenedPoints?: number;
}

interface Entry { readonly flattened: FlattenedPath; readonly points: number }

/** Bounded LRU keyed only by geometry and tolerance; zoom/pan/style never cause a rebuild. */
export class PathGeometryCache {
  private readonly _entries = new Map<string, Entry>();
  private readonly _maxEntries: number;
  private readonly _maxPoints: number;
  private _hits = 0;
  private _misses = 0;
  private _rebuilds = 0;
  private _evictions = 0;
  private _points = 0;
  private _peakEntries = 0;
  private _peakPoints = 0;

  constructor(options: PathGeometryCacheOptions = {}) {
    this._maxEntries = positiveInteger(options.maxEntries ?? 64, 'maxEntries');
    this._maxPoints = positiveInteger(options.maxFlattenedPoints ?? MAX_PATH_FLATTENED_POINTS * 4, 'maxFlattenedPoints');
  }

  get(path: AuthoringPath, tolerance = 0.35): FlattenedPath {
    const key = `${path.id}@${path.geometryVersion}@${pathGeometryFingerprint(path)}@${normalizeTolerance(tolerance)}`;
    const cached = this._entries.get(key);
    if (cached) {
      this._entries.delete(key); this._entries.set(key, cached); this._hits++;
      return cached.flattened;
    }
    this._misses++; this._rebuilds++;
    const flattened = flattenAuthoringPath(path, tolerance);
    if (flattened.pointCount > this._maxPoints) throw new PathAuthoringError(
      'E_PATH_CACHE_BUDGET', '$.pathCache.flattenedPoints',
      `Flattened path requires ${flattened.pointCount} points; cache budget is ${this._maxPoints}.`,
      { actual: flattened.pointCount, limit: this._maxPoints },
    );
    const entry = { flattened, points: flattened.pointCount };
    this._entries.set(key, entry); this._points += entry.points;
    this._evict();
    this._peakEntries = Math.max(this._peakEntries, this._entries.size);
    this._peakPoints = Math.max(this._peakPoints, this._points);
    return flattened;
  }

  clear(): void { this._entries.clear(); this._points = 0; }

  get metrics(): PathGeometryCacheMetrics {
    return Object.freeze({
      hits: this._hits, misses: this._misses, rebuilds: this._rebuilds, evictions: this._evictions,
      entries: this._entries.size, flattenedPoints: this._points,
      peakEntries: this._peakEntries, peakFlattenedPoints: this._peakPoints,
    });
  }

  private _evict(): void {
    while (this._entries.size > this._maxEntries || this._points > this._maxPoints) {
      const oldest = this._entries.entries().next().value as [string, Entry] | undefined;
      if (!oldest) break;
      this._entries.delete(oldest[0]); this._points -= oldest[1].points; this._evictions++;
    }
  }
}

function normalizeTolerance(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new PathAuthoringError(
    'E_PATH_CACHE_BUDGET', '$.pathCache.tolerance', 'Path cache tolerance must be positive and finite.',
  );
  return value.toPrecision(12);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new PathAuthoringError(
    'E_PATH_CACHE_BUDGET', `$.pathCache.${field}`, `${field} must be a positive integer.`,
  );
  return value;
}
