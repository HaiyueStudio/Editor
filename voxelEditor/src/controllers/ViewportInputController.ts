import type { VoxelDocument } from '../model';
import { translate } from '../localization';
import { connectedVoxels, voxelsWithColor, type SelectionApplyMode } from '../selection';
import type { VoxelRenderer } from '../VoxelRenderer';
import type { VoxelBrushController } from './VoxelBrushController';
import type { VoxelSelectionController } from './VoxelSelectionController';
import type { SelectionTransformController } from './SelectionTransformController';
import type { ModuleGizmoController } from './ModuleGizmoController';
import type { ViewportInteractionController, ViewportTool } from './ViewportInteractionController';

type SelectionKind = 'single' | 'connected' | 'color';

export interface ViewportInputControllerOptions {
  readonly canvas: HTMLCanvasElement;
  readonly coordinate: HTMLElement;
  readonly selectionRect: HTMLElement;
  readonly selectionKind: HTMLSelectElement;
  readonly boxSelectionMode: HTMLSelectElement;
  readonly document: VoxelDocument;
  readonly viewport: ViewportInteractionController;
  readonly brush: VoxelBrushController;
  readonly selection: VoxelSelectionController;
  readonly selectionTransform: SelectionTransformController;
  readonly moduleGizmo: ModuleGizmoController;
  readonly getRenderer: () => VoxelRenderer | null;
  readonly selectModuleInstance: (id: string) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly notify: (message: string, error?: boolean) => void;
}

/**
 * Routes browser input into viewport navigation, brush, selection, and gizmo
 * controllers. It owns transient pointer state but no document mutations.
 */
export class ViewportInputController {
  private readonly _events = new AbortController();
  private _pointerStart: { x: number; y: number } | null = null;
  private _selectionDrag: { x: number; y: number } | null = null;

  constructor(private readonly _options: ViewportInputControllerOptions) {
    const { canvas } = _options;
    const eventOptions = { signal: this._events.signal };
    canvas.addEventListener('pointerdown', this._onPointerDown, eventOptions);
    canvas.addEventListener('pointermove', this._onPointerMove, eventOptions);
    canvas.addEventListener('pointerleave', this._onPointerLeave, eventOptions);
    canvas.addEventListener('pointercancel', this._onPointerCancel, eventOptions);
    canvas.addEventListener('pointerup', this._onPointerUp, eventOptions);
    window.addEventListener('keydown', this._onKeyDown, eventOptions);
    window.addEventListener('keyup', this._onKeyUp, eventOptions);
    window.addEventListener('blur', this._onWindowBlur, eventOptions);
  }

  dispose(): void {
    this._events.abort();
    this._options.selectionTransform.finish(true);
    this._options.moduleGizmo.finish(true);
    this._options.brush.cancel();
    this._finishSelectionDrag();
  }

  syncLocale(): void {
    this._options.coordinate.textContent = translate('viewport.coordinateEmpty');
  }

  private _onPointerDown = (event: PointerEvent): void => {
    const { canvas, viewport, selectionTransform, moduleGizmo, brush } = this._options;
    canvas.focus({ preventScroll: true });
    if (event.button !== 0) return;
    if (viewport.isNavigating) {
      this._pointerStart = null;
      return;
    }
    try {
      if (viewport.activeTool === 'select' && selectionTransform.begin(event)) {
        canvas.setPointerCapture(event.pointerId);
        this._pointerStart = null;
        return;
      }
      if (moduleGizmo.begin(event)) {
        canvas.setPointerCapture(event.pointerId);
        this._pointerStart = null;
        return;
      }
    } catch (error) {
      this._report(error);
      return;
    }
    this._pointerStart = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    if (viewport.activeTool === 'select') {
      this._selectionDrag = { ...this._pointerStart };
      this._updateSelectionRect(event.clientX, event.clientY, event.clientX, event.clientY);
      this._options.selectionRect.classList.add('visible');
      return;
    }
    try {
      brush.begin(event, viewport.activeTool as Exclude<ViewportTool, 'select'>);
      if (!brush.isActive) this._pointerStart = null;
    } catch (error) {
      this._pointerStart = null;
      brush.cancel();
      this._report(error);
    }
  };

  private _onPointerMove = (event: PointerEvent): void => {
    const { canvas, coordinate, viewport, moduleGizmo, selectionTransform, brush } = this._options;
    if (viewport.isNavigating) {
      canvas.style.cursor = (event.buttons & 1) !== 0 ? 'grabbing' : 'grab';
      return;
    }
    if (moduleGizmo.active) {
      try {
        moduleGizmo.move(event);
        canvas.style.cursor = 'grabbing';
      } catch (error) {
        moduleGizmo.finish(true);
        this._report(error);
      }
      return;
    }
    if (selectionTransform.active) {
      try {
        selectionTransform.move(event);
        canvas.style.cursor = 'grabbing';
      } catch (error) {
        selectionTransform.finish(true);
        this._report(error);
      }
      return;
    }
    if (this._selectionDrag) {
      this._updateSelectionRect(
        this._selectionDrag.x,
        this._selectionDrag.y,
        event.clientX,
        event.clientY,
      );
    }
    if (brush.isActive && (event.buttons & 1) !== 0) {
      try {
        brush.move(event);
      } catch (error) {
        brush.cancel();
        this._report(error);
      }
    }
    const renderer = this._options.getRenderer();
    if (!renderer) {
      coordinate.textContent = translate('viewport.coordinateEmpty');
      return;
    }
    try {
      const pick = renderer.pick(event.clientX, event.clientY);
      const cell = pick.voxel ?? pick.target;
      coordinate.textContent = cell
        ? translate('viewport.coordinate', { x: cell.x, y: cell.y, z: cell.z })
        : translate('viewport.coordinateEmpty');
      canvas.style.cursor = renderer.pickSelectionGizmo(event.clientX, event.clientY)
        || renderer.pickModuleGizmo(event.clientX, event.clientY) ? 'grab' : '';
    } catch {
      coordinate.textContent = translate('viewport.coordinateEmpty');
    }
  };

  private _onPointerLeave = (): void => {
    this._options.coordinate.textContent = translate('viewport.coordinateEmpty');
    if (!this._options.moduleGizmo.active && !this._options.selectionTransform.active) {
      this._options.canvas.style.cursor = '';
    }
  };

  private _onPointerCancel = (): void => {
    this._options.selectionTransform.finish(true);
    this._options.moduleGizmo.finish(true);
    this._pointerStart = null;
    this._finishSelectionDrag();
    this._options.brush.cancel();
  };

  private _onPointerUp = (event: PointerEvent): void => {
    const { canvas, viewport, selectionTransform, moduleGizmo, brush } = this._options;
    if (event.button === 0 && selectionTransform.active) {
      try {
        selectionTransform.finish();
      } catch (error) {
        selectionTransform.finish(true);
        this._report(error);
      }
      canvas.style.cursor = 'grab';
      return;
    }
    if (event.button === 0 && moduleGizmo.active) {
      moduleGizmo.finish();
      canvas.style.cursor = 'grab';
      return;
    }
    const renderer = this._options.getRenderer();
    if (!renderer || event.button !== 0 || !this._pointerStart) return;
    const start = this._pointerStart;
    const movement = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    this._pointerStart = null;
    if (viewport.activeTool === 'select') {
      this._finishSelectionDrag();
      this._selectFromPointer(renderer, event, start, movement);
      return;
    }
    try {
      brush.complete(event);
    } catch (error) {
      brush.cancel();
      this._report(error);
    }
  };

  private _selectFromPointer(
    renderer: VoxelRenderer,
    event: PointerEvent,
    start: { x: number; y: number },
    movement: number,
  ): void {
    const { selection, document, selectionKind, boxSelectionMode } = this._options;
    try {
      const mode = selectionMode(event);
      if (movement > 5) {
        selection.apply(
          renderer.voxelsInScreenRect(
            start.x,
            start.y,
            event.clientX,
            event.clientY,
            boxSelectionMode.value === 'through' ? 'through' : 'visible',
          ),
          mode,
        );
        return;
      }
      const voxel = renderer.pick(event.clientX, event.clientY).voxel;
      const kind = selectionKind.value as SelectionKind;
      if (voxel?.moduleInstanceId && kind === 'single' && mode === 'replace') {
        const instance = document.getModuleInstance(voxel.moduleInstanceId);
        if (instance) {
          selection.clear();
          this._options.selectModuleInstance(instance.id);
          this._options.notify(`已选择模块实例“${instance.name}”。`);
          return;
        }
      }
      if (!voxel) {
        if (mode === 'replace') selection.clear();
      } else if (kind === 'connected') {
        selection.apply(connectedVoxels(document.viewVoxels.values(), voxel), mode);
      } else if (kind === 'color') {
        selection.apply(voxelsWithColor(document.viewVoxels.values(), voxel.color), mode);
      } else {
        selection.apply([voxel], mode);
      }
    } catch (error) {
      this._report(error);
    }
  }

  private _onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const {
      canvas,
      viewport,
      selection,
      selectionTransform,
      moduleGizmo,
      brush,
    } = this._options;
    const isTextEditing = event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLSelectElement
      || (event.target instanceof HTMLElement && event.target.isContentEditable);
    if (event.code === 'Space'
      && (!isTextEditing || canvas.matches(':hover'))
      && !this._selectionDrag && !brush.isActive && !moduleGizmo.active && !selectionTransform.active) {
      event.preventDefault();
      viewport.setSpaceNavigation(true);
      return;
    }
    if (isTextEditing) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this._options.redo();
      else this._options.undo();
      return;
    }
    if (modifier && key === 'y') {
      event.preventDefault();
      this._options.redo();
      return;
    }
    if (viewport.activeTool === 'select' && modifier && key === 'a') {
      event.preventDefault();
      selection.selectAll();
      return;
    }
    if (viewport.activeTool === 'select' && modifier && key === 'i') {
      event.preventDefault();
      selection.invert();
      return;
    }
    if (viewport.activeTool === 'select' && modifier && key === 'c') {
      event.preventDefault();
      selection.run(() => selection.copy());
      return;
    }
    if (viewport.activeTool === 'select' && modifier && key === 'x') {
      event.preventDefault();
      selection.run(() => selection.cut());
      return;
    }
    if (viewport.activeTool === 'select' && modifier && key === 'v') {
      event.preventDefault();
      selection.run(() => selection.paste());
      return;
    }
    if (viewport.activeTool === 'select' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      selection.run(() => selection.delete());
      return;
    }
    if (viewport.activeTool !== 'select' && (event.key === '[' || event.key === ']')) {
      event.preventDefault();
      brush.adjustSize(event.key === '[' ? -1 : 1);
      return;
    }
    if (event.key === 'Escape' && viewport.exitLockedNavigation()) return;
    if (event.key === 'Escape' && moduleGizmo.finish(true)) return;
    if (event.key === 'Escape' && selectionTransform.finish(true)) return;
    if (event.key === 'Escape' && selection.clear()) return;
    if (event.key === '1' || key === 'b') viewport.setTool('add', selection.count);
    if (event.key === '2' || key === 'e') viewport.setTool('erase', selection.count);
    if (event.key === '3' || key === 'g') viewport.setTool('paint', selection.count);
    if (event.key === '4' || key === 'n') viewport.setTool('select', selection.count);
  };

  private _onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') this._options.viewport.setSpaceNavigation(false);
  };

  private _onWindowBlur = (): void => {
    this._options.viewport.setSpaceNavigation(false);
    this._options.selectionTransform.finish(true);
    this._options.moduleGizmo.finish(true);
  };

  private _updateSelectionRect(startX: number, startY: number, endX: number, endY: number): void {
    const bounds = this._options.canvas.getBoundingClientRect();
    const left = Math.max(bounds.left, Math.min(bounds.right, Math.min(startX, endX)));
    const right = Math.max(bounds.left, Math.min(bounds.right, Math.max(startX, endX)));
    const top = Math.max(bounds.top, Math.min(bounds.bottom, Math.min(startY, endY)));
    const bottom = Math.max(bounds.top, Math.min(bounds.bottom, Math.max(startY, endY)));
    const rect = this._options.selectionRect;
    rect.style.left = `${left}px`;
    rect.style.top = `${top}px`;
    rect.style.width = `${right - left}px`;
    rect.style.height = `${bottom - top}px`;
  }

  private _finishSelectionDrag(): void {
    this._selectionDrag = null;
    this._options.selectionRect.classList.remove('visible');
  }

  private _report(error: unknown): void {
    this._options.notify(error instanceof Error ? error.message : String(error), true);
  }
}

function selectionMode(event: Pick<PointerEvent, 'shiftKey' | 'altKey'>): SelectionApplyMode {
  if (event.altKey) return 'subtract';
  return event.shiftKey ? 'add' : 'replace';
}
