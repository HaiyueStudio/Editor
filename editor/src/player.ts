import { BlinnPhongMaterial, ToonMaterial } from '@haiyue/engine/material';
import { BlinnPhongRenderSystem, Mesh2DRenderSystem, Render3DSystem, ToonRenderSystem } from '@haiyue/engine/systems';
import { Camera2D, Camera3D, Entity, Mesh3D, SphericalTransform3D, System, HaiyueEngine, World } from '@haiyue/engine';
import { KeyboardComponent, ScriptComponent, type ScriptLifecycleName } from '@haiyue/engine/components';
import { InputMap } from '@haiyue/engine/input';
import { RenderView } from '@haiyue/engine/core';
import {
  RenderIntegration,
  type RenderPipelineEntryOptions,
  type RenderPipelineSystem,
  } from './engine-adapter/EditorRenderProtocol';
import type {
  SerializedEditorScene,
  SerializedGlobalSettings,
  SerializedRadialShadowRenderFeature,
  SerializedScript,
} from './export/RuntimeSceneContract';
import type { PlayerRuntime, PointerRuntime } from './engine-adapter/PlayerRuntimeAdapter';
import { getEngineDefaultsFromGlobalSettings } from './domain/settings/globalSettings';
import { RuntimeOwnershipScope } from './domain/runtime/RuntimeOwnershipScope';
import {
  getEditorOrigin,
  getPlayerCommand,
  installPlayerConsoleBridge,
  isRuntimeInspectorFieldEdit,
  isSerializedScriptMessage,
  isTrustedEditorMessage,
  postError,
  postLifecycle,
  postLog,
} from './player/PlayerProtocol';
import {
  loadPlayerOptionalRuntime,
  type PlayerOptionalRuntime,
} from './player/PlayerOptionalRuntime';

type PlayerSerializedScene = SerializedEditorScene;
type PlayerDebugModule = typeof import('./player/PlayerDebugRuntime');
type PlayerShadowModule = typeof import('./player/PlayerShadowRuntime');

interface PlayerDebugRuntime {
  readonly inspector: InstanceType<PlayerDebugModule['RuntimeInspectorBridge']>;
  readonly breakpointController: InstanceType<PlayerDebugModule['ScriptBreakpointController']>;
  readonly getEngineFrameDiagnostics: PlayerDebugModule['getEngineFrameDiagnostics'];
  readonly getEngineGPUResourceTracker: PlayerDebugModule['getEngineGPUResourceTracker'];
  readonly deriveRenderDomainDiagnostics: PlayerDebugModule['deriveRenderDomainDiagnostics'];
}

interface PlayerWorldProbe {
  camera3D: Entity | null;
  camera2D: Entity | null;
  hasBlinnPhongMesh: boolean;
  hasToonMesh: boolean;
  hasRadialShadowMesh: boolean;
  hasInstancedMesh: boolean;
}

const canvas = document.getElementById('player-canvas') as HTMLCanvasElement;
const message = document.getElementById('message') as HTMLElement | null;
const webGpuCompatibility = HaiyueEngine.webGpuCompatibility;
let engine: HaiyueEngine | null = null;
let world: World | null = null;
let pointerRuntime: PointerRuntime | null = null;
let currentScene: PlayerSerializedScene | null = null;
let currentDevicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
let resizeObserver: ResizeObserver | null = null;
let paused = false;
let currentRuntime: PlayerRuntime | null = null;
let currentRenderIntegration: RenderIntegration | null = null;
let performanceFrameCount = 0;
let performanceAccumulatedDeltaMs = 0;
let performanceLastReportMs = 0;
const runtimeOwnership = new RuntimeOwnershipScope();
const INSTANCED_MESH_3D_SYMBOL = Symbol.for('InstancedMesh3D');
let playerDebugRuntime: PlayerDebugRuntime | null = null;
let playerDebugRuntimePromise: Promise<PlayerDebugRuntime> | null = null;
let playerSceneGeneration = 0;
let pendingDebugSelection: number | null = null;
let pendingDebugBreakpoints: string[] = [];

function ensurePlayerDebugRuntime(): Promise<PlayerDebugRuntime> {
  playerDebugRuntimePromise ??= import('./player/PlayerDebugRuntime').then(module => {
    const inspector = new module.RuntimeInspectorBridge(() => world);
    const runtime = {
      inspector,
      breakpointController: new module.ScriptBreakpointController(inspector),
      getEngineFrameDiagnostics: module.getEngineFrameDiagnostics,
      getEngineGPUResourceTracker: module.getEngineGPUResourceTracker,
      deriveRenderDomainDiagnostics: module.deriveRenderDomainDiagnostics,
    };
    playerDebugRuntime = runtime;
    return runtime;
  });
  return playerDebugRuntimePromise;
}

function postPerformanceSnapshot(now: number, deltaMs: number): void {
  const debug = playerDebugRuntime;
  if (!world || !engine || !debug) return;
  performanceFrameCount++;
  performanceAccumulatedDeltaMs += deltaMs;
  if (performanceLastReportMs === 0) {
    performanceLastReportMs = now;
    return;
  }
  const elapsed = now - performanceLastReportMs;
  if (elapsed < 1000) return;
  const frameCount = performanceFrameCount;
  const frameDiagnostics = debug.getEngineFrameDiagnostics(engine);
  const resourceTracker = debug.getEngineGPUResourceTracker(engine);
  const frameSnapshot = frameDiagnostics?.snapshot();
  const pipelineSnapshot = currentRenderIntegration?.pipeline.getDebugSnapshot();
  const resourceSnapshot = resourceTracker?.getDebugSnapshot();
  const diagnosticComponents = [...world.entities.values()].flatMap(entity => [...entity.components.values()].map(component => ({
    lightType: 'lightType' in component ? component.lightType : undefined,
    castShadow: 'castShadow' in component ? component.castShadow : undefined,
    disabled: component.disabled,
    destroyed: component.destroyed,
    entityDisabled: entity.disabled,
  })));
  window.parent.postMessage({
    type: 'game-editor-player-performance',
    time: Date.now(),
    metrics: {
      fps: frameCount > 0 ? frameCount * 1000 / elapsed : 0,
      frameMs: frameCount > 0 ? performanceAccumulatedDeltaMs / frameCount : 0,
      entityCount: world.entities.size,
      systemCount: world.systems.size,
      width: engine.width,
      height: engine.height,
      dpr: currentDevicePixelRatio,
      breakpointCount: debug.breakpointController.count,
      diagnostics: {
        frame: frameSnapshot,
        pipeline: pipelineSnapshot,
        resources: resourceSnapshot,
        renderDomains: debug.deriveRenderDomainDiagnostics({
          components: diagnosticComponents,
          ...(frameSnapshot === undefined ? {} : { frame: frameSnapshot }),
          ...(pipelineSnapshot === undefined ? {} : { pipeline: pipelineSnapshot }),
          ...(resourceSnapshot === undefined ? {} : { resources: resourceSnapshot }),
        }),
        assets: engine.assetManager?.getDebugSnapshot(),
        device: {
          state: engine.state,
          timestampQuery: engine.timestampQuerySupported,
          format: engine.format,
        },
      },
    },
  }, getEditorOrigin());
  performanceFrameCount = 0;
  performanceAccumulatedDeltaMs = 0;
  performanceLastReportMs = now;
}

installPlayerConsoleBridge();

function showMessage(text: string): void {
  if (!message) return;
  message.textContent = text;
  message.style.display = 'block';
}

function showWebGpuCompatibility(error: unknown): boolean {
  const compatibility = webGpuCompatibility.classifyError(error);
  if (!compatibility || !message) return false;
  webGpuCompatibility.renderPage(message, compatibility, {
    productName: 'Haiyue Player',
  });
  return true;
}

function resizeCanvas(): void {
  engine?.resizeToDisplaySize();
}

function releaseRuntimeOwnership(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('resize', resizeCanvas);
  runtimeOwnership.release();
  world = null;
  pointerRuntime = null;
  engine = null;
  currentRuntime = null;
  currentRenderIntegration = null;
}

function stopScene(): void {
  playerSceneGeneration++;
  releaseRuntimeOwnership();
  playerDebugRuntime?.breakpointController.reset();
  performanceFrameCount = 0;
  performanceAccumulatedDeltaMs = 0;
  performanceLastReportMs = 0;
  paused = false;
  playerDebugRuntime?.inspector.reset();
  ScriptComponent.resetRuntimeApiFactory();
  ScriptComponent.resetExecutionOptions();
  postLifecycle('stopped');
}

function updateRuntimeScript(script: SerializedScript): void {
  const resource = currentRuntime?.scriptMap.get(script.id);
  if (!resource) {
    postLog('warn', [`Script hot reload skipped; runtime script ${script.id} was not found.`]);
    return;
  }
  resource.name = script.name;
  for (const [lifecycle, code] of Object.entries(script.scripts)) {
    resource.setScript(lifecycle as ScriptLifecycleName, String(code ?? ''));
  }
  postLog('log', [`Script hot reloaded: ${resource.name} (${script.id})`]);
}

function pauseScene(): void {
  if (!engine || paused) return;
  engine.stop();
  paused = true;
  postLifecycle('paused');
}

function resumeScene(): void {
  if (!engine || !paused) return;
  playerDebugRuntime?.breakpointController.prepareResume();
  engine.run();
  paused = false;
  canvas.focus();
  postLifecycle('resumed');
}

async function restartScene(): Promise<void> {
  if (!currentScene) return;
  postLifecycle('restarting');
  await runScene(currentScene, currentDevicePixelRatio, playerDebugRuntime?.inspector.selectedEntityId ?? null);
}

function applyViewportSettingsToCamera2D(cameraEntity: Entity, globals: SerializedGlobalSettings | undefined): void {
  cameraEntity.getComponent(Camera2D)?.setViewportFit({
    ...(globals?.designWidth === undefined ? {} : { designWidth: globals.designWidth }),
    ...(globals?.designHeight === undefined ? {} : { designHeight: globals.designHeight }),
    viewportMode: globals?.viewportMode ?? 'expand',
  });
}

function probePlayerWorld(world: World): PlayerWorldProbe {
  const probe: PlayerWorldProbe = {
    camera3D: null,
    camera2D: null,
    hasBlinnPhongMesh: false,
    hasToonMesh: false,
    hasRadialShadowMesh: false,
    hasInstancedMesh: false,
  };
  for (const entity of world.entities.values()) {
    if (!entity.disabled) {
      if (!probe.camera3D && entity.getComponent(Camera3D)) probe.camera3D = entity;
      if (!probe.camera2D && entity.getComponent(Camera2D)) probe.camera2D = entity;
    }
    const mesh = entity.getComponent(Mesh3D);
    if (mesh?.material instanceof BlinnPhongMaterial) probe.hasBlinnPhongMesh = true;
    if (mesh?.material instanceof ToonMaterial) probe.hasToonMesh = true;
    if (mesh?.material.type === 'radial-shadow') probe.hasRadialShadowMesh = true;
    if ([...entity.components.values()].some(component => component.UniqueSymbol === INSTANCED_MESH_3D_SYMBOL)) {
      probe.hasInstancedMesh = true;
    }
  }
  return probe;
}

function installConfiguredSystems(
  scene: PlayerSerializedScene,
  world: World,
  engine: HaiyueEngine,
  cameraEntity: Entity,
  probe: PlayerWorldProbe,
  optionalRuntime: PlayerOptionalRuntime,
  addRenderSystem: (system: System & RenderPipelineSystem, options?: RenderPipelineEntryOptions) => void,
): void {
  for (const config of scene.systems ?? []) {
    if (config.disabled) continue;
    if (config.type === 'Physics2DSystem') {
      optionalRuntime.installConfiguredPhysics(world, config);
    }
  }
}

function configurePlayerDebug(
  debug: PlayerDebugRuntime,
  selectedEntityId: number | null,
  breakpoints: readonly string[],
): void {
  debug.inspector.select(selectedEntityId, false);
  debug.breakpointController.resetPauseState();
  debug.breakpointController.setBreakpoints(breakpoints);
  ScriptComponent.setExecutionOptions({ debugger: debug.breakpointController.handle });
}

async function ensureCurrentSceneDebug(generation: number): Promise<PlayerDebugRuntime | null> {
  const debug = await ensurePlayerDebugRuntime();
  if (generation !== playerSceneGeneration || !world || !engine) return null;
  configurePlayerDebug(debug, pendingDebugSelection, pendingDebugBreakpoints);
  return debug;
}

async function installDeferredShadowRuntime(options: {
  generation: number;
  scene: PlayerSerializedScene;
  world: World;
  engine: HaiyueEngine;
  cameraEntity: Entity;
  probe: PlayerWorldProbe;
  addRenderSystem: (system: System & RenderPipelineSystem, options?: RenderPipelineEntryOptions) => void;
}): Promise<void> {
  const configured = (options.scene.systems ?? [])
    .filter((config): config is SerializedRadialShadowRenderFeature =>
      !config.disabled && config.type === 'RadialShadowRenderFeature');
  if (!options.probe.hasRadialShadowMesh && configured.length === 0) return;
  const shadowRuntime = await import('./player/PlayerShadowRuntime');
  if (options.generation !== playerSceneGeneration
    || world !== options.world
    || engine !== options.engine) return;
  if (options.probe.hasRadialShadowMesh && configured.length === 0) {
    options.addRenderSystem(
      new shadowRuntime.RadialShadowRenderFeature(options.engine, options.cameraEntity, {
        loadOp: 'load',
        priority: 20,
      }),
      { pass: 'shared', loadOp: 'load' },
    );
  }
  for (const config of configured) {
    options.addRenderSystem(new shadowRuntime.RadialShadowRenderFeature(
      options.engine,
      options.cameraEntity,
      {
        loadOp: config.loadOp,
        priority: config.priority,
      },
    ), { pass: 'shared', loadOp: config.loadOp });
  }
}

async function runScene(
  scene: PlayerSerializedScene,
  devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2),
  initialSelectedEntityId: number | null = null,
  breakpoints: string[] = [],
): Promise<void> {
  const generation = ++playerSceneGeneration;
  currentScene = scene;
  pendingDebugSelection = initialSelectedEntityId;
  pendingDebugBreakpoints = [...breakpoints];
  const debug = breakpoints.length > 0
    ? await ensurePlayerDebugRuntime()
    : null;
  if (debug) configurePlayerDebug(debug, initialSelectedEntityId, breakpoints);
  performanceFrameCount = 0;
  performanceAccumulatedDeltaMs = 0;
  performanceLastReportMs = 0;
  currentDevicePixelRatio = Math.max(0.5, Math.min(4, Number(devicePixelRatio) || 1));
  releaseRuntimeOwnership();
  ScriptComponent.resetRuntimeApiFactory();
  ScriptComponent.resetExecutionOptions();
  paused = false;
  postLifecycle('loading');
  const [optionalRuntime, runtimeAdapter, deserialization, playerResources] = await Promise.all([
    loadPlayerOptionalRuntime(scene),
    import('./engine-adapter/PlayerRuntimeAdapter'),
    import('./domain/scene/deserialization'),
    import('./domain/runtime/playerResources'),
  ]);
  const {
    createRuntimeApiFactory,
    InstancedMesh3DRenderSystem,
    PointerRuntime,
  } = runtimeAdapter;
  const { deserializeEntity } = deserialization;
  const { deserializePlayerResources } = playerResources;
  const defaults = scene.globals ? getEngineDefaultsFromGlobalSettings(scene.globals) : undefined;
  engine = new HaiyueEngine({
    canvas,
    ...(defaults === undefined ? {} : { defaults }),
    alphaMode: 'premultiplied',
    msaaSamples: 4,
    devicePixelRatio: () => currentDevicePixelRatio,
    diagnostics: { enabled: true },
  });
  runtimeOwnership.bindEngine(engine);
  try {
    await engine.init();
  } catch (error) {
    releaseRuntimeOwnership();
    throw error;
  }
  const compatibility = webGpuCompatibility.report(engine.capabilities);
  if (message) {
    webGpuCompatibility.renderPage(message, compatibility, {
      productName: 'Haiyue Player',
    });
  }
  if (compatibility.status === webGpuCompatibility.Status.OptionalFeatureDegraded) {
    console.warn(compatibility.message, compatibility.degradations);
  }

  world = new World(scene.name || 'Player Scene');
  runtimeOwnership.bindWorld(world);
  const renderIntegration = new RenderIntegration(engine, { label: 'EditorPlayerRenderPipeline' });
  currentRenderIntegration = renderIntegration;
  world.addRuntimeIntegration(renderIntegration);
  (world as World & { globals?: SerializedGlobalSettings }).globals = scene.globals;
  KeyboardComponent.setInputMap(scene.globals?.inputMap ?? InputMap.defaultTetris());
  canvas.tabIndex = 0;
  canvas.focus();

  const { geometryMap, materialMap, scriptMap, prefabMap } = deserializePlayerResources(scene.resources);

  pointerRuntime = new PointerRuntime(canvas);
  runtimeOwnership.bindPointer(pointerRuntime);
  const registerRenderSystem = (system: RenderPipelineSystem & Partial<System>, options?: RenderPipelineEntryOptions) => {
    renderIntegration.register(system, options);
  };
  const runtime: PlayerRuntime = {
    engine,
    world,
    geometryMap,
    materialMap,
    scriptMap,
    prefabMap,
    canvas,
    pointer: pointerRuntime,
    registerRenderSystem,
  };
  currentRuntime = runtime;
  ScriptComponent.setRuntimeApiFactory(createRuntimeApiFactory(
    runtime,
    optionalRuntime.runtimeApiCapabilities,
  ));
  ScriptComponent.enableTrustedProject({
    capabilities: ['read', 'scene', 'asset', 'input', 'physics', 'debug'],
    ...(debug ? { debugger: debug.breakpointController.handle } : {}),
    onError: event => postError(event.error),
    errorPolicy: 'disable-script',
  });

  for (const entityData of scene.entities ?? []) {
    world.addEntity(deserializeEntity(entityData, geometryMap, materialMap, scriptMap, {
      deserializePrefabInstances: false,
      extensions: [...optionalRuntime.componentExtensions],
    }));
  }

  const probe = probePlayerWorld(world);
  let cameraEntity = probe.camera3D;
  if (!cameraEntity) {
    cameraEntity = new Entity('Camera');
    cameraEntity.addComponent(new Camera3D({ type: 'perspective', fov: Math.PI / 4, near: 0.1, far: 100 }));
    cameraEntity.addComponent(new SphericalTransform3D({ radius: 8, theta: Math.PI / 4, phi: Math.PI / 3 }));
    world.addEntity(cameraEntity);
  }
  renderIntegration.setExecuteOptions({
    view: new RenderView({
      camera: cameraEntity,
      target: engine.renderTarget,
      clearColor: engine.clearColor,
      depthConvention: engine.reverseZ ? 'reverse' : 'standard',
      sampleCount: engine.msaaSamples,
    }),
  });

  const addRenderSystem = (system: System & RenderPipelineSystem, options?: RenderPipelineEntryOptions) => {
    world!.addSystem(system);
    registerRenderSystem(system, options);
  };

  const render3DSystem = new Render3DSystem(engine, cameraEntity, { loadOp: 'clear', priority: 0, reverseZ: engine.reverseZ });
  addRenderSystem(
    render3DSystem,
    { pass: 'shared', loadOp: 'clear' },
  );
  if (probe.hasBlinnPhongMesh) {
    world.addSystem(new BlinnPhongRenderSystem(engine, cameraEntity, { priority: -1, render3DSystem }));
  }
  if (probe.hasToonMesh) {
    world.addSystem(new ToonRenderSystem(engine, cameraEntity, { priority: -1, render3DSystem }));
  }
  if (probe.hasInstancedMesh) {
    const instancedSystem = new InstancedMesh3DRenderSystem(engine, cameraEntity, { loadOp: 'load' });
    instancedSystem.priority = 2;
    addRenderSystem(instancedSystem, { pass: 'shared', loadOp: 'load' });
  }
  const camera2DEntity = probe.camera2D;
  if (camera2DEntity) {
    applyViewportSettingsToCamera2D(camera2DEntity, scene.globals);
    addRenderSystem(new Mesh2DRenderSystem(engine, camera2DEntity, { loadOp: 'load', priority: 3 }), { pass: 'shared', loadOp: 'load' });
  }
  optionalRuntime.installSceneSystems({
    world,
    engine,
    camera2DEntity,
    addRenderSystem,
  });
  installConfiguredSystems(scene, world, engine, cameraEntity, probe, optionalRuntime, addRenderSystem);

  resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(canvas);
  window.addEventListener('resize', resizeCanvas);

  engine.on('update', ({ detail: { time, delta } }) => {
    const currentDebug = playerDebugRuntime;
    const diagnostics = engine && currentDebug
      ? currentDebug.getEngineFrameDiagnostics(engine)
      : undefined;
    if (diagnostics) diagnostics.measure('update', () => world?.update(time, delta));
    else world?.update(time, delta);
    currentDebug?.inspector.sync();
    pointerRuntime?.endFrame();
    postPerformanceSnapshot(time, delta);
    currentDebug?.breakpointController.flush(engine, paused, () => { paused = true; });
  });
  debug?.inspector.postSnapshot();
  engine.run();
  postLifecycle('started');
  requestAnimationFrame(() => {
    if (generation !== playerSceneGeneration) return;
    if (!debug) {
      void ensureCurrentSceneDebug(generation).then(runtime => {
        runtime?.inspector.postSnapshot();
      }).catch(error => postError(error));
    }
    void installDeferredShadowRuntime({
      generation,
      scene,
      world: world!,
      engine: engine!,
      cameraEntity,
      probe,
      addRenderSystem,
    }).catch(error => postError(error));
  });
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isTrustedEditorMessage(event)) return;
  const data = getPlayerCommand(event.data);
  if (!data) return;
  if (data.type === 'game-editor-load-scene') {
    void import('./domain/scene/deserialization').then(async ({ validateSerializedEditorScene }) => {
      (validateSerializedEditorScene as (value: unknown) => void)(data.scene);
      await runScene(
        data.scene as PlayerSerializedScene,
        typeof data.devicePixelRatio === 'number' ? data.devicePixelRatio : undefined,
        typeof data.selectedEntityId === 'number' ? data.selectedEntityId : null,
        Array.isArray(data.breakpoints) ? data.breakpoints.filter((item): item is string => typeof item === 'string') : [],
      );
    }).catch((error) => {
      postError(error);
      console.error('Failed to run scene.', error);
      if (!showWebGpuCompatibility(error)) showMessage('Failed to run scene.');
    });
    return;
  }
  if (data.type === 'game-editor-player-select-entity') {
    pendingDebugSelection = typeof data.entityId === 'number' ? data.entityId : null;
    if (playerDebugRuntime) playerDebugRuntime.inspector.select(pendingDebugSelection);
    else void ensureCurrentSceneDebug(playerSceneGeneration).then(debug => debug?.inspector.postSnapshot()).catch(error => postError(error));
    return;
  }
  if (data.type === 'game-editor-player-edit-field') {
    if (isRuntimeInspectorFieldEdit(data.edit)) {
      const edit = data.edit;
      if (playerDebugRuntime) playerDebugRuntime.inspector.applyEdit(edit);
      else void ensureCurrentSceneDebug(playerSceneGeneration).then(debug => debug?.inspector.applyEdit(edit)).catch(error => postError(error));
    }
    return;
  }
  if (data.type === 'game-editor-player-update-script') {
    if (isSerializedScriptMessage(data.script)) updateRuntimeScript(data.script);
    return;
  }
  if (data.type === 'game-editor-player-breakpoints') {
    const nextBreakpoints = Array.isArray(data.breakpoints)
      ? data.breakpoints.filter((item): item is string => typeof item === 'string')
      : [];
    pendingDebugBreakpoints = nextBreakpoints;
    if (playerDebugRuntime) playerDebugRuntime.breakpointController.setBreakpoints(nextBreakpoints);
    else void ensureCurrentSceneDebug(playerSceneGeneration).catch(error => postError(error));
    postLog('debug', [`Runtime breakpoints updated: ${nextBreakpoints.length}`]);
    return;
  }
  if (data.type === 'game-editor-player-pause') {
    pauseScene();
    return;
  }
  if (data.type === 'game-editor-player-resume') {
    resumeScene();
    return;
  }
  if (data.type === 'game-editor-player-restart') {
    void restartScene().catch((error) => {
      postError(error);
      console.error('Failed to restart scene.', error);
    });
    return;
  }
  if (data.type === 'game-editor-player-stop') {
    stopScene();
  }
});

window.parent.postMessage({ type: 'game-editor-player-ready' }, getEditorOrigin());
