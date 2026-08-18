import type { AnimationEditorProject } from '../../domain/AnimationEditorProject';
import {
  buildPathMotionOverlay,
  movePathMotionHandle,
  movePathMotionKey,
  normalizePathMotionSelection,
} from '../../domain/PathMotionAuthoring';
import { PathGestureTransaction } from '../../domain/PathProjectAuthoring';
import type {
  PathMotionOverlay,
  PathMotionSelection,
  PathPoint,
  PathTangentMode,
  PathViewportTransform,
} from '../../domain/PathAuthoringTypes';
import {
  applyPathView,
  drawPathPoint,
  localPathPoint,
  normalizePathView,
  requiredPathContext,
  sizePathCanvas,
} from './PathCanvasShared';

export interface PathMotionCanvasAdapterOptions {
  readonly project: () => AnimationEditorProject;
  readonly trackId: () => string;
  readonly label?: string;
  readonly onPreview?: (project: AnimationEditorProject) => void;
  readonly onCommit: (project: AnimationEditorProject, label: string) => void;
  readonly onTimelineSelectionChange?: (selection: readonly PathMotionSelection[]) => void;
  readonly onExactPreviewRequested?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
}

interface MotionDrag {
  readonly pointerId: number;
  readonly selection: PathMotionSelection;
  readonly transaction: PathGestureTransaction;
  preview: AnimationEditorProject | null;
}

/** Direct spatial key/handle editor with Timeline-selection synchronization. */
export class PathMotionCanvasAdapter {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _options: PathMotionCanvasAdapterOptions;
  private _view: PathViewportTransform = Object.freeze({ zoom: 1, pan: Object.freeze([0, 0] as const) });
  private _selection: readonly PathMotionSelection[] = Object.freeze([]);
  private _tangentMode: PathTangentMode = 'unified';
  private _drag: MotionDrag | null = null;
  private _previewProject: AnimationEditorProject | null = null;
  private _frame: number | null = null;
  private _disposed = false;

  constructor(canvas: HTMLCanvasElement, options: PathMotionCanvasAdapterOptions) {
    this._canvas = canvas; this._options = options;
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    canvas.setAttribute('role', 'application'); canvas.setAttribute('aria-label', options.label ?? 'Motion path canvas editor');
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this._pointerDown);
    canvas.addEventListener('pointermove', this._pointerMove);
    canvas.addEventListener('pointerup', this._pointerUp);
    canvas.addEventListener('pointercancel', this._pointerCancel);
    canvas.addEventListener('keydown', this._keyDown);
    this.renderNow();
  }

  get selection(): readonly PathMotionSelection[] { return this._selection; }
  setView(view: PathViewportTransform): void { this._view = normalizePathView(view); this.scheduleRender(); }
  setTangentMode(mode: PathTangentMode): void { this._tangentMode = mode; }

  /** Timeline -> canvas selection half of the bidirectional contract. */
  setTimelineSelection(selection: readonly PathMotionSelection[]): void {
    this._selection = normalizePathMotionSelection(this._options.project(), selection, this._options.trackId());
    this.scheduleRender();
  }

  renderNow(): void {
    if (this._disposed) return;
    if (this._frame !== null) { cancelAnimationFrame(this._frame); this._frame = null; }
    const scale = sizePathCanvas(this._canvas); const context = requiredPathContext(this._canvas);
    context.clearRect(0, 0, this._canvas.width, this._canvas.height);
    context.save(); context.scale(scale, scale);
    context.fillStyle = '#111827'; context.fillRect(0, 0, this._canvas.clientWidth, this._canvas.clientHeight);
    context.save(); applyPathView(context, this._view);
    const project = this._previewProject ?? this._options.project();
    this._draw(context, buildPathMotionOverlay(project, this._options.trackId(), this._selection));
    context.restore(); context.restore();
  }

  scheduleRender(): void {
    if (this._disposed || this._frame !== null) return;
    this._frame = requestAnimationFrame(() => { this._frame = null; this.renderNow(); });
  }

  cancelGesture(): void {
    if (this._drag) this._drag.transaction.cancel();
    this._drag = null; this._previewProject = null; this.scheduleRender();
  }

  dispose(): void {
    if (this._disposed) return;
    if (this._drag) this.cancelGesture(); this._disposed = true;
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._canvas.removeEventListener('pointerdown', this._pointerDown);
    this._canvas.removeEventListener('pointermove', this._pointerMove);
    this._canvas.removeEventListener('pointerup', this._pointerUp);
    this._canvas.removeEventListener('pointercancel', this._pointerCancel);
    this._canvas.removeEventListener('keydown', this._keyDown);
  }

  private readonly _pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this._disposed) return;
    const before = this._options.project(); const trackId = this._options.trackId();
    const hit = hitMotion(buildPathMotionOverlay(before, trackId, this._selection), localPathPoint(this._canvas, event), this._view);
    if (!hit) {
      this._selection = Object.freeze([]); this._options.onTimelineSelectionChange?.(this._selection); this.scheduleRender(); return;
    }
    const normalized = normalizePathMotionSelection(before,
      event.shiftKey ? [...this._selection, hit] : [hit], trackId);
    this._selection = normalized; this._options.onTimelineSelectionChange?.(normalized);
    this._drag = { pointerId: event.pointerId, selection: hit, transaction: new PathGestureTransaction(before), preview: null };
    try { this._canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic fixture pointer. */ }
    this._canvas.focus({ preventScroll: true }); this.scheduleRender(); event.preventDefault();
  };

  private readonly _pointerMove = (event: PointerEvent): void => {
    if (!this._drag || this._drag.pointerId !== event.pointerId) return;
    const project = this._drag.transaction.before;
    const world = screenToWorld(localPathPoint(this._canvas, event), this._view);
    const overlay = buildPathMotionOverlay(project, this._drag.selection.trackId, [this._drag.selection]);
    const key = overlay.keys.find(item => item.keyframeId === this._drag!.selection.keyframeId)!;
    const preview = this._drag.selection.handle
      ? movePathMotionHandle(project, this._drag.selection as Required<PathMotionSelection>,
          Object.freeze([world[0] - key.position[0], world[1] - key.position[1]]), this._tangentMode)
      : movePathMotionKey(project, this._drag.selection, world);
    this._drag.preview = this._drag.transaction.previewNextProject(preview); this._previewProject = preview;
    this._options.onPreview?.(preview); this.scheduleRender(); event.preventDefault();
  };

  private readonly _pointerUp = (event: PointerEvent): void => {
    if (!this._drag || this._drag.pointerId !== event.pointerId) return;
    if (this._canvas.hasPointerCapture(event.pointerId)) this._canvas.releasePointerCapture(event.pointerId);
    const drag = this._drag; const completed = drag.transaction.complete(this._options.project());
    this._drag = null; this._previewProject = null;
    if (drag.preview && completed) {
      this._options.onCommit(completed, drag.selection.handle ? 'Edit spatial handle' : 'Edit motion path key');
      this._options.onExactPreviewRequested?.();
    }
    this.scheduleRender(); event.preventDefault();
  };

  private readonly _pointerCancel = (event: PointerEvent): void => {
    if (this._drag?.pointerId === event.pointerId) this.cancelGesture();
  };

  private readonly _keyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (event.shiftKey) this._options.onRedo?.(); else this._options.onUndo?.(); event.preventDefault(); return;
    }
    if (event.key === 'Escape') { this.cancelGesture(); event.preventDefault(); }
  };

  private _draw(context: CanvasRenderingContext2D, overlay: PathMotionOverlay): void {
    context.lineWidth = 2 / this._view.zoom; context.strokeStyle = '#38bdf8'; context.beginPath();
    overlay.points.forEach((point, index) => index ? context.lineTo(...point.position) : context.moveTo(...point.position)); context.stroke();
    for (const key of overlay.keys) {
      const selected = overlay.selectedKeyframeIds.has(key.keyframeId);
      for (const [handle, kind] of [[key.spatialIn, 'incoming'], [key.spatialOut, 'outgoing']] as const) {
        if (!handle) continue;
        const point = Object.freeze([key.position[0] + handle[0], key.position[1] + handle[1]]) as PathPoint;
        context.strokeStyle = '#fb923c'; context.lineWidth = 1 / this._view.zoom;
        context.beginPath(); context.moveTo(...key.position); context.lineTo(...point); context.stroke();
        const handleSelected = this._selection.some(item => item.keyframeId === key.keyframeId && item.handle === kind);
        drawPathPoint(context, point, (handleSelected ? 5 : 3.5) / this._view.zoom, handleSelected ? '#fbbf24' : '#fb923c');
      }
      drawPathPoint(context, key.position, (selected ? 5.5 : 4) / this._view.zoom, selected ? '#fbbf24' : '#f8fafc');
    }
  }
}

function hitMotion(
  overlay: PathMotionOverlay, screen: PathPoint, view: PathViewportTransform,
): PathMotionSelection | null {
  for (const key of overlay.keys) {
    for (const [handle, kind] of [[key.spatialIn, 'incoming'], [key.spatialOut, 'outgoing']] as const) {
      if (!handle) continue;
      const point = worldToScreen([key.position[0] + handle[0], key.position[1] + handle[1]], view);
      if (distance(point, screen) <= 9) return Object.freeze({ trackId: overlay.trackId, keyframeId: key.keyframeId, handle: kind });
    }
    if (distance(worldToScreen(key.position, view), screen) <= 9) return Object.freeze({
      trackId: overlay.trackId, keyframeId: key.keyframeId,
    });
  }
  return null;
}

function worldToScreen(point: PathPoint, view: PathViewportTransform): PathPoint {
  return Object.freeze([point[0] * view.zoom + view.pan[0], point[1] * view.zoom + view.pan[1]]);
}
function screenToWorld(point: PathPoint, view: PathViewportTransform): PathPoint {
  return Object.freeze([(point[0] - view.pan[0]) / view.zoom, (point[1] - view.pan[1]) / view.zoom]);
}
function distance(left: PathPoint, right: PathPoint): number { return Math.hypot(right[0] - left[0], right[1] - left[1]); }
