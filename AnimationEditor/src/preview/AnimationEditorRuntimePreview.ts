import {
  HYA_STATE_MACHINE_EXTENSION_ID,
  type HyaStateMachineParameter,
  type ParsedAnimation,
} from '@haiyue/animation-spec';
import {
  Animation2DComponent,
  Animation2DRenderSystem,
  Animation2DSystem,
} from '@haiyue/extensions/animation';
import {
  Animation2DStateMachineComponent,
  Animation2DStateMachineSystem,
} from '@haiyue/extensions/hya-state-machine';
import { Camera2D, Entity, HaiyueEngine, Transform2D, type Scene } from '@haiyue/engine';
import { Particle2DRenderSystem, Particle2DSystem } from '@haiyue/engine/systems';
import type { AnimationEditorCompilation } from '../compiler/AnimationEditorCompiler';

export interface AnimationEditorPreviewFrame {
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly visualCount: number;
  readonly unsupportedComponentCount: number;
  readonly stateMachineLayers: readonly AnimationEditorPreviewStateLayer[];
}

export interface AnimationEditorPreviewStateLayer {
  readonly layerId: string;
  readonly currentStateId: string;
  readonly transitionId: string | null;
  readonly sourceStateId: string | null;
  readonly destinationStateId: string | null;
  readonly transitionProgress: number;
}

export interface AnimationEditorRuntimePreviewOptions {
  readonly onFrame?: (frame: AnimationEditorPreviewFrame) => void;
  readonly onError?: (error: unknown) => void;
}

/** Owns one engine/canvas and hot-swaps validated HYA players as the project changes. */
export class AnimationEditorRuntimePreview {
  private readonly _onFrame: (frame: AnimationEditorPreviewFrame) => void;
  private readonly _onError: (error: unknown) => void;
  private _engine: HaiyueEngine | null = null;
  private _scene: Scene | null = null;
  private _camera: Camera2D | null = null;
  private _renderSystem: Animation2DRenderSystem | null = null;
  private _playerEntity: Entity | null = null;
  private _player: Animation2DComponent | Animation2DStateMachineComponent | null = null;
  private _initializing: Promise<void> | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _deviceErrorListener: ((event: GPUUncapturedErrorEvent) => void) | null = null;

  constructor(
    private readonly _canvas: HTMLCanvasElement,
    options: AnimationEditorRuntimePreviewOptions = {},
  ) {
    this._onFrame = options.onFrame ?? (() => {});
    this._onError = options.onError ?? (() => {});
  }

  get supported(): boolean { return 'gpu' in navigator; }
  get ready(): boolean { return this._engine !== null; }
  get playing(): boolean { return this._player?.playing ?? false; }
  get currentTime(): number {
    return this._player instanceof Animation2DComponent
      ? this._player.currentTime
      : this._player?.layerSnapshots[0]?.currentTime ?? 0;
  }
  get animation(): ParsedAnimation | null { return this._player?.animation ?? null; }
  get stateMachineActive(): boolean { return this._player instanceof Animation2DStateMachineComponent; }

  async load(
    compilation: AnimationEditorCompilation,
    options: { readonly startTime?: number; readonly autoplay?: boolean } = {},
  ): Promise<void> {
    await this._initialize();
    const scene = this._scene!;
    if (this._playerEntity) this.clear();

    const playerEntity = new Entity(`Animation Editor preview: ${compilation.parsed.name ?? 'Untitled'}`)
      .addComponent(new Transform2D());
    const hasStateMachine = compilation.parsed.extensionsRequired.includes(HYA_STATE_MACHINE_EXTENSION_ID);
    const player = hasStateMachine
      ? new Animation2DStateMachineComponent(compilation.parsed, {
          autoplay: options.autoplay ?? false,
        })
      : new Animation2DComponent(compilation.parsed, {
          autoplay: options.autoplay ?? false,
          loop: compilation.parsed.endBehavior === 'loop',
          startTime: options.startTime ?? 0,
        });
    playerEntity.addComponent(player);
    scene.add(playerEntity);
    this._playerEntity = playerEntity;
    this._player = player;

    this._camera!.setViewportFit({
      designWidth: compilation.parsed.canvas.width,
      designHeight: compilation.parsed.canvas.height,
      viewportMode: 'fit',
    });
    this.resize();
    this._emitFrame();
  }

  play(): void { this._player?.play(); }
  pause(): void { this._player?.pause(); this._emitFrame(); }
  seek(seconds: number): void {
    if (this._player instanceof Animation2DComponent) this._player.seek(seconds);
    else if (this._player && seconds <= 0) this._player.reset();
    this._emitFrame();
  }

  setStateMachineParameter(
    name: string,
    type: HyaStateMachineParameter['type'],
    value: number | boolean = true,
  ): void {
    const player = this._requireStateMachine();
    if (type === 'float') player.setFloat(name, value as number);
    else if (type === 'integer') player.setInteger(name, value as number);
    else if (type === 'boolean') player.setBoolean(name, value as boolean);
    else player.setTrigger(name);
    this._emitFrame();
  }

  resetStateMachine(): void {
    this._requireStateMachine().reset();
    this._emitFrame();
  }

  clear(): void {
    if (this._playerEntity && this._scene) this._scene.remove(this._playerEntity);
    this._playerEntity?.destroy();
    this._playerEntity = null;
    this._player = null;
  }

  resize(): void {
    if (!this._engine || !this._camera) return;
    this._engine.resizeToDisplaySize();
    this._camera.resize(this._engine.displayWidth, this._engine.displayHeight);
  }

  destroy(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._deviceErrorListener && this._engine) {
      this._engine.device.removeEventListener('uncapturederror', this._deviceErrorListener);
    }
    this._deviceErrorListener = null;
    this.clear();
    this._engine?.destroy();
    this._engine = null;
    this._scene = null;
    this._camera = null;
    this._renderSystem = null;
    this._playerEntity = null;
    this._player = null;
    this._initializing = null;
  }

  private _initialize(): Promise<void> {
    if (this._engine) return Promise.resolve();
    if (!this.supported) return Promise.reject(new Error('当前浏览器不支持 WebGPU，HYA 导出仍可使用。'));
    this._initializing ??= this._initializeEngine();
    return this._initializing;
  }

  private async _initializeEngine(): Promise<void> {
    const engine = new HaiyueEngine({
      canvas: this._canvas,
      clearColor: { r: 0.031, g: 0.047, b: 0.075, a: 1 },
      // The designer zooms the canvas with a CSS transform. Cancel that visual
      // scale when sizing the GPU backing store so repeated preview hot-swaps do
      // not feed the transformed bounds back into canvas.width/canvas.height.
      devicePixelRatio: () => {
        const rect = this._canvas.getBoundingClientRect();
        const layoutWidth = this._canvas.clientWidth || rect.width || 1;
        const visualScale = rect.width > 0 ? rect.width / layoutWidth : 1;
        return (globalThis.devicePixelRatio || 1) / Math.max(visualScale, Number.EPSILON);
      },
    });
    try {
      await engine.init();
      this._deviceErrorListener = event => this._onError(event.error);
      engine.device.addEventListener('uncapturederror', this._deviceErrorListener);
      const cameraEntity = new Entity('Animation Editor preview camera');
      const camera = new Camera2D({
        width: 800,
        height: 500,
        designWidth: 800,
        designHeight: 500,
        viewportMode: 'fit',
      });
      cameraEntity.addComponent(camera);
      const scene = engine.createScene({
        name: 'Animation Editor runtime preview',
        camera: { type: '2d', entity: cameraEntity },
        render3D: false,
        render2D: false,
        gui: false,
        pipelineLabel: 'AnimationEditor.preview',
      });
      scene.addSystem(new Animation2DSystem({ priority: -10, assetManager: engine.assetManager! }), false);
      scene.addSystem(new Animation2DStateMachineSystem({ priority: -11, assetManager: engine.assetManager! }), false);
      scene.addSystem(new Particle2DSystem({ priority: -9 }), false);
      const renderSystem = new Animation2DRenderSystem(engine, cameraEntity, {
        loadOp: 'clear',
        maxMaskTargets: 16,
      });
      scene.addSystem(renderSystem);
      scene.addSystem(new Particle2DRenderSystem(engine, cameraEntity, { loadOp: 'load', priority: 10 }));
      engine.switchScene(scene);
      engine.on('after-update', this._onAfterUpdate);
      engine.run();

      this._engine = engine;
      this._scene = scene;
      this._camera = camera;
      this._renderSystem = renderSystem;
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(this._canvas);
      this.resize();
    } catch (error) {
      if (this._deviceErrorListener) engine.device.removeEventListener('uncapturederror', this._deviceErrorListener);
      this._deviceErrorListener = null;
      engine.destroy();
      this._initializing = null;
      throw error;
    }
  }

  private _onAfterUpdate = (): void => this._emitFrame();

  private _emitFrame(): void {
    const player = this._player;
    if (!player) return;
    this._onFrame(Object.freeze({
      currentTime: this.currentTime,
      duration: player.animation.duration,
      playing: player.playing,
      visualCount: this._renderSystem?.stats.visualCount ?? 0,
      unsupportedComponentCount: player.runtimeStats.unsupportedComponentCount,
      stateMachineLayers: Object.freeze(player instanceof Animation2DStateMachineComponent
        ? player.layerSnapshots.map(layer => Object.freeze({
            layerId: layer.layerId,
            currentStateId: layer.currentStateId,
            transitionId: layer.transitionId,
            sourceStateId: layer.sourceStateId,
            destinationStateId: layer.destinationStateId,
            transitionProgress: layer.transitionProgress,
          }))
        : []),
    }));
  }

  private _requireStateMachine(): Animation2DStateMachineComponent {
    if (!(this._player instanceof Animation2DStateMachineComponent)) {
      throw new Error('The current runtime preview does not contain a state machine.');
    }
    return this._player;
  }
}
