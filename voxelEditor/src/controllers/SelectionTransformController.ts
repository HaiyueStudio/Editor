import type { RenderableVoxel, Voxel } from '../model';
import {
  rotateVoxels90AroundPivot,
  resizeVoxelsAlongAxis,
  selectionPivot,
  snapTransformSteps,
  translateVoxels,
} from '../selectionTransform';
import type { SelectionPivot, SelectionPivotMode, TransformAxis } from '../selectionTransform';
import type { SelectionGizmoMode, VoxelRenderer } from '../VoxelRenderer';

interface SelectionTransformSession {
  axis: TransformAxis;
  mode: SelectionGizmoMode;
  duplicate: boolean;
  startX: number;
  startY: number;
  steps: number;
  pivot: SelectionPivot;
  source: Voxel[];
  preview: Voxel[] | null;
}

export interface SelectionTransformControllerOptions {
  getRenderer(): VoxelRenderer | null;
  getSelectedVoxels(): RenderableVoxel[];
  execute(result: Voxel[], label: string, duplicate: boolean): void;
  requestRender(): void;
}

/** Manages non-destructive selection Gizmo previews and commits one command on release. */
export class SelectionTransformController {
  private readonly _getRenderer: () => VoxelRenderer | null;
  private readonly _getSelectedVoxels: () => RenderableVoxel[];
  private readonly _execute: SelectionTransformControllerOptions['execute'];
  private readonly _requestRender: () => void;
  private readonly _mode = element<HTMLSelectElement>('selection-gizmo-mode');
  private readonly _snap = element<HTMLSelectElement>('selection-snap');
  private readonly _pivotMode = element<HTMLSelectElement>('selection-pivot-mode');
  private readonly _pivotInputs = {
    x: element<HTMLInputElement>('selection-pivot-x'),
    y: element<HTMLInputElement>('selection-pivot-y'),
    z: element<HTMLInputElement>('selection-pivot-z'),
  };
  private _session: SelectionTransformSession | null = null;
  private _enabled = false;

  constructor(options: SelectionTransformControllerOptions) {
    this._getRenderer = options.getRenderer;
    this._getSelectedVoxels = options.getSelectedVoxels;
    this._execute = options.execute;
    this._requestRender = options.requestRender;
    this._mode.addEventListener('change', () => this.sync());
    this._pivotMode.addEventListener('change', () => this.sync());
    for (const input of Object.values(this._pivotInputs)) input.addEventListener('change', () => {
      this._pivotMode.value = 'custom';
      this.sync();
    });
  }

  get active(): boolean { return this._session !== null; }
  get pivot(): SelectionPivot | null { return this._resolvePivot(this._safeSelection()); }

  sync(render = true): boolean {
    const selection = this._safeSelection();
    const pivot = this._enabled ? this._resolvePivot(selection) : null;
    const changed = this._getRenderer()?.setSelectionTransformGizmo(
      this._mode.value as SelectionGizmoMode,
      pivot,
    ) ?? false;
    if (changed && render) this._requestRender();
    return changed;
  }

  begin(event: Pick<PointerEvent, 'clientX' | 'clientY' | 'altKey'>): boolean {
    const renderer = this._getRenderer();
    if (!this._enabled || !renderer || this._session) return false;
    const axis = renderer.pickSelectionGizmo(event.clientX, event.clientY);
    if (!axis) return false;
    const source = this._getSelectedVoxels().map(voxel => ({ ...voxel }));
    const pivot = this._resolvePivot(source);
    if (!pivot) return false;
    const mode = this._mode.value as SelectionGizmoMode;
    this._session = {
      axis,
      mode,
      duplicate: mode === 'duplicate' || (mode === 'move' && event.altKey),
      startX: event.clientX,
      startY: event.clientY,
      steps: 0,
      pivot,
      source,
      preview: null,
    };
    return true;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this._enabled) return;
    if (!enabled) this.finish(true);
    this._enabled = enabled;
    this.sync();
  }

  move(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
    const renderer = this._getRenderer();
    const session = this._session;
    if (!renderer || !session) return;
    const rawSteps = session.mode === 'rotate'
      ? renderer.selectionGizmoRotationTurns(
          session.axis, session.startX, session.startY, event.clientX, event.clientY,
        )
      : renderer.selectionGizmoDragSteps(
          session.axis,
          session.startX,
          session.startY,
          event.clientX,
          event.clientY,
        );
    const steps = session.mode === 'rotate'
      ? rawSteps
      : snapTransformSteps(rawSteps, Number(this._snap.value));
    if (steps === session.steps) return;
    session.steps = steps;
    if (steps === 0) {
      session.preview = null;
      renderer.clearBrushPreview();
      return;
    }
    session.preview = session.mode === 'rotate'
      ? rotateVoxels90AroundPivot(session.source, session.axis, session.pivot, steps)
      : session.mode === 'scale'
        ? resizeVoxelsAlongAxis(
            session.source,
            session.axis,
            selectionAxisSize(session.source, session.axis) + steps,
            session.pivot,
          )
        : translateVoxels(session.source, axisOffset(session.axis, steps));
    renderer.setSelectionTransformPreview(session.preview);
  }

  finish(cancel = false): boolean {
    const session = this._session;
    if (!session) return false;
    this._session = null;
    this._getRenderer()?.clearBrushPreview();
    if (cancel || !session.preview) return true;
    const axis = session.axis.toUpperCase();
    const label = session.mode === 'rotate'
      ? `Gizmo 绕 ${axis} 轴旋转选择`
      : session.mode === 'scale'
        ? `Gizmo 沿 ${axis} 轴缩放选择`
        : session.duplicate
          ? `Gizmo 沿 ${axis} 轴复制选择`
          : `Gizmo 沿 ${axis} 轴移动选择`;
    this._execute(session.preview, label, session.duplicate);
    return true;
  }

  private _safeSelection(): RenderableVoxel[] {
    try { return this._getSelectedVoxels(); }
    catch { return []; }
  }

  private _resolvePivot(selection: Iterable<RenderableVoxel>): SelectionPivot | null {
    const voxels = Array.from(selection);
    if (voxels.length === 0) return null;
    const mode = this._pivotMode.value as SelectionPivotMode;
    const pivot = mode === 'custom'
      ? {
          x: finiteNumber(this._pivotInputs.x.value),
          y: finiteNumber(this._pivotInputs.y.value),
          z: finiteNumber(this._pivotInputs.z.value),
        }
      : selectionPivot(voxels, mode);
    if (!pivot) return null;
    if (mode !== 'custom') {
      this._pivotInputs.x.value = formatCoordinate(pivot.x);
      this._pivotInputs.y.value = formatCoordinate(pivot.y);
      this._pivotInputs.z.value = formatCoordinate(pivot.z);
    }
    return pivot;
  }
}

function axisOffset(axis: TransformAxis, steps: number): { x: number; y: number; z: number } {
  return { x: axis === 'x' ? steps : 0, y: axis === 'y' ? steps : 0, z: axis === 'z' ? steps : 0 };
}

function selectionAxisSize(voxels: readonly Voxel[], axis: TransformAxis): number {
  let min = Infinity, max = -Infinity;
  for (const voxel of voxels) {
    min = Math.min(min, voxel[axis]);
    max = Math.max(max, voxel[axis]);
  }
  return min === Infinity ? 0 : max - min + 1;
}

function finiteNumber(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function element<T extends Element>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
