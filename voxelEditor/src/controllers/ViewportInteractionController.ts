import { projectCameraAxes } from '../cameraAxis';
import { translate } from '../localization';
import type { RenderableVoxel } from '../model';
import type { VoxelRenderer } from '../VoxelRenderer';
import type { CameraPresetView } from '../VoxelRenderer';

export type ViewportTool = 'add' | 'erase' | 'paint' | 'select';

export interface ViewportInteractionControllerOptions {
  canvas: HTMLCanvasElement;
  getRenderer(): VoxelRenderer | null;
  getSelectionCount(): number;
  getSelectedVoxels(): Iterable<RenderableVoxel>;
  notify(message: string, error?: boolean): void;
  onToolChange?(tool: ViewportTool): void;
}

/** Owns viewport mode, camera-navigation state, projection controls, and camera-axis presentation. */
export class ViewportInteractionController {
  readonly canvas: HTMLCanvasElement;
  private readonly _getRenderer: () => VoxelRenderer | null;
  private readonly _getSelectionCount: () => number;
  private readonly _getSelectedVoxels: () => Iterable<RenderableVoxel>;
  private readonly _notify: (message: string, error?: boolean) => void;
  private readonly _onToolChange: (tool: ViewportTool) => void;
  private readonly _axis = element<SVGSVGElement>('camera-axis');
  private readonly _projectionLabel = element<HTMLElement>('projection-label');
  private readonly _perspective = element<HTMLButtonElement>('projection-perspective');
  private readonly _orthographic = element<HTMLButtonElement>('projection-orthographic');
  private readonly _orbit = element<HTMLButtonElement>('camera-orbit');
  private _lockedNavigation = false;
  private _spaceNavigation = false;
  private _tool: ViewportTool = 'add';
  private _lastAxisSignature = '';

  constructor(options: ViewportInteractionControllerOptions) {
    this.canvas = options.canvas;
    this._getRenderer = options.getRenderer;
    this._getSelectionCount = options.getSelectionCount;
    this._getSelectedVoxels = options.getSelectedVoxels;
    this._notify = options.notify;
    this._onToolChange = options.onToolChange ?? (() => {});
    this._bind();
  }

  get activeTool(): ViewportTool { return this._tool; }
  get isNavigating(): boolean { return this._lockedNavigation || this._spaceNavigation; }
  get cameraNavigationLocked(): boolean { return this._lockedNavigation; }

  setTool(tool: ViewportTool, selectionCount = 0): void {
    this._tool = tool;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const active = button.dataset.tool === tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    element('tool-label').textContent = tool === 'add'
      ? translate('viewport.addVoxel')
      : tool === 'erase'
        ? translate('viewport.eraseVoxel')
        : tool === 'paint'
          ? translate('viewport.paintVoxel')
          : translate('viewport.selectCount', { count: selectionCount.toLocaleString() });
    element('selection-options').classList.toggle('active', tool === 'select');
    element('brush-options').classList.toggle('active', tool !== 'select');
    this._spaceNavigation = false;
    this.syncNavigation();
    this._onToolChange(tool);
  }

  syncSelectionCount(count: number): void {
    if (this._tool === 'select') {
      element('tool-label').textContent = translate('viewport.selectCount', { count: count.toLocaleString() });
    }
  }

  setSpaceNavigation(active: boolean): void {
    if (this._spaceNavigation === active) return;
    this._spaceNavigation = active;
    this.syncNavigation();
  }

  exitLockedNavigation(): boolean {
    if (!this._lockedNavigation) return false;
    this._lockedNavigation = false;
    this.syncNavigation();
    return true;
  }

  syncNavigation(): void {
    const navigating = this.isNavigating;
    this._getRenderer()?.setPrimaryDragEditing(!navigating);
    this._orbit.classList.toggle('active', this._lockedNavigation);
    this._orbit.setAttribute('aria-pressed', String(this._lockedNavigation));
    this._orbit.textContent = translate(this._lockedNavigation ? 'viewport.exitOrbit' : 'viewport.orbit');
    this.canvas.classList.toggle('camera-navigation', navigating);
    this.canvas.style.cursor = navigating ? 'grab' : '';
  }

  setProjectionType(type: 'perspective' | 'orthographic'): void {
    const renderer = this._getRenderer();
    if (!renderer) return;
    renderer.setProjectionType(type);
    const perspective = type === 'perspective';
    this._projectionLabel.textContent = translate(perspective ? 'viewport.perspectiveView' : 'viewport.orthographicView');
    this._perspective.classList.toggle('active', perspective);
    this._perspective.setAttribute('aria-pressed', String(perspective));
    this._orthographic.classList.toggle('active', !perspective);
    this._orthographic.setAttribute('aria-pressed', String(!perspective));
  }

  attachRenderer(): void {
    const renderer = this._getRenderer();
    if (!renderer) return;
    this.syncNavigation();
    this.setProjectionType(renderer.projectionType);
    renderer.engine.on('after-update', this.syncCameraAxis);
    this.syncCameraAxis();
  }

  syncLocale(): void {
    this.setTool(this._tool, this._getSelectionCount());
    const projection = this._getRenderer()?.projectionType;
    if (projection) this.setProjectionType(projection);
  }

  readonly syncCameraAxis = (): void => {
    const renderer = this._getRenderer();
    if (!renderer) return;
    const axes = projectCameraAxes(renderer.cameraTransform.localMatrix);
    const signature = axes.map(axis => `${axis.x.toFixed(4)},${axis.y.toFixed(4)},${axis.depth.toFixed(4)}`).join('|');
    if (signature === this._lastAxisSignature) return;
    this._lastAxisSignature = signature;
    const center = this._axis.querySelector<SVGCircleElement>('circle');
    for (const axis of [...axes].sort((a, b) => a.depth - b.depth)) {
      const group = this._axis.querySelector<SVGGElement>(`[data-axis="${axis.name}"]`);
      const line = group?.querySelector<SVGLineElement>('line');
      const label = group?.querySelector<SVGTextElement>('text');
      if (!group || !line || !label) continue;
      const endX = 32 + axis.x * 22;
      const endY = 32 + axis.y * 22;
      const length = Math.hypot(axis.x, axis.y);
      label.setAttribute('x', (length > 0.08 ? endX + axis.x / length * 5 : endX + 5).toFixed(2));
      label.setAttribute('y', (length > 0.08 ? endY + axis.y / length * 5 : endY).toFixed(2));
      line.setAttribute('x2', endX.toFixed(2));
      line.setAttribute('y2', endY.toFixed(2));
      group.style.opacity = String(0.58 + (axis.depth + 1) * 0.18);
      this._axis.insertBefore(group, center);
    }
  };

  private _bind(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => {
      button.addEventListener('click', () => this.setTool(button.dataset.tool as ViewportTool, this._getSelectionCount()));
    });
    element('reset-camera').addEventListener('click', () => this._getRenderer()?.resetCamera());
    document.querySelectorAll<HTMLButtonElement>('[data-camera-view]').forEach(button => {
      button.addEventListener('click', () => {
        const view = button.dataset.cameraView as CameraPresetView;
        const renderer = this._getRenderer();
        if (!renderer) return;
        renderer.setCameraPreset(view);
        this.setProjectionType('orthographic');
        const names: Record<CameraPresetView, Parameters<typeof translate>[0]> = {
          front: 'viewport.frontView', back: 'viewport.backView', left: 'viewport.leftView',
          right: 'viewport.rightView', top: 'viewport.topView', bottom: 'viewport.bottomView',
        };
        this._projectionLabel.textContent = translate('viewport.orthographicPreset', { view: translate(names[view]) });
      });
    });
    element('frame-selected').addEventListener('click', () => {
      if (!this._getRenderer()?.frameVoxels(this._getSelectedVoxels())) {
        this._notify(translate('viewport.focusRequired'), true);
      }
    });
    element('frame-all').addEventListener('click', () => this._getRenderer()?.frameAll());
    this._perspective.addEventListener('click', () => this.setProjectionType('perspective'));
    this._orthographic.addEventListener('click', () => this.setProjectionType('orthographic'));
    this._orbit.addEventListener('click', () => {
      this._lockedNavigation = !this._lockedNavigation;
      this.syncNavigation();
      this.canvas.focus({ preventScroll: true });
    });
  }
}

function element<T extends Element = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
