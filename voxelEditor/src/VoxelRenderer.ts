import { AmbientLight, PointLight } from '@haiyue/engine/lighting';
import { Camera3D, CartesianTransform3D, ColorSRGB, DirectionalLight, Entity, EnvironmentLight, HaiyueEngine, OrbitControl, SphericalTransform3D, createBox3D } from '@haiyue/engine';
import { InstancedPbrMaterial, LineMaterial } from '@haiyue/engine/material';
import { InstancedMesh3D, Line3D, type ProjectionType } from '@haiyue/engine/components';
import { InstancedMesh3DRenderSystem, Line3DRenderSystem } from '@haiyue/engine/systems';
import { LineGeometry } from '@haiyue/engine/geometry';
import { Ray as EngineRay } from '@haiyue/engine/math';
import { mat4 } from 'wgpu-matrix';
import type { RenderableVoxel, SceneSize, Voxel, VoxelPosition } from './model';
import { VoxelDocument, unpackVoxelKey, voxelKey } from './model';
import type { VoxelRenderInvalidation } from './uiRenderScheduler';
import { frameVoxelBounds, sceneVoxelBounds, voxelBounds } from './cameraFraming';
import { orthographicBounds, orthographicCameraRay } from './cameraProjection';
import { projectGizmoDragSteps } from './moduleTransform';
import { pickGridPlaneCell, pickGroundCell } from './picking';
import type { GridPlaneNormal, VoxelRay } from './picking';
import { projectWorldPoint } from './selection';
import { traceVoxelGrid } from './voxelRaycast';
import { VoxelGridLayer } from './VoxelGridLayer';
import {
  clampSliceIndex,
  pickWorkPlaneCell,
  slicePlaneNormal,
  voxelSliceVisibility,
} from './viewportSlice';
import type { ViewportSliceState } from './viewportSlice';
import { VoxelRenderProjectionCache } from './render/VoxelRenderProjectionCache';
import { VoxelSceneProjectionCache } from './render/VoxelSceneProjectionCache';
import {
  backgroundColorToGpu,
  cameraRadius,
  materialBatchKey,
  pointSegmentDistance,
} from './render/VoxelRenderMath';

export interface CellCoordinate { x: number; y: number; z: number }

export interface VoxelPickResult {
  voxel: RenderableVoxel | null;
  target: CellCoordinate | null;
  normal: readonly [number, number, number] | null;
}

export type ModuleGizmoAxis = 'x' | 'y' | 'z';
export type ModuleGizmoMode = 'move' | 'rotate' | 'scale';
export type SelectionGizmoMode = 'move' | 'duplicate' | 'rotate' | 'scale';
export interface SelectionGizmoPivot { x: number; y: number; z: number }
export type BoxSelectionMode = 'visible' | 'through';
export type CameraPresetView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

interface VoxelMaterialBatch {
  material: InstancedPbrMaterial;
  mesh: InstancedMesh3D;
  keys: string[];
  indices: Map<string, number>;
}

interface RenderedVoxelState {
  batchKey: string;
  index: number;
  materialId: string;
  moduleInstanceId: string | null;
  color: string;
  highlighted: boolean;
  conflicted: boolean;
  opacity: number;
  generation: number;
}

export class VoxelRenderer {
  readonly engine: HaiyueEngine;
  readonly cameraTransform: SphericalTransform3D;

  private readonly _document: VoxelDocument;
  private readonly _canvas: HTMLCanvasElement;
  private readonly _camera: Camera3D;
  private readonly _scene;
  private readonly _materialBatches = new Map<string, VoxelMaterialBatch>();
  private readonly _renderedVoxels = new Map<string, RenderedVoxelState>();
  private readonly _projectionCache = new VoxelRenderProjectionCache();
  private readonly _sceneProjectionCache = new VoxelSceneProjectionCache();
  private readonly _linearColorCache = new Map<string, Float32Array>();
  private readonly _translationPosition = new Float32Array(3);
  private readonly _translationMatrix = mat4.identity() as Float32Array;
  private readonly _brushPreviewBatch: VoxelMaterialBatch;
  private readonly _onionPreviousBatch: VoxelMaterialBatch;
  private readonly _onionNextBatch: VoxelMaterialBatch;
  private readonly _gridLayer: VoxelGridLayer;
  private readonly _selectionGeometry: LineGeometry;
  private readonly _gizmoGeometries = new Map<ModuleGizmoAxis, LineGeometry>();
  private readonly _gizmoMaterials = new Map<ModuleGizmoAxis, LineMaterial>();
  private readonly _selectionGizmoGeometries = new Map<ModuleGizmoAxis, LineGeometry>();
  private readonly _selectionGizmoMaterials = new Map<ModuleGizmoAxis, LineMaterial>();
  private readonly _selectionKeys = new Set<string>();
  private readonly _conflictKeys = new Set<string>();
  private readonly _orbit: OrbitControl;
  private readonly _meshRenderSystem: InstancedMesh3DRenderSystem;
  private _sliceState: ViewportSliceState = { axis: 'y', index: 0, mode: 'all', workPlaneEnabled: false };
  private _gizmoInstanceId: string | null = null;
  private _gizmoMode: ModuleGizmoMode = 'move';
  private _gizmoCenter: readonly [number, number, number] | null = null;
  private _gizmoLength = 3;
  private _selectionGizmoMode: SelectionGizmoMode = 'move';
  private _selectionGizmoPivot: SelectionGizmoPivot | null = null;
  private _selectionGizmoCenter: readonly [number, number, number] | null = null;
  private _selectionGizmoLength = 3;
  private _renderGeneration = 0;
  private _lastViewSizeSignature = '';
  private readonly _cameraRay = new EngineRay();
  private readonly _cameraPosition = new Float32Array(3);
  private readonly _viewMatrix = mat4.identity() as Float32Array;
  private readonly _viewProjectionMatrix = mat4.identity() as Float32Array;
  private readonly _inverseViewProjectionMatrix = mat4.identity() as Float32Array;
  private readonly _resizeObserver: ResizeObserver | null;
  private _resizeFrameId = 0;
  private readonly _scheduleViewportResize = (): void => {
    if (this._resizeFrameId !== 0) return;
    this._resizeFrameId = requestAnimationFrame(() => {
      this._resizeFrameId = 0;
      this.engine.resizeToDisplaySize();
      this._syncProjection();
    });
  };
  private readonly _syncProjection = (): void => {
    const rect = this._canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
    this._camera.updateAspect(aspect);
    if (this._camera.projectionType !== 'orthographic') return;
    const bounds = orthographicBounds(this.cameraTransform.radius, this._camera.fov, aspect);
    this._camera.orthoLeft = bounds.left;
    this._camera.orthoRight = bounds.right;
    this._camera.orthoTop = bounds.top;
    this._camera.orthoBottom = bounds.bottom;
  };

  private constructor(
    canvas: HTMLCanvasElement,
    document: VoxelDocument,
    engine: HaiyueEngine,
    camera: Camera3D,
    cameraTransform: SphericalTransform3D,
    scene: ReturnType<HaiyueEngine['createScene']>,
    mesh: InstancedMesh3D,
    material: InstancedPbrMaterial,
    orbit: OrbitControl,
    meshRenderSystem: InstancedMesh3DRenderSystem,
  ) {
    this._canvas = canvas;
    this._document = document;
    this.engine = engine;
    this._camera = camera;
    this.cameraTransform = cameraTransform;
    this._scene = scene;
    this._gridLayer = new VoxelGridLayer(scene);
    this._selectionGeometry = new LineGeometry([], { topology: 'segments' });
    const selectionEntity = new Entity('Selection Bounds');
    selectionEntity.addComponent(new CartesianTransform3D({ position: [0, 0, 0] }));
    selectionEntity.addComponent(new Line3D(this._selectionGeometry, new LineMaterial({
      color: new ColorSRGB(1, 0.66, 0.16, 1), width: 2.2, screenSpace: true, cap: 'butt',
    })));
    scene.world.addEntity(selectionEntity);
    const gizmoColors = {
      x: new ColorSRGB(0.95, 0.25, 0.28, 1),
      y: new ColorSRGB(0.28, 0.9, 0.42, 1),
      z: new ColorSRGB(0.25, 0.52, 1, 1),
    };
    for (const axis of ['x', 'y', 'z'] as const) {
      const geometry = new LineGeometry();
      const lineMaterial = new LineMaterial({ color: gizmoColors[axis], width: 3.2, screenSpace: true, cap: 'round' });
      const entity = new Entity(`Module Gizmo ${axis.toUpperCase()}`);
      entity.addComponent(new CartesianTransform3D({ position: [0, 0, 0] }));
      entity.addComponent(new Line3D(geometry, lineMaterial));
      scene.world.addEntity(entity);
      this._gizmoGeometries.set(axis, geometry);
      this._gizmoMaterials.set(axis, lineMaterial);

      const selectionGizmoGeometry = new LineGeometry();
      const selectionGizmoMaterial = new LineMaterial({ color: gizmoColors[axis], width: 3.6, screenSpace: true, cap: 'round' });
      const selectionGizmoEntity = new Entity(`Selection Gizmo ${axis.toUpperCase()}`);
      selectionGizmoEntity.addComponent(new CartesianTransform3D({ position: [0, 0, 0] }));
      selectionGizmoEntity.addComponent(new Line3D(selectionGizmoGeometry, selectionGizmoMaterial));
      scene.world.addEntity(selectionGizmoEntity);
      this._selectionGizmoGeometries.set(axis, selectionGizmoGeometry);
      this._selectionGizmoMaterials.set(axis, selectionGizmoMaterial);
    }
    this._materialBatches.set(materialBatchKey(material.metallic, material.roughness, false), {
      mesh,
      material,
      keys: [],
      indices: new Map(),
    });
    const brushPreviewMaterial = new InstancedPbrMaterial(1024, {
      metallic: 0.04, roughness: 0.68, alphaMode: 'blend',
    });
    brushPreviewMaterial.setActiveInstanceCount(0);
    const brushPreviewMesh = new InstancedMesh3D(
      createBox3D({ width: 1.01, height: 1.01, depth: 1.01 }),
      brushPreviewMaterial,
    );
    const brushPreviewEntity = new Entity('Brush Preview');
    brushPreviewEntity.addComponent(brushPreviewMesh);
    scene.world.addEntity(brushPreviewEntity);
    this._brushPreviewBatch = { mesh: brushPreviewMesh, material: brushPreviewMaterial, keys: [], indices: new Map() };
    this._onionPreviousBatch = createOverlayBatch(scene, 'Onion Skin Previous');
    this._onionNextBatch = createOverlayBatch(scene, 'Onion Skin Next');
    this._orbit = orbit;
    this._meshRenderSystem = meshRenderSystem;
    this._resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(this._scheduleViewportResize);
    this._resizeObserver?.observe(canvas);
  }

  static async create(canvas: HTMLCanvasElement, document: VoxelDocument): Promise<VoxelRenderer> {
    const engine = new HaiyueEngine({
      canvas,
      clearColor: backgroundColorToGpu(document.sceneBackgroundColor),
      msaaSamples: 4,
    });
    await engine.init();

    const size = document.size;
    const cameraTransform = new SphericalTransform3D({
      radius: cameraRadius(size),
      theta: Math.PI * 0.24,
      phi: Math.PI * 0.31,
      target: [0, Math.min(8, size.y * 0.2), 0],
    });
    const cameraComponent = new Camera3D({ type: 'perspective', fov: Math.PI / 4, near: 0.1, far: 1000 });
    const camera = new Entity('Voxel Camera');
    camera.addComponent(cameraComponent);
    camera.addComponent(cameraTransform);

    const scene = engine.createScene({
      name: 'Voxel Editor',
      camera,
      render3D: false,
      render2D: false,
      gui: false,
      pipelineLabel: 'VoxelEditor.render',
    });
    const material = new InstancedPbrMaterial(1024, { metallic: 0.04, roughness: 0.68 });
    material.setActiveInstanceCount(0);
    const mesh = new InstancedMesh3D(createBox3D({ width: 0.96, height: 0.96, depth: 0.96 }), material);
    const meshEntity = new Entity('Voxels');
    meshEntity.addComponent(mesh);
    scene.add(meshEntity);
    addEditorLighting(scene, size);
    const meshRenderSystem = new InstancedMesh3DRenderSystem(engine, camera, { loadOp: 'clear' });
    scene.addSystem(meshRenderSystem);
    scene.addSystem(new Line3DRenderSystem(engine, camera, { loadOp: 'load', msaaSamples: 4 }));

    const orbit = new OrbitControl(canvas, cameraTransform, {
      minRadius: 3,
      maxRadius: 500,
      rotateSpeed: 0.85,
      panSpeed: 0.75,
      zoomSpeed: 0.85,
    });
    const renderer = new VoxelRenderer(
      canvas, document, engine, cameraComponent, cameraTransform, scene, mesh, material, orbit, meshRenderSystem,
    );
    renderer._syncProjection();
    engine.on('update', renderer._syncProjection);
    renderer.rebuildGrid();
    renderer.refreshVoxels();
    engine.switchScene(scene);
    engine.run();
    return renderer;
  }

  setBackgroundColor(color: string): void {
    const clearColor = backgroundColorToGpu(color);
    this.engine.clearColor = clearColor;
    this._scene.renderView.clearColor = { ...clearColor };
  }

  refreshVoxels(invalidation?: Readonly<VoxelRenderInvalidation>): void {
    const size = this._document.viewSize;
    const sizeSignature = `${size.x},${size.y},${size.z}`;
    const sizeChanged = sizeSignature !== this._lastViewSizeSignature;
    this._lastViewSizeSignature = sizeSignature;
    if (invalidation && !invalidation.fullRender && !sizeChanged) {
      const packedKeys = new Set<number>(invalidation.voxelKeys);
      if (invalidation.materialIds.size > 0) {
        for (const key of this._projectionCache.keysForMaterials(invalidation.materialIds)) {
          const [x, y, z] = key.split(',').map(Number);
          packedKeys.add((x! & 0xff) | ((y! & 0xff) << 8) | ((z! & 0xff) << 16));
        }
      }
      for (const key of this._projectionCache.keysForInstances(invalidation.instanceIds)) {
        const [x, y, z] = key.split(',').map(Number);
        packedKeys.add((x! & 0xff) | ((y! & 0xff) << 8) | ((z! & 0xff) << 16));
      }
      const slice = invalidation.instanceIds.size > 0 && !this._document.isEditingModule
        ? this._sceneProjectionCache.project({
          ...this._document.getSceneProjectionSource(),
          requestedKeys: packedKeys,
          changedInstanceIds: invalidation.instanceIds,
        })
        : { keys: packedKeys, voxels: this._document.getViewVoxelsForPackedKeys(packedKeys) };
      for (const packed of slice.keys) {
        const position = unpackVoxelKey(packed);
        const key = voxelKey(position.x, position.y, position.z);
        this._refreshVoxel(key, slice.voxels.get(packed), size);
      }
      this._rebuildSelectionBounds();
      this._rebuildModuleGizmo();
      this._rebuildSelectionGizmo();
      return;
    }
    const voxels = this._document.viewVoxels;
    const generation = ++this._renderGeneration;
    for (const voxel of voxels.values()) {
      const sliceVisibility = voxelSliceVisibility(voxel, this._sliceState);
      if (sliceVisibility === 'hidden') continue;
      const opacity = sliceVisibility === 'context' ? 0.2 : 1;
      const voxelId = voxelKey(voxel.x, voxel.y, voxel.z);
      const pbr = this._document.resolveVoxelMaterialView(voxel);
      const batchKey = materialBatchKey(pbr.metallic, pbr.roughness, opacity < 1);
      const highlighted = this._selectionKeys.has(voxelId) || voxel.moduleInstanceId === this._gizmoInstanceId;
      const conflicted = this._conflictKeys.has(voxelId);
      let state = this._renderedVoxels.get(voxelId);
      if (state && state.batchKey !== batchKey) {
        this._removeRenderedVoxel(voxelId, state);
        state = undefined;
      }
      if (!state) {
        const batch = this._getOrCreateMaterialBatch(batchKey, pbr.metallic, pbr.roughness, opacity < 1);
        const index = batch.keys.length;
        this._ensureCapacity(batch, index + 1);
        batch.keys.push(voxelId);
        batch.indices.set(voxelId, index);
        state = {
          batchKey,
          index,
          materialId: pbr.id,
          moduleInstanceId: voxel.moduleInstanceId ?? null,
          color: voxel.color,
          highlighted,
          conflicted,
          opacity,
          generation,
        };
        this._renderedVoxels.set(voxelId, state);
        this._projectionCache.set(voxelId, pbr.id, voxel.moduleInstanceId ?? null);
        this._writeVoxelTransform(batch.material, index, voxel, size);
        this._writeVoxelColor(batch.material, index, voxel.color, highlighted, conflicted, opacity);
        batch.material.setActiveInstanceCount(batch.keys.length);
      } else {
        const batch = this._materialBatches.get(state.batchKey)!;
        state.generation = generation;
        state.materialId = pbr.id;
        state.moduleInstanceId = voxel.moduleInstanceId ?? null;
        this._projectionCache.set(voxelId, pbr.id, voxel.moduleInstanceId ?? null);
        if (sizeChanged) this._writeVoxelTransform(batch.material, state.index, voxel, size);
        if (state.color !== voxel.color || state.highlighted !== highlighted
          || state.conflicted !== conflicted || state.opacity !== opacity) {
          this._writeVoxelColor(batch.material, state.index, voxel.color, highlighted, conflicted, opacity);
          state.color = voxel.color;
          state.highlighted = highlighted;
          state.conflicted = conflicted;
          state.opacity = opacity;
        }
      }
    }
    for (const [key, state] of this._renderedVoxels) {
      if (state.generation !== generation) this._removeRenderedVoxel(key, state);
    }
    this._rebuildSelectionBounds();
    this._rebuildModuleGizmo();
    this._rebuildSelectionGizmo();
  }

  private _refreshVoxel(voxelId: string, voxel: RenderableVoxel | undefined, size: SceneSize): void {
    const sliceVisibility = voxel ? voxelSliceVisibility(voxel, this._sliceState) : 'hidden';
    let state = this._renderedVoxels.get(voxelId);
    if (!voxel || sliceVisibility === 'hidden') {
      if (state) this._removeRenderedVoxel(voxelId, state);
      return;
    }
    const opacity = sliceVisibility === 'context' ? 0.2 : 1;
    const pbr = this._document.resolveVoxelMaterialView(voxel);
    const batchKey = materialBatchKey(pbr.metallic, pbr.roughness, opacity < 1);
    const highlighted = this._selectionKeys.has(voxelId) || voxel.moduleInstanceId === this._gizmoInstanceId;
    const conflicted = this._conflictKeys.has(voxelId);
    if (state && state.batchKey !== batchKey) {
      this._removeRenderedVoxel(voxelId, state);
      state = undefined;
    }
    if (!state) {
      const batch = this._getOrCreateMaterialBatch(batchKey, pbr.metallic, pbr.roughness, opacity < 1);
      const index = batch.keys.length;
      this._ensureCapacity(batch, index + 1);
      batch.keys.push(voxelId);
      batch.indices.set(voxelId, index);
      state = {
        batchKey, index, materialId: pbr.id, color: voxel.color,
        moduleInstanceId: voxel.moduleInstanceId ?? null,
        highlighted, conflicted, opacity, generation: this._renderGeneration,
      };
      this._renderedVoxels.set(voxelId, state);
      this._projectionCache.set(voxelId, pbr.id, voxel.moduleInstanceId ?? null);
      this._writeVoxelTransform(batch.material, index, voxel, size);
      this._writeVoxelColor(batch.material, index, voxel.color, highlighted, conflicted, opacity);
      batch.material.setActiveInstanceCount(batch.keys.length);
      return;
    }
    const batch = this._materialBatches.get(state.batchKey)!;
    if (state.color !== voxel.color || state.materialId !== pbr.id
      || state.highlighted !== highlighted || state.conflicted !== conflicted || state.opacity !== opacity) {
      this._writeVoxelColor(batch.material, state.index, voxel.color, highlighted, conflicted, opacity);
    }
    state.materialId = pbr.id;
    state.moduleInstanceId = voxel.moduleInstanceId ?? null;
    this._projectionCache.set(voxelId, pbr.id, voxel.moduleInstanceId ?? null);
    state.color = voxel.color;
    state.highlighted = highlighted;
    state.conflicted = conflicted;
    state.opacity = opacity;
  }

  setBrushPreview(
    positions: Iterable<VoxelPosition>,
    color: string,
    metallic = 0.04,
    roughness = 0.68,
  ): void {
    const voxels = Array.isArray(positions) ? positions : Array.from(positions);
    const batch = this._brushPreviewBatch;
    this._ensureCapacity(batch, voxels.length);
    batch.material.metallic = metallic;
    batch.material.roughness = roughness;
    const size = this._document.viewSize;
    const linear = this._linearColor(color);
    for (let index = 0; index < voxels.length; index += 1) {
      const voxel = voxels[index]!;
      this._writeVoxelTransform(batch.material, index, voxel, size);
      batch.material.setColor(index, linear[0] ?? 0, linear[1] ?? 0, linear[2] ?? 0, 1);
    }
    batch.material.setActiveInstanceCount(voxels.length);
  }

  clearBrushPreview(): void {
    this._brushPreviewBatch.material.setActiveInstanceCount(0);
  }

  setOnionSkin(
    previous: Iterable<Readonly<VoxelPosition>>,
    next: Iterable<Readonly<VoxelPosition>>,
  ): void {
    this._writeOverlayBatch(this._onionPreviousBatch, previous, '#4bbcff', 0.24);
    this._writeOverlayBatch(this._onionNextBatch, next, '#ff8c52', 0.2);
  }

  clearOnionSkin(): void {
    this._onionPreviousBatch.material.setActiveInstanceCount(0);
    this._onionNextBatch.material.setActiveInstanceCount(0);
  }

  setSelectionTransformPreview(voxels: Iterable<Readonly<Voxel>>): void {
    const preview = Array.isArray(voxels) ? voxels : Array.from(voxels);
    const batch = this._brushPreviewBatch;
    this._ensureCapacity(batch, preview.length);
    batch.material.metallic = 0.04;
    batch.material.roughness = 0.62;
    const size = this._document.viewSize;
    for (let index = 0; index < preview.length; index += 1) {
      const voxel = preview[index]!;
      const linear = this._linearColor(voxel.color);
      this._writeVoxelTransform(batch.material, index, voxel, size);
      batch.material.setColor(index, linear[0] ?? 0, linear[1] ?? 0, linear[2] ?? 0, 0.48);
    }
    batch.material.setActiveInstanceCount(preview.length);
  }

  rebuildGrid(): void {
    this._gridLayer.rebuild(this._document.viewSize, this._sliceState);
  }

  setSliceState(state: Readonly<ViewportSliceState>): boolean {
    const normalized: ViewportSliceState = {
      axis: state.axis,
      index: clampSliceIndex(this._document.viewSize, state.axis, state.index),
      mode: state.mode,
      workPlaneEnabled: state.workPlaneEnabled,
    };
    if (normalized.axis === this._sliceState.axis
      && normalized.index === this._sliceState.index
      && normalized.mode === this._sliceState.mode
      && normalized.workPlaneEnabled === this._sliceState.workPlaneEnabled) return false;
    this._sliceState = normalized;
    this._meshRenderSystem.instanceSorting = normalized.mode === 'context' ? 'depth-back-to-front' : 'none';
    this.rebuildGrid();
    return true;
  }

  get sliceState(): Readonly<ViewportSliceState> { return this._sliceState; }

  resetCamera(): void {
    const size = this._document.viewSize;
    this.cameraTransform.set(cameraRadius(size), Math.PI * 0.24, Math.PI * 0.31);
    this.cameraTransform.setTarget(0, Math.min(8, size.y * 0.2), 0);
    this._syncProjection();
  }

  get projectionType(): ProjectionType {
    return this._camera.projectionType;
  }

  setProjectionType(type: ProjectionType): void {
    this._camera.projectionType = type;
    this._syncProjection();
  }

  setCameraPreset(view: CameraPresetView): void {
    const angles: Record<CameraPresetView, readonly [number, number]> = {
      front: [0, Math.PI / 2],
      back: [Math.PI, Math.PI / 2],
      right: [Math.PI / 2, Math.PI / 2],
      left: [-Math.PI / 2, Math.PI / 2],
      top: [0, 0.005],
      bottom: [0, Math.PI - 0.005],
    };
    const [theta, phi] = angles[view];
    this.cameraTransform.set(this.cameraTransform.radius, theta, phi);
    this.setProjectionType('orthographic');
  }

  frameVoxels(voxels: Iterable<Readonly<VoxelPosition>>): boolean {
    const bounds = voxelBounds(voxels);
    if (!bounds) return false;
    this._frameBounds(bounds);
    return true;
  }

  frameAll(): void {
    const bounds = voxelBounds(this._document.viewVoxels.values()) ?? sceneVoxelBounds(this._document.viewSize);
    this._frameBounds(bounds);
  }

  setPrimaryDragEditing(active: boolean): void {
    this._orbit.enableRotate = !active;
  }

  setSelection(keys: ReadonlySet<string>): boolean {
    if (keys.size === this._selectionKeys.size) {
      let unchanged = true;
      for (const key of keys) {
        if (!this._selectionKeys.has(key)) { unchanged = false; break; }
      }
      if (unchanged) return false;
    }
    this._selectionKeys.clear();
    for (const key of keys) this._selectionKeys.add(key);
    return true;
  }

  setConflictHighlights(positions: Iterable<Readonly<VoxelPosition>>): boolean {
    const next = new Set(Array.from(positions, position => voxelKey(position.x, position.y, position.z)));
    if (next.size === this._conflictKeys.size && Array.from(next).every(key => this._conflictKeys.has(key))) return false;
    this._conflictKeys.clear();
    for (const key of next) this._conflictKeys.add(key);
    return true;
  }

  setModuleInstanceGizmo(instanceId: string | null, mode: ModuleGizmoMode = this._gizmoMode): boolean {
    if (instanceId === this._gizmoInstanceId && mode === this._gizmoMode) return false;
    this._gizmoInstanceId = instanceId;
    this._gizmoMode = mode;
    return true;
  }

  setSelectionTransformGizmo(mode: SelectionGizmoMode, pivot: Readonly<SelectionGizmoPivot> | null): boolean {
    if (mode === this._selectionGizmoMode
      && pivot?.x === this._selectionGizmoPivot?.x
      && pivot?.y === this._selectionGizmoPivot?.y
      && pivot?.z === this._selectionGizmoPivot?.z
      && Boolean(pivot) === Boolean(this._selectionGizmoPivot)) return false;
    this._selectionGizmoMode = mode;
    this._selectionGizmoPivot = pivot ? { ...pivot } : null;
    return true;
  }

  pickSelectionGizmo(clientX: number, clientY: number): ModuleGizmoAxis | null {
    const center = this._selectionGizmoCenter ? this._projectWorld(this._selectionGizmoCenter) : null;
    if (!center) return null;
    if (this._selectionGizmoMode !== 'rotate') {
      let best: { axis: ModuleGizmoAxis; distance: number } | null = null;
      for (const axis of ['x', 'y', 'z'] as const) {
        const endpoint = this._projectWorld(this._selectionGizmoEndpoint(axis));
        if (!endpoint) continue;
        const distance = pointSegmentDistance(clientX, clientY, center.x, center.y, endpoint.x, endpoint.y);
        if (distance <= 10 && (!best || distance < best.distance)) best = { axis, distance };
      }
      return best?.axis ?? null;
    }
    let best: { axis: ModuleGizmoAxis; distance: number } | null = null;
    for (const axis of ['x', 'y', 'z'] as const) {
      const points = this._selectionRingPoints(axis, 48);
      for (let index = 1; index < points.length; index += 1) {
        const a = this._projectWorld(points[index - 1]!);
        const b = this._projectWorld(points[index]!);
        if (!a || !b) continue;
        const distance = pointSegmentDistance(clientX, clientY, a.x, a.y, b.x, b.y);
        if (distance <= 9 && (!best || distance < best.distance)) best = { axis, distance };
      }
    }
    return best?.axis ?? null;
  }

  selectionGizmoDragSteps(axis: ModuleGizmoAxis, startX: number, startY: number, endX: number, endY: number): number {
    const center = this._selectionGizmoCenter ? this._projectWorld(this._selectionGizmoCenter) : null;
    const endpoint = this._selectionGizmoCenter ? this._projectWorld(this._selectionGizmoEndpoint(axis)) : null;
    if (!center || !endpoint) return 0;
    return projectGizmoDragSteps(
      { x: endpoint.x - center.x, y: endpoint.y - center.y },
      this._selectionGizmoLength,
      { x: endX - startX, y: endY - startY },
    );
  }

  selectionGizmoRotationTurns(
    axis: ModuleGizmoAxis,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): number {
    const start = this._selectionRingPlaneVector(axis, startX, startY);
    const end = this._selectionRingPlaneVector(axis, endX, endY);
    if (!start || !end) return 0;
    const dot = start[0] * end[0] + start[1] * end[1] + start[2] * end[2];
    const cross = axis === 'x'
      ? start[1] * end[2] - start[2] * end[1]
      : axis === 'y'
        ? start[2] * end[0] - start[0] * end[2]
        : start[0] * end[1] - start[1] * end[0];
    const angle = Math.atan2(cross, dot);
    return Math.round(angle / (Math.PI / 2));
  }

  pickModuleGizmo(clientX: number, clientY: number): ModuleGizmoAxis | null {
    const center = this._gizmoCenter ? this._projectWorld(this._gizmoCenter) : null;
    if (!center) return null;
    let best: { axis: ModuleGizmoAxis; distance: number } | null = null;
    for (const axis of ['x', 'y', 'z'] as const) {
      const endpoint = this._projectWorld(this._gizmoEndpoint(axis));
      if (!endpoint) continue;
      const distance = pointSegmentDistance(clientX, clientY, center.x, center.y, endpoint.x, endpoint.y);
      if (distance <= 10 && (!best || distance < best.distance)) best = { axis, distance };
    }
    return best?.axis ?? null;
  }

  moduleGizmoDragSteps(axis: ModuleGizmoAxis, startX: number, startY: number, endX: number, endY: number): number {
    const center = this._gizmoCenter ? this._projectWorld(this._gizmoCenter) : null;
    const endpoint = this._gizmoCenter ? this._projectWorld(this._gizmoEndpoint(axis)) : null;
    if (!center || !endpoint) return 0;
    const axisX = endpoint.x - center.x;
    const axisY = endpoint.y - center.y;
    return projectGizmoDragSteps(
      { x: axisX, y: axisY },
      this._gizmoLength,
      { x: endX - startX, y: endY - startY },
    );
  }

  voxelsInScreenRect(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    mode: BoxSelectionMode = 'visible',
  ): RenderableVoxel[] {
    const canvasRect = this._canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return [];
    this._syncProjection();
    const cameraWorld = this.cameraTransform.localMatrix;
    mat4.inverse(cameraWorld, this._viewMatrix);
    mat4.multiply(this._camera.projectionMatrix, this._viewMatrix, this._viewProjectionMatrix);
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const top = Math.min(startY, endY);
    const bottom = Math.max(startY, endY);
    const size = this._document.viewSize;
    const selected: RenderableVoxel[] = [];
    for (const voxel of this._document.viewVoxels.values()) {
      if (voxelSliceVisibility(voxel, this._sliceState) !== 'active') continue;
      const screen = projectWorldPoint(
        this._viewProjectionMatrix,
        [voxel.x - size.x / 2 + 0.5, voxel.y + 0.5, voxel.z - size.z / 2 + 0.5],
        canvasRect,
      );
      if (screen && screen.x >= left && screen.x <= right && screen.y >= top && screen.y <= bottom
        && (mode === 'through' || this._isVoxelVisibleAt(screen.x, screen.y, voxel))) selected.push(voxel);
    }
    return selected;
  }

  pick(clientX: number, clientY: number): VoxelPickResult {
    const ray = this._screenRay(clientX, clientY);
    if (!ray) return { voxel: null, target: null, normal: null };
    const workPlaneTarget = this._sliceState.workPlaneEnabled
      ? pickWorkPlaneCell(ray, this._document.viewSize, this._sliceState.axis, this._sliceState.index)
      : null;
    const workPlaneNormal = this._sliceState.workPlaneEnabled ? slicePlaneNormal(this._sliceState.axis) : null;
    const voxelHit = traceVoxelGrid(ray, this._document.viewSize, (x, y, z) => {
      const voxel = this._document.getViewVoxel(x, y, z) ?? null;
      return voxel && voxelSliceVisibility(voxel, this._sliceState) === 'active' ? voxel : null;
    });
    if (voxelHit) {
      const { voxel, normal } = voxelHit;
      return {
        voxel,
        normal: workPlaneNormal ?? normal,
        target: workPlaneTarget ?? (normal[0] === 0 && normal[1] === 0 && normal[2] === 0 ? null : {
          x: voxel.x + normal[0],
          y: voxel.y + normal[1],
          z: voxel.z + normal[2],
        }),
      };
    }
    if (workPlaneTarget && workPlaneNormal) return { voxel: null, target: workPlaneTarget, normal: workPlaneNormal };
    const target = pickGroundCell(ray, this._document.viewSize);
    return { voxel: null, target, normal: target ? [0, 1, 0] : null };
  }

  pickCellOnPlane(
    clientX: number,
    clientY: number,
    anchor: Readonly<CellCoordinate>,
    normal: GridPlaneNormal,
    surfaceOffset = 0,
  ): CellCoordinate | null {
    const ray = this._screenRay(clientX, clientY);
    return ray ? pickGridPlaneCell(ray, this._document.viewSize, anchor, normal, surfaceOffset) : null;
  }

  dispose(): void {
    this.engine.off('update', this._syncProjection);
    this._resizeObserver?.disconnect();
    if (this._resizeFrameId !== 0) cancelAnimationFrame(this._resizeFrameId);
    this._orbit.dispose();
    this._projectionCache.clear();
    this._sceneProjectionCache.clear();
    this.engine.destroy();
  }

  private _ensureCapacity(batch: VoxelMaterialBatch, count: number): void {
    if (count <= batch.material.instanceCount) return;
    let capacity = batch.material.instanceCount;
    while (capacity < count) capacity *= 2;
    const replacement = new InstancedPbrMaterial(capacity, {
      metallic: batch.material.metallic,
      roughness: batch.material.roughness,
      alphaMode: batch.material.alphaMode,
    });
    replacement.transforms.set(batch.material.transforms.subarray(0, batch.keys.length * 16));
    replacement.colors.set(batch.material.colors.subarray(0, batch.keys.length * 4));
    replacement.setActiveInstanceCount(batch.keys.length);
    batch.material = replacement;
    batch.mesh.material = replacement;
  }

  private _writeOverlayBatch(
    batch: VoxelMaterialBatch,
    positions: Iterable<Readonly<VoxelPosition>>,
    color: string,
    opacity: number,
  ): void {
    const voxels = Array.isArray(positions) ? positions : Array.from(positions);
    this._ensureCapacity(batch, voxels.length);
    const linear = this._linearColor(color);
    const size = this._document.viewSize;
    for (let index = 0; index < voxels.length; index += 1) {
      this._writeVoxelTransform(batch.material, index, voxels[index]!, size);
      batch.material.setColor(index, linear[0] ?? 0, linear[1] ?? 0, linear[2] ?? 0, opacity);
    }
    batch.material.setActiveInstanceCount(voxels.length);
  }

  private _getOrCreateMaterialBatch(
    key: string,
    metallic: number,
    roughness: number,
    transparent: boolean,
  ): VoxelMaterialBatch {
    const existing = this._materialBatches.get(key);
    if (existing) return existing;
    const material = new InstancedPbrMaterial(1024, { metallic, roughness, alphaMode: transparent ? 'blend' : 'opaque' });
    material.setActiveInstanceCount(0);
    const mesh = new InstancedMesh3D(createBox3D({ width: 0.96, height: 0.96, depth: 0.96 }), material);
    const entity = new Entity(`Voxel PBR ${key}`);
    entity.addComponent(mesh);
    this._scene.world.addEntity(entity);
    const batch = { material, mesh, keys: [], indices: new Map<string, number>() };
    this._materialBatches.set(key, batch);
    return batch;
  }

  private _removeRenderedVoxel(key: string, state: RenderedVoxelState): void {
    const batch = this._materialBatches.get(state.batchKey);
    if (!batch) {
      this._renderedVoxels.delete(key);
      this._projectionCache.delete(key);
      return;
    }
    const lastIndex = batch.keys.length - 1;
    const movedKey = batch.keys[lastIndex];
    if (state.index !== lastIndex && movedKey) {
      batch.material.copyInstance(lastIndex, state.index);
      batch.keys[state.index] = movedKey;
      batch.indices.set(movedKey, state.index);
      const movedState = this._renderedVoxels.get(movedKey);
      if (movedState) movedState.index = state.index;
    }
    batch.keys.pop();
    batch.indices.delete(key);
    batch.material.setActiveInstanceCount(batch.keys.length);
    this._renderedVoxels.delete(key);
    this._projectionCache.delete(key);
  }

  private _writeVoxelTransform(
    material: InstancedPbrMaterial,
    index: number,
    voxel: Readonly<VoxelPosition>,
    size: Readonly<SceneSize>,
  ): void {
    this._translationPosition[0] = voxel.x - size.x / 2 + 0.5;
    this._translationPosition[1] = voxel.y + 0.5;
    this._translationPosition[2] = voxel.z - size.z / 2 + 0.5;
    mat4.translation(this._translationPosition, this._translationMatrix);
    material.setTransform(index, this._translationMatrix);
  }

  private _writeVoxelColor(
    material: InstancedPbrMaterial,
    index: number,
    color: string,
    highlighted: boolean,
    conflicted: boolean,
    opacity = 1,
  ): void {
    const linear = this._linearColor(color);
    material.setColor(
      index,
      conflicted ? linear[0]! * 0.22 + 0.78 : highlighted ? linear[0]! * 0.42 + 0.58 : linear[0]!,
      conflicted ? linear[1]! * 0.22 + 0.03 : highlighted ? linear[1]! * 0.42 + 0.38 : linear[1]!,
      conflicted ? linear[2]! * 0.22 + 0.46 : highlighted ? linear[2]! * 0.42 + 0.04 : linear[2]!,
      opacity,
    );
  }

  private _linearColor(color: string): Float32Array {
    let linear = this._linearColorCache.get(color);
    if (!linear) {
      linear = ColorSRGB.fromHex(color).writeLinear(new Float32Array(4));
      if (this._linearColorCache.size >= 2048) this._linearColorCache.clear();
      this._linearColorCache.set(color, linear);
    }
    return linear;
  }

  private _rebuildSelectionBounds(): void {
    const keys = new Set(this._selectionKeys);
    if (this._gizmoInstanceId) {
      for (const key of this._projectionCache.keysForInstances([this._gizmoInstanceId])) keys.add(key);
    }
    const bounds = this._renderedBounds(keys);
    if (!bounds) { this._selectionGeometry.setPoints([]); return; }
    const { minX, minY, minZ, maxX, maxY, maxZ } = bounds;
    const size = this._document.viewSize;
    const padding = 0.035;
    const x0 = minX - size.x / 2 - padding;
    const x1 = maxX - size.x / 2 + padding;
    const y0 = minY - padding;
    const y1 = maxY + padding;
    const z0 = minZ - size.z / 2 - padding;
    const z1 = maxZ - size.z / 2 + padding;
    const corners: readonly (readonly [number, number, number])[] = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    const edges: readonly [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const points: number[] = [];
    for (const [startIndex, endIndex] of edges) {
      const start = corners[startIndex]!;
      const end = corners[endIndex]!;
      points.push(start[0], start[1], start[2], end[0], end[1], end[2]);
    }
    this._selectionGeometry.setPoints(points);
  }

  private _rebuildModuleGizmo(): void {
    for (const geometry of this._gizmoGeometries.values()) geometry.setPoints([]);
    this._gizmoCenter = null;
    if (!this._gizmoInstanceId || this._document.isEditingModule) return;
    const bounds = this._renderedBounds(this._projectionCache.keysForInstances([this._gizmoInstanceId]));
    if (!bounds) return;
    const { minX, minY, minZ, maxX, maxY, maxZ } = bounds;
    const size = this._document.viewSize;
    this._gizmoCenter = [
      (minX + maxX) / 2 - size.x / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2 - size.z / 2,
    ];
    this._gizmoLength = Math.max(2.5, Math.min(6, Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.45));
    for (const axis of ['x', 'y', 'z'] as const) {
      const endpoint = this._gizmoEndpoint(axis);
      this._gizmoMaterials.get(axis)!.width = this._gizmoMode === 'rotate' ? 4.5 : 3.2;
      this._gizmoGeometries.get(axis)!.setPoints([
        this._gizmoCenter[0], this._gizmoCenter[1], this._gizmoCenter[2], endpoint[0], endpoint[1], endpoint[2],
      ]);
    }
  }

  private _rebuildSelectionGizmo(): void {
    for (const geometry of this._selectionGizmoGeometries.values()) geometry.setPoints([]);
    this._selectionGizmoCenter = null;
    if (!this._selectionGizmoPivot || this._selectionKeys.size === 0) return;
    const bounds = this._renderedBounds(this._selectionKeys);
    if (!bounds) return;
    const { minX, minY, minZ, maxX, maxY, maxZ } = bounds;
    const size = this._document.viewSize;
    this._selectionGizmoCenter = [
      this._selectionGizmoPivot.x - size.x / 2,
      this._selectionGizmoPivot.y,
      this._selectionGizmoPivot.z - size.z / 2,
    ];
    this._selectionGizmoLength = Math.max(2.5, Math.min(7, Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.55));
    for (const axis of ['x', 'y', 'z'] as const) {
      const material = this._selectionGizmoMaterials.get(axis)!;
      material.width = this._selectionGizmoMode === 'rotate' ? 3.4 : this._selectionGizmoMode === 'scale' ? 4.2 : 3.6;
      if (this._selectionGizmoMode === 'rotate') {
        this._selectionGizmoGeometries.get(axis)!.setPoints(this._selectionRingPoints(axis, 48).flatMap(point => [...point]));
      } else {
        const endpoint = this._selectionGizmoEndpoint(axis);
        this._selectionGizmoGeometries.get(axis)!.setPoints([
          this._selectionGizmoCenter[0], this._selectionGizmoCenter[1], this._selectionGizmoCenter[2],
          endpoint[0], endpoint[1], endpoint[2],
        ]);
      }
    }
  }

  private _renderedBounds(keys: Iterable<string>): {
    minX: number; minY: number; minZ: number;
    maxX: number; maxY: number; maxZ: number;
  } | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const key of keys) {
      const state = this._renderedVoxels.get(key);
      if (!state || state.opacity !== 1) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      minX = Math.min(minX, x!); minY = Math.min(minY, y!); minZ = Math.min(minZ, z!);
      maxX = Math.max(maxX, x! + 1); maxY = Math.max(maxY, y! + 1); maxZ = Math.max(maxZ, z! + 1);
    }
    return minX === Infinity ? null : { minX, minY, minZ, maxX, maxY, maxZ };
  }

  private _selectionGizmoEndpoint(axis: ModuleGizmoAxis): readonly [number, number, number] {
    const center = this._selectionGizmoCenter ?? [0, 0, 0];
    return [
      center[0] + (axis === 'x' ? this._selectionGizmoLength : 0),
      center[1] + (axis === 'y' ? this._selectionGizmoLength : 0),
      center[2] + (axis === 'z' ? this._selectionGizmoLength : 0),
    ];
  }

  private _selectionRingPoints(axis: ModuleGizmoAxis, segments: number): readonly (readonly [number, number, number])[] {
    const center = this._selectionGizmoCenter ?? [0, 0, 0];
    const radius = this._selectionGizmoLength * 0.76;
    const points: [number, number, number][] = [];
    for (let index = 0; index <= segments; index += 1) {
      const angle = index / segments * Math.PI * 2;
      const a = Math.cos(angle) * radius;
      const b = Math.sin(angle) * radius;
      points.push(axis === 'x'
        ? [center[0], center[1] + a, center[2] + b]
        : axis === 'y'
          ? [center[0] + a, center[1], center[2] + b]
          : [center[0] + a, center[1] + b, center[2]]);
    }
    return points;
  }

  private _selectionRingPlaneVector(
    axis: ModuleGizmoAxis,
    clientX: number,
    clientY: number,
  ): readonly [number, number, number] | null {
    const center = this._selectionGizmoCenter;
    const ray = this._screenRay(clientX, clientY);
    if (!center || !ray) return null;
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const denominator = ray.direction[index]!;
    if (Math.abs(denominator) < 1e-5) return null;
    const distance = (center[index]! - ray.origin[index]!) / denominator;
    if (distance < 0) return null;
    const vector: [number, number, number] = [
      ray.origin[0] + ray.direction[0] * distance - center[0],
      ray.origin[1] + ray.direction[1] * distance - center[1],
      ray.origin[2] + ray.direction[2] * distance - center[2],
    ];
    if (Math.hypot(vector[0], vector[1], vector[2]) < 1e-4) return null;
    return vector;
  }

  private _gizmoEndpoint(axis: ModuleGizmoAxis): readonly [number, number, number] {
    const center = this._gizmoCenter ?? [0, 0, 0];
    return [
      center[0] + (axis === 'x' ? this._gizmoLength : 0),
      center[1] + (axis === 'y' ? this._gizmoLength : 0),
      center[2] + (axis === 'z' ? this._gizmoLength : 0),
    ];
  }

  private _projectWorld(point: readonly [number, number, number]): { x: number; y: number } | null {
    const rect = this._canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this._syncProjection();
    mat4.inverse(this.cameraTransform.localMatrix, this._viewMatrix);
    mat4.multiply(this._camera.projectionMatrix, this._viewMatrix, this._viewProjectionMatrix);
    return projectWorldPoint(this._viewProjectionMatrix, point, rect);
  }

  private _screenRay(clientX: number, clientY: number): VoxelRay | null {
    const rect = this._canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return null;
    const cameraWorld = this.cameraTransform.localMatrix;
    this._camera.updateAspect(rect.width / rect.height);
    mat4.inverse(cameraWorld, this._viewMatrix);
    mat4.multiply(this._camera.projectionMatrix, this._viewMatrix, this._viewProjectionMatrix);
    mat4.inverse(this._viewProjectionMatrix, this._inverseViewProjectionMatrix);
    this._cameraPosition[0] = cameraWorld[12] ?? 0;
    this._cameraPosition[1] = cameraWorld[13] ?? 0;
    this._cameraPosition[2] = cameraWorld[14] ?? 0;
    const cameraRay = this._camera.projectionType === 'orthographic'
      ? orthographicCameraRay(nx, ny, this._inverseViewProjectionMatrix, this._camera.reverseZ)
      : this._cameraRay.setFromCamera(nx, ny, this._cameraPosition, this._inverseViewProjectionMatrix);
    const origin = cameraRay.origin;
    const direction = cameraRay.direction;
    return {
      origin: [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0],
      direction: [direction[0] ?? 0, direction[1] ?? 0, direction[2] ?? 0],
    };
  }

  private _isVoxelVisibleAt(clientX: number, clientY: number, expected: Readonly<VoxelPosition>): boolean {
    const ray = this._screenRay(clientX, clientY);
    if (!ray) return false;
    const hit = traceVoxelGrid(ray, this._document.viewSize, (x, y, z) => {
      const voxel = this._document.getViewVoxel(x, y, z) ?? null;
      return voxel && voxelSliceVisibility(voxel, this._sliceState) === 'active' ? voxel : null;
    });
    return Boolean(hit && hit.voxel.x === expected.x && hit.voxel.y === expected.y && hit.voxel.z === expected.z);
  }

  private _frameBounds(bounds: Parameters<typeof frameVoxelBounds>[0]): void {
    const rect = this._canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
    const frame = frameVoxelBounds(
      bounds,
      this._document.viewSize,
      this._camera.fov,
      aspect,
      this._camera.projectionType,
    );
    this.cameraTransform.set(frame.radius, this.cameraTransform.theta, this.cameraTransform.phi);
    this.cameraTransform.setTarget(frame.target[0], frame.target[1], frame.target[2]);
    this._syncProjection();
  }

}

function createOverlayBatch(
  scene: ReturnType<HaiyueEngine['createScene']>,
  name: string,
): VoxelMaterialBatch {
  const material = new InstancedPbrMaterial(1024, {
    metallic: 0,
    roughness: 0.8,
    alphaMode: 'blend',
  });
  material.setActiveInstanceCount(0);
  const mesh = new InstancedMesh3D(createBox3D({ width: 0.92, height: 0.92, depth: 0.92 }), material);
  const entity = new Entity(name);
  entity.addComponent(mesh);
  scene.world.addEntity(entity);
  return { mesh, material, keys: [], indices: new Map() };
}

function addEditorLighting(
  scene: ReturnType<HaiyueEngine['createScene']>,
  size: Readonly<SceneSize>,
): void {
  const ambient = new Entity('Voxel Ambient Light');
  ambient.addComponent(new AmbientLight({ color: [0.42, 0.52, 0.72], intensity: 0.1 }));
  scene.add(ambient);

  const keyLight = new Entity('Voxel Key Light');
  keyLight.addComponent(new DirectionalLight({
    color: [1, 0.92, 0.8],
    intensity: 2.6,
    direction: [-0.55, -1, -0.35],
    castShadow: false,
  }));
  scene.add(keyLight);

  const fillLight = new Entity('Voxel Fill Light');
  fillLight.addComponent(new DirectionalLight({
    color: [0.48, 0.67, 1],
    intensity: 0.72,
    direction: [0.7, -0.5, 0.55],
    castShadow: false,
  }));
  scene.add(fillLight);

  const pointLight = new Entity('Voxel Rim Point Light');
  pointLight.addComponent(new CartesianTransform3D({
    position: [size.x * 0.24, Math.max(12, size.y * 0.42), size.z * 0.18],
  }));
  pointLight.addComponent(new PointLight({
    color: [1, 0.52, 0.28],
    intensity: 4.2,
    range: Math.max(30, Math.hypot(size.x, size.y, size.z)),
  }));
  scene.add(pointLight);

  const environment = new Entity('Voxel Environment Light');
  environment.addComponent(new EnvironmentLight({
    intensity: 0.38,
    diffuseColor: [0.2, 0.28, 0.43],
    specularColor: [0.62, 0.75, 1],
  }));
  scene.add(environment);
}
