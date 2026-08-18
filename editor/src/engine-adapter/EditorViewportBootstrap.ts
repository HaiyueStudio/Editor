import { BlinnPhongMaterial, PlanarMirrorMaterial, ToonMaterial, VolumeMaterial, type Material } from '@haiyue/engine/material';
import { Camera3D, Entity, OrbitControl, SphericalTransform3D, HaiyueEngine, World } from '@haiyue/engine';
import { BlinnPhongRenderSystem, Render3DSystem, ToonRenderSystem } from '@haiyue/engine/systems';
import { PipelineWarmupPlan, type PipelineWarmupTask } from '@haiyue/engine/scene';
import { Physics2DTo3DTransformSyncSystem } from '@haiyue/engine/systems';

const MAX_DEVICE_PIXEL_RATIO = 2;
const webGpuCompatibility = HaiyueEngine.webGpuCompatibility;

const OPTIONAL_RENDERER_CAPABILITIES = {
  VolumeRenderer: { capability: 'volume', label: 'Volume' },
  PlanarMirrorRenderer: { capability: 'planar-mirror', label: 'Planar Mirror' },
  BlinnPhongRenderer: { capability: 'blinn-phong', label: 'Blinn-Phong' },
  ToonRenderer: { capability: 'toon', label: 'Toon' },
} as const;

export type EditorRendererCapability =
  typeof OPTIONAL_RENDERER_CAPABILITIES[keyof typeof OPTIONAL_RENDERER_CAPABILITIES]['capability'];

export interface EditorRendererWarmupDegradation {
  readonly capability: EditorRendererCapability;
  readonly label: string;
  readonly renderer: string;
  readonly task: string;
  readonly error: Error;
}

export interface EditorRendererWarmupDegradationPolicy {
  tolerate: (error: Error, task: PipelineWarmupTask) => boolean;
  snapshot: () => readonly EditorRendererWarmupDegradation[];
}

export interface EditorSceneBootstrap {
  world: World;
  sceneRoot: Entity;
  cameraEntity: Entity;
  cameraTransform: SphericalTransform3D;
}

export interface EditorViewportBootstrapResult {
  engine: HaiyueEngine;
  orbitControl: OrbitControl;
  render3D: Render3DSystem;
  degradedRenderers: readonly EditorRendererWarmupDegradation[];
}

export interface EditorViewportBootstrapDeps {
  canvas: HTMLCanvasElement;
  viewportMessage: HTMLElement | null;
  getClearColor: () => { r: number; g: number; b: number; a: number };
  getReverseZ: () => boolean;
  syncViewportClearColor: (engine: HaiyueEngine) => void;
}

export interface ViewportResizeController {
  resizeNow: () => boolean;
  scheduleResize: () => void;
  observe: (viewportWrap: HTMLElement | null, signal: AbortSignal) => void;
}

function showViewportMessage(element: HTMLElement | null, message: string): void {
  if (!element) return;
  element.style.display = 'block';
  element.textContent = message;
}

function hideViewportMessage(element: HTMLElement | null): void {
  if (!element || element.dataset.engineRecovery === 'true') return;
  element.style.display = 'none';
  element.textContent = '';
}

function showRecoveryMessage(element: HTMLElement | null, message: string): void {
  if (!element) return;
  element.dataset.engineRecovery = 'true';
  showViewportMessage(element, message);
}

function hideRecoveryMessage(element: HTMLElement | null): void {
  if (!element || element.dataset.engineRecovery !== 'true') return;
  delete element.dataset.engineRecovery;
  element.style.display = 'none';
  element.textContent = '';
}

export function createEditorRendererWarmupDegradationPolicy(
  disableCapability: (capability: EditorRendererCapability) => void,
): EditorRendererWarmupDegradationPolicy {
  const degraded = new Map<EditorRendererCapability, EditorRendererWarmupDegradation>();
  const tolerate = (error: Error, task: PipelineWarmupTask): boolean => {
    const separator = task.id.indexOf('#');
    const owner = task.owner ?? (separator > 0 ? task.id.slice(0, separator) : task.id);
    const optional = OPTIONAL_RENDERER_CAPABILITIES[
      owner as keyof typeof OPTIONAL_RENDERER_CAPABILITIES
    ];
    if (!optional) return false;
    if (degraded.has(optional.capability)) return true;

    disableCapability(optional.capability);
    degraded.set(optional.capability, Object.freeze({
      capability: optional.capability,
      label: optional.label,
      renderer: owner,
      task: task.label,
      error,
    }));
    return true;
  };
  return Object.freeze({
    tolerate,
    snapshot: () => Object.freeze([...degraded.values()]),
  });
}

function installUnavailableMaterialFallback<M extends Material>(
  render3D: Render3DSystem,
  materialType: new (...args: never[]) => M,
): void {
  render3D.registerMaterialRenderer<M>({
    materialType,
    renderItem: () => {},
    renderBatch: () => {},
  });
}

export function disableOptionalRendererCapability(
  capability: EditorRendererCapability,
  render3D: Render3DSystem,
  blinnPhongSystem: BlinnPhongRenderSystem,
  toonSystem: ToonRenderSystem,
): void {
  switch (capability) {
    case 'volume':
      installUnavailableMaterialFallback(render3D, VolumeMaterial);
      break;
    case 'planar-mirror':
      render3D.planarMirrorsEnabled = false;
      installUnavailableMaterialFallback(render3D, PlanarMirrorMaterial);
      break;
    case 'blinn-phong':
      blinnPhongSystem.disabled = true;
      installUnavailableMaterialFallback(render3D, BlinnPhongMaterial);
      break;
    case 'toon':
      toonSystem.disabled = true;
      installUnavailableMaterialFallback(render3D, ToonMaterial);
      break;
  }
}

export function createDefaultEditorScene(): EditorSceneBootstrap {
  const world = new World('EditorWorld');
  const sceneRoot = new Entity('Scene');
  const cameraTransform = new SphericalTransform3D({
    radius: 8,
    theta: Math.PI / 4,
    phi: Math.PI / 3,
    target: [0, 0, 0],
  });
  const cameraEntity = new Entity('Camera');
  cameraEntity.addComponent(new Camera3D({ type: 'perspective', fov: Math.PI / 4, near: 0.1, far: 100 }));
  cameraEntity.addComponent(cameraTransform);
  sceneRoot.addChild(cameraEntity);
  world.addEntity(sceneRoot);
  return { world, sceneRoot, cameraEntity, cameraTransform };
}

export function createViewportResizeController(
  canvas: HTMLCanvasElement,
  engine?: HaiyueEngine,
): ViewportResizeController {
  let resizeFrameId = 0;

  const resizeNow = (): boolean => {
    const viewportWrap = canvas.parentElement;
    if (!viewportWrap) return false;
    const rect = viewportWrap.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.floor(rect.width));
    const displayHeight = Math.max(1, Math.floor(rect.height));
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    return engine?.resizeToDisplaySize() ?? false;
  };

  const scheduleResize = () => {
    cancelAnimationFrame(resizeFrameId);
    resizeFrameId = requestAnimationFrame(() => {
      resizeNow();
    });
  };

  const observe = (viewportWrap: HTMLElement | null, signal: AbortSignal) => {
    const resizeObserver = new ResizeObserver(scheduleResize);
    if (viewportWrap) resizeObserver.observe(viewportWrap);
    signal.addEventListener('abort', () => resizeObserver.disconnect(), { once: true });
    window.addEventListener('resize', scheduleResize, { signal });
    scheduleResize();
  };

  return { resizeNow, scheduleResize, observe };
}

export async function bootstrapEditorViewport(
  deps: EditorViewportBootstrapDeps,
  scene: EditorSceneBootstrap,
): Promise<EditorViewportBootstrapResult | null> {
  createViewportResizeController(deps.canvas).resizeNow();
  const clearColor = deps.getClearColor();
  const reverseZ = deps.getReverseZ();
  const engine = new HaiyueEngine({
    canvas: deps.canvas,
    defaults: {
      clearColor,
      reverseZ,
      scene: {
        clearColor,
        reverseZ,
        render3D: { reverseZ },
      },
    },
    alphaMode: 'premultiplied',
    msaaSamples: 4,
    devicePixelRatio: () => Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO),
  });
  engine.on('device-lost', () => {
    showRecoveryMessage(deps.viewportMessage, 'GPU device lost. Rendering is paused while 海月 recovers the viewport.');
  });
  engine.on('recovery-progress', event => {
    const { completed, total, message } = event.detail;
    showRecoveryMessage(deps.viewportMessage, `Recovering GPU ${completed}/${total}: ${message}`);
  });
  engine.on('device-restored', () => {
    hideRecoveryMessage(deps.viewportMessage);
  });
  engine.on('recovery-failed', event => {
    showRecoveryMessage(deps.viewportMessage, `GPU recovery failed: ${event.detail.error.message}`);
  });
  deps.syncViewportClearColor(engine);

  try {
    await engine.init();
  } catch (error) {
    console.error('Failed to initialize editor viewport.', error);
    const compatibility = webGpuCompatibility.classifyError(error);
    if (compatibility && deps.viewportMessage) {
      webGpuCompatibility.renderPage(deps.viewportMessage, compatibility, {
        productName: 'Haiyue Editor',
      });
    } else {
      showViewportMessage(deps.viewportMessage, 'Failed to initialize WebGPU viewport.');
    }
    engine.destroy();
    return null;
  }
  const deviceCompatibility = webGpuCompatibility.report(engine.capabilities);

  const render3D = new Render3DSystem(engine, scene.cameraEntity, {
    priority: 0,
    loadOp: 'clear',
    reverseZ: engine.reverseZ,
  });
  let blinnPhongSystem = scene.world.getSystem(BlinnPhongRenderSystem) as BlinnPhongRenderSystem | undefined;
  if (!blinnPhongSystem) {
    blinnPhongSystem = new BlinnPhongRenderSystem(engine, scene.cameraEntity, {
      priority: -1,
      render3DSystem: render3D,
    });
    scene.world.addSystem(blinnPhongSystem);
  } else {
    blinnPhongSystem.attachRender3DSystem(render3D);
  }
  let toonSystem = scene.world.getSystem(ToonRenderSystem) as ToonRenderSystem | undefined;
  if (!toonSystem) {
    toonSystem = new ToonRenderSystem(engine, scene.cameraEntity, {
      priority: -1,
      render3DSystem: render3D,
    });
    scene.world.addSystem(toonSystem);
  } else {
    toonSystem.attachRender3DSystem(render3D);
  }
  scene.world.addSystem(render3D);
  if (!scene.world.getSystem(Physics2DTo3DTransformSyncSystem)) {
    scene.world.addSystem(new Physics2DTo3DTransformSyncSystem({ priority: 0.5 }));
  }

  const warmupPlan = new PipelineWarmupPlan('Editor viewport shaders');
  render3D.contributePipelineWarmup(warmupPlan);
  blinnPhongSystem.contributePipelineWarmup(warmupPlan);
  toonSystem.contributePipelineWarmup(warmupPlan);
  const degradationPolicy = createEditorRendererWarmupDegradationPolicy(capability => {
    disableOptionalRendererCapability(capability, render3D, blinnPhongSystem, toonSystem);
  });
  const unsubscribeWarmup = warmupPlan.subscribe(progress => {
    if (progress.status !== 'running') return;
    const current = progress.currentTask ? ` · ${progress.currentTask}` : '';
    showViewportMessage(
      deps.viewportMessage,
      `正在编译 shader ${progress.completed}/${progress.total}${current}`,
    );
  });
  let degradedRenderers: readonly EditorRendererWarmupDegradation[] = [];
  try {
    await warmupPlan.run({ onTaskError: degradationPolicy.tolerate });
    degradedRenderers = degradationPolicy.snapshot();
    if (degradedRenderers.length > 0) {
      for (const degradation of degradedRenderers) {
        console.warn(
          `[EditorViewport] Optional renderer ${degradation.renderer} was disabled after warmup failed.`,
          degradation.error,
        );
      }
    }
    const rendererDegradations = degradedRenderers.map(
      degradation => ({
        feature: degradation.label,
        fallback: 'renderer disabled',
        reason: degradation.error.message,
      }),
    );
    const compatibility = webGpuCompatibility.degraded([
      ...deviceCompatibility.degradations,
      ...rendererDegradations,
    ]);
    if (
      compatibility.status === webGpuCompatibility.Status.OptionalFeatureDegraded
      && deps.viewportMessage
    ) {
      webGpuCompatibility.renderPage(deps.viewportMessage, compatibility, {
        productName: 'Haiyue Editor',
      });
    } else {
      hideViewportMessage(deps.viewportMessage);
    }
  } catch (error) {
    console.error('Failed to warm up editor viewport shaders.', error);
    showViewportMessage(
      deps.viewportMessage,
      `Shader 编译失败：${error instanceof Error ? error.message : String(error)}`,
    );
    engine.destroy();
    return null;
  } finally {
    unsubscribeWarmup();
  }

  const orbitControl = new OrbitControl(deps.canvas, scene.cameraTransform, {
    minRadius: 3,
    maxRadius: 40,
    rotateSpeed: 0.8,
    zoomSpeed: 0.9,
  });

  return { engine, orbitControl, render3D, degradedRenderers };
}
