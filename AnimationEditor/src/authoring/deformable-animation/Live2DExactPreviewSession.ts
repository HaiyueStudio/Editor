import type { ParsedAnimation } from '@haiyue/animation-spec';
import {
  Animation2DComponent,
  Animation2DExtensionRegistry,
  Animation2DRenderSystem,
  Animation2DSystem,
} from '@haiyue/extensions/animation';
import { createDeformableMesh2DRuntimeExtension, type DeformableMesh2DRuntimeStatus } from '@haiyue/extensions/deformable-animation';
import { Camera2D, Entity, HaiyueEngine, Transform2D, type Scene } from '@haiyue/engine';
import { Live2DImportError, type Live2DDerivedAsset } from '../../import/deformable-animation/Live2DImportWorkflow';
import type { Live2DExactPreviewPort } from './Live2DImportSession';

export interface Live2DExactPreviewSnapshot {
  readonly state: 'idle' | 'loading' | 'ready' | 'error' | 'closed';
  readonly assetId: string | null;
  readonly drawableCount: number;
  readonly visualCount: number;
  readonly objectUrlsCreated: number;
  readonly objectUrlsRevoked: number;
  readonly activeObjectUrls: number;
  readonly pendingAssetJobs: number;
  readonly error: string | null;
}

export interface Live2DExactPreviewOptions {
  readonly timeoutMs?: number;
  readonly autoplay?: boolean;
  readonly onSnapshot?: (snapshot: Live2DExactPreviewSnapshot) => void;
  readonly onError?: (error: unknown) => void;
}

interface PreviewOwner {
  readonly assetId: string;
  readonly entity: Entity;
  readonly player: Animation2DComponent;
  readonly unregisterExtension: () => void;
  readonly objectUrls: readonly string[];
}

/** Exact HYA WebGPU owner. It never loads Cubism or evaluates source parameters. */
export class Live2DExactPreviewSession implements Live2DExactPreviewPort {
  readonly #timeoutMs: number;
  readonly #autoplay: boolean;
  readonly #onSnapshot: (snapshot: Live2DExactPreviewSnapshot) => void;
  readonly #onError: (error: unknown) => void;
  #engine: HaiyueEngine | null = null;
  #scene: Scene | null = null;
  #camera: Camera2D | null = null;
  #renderSystem: Animation2DRenderSystem | null = null;
  #active: PreviewOwner | null = null;
  #initializing: Promise<void> | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #deviceErrorListener: ((event: GPUUncapturedErrorEvent) => void) | null = null;
  #state: Live2DExactPreviewSnapshot['state'] = 'idle';
  #drawableCount = 0;
  #objectUrlsCreated = 0;
  #objectUrlsRevoked = 0;
  #lastError: string | null = null;
  #closed = false;

  constructor(readonly canvas: HTMLCanvasElement, options: Live2DExactPreviewOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#autoplay = options.autoplay ?? true;
    this.#onSnapshot = options.onSnapshot ?? (() => {});
    this.#onError = options.onError ?? (() => {});
  }

  get supported(): boolean { return 'gpu' in navigator; }
  get snapshot(): Live2DExactPreviewSnapshot { return this.#snapshot(); }

  async replace(asset: Live2DDerivedAsset, signal?: AbortSignal): Promise<void> {
    this.#assertOpen();
    if (signal?.aborted) throw abortedPreview();
    try {
      await this.#initialize();
      this.#assertOpen();
      if (signal?.aborted) throw abortedPreview();
    } catch (error) {
      if (this.#closed || signal?.aborted) throw abortedPreview();
      this.#state = 'error';
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#onError(error);
      this.#emit();
      throw error instanceof Live2DImportError ? error : new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', this.#lastError);
    }
    this.#state = 'loading';
    this.#lastError = null;
    this.#emit();
    const packageOwner = createPackageOwner(
      asset,
      blob => { this.#objectUrlsCreated++; return URL.createObjectURL(blob); },
      url => { URL.revokeObjectURL(url); this.#objectUrlsRevoked++; },
    );
    let candidate: PreviewOwner | null = null;
    let candidateEntity: Entity | null = null;
    let unregisterExtension: (() => void) | null = null;
    let abort: (() => void) | null = null;
    let timer: number | undefined;
    try {
      const registry = new Animation2DExtensionRegistry();
      let resolveReady!: (count: number) => void;
      let rejectReady!: (error: Error) => void;
      const ready = new Promise<number>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      unregisterExtension = registry.register(createDeformableMesh2DRuntimeExtension({
        onStatus: (status: DeformableMesh2DRuntimeStatus) => {
          if (status.state === 'ready') resolveReady(status.drawableCount);
          else if (status.state === 'error') rejectReady(new Error(status.error ?? 'Deformable runtime preview failed.'));
        },
      }));
      const entity = new Entity(`Live2D exact preview: ${asset.id}`).addComponent(new Transform2D());
      candidateEntity = entity;
      const player = new Animation2DComponent(packageOwner.animation, {
        autoplay: this.#autoplay,
        loop: packageOwner.animation.endBehavior === 'loop',
        runtimeExtensions: registry,
      });
      entity.addComponent(player);
      candidate = { assetId: asset.id, entity, player, unregisterExtension, objectUrls: packageOwner.objectUrls };
      this.#scene!.add(entity);
      abort = (): void => rejectReady(abortedPreview());
      signal?.addEventListener('abort', abort, { once: true });
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(`Exact preview did not become ready within ${this.#timeoutMs} ms.`)), this.#timeoutMs);
      });
      const drawableCount = await Promise.race([ready, timeout]);
      this.#assertOpen();
      if (signal?.aborted) throw abortedPreview();
      const previous = this.#active;
      this.#camera!.setViewportFit({
        designWidth: packageOwner.animation.canvas.width,
        designHeight: packageOwner.animation.canvas.height,
        viewportMode: 'fit',
      });
      this.resize();
      if (previous) this.#disposeOwner(previous);
      this.#active = candidate;
      this.#drawableCount = drawableCount;
      this.#state = 'ready';
      this.#emit();
    } catch (error) {
      if (candidate) this.#disposeOwner(candidate);
      else {
        candidateEntity?.destroy();
        unregisterExtension?.();
        for (const url of packageOwner.objectUrls) { URL.revokeObjectURL(url); this.#objectUrlsRevoked++; }
      }
      if (!this.#closed) this.#state = this.#active ? 'ready' : 'error';
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#onError(error);
      this.#emit();
      throw error instanceof Live2DImportError ? error : new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', this.#lastError);
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }

  clear(): void {
    if (this.#active) this.#disposeOwner(this.#active);
    this.#active = null;
    this.#drawableCount = 0;
    if (!this.#closed) this.#state = 'idle';
    this.#emit();
  }

  play(): void { this.#active?.player.play(); }
  pause(): void { this.#active?.player.pause(); }
  seek(seconds: number): void { this.#active?.player.seek(seconds); }

  resize(): void {
    if (!this.#engine || !this.#camera) return;
    this.#engine.resizeToDisplaySize();
    this.#camera.resize(this.#engine.displayWidth, this.#engine.displayHeight);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.clear();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (this.#deviceErrorListener && this.#engine) this.#engine.device.removeEventListener('uncapturederror', this.#deviceErrorListener);
    this.#deviceErrorListener = null;
    this.#engine?.destroy();
    this.#engine = null;
    this.#scene = null;
    this.#camera = null;
    this.#renderSystem = null;
    this.#initializing = null;
    this.#state = 'closed';
    this.#emit();
  }

  async #initialize(): Promise<void> {
    if (this.#engine) return;
    if (!this.supported) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'WebGPU is unavailable for exact HYA preview.');
    this.#initializing ??= this.#initializeEngine();
    await this.#initializing;
  }

  async #initializeEngine(): Promise<void> {
    const engine = new HaiyueEngine({ canvas: this.canvas, clearColor: { r: 0.031, g: 0.047, b: 0.075, a: 1 } });
    try {
      await engine.init();
      if (this.#closed) throw abortedPreview();
      this.#deviceErrorListener = event => this.#onError(event.error);
      engine.device.addEventListener('uncapturederror', this.#deviceErrorListener);
      const cameraEntity = new Entity('Live2D exact preview camera');
      const camera = new Camera2D({ width: 512, height: 512, designWidth: 512, designHeight: 512, viewportMode: 'fit' });
      cameraEntity.addComponent(camera);
      const scene = engine.createScene({
        name: 'Live2D exact HYA preview', camera: { type: '2d', entity: cameraEntity }, render3D: false, render2D: false, gui: false,
        pipelineLabel: 'AnimationEditor.live2d-exact-preview',
      });
      scene.addSystem(new Animation2DSystem({ priority: -10, assetManager: engine.assetManager! }), false);
      const renderSystem = new Animation2DRenderSystem(engine, cameraEntity, { loadOp: 'clear', maxMaskTargets: 16 });
      scene.addSystem(renderSystem);
      engine.switchScene(scene);
      engine.run();
      this.#engine = engine;
      this.#scene = scene;
      this.#camera = camera;
      this.#renderSystem = renderSystem;
      this.#resizeObserver = new ResizeObserver(() => this.resize());
      this.#resizeObserver.observe(this.canvas);
      this.resize();
    } catch (error) {
      if (this.#deviceErrorListener) engine.device.removeEventListener('uncapturederror', this.#deviceErrorListener);
      this.#deviceErrorListener = null;
      engine.destroy();
      this.#initializing = null;
      throw error;
    }
  }

  #disposeOwner(owner: PreviewOwner): void {
    this.#scene?.remove(owner.entity);
    owner.entity.destroy();
    owner.unregisterExtension();
    for (const url of owner.objectUrls) { URL.revokeObjectURL(url); this.#objectUrlsRevoked++; }
  }

  #assertOpen(): void { if (this.#closed) throw new Live2DImportError('E_LIVE2D_ABORTED', 'Exact preview session is closed.'); }
  #snapshot(): Live2DExactPreviewSnapshot {
    return Object.freeze({
      state: this.#state,
      assetId: this.#active?.assetId ?? null,
      drawableCount: this.#drawableCount,
      visualCount: this.#renderSystem?.stats.visualCount ?? 0,
      objectUrlsCreated: this.#objectUrlsCreated,
      objectUrlsRevoked: this.#objectUrlsRevoked,
      activeObjectUrls: this.#objectUrlsCreated - this.#objectUrlsRevoked,
      pendingAssetJobs: this.#engine?.assetManager?.pendingJobCount ?? 0,
      error: this.#lastError,
    });
  }
  #emit(): void { this.#onSnapshot(this.#snapshot()); }
}

function createPackageOwner(
  asset: Live2DDerivedAsset,
  createUrl: (blob: Blob) => string,
  revokeUrl: (url: string) => void,
): Readonly<{ readonly animation: ParsedAnimation; readonly objectUrls: readonly string[] }> {
  const sidecars = new Map(asset.sidecars.map(sidecar => [normalizePath(sidecar.path), sidecar]));
  const urls = new Map<string, string>();
  try {
    for (const resource of asset.preview.resources) {
      const path = normalizePath(resource.uri);
      const sidecar = sidecars.get(path);
      if (!sidecar) throw new Live2DImportError('E_LIVE2D_DEPENDENCY_MISSING', `Exact preview package is missing "${path}".`);
      urls.set(path, createUrl(new Blob([new Uint8Array(sidecar.bytes)], { type: sidecar.mimeType })));
    }
    const animation = Object.freeze({
      ...asset.preview,
      resources: Object.freeze(asset.preview.resources.map(resource => Object.freeze({ ...resource, uri: urls.get(normalizePath(resource.uri))! }))),
    }) as ParsedAnimation;
    return Object.freeze({ animation, objectUrls: Object.freeze([...urls.values()]) });
  } catch (error) {
    for (const url of urls.values()) revokeUrl(url);
    throw error;
  }
}

function normalizePath(value: string): string { return value.replaceAll('\\', '/').replace(/^\.\//u, ''); }
function abortedPreview(): Live2DImportError { return new Live2DImportError('E_LIVE2D_ABORTED', 'Exact preview replacement was cancelled.'); }
