import type { GltfCompatibilityReport } from '@haiyue/extensions/gltf';

export interface ModelCompatibilityPresentation {
  readonly status: GltfCompatibilityReport['status'];
  readonly extensions: string;
  readonly mipmaps: string;
  readonly bounds: string;
  readonly uvSemantics: string;
  readonly performance: string;
  readonly issues: readonly string[];
}

export interface ModelCompatibilityValidationFailure {
  readonly path: string;
  readonly message: string;
}

export function findModelCompatibilityReportError(
  value: unknown,
  path = 'compatibilityReport',
): ModelCompatibilityValidationFailure | null {
  if (!isRecord(value)) return failure(path, `${path} must be an object.`);
  if (value.status !== 'compatible' && value.status !== 'degraded') return failure(`${path}.status`, `${path}.status is invalid.`);
  const extensions = value.extensions;
  const textures = value.textures;
  const bounds = value.bounds;
  const uvSemantics = value.uvSemantics;
  const performance = value.performance;
  const issues = value.issues;
  if (!Array.isArray(extensions)) return failure(`${path}.extensions`, `${path}.extensions must be an array.`);
  if (!Array.isArray(textures)) return failure(`${path}.textures`, `${path}.textures must be an array.`);
  if (!Array.isArray(bounds)) return failure(`${path}.bounds`, `${path}.bounds must be an array.`);
  if (!Array.isArray(uvSemantics)) return failure(`${path}.uvSemantics`, `${path}.uvSemantics must be an array.`);
  if (!isRecord(performance)) return failure(`${path}.performance`, `${path}.performance must be an object.`);
  if (!isNonNegativeFinite(performance.loadMs)) return failure(`${path}.performance.loadMs`, `${path}.performance.loadMs must be finite and non-negative.`);
  if (!isIndex(performance.decodedGeometryBytes)) return failure(`${path}.performance.decodedGeometryBytes`, `${path}.performance.decodedGeometryBytes must be a non-negative integer.`);
  if (!Array.isArray(issues)) return failure(`${path}.issues`, `${path}.issues must be an array.`);
  for (const [index, entry] of extensions.entries()) {
    const entryPath = `${path}.extensions[${index}]`;
    if (!isRecord(entry)) return failure(entryPath, `${entryPath} must be an object.`);
    if (typeof entry.extension !== 'string') return failure(`${entryPath}.extension`, `${entryPath}.extension must be a string.`);
    if (typeof entry.required !== 'boolean') return failure(`${entryPath}.required`, `${entryPath}.required must be a boolean.`);
    if (!isOneOf(entry.support, ['supported', 'partial', 'unsupported'])) return failure(`${entryPath}.support`, `${entryPath}.support is invalid.`);
    if (!isOneOf(entry.disposition, ['supported', 'partial', 'ignored'])) return failure(`${entryPath}.disposition`, `${entryPath}.disposition is invalid.`);
    if (typeof entry.note !== 'string') return failure(`${entryPath}.note`, `${entryPath}.note must be a string.`);
  }
  for (const [index, entry] of textures.entries()) {
    const entryPath = `${path}.textures[${index}]`;
    if (!isRecord(entry)) return failure(entryPath, `${entryPath} must be an object.`);
    if (!isIndex(entry.textureIndex)) return failure(`${entryPath}.textureIndex`, `${entryPath}.textureIndex must be a non-negative integer.`);
    if (entry.imageIndex !== null && !isIndex(entry.imageIndex)) return failure(`${entryPath}.imageIndex`, `${entryPath}.imageIndex must be null or a non-negative integer.`);
    if (!isOneOf(entry.mipmapSource, ['generated-full-chain', 'source-provided', 'unavailable'])) return failure(`${entryPath}.mipmapSource`, `${entryPath}.mipmapSource is invalid.`);
    if (typeof entry.path !== 'string') return failure(`${entryPath}.path`, `${entryPath}.path must be a string.`);
    if (typeof entry.note !== 'string') return failure(`${entryPath}.note`, `${entryPath}.note must be a string.`);
  }
  for (const [index, entry] of bounds.entries()) {
    const entryPath = `${path}.bounds[${index}]`;
    if (!isRecord(entry)) return failure(entryPath, `${entryPath} must be an object.`);
    if (!isIndex(entry.meshIndex)) return failure(`${entryPath}.meshIndex`, `${entryPath}.meshIndex must be a non-negative integer.`);
    if (!isIndex(entry.primitiveIndex)) return failure(`${entryPath}.primitiveIndex`, `${entryPath}.primitiveIndex must be a non-negative integer.`);
    if (!isOneOf(entry.support, ['static', 'accessor-conservative', 'fail-open'])) return failure(`${entryPath}.support`, `${entryPath}.support is invalid.`);
    if (typeof entry.path !== 'string') return failure(`${entryPath}.path`, `${entryPath}.path must be a string.`);
    if (entry.reason !== null && typeof entry.reason !== 'string') return failure(`${entryPath}.reason`, `${entryPath}.reason must be null or a string.`);
  }
  for (const [index, entry] of uvSemantics.entries()) {
    const entryPath = `${path}.uvSemantics[${index}]`;
    if (!isRecord(entry)) return failure(entryPath, `${entryPath} must be an object.`);
    if (!isIndex(entry.meshIndex)) return failure(`${entryPath}.meshIndex`, `${entryPath}.meshIndex must be a non-negative integer.`);
    if (!isIndex(entry.primitiveIndex)) return failure(`${entryPath}.primitiveIndex`, `${entryPath}.primitiveIndex must be a non-negative integer.`);
    if (!isIndex(entry.capacity) || entry.capacity < 1) return failure(`${entryPath}.capacity`, `${entryPath}.capacity must be a positive integer.`);
    if (!Array.isArray(entry.availableSemantics) || !entry.availableSemantics.every(isUvSemantic)) return failure(`${entryPath}.availableSemantics`, `${entryPath}.availableSemantics is invalid.`);
    if (!Array.isArray(entry.referencedSemantics) || !entry.referencedSemantics.every(isUvSemantic)) return failure(`${entryPath}.referencedSemantics`, `${entryPath}.referencedSemantics is invalid.`);
    if (!Array.isArray(entry.mappings)) return failure(`${entryPath}.mappings`, `${entryPath}.mappings must be an array.`);
    for (const [mappingIndex, mapping] of entry.mappings.entries()) {
      const mappingPath = `${entryPath}.mappings[${mappingIndex}]`;
      if (!isRecord(mapping)) return failure(mappingPath, `${mappingPath} must be an object.`);
      if (!isUvSemantic(mapping.semantic)) return failure(`${mappingPath}.semantic`, `${mappingPath}.semantic is invalid.`);
      if (!isIndex(mapping.set)) return failure(`${mappingPath}.set`, `${mappingPath}.set must be a non-negative integer.`);
      if (mapping.channel !== 0 && mapping.channel !== 1) return failure(`${mappingPath}.channel`, `${mappingPath}.channel is invalid.`);
      if (mapping.semantic !== `TEXCOORD_${mapping.set}`) return failure(`${mappingPath}.semantic`, `${mappingPath}.semantic must match its set.`);
    }
    if (typeof entry.path !== 'string') return failure(`${entryPath}.path`, `${entryPath}.path must be a string.`);
  }
  for (const [index, issue] of issues.entries()) {
    const issuePath = `${path}.issues[${index}]`;
    if (!isRecord(issue)) return failure(issuePath, `${issuePath} must be an object.`);
    if (!isOneOf(issue.category, ['extension', 'texture-mipmap', 'bounds', 'uv-semantic'])) return failure(`${issuePath}.category`, `${issuePath}.category is invalid.`);
    if (typeof issue.path !== 'string') return failure(`${issuePath}.path`, `${issuePath}.path must be a string.`);
    if (typeof issue.code !== 'string') return failure(`${issuePath}.code`, `${issuePath}.code must be a string.`);
    if (typeof issue.message !== 'string') return failure(`${issuePath}.message`, `${issuePath}.message must be a string.`);
  }
  const expectedStatus = issues.length === 0 ? 'compatible' : 'degraded';
  if (value.status !== expectedStatus) return failure(`${path}.status`, `${path}.status must match the issue list.`);
  return null;
}

export function presentModelCompatibility(report: GltfCompatibilityReport): ModelCompatibilityPresentation {
  const generated = report.textures.filter(entry => entry.mipmapSource === 'generated-full-chain').length;
  const source = report.textures.filter(entry => entry.mipmapSource === 'source-provided').length;
  const unavailable = report.textures.filter(entry => entry.mipmapSource === 'unavailable').length;
  const staticBounds = report.bounds.filter(entry => entry.support === 'static').length;
  const conservativeBounds = report.bounds.filter(entry => entry.support === 'accessor-conservative').length;
  const failOpenBounds = report.bounds.filter(entry => entry.support === 'fail-open').length;
  const uvMappings = report.uvSemantics.flatMap(entry => entry.mappings.map(mapping => `${mapping.semantic}->UV${mapping.channel}`));
  const uvCapacity = report.uvSemantics[0]?.capacity ?? 2;
  return Object.freeze({
    status: report.status,
    extensions: report.extensions.length === 0
      ? 'none'
      : report.extensions
        .map(entry => `${entry.extension}: ${entry.support}${entry.required ? ' (required)' : ''} — ${entry.note}`)
        .join('; '),
    mipmaps: `generated ${generated}, source ${source}, unavailable ${unavailable}`,
    bounds: `conservative ${conservativeBounds}, static ${staticBounds}, fail-open ${failOpenBounds}`,
    uvSemantics: uvMappings.length === 0 ? `none (capacity ${uvCapacity})` : `${uvMappings.join(', ')} (capacity ${uvCapacity})`,
    performance: `load ${report.performance.loadMs.toFixed(1)} ms, decoded geometry ${formatBytes(report.performance.decodedGeometryBytes)}`,
    issues: Object.freeze(report.issues.map(issue => `[${issue.code}] ${issue.path}: ${issue.message}`)),
  });
}

function isUvSemantic(value: unknown): value is string {
  return typeof value === 'string' && /^TEXCOORD_(0|[1-9]\d*)$/.test(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function failure(path: string, message: string): ModelCompatibilityValidationFailure {
  return Object.freeze({ path, message });
}
