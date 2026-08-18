import {
  MAX_SPRITE_SHEET_FRAMES,
  SPRITE_SHEET_FRAME_MAP_FORMAT,
  type SpriteSheetAtlasParseResult,
  type SpriteSheetDiagnostic,
  type SpriteSheetFrame,
  type SpriteSheetFrameMap,
  type SpriteSheetPixelRect,
} from './SpriteSheetTypes';
import { validateSpriteSheetImageBudget } from './SpriteSheetGridAuthoring';

/** Adapts common TexturePacker-style JSON into the source-neutral frame-map contract. */
export function parseSpriteSheetAtlasJson(
  input: unknown,
  resourceId: string,
  expectedSize?: Readonly<{ width: number; height: number }>,
): SpriteSheetAtlasParseResult {
  const diagnostics: SpriteSheetDiagnostic[] = [];
  const normalizedResourceId = resourceId.trim();
  if (!normalizedResourceId) {
    failed(diagnostics, '$.resourceId', 'Atlas image resource id is required.', 'E_SPRITESHEET_ASSET_TYPE');
  }
  if (!isRecord(input)) return failed(diagnostics, '$', 'Atlas JSON root must be an object.');
  reportUnknownFields(input, new Set(['frames', 'meta']), '$', diagnostics);
  const meta = isRecord(input.meta) ? input.meta : null;
  if (input.meta !== undefined && !meta) failed(diagnostics, '$.meta', 'Atlas meta must be an object.');
  if (meta) reportUnknownFields(meta, new Set(['app', 'version', 'image', 'format', 'size', 'scale', 'smartupdate']), '$.meta', diagnostics);
  const metaSize = meta && isRecord(meta.size) ? meta.size : null;
  if (metaSize) reportUnknownFields(metaSize, new Set(['w', 'h']), '$.meta.size', diagnostics);
  const width = expectedSize?.width ?? integer(metaSize?.w);
  const height = expectedSize?.height ?? integer(metaSize?.h);
  if (!width || !height) failed(diagnostics, '$.meta.size', 'Atlas image width and height are required.');
  else {
    try { validateSpriteSheetImageBudget(width, height); }
    catch (error) { failed(diagnostics, '$.meta.size', error instanceof Error ? error.message : String(error)); }
  }

  const entries = atlasFrameEntries(input.frames, diagnostics);
  if (entries.length === 0) failed(diagnostics, '$.frames', 'Atlas must contain at least one frame.');
  if (entries.length > MAX_SPRITE_SHEET_FRAMES) {
    failed(diagnostics, '$.frames', `Atlas exceeds ${MAX_SPRITE_SHEET_FRAMES} frames.`, 'E_SPRITESHEET_FRAME_BUDGET');
  }
  const frames: SpriteSheetFrame[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const path = entry.path;
    const value = entry.value;
    reportUnknownFields(value, new Set(['filename', 'frame', 'rotated', 'trimmed', 'spriteSourceSize', 'sourceSize', 'pivot']), path, diagnostics);
    const rectValue = isRecord(value.frame) ? value.frame : null;
    if (!rectValue) {
      failed(diagnostics, `${path}.frame`, 'Atlas frame rectangle is required.');
      continue;
    }
    reportUnknownFields(rectValue, new Set(['x', 'y', 'w', 'h', 'width', 'height']), `${path}.frame`, diagnostics);
    const rect = pixelRect(rectValue);
    if (!rect || !width || !height || rect.x + rect.width > width || rect.y + rect.height > height) {
      failed(diagnostics, `${path}.frame`, 'Atlas frame rectangle must be positive and inside the image.', 'E_SPRITESHEET_FRAME_BOUNDS');
      continue;
    }
    const name = typeof value.filename === 'string' ? value.filename : entry.name;
    const id = uniqueFrameId(name || `frame-${index + 1}`, ids);
    const sourceSizeValue = isRecord(value.sourceSize) ? value.sourceSize : null;
    const sourceOffsetValue = isRecord(value.spriteSourceSize) ? value.spriteSourceSize : null;
    if (sourceSizeValue) reportUnknownFields(sourceSizeValue, new Set(['w', 'h', 'width', 'height']), `${path}.sourceSize`, diagnostics);
    if (sourceOffsetValue) reportUnknownFields(sourceOffsetValue, new Set(['x', 'y', 'w', 'h', 'width', 'height']), `${path}.spriteSourceSize`, diagnostics);
    const sourceSize = sourceSizeValue ? size(sourceSizeValue) : undefined;
    const sourceOffset = sourceOffsetValue ? pixelRect(sourceOffsetValue) : undefined;
    if (value.sourceSize !== undefined && !sourceSize) {
      failed(diagnostics, `${path}.sourceSize`, 'Atlas sourceSize must contain positive integer width and height.');
    }
    if (value.spriteSourceSize !== undefined && !sourceOffset) {
      failed(diagnostics, `${path}.spriteSourceSize`, 'Atlas spriteSourceSize must be a positive pixel rectangle.');
    }
    const trimmed = value.trimmed === true || Boolean(sourceOffset && sourceSize
      && (sourceOffset.x !== 0 || sourceOffset.y !== 0
        || sourceOffset.width !== sourceSize.width || sourceOffset.height !== sourceSize.height));
    frames.push(Object.freeze({
      id,
      name: name || `Frame ${index + 1}`,
      rect: Object.freeze(rect),
      uvRect: Object.freeze([
        rect.x / width, rect.y / height, rect.width / width, rect.height / height,
      ] as const),
      rotated: value.rotated === true,
      trimmed,
      ...(sourceSize ? { sourceSize: Object.freeze(sourceSize) } : {}),
      ...(sourceOffset ? { sourceOffset: Object.freeze(sourceOffset) } : {}),
    }));
  }
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error') || !width || !height) {
    return Object.freeze({ frameMap: null, diagnostics: Object.freeze(diagnostics) });
  }
  const frameMap: SpriteSheetFrameMap = Object.freeze({
    format: SPRITE_SHEET_FRAME_MAP_FORMAT,
    resourceId: normalizedResourceId,
    imageWidth: width,
    imageHeight: height,
    source: 'atlas-json',
    frames: Object.freeze(frames),
  });
  return Object.freeze({ frameMap, diagnostics: Object.freeze(diagnostics) });
}

function atlasFrameEntries(
  value: unknown,
  diagnostics: SpriteSheetDiagnostic[],
): readonly Readonly<{ name: string; path: string; value: Record<string, unknown> }>[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      failed(diagnostics, `$.frames[${index}]`, 'Atlas frame must be an object.');
      return [];
    }
    return [{ name: typeof entry.filename === 'string' ? entry.filename : `frame-${index + 1}`, path: `$.frames[${index}]`, value: entry }];
  });
  if (isRecord(value)) return Object.entries(value).flatMap(([name, entry]) => {
    if (!isRecord(entry)) {
      failed(diagnostics, `$.frames.${escapePath(name)}`, 'Atlas frame must be an object.');
      return [];
    }
    return [{ name, path: `$.frames.${escapePath(name)}`, value: entry }];
  });
  failed(diagnostics, '$.frames', 'Atlas frames must be an object map or array.');
  return [];
}

function reportUnknownFields(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  path: string,
  diagnostics: SpriteSheetDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!known.has(key)) diagnostics.push(Object.freeze({
      code: 'W_SPRITESHEET_ATLAS_UNKNOWN_FIELD',
      severity: 'warning',
      path: `${path}.${escapePath(key)}`,
      message: `Unknown atlas field "${key}" was preserved only as a diagnostic and not interpreted.`,
    }));
  }
}

function failed(
  diagnostics: SpriteSheetDiagnostic[],
  path: string,
  message: string,
  code: SpriteSheetDiagnostic['code'] = 'E_SPRITESHEET_ATLAS_FORMAT',
): SpriteSheetAtlasParseResult {
  diagnostics.push(Object.freeze({ code, severity: 'error', path, message }));
  return Object.freeze({ frameMap: null, diagnostics: Object.freeze([...diagnostics]) });
}

function pixelRect(value: Record<string, unknown>): SpriteSheetPixelRect | null {
  const x = integer(value.x);
  const y = integer(value.y);
  const width = integer(value.w ?? value.width);
  const height = integer(value.h ?? value.height);
  return x !== null && x >= 0 && y !== null && y >= 0 && width !== null && width > 0 && height !== null && height > 0
    ? { x, y, width, height }
    : null;
}

function size(value: Record<string, unknown>): { width: number; height: number } | undefined {
  const width = integer(value.w ?? value.width);
  const height = integer(value.h ?? value.height);
  return width !== null && width > 0 && height !== null && height > 0 ? { width, height } : undefined;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function uniqueFrameId(name: string, ids: Set<string>): string {
  const base = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9._:-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'frame';
  let id = base;
  let suffix = 2;
  while (ids.has(id)) id = `${base}-${suffix++}`;
  ids.add(id);
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapePath(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/gu, '_'); }
