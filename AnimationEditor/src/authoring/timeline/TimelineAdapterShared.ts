import {
  animationEditorProjectSnapshotKey,
  type AnimationEditorProject,
} from '../../domain/AnimationEditorProject';
import type { TimelineTransform3D } from '../../domain/TimelineProduction';

export interface TimelineAdapterMetrics {
  readonly renderPasses: number;
  readonly renderedKeyframes: number;
  readonly previewUpdates: number;
  readonly commits: number;
  readonly exactPreviewRequests: number;
  readonly collisions: number;
}

export interface MutableTimelineAdapterMetrics {
  renderPasses: number;
  renderedKeyframes: number;
  previewUpdates: number;
  commits: number;
  exactPreviewRequests: number;
  collisions: number;
}

export function emptyTimelineAdapterMetrics(): MutableTimelineAdapterMetrics {
  return { renderPasses: 0, renderedKeyframes: 0, previewUpdates: 0, commits: 0, exactPreviewRequests: 0, collisions: 0 };
}

export function sizeTimelineCanvas(canvas: HTMLCanvasElement): void {
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

export function timelineCanvasScale(canvas: HTMLCanvasElement): number {
  return canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
}

export function requiredTimelineContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Timeline Canvas2D context is unavailable.');
  return context;
}

export function timelineLocalPoint(canvas: HTMLCanvasElement, event: PointerEvent): readonly [number, number] {
  const bounds = canvas.getBoundingClientRect();
  return Object.freeze([event.clientX - bounds.left, event.clientY - bounds.top] as const);
}

export function sameTimelineProject(left: AnimationEditorProject, right: AnimationEditorProject): boolean {
  return animationEditorProjectSnapshotKey(left) === animationEditorProjectSnapshotKey(right);
}

export function sameTimelineTransform(left: TimelineTransform3D, right: TimelineTransform3D): boolean {
  return left.translation.every((value, index) => value === right.translation[index])
    && left.rotation.every((value, index) => value === right.rotation[index])
    && left.scale.every((value, index) => value === right.scale[index]);
}

export function clampTimelineUnit(value: number): number { return Math.max(0, Math.min(1, value)); }
