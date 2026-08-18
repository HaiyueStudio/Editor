import type { GETree } from '@haiyue/ui';
import type { Entity, Geometry3D, Mesh2D, World } from '@haiyue/engine';
import type { Material } from '@haiyue/engine/material';
import type { ScriptResource } from '@haiyue/engine/components';
import type { CommandBus } from '../../commands/CommandBus';
import type { ResourcePool } from '../../resources/ResourcePool';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type { ModelResourceItem, PrefabResourceItem } from '../../types';
import {
  create2DCameraUnderTarget as create2DCameraAction,
  create2DEntityUnderTarget as create2DEntityAction,
  createEntityUnderTarget as createEntityAction,
  createPrefabFromEntity as createPrefabFromEntityAction,
  instantiateModelIntoScene as instantiateModelAction,
  instantiatePrefabIntoScene as instantiatePrefabAction,
  syncPrefabInstances as syncPrefabInstancesAction,
  type EntityCommandActionDeps,
} from './entityCommandActions';

export interface MainEntityActionsDeps {
  componentLibraries: EditorComponentLibrary[];
  resourcePool: ResourcePool;
  createDefaultMesh2DComponent: () => Mesh2D;
  getCommandBus: () => CommandBus | null;
  refreshTreeSelection: (treeElement: GETree | null, world: World, selection: Set<Entity>) => void;
  refreshResourcePool: (world: World) => void;
  renderInspector: (entity: Entity | null, selectionCount?: number) => void;
  selectEntities: (
    entities: Entity[],
    treeElement: GETree | null,
    previousSelected: Set<Entity>,
    activeEntity?: Entity | null,
  ) => Set<Entity>;
  showPrefabDetails: (item: PrefabResourceItem) => void;
  clearPrefabSelectionIf: (prefabId: number) => void;
}

type TargetEntityAction = (
  world: World,
  target: Entity | null,
  treeElement: GETree | null,
  getSelection: () => Set<Entity>,
  setActive: (entity: Entity | null) => void,
  setSelection: (selection: Set<Entity>) => void,
) => void;

export interface MainEntityActions {
  createEntityUnderTarget: TargetEntityAction;
  create2DEntityUnderTarget: TargetEntityAction;
  create2DCameraUnderTarget(
    world: World,
    target: Entity | null,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
    onCreate: (entity: Entity) => void,
  ): void;
  instantiateModelIntoScene(
    world: World,
    model: ModelResourceItem,
    target: Entity | null,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
  ): void;
  createPrefabFromEntity(
    world: World,
    source: Entity,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
  ): void;
  instantiatePrefabIntoScene(
    world: World,
    prefab: PrefabResourceItem,
    target: Entity | null,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
  ): void;
  syncPrefabInstances(
    world: World,
    prefab: PrefabResourceItem,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
    options?: { selectedOnly?: boolean },
  ): void;
}

export function createMainEntityActions(deps: MainEntityActionsDeps): MainEntityActions {
  const getRuntimeGeometryMap = (): Map<number, Geometry3D> =>
    new Map([...deps.resourcePool.geometries.values()].map(item => [item.resource.id, item.resource]));
  const getRuntimeMaterialMap = (): Map<number, Material> =>
    new Map([...deps.resourcePool.materials.values()].map(item => [item.resource.id, item.resource]));
  const getRuntimeScriptMap = (): Map<number, ScriptResource> =>
    new Map([...deps.resourcePool.scripts.values()].map(item => [item.resource.id, item.resource]));

  const getCommandDeps = (
    world: World,
    treeElement: GETree | null,
    getSelection: () => Set<Entity>,
    setActive: (entity: Entity | null) => void,
    setSelection: (selection: Set<Entity>) => void,
  ): EntityCommandActionDeps => ({
    world,
    treeElement,
    getSelection,
    setActive,
    setSelection,
    selectEntities: deps.selectEntities,
    refreshTreeSelection: deps.refreshTreeSelection,
    refreshResourcePool: deps.refreshResourcePool,
    getCommandBus: deps.getCommandBus,
    createDefaultMesh2DComponent: deps.createDefaultMesh2DComponent,
    componentLibraries: deps.componentLibraries,
    resourcePool: deps.resourcePool,
    getRuntimeGeometryMap,
    getRuntimeMaterialMap,
    getRuntimeScriptMap,
    showPrefabDetails: deps.showPrefabDetails,
    clearPrefabSelectionIf: deps.clearPrefabSelectionIf,
    renderInspector: deps.renderInspector,
  });

  return {
    createEntityUnderTarget(world, target, treeElement, getSelection, setActive, setSelection): void {
      createEntityAction(getCommandDeps(world, treeElement, getSelection, setActive, setSelection), target);
    },
    create2DEntityUnderTarget(world, target, treeElement, getSelection, setActive, setSelection): void {
      create2DEntityAction(getCommandDeps(world, treeElement, getSelection, setActive, setSelection), target);
    },
    create2DCameraUnderTarget(world, target, treeElement, getSelection, setActive, setSelection, onCreate): void {
      create2DCameraAction(getCommandDeps(world, treeElement, getSelection, setActive, setSelection), target, onCreate);
    },
    instantiateModelIntoScene(world, model, target, treeElement, getSelection, setActive, setSelection): void {
      instantiateModelAction(getCommandDeps(world, treeElement, getSelection, setActive, setSelection), model, target);
    },
    createPrefabFromEntity(world, source, treeElement, getSelection, setActive, setSelection): void {
      createPrefabFromEntityAction(getCommandDeps(world, treeElement, getSelection, setActive, setSelection), source);
    },
    instantiatePrefabIntoScene(world, prefab, target, treeElement, getSelection, setActive, setSelection): void {
      instantiatePrefabAction(getCommandDeps(world, treeElement, getSelection, setActive, setSelection), prefab, target);
    },
    syncPrefabInstances(world, prefab, treeElement, getSelection, setActive, setSelection, options): void {
      syncPrefabInstancesAction(getCommandDeps(world, treeElement, getSelection, setActive, setSelection), prefab, options);
    },
  };
}
