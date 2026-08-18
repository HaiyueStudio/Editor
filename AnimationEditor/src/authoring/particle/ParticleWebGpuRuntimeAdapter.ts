import type { ParsedAnimation } from '@haiyue/animation-spec';
import { Camera2D, Entity, HaiyueEngine, Transform2D, type Scene } from '@haiyue/engine';
import { getEngineGPUResourceTracker, type GPUResourceTracker } from '@haiyue/engine/experimental';
import { Particle2DRenderSystem, Particle2DSystem, type Particle2DRenderStats } from '@haiyue/engine/systems';
import { Animation2DComponent, Animation2DSystem } from '@haiyue/extensions/animation';

export interface ParticleWebGpuFrame {
  readonly time: number;
  readonly renderer: Particle2DRenderStats;
  readonly listenerCount: number;
  readonly ownerCount: number;
  readonly resourceCount: number;
  readonly estimatedGpuBytes: number;
}

/** Exact-HYA WebGPU preview owner with particle renderer and GPU lifecycle telemetry. */
export class ParticleWebGpuRuntimeAdapter {
  private readonly _engine: HaiyueEngine;
  private readonly _tracker: GPUResourceTracker;
  private _scene: Scene | null = null;
  private _camera: Camera2D | null = null;
  private _renderer: Particle2DRenderSystem | null = null;
  private _playerEntity: Entity | null = null;
  private _player: Animation2DComponent | null = null;
  private _gpuErrorListenerAttached = false;
  readonly validationErrors: string[] = [];
  private readonly _onGpuError = (event: GPUUncapturedErrorEvent): void => {
    this.validationErrors.push(event.error.message);
  };

  constructor(private readonly _canvas: HTMLCanvasElement) {
    this._engine = new HaiyueEngine({
      canvas: _canvas,
      clearColor: { r: 0.031, g: 0.047, b: 0.075, a: 1 },
      diagnostics: { enabled: true },
      renderProfile: 'simple',
    });
    this._tracker = getEngineGPUResourceTracker(this._engine)!;
  }

  async initialize(): Promise<void> {
    await this._engine.init();
    this._engine.device.addEventListener('uncapturederror', this._onGpuError);
    this._gpuErrorListenerAttached = true;
    const cameraEntity = new Entity('Particle authoring camera');
    const camera = new Camera2D({
      width: 640,
      height: 400,
      designWidth: 640,
      designHeight: 400,
      viewportMode: 'fit',
    });
    cameraEntity.addComponent(camera);
    const scene = this._engine.createScene({
      name: 'Particle exact HYA runtime',
      camera: { type: '2d', entity: cameraEntity },
      render3D: false,
      render2D: false,
      gui: false,
      pipelineLabel: 'AnimationEditor.particle',
    });
    scene.addSystem(new Animation2DSystem({ priority: -10, assetManager: this._engine.assetManager! }), false);
    scene.addSystem(new Particle2DSystem({ priority: -9 }), false);
    const renderer = new Particle2DRenderSystem(this._engine, cameraEntity, { loadOp: 'clear', priority: 0 });
    scene.addSystem(renderer);
    this._engine.switchScene(scene);
    this._engine.run();
    this._scene = scene;
    this._camera = camera;
    this._renderer = renderer;
    this.resize();
    await this._nextFrame();
  }

  async load(animation: ParsedAnimation): Promise<ParticleWebGpuFrame> {
    if (!this._scene || !this._camera) throw new Error('Particle WebGPU runtime is not initialized.');
    if (this._playerEntity) this._scene.remove(this._playerEntity);
    const player = new Animation2DComponent(animation, {
      autoplay: false,
      loop: animation.endBehavior === 'loop',
    });
    const entity = new Entity('Particle exact HYA player').addComponent(new Transform2D()).addComponent(player);
    this._scene.add(entity);
    this._player = player;
    this._playerEntity = entity;
    this._camera.setViewportFit({
      designWidth: animation.canvas.width,
      designHeight: animation.canvas.height,
      viewportMode: 'fit',
    });
    this.resize();
    return this.seekFrame(0);
  }

  async seekFrame(time: number): Promise<ParticleWebGpuFrame> {
    if (!this._player || !this._renderer) throw new Error('Particle WebGPU runtime has no HYA player.');
    this._player.seek(time);
    await this._nextFrame();
    const frame = this.snapshot(time);
    await this._engine.device.queue.onSubmittedWorkDone();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return frame;
  }

  snapshot(time = this._player?.currentTime ?? 0): ParticleWebGpuFrame {
    if (!this._renderer) throw new Error('Particle WebGPU runtime is not initialized.');
    const debug = this._tracker.getDebugSnapshot();
    const usage = this._tracker.getUsage();
    return Object.freeze({
      time,
      renderer: this._renderer.stats,
      listenerCount: this._engine.listenerCount('after-update'),
      ownerCount: debug.owners.length,
      resourceCount: debug.owners.reduce((total, owner) => total + owner.resources, 0),
      estimatedGpuBytes: usage.estimatedBytes,
    });
  }

  resize(): void {
    this._engine.resizeToDisplaySize(true);
    this._camera?.resize(this._engine.displayWidth, this._engine.displayHeight);
  }

  destroy(): Readonly<{ releasedOwnerResiduals: number; resources: number }> {
    if (this._gpuErrorListenerAttached) {
      this._engine.device.removeEventListener('uncapturederror', this._onGpuError);
      this._gpuErrorListenerAttached = false;
    }
    this._engine.destroy();
    const debug = this._tracker.getDebugSnapshot();
    return Object.freeze({
      releasedOwnerResiduals: debug.releasedOwnerResiduals,
      resources: this._tracker.getResources().length,
    });
  }

  private _nextFrame(): Promise<void> {
    return new Promise(resolve => this._engine.once('after-update', () => resolve()));
  }
}
