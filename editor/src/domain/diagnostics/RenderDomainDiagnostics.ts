export const EDITOR_RENDER_DIAGNOSTICS_SCHEMA = 'haiyue-editor-render-diagnostics@1' as const;

export interface RenderDomainDiagnosticsSnapshot {
  readonly schema: typeof EDITOR_RENDER_DIAGNOSTICS_SCHEMA;
  readonly lighting: Readonly<{
    total: number;
    active: number;
    capacity: number;
    clipped: number;
    byType: Readonly<Record<string, number>>;
  }>;
  readonly shadows: Readonly<{
    requestedCasters: number;
    activeCasters: number;
    capacity: number;
    clipped: number;
    passCount: number;
    gpuMs?: number;
    resourceCount: number;
    estimatedBytes: number;
  }>;
  readonly ambientOcclusion: Readonly<{
    active: boolean;
    algorithms: readonly string[];
    passCount: number;
    gpuMs?: number;
    resourceCount: number;
    estimatedBytes: number;
  }>;
  readonly shaderVariants: Readonly<{
    livePipelines: number;
    cacheEntries: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
    frameSwitches: number;
  }>;
  readonly gpuResources: Readonly<{
    total: number;
    estimatedBytes: number;
    releasedOwnerResiduals: number;
    byType: Readonly<Record<string, Readonly<{ count: number; bytes: number; peak: number }>>>;
    topOwners: readonly Readonly<{ label: string; kind: string; resources: number; estimatedBytes: number }>[];
  }>;
}

export interface RenderDomainDiagnosticInput {
  readonly components?: Iterable<Readonly<{
    lightType?: unknown;
    castShadow?: unknown;
    disabled?: unknown;
    destroyed?: unknown;
    entityDisabled?: unknown;
  }>>;
  readonly frame?: Readonly<{
    counters?: Readonly<Record<string, number>>;
    gpu?: Readonly<{ passes?: readonly Readonly<{ label?: string; durationMs?: number }>[] }> | undefined;
  }>;
  readonly pipeline?: Readonly<{
    entries?: readonly Readonly<{ system?: string; passKey?: string; target?: string }>[];
  }>;
  readonly resources?: Readonly<{
    resources?: readonly Readonly<{ label?: string; type?: string; estimatedBytes?: number }>[];
    byType?: Readonly<Record<string, Readonly<{ current?: number; estimatedBytes?: number; peak?: number }> | undefined>>;
    owners?: readonly Readonly<{
      owner?: Readonly<{ label?: string; kind?: string }>;
      resources?: number;
      usage?: Readonly<{ estimatedBytes?: number }>;
    }>[];
    caches?: readonly Readonly<{ label?: string; entries?: number; hits?: number; misses?: number }>[];
    releasedOwnerResiduals?: number;
  }>;
  readonly lightCapacity?: number;
  readonly directionalShadowCapacity?: number;
}

/** Converts existing engine probes into a stable, editor-facing diagnostic schema. */
export function deriveRenderDomainDiagnostics(input: RenderDomainDiagnosticInput): RenderDomainDiagnosticsSnapshot {
  const byLightType: Record<string, number> = {};
  let totalLights = 0;
  let activeLights = 0;
  let requestedShadowCasters = 0;
  for (const component of input.components ?? []) {
    if (typeof component.lightType !== 'string') continue;
    totalLights++;
    byLightType[component.lightType] = (byLightType[component.lightType] ?? 0) + 1;
    const active = component.disabled !== true && component.destroyed !== true && component.entityDisabled !== true;
    if (active) activeLights++;
    if (active && component.lightType === 'directional' && component.castShadow === true) requestedShadowCasters++;
  }
  const lightCapacity = positiveInteger(input.lightCapacity, 8);
  const shadowCapacity = positiveInteger(input.directionalShadowCapacity, 3);
  const resources = input.resources?.resources ?? [];
  const gpuPasses = input.frame?.gpu?.passes ?? [];
  const pipelineEntries = input.pipeline?.entries ?? [];
  const shadowResources = resources.filter(item => matches(item.label, /shadow/i));
  const aoResources = resources.filter(item => matches(item.label, /(?:gtao|ssao|sao|ambient.?occlusion|occlusion)/i));
  const shadowGpuPasses = gpuPasses.filter(item => matches(item.label, /shadow/i));
  const aoGpuPasses = gpuPasses.filter(item => matches(item.label, /(?:gtao|ssao|sao|ambient.?occlusion|occlusion)/i));
  const shadowGpuMs = sumOptional(shadowGpuPasses, item => item.durationMs);
  const aoGpuMs = sumOptional(aoGpuPasses, item => item.durationMs);
  const aoEntryNames = pipelineEntries.flatMap(entry => [entry.system, entry.passKey, entry.target]).filter(isString);
  const aoNames = [...gpuPasses.map(pass => pass.label).filter(isString), ...aoEntryNames]
    .filter(name => /(?:gtao|ssao|sao)/i.test(name));
  const algorithms = [...new Set(aoNames.flatMap(name => name.toLowerCase().match(/gtao|ssao|sao/g) ?? []))].sort();
  const caches = input.resources?.caches ?? [];
  const shaderCaches = caches.filter(cache => matches(cache.label, /shader|pipeline|variant/i));
  const selectedCaches = shaderCaches.length > 0 ? shaderCaches : caches;
  const cacheEntries = sum(selectedCaches, item => item.entries);
  const cacheHits = sum(selectedCaches, item => item.hits);
  const cacheMisses = sum(selectedCaches, item => item.misses);
  const byType: Record<string, Readonly<{ count: number; bytes: number; peak: number }>> = {};
  for (const [type, stats] of Object.entries(input.resources?.byType ?? {})) {
    if (!stats) continue;
    byType[type] = Object.freeze({
      count: finite(stats.current),
      bytes: finite(stats.estimatedBytes),
      peak: finite(stats.peak),
    });
  }
  const topOwners = (input.resources?.owners ?? []).map(owner => Object.freeze({
    label: owner.owner?.label ?? 'unknown',
    kind: owner.owner?.kind ?? 'unknown',
    resources: finite(owner.resources),
    estimatedBytes: finite(owner.usage?.estimatedBytes),
  })).sort((left, right) => right.estimatedBytes - left.estimatedBytes || right.resources - left.resources).slice(0, 5);

  return Object.freeze({
    schema: EDITOR_RENDER_DIAGNOSTICS_SCHEMA,
    lighting: Object.freeze({
      total: totalLights,
      active: activeLights,
      capacity: lightCapacity,
      clipped: Math.max(0, activeLights - lightCapacity),
      byType: Object.freeze(byLightType),
    }),
    shadows: Object.freeze({
      requestedCasters: requestedShadowCasters,
      activeCasters: Math.min(requestedShadowCasters, shadowCapacity),
      capacity: shadowCapacity,
      clipped: Math.max(0, requestedShadowCasters - shadowCapacity),
      passCount: shadowGpuPasses.length,
      ...(shadowGpuMs === undefined ? {} : { gpuMs: shadowGpuMs }),
      resourceCount: shadowResources.length,
      estimatedBytes: sum(shadowResources, item => item.estimatedBytes),
    }),
    ambientOcclusion: Object.freeze({
      active: algorithms.length > 0 || aoGpuPasses.length > 0 || aoResources.length > 0,
      algorithms: Object.freeze(algorithms),
      passCount: aoGpuPasses.length,
      ...(aoGpuMs === undefined ? {} : { gpuMs: aoGpuMs }),
      resourceCount: aoResources.length,
      estimatedBytes: sum(aoResources, item => item.estimatedBytes),
    }),
    shaderVariants: Object.freeze({
      livePipelines: finite(input.resources?.byType?.['render-pipeline']?.current) + finite(input.resources?.byType?.['compute-pipeline']?.current),
      cacheEntries,
      cacheHits,
      cacheMisses,
      cacheHitRate: cacheHits + cacheMisses === 0 ? 0 : cacheHits / (cacheHits + cacheMisses),
      frameSwitches: finite(input.frame?.counters?.pipelineSwitches),
    }),
    gpuResources: Object.freeze({
      total: Object.values(byType).reduce((total, item) => total + item.count, 0),
      estimatedBytes: Object.values(byType).reduce((total, item) => total + item.bytes, 0),
      releasedOwnerResiduals: finite(input.resources?.releasedOwnerResiduals),
      byType: Object.freeze(byType),
      topOwners: Object.freeze(topOwners),
    }),
  });
}

function matches(value: unknown, pattern: RegExp): boolean {
  return typeof value === 'string' && pattern.test(value);
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sum<T>(values: readonly T[], select: (value: T) => unknown): number {
  return values.reduce((total, value) => total + finite(select(value)), 0);
}

function sumOptional<T>(values: readonly T[], select: (value: T) => unknown): number | undefined {
  return values.some(value => typeof select(value) === 'number') ? sum(values, select) : undefined;
}
