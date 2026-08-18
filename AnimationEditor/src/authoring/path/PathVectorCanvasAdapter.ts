import type { AnimationEditorProject } from '../../domain/AnimationEditorProject';
import {
  appendPathCommand,
  closeAuthoringPath,
  deletePathPoint,
  duplicateAuthoringPath,
  hitTestAuthoringPath,
  movePathPoint,
  openAuthoringPath,
  pathScreenToWorld,
  reverseAuthoringPath,
  splitPathCommand,
  worldToPathScreen,
} from '../../domain/PathCommandAuthoring';
import { pathMorphCorrespondence, sampleProjectMorphPath } from '../../domain/PathMorphAuthoring';
import {
  PathGestureTransaction,
  readProjectAuthoringPath,
  replacePathComponentGeometry,
} from '../../domain/PathProjectAuthoring';
import { buildPathOverlayContours, resolveProjectPathVectorStyle } from '../../domain/PathPaintAuthoring';
import type {
  AuthoringPath,
  PathCommandKind,
  PathMorphCorrespondence,
  PathPoint,
  PathPointReference,
  PathTangentMode,
  PathVectorStyle,
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
import { PathGeometryCache, type PathGeometryCacheOptions } from './PathGeometryCache';

export interface PathVectorCanvasAdapterOptions {
  readonly project: () => AnimationEditorProject;
  readonly nodeId: string;
  readonly componentId: string;
  readonly time?: () => number;
  readonly cache?: PathGeometryCacheOptions;
  readonly label?: string;
  readonly onPreview?: (project: AnimationEditorProject) => void;
  readonly onCommit: (project: AnimationEditorProject, label: string) => void;
  readonly onExactPreviewRequested?: () => void;
  readonly onSelectionChange?: (selection: PathPointReference | null) => void;
  readonly onDuplicate?: (path: AuthoringPath) => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
}

interface DragState {
  readonly pointerId: number;
  readonly transaction: PathGestureTransaction;
  readonly reference: PathPointReference;
  readonly beforePath: AuthoringPath;
  previewPath: AuthoringPath;
}

export interface PathVectorAdapterMetrics {
  readonly renderPasses: number;
  readonly previewUpdates: number;
  readonly commits: number;
  readonly cancels: number;
  readonly exactPreviewRequests: number;
}

/** Leaf canvas adapter for vector geometry. Shell/inspector wiring is intentionally deferred to G09. */
export class PathVectorCanvasAdapter {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _options: PathVectorCanvasAdapterOptions;
  private readonly _cache: PathGeometryCache;
  private _view: PathViewportTransform = Object.freeze({ zoom: 1, pan: Object.freeze([0, 0] as const) });
  private _tool: 'select' | 'pen' = 'select';
  private _penCommand: Exclude<PathCommandKind, 'M'> = 'L';
  private _tangentMode: PathTangentMode = 'unified';
  private _selection: PathPointReference | null = null;
  private _drag: DragState | null = null;
  private _previewPath: AuthoringPath | null = null;
  private _morphTarget: AuthoringPath | null = null;
  private _correspondence: readonly PathMorphCorrespondence[] = Object.freeze([]);
  private _onionTimes: readonly number[] = Object.freeze([]);
  private _frame: number | null = null;
  private _disposed = false;
  private _renderPasses = 0;
  private _previewUpdates = 0;
  private _commits = 0;
  private _cancels = 0;
  private _exactPreviewRequests = 0;

  constructor(canvas: HTMLCanvasElement, options: PathVectorCanvasAdapterOptions) {
    this._canvas = canvas; this._options = options; this._cache = new PathGeometryCache(options.cache);
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', options.label ?? 'Vector path canvas editor');
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this._pointerDown);
    canvas.addEventListener('pointermove', this._pointerMove);
    canvas.addEventListener('pointerup', this._pointerUp);
    canvas.addEventListener('pointercancel', this._pointerCancel);
    canvas.addEventListener('dblclick', this._doubleClick);
    canvas.addEventListener('keydown', this._keyDown);
    this.renderNow();
  }

  get selection(): PathPointReference | null { return this._selection; }
  get cacheMetrics() { return this._cache.metrics; }
  get metrics(): PathVectorAdapterMetrics {
    return Object.freeze({
      renderPasses: this._renderPasses, previewUpdates: this._previewUpdates, commits: this._commits,
      cancels: this._cancels, exactPreviewRequests: this._exactPreviewRequests,
    });
  }

  setView(view: PathViewportTransform): void { this._view = normalizePathView(view); this.scheduleRender(); }
  setTool(tool: 'select' | 'pen'): void { this._tool = tool; this._canvas.setAttribute('aria-valuetext', tool); }
  setPenCommand(command: Exclude<PathCommandKind, 'M'>): void { this._penCommand = command; }
  setTangentMode(mode: PathTangentMode): void { this._tangentMode = mode; }
  setOnionSkinTimes(times: readonly number[]): void {
    this._onionTimes = Object.freeze(times.filter(Number.isFinite).slice(0, 4)); this.scheduleRender();
  }
  setMorphTarget(target: AuthoringPath | null): void {
    const base = readProjectAuthoringPath(this._options.project(), this._options.nodeId, this._options.componentId);
    this._morphTarget = target; this._correspondence = target ? pathMorphCorrespondence(base, target) : Object.freeze([]);
    this.scheduleRender();
  }

  select(reference: PathPointReference | null): void {
    this._selection = reference ? Object.freeze({ ...reference }) : null;
    this._options.onSelectionChange?.(this._selection); this.scheduleRender();
  }

  closePath(): void { this._commitPath(closeAuthoringPath(this._currentPath()), 'Close path'); }
  openPath(): void { this._commitPath(openAuthoringPath(this._currentPath()), 'Open path'); }
  reversePath(): void { this._commitPath(reverseAuthoringPath(this._currentPath()), 'Reverse path'); }
  duplicatePath(id: string): AuthoringPath {
    const duplicate = duplicateAuthoringPath(this._currentPath(), id); this._options.onDuplicate?.(duplicate); return duplicate;
  }
  deleteSelection(): void {
    if (!this._selection) return;
    this._commitPath(deletePathPoint(this._currentPath(), this._selection), 'Delete path point'); this.select(null);
  }
  insertAtSelection(t = 0.5): void {
    if (!this._selection) return;
    const path = splitPathCommand(this._currentPath(), this._selection.commandId, t);
    this._commitPath(path, 'Insert path point');
  }

  renderNow(): void {
    if (this._disposed) return;
    if (this._frame !== null) { cancelAnimationFrame(this._frame); this._frame = null; }
    const pixelScale = sizePathCanvas(this._canvas);
    const context = requiredPathContext(this._canvas);
    context.clearRect(0, 0, this._canvas.width, this._canvas.height);
    context.save(); context.scale(pixelScale, pixelScale);
    this._drawChecker(context);
    context.save(); applyPathView(context, this._view);
    const project = this._options.project();
    const path = this._previewPath ?? readProjectAuthoringPath(project, this._options.nodeId, this._options.componentId);
    const style = resolveProjectPathVectorStyle(project, this._options.nodeId, this._options.componentId, this._options.time?.() ?? 0);
    for (const time of this._onionTimes) this._drawPath(context,
      sampleProjectMorphPath(project, this._options.nodeId, this._options.componentId, time), style, 0.14, false);
    if (this._morphTarget) this._drawPath(context, this._morphTarget, style, 0.2, false);
    this._drawPath(context, path, style, 1, true);
    this._drawHandles(context, path);
    this._drawCorrespondence(context);
    context.restore(); context.restore();
    this._renderPasses++;
  }

  scheduleRender(): void {
    if (this._disposed || this._frame !== null) return;
    this._frame = requestAnimationFrame(() => { this._frame = null; this.renderNow(); });
  }

  cancelGesture(): void {
    if (this._drag) this._drag.transaction.cancel();
    this._drag = null; this._previewPath = null; this._cancels++; this.scheduleRender();
  }

  dispose(): void {
    if (this._disposed) return;
    if (this._drag) this.cancelGesture();
    this._disposed = true;
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._canvas.removeEventListener('pointerdown', this._pointerDown);
    this._canvas.removeEventListener('pointermove', this._pointerMove);
    this._canvas.removeEventListener('pointerup', this._pointerUp);
    this._canvas.removeEventListener('pointercancel', this._pointerCancel);
    this._canvas.removeEventListener('dblclick', this._doubleClick);
    this._canvas.removeEventListener('keydown', this._keyDown);
    this._cache.clear();
  }

  private readonly _pointerDown = (event: PointerEvent): void => {
    if (this._disposed || event.button !== 0) return;
    const screen = localPathPoint(this._canvas, event);
    const path = this._currentPath();
    if (this._tool === 'pen') {
      this._appendAt(pathScreenToWorld(screen, this._view));
      event.preventDefault(); return;
    }
    const hit = hitTestAuthoringPath(path, screen, this._view, 9);
    if (!hit || hit.kind !== 'point') { this.select(null); return; }
    this.select(hit.reference);
    this._drag = {
      pointerId: event.pointerId, transaction: new PathGestureTransaction(this._options.project()),
      reference: hit.reference, beforePath: path, previewPath: path,
    };
    try { this._canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic fixture pointer. */ }
    this._canvas.focus({ preventScroll: true }); event.preventDefault();
  };

  private readonly _pointerMove = (event: PointerEvent): void => {
    if (!this._drag || this._drag.pointerId !== event.pointerId) return;
    const point = pathScreenToWorld(localPathPoint(this._canvas, event), this._view);
    const path = movePathPoint(this._drag.beforePath, this._drag.reference, point, this._tangentMode);
    const preview = this._drag.transaction.previewPath(this._options.nodeId, this._options.componentId, path);
    this._drag.previewPath = path; this._previewPath = path; this._previewUpdates++;
    this._options.onPreview?.(preview); this.scheduleRender(); event.preventDefault();
  };

  private readonly _pointerUp = (event: PointerEvent): void => {
    if (!this._drag || this._drag.pointerId !== event.pointerId) return;
    if (this._canvas.hasPointerCapture(event.pointerId)) this._canvas.releasePointerCapture(event.pointerId);
    const drag = this._drag; const completed = drag.transaction.complete(this._options.project());
    this._drag = null; this._previewPath = null;
    if (completed && drag.previewPath !== drag.beforePath) this._publish(completed, 'Move path point');
    else this.scheduleRender();
    event.preventDefault();
  };

  private readonly _pointerCancel = (event: PointerEvent): void => {
    if (this._drag?.pointerId === event.pointerId) this.cancelGesture();
  };

  private readonly _doubleClick = (event: MouseEvent): void => {
    const hit = hitTestAuthoringPath(this._currentPath(), localMousePoint(this._canvas, event), this._view, 9);
    if (hit?.kind === 'segment') {
      this._commitPath(splitPathCommand(this._currentPath(), hit.commandId, hit.t), 'Insert path point');
      event.preventDefault();
    }
  };

  private readonly _keyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (event.shiftKey) this._options.onRedo?.(); else this._options.onUndo?.(); event.preventDefault(); return;
    }
    if (event.key === 'Escape') { this.cancelGesture(); event.preventDefault(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { this.deleteSelection(); event.preventDefault(); }
  };

  private _appendAt(point: PathPoint): void {
    const path = this._currentPath();
    const last = path.commands.at(-1);
    let next: AuthoringPath;
    if (this._penCommand === 'Z') next = closeAuthoringPath(path);
    else if (last?.kind === 'Z') next = appendPathCommand(path, { kind: 'M', end: point });
    else if (this._penCommand === 'L') next = appendPathCommand(path, { kind: 'L', end: point });
    else {
      const previous = last?.end ?? point;
      if (this._penCommand === 'Q') next = appendPathCommand(path, {
        kind: 'Q', control: midpoint(previous, point, 0.5, -28), end: point,
      });
      else next = appendPathCommand(path, {
        kind: 'C', controlOut: midpoint(previous, point, 1 / 3, -24),
        controlIn: midpoint(previous, point, 2 / 3, 24), end: point,
      });
    }
    this._commitPath(next, `Draw ${this._penCommand} path command`);
  }

  private _commitPath(path: AuthoringPath, label: string): void {
    const project = replacePathComponentGeometry(this._options.project(), this._options.nodeId, this._options.componentId, path);
    this._publish(project, label);
  }

  private _publish(project: AnimationEditorProject, label: string): void {
    this._options.onCommit(project, label); this._commits++; this._exactPreviewRequests++;
    this._options.onExactPreviewRequested?.(); this.scheduleRender();
  }

  private _currentPath(): AuthoringPath {
    return this._previewPath ?? readProjectAuthoringPath(this._options.project(), this._options.nodeId, this._options.componentId);
  }

  private _drawPath(
    context: CanvasRenderingContext2D, path: AuthoringPath, style: PathVectorStyle, alpha: number, exactStyle: boolean,
  ): void {
    const flattened = this._cache.get(path, style.tolerance);
    const contours = buildPathOverlayContours(path, style.modifiers, style.tolerance, flattened);
    context.save(); context.globalAlpha *= alpha;
    for (const contour of contours) {
      if (contour.points.length < 2) continue;
      context.beginPath(); context.moveTo(contour.points[0]![0], contour.points[0]![1]);
      for (let index = 1; index < contour.points.length; index++) context.lineTo(contour.points[index]![0], contour.points[index]![1]);
      if (contour.closed) context.closePath();
      if (style.fill && contour.closed) {
        context.fillStyle = exactStyle ? canvasFill(context, style.fill) : '#7dd3fc';
        context.globalAlpha *= style.fill.opacity; context.fill(style.fillRule); context.globalAlpha /= Math.max(style.fill.opacity, 1e-9);
      }
      if (style.stroke) {
        context.strokeStyle = rgbaCss(style.stroke.color, style.stroke.opacity); context.lineWidth = style.stroke.width;
        context.lineCap = style.stroke.lineCap; context.lineJoin = style.stroke.lineJoin; context.miterLimit = style.stroke.miterLimit;
        context.setLineDash([...style.stroke.dash]); context.lineDashOffset = style.stroke.dashOffset; context.stroke();
      } else if (!style.fill) { context.strokeStyle = '#7dd3fc'; context.lineWidth = 1 / this._view.zoom; context.stroke(); }
    }
    context.restore();
  }

  private _drawHandles(context: CanvasRenderingContext2D, path: AuthoringPath): void {
    context.save(); context.lineWidth = 1 / this._view.zoom;
    for (const command of path.commands) {
      if (command.kind === 'Z') continue;
      if (command.kind === 'Q') this._drawControl(context, command.end, command.control);
      else if (command.kind === 'C') {
        this._drawControl(context, command.end, command.controlIn);
        const previous = previousEnd(path, command.id); if (previous) this._drawControl(context, previous, command.controlOut);
      }
      const selected = this._selection?.commandId === command.id && this._selection.part === 'end';
      drawPathPoint(context, command.end, (selected ? 5 : 3.5) / this._view.zoom, selected ? '#fbbf24' : '#f8fafc');
    }
    context.restore();
  }

  private _drawControl(context: CanvasRenderingContext2D, anchor: PathPoint, control: PathPoint): void {
    context.strokeStyle = '#fb923c'; context.beginPath(); context.moveTo(anchor[0], anchor[1]); context.lineTo(control[0], control[1]); context.stroke();
    drawPathPoint(context, control, 3 / this._view.zoom, '#fb923c');
  }

  private _drawCorrespondence(context: CanvasRenderingContext2D): void {
    context.save(); context.lineWidth = 1 / this._view.zoom; context.setLineDash([4 / this._view.zoom, 3 / this._view.zoom]);
    for (const item of this._correspondence) {
      context.strokeStyle = 'rgba(192,132,252,.65)'; context.beginPath(); context.moveTo(...item.from); context.lineTo(...item.to); context.stroke();
    }
    context.restore();
  }

  private _drawChecker(context: CanvasRenderingContext2D): void {
    const size = 16;
    context.fillStyle = '#151923'; context.fillRect(0, 0, this._canvas.clientWidth, this._canvas.clientHeight);
    context.fillStyle = '#1d2330';
    for (let y = 0; y < this._canvas.clientHeight; y += size) for (let x = (y / size) % 2 ? size : 0; x < this._canvas.clientWidth; x += size * 2) context.fillRect(x, y, size, size);
  }
}

function canvasFill(context: CanvasRenderingContext2D, fill: PathVectorStyle['fill']): string | CanvasGradient {
  if (!fill || fill.kind === 'solid') return rgbaCss(fill?.color ?? [0, 0, 0, 0], 1);
  const gradient = fill.kind === 'linear-gradient'
    ? context.createLinearGradient(...fill.start, ...fill.end)
    : context.createRadialGradient(fill.start[0], fill.start[1], 0, fill.end[0], fill.end[1], Math.max(1, distance(fill.start, fill.end)));
  for (let index = 0; index < fill.stops.length; index += 5) gradient.addColorStop(fill.stops[index]!, rgbaCss(
    [fill.stops[index + 1]!, fill.stops[index + 2]!, fill.stops[index + 3]!, fill.stops[index + 4]!], 1,
  ));
  return gradient;
}

function rgbaCss(color: readonly [number, number, number, number], opacity: number): string {
  return `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${color[3] * opacity})`;
}
function localMousePoint(canvas: HTMLCanvasElement, event: MouseEvent): PathPoint {
  const bounds = canvas.getBoundingClientRect(); return Object.freeze([event.clientX - bounds.left, event.clientY - bounds.top]);
}
function midpoint(from: PathPoint, to: PathPoint, ratio: number, bend: number): PathPoint {
  const dx = to[0] - from[0]; const dy = to[1] - from[1]; const length = Math.max(1, Math.hypot(dx, dy));
  return Object.freeze([from[0] + dx * ratio - dy / length * bend, from[1] + dy * ratio + dx / length * bend]);
}
function previousEnd(path: AuthoringPath, commandId: string): PathPoint | null {
  const index = path.commands.findIndex(command => command.id === commandId);
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const command = path.commands[cursor]!; if (command.kind !== 'Z') return command.end;
  }
  return null;
}
function distance(left: PathPoint, right: PathPoint): number { return Math.hypot(right[0] - left[0], right[1] - left[1]); }

// Kept referenced for consumers that want exact screen-space selection probes.
export function pathPointScreenPosition(point: PathPoint, view: PathViewportTransform): PathPoint {
  return worldToPathScreen(point, view);
}
