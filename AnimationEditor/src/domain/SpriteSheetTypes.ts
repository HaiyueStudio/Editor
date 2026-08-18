import type { AnimationEditorProject } from './AnimationEditorProject';

export const SPRITE_SHEET_FRAME_MAP_FORMAT = 'haiyue-sprite-sheet-frame-map@1' as const;
export const MAX_SPRITE_SHEET_COLUMNS = 256;
export const MAX_SPRITE_SHEET_ROWS = 256;
export const MAX_SPRITE_SHEET_FRAMES = 4096;
export const MAX_SPRITE_SHEET_IMAGE_DIMENSION = 8192;
export const MAX_SPRITE_SHEET_IMAGE_PIXELS = 8192 * 8192;

export type SpriteSheetDiagnosticSeverity = 'warning' | 'error';
export type SpriteSheetDiagnosticCode =
  | 'E_SPRITESHEET_IMAGE_DIMENSIONS'
  | 'E_SPRITESHEET_IMAGE_BUDGET'
  | 'E_SPRITESHEET_GRID_RANGE'
  | 'E_SPRITESHEET_GRID_FRACTIONAL_CELL'
  | 'E_SPRITESHEET_FRAME_BUDGET'
  | 'E_SPRITESHEET_FRAME_BOUNDS'
  | 'E_SPRITESHEET_FRAME_ROTATED'
  | 'E_SPRITESHEET_FRAME_TRIMMED'
  | 'E_SPRITESHEET_SEQUENCE_EMPTY'
  | 'E_SPRITESHEET_SEQUENCE_RANGE'
  | 'E_SPRITESHEET_SEQUENCE_FPS'
  | 'E_SPRITESHEET_FRAME_DURATION'
  | 'E_SPRITESHEET_TIMELINE_BUDGET'
  | 'E_SPRITESHEET_ATLAS_FORMAT'
  | 'W_SPRITESHEET_ATLAS_UNKNOWN_FIELD'
  | 'E_SPRITESHEET_ASSET_TYPE'
  | 'E_SPRITESHEET_ASSET_REFERENCE'
  | 'E_SPRITESHEET_RESOURCE_REPLACED'
  | 'E_SPRITESHEET_RESOURCE_DECODE';

export interface SpriteSheetDiagnostic {
  readonly code: SpriteSheetDiagnosticCode;
  readonly severity: SpriteSheetDiagnosticSeverity;
  readonly path: string;
  readonly message: string;
}

export class SpriteSheetAuthoringError extends Error {
  readonly name = 'SpriteSheetAuthoringError';

  constructor(
    readonly code: Exclude<SpriteSheetDiagnosticCode, 'W_SPRITESHEET_ATLAS_UNKNOWN_FIELD'>,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SpriteSheetGrid {
  readonly columns: number;
  readonly rows: number;
}

export interface SpriteSheetInsets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface SpriteSheetSpacing {
  readonly x: number;
  readonly y: number;
}

export interface SpriteSheetRegularGridDefinition extends SpriteSheetGrid {
  readonly margin?: number | Partial<SpriteSheetInsets>;
  readonly spacing?: number | Partial<SpriteSheetSpacing>;
}

export interface SpriteSheetPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SpriteSheetFrame {
  readonly id: string;
  readonly name: string;
  readonly rect: SpriteSheetPixelRect;
  readonly uvRect: readonly [number, number, number, number];
  readonly rotated: boolean;
  readonly trimmed: boolean;
  readonly sourceSize?: Readonly<{ width: number; height: number }>;
  readonly sourceOffset?: SpriteSheetPixelRect;
}

export interface SpriteSheetFrameMap {
  readonly format: typeof SPRITE_SHEET_FRAME_MAP_FORMAT;
  readonly resourceId: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly source: 'regular-grid' | 'atlas-json';
  readonly frames: readonly SpriteSheetFrame[];
}

export interface SpriteSheetGridCandidate {
  readonly id: string;
  readonly columns: number;
  readonly rows: number;
  readonly confidence: number;
  readonly reason: 'current-uv' | 'square-cell-divisor';
  readonly requiresConfirmation: true;
}

export interface SpriteSheetGridInference {
  readonly candidates: readonly SpriteSheetGridCandidate[];
  readonly requiresUserInput: true;
}

export interface SpriteSheetFrameUpdate {
  readonly frame: number;
  readonly uvRect: readonly [number, number, number, number];
  readonly trackId: string | null;
  readonly keyframeId: string | null;
}

export type SpriteSheetSequenceMode = 'forward' | 'reverse' | 'ping-pong';

export interface SpriteSheetSequenceOptions {
  readonly start: number;
  readonly end: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly mode: SpriteSheetSequenceMode;
  readonly durations?: readonly number[];
}

export interface SpriteSheetSequenceFrame {
  readonly id: string;
  readonly frameId: string;
  readonly duration: number;
}

export interface SpriteSheetSequence {
  readonly id: string;
  readonly resourceId: string;
  readonly fps: number;
  readonly loop: boolean;
  readonly mode: SpriteSheetSequenceMode;
  readonly frames: readonly SpriteSheetSequenceFrame[];
}

export interface SpriteSheetScheduledFrame extends SpriteSheetSequenceFrame {
  readonly sequenceFrameId: string;
  readonly sequenceIndex: number;
  readonly time: number;
  readonly durationFrames: number;
  readonly occurrence: number;
}

export interface SpriteSheetSchedule {
  readonly sequenceId: string;
  readonly frameRate: number;
  readonly duration: number;
  readonly loop: boolean;
  readonly frames: readonly SpriteSheetScheduledFrame[];
}

export interface SpriteSheetGenerationResult {
  readonly project: AnimationEditorProject;
  readonly trackId: string;
  readonly schedule: SpriteSheetSchedule;
  readonly resourceId: string;
}

export interface SpriteSheetAtlasParseResult {
  readonly frameMap: SpriteSheetFrameMap | null;
  readonly diagnostics: readonly SpriteSheetDiagnostic[];
}

export interface SpriteSheetAssetReference {
  readonly nodeId: string;
  readonly componentId: string;
  readonly field: 'resource';
}
