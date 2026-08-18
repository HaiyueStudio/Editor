import type { AnimationEditorProject } from './AnimationEditorProject';
import type { CoreTransformProperty, TimelineKeyframeReference } from './TimelineAuthoring';

export type TimelineSelectionMode = 'replace' | 'add' | 'toggle';
export type TimelineTangentMode = 'broken' | 'unified';

export interface TimelineRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface TimelineViewportWindow {
  readonly timeStart: number;
  readonly timeEnd: number;
  readonly trackStart: number;
  readonly trackEnd: number;
  readonly width: number;
  readonly laneHeight: number;
  readonly overscanFrames?: number;
}

export interface VisibleTimelineKeyframe extends TimelineKeyframeReference {
  readonly trackIndex: number;
  readonly time: number;
  readonly x: number;
  readonly y: number;
}

export type TimelineBatchOperation =
  | Readonly<{ kind: 'move'; deltaTime: number }>
  | Readonly<{ kind: 'copy'; deltaTime: number }>
  | Readonly<{ kind: 'scale'; anchorTime: number; scale: number }>
  | Readonly<{ kind: 'align'; time: number }>
  | Readonly<{ kind: 'distribute'; startTime?: number; endTime?: number }>;

export interface TimelineEditTarget extends TimelineKeyframeReference {
  readonly sourceTime: number;
  readonly targetTime: number;
}

export interface TimelineCollision {
  readonly trackId: string;
  readonly frame: number;
  readonly time: number;
  readonly keyframeIds: readonly string[];
  readonly occupiedBy?: string;
}

export interface TimelineEditPlan {
  readonly valid: boolean;
  readonly project: AnimationEditorProject;
  readonly targets: readonly TimelineEditTarget[];
  readonly selection: readonly TimelineKeyframeReference[];
  readonly collisions: readonly TimelineCollision[];
  readonly operation: TimelineBatchOperation;
}

export interface TimelineSnapPoint {
  readonly kind: 'frame' | 'marker' | 'work-start' | 'work-end' | 'clip-start' | 'clip-end' | 'keyframe';
  readonly time: number;
  readonly id?: string;
  readonly label?: string;
}

export interface TimelineSnapOptions {
  readonly pixelsPerSecond: number;
  readonly thresholdPixels?: number;
  readonly markers?: readonly TimelineMarker[];
  readonly workArea?: TimelineWorkArea;
  readonly exclude?: readonly TimelineKeyframeReference[];
}

export interface TimelineSnapResult {
  readonly time: number;
  readonly point: TimelineSnapPoint;
  readonly distancePixels: number;
}

export interface TimelineMarker {
  readonly id: string;
  readonly name: string;
  readonly time: number;
  readonly color?: string;
}

export interface TimelineWorkArea {
  readonly start: number;
  readonly end: number;
}

export interface TimelineCurveView {
  readonly timeStart: number;
  readonly timeEnd: number;
  readonly valueMin: number;
  readonly valueMax: number;
  readonly width: number;
  readonly height: number;
  readonly samples?: number;
}

export interface TimelineCurvePoint {
  readonly time: number;
  readonly value: number;
  readonly x: number;
  readonly y: number;
}

export interface TimelineValueCurve {
  readonly trackId: string;
  readonly channel: number;
  readonly points: readonly TimelineCurvePoint[];
  readonly keyframes: readonly (TimelineCurvePoint & { readonly keyframeId: string })[];
}

export interface TimelineEasingHandles {
  readonly keyframeId: string;
  readonly incoming: readonly [number, number] | null;
  readonly outgoing: readonly [number, number] | null;
}

export interface TimelineAutoKeyEdit {
  readonly nodeId: string;
  readonly property: CoreTransformProperty;
  readonly time: number;
  readonly value: readonly number[];
  readonly enabled: boolean;
}

export interface TimelineAutoKeyResult {
  readonly project: AnimationEditorProject;
  readonly keyframe: TimelineKeyframeReference | null;
  readonly sampledValue: readonly number[];
  readonly animatedTrackId: string | null;
}

export interface TimelineMotionPathPoint {
  readonly time: number;
  readonly position: readonly [number, number];
}

export interface TimelineMotionPathKey {
  readonly keyframeId: string;
  readonly time: number;
  readonly position: readonly [number, number];
  readonly spatialIn: readonly [number, number] | null;
  readonly spatialOut: readonly [number, number] | null;
}

export interface TimelineMotionPath {
  readonly trackId: string;
  readonly points: readonly TimelineMotionPathPoint[];
  readonly keys: readonly TimelineMotionPathKey[];
}

export type TimelineViewportCoordinateMode =
  | Readonly<{ kind: '2d'; coordinateSystem: 'screen-y-down' }>
  | Readonly<{
      kind: '3d';
      handedness: 'right';
      upAxis: '+y';
      forwardAxis: '-z';
      unit: 'meter';
    }>;

export interface TimelineTransform3D {
  readonly translation: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
}

export type TimelineGizmo3DOperation = Readonly<{
  tool: 'translate' | 'rotate' | 'scale';
  axis: 'x' | 'y' | 'z' | 'uniform';
  deltaPixels: readonly [number, number];
  pixelsPerUnit?: number;
  radiansPerPixel?: number;
  space?: 'local' | 'world';
}>;
