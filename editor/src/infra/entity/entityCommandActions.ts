import type {
  GETree } from '@haiyue/ui';
import { Camera2D, CartesianTransform3D, Entity, Transform2D, Component, Mesh2D, Geometry3D, World } from '@haiyue/engine';
import { ScriptResource } from '@haiyue/engine/components';
import { Material } from '@haiyue/engine/material';
import { GltfModelComponent } from '@haiyue/extensions/gltf';
import type { CommandBus } from '../../commands/CommandBus';
import { addEntityCommand } from '../../commands/entityCommands';
import type { Command } from '../../types';
import type { ResourcePool } from '../../resources/ResourcePool';
import {
  getEntityLocation,
  getUniqueEntityName,
  getTopLevelEntities,
  insertEntityAt,
  removeEntityKeepingObject,
} from '../../scene/entityHierarchy';
import { PrefabInstanceComponent } from '../../scene/prefabInstance';
import { serializeEntity } from '../../domain/scene/serialization';
import { deserializeEntity } from '../../domain/scene/deserialization';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type { ModelResourceItem, PrefabResourceItem } from '../../types';

export interface EntityCommandSelectionDeps {
  world: World;
  treeElement: GETree | null;
  getSelection: () => Set<Entity>;
  setActive: (entity: Entity | null) => void;
  setSelection: (selection: Set<Entity>) => void;
  selectEntities: (
    entities: Entity[],
    treeElement: GETree | null,
    previousSelected: Set<Entity>,
    activeEntity?: Entity | null,
  ) => Set<Entity>;
  refreshTreeSelection: (treeElement: GETree | null, world: World, selection: Set<Entity>) => void;
  refreshResourcePool: (world: World) => void;
}

export interface EntityCommandActionDeps extends EntityCommandSelectionDeps {
  getCommandBus: () => CommandBus | null;
  createDefaultMesh2DComponent: () => Mesh2D;
  componentLibraries: EditorComponentLibrary[];
  resourcePool: ResourcePool;
  getRuntimeGeometryMap: () => Map<number, Geometry3D>;
  getRuntimeMaterialMap: () => Map<number, Material>;
  getRuntimeScriptMap: () => Map<number, ScriptResource>;
  showPrefabDetails: (item: PrefabResourceItem) => void;
  clearPrefabSelectionIf: (prefabId: number) => void;
  renderInspector: (entity: Entity | null, selectionCount?: number) => void;
}

export function syncEntityCommandSelection(
  deps: EntityCommandSelectionDeps,
  activeEntity: Entity | null,
  selectedEntities: Entity[],
  options: { refreshResources?: boolean } = {},
): void {
  deps.setActive(activeEntity);
  deps.setSelection(deps.selectEntities(selectedEntities, deps.treeElement, deps.getSelection(), activeEntity));
  deps.refreshTreeSelection(deps.treeElement, deps.world, deps.getSelection());
  if (options.refreshResources ?? true) deps.refreshResourcePool(deps.world);
}

export function createEntityUnderTarget(deps: EntityCommandActionDeps, target: Entity | null): void {
  const entity = new Entity(getUniqueEntityName(deps.world, 'Entity'));
  entity.addComponent(new CartesianTransform3D());
  executeCommand(deps, addEntityCommand({
    label: 'Add Entity',
    world: deps.world,
    entity,
    parent: target,
    execute: () => syncEntityCommandSelection(deps, entity, [entity]),
    undo: () => syncEntityCommandSelection(deps, target, target ? [target] : []),
  }));
}

export function create2DEntityUnderTarget(deps: EntityCommandActionDeps, target: Entity | null): void {
  const entity = new Entity(getUniqueEntityName(deps.world, '2D Element'));
  entity.addComponent(new Transform2D());
  entity.addComponent(deps.createDefaultMesh2DComponent());
  executeCommand(deps, addEntityCommand({
    label: 'Add 2D Element',
    world: deps.world,
    entity,
    parent: target,
    execute: () => syncEntityCommandSelection(deps, entity, [entity]),
    undo: () => syncEntityCommandSelection(deps, target, target ? [target] : []),
  }));
}

export function create2DCameraUnderTarget(
  deps: EntityCommandActionDeps,
  target: Entity | null,
  onCreate: (entity: Entity) => void,
): void {
  const entity = new Entity(getUniqueEntityName(deps.world, '2D Camera'));
  entity.addComponent(new Camera2D());
  executeCommand(deps, addEntityCommand({
    label: 'Add 2D Camera',
    world: deps.world,
    entity,
    parent: target,
    execute: () => {
      onCreate(entity);
      syncEntityCommandSelection(deps, entity, [entity], { refreshResources: false });
    },
    undo: () => syncEntityCommandSelection(deps, target, target ? [target] : [], { refreshResources: false }),
  }));
}

export function createModelEntity(world: World, model: ModelResourceItem): Entity {
  const entity = new Entity(getUniqueEntityName(world, model.name));
  entity.addComponent(new CartesianTransform3D());
  entity.addComponent(new GltfModelComponent({ src: model.src, autoLoad: true, clearPrevious: true }));
  return entity;
}

export function instantiateModelIntoScene(
  deps: EntityCommandActionDeps,
  model: ModelResourceItem,
  target: Entity | null,
): void {
  const entity = createModelEntity(deps.world, model);
  executeCommand(deps, addEntityCommand({
    label: 'Instantiate Model',
    world: deps.world,
    entity,
    parent: target,
    execute: () => syncEntityCommandSelection(deps, entity, [entity]),
    undo: () => syncEntityCommandSelection(deps, target, target ? [target] : []),
  }));
}

export function instantiatePrefab(deps: EntityCommandActionDeps, item: PrefabResourceItem): Entity {
  const entity = deserializeEntity(
    deps.resourcePool.resolvePrefabRoot(item),
    deps.getRuntimeGeometryMap(),
    deps.getRuntimeMaterialMap(),
    deps.getRuntimeScriptMap(),
    deps.componentLibraries,
  );
  entity.name = item.root.name || item.name;
  entity.addComponent(new PrefabInstanceComponent(item.id, item.revision));
  return entity;
}

export function syncPrefabInstances(deps: EntityCommandActionDeps, prefab: PrefabResourceItem, options: { selectedOnly?: boolean } = {}): void {
  const candidates = options.selectedOnly ? deps.getSelection() : deps.world.entities.values();
  const outdated = getTopLevelEntities([...candidates].filter((entity) => {
    const component = entity.getComponent(PrefabInstanceComponent);
    return component?.prefabId === prefab.id
      && (component.sourceRevision ?? 0) < prefab.revision;
  }));
  if (!outdated.length) return;

  const replacements = outdated.map((entity) => {
    const replacement = instantiatePrefab(deps, prefab);
    replacement.name = entity.name;
    replacement.disabled = entity.disabled;
    return {
      entity,
      replacement,
      location: getEntityLocation(entity),
    };
  });

  const execute = () => {
    for (const item of replacements) {
      removeEntityKeepingObject(deps.world, item.entity);
      insertEntityAt(deps.world, item.replacement, item.location);
    }
    syncEntityCommandSelection(deps, replacements[0]?.replacement ?? null, replacements.map(item => item.replacement));
  };
  const undo = () => {
    for (const item of replacements.slice().reverse()) {
      removeEntityKeepingObject(deps.world, item.replacement);
      insertEntityAt(deps.world, item.entity, item.location);
    }
    syncEntityCommandSelection(deps, replacements[0]?.entity ?? null, replacements.map(item => item.entity));
  };

  const commandBus = deps.getCommandBus();
  if (commandBus) commandBus.execute({ label: 'Sync Prefab Instances', execute, undo });
  else execute();
}

export function instantiatePrefabIntoScene(
  deps: EntityCommandActionDeps,
  prefab: PrefabResourceItem,
  target: Entity | null,
): void {
  const entity = instantiatePrefab(deps, prefab);
  entity.name = getUniqueEntityName(deps.world, prefab.name);
  executeCommand(deps, addEntityCommand({
    label: 'Instantiate Prefab',
    world: deps.world,
    entity,
    parent: target,
    execute: () => syncEntityCommandSelection(deps, entity, [entity]),
    undo: () => syncEntityCommandSelection(deps, target, target ? [target] : []),
  }));
}

export function createPrefabFromEntity(deps: EntityCommandActionDeps, source: Entity): void {
  const prefabName = deps.resourcePool.getUniquePrefabName(source.name || 'Prefab');
  const snapshot = serializeEntity(source, {
    excludePrefabInstanceForEntityIds: new Set([source.id]),
  }, deps.componentLibraries);
  const existingPrefabInstance = source.getComponent(PrefabInstanceComponent);
  let prefabItem: PrefabResourceItem | null = null;
  deps.getCommandBus()?.execute({
    label: 'Create Prefab',
    execute: () => {
      prefabItem = deps.resourcePool.registerPrefab(snapshot, prefabName, prefabItem?.id, {
        sourceEntityId: source.id,
      });
      source.addComponent(new PrefabInstanceComponent(prefabItem.id, prefabItem.revision));
      syncEntityCommandSelection(deps, source, [source]);
      deps.showPrefabDetails(prefabItem);
    },
    undo: () => {
      if (!prefabItem) return;
      restorePrefabInstance(source, existingPrefabInstance);
      prefabItem.refs = 0;
      deps.resourcePool.unregisterPrefab(prefabItem.id);
      deps.clearPrefabSelectionIf(prefabItem.id);
      syncEntityCommandSelection(deps, source, [source]);
      deps.renderInspector(source, 1);
    },
  });
}

function restorePrefabInstance(entity: Entity, component: Component | null): void {
  if (component) entity.addComponent(component);
  else entity.removeComponent(PrefabInstanceComponent);
}

function executeCommand(deps: Pick<EntityCommandActionDeps, 'getCommandBus'>, command: Command): void {
  const commandBus = deps.getCommandBus();
  if (commandBus) commandBus.execute(command);
  else command.execute();
}
