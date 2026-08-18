import type { AnimationEditorProject } from './AnimationEditorProject';

export const MAX_PATH_COMMANDS = 2048;
export const MAX_PATH_VALUES = 4096;
export const MAX_PATH_FLATTENED_POINTS = 16384;
export const MAX_PATH_COORDINATE = 1_000_000;

export type PathAuthoringDiagnosticCode =
  | 'E_PATH_ID'
  | 'E_PATH_COMMAND_STREAM'
  | 'E_PATH_COMMAND_BUDGET'
  | 'E_PATH_VALUE_COUNT'
  | 'E_PATH_VALUE_BUDGET'
  | 'E_PATH_COORDINATE'
  | 'E_PATH_TOPOLOGY_OPEN'
  | 'E_PATH_TOPOLOGY_POINTS'
  | 'E_PATH_COMMAND_REFERENCE'
  | 'E_PATH_POINT_REFERENCE'
  | 'E_PATH_MORPH_COMMAND_MISMATCH'
  | 'E_PATH_MORPH_POINT_COUNT_MISMATCH'
  | 'E_PATH_COMPONENT'
  | 'E_PATH_TRACK'
  | 'E_PATH_CACHE_BUDGET'
  | 'E_PATH_GESTURE_REPLACED';

export class PathAuthoringError extends Error {
  readonly name = 'PathAuthoringError';

  constructor(
    readonly code: PathAuthoringDiagnosticCode,
    readonly path: string,
    message: string,
    readonly context: Readonly<Record<string, string | number | boolean>> = Object.freeze({}),
  ) {
    super(message);
  }
}

export type PathPoint = readonly [number, number];
export type PathCommandKind = 'M' | 'L' | 'Q' | 'C' | 'Z';

export interface PathMoveCommand { readonly id: string; readonly kind: 'M'; readonly end: PathPoint }
export interface PathLineCommand { readonly id: string; readonly kind: 'L'; readonly end: PathPoint }
export interface PathQuadraticCommand {
  readonly id: string;
  readonly kind: 'Q';
  readonly control: PathPoint;
  readonly end: PathPoint;
}
export interface PathCubicCommand {
  readonly id: string;
  readonly kind: 'C';
  readonly controlOut: PathPoint;
  readonly controlIn: PathPoint;
  readonly end: PathPoint;
}
export interface PathCloseCommand { readonly id: string; readonly kind: 'Z' }

export type PathCommand =
  | PathMoveCommand
  | PathLineCommand
  | PathQuadraticCommand
  | PathCubicCommand
  | PathCloseCommand;

export type PathCommandInput =
  | Omit<PathMoveCommand, 'id'>
  | Omit<PathLineCommand, 'id'>
  | Omit<PathQuadraticCommand, 'id'>
  | Omit<PathCubicCommand, 'id'>
  | Omit<PathCloseCommand, 'id'>;

export interface AuthoringPath {
  readonly id: string;
  readonly geometryVersion: number;
  readonly commands: readonly PathCommand[];
}

export type PathPointPart = 'end' | 'control' | 'control-out' | 'control-in';
export interface PathPointReference {
  readonly commandId: string;
  readonly part: PathPointPart;
}

export interface PathViewportTransform {
  readonly zoom: number;
  readonly pan: PathPoint;
}

export type PathHit =
  | Readonly<{ kind: 'point'; reference: PathPointReference; distancePixels: number }>
  | Readonly<{ kind: 'segment'; commandId: string; t: number; distancePixels: number }>;

export interface FlattenedPathPoint {
  readonly position: PathPoint;
  readonly commandId: string;
  readonly t: number;
}

export interface FlattenedPathContour {
  readonly points: readonly FlattenedPathPoint[];
  readonly closed: boolean;
}

export interface FlattenedPath {
  readonly pathId: string;
  readonly geometryVersion: number;
  readonly pointCount: number;
  readonly contours: readonly FlattenedPathContour[];
}

export interface PathTopologySignature {
  readonly commands: string;
  readonly commandCount: number;
  readonly pointCount: number;
  readonly valueCount: number;
  readonly closedContours: number;
  readonly openContours: number;
}

export interface PathMorphCorrespondence {
  readonly commandId: string;
  readonly part: PathPointPart;
  readonly from: PathPoint;
  readonly to: PathPoint;
}

export interface PathMorphKeyframeResult {
  readonly project: AnimationEditorProject;
  readonly trackId: string;
  readonly keyframeId: string;
  readonly time: number;
  readonly topology: PathTopologySignature;
}

export type PathTangentMode = 'unified' | 'broken';

export interface PathSolidFillStyle {
  readonly kind: 'solid';
  readonly color: readonly [number, number, number, number];
  readonly opacity: number;
}

export interface PathGradientFillStyle {
  readonly kind: 'linear-gradient' | 'radial-gradient';
  readonly start: PathPoint;
  readonly end: PathPoint;
  readonly stops: readonly number[];
  readonly opacity: number;
}

export interface PathStrokeStyle {
  readonly color: readonly [number, number, number, number];
  readonly width: number;
  readonly opacity: number;
  readonly lineCap: 'butt' | 'round' | 'square';
  readonly lineJoin: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
  readonly dash: readonly number[];
  readonly dashOffset: number;
}

export interface PathTrimModifierStyle {
  readonly kind: 'trim-path';
  readonly start: number;
  readonly end: number;
  readonly offset: number;
  readonly mode: 'simultaneous' | 'individual';
}

export interface PathRoundModifierStyle { readonly kind: 'round-corners'; readonly radius: number }
export type PathModifierStyle = PathTrimModifierStyle | PathRoundModifierStyle;

export interface PathVectorStyle {
  readonly fill: PathSolidFillStyle | PathGradientFillStyle | null;
  readonly stroke: PathStrokeStyle | null;
  readonly modifiers: readonly PathModifierStyle[];
  readonly fillRule: 'nonzero' | 'evenodd';
  readonly tolerance: number;
}

export interface PathMotionSelection {
  readonly trackId: string;
  readonly keyframeId: string;
  readonly handle?: 'incoming' | 'outgoing';
}

export interface PathMotionOverlay {
  readonly trackId: string;
  readonly selectedKeyframeIds: ReadonlySet<string>;
  readonly points: readonly Readonly<{ time: number; position: PathPoint }>[];
  readonly keys: readonly Readonly<{
    keyframeId: string;
    time: number;
    position: PathPoint;
    spatialIn: PathPoint | null;
    spatialOut: PathPoint | null;
  }>[];
}

export interface PathOverlayContour {
  readonly points: readonly PathPoint[];
  readonly closed: boolean;
}

export type PathVectorStyleEdit =
  | Readonly<{ kind: 'fill-solid'; color: readonly [number, number, number, number]; opacity: number }>
  | Readonly<{
      kind: 'fill-gradient';
      gradientKind: 'linear-gradient' | 'radial-gradient';
      start: PathPoint;
      end: PathPoint;
      stops: readonly number[];
      opacity: number;
    }>
  | Readonly<{ kind: 'remove-fill' }>
  | Readonly<{ kind: 'stroke'; value: PathStrokeStyle }>
  | Readonly<{ kind: 'remove-stroke' }>
  | Readonly<{ kind: 'trim'; value: Omit<PathTrimModifierStyle, 'kind'> }>
  | Readonly<{ kind: 'round'; radius: number }>;

export interface PathGeometryCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly rebuilds: number;
  readonly evictions: number;
  readonly entries: number;
  readonly flattenedPoints: number;
  readonly peakEntries: number;
  readonly peakFlattenedPoints: number;
}
