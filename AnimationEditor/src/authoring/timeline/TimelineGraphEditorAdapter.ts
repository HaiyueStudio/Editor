import type { AnimationEditorProject, AnimationEditorTrack } from '../../domain/AnimationEditorProject';
import type { TimelineKeyframeReference } from '../../domain/TimelineAuthoring';
import {
  TIMELINE_EASING_PRESETS,
  applyTimelineEasingPreset,
  buildTimelineValueCurve,
  setTimelineEasingHandle,
  setTimelineKeyframeChannelValue,
  type TimelineCurveView,
  type TimelineEasingPreset,
  type TimelineTangentMode,
} from '../../domain/TimelineProduction';
import {
  clampTimelineUnit,
  emptyTimelineAdapterMetrics,
  requiredTimelineContext,
  sameTimelineProject,
  sizeTimelineCanvas,
  timelineCanvasScale,
  timelineLocalPoint,
  type MutableTimelineAdapterMetrics,
  type TimelineAdapterMetrics,
} from './TimelineAdapterShared';

export interface TimelineGraphEditorAdapterOptions {
  readonly project: () => AnimationEditorProject;
  readonly trackId: string;
  readonly channel: number;
  readonly view: TimelineCurveView;
  readonly onPreview?: (project: AnimationEditorProject) => void;
  readonly onCommit: (project: AnimationEditorProject, label: string) => void;
  readonly onExactPreviewRequested?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly label?: string;
}

type GraphHit =
  | Readonly<{ kind: 'key'; reference: TimelineKeyframeReference }>
  | Readonly<{ kind: 'handle'; reference: TimelineKeyframeReference; handle: 'incoming' | 'outgoing' }>;

interface GraphDrag {
  readonly pointerId: number;
  readonly hit: GraphHit;
  readonly before: AnimationEditorProject;
  preview: AnimationEditorProject | null;
}

/** Value-curve editor that renders and edits against the canonical authoring sampler. */
export class TimelineGraphEditorAdapter {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _options: TimelineGraphEditorAdapterOptions;
  private _trackId: string;
  private _channel: number;
  private _view: TimelineCurveView;
  private _tangentMode: TimelineTangentMode = 'unified';
  private _drag: GraphDrag | null = null;
  private _preview: AnimationEditorProject | null = null;
  private _frame: number | null = null;
  private _disposed = false;
  private readonly _metrics: MutableTimelineAdapterMetrics = emptyTimelineAdapterMetrics();

  constructor(canvas: HTMLCanvasElement, options: TimelineGraphEditorAdapterOptions) {
    this._canvas = canvas;
    this._options = options;
    this._trackId = options.trackId;
    this._channel = options.channel;
    this._view = options.view;
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', options.label ?? 'Timeline graph editor');
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this._pointerDown);
    canvas.addEventListener('pointermove', this._pointerMove);
    canvas.addEventListener('pointerup', this._pointerUp);
    canvas.addEventListener('pointercancel', this._pointerCancel);
    canvas.addEventListener('keydown', this._keyDown);
    this.renderNow();
  }

  get metrics(): TimelineAdapterMetrics { return Object.freeze({ ...this._metrics }); }
  get tangentMode(): TimelineTangentMode { return this._tangentMode; }

  setTangentMode(mode: TimelineTangentMode): void { this._tangentMode = mode; }

  setTrack(trackId: string, channel = 0): void {
    this._trackId = trackId;
    this._channel = channel;
    this.scheduleRender();
  }

  setView(view: TimelineCurveView): void {
    this._view = view;
    this.scheduleRender();
  }

  applyPreset(reference: TimelineKeyframeReference, preset: TimelineEasingPreset): void {
    if (!(preset in TIMELINE_EASING_PRESETS)) throw new Error(`Unknown easing preset "${preset}".`);
    const project = applyTimelineEasingPreset(this._options.project(), [reference], preset);
    this._commit(project, `Apply ${preset} easing`);
  }

  setNumericValue(reference: TimelineKeyframeReference, value: number): void {
    const project = setTimelineKeyframeChannelValue(this._options.project(), reference, this._channel, value);
    this._commit(project, 'Set graph channel value');
  }

  renderNow(): void {
    if (this._disposed) return;
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    sizeTimelineCanvas(this._canvas);
    const context = requiredTimelineContext(this._canvas);
    const project = this._preview ?? this._options.project();
    const track = requiredTrack(project, this._trackId);
    const curve = buildTimelineValueCurve(track, this._channel, this._view);
    const scale = timelineCanvasScale(this._canvas);
    context.clearRect(0, 0, this._canvas.width, this._canvas.height);
    context.save();
    context.scale(scale, scale);
    drawGraphGrid(context, this._view);
    context.strokeStyle = track.color ?? '#58a6ff';
    context.lineWidth = 2;
    context.beginPath();
    curve.points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
    context.stroke();
    for (const key of curve.keyframes) {
      context.fillStyle = '#f5f7fa';
      context.beginPath();
      context.arc(key.x, key.y, 5, 0, Math.PI * 2);
      context.fill();
    }
    drawGraphHandles(context, track, this._channel, this._view);
    context.restore();
    this._metrics.renderPasses++;
    this._metrics.renderedKeyframes = curve.keyframes.length;
    this._canvas.setAttribute('aria-valuetext', `${track.name}, channel ${this._channel + 1}, ${curve.keyframes.length} visible keys`);
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
    this._preview = null;
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
    const before = this._options.project();
    const hit = hitGraph(requiredTrack(before, this._trackId), this._channel, this._view, timelineLocalPoint(this._canvas, event));
    if (!hit) return;
    this._drag = { pointerId: event.pointerId, hit, before, preview: null };
    try { this._canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic browser fixture pointer. */ }
    this._canvas.focus({ preventScroll: true });
    event.preventDefault();
  };

  private readonly _pointerMove = (event: PointerEvent): void => {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    const point = timelineLocalPoint(this._canvas, event);
    if (this._drag.hit.kind === 'key') {
      const value = valueFromGraphY(point[1], this._view);
      this._preview = setTimelineKeyframeChannelValue(
        this._drag.before, this._drag.hit.reference, this._channel, value,
      );
    } else {
      const handle = this._drag.hit;
      const track = requiredTrack(this._drag.before, handle.reference.trackId);
      const index = track.keyframes.findIndex(keyframe => keyframe.id === handle.reference.keyframeId);
      const startIndex = handle.handle === 'outgoing' ? index : index - 1;
      const start = track.keyframes[startIndex]!;
      const end = track.keyframes[startIndex + 1]!;
      const time = timeFromGraphX(point[0], this._view);
      const x = clampTimelineUnit((time - start.time) / Math.max(Number.EPSILON, end.time - start.time));
      const startValue = start.value[this._channel]!;
      const endValue = end.value[this._channel]!;
      const pointerValue = valueFromGraphY(point[1], this._view);
      const y = Math.abs(endValue - startValue) < 1e-9
        ? clampTimelineUnit(1 - point[1] / this._view.height)
        : clampTimelineUnit((pointerValue - startValue) / (endValue - startValue));
      this._preview = setTimelineEasingHandle(
        this._drag.before, handle.reference, handle.handle, [x, y], this._tangentMode,
      );
    }
    this._drag.preview = this._preview;
    this._metrics.previewUpdates++;
    this._options.onPreview?.(this._preview);
    this.scheduleRender();
    event.preventDefault();
  };

  private readonly _pointerUp = (event: PointerEvent): void => {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    if (this._canvas.hasPointerCapture(event.pointerId)) this._canvas.releasePointerCapture(event.pointerId);
    const project = sameTimelineProject(this._options.project(), this._drag.before) ? this._drag.preview : null;
    const label = this._drag.hit.kind === 'key' ? 'Edit graph channel value' : 'Edit graph easing handle';
    this._drag = null;
    this._preview = null;
    if (project) this._commit(project, label);
    else this.scheduleRender();
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

  private _commit(project: AnimationEditorProject, label: string): void {
    this._options.onCommit(project, label);
    this._metrics.commits++;
    this._metrics.exactPreviewRequests++;
    this._options.onExactPreviewRequested?.();
    this.scheduleRender();
  }
}

function drawGraphGrid(context: CanvasRenderingContext2D, view: TimelineCurveView): void {
  context.fillStyle = '#111722';
  context.fillRect(0, 0, view.width, view.height);
  context.strokeStyle = '#293142';
  for (let index = 0; index <= 4; index++) {
    const x = index / 4 * view.width + 0.5;
    const y = index / 4 * view.height + 0.5;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, view.height); context.stroke();
    context.beginPath(); context.moveTo(0, y); context.lineTo(view.width, y); context.stroke();
  }
}

function drawGraphHandles(
  context: CanvasRenderingContext2D,
  track: AnimationEditorTrack,
  channel: number,
  view: TimelineCurveView,
): void {
  for (let index = 0; index < track.keyframes.length - 1; index++) {
    const start = track.keyframes[index]!;
    const end = track.keyframes[index + 1]!;
    if (start.interpolation !== 'cubic-bezier') continue;
    const easing = start.easing ?? [0, 0, 1, 1];
    const startPoint = graphPoint(start.time, start.value[channel]!, view);
    const endPoint = graphPoint(end.time, end.value[channel]!, view);
    const outgoing = graphPoint(
      start.time + easing[0] * (end.time - start.time),
      start.value[channel]! + easing[1] * (end.value[channel]! - start.value[channel]!), view,
    );
    const incoming = graphPoint(
      start.time + easing[2] * (end.time - start.time),
      start.value[channel]! + easing[3] * (end.value[channel]! - start.value[channel]!), view,
    );
    context.strokeStyle = '#f0a45d';
    context.beginPath(); context.moveTo(startPoint[0], startPoint[1]); context.lineTo(outgoing[0], outgoing[1]); context.stroke();
    context.beginPath(); context.moveTo(endPoint[0], endPoint[1]); context.lineTo(incoming[0], incoming[1]); context.stroke();
    context.fillStyle = '#f0a45d';
    for (const point of [outgoing, incoming]) {
      context.beginPath(); context.arc(point[0], point[1], 4, 0, Math.PI * 2); context.fill();
    }
  }
}

function hitGraph(
  track: AnimationEditorTrack,
  channel: number,
  view: TimelineCurveView,
  point: readonly [number, number],
): GraphHit | null {
  const curve = buildTimelineValueCurve(track, channel, view);
  for (const keyframe of curve.keyframes) {
    if (Math.hypot(point[0] - keyframe.x, point[1] - keyframe.y) <= 8) {
      return { kind: 'key', reference: { trackId: track.id, keyframeId: keyframe.keyframeId } };
    }
  }
  for (let index = 0; index < track.keyframes.length - 1; index++) {
    const start = track.keyframes[index]!;
    const end = track.keyframes[index + 1]!;
    if (start.interpolation !== 'cubic-bezier') continue;
    const easing = start.easing ?? [0, 0, 1, 1];
    const handles = [
      {
        point: graphPoint(start.time + easing[0] * (end.time - start.time),
          start.value[channel]! + easing[1] * (end.value[channel]! - start.value[channel]!), view),
        value: { kind: 'handle', reference: { trackId: track.id, keyframeId: start.id }, handle: 'outgoing' } as const,
      },
      {
        point: graphPoint(start.time + easing[2] * (end.time - start.time),
          start.value[channel]! + easing[3] * (end.value[channel]! - start.value[channel]!), view),
        value: { kind: 'handle', reference: { trackId: track.id, keyframeId: end.id }, handle: 'incoming' } as const,
      },
    ];
    for (const handle of handles) if (Math.hypot(point[0] - handle.point[0], point[1] - handle.point[1]) <= 8) return handle.value;
  }
  return null;
}

function graphPoint(time: number, value: number, view: TimelineCurveView): readonly [number, number] {
  return [
    (time - view.timeStart) / (view.timeEnd - view.timeStart) * view.width,
    view.height - (value - view.valueMin) / (view.valueMax - view.valueMin) * view.height,
  ];
}

function timeFromGraphX(x: number, view: TimelineCurveView): number {
  return view.timeStart + clampTimelineUnit(x / view.width) * (view.timeEnd - view.timeStart);
}

function valueFromGraphY(y: number, view: TimelineCurveView): number {
  return view.valueMin + (1 - clampTimelineUnit(y / view.height)) * (view.valueMax - view.valueMin);
}

function requiredTrack(project: AnimationEditorProject, trackId: string): AnimationEditorTrack {
  const track = project.timeline.tracks.find(candidate => candidate.id === trackId);
  if (!track) throw new Error(`Unknown track "${trackId}".`);
  return track;
}
