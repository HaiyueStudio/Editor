import type { AnimationEditorProject } from '../../domain/AnimationEditorProject';
import { sampleAnimationEditorTrack, type TimelineKeyframeReference } from '../../domain/TimelineAuthoring';
import {
  applyTimelineViewportGizmo2D,
  applyTimelineViewportGizmo3D,
  buildTimelineMotionPath,
  moveTimelineMotionPathKey,
  setTimelineSpatialHandle,
  type TimelineMotionPath,
  type TimelineTangentMode,
  type TimelineTransform3D,
} from '../../domain/TimelineProduction';
import {
  emptyTimelineAdapterMetrics,
  requiredTimelineContext,
  sameTimelineProject,
  sameTimelineTransform,
  sizeTimelineCanvas,
  timelineCanvasScale,
  timelineLocalPoint,
  type MutableTimelineAdapterMetrics,
  type TimelineAdapterMetrics,
} from './TimelineAdapterShared';

interface Viewport2DOptions {
  readonly mode: Readonly<{ kind: '2d'; coordinateSystem: 'screen-y-down' }>;
  readonly project: () => AnimationEditorProject;
  readonly nodeId: string;
  readonly time: () => number;
  readonly autoKey: () => boolean;
  readonly zoom?: number;
  readonly positionTrackId?: () => string | null;
  readonly onPreview?: (project: AnimationEditorProject) => void;
  readonly onCommit: (project: AnimationEditorProject, label: string) => void;
  readonly onExactPreviewRequested?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly label?: string;
}

interface Viewport3DOptions {
  readonly mode: Readonly<{
    kind: '3d'; handedness: 'right'; upAxis: '+y'; forwardAxis: '-z'; unit: 'meter';
  }>;
  readonly transform: () => TimelineTransform3D;
  readonly onPreview?: (transform: TimelineTransform3D) => void;
  readonly onCommit: (transform: TimelineTransform3D, label: string) => void;
  readonly onExactPreviewRequested?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly label?: string;
}

export type TimelineViewportTweenAdapterOptions = Viewport2DOptions | Viewport3DOptions;

type ViewportHit =
  | Readonly<{ kind: 'gizmo' }>
  | Readonly<{ kind: 'key'; reference: TimelineKeyframeReference; origin: readonly [number, number] }>
  | Readonly<{
      kind: 'handle'; reference: TimelineKeyframeReference; handle: 'incoming' | 'outgoing';
      keyPosition: readonly [number, number];
    }>;

interface ViewportDrag {
  readonly pointerId: number;
  readonly origin: readonly [number, number];
  readonly hit: ViewportHit;
  readonly project?: AnimationEditorProject;
  readonly transform?: TimelineTransform3D;
  previewProject?: AnimationEditorProject;
  previewTransform?: TimelineTransform3D;
}

/** Source-neutral overlay for 2D Tween paths and G01-native 3D TRS gizmos. */
export class TimelineViewportTweenAdapter {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _options: TimelineViewportTweenAdapterOptions;
  private _tool: 'translate' | 'rotate' | 'scale' = 'translate';
  private _axis: 'x' | 'y' | 'z' | 'uniform' = 'uniform';
  private _tangentMode: TimelineTangentMode = 'unified';
  private _drag: ViewportDrag | null = null;
  private _previewProject: AnimationEditorProject | null = null;
  private _previewTransform: TimelineTransform3D | null = null;
  private _frame: number | null = null;
  private _disposed = false;
  private readonly _metrics: MutableTimelineAdapterMetrics = emptyTimelineAdapterMetrics();

  constructor(canvas: HTMLCanvasElement, options: TimelineViewportTweenAdapterOptions) {
    this._canvas = canvas;
    this._options = options;
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', options.label ?? `${options.mode.kind.toUpperCase()} transform gizmo and motion path`);
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this._pointerDown);
    canvas.addEventListener('pointermove', this._pointerMove);
    canvas.addEventListener('pointerup', this._pointerUp);
    canvas.addEventListener('pointercancel', this._pointerCancel);
    canvas.addEventListener('keydown', this._keyDown);
    this.renderNow();
  }

  get metrics(): TimelineAdapterMetrics { return Object.freeze({ ...this._metrics }); }

  setTool(tool: 'translate' | 'rotate' | 'scale', axis: 'x' | 'y' | 'z' | 'uniform' = 'uniform'): void {
    this._tool = tool;
    this._axis = axis;
    this._canvas.setAttribute('aria-valuetext', `${tool} ${axis}`);
    this.scheduleRender();
  }

  setTangentMode(mode: TimelineTangentMode): void { this._tangentMode = mode; }

  renderNow(): void {
    if (this._disposed) return;
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    sizeTimelineCanvas(this._canvas);
    const context = requiredTimelineContext(this._canvas);
    const scale = timelineCanvasScale(this._canvas);
    context.clearRect(0, 0, this._canvas.width, this._canvas.height);
    context.save();
    context.scale(scale, scale);
    if (this._options.mode.kind === '2d') this._draw2d(context);
    else this._draw3d(context);
    context.restore();
    this._metrics.renderPasses++;
  }

  scheduleRender(): void {
    if (this._disposed || this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.renderNow();
    });
  }

  cancelGesture(): void {
    this._drag = null;
    this._previewProject = null;
    this._previewTransform = null;
    this.scheduleRender();
  }

  dispose(): void {
    if (this._disposed) return;
    this.cancelGesture();
    this._disposed = true;
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._canvas.removeEventListener('pointerdown', this._pointerDown);
    this._canvas.removeEventListener('pointermove', this._pointerMove);
    this._canvas.removeEventListener('pointerup', this._pointerUp);
    this._canvas.removeEventListener('pointercancel', this._pointerCancel);
    this._canvas.removeEventListener('keydown', this._keyDown);
  }

  private readonly _pointerDown = (event: PointerEvent): void => {
    if (this._disposed || event.button !== 0) return;
    const origin = timelineLocalPoint(this._canvas, event);
    if (this._options.mode.kind === '2d') {
      const options = this._options as Viewport2DOptions;
      const project = options.project();
      this._drag = {
        pointerId: event.pointerId, origin, project,
        hit: hitViewport2d(project, options.positionTrackId?.() ?? null, origin, options.zoom ?? 1),
      };
    } else {
      const options = this._options as Viewport3DOptions;
      this._drag = { pointerId: event.pointerId, origin, transform: options.transform(), hit: { kind: 'gizmo' } };
    }
    try { this._canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic browser fixture pointer. */ }
    this._canvas.focus({ preventScroll: true });
    event.preventDefault();
  };

  private readonly _pointerMove = (event: PointerEvent): void => {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    const point = timelineLocalPoint(this._canvas, event);
    const delta = [point[0] - this._drag.origin[0], point[1] - this._drag.origin[1]] as const;
    if (this._options.mode.kind === '2d') {
      const options = this._options as Viewport2DOptions;
      const before = this._drag.project!;
      if (this._drag.hit.kind === 'key') {
        const zoom = options.zoom ?? 1;
        this._previewProject = moveTimelineMotionPathKey(before, this._drag.hit.reference, [
          this._drag.hit.origin[0] + delta[0] / zoom,
          this._drag.hit.origin[1] + delta[1] / zoom,
        ]);
      } else if (this._drag.hit.kind === 'handle') {
        const zoom = options.zoom ?? 1;
        const handlePosition = [point[0] / zoom, point[1] / zoom] as const;
        this._previewProject = setTimelineSpatialHandle(before, this._drag.hit.reference, this._drag.hit.handle, [
          handlePosition[0] - this._drag.hit.keyPosition[0],
          handlePosition[1] - this._drag.hit.keyPosition[1],
        ], this._tangentMode);
      } else {
        this._previewProject = applyTimelineViewportGizmo2D(
          before, options.nodeId, this._tool, [
            delta[0] / (options.zoom ?? 1), delta[1] / (options.zoom ?? 1),
          ], options.time(), options.autoKey(),
        ).project;
      }
      this._drag.previewProject = this._previewProject;
      options.onPreview?.(this._previewProject);
    } else {
      const options = this._options as Viewport3DOptions;
      this._previewTransform = applyTimelineViewportGizmo3D(
        this._drag.transform!, options.mode,
        { tool: this._tool, axis: this._axis, deltaPixels: delta, space: 'local' },
      );
      this._drag.previewTransform = this._previewTransform;
      options.onPreview?.(this._previewTransform);
    }
    this._metrics.previewUpdates++;
    this.scheduleRender();
    event.preventDefault();
  };

  private readonly _pointerUp = (event: PointerEvent): void => {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    if (this._canvas.hasPointerCapture(event.pointerId)) this._canvas.releasePointerCapture(event.pointerId);
    if (this._options.mode.kind === '2d' && this._drag.previewProject
      && sameTimelineProject((this._options as Viewport2DOptions).project(), this._drag.project!)) {
      const options = this._options as Viewport2DOptions;
      const label = this._drag.hit.kind === 'handle' ? 'Edit spatial handle'
        : this._drag.hit.kind === 'key' ? 'Edit motion path key' : `Viewport ${this._tool}`;
      options.onCommit(this._drag.previewProject, label);
      this._commitMetric();
    } else if (this._options.mode.kind === '3d' && this._drag.previewTransform
      && sameTimelineTransform((this._options as Viewport3DOptions).transform(), this._drag.transform!)) {
      const options = this._options as Viewport3DOptions;
      options.onCommit(this._drag.previewTransform, `Viewport 3D ${this._tool}`);
      this._commitMetric();
    }
    this._drag = null;
    this._previewProject = null;
    this._previewTransform = null;
    this.scheduleRender();
    event.preventDefault();
  };

  private readonly _pointerCancel = (event: PointerEvent): void => {
    if (this._drag && event.pointerId === this._drag.pointerId) this.cancelGesture();
  };

  private readonly _keyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (event.shiftKey) this._options.onRedo?.();
      else this._options.onUndo?.();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      this.cancelGesture();
      event.preventDefault();
    }
  };

  private _draw2d(context: CanvasRenderingContext2D): void {
    const options = this._options as Viewport2DOptions;
    const project = this._previewProject ?? options.project();
    const trackId = options.positionTrackId?.() ?? null;
    const track = trackId ? project.timeline.tracks.find(candidate => candidate.id === trackId) : undefined;
    if (track) drawMotionPath(context, buildTimelineMotionPath(track, project.composition.frameRate), options.zoom ?? 1);
    const node = project.nodes.find(candidate => candidate.id === options.nodeId);
    const sampled = track ? sampleAnimationEditorTrack(track, options.time()) : null;
    const position = sampled ?? node?.transform.position ?? [0, 0];
    drawGizmo(context, position[0] * (options.zoom ?? 1), position[1] * (options.zoom ?? 1), this._tool);
  }

  private _draw3d(context: CanvasRenderingContext2D): void {
    const options = this._options as Viewport3DOptions;
    const transform = this._previewTransform ?? options.transform();
    const x = this._canvas.clientWidth / 2 + transform.translation[0] * 40;
    const y = this._canvas.clientHeight / 2 - transform.translation[1] * 40;
    drawGizmo(context, x, y, this._tool);
    context.fillStyle = '#d7dde8';
    context.fillText(`RH · +Y · -Z · ${this._axis}`, 10, 18);
  }

  private _commitMetric(): void {
    this._metrics.commits++;
    this._metrics.exactPreviewRequests++;
    if (this._options.mode.kind === '2d') (this._options as Viewport2DOptions).onExactPreviewRequested?.();
    else (this._options as Viewport3DOptions).onExactPreviewRequested?.();
  }
}

function drawMotionPath(context: CanvasRenderingContext2D, path: TimelineMotionPath, zoom: number): void {
  context.strokeStyle = '#58a6ff';
  context.lineWidth = 2;
  context.beginPath();
  path.points.forEach((point, index) => {
    const x = point.position[0] * zoom;
    const y = point.position[1] * zoom;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
  for (const key of path.keys) {
    const x = key.position[0] * zoom;
    const y = key.position[1] * zoom;
    context.fillStyle = '#f5f7fa';
    context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.fill();
    for (const [handle, color] of [[key.spatialIn, '#f0a45d'], [key.spatialOut, '#f0a45d']] as const) {
      if (!handle) continue;
      const hx = (key.position[0] + handle[0]) * zoom;
      const hy = (key.position[1] + handle[1]) * zoom;
      context.strokeStyle = color;
      context.beginPath(); context.moveTo(x, y); context.lineTo(hx, hy); context.stroke();
      context.fillStyle = color;
      context.beginPath(); context.arc(hx, hy, 4, 0, Math.PI * 2); context.fill();
    }
  }
}

function drawGizmo(context: CanvasRenderingContext2D, x: number, y: number, tool: string): void {
  context.lineWidth = 2;
  context.strokeStyle = '#ff5f6d';
  context.beginPath(); context.moveTo(x, y); context.lineTo(x + 36, y); context.stroke();
  context.strokeStyle = '#57d38c';
  context.beginPath(); context.moveTo(x, y); context.lineTo(x, y - 36); context.stroke();
  context.fillStyle = '#d7dde8';
  context.fillText(tool, x + 8, y + 16);
}

function hitViewport2d(
  project: AnimationEditorProject,
  trackId: string | null,
  point: readonly [number, number],
  zoom: number,
): ViewportHit {
  const track = trackId ? project.timeline.tracks.find(candidate => candidate.id === trackId) : undefined;
  if (!track) return { kind: 'gizmo' };
  const path = buildTimelineMotionPath(track, project.composition.frameRate);
  for (const key of path.keys) {
    const keyPoint = [key.position[0] * zoom, key.position[1] * zoom] as const;
    if (Math.hypot(point[0] - keyPoint[0], point[1] - keyPoint[1]) <= 8) {
      return { kind: 'key', reference: { trackId: track.id, keyframeId: key.keyframeId }, origin: key.position };
    }
    for (const [vector, kind] of [[key.spatialIn, 'incoming'], [key.spatialOut, 'outgoing']] as const) {
      if (!vector) continue;
      const handlePoint = [(key.position[0] + vector[0]) * zoom, (key.position[1] + vector[1]) * zoom] as const;
      if (Math.hypot(point[0] - handlePoint[0], point[1] - handlePoint[1]) <= 8) {
        return {
          kind: 'handle', reference: { trackId: track.id, keyframeId: key.keyframeId }, handle: kind,
          keyPosition: key.position,
        };
      }
    }
  }
  return { kind: 'gizmo' };
}
