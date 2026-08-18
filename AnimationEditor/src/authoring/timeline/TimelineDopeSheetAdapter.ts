import type { AnimationEditorProject } from '../../domain/AnimationEditorProject';
import type { TimelineKeyframeReference } from '../../domain/TimelineAuthoring';
import {
  TimelineGestureTransaction,
  computeVisibleTimelineKeyframes,
  planTimelineEdit,
  resolveTimelineSnap,
  selectTimelineKeyframesInRect,
  type TimelineEditPlan,
  type TimelineRect,
  type TimelineSnapOptions,
  type TimelineViewportWindow,
  type VisibleTimelineKeyframe,
} from '../../domain/TimelineProduction';
import {
  emptyTimelineAdapterMetrics,
  requiredTimelineContext,
  sizeTimelineCanvas,
  timelineCanvasScale,
  timelineLocalPoint,
  type MutableTimelineAdapterMetrics,
  type TimelineAdapterMetrics,
} from './TimelineAdapterShared';

export interface TimelineCanvasAdapterOptions {
  readonly project: () => AnimationEditorProject;
  readonly onPreview?: (project: AnimationEditorProject, plan: TimelineEditPlan) => void;
  readonly onCommit: (
    project: AnimationEditorProject,
    label: string,
    selection: readonly TimelineKeyframeReference[],
  ) => void;
  readonly onSelectionChange?: (selection: readonly TimelineKeyframeReference[]) => void;
  readonly onSeek?: (time: number) => void;
  readonly onDelete?: (selection: readonly TimelineKeyframeReference[]) => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly snap?: () => TimelineSnapOptions;
  readonly onExactPreviewRequested?: () => void;
  readonly label?: string;
}

type CanvasDrag =
  | {
      readonly kind: 'move';
      readonly pointerId: number;
      readonly originX: number;
      readonly transaction: TimelineGestureTransaction;
    }
  | {
      readonly kind: 'marquee';
      readonly pointerId: number;
      readonly origin: readonly [number, number];
      readonly baseSelection: readonly TimelineKeyframeReference[];
      current: readonly [number, number];
      readonly mode: 'replace' | 'add' | 'toggle';
    };

/** Virtualized dope sheet that commits one transaction and exact preview per gesture. */
export class TimelineCanvasAdapter {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _options: TimelineCanvasAdapterOptions;
  private _view: TimelineViewportWindow;
  private _selection: readonly TimelineKeyframeReference[] = Object.freeze([]);
  private _clipboard: readonly TimelineKeyframeReference[] = Object.freeze([]);
  private _preview: TimelineEditPlan | null = null;
  private _drag: CanvasDrag | null = null;
  private _frame: number | null = null;
  private _disposed = false;
  private readonly _metrics: MutableTimelineAdapterMetrics = emptyTimelineAdapterMetrics();

  constructor(canvas: HTMLCanvasElement, view: TimelineViewportWindow, options: TimelineCanvasAdapterOptions) {
    this._canvas = canvas;
    this._view = normalizeViewport(view);
    this._options = options;
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    canvas.setAttribute('role', 'grid');
    canvas.setAttribute('aria-label', options.label ?? 'Timeline dope sheet');
    canvas.setAttribute('aria-multiselectable', 'true');
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this._pointerDown);
    canvas.addEventListener('pointermove', this._pointerMove);
    canvas.addEventListener('pointerup', this._pointerUp);
    canvas.addEventListener('pointercancel', this._pointerCancel);
    canvas.addEventListener('keydown', this._keyDown);
    this.renderNow();
  }

  get selection(): readonly TimelineKeyframeReference[] { return this._selection; }
  get metrics(): TimelineAdapterMetrics { return Object.freeze({ ...this._metrics }); }

  setView(view: TimelineViewportWindow): void {
    this._view = normalizeViewport(view);
    this.scheduleRender();
  }

  setSelection(selection: readonly TimelineKeyframeReference[]): void {
    this._selection = uniqueReferences(selection);
    this._announceSelection();
    this.scheduleRender();
  }

  renderNow(): void {
    if (this._disposed) return;
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    sizeTimelineCanvas(this._canvas);
    const context = requiredTimelineContext(this._canvas);
    const project = this._options.project();
    const visible = computeVisibleTimelineKeyframes(project, this._view);
    context.clearRect(0, 0, this._canvas.width, this._canvas.height);
    context.save();
    context.scale(timelineCanvasScale(this._canvas), timelineCanvasScale(this._canvas));
    drawTimelineGrid(context, this._view, project.timeline.tracks.length);
    const selected = new Set(this._selection.map(referenceKey));
    const previewTimes = new Map(this._preview?.targets.map(target => [referenceKey(target), target.targetTime]) ?? []);
    const collisions = new Set(this._preview?.collisions.flatMap(collision => (
      [...collision.keyframeIds, ...(collision.occupiedBy ? [collision.occupiedBy] : [])]
        .map(keyframeId => referenceKey({ trackId: collision.trackId, keyframeId }))
    )) ?? []);
    for (const keyframe of visible) {
      const previewTime = previewTimes.get(referenceKey(keyframe));
      const x = previewTime === undefined
        ? keyframe.x
        : (previewTime - this._view.timeStart) / (this._view.timeEnd - this._view.timeStart) * this._view.width;
      drawDiamond(context, x, keyframe.y, selected.has(referenceKey(keyframe)), !collisions.has(referenceKey(keyframe)));
    }
    if (this._drag?.kind === 'marquee') drawMarquee(context, this._drag.origin, this._drag.current);
    context.restore();
    this._metrics.renderPasses++;
    this._metrics.renderedKeyframes = visible.length;
    this._canvas.setAttribute('aria-rowcount', String(project.timeline.tracks.length));
    this._canvas.setAttribute('aria-colcount', String(Math.round(project.composition.duration * project.composition.frameRate) + 1));
  }

  scheduleRender(): void {
    if (this._disposed || this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.renderNow();
    });
  }

  cancelGesture(): void {
    if (this._drag?.kind === 'move' && this._drag.transaction.state === 'active') this._drag.transaction.cancel();
    this._drag = null;
    this._preview = null;
    this.scheduleRender();
  }

  dispose(): void {
    if (this._disposed) return;
    this.cancelGesture();
    this._disposed = true;
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._canvas.removeEventListener('pointerdown', this._pointerDown);
    this._canvas.removeEventListener('pointermove', this._pointerMove);
    this._canvas.removeEventListener('pointerup', this._pointerUp);
    this._canvas.removeEventListener('pointercancel', this._pointerCancel);
    this._canvas.removeEventListener('keydown', this._keyDown);
  }

  private readonly _pointerDown = (event: PointerEvent): void => {
    if (this._disposed || event.button !== 0) return;
    const point = timelineLocalPoint(this._canvas, event);
    const hit = hitTimelineKeyframe(this._options.project(), this._view, point);
    if (hit) {
      const reference = Object.freeze({ trackId: hit.trackId, keyframeId: hit.keyframeId });
      const preserveMultiSelection = !event.shiftKey && !event.metaKey && !event.ctrlKey
        && this._selection.length > 1
        && this._selection.some(candidate => referenceKey(candidate) === referenceKey(reference));
      if (!preserveMultiSelection) {
        this._selection = updateSelection(this._selection, reference, event.shiftKey, event.metaKey || event.ctrlKey);
      }
      this._options.onSelectionChange?.(this._selection);
      this._announceSelection();
      this._drag = {
        kind: 'move', pointerId: event.pointerId, originX: point[0],
        transaction: new TimelineGestureTransaction(this._options.project(), this._selection),
      };
    } else {
      this._drag = {
        kind: 'marquee', pointerId: event.pointerId, origin: point, current: point,
        baseSelection: this._selection,
        mode: event.metaKey || event.ctrlKey ? 'toggle' : event.shiftKey ? 'add' : 'replace',
      };
    }
    try { this._canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic browser fixture pointer. */ }
    this._canvas.focus({ preventScroll: true });
    event.preventDefault();
  };

  private readonly _pointerMove = (event: PointerEvent): void => {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    const point = timelineLocalPoint(this._canvas, event);
    if (this._drag.kind === 'marquee') {
      this._drag.current = point;
      const rect: TimelineRect = {
        left: this._drag.origin[0], top: this._drag.origin[1], right: point[0], bottom: point[1],
      };
      this._selection = selectTimelineKeyframesInRect(
        this._options.project(), this._view, rect, this._drag.baseSelection, this._drag.mode,
      );
      this._options.onSelectionChange?.(this._selection);
      this._announceSelection();
    } else {
      let deltaTime = (point[0] - this._drag.originX) / this._view.width
        * (this._view.timeEnd - this._view.timeStart);
      const snapOptions = this._options.snap?.();
      const anchorReference = this._selection[0];
      const anchor = anchorReference
        ? this._drag.transaction.before.timeline.tracks.find(track => track.id === anchorReference.trackId)
          ?.keyframes.find(keyframe => keyframe.id === anchorReference.keyframeId)
        : null;
      if (snapOptions && anchor) {
        const snapped = resolveTimelineSnap(this._drag.transaction.before, anchor.time + deltaTime, {
          ...snapOptions,
          exclude: this._selection,
        });
        deltaTime = snapped.time - anchor.time;
      }
      this._preview = this._drag.transaction.preview({ kind: 'move', deltaTime });
      this._metrics.previewUpdates++;
      this._metrics.collisions = this._preview.collisions.length;
      this._options.onPreview?.(this._preview.project, this._preview);
    }
    this.scheduleRender();
    event.preventDefault();
  };

  private readonly _pointerUp = (event: PointerEvent): void => {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    if (this._canvas.hasPointerCapture(event.pointerId)) this._canvas.releasePointerCapture(event.pointerId);
    if (this._drag.kind === 'move' && this._preview?.valid) {
      const project = this._drag.transaction.complete(this._options.project());
      if (project) {
        this._selection = this._preview.selection;
        this._options.onCommit(project, 'Move timeline keyframes', this._selection);
        this._metrics.commits++;
        this._requestExactPreview();
      }
    } else if (this._drag.kind === 'move' && this._drag.transaction.state === 'active') {
      this._drag.transaction.cancel();
    }
    this._drag = null;
    this._preview = null;
    this.scheduleRender();
    event.preventDefault();
  };

  private readonly _pointerCancel = (event: PointerEvent): void => {
    if (this._drag && event.pointerId === this._drag.pointerId) this.cancelGesture();
  };

  private readonly _keyDown = (event: KeyboardEvent): void => {
    if (this._disposed) return;
    if (event.key === 'Escape') {
      this.cancelGesture();
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
      this._clipboard = this._selection;
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (event.shiftKey) this._options.onRedo?.();
      else this._options.onUndo?.();
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v' && this._clipboard.length > 0) {
      const project = this._options.project();
      const plan = planTimelineEdit(project, this._clipboard, { kind: 'copy', deltaTime: 1 / project.composition.frameRate });
      if (plan.valid) this._commitPlan(plan, 'Copy timeline keyframes');
      event.preventDefault();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      this._options.onDelete?.(this._selection);
      event.preventDefault();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      this._options.onSeek?.(event.key === 'Home' ? 0 : this._options.project().composition.duration);
      event.preventDefault();
      return;
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && this._selection.length > 0) {
      const project = this._options.project();
      const frames = event.shiftKey ? 10 : 1;
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const plan = planTimelineEdit(project, this._selection, {
        kind: 'move', deltaTime: direction * frames / project.composition.frameRate,
      });
      if (plan.valid) this._commitPlan(plan, 'Nudge timeline keyframes');
      event.preventDefault();
    }
  };

  private _commitPlan(plan: TimelineEditPlan, label: string): void {
    this._selection = plan.selection;
    this._options.onCommit(plan.project, label, this._selection);
    this._metrics.commits++;
    this._requestExactPreview();
    this._announceSelection();
    this.scheduleRender();
  }

  private _requestExactPreview(): void {
    this._metrics.exactPreviewRequests++;
    this._options.onExactPreviewRequested?.();
  }

  private _announceSelection(): void {
    this._canvas.setAttribute('aria-valuetext', `${this._selection.length} keyframe${this._selection.length === 1 ? '' : 's'} selected`);
  }
}

function drawTimelineGrid(context: CanvasRenderingContext2D, view: TimelineViewportWindow, trackCount: number): void {
  context.fillStyle = '#111722';
  context.fillRect(0, 0, view.width, (view.trackEnd - view.trackStart) * view.laneHeight);
  context.strokeStyle = '#293142';
  context.lineWidth = 1;
  for (let track = view.trackStart; track <= Math.min(view.trackEnd, trackCount); track++) {
    const y = (track - view.trackStart) * view.laneHeight + 0.5;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(view.width, y);
    context.stroke();
  }
}

function drawDiamond(context: CanvasRenderingContext2D, x: number, y: number, selected: boolean, valid: boolean): void {
  context.save();
  context.translate(x, y);
  context.rotate(Math.PI / 4);
  context.fillStyle = valid ? selected ? '#ffbf69' : '#66b3ff' : '#ff5f6d';
  context.fillRect(-5, -5, 10, 10);
  context.restore();
}

function drawMarquee(
  context: CanvasRenderingContext2D,
  origin: readonly [number, number],
  current: readonly [number, number],
): void {
  const left = Math.min(origin[0], current[0]);
  const top = Math.min(origin[1], current[1]);
  context.fillStyle = 'rgba(88,166,255,0.15)';
  context.strokeStyle = '#58a6ff';
  context.fillRect(left, top, Math.abs(current[0] - origin[0]), Math.abs(current[1] - origin[1]));
  context.strokeRect(left, top, Math.abs(current[0] - origin[0]), Math.abs(current[1] - origin[1]));
}

function hitTimelineKeyframe(
  project: AnimationEditorProject,
  view: TimelineViewportWindow,
  point: readonly [number, number],
): VisibleTimelineKeyframe | null {
  let best: VisibleTimelineKeyframe | null = null;
  let distance = 9;
  for (const keyframe of computeVisibleTimelineKeyframes(project, view)) {
    const candidate = Math.hypot(point[0] - keyframe.x, point[1] - keyframe.y);
    if (candidate <= distance) {
      distance = candidate;
      best = keyframe;
    }
  }
  return best;
}

function updateSelection(
  current: readonly TimelineKeyframeReference[],
  reference: TimelineKeyframeReference,
  additive: boolean,
  toggle: boolean,
): readonly TimelineKeyframeReference[] {
  const key = referenceKey(reference);
  const index = current.findIndex(candidate => referenceKey(candidate) === key);
  if (toggle && index >= 0) return Object.freeze(current.filter((_candidate, candidateIndex) => candidateIndex !== index));
  if (additive || toggle) return index >= 0 ? current : Object.freeze([...current, reference]);
  return Object.freeze([reference]);
}

function uniqueReferences(values: readonly TimelineKeyframeReference[]): readonly TimelineKeyframeReference[] {
  return Object.freeze([...new Map(values.map(value => [referenceKey(value), Object.freeze({ ...value })])).values()]);
}

function referenceKey(reference: TimelineKeyframeReference): string { return `${reference.trackId}\u0000${reference.keyframeId}`; }

function normalizeViewport(view: TimelineViewportWindow): TimelineViewportWindow {
  if (!(view.timeEnd > view.timeStart) || view.width <= 0 || view.laneHeight <= 0) {
    throw new Error('Timeline viewport requires positive time, width and lane spans.');
  }
  return Object.freeze({ ...view });
}
