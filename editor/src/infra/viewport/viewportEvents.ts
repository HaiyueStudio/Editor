import type { GEDropdownSelectDetail, GETree } from '@haiyue/ui';
import type { SelectionController } from '../../domain/selection/SelectionState';
import {
  GEOMETRY_DRAG_MIME,
  MATERIAL_DRAG_MIME,
  MESH_DRAG_MIME,
  MODEL_DRAG_MIME,
  PREFAB_DRAG_MIME,
  TEXTURE_DRAG_MIME,
} from '../resource-ui/resourceCards';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import { installComponentLibraryViewportSystems } from '../../domain/library/componentLibrary';
import {
  getBoxSelected2DEntities,
  isEntityDisabledInHierarchy,
  pickEntity,
  pickEntity3D,
  type ViewportSelectionTarget,
} from '../../ui/viewport/viewportInteraction';
import type { Disposable, ModelResourceItem, PrefabResourceItem, TextureSource } from '../../types';
import { onEditorLanguageChange, t } from '../options/editorOptions';
import type { Camera2D, Entity, Geometry3D, OrbitControl, HaiyueEngine, World } from '@haiyue/engine';
import type { Material } from '@haiyue/engine/material';
import type { Mesh2DRenderSystem } from '@haiyue/engine/systems';
import { BoxSelectionControl } from '@haiyue/engine/controls';
import { Mesh3D } from '@haiyue/engine';
import type { RenderPipelineEntryOptions, RenderPipelineSystem } from '../../engine-adapter/EditorRenderProtocol';
import { TransformGizmoController } from '../../ui/viewport/TransformGizmoController';
import type { CommandBus } from '../../commands/CommandBus';
import type { EditorShortcutRegistry } from '../shortcuts/EditorShortcutRegistry';

export type ViewportControlMode = 'orbit' | 'box-selection';

export interface ViewportEventElements {
  canvas: HTMLCanvasElement;
  dropTarget?: HTMLElement | null;
  orbitModeButton: HTMLElement | null;
  boxModeButton: HTMLElement | null;
  boxSelectTargetDropdown: (HTMLElement & {
    items: Array<{ label?: string; value?: string; disabled?: boolean; separator?: boolean }>;
    show(): void;
  }) | null;
  transformHost: HTMLElement | null;
  translateButton: HTMLElement | null;
  rotateButton: HTMLElement | null;
  scaleButton: HTMLElement | null;
  transformSpace: HTMLSelectElement | null;
  transformPivot: HTMLSelectElement | null;
  snapEnabled: HTMLInputElement | null;
  snapValue: HTMLInputElement | null;
  focusSelection: HTMLElement | null;
}

export interface ViewportEventDeps {
  world: World;
  engine: HaiyueEngine;
  cameraEntity: Entity;
  tree: GETree | null;
  elements: ViewportEventElements;
  selectionState: SelectionController;
  orbitControl: OrbitControl;
  componentLibraries: EditorComponentLibrary[];
  resourcePool: {
    geometries: Map<number, { name: string; resource: Geometry3D }>;
    materials: Map<number, { resource: Material }>;
    textures: Map<number, { resource: TextureSource }>;
    models: Map<number, ModelResourceItem>;
    prefabs: Map<number, PrefabResourceItem>;
  };
  getGlobalSettings: () => { designWidth: number; designHeight: number; viewportMode?: 'fixed' | 'expand' | 'fit' | 'fill' };
  createMesh2DRenderSystem: (cameraEntity: Entity) => Mesh2DRenderSystem;
  registerRenderSystem?: (system: RenderPipelineSystem, options?: RenderPipelineEntryOptions) => void;
  findCamera2D: (entity: Entity) => Camera2D | null;
  selectEntities: (entities: Entity[], activeEntity?: Entity | null) => Set<Entity>;
  instantiateModelIntoScene: (model: ModelResourceItem, target: Entity | null) => void;
  instantiatePrefabIntoScene: (prefab: PrefabResourceItem, target: Entity | null) => void;
  changeMeshGeometry: (entity: Entity, geometry: Geometry3D) => boolean;
  changeMeshMaterial: (entity: Entity, material: Material) => boolean;
  changeMaterialTexture: (entity: Entity, texture: TextureSource) => boolean;
  getCommandBus: () => CommandBus | null;
  onTransformChange: () => void;
  shortcuts: EditorShortcutRegistry;
}

const VIEWPORT_RESOURCE_DRAG_MIME_TYPES = [
  GEOMETRY_DRAG_MIME,
  MESH_DRAG_MIME,
  MATERIAL_DRAG_MIME,
  TEXTURE_DRAG_MIME,
  MODEL_DRAG_MIME,
  PREFAB_DRAG_MIME,
] as const;

export interface ViewportEventController {
  ensureRender2DForCamera(camera2DEntity: Entity): void;
  syncRender2DForScene(): void;
  getActiveCamera2DEntity(): Entity | null;
  dispose(): void;
}

function hasDragType(types: DOMStringList | readonly string[] | null | undefined, mimeType: string): boolean {
  if (!types) return false;
  if (typeof (types as DOMStringList).contains === 'function') return (types as DOMStringList).contains(mimeType);
  return Array.prototype.includes.call(types, mimeType);
}

export function setupViewportEvents(deps: ViewportEventDeps): ViewportEventController {
  let viewportMode: ViewportControlMode = 'orbit';
  let boxSelectionTarget: ViewportSelectionTarget = 'all';
  let lastBoxSelectionAt = 0;
  let pointerDownPosition: { x: number; y: number } | null = null;
  let mesh2DRenderSystem: Mesh2DRenderSystem | null = null;
  let activeCamera2DEntity: Entity | null = null;
  let componentViewportInstallation: Disposable | null = null;
  const transformGizmo = deps.elements.transformHost ? new TransformGizmoController({
    world: deps.world,
    cameraEntity: deps.cameraEntity,
    selection: deps.selectionState,
    getCommandBus: deps.getCommandBus,
    onChange: deps.onTransformChange,
    shortcuts: deps.shortcuts,
    elements: {
      host: deps.elements.transformHost,
      canvas: deps.elements.canvas,
      translateButton: deps.elements.translateButton,
      rotateButton: deps.elements.rotateButton,
      scaleButton: deps.elements.scaleButton,
      spaceSelect: deps.elements.transformSpace,
      pivotSelect: deps.elements.transformPivot,
      snapEnabled: deps.elements.snapEnabled,
      snapValue: deps.elements.snapValue,
      focusButton: deps.elements.focusSelection,
    },
  }) : null;
  if (deps.elements.transformHost) deps.elements.transformHost.dataset.editorShortcutContext = 'viewport';

  const boxSelectionControl = new BoxSelectionControl(deps.elements.canvas, deps.world, deps.cameraEntity, {
    enabled: false,
    selectionMode: 'center',
    filter: entity => boxSelectionTarget !== '2d' && Boolean(entity.getComponent(Mesh3D)) && !isEntityDisabledInHierarchy(entity),
    onSelect: result => {
    lastBoxSelectionAt = performance.now();
    const selected2D = boxSelectionTarget !== '3d'
      ? getBoxSelected2DEntities(deps.world, activeCamera2DEntity, deps.engine, result.rect, boxSelectionControl.selectionMode)
      : [];
    const entities = boxSelectionTarget === '2d'
      ? selected2D
      : boxSelectionTarget === '3d'
        ? result.entities
        : [...result.entities, ...selected2D.filter(entity => !result.entities.includes(entity))];
    const active = entities[entities.length - 1] ?? null;
    deps.selectionState.setSelection(deps.selectEntities(entities, active), active);
    },
  });

  function findFirstCamera2DEntity(): Entity | null {
    for (const entity of deps.world.entities.values()) {
      if (deps.findCamera2D(entity)) return entity;
    }
    return null;
  }

  function ensureRender2DForCamera(camera2DEntity: Entity): void {
    if (mesh2DRenderSystem && activeCamera2DEntity === camera2DEntity) return;
    activeCamera2DEntity = camera2DEntity;
    const settings = deps.getGlobalSettings();
    deps.findCamera2D(camera2DEntity)?.setViewportFit({
      designWidth: settings.designWidth,
      designHeight: settings.designHeight,
      viewportMode: settings.viewportMode ?? 'expand',
    });
    componentViewportInstallation?.dispose();
    componentViewportInstallation = installComponentLibraryViewportSystems(deps.componentLibraries, {
      world: deps.world,
      engine: deps.engine,
      camera2DEntity,
      ...(deps.registerRenderSystem === undefined ? {} : { registerRenderSystem: deps.registerRenderSystem }),
    });
    if (mesh2DRenderSystem) {
      mesh2DRenderSystem.setCameraEntity(camera2DEntity);
      mesh2DRenderSystem.disabled = false;
      deps.registerRenderSystem?.(mesh2DRenderSystem);
      return;
    }
    mesh2DRenderSystem = deps.createMesh2DRenderSystem(camera2DEntity);
    if (deps.registerRenderSystem) {
      mesh2DRenderSystem.autoUpdate = false;
      deps.registerRenderSystem(mesh2DRenderSystem);
    }
    deps.world.addSystem(mesh2DRenderSystem);
  }

  function syncRender2DForScene(): void {
    const camera2DEntity = findFirstCamera2DEntity();
    if (camera2DEntity) {
      ensureRender2DForCamera(camera2DEntity);
      return;
    }
    activeCamera2DEntity = null;
    componentViewportInstallation?.dispose();
    componentViewportInstallation = null;
    if (mesh2DRenderSystem) mesh2DRenderSystem.disabled = true;
  }

  const updateBoxSelectionTargetLabel = () => {
    const label = boxSelectionTarget === '3d'
      ? t('viewport.box3d')
      : boxSelectionTarget === '2d'
        ? t('viewport.box2d')
        : t('viewport.boxAll');
    if (deps.elements.boxModeButton) deps.elements.boxModeButton.textContent = label;
  };
  const updateBoxSelectionTargetItems = () => {
    if (!boxSelectTargetDropdown) return;
    boxSelectTargetDropdown.items = [
      { label: t('viewport.select3dObjects'), value: '3d' },
      { label: t('viewport.select2dObjects'), value: '2d' },
      { label: t('viewport.selectAllObjects'), value: 'all' },
    ];
  };
  const boxSelectTargetDropdown = deps.elements.boxSelectTargetDropdown;
  if (boxSelectTargetDropdown) {
    updateBoxSelectionTargetItems();
    boxSelectTargetDropdown.addEventListener('mouseenter', () => boxSelectTargetDropdown.show());
    boxSelectTargetDropdown.addEventListener('item-select', (event) => {
      boxSelectionTarget = (event as CustomEvent<GEDropdownSelectDetail>).detail.value as ViewportSelectionTarget;
      updateBoxSelectionTargetLabel();
      setViewportMode('box-selection');
    });
  }
  updateBoxSelectionTargetLabel();
  onEditorLanguageChange(() => {
    updateBoxSelectionTargetItems();
    updateBoxSelectionTargetLabel();
  });

  function setViewportMode(mode: ViewportControlMode): void {
    viewportMode = mode;
    const orbitEnabled = mode === 'orbit';
    deps.orbitControl.enableRotate = orbitEnabled;
    deps.orbitControl.enablePan = orbitEnabled;
    deps.orbitControl.enableZoom = orbitEnabled;
    boxSelectionControl.enabled = mode === 'box-selection';

    deps.elements.orbitModeButton?.classList.toggle('active', orbitEnabled);
    deps.elements.boxModeButton?.classList.toggle('active', !orbitEnabled);
    deps.elements.orbitModeButton?.setAttribute('aria-selected', String(orbitEnabled));
    deps.elements.boxModeButton?.setAttribute('aria-selected', String(!orbitEnabled));
  }

  deps.elements.orbitModeButton?.addEventListener('click', () => setViewportMode('orbit'));
  deps.elements.boxModeButton?.addEventListener('click', () => setViewportMode('box-selection'));
  setViewportMode('orbit');
  const viewportDropTarget = deps.elements.dropTarget ?? deps.elements.canvas;

  deps.elements.canvas.addEventListener('pointerdown', (event) => {
    if (viewportMode !== 'orbit') return;
    pointerDownPosition = { x: event.clientX, y: event.clientY };
  });

  deps.elements.canvas.addEventListener('click', (event) => {
    if (viewportMode !== 'orbit') return;
    if (performance.now() - lastBoxSelectionAt < 100) return;
    if (pointerDownPosition) {
      const dx = event.clientX - pointerDownPosition.x;
      const dy = event.clientY - pointerDownPosition.y;
      pointerDownPosition = null;
      if (Math.hypot(dx, dy) > 4) return;
    }

    const hit = pickEntity(deps.world, deps.cameraEntity, activeCamera2DEntity, deps.engine, event.clientX, event.clientY, 'all');
    const active = hit?.entity ?? null;
    deps.selectionState.setSelection(deps.selectEntities(hit ? [hit.entity] : [], active), active);
  });

  function getDroppedMeshTarget(event: DragEvent): Entity | null {
    const hit = pickEntity3D(deps.world, deps.cameraEntity, deps.engine, event.clientX, event.clientY);
    if (hit?.entity.getComponent(Mesh3D)) return hit.entity;
    const active = deps.selectionState.active;
    return active?.getComponent(Mesh3D) ? active : null;
  }

  function getDroppedGeometry(event: DragEvent, geometryId: string | undefined): Geometry3D | null {
    if (geometryId) {
      const geometry = deps.resourcePool.geometries.get(Number(geometryId))?.resource;
      if (geometry) return geometry;
    }
    const label = event.dataTransfer?.getData('text/plain')?.trim();
    if (!label) return null;
    for (const item of deps.resourcePool.geometries.values()) {
      if (item.name === label) return item.resource;
    }
    return null;
  }

  viewportDropTarget.addEventListener('dragover', (event) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;
    const types = dataTransfer.types;
    if (!VIEWPORT_RESOURCE_DRAG_MIME_TYPES.some(mimeType => hasDragType(types, mimeType))) return;
    event.preventDefault();
    dataTransfer.dropEffect = 'copy';
  });

  viewportDropTarget.addEventListener('drop', (event) => {
    const geometryId = event.dataTransfer?.getData(GEOMETRY_DRAG_MIME) || event.dataTransfer?.getData(MESH_DRAG_MIME);
    const materialId = event.dataTransfer?.getData(MATERIAL_DRAG_MIME);
    const textureId = event.dataTransfer?.getData(TEXTURE_DRAG_MIME);
    const modelId = event.dataTransfer?.getData(MODEL_DRAG_MIME);
    const prefabId = event.dataTransfer?.getData(PREFAB_DRAG_MIME);
    if (!geometryId && !materialId && !textureId && !modelId && !prefabId) return;
    event.preventDefault();

    if (modelId) {
      const model = deps.resourcePool.models.get(Number(modelId));
      if (!model) return;
      const hit = pickEntity3D(deps.world, deps.cameraEntity, deps.engine, event.clientX, event.clientY);
      deps.instantiateModelIntoScene(model, hit?.entity ?? null);
      return;
    }

    if (prefabId) {
      const prefab = deps.resourcePool.prefabs.get(Number(prefabId));
      if (!prefab) return;
      const hit = pickEntity3D(deps.world, deps.cameraEntity, deps.engine, event.clientX, event.clientY);
      deps.instantiatePrefabIntoScene(prefab, hit?.entity ?? null);
      return;
    }

    const geometry = getDroppedGeometry(event, geometryId);
    const material = deps.resourcePool.materials.get(Number(materialId))?.resource;
    const texture = deps.resourcePool.textures.get(Number(textureId))?.resource;
    if (geometryId && !geometry) return;
    const target = getDroppedMeshTarget(event);
    if (!target) return;

    deps.selectionState.setSelection(deps.selectEntities([target], target), target);
    if (geometry) deps.changeMeshGeometry(target, geometry);
    if (material) deps.changeMeshMaterial(target, material);
    if (texture) deps.changeMaterialTexture(target, texture);
  });

  return {
    ensureRender2DForCamera,
    syncRender2DForScene,
    getActiveCamera2DEntity: () => activeCamera2DEntity,
    dispose() {
      componentViewportInstallation?.dispose();
      componentViewportInstallation = null;
      boxSelectionControl.dispose();
      transformGizmo?.dispose();
    },
  };
}
