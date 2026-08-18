import {
  Camera3D,
  CartesianTransform3D,
  Entity,
  OrbitControl,
  SphericalTransform3D,
  type Scene,
} from '@haiyue/engine';
import { FirstPersonControls } from '@haiyue/engine/controls';
import { Line3D } from '@haiyue/engine/components';
import { LineGeometry } from '@haiyue/engine/geometry';
import { LineMaterial } from '@haiyue/engine/material';

export type Native3dNavigationMode = 'orbit' | 'fly';

export interface Native3dViewportRuntimePort {
  select(nodeIds: readonly string[]): void;
  useAuthoredCamera(nodeId: string): void;
}

export interface Native3dViewportControllerOptions {
  readonly scene: Scene;
  readonly canvas: HTMLCanvasElement;
  readonly runtime: Native3dViewportRuntimePort;
  readonly gridExtent?: number;
  readonly gridStep?: number;
}

/** Owns editor-only grid, orbit/fly cameras and camera-view switching. */
export class Native3dViewportController {
  readonly orbitCamera = new Entity('AnimationEditor 3D Orbit Camera');
  readonly flyCamera = new Entity('AnimationEditor 3D Fly Camera');

  private readonly _scene: Scene;
  private readonly _runtime: Native3dViewportRuntimePort;
  private readonly _orbitTransform: SphericalTransform3D;
  private readonly _flyTransform: CartesianTransform3D;
  private readonly _orbit: OrbitControl;
  private readonly _fly: FirstPersonControls;
  private readonly _grid = new Native3dGridLayer();
  private _mode: Native3dNavigationMode = 'orbit';
  private _cameraView = false;
  private _destroyed = false;

  constructor(options: Native3dViewportControllerOptions) {
    this._scene = options.scene;
    this._runtime = options.runtime;
    const aspect = Math.max(1, options.canvas.width) / Math.max(1, options.canvas.height);
    this._orbitTransform = new SphericalTransform3D({ radius: 8, theta: Math.PI * 0.25, phi: Math.PI * 0.34, target: [0, 0.75, 0] });
    this.orbitCamera.addComponent(new Camera3D({ type: 'perspective', fov: Math.PI / 4, near: 0.05, far: 1000, aspect }));
    this.orbitCamera.addComponent(this._orbitTransform);
    this._flyTransform = new CartesianTransform3D({ position: [4, 3, 6], rotation: [-0.25, 0.6, 0] });
    this.flyCamera.addComponent(new Camera3D({ type: 'perspective', fov: Math.PI / 4, near: 0.05, far: 1000, aspect }));
    this.flyCamera.addComponent(this._flyTransform);
    this._scene.add(this.orbitCamera).add(this.flyCamera);
    this._orbit = new OrbitControl(options.canvas, this._orbitTransform, { minRadius: 0.05, maxRadius: 10_000 });
    this._fly = new FirstPersonControls(options.canvas, this._flyTransform, {
      moveSpeed: 4,
      gravity: 0,
      pointerLock: true,
      initialGrounded: false,
      groundProbe: () => null,
    });
    this._scene.add(this._grid.root);
    this._grid.rebuild(options.gridExtent ?? 20, options.gridStep ?? 1);
    this.setNavigationMode('orbit');
  }

  get navigationMode(): Native3dNavigationMode { return this._mode; }
  get cameraView(): boolean { return this._cameraView; }

  setNavigationMode(mode: Native3dNavigationMode): void {
    this._assertActive();
    this._mode = mode;
    this._cameraView = false;
    this._orbit.enablePan = mode === 'orbit';
    this._orbit.enableRotate = mode === 'orbit';
    this._orbit.enableZoom = mode === 'orbit';
    this._fly.disabled = mode !== 'fly';
    this._scene.setCamera(mode === 'orbit' ? this.orbitCamera : this.flyCamera);
  }

  showAuthoredCamera(nodeId: string): void {
    this._assertActive();
    this._runtime.useAuthoredCamera(nodeId);
    this._cameraView = true;
    this._orbit.enablePan = false;
    this._orbit.enableRotate = false;
    this._orbit.enableZoom = false;
    this._fly.disabled = true;
  }

  showEditorCamera(): void {
    this.setNavigationMode(this._mode);
  }

  select(nodeIds: readonly string[]): void {
    this._assertActive();
    this._runtime.select(nodeIds);
  }

  focus(target: readonly [number, number, number], radius = this._orbitTransform.radius): void {
    this._assertActive();
    this._orbitTransform.setTarget(target[0], target[1], target[2]);
    this._orbitTransform.radius = Math.max(0.05, radius);
  }

  update(deltaMilliseconds: number): void {
    if (this._destroyed || this._fly.disabled) return;
    this._fly.step(deltaMilliseconds);
  }

  resize(width: number, height: number): void {
    const aspect = Math.max(1, width) / Math.max(1, height);
    this.orbitCamera.getComponent(Camera3D)!.aspect = aspect;
    this.flyCamera.getComponent(Camera3D)!.aspect = aspect;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._orbit.destroy();
    this._fly.destroy();
    this._grid.destroy();
    this.orbitCamera.destroy();
    this.flyCamera.destroy();
  }

  private _assertActive(): void {
    if (this._destroyed) throw new Error('Native3dViewportController is destroyed.');
  }
}

class Native3dGridLayer {
  readonly root = new Entity('AnimationEditor 3D Grid');
  private readonly _geometries = new Map<'minor' | 'major' | 'axis', LineGeometry>();

  constructor() {
    for (const level of ['minor', 'major', 'axis'] as const) {
      const geometry = new LineGeometry([], { topology: 'segments' });
      const entity = new Entity(`3D Grid ${level}`);
      entity.addComponent(new Line3D(geometry, new LineMaterial({
        color: level === 'axis' ? [0.34, 0.58, 0.88, 0.95]
          : level === 'major' ? [0.32, 0.37, 0.45, 0.8]
            : [0.2, 0.23, 0.29, 0.55],
        width: level === 'axis' ? 2 : level === 'major' ? 1.4 : 1,
        screenSpace: true,
      })));
      this.root.addChild(entity);
      this._geometries.set(level, geometry);
    }
  }

  rebuild(extent: number, step: number): void {
    if (!Number.isFinite(extent) || extent <= 0 || !Number.isFinite(step) || step <= 0) throw new RangeError('Grid extent and step must be positive finite numbers.');
    const points = { minor: [] as number[], major: [] as number[], axis: [] as number[] };
    const count = Math.min(1000, Math.floor(extent / step));
    for (let index = -count; index <= count; index++) {
      const value = index * step;
      const level = index === 0 ? 'axis' : index % 5 === 0 ? 'major' : 'minor';
      points[level].push(-extent, 0, value, extent, 0, value, value, 0, -extent, value, 0, extent);
    }
    for (const level of ['minor', 'major', 'axis'] as const) this._geometries.get(level)!.setPoints(points[level]);
  }

  destroy(): void {
    this.root.destroy();
    this._geometries.clear();
  }
}
