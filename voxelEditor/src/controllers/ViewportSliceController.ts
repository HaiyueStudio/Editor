import type { SceneSize } from '../model';
import type { SliceAxis, SliceDisplayMode, ViewportSliceState } from '../viewportSlice';
import { clampSliceIndex } from '../viewportSlice';
import type { VoxelRenderer } from '../VoxelRenderer';

export interface ViewportSliceControllerOptions {
  getRenderer(): VoxelRenderer | null;
  getSize(): Readonly<SceneSize>;
  requestRender(): void;
}

/** Owns slice display controls and the movable axis-aligned work plane. */
export class ViewportSliceController {
  private readonly _getRenderer: () => VoxelRenderer | null;
  private readonly _getSize: () => Readonly<SceneSize>;
  private readonly _requestRender: () => void;
  private readonly _mode = element<HTMLSelectElement>('slice-mode');
  private readonly _workPlane = element<HTMLInputElement>('work-plane-enabled');
  private readonly _indices: Record<SliceAxis, number> = { x: 0, y: 0, z: 0 };
  private _axis: SliceAxis = 'y';

  constructor(options: ViewportSliceControllerOptions) {
    this._getRenderer = options.getRenderer;
    this._getSize = options.getSize;
    this._requestRender = options.requestRender;
    this._bind();
    this.syncSize(false);
  }

  get state(): ViewportSliceState {
    return {
      axis: this._axis,
      index: this._indices[this._axis],
      mode: this._mode.value as SliceDisplayMode,
      workPlaneEnabled: this._workPlane.checked,
    };
  }

  attachRenderer(): void {
    this._apply(false);
  }

  syncSize(render = true): void {
    const size = this._getSize();
    for (const axis of ['x', 'y', 'z'] as const) {
      const input = element<HTMLInputElement>(`slice-${axis}`);
      this._indices[axis] = clampSliceIndex(size, axis, this._indices[axis]);
      input.max = String(Math.max(0, size[axis] - 1));
      input.value = String(this._indices[axis]);
      element<HTMLOutputElement>(`slice-${axis}-value`).value = String(this._indices[axis]);
    }
    this._syncAxisUi();
    this._apply(render);
  }

  private _bind(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-slice-axis]').forEach(button => {
      button.addEventListener('click', () => {
        this._axis = button.dataset.sliceAxis as SliceAxis;
        this._syncAxisUi();
        this._apply(true);
      });
    });
    for (const axis of ['x', 'y', 'z'] as const) {
      const input = element<HTMLInputElement>(`slice-${axis}`);
      input.addEventListener('input', () => {
        this._axis = axis;
        this._indices[axis] = clampSliceIndex(this._getSize(), axis, Number(input.value));
        element<HTMLOutputElement>(`slice-${axis}-value`).value = String(this._indices[axis]);
        this._syncAxisUi();
        this._apply(true);
      });
    }
    this._mode.addEventListener('change', () => this._apply(true));
    this._workPlane.addEventListener('change', () => this._apply(true));
  }

  private _syncAxisUi(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-slice-axis]').forEach(button => {
      const active = button.dataset.sliceAxis === this._axis;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll<HTMLElement>('[data-slice-row]').forEach(row => {
      row.classList.toggle('active', row.dataset.sliceRow === this._axis);
    });
  }

  private _apply(render: boolean): void {
    const changed = this._getRenderer()?.setSliceState(this.state) ?? false;
    if (changed && render) this._requestRender();
  }
}

function element<T extends Element>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
