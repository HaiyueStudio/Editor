import {
  MAX_SPRITE_SHEET_COLUMNS,
  MAX_SPRITE_SHEET_FRAMES,
  MAX_SPRITE_SHEET_IMAGE_DIMENSION,
  MAX_SPRITE_SHEET_IMAGE_PIXELS,
  MAX_SPRITE_SHEET_ROWS,
  SPRITE_SHEET_FRAME_MAP_FORMAT,
  SpriteSheetAuthoringError,
  type SpriteSheetFrame,
  type SpriteSheetFrameMap,
  type SpriteSheetGrid,
  type SpriteSheetGridCandidate,
  type SpriteSheetGridInference,
  type SpriteSheetInsets,
  type SpriteSheetRegularGridDefinition,
  type SpriteSheetSpacing,
} from './SpriteSheetTypes';

export function createRegularSpriteSheetFrameMap(
  resourceId: string,
  imageWidth: number,
  imageHeight: number,
  definition: SpriteSheetRegularGridDefinition,
): SpriteSheetFrameMap {
  const id = resourceId.trim();
  if (!id) throw new SpriteSheetAuthoringError('E_SPRITESHEET_ASSET_TYPE', '$.resourceId', 'SpriteSheet resource id is required.');
  validateSpriteSheetImageBudget(imageWidth, imageHeight);
  const grid = normalizeSpriteSheetGrid(definition.columns, definition.rows);
  const margin = normalizeInsets(definition.margin);
  const spacing = normalizeSpacing(definition.spacing);
  const availableWidth = imageWidth - margin.left - margin.right - spacing.x * (grid.columns - 1);
  const availableHeight = imageHeight - margin.top - margin.bottom - spacing.y * (grid.rows - 1);
  if (availableWidth <= 0 || availableHeight <= 0
    || availableWidth % grid.columns !== 0 || availableHeight % grid.rows !== 0) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_GRID_FRACTIONAL_CELL',
      '$.grid',
      'Margins and spacing must leave positive whole-pixel cells for every row and column.',
    );
  }
  const cellWidth = availableWidth / grid.columns;
  const cellHeight = availableHeight / grid.rows;
  const frames: SpriteSheetFrame[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const x = margin.left + column * (cellWidth + spacing.x);
      const y = margin.top + row * (cellHeight + spacing.y);
      const index = row * grid.columns + column;
      frames.push(Object.freeze({
        id: `frame-${index + 1}`,
        name: `Frame ${index + 1}`,
        rect: Object.freeze({ x, y, width: cellWidth, height: cellHeight }),
        uvRect: Object.freeze([
          x / imageWidth, y / imageHeight, cellWidth / imageWidth, cellHeight / imageHeight,
        ] as const),
        rotated: false,
        trimmed: false,
      }));
    }
  }
  return Object.freeze({
    format: SPRITE_SHEET_FRAME_MAP_FORMAT,
    resourceId: id,
    imageWidth,
    imageHeight,
    source: 'regular-grid',
    frames: Object.freeze(frames),
  });
}

/** Existing helper retained for simple UV-derived candidates; callers still confirm before applying. */
export function inferSpriteSheetGrid(uvRect: readonly number[]): SpriteSheetGrid {
  return {
    columns: gridDimension(uvRect[2], MAX_SPRITE_SHEET_COLUMNS),
    rows: gridDimension(uvRect[3], MAX_SPRITE_SHEET_ROWS),
  };
}

export function inferSpriteSheetGridCandidates(
  imageWidth: number,
  imageHeight: number,
  uvRect?: readonly number[],
): SpriteSheetGridInference {
  validateSpriteSheetImageBudget(imageWidth, imageHeight);
  const keyed = new Map<string, SpriteSheetGridCandidate>();
  if (uvRect && uvRect.length >= 4 && uvRect.every(Number.isFinite)) {
    const grid = inferSpriteSheetGrid(uvRect);
    addCandidate(keyed, grid.columns, grid.rows, 0.95, 'current-uv');
  }
  const maximumColumns = Math.min(MAX_SPRITE_SHEET_COLUMNS, imageWidth);
  const maximumRows = Math.min(MAX_SPRITE_SHEET_ROWS, imageHeight);
  for (let columns = 1; columns <= maximumColumns; columns++) {
    if (imageWidth % columns !== 0) continue;
    const cell = imageWidth / columns;
    const rows = imageHeight / cell;
    if (Number.isSafeInteger(rows) && rows >= 1 && rows <= maximumRows && columns * rows > 1) {
      addCandidate(keyed, columns, rows, 0.5, 'square-cell-divisor');
    }
  }
  const candidates = [...keyed.values()]
    .sort((left, right) => right.confidence - left.confidence
      || Math.abs(left.columns - left.rows) - Math.abs(right.columns - right.rows)
      || left.columns * left.rows - right.columns * right.rows)
    .slice(0, 12);
  return Object.freeze({ candidates: Object.freeze(candidates), requiresUserInput: true });
}

export function spriteSheetFrameIndex(
  uvRect: readonly number[],
  columns: number,
  rows: number,
): number {
  const grid = normalizeSpriteSheetGrid(columns, rows);
  const column = clampInteger(Math.round(finite(uvRect[0], 0) * grid.columns), 0, grid.columns - 1);
  const row = clampInteger(Math.round(finite(uvRect[1], 0) * grid.rows), 0, grid.rows - 1);
  return row * grid.columns + column;
}

export function spriteSheetFrameUvRect(
  frame: number,
  columns: number,
  rows: number,
): readonly [number, number, number, number] {
  const grid = normalizeSpriteSheetGrid(columns, rows);
  const normalizedFrame = clampInteger(Math.round(frame), 0, grid.columns * grid.rows - 1);
  return Object.freeze([
    (normalizedFrame % grid.columns) / grid.columns,
    Math.floor(normalizedFrame / grid.columns) / grid.rows,
    1 / grid.columns,
    1 / grid.rows,
  ] as const);
}

export function requiredSpriteSheetFrame(frameMap: SpriteSheetFrameMap, frameId: string): SpriteSheetFrame {
  const frame = frameMap.frames.find(candidate => candidate.id === frameId);
  if (!frame) throw new SpriteSheetAuthoringError(
    'E_SPRITESHEET_FRAME_BOUNDS', '$.sequence.frames', `Unknown SpriteSheet frame "${frameId}".`,
  );
  return frame;
}

export function validateSpriteSheetImageBudget(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_IMAGE_DIMENSIONS', '$.image', 'SpriteSheet image dimensions must be positive integers.',
    );
  }
  if (width > MAX_SPRITE_SHEET_IMAGE_DIMENSION || height > MAX_SPRITE_SHEET_IMAGE_DIMENSION
    || width * height > MAX_SPRITE_SHEET_IMAGE_PIXELS) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_IMAGE_BUDGET',
      '$.image',
      `SpriteSheet image ${width}×${height} exceeds the ${MAX_SPRITE_SHEET_IMAGE_DIMENSION}px / ${MAX_SPRITE_SHEET_IMAGE_PIXELS}-pixel budget.`,
    );
  }
}

export function normalizeSpriteSheetGrid(columns: number, rows: number): SpriteSheetGrid {
  if (!Number.isSafeInteger(columns) || columns < 1 || columns > MAX_SPRITE_SHEET_COLUMNS
    || !Number.isSafeInteger(rows) || rows < 1 || rows > MAX_SPRITE_SHEET_ROWS) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_GRID_RANGE',
      '$.grid',
      `SpriteSheet grid must be integer columns/rows within ${MAX_SPRITE_SHEET_COLUMNS}×${MAX_SPRITE_SHEET_ROWS}.`,
    );
  }
  if (columns * rows > MAX_SPRITE_SHEET_FRAMES) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_FRAME_BUDGET', '$.grid', `SpriteSheet grid exceeds ${MAX_SPRITE_SHEET_FRAMES} frames.`,
    );
  }
  return Object.freeze({ columns, rows });
}

function normalizeInsets(value: SpriteSheetRegularGridDefinition['margin']): SpriteSheetInsets {
  if (typeof value === 'number') return Object.freeze({ left: pixel(value), top: pixel(value), right: pixel(value), bottom: pixel(value) });
  return Object.freeze({
    left: pixel(value?.left ?? 0),
    top: pixel(value?.top ?? 0),
    right: pixel(value?.right ?? 0),
    bottom: pixel(value?.bottom ?? 0),
  });
}

function normalizeSpacing(value: SpriteSheetRegularGridDefinition['spacing']): SpriteSheetSpacing {
  if (typeof value === 'number') return Object.freeze({ x: pixel(value), y: pixel(value) });
  return Object.freeze({ x: pixel(value?.x ?? 0), y: pixel(value?.y ?? 0) });
}

function pixel(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_GRID_RANGE', '$.grid', 'SpriteSheet margin and spacing must be non-negative integer pixels.',
    );
  }
  return value;
}

function addCandidate(
  target: Map<string, SpriteSheetGridCandidate>,
  columns: number,
  rows: number,
  confidence: number,
  reason: SpriteSheetGridCandidate['reason'],
): void {
  if (columns * rows > MAX_SPRITE_SHEET_FRAMES) return;
  const id = `${columns}x${rows}`;
  const existing = target.get(id);
  if (existing && existing.confidence >= confidence) return;
  target.set(id, Object.freeze({ id, columns, rows, confidence, reason, requiresConfirmation: true }));
}

function gridDimension(value: number | undefined, maximum: number): number {
  const size = finite(value, 1);
  return clampInteger(Math.round(1 / Math.max(Number.EPSILON, size)), 1, maximum);
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
