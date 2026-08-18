import type { Entity, World } from '@haiyue/engine';
import type { Command } from '../types';
import type { EntityLocation } from '../types';
import { insertEntityAt, invalidateEntityNameCache, moveEntityToLocation, removeEntityKeepingObject } from '../scene/entityHierarchy';
import { measureHierarchyStage } from '../domain/scene/hierarchyTransactionMetrics';

export interface EntityCommandSideEffects {
  execute?: () => void;
  undo?: () => void;
}

export interface AddEntityCommandOptions extends EntityCommandSideEffects {
  label?: string;
  world: World;
  entity: Entity;
  parent?: Entity | null;
}

export interface RemoveEntitiesCommandOptions extends EntityCommandSideEffects {
  label?: string;
  world: World;
  entities: Entity[];
}

export interface MoveEntityCommandOptions extends EntityCommandSideEffects {
  label?: string;
  world: World;
  entity: Entity;
  from: EntityLocation;
  to: EntityLocation;
}

export interface PasteEntitiesCommandOptions extends EntityCommandSideEffects {
  label?: string;
  world: World;
  entities: Entity[];
  parent?: Entity | null;
}

export function renameEntityCommand(
  entity: Entity,
  oldName: string,
  newName: string,
  onChange: (entity: Entity) => void,
): Command {
  return {
    label: 'Rename Entity',
    execute: () => {
      entity.name = newName;
      invalidateEntityNameCacheForEntity(entity);
      onChange(entity);
    },
    undo: () => {
      entity.name = oldName;
      invalidateEntityNameCacheForEntity(entity);
      onChange(entity);
    },
  };
}

export function addEntityCommand(options: AddEntityCommandOptions): Command {
  const location: EntityLocation = {
    parent: options.parent ?? null,
    index: options.parent ? options.parent.children.length : options.world.rootEntityList.length,
  };
  return {
    label: options.label ?? 'Add Entity',
    execute: () => {
      insertEntityAt(options.world, options.entity, location);
      invalidateEntityNameCache(options.world);
      options.execute?.();
    },
    undo: () => {
      removeEntityKeepingObject(options.world, options.entity);
      invalidateEntityNameCache(options.world);
      options.undo?.();
    },
  };
}

export function removeEntitiesCommand(options: RemoveEntitiesCommandOptions): Command {
  const entities = getTopLevelEntities(options.entities);
  const locations = new Map(entities.map(entity => [entity, getLocationForRemoval(entity)]));
  return {
    label: options.label ?? (entities.length === 1 ? 'Delete Entity' : 'Delete Entities'),
    execute: () => {
      for (const entity of entities) removeEntityKeepingObject(options.world, entity);
      invalidateEntityNameCache(options.world);
      options.execute?.();
    },
    undo: () => {
      for (const entity of entities) {
        const location = locations.get(entity);
        if (location) insertEntityAt(options.world, entity, location);
      }
      invalidateEntityNameCache(options.world);
      options.undo?.();
    },
  };
}

export function moveEntityCommand(options: MoveEntityCommandOptions): Command {
  return {
    label: options.label ?? 'Move Entity',
    execute: () => {
      moveEntityTo(options.world, options.entity, options.to);
      options.execute?.();
    },
    undo: () => {
      moveEntityTo(options.world, options.entity, options.from);
      options.undo?.();
    },
  };
}

export function pasteEntitiesCommand(options: PasteEntitiesCommandOptions): Command {
  const locations = options.entities.map((entity, index): EntityLocation => ({
    parent: options.parent ?? null,
    index: options.parent ? options.parent.children.length + index : options.world.rootEntityList.length + index,
  }));
  return {
    label: options.label ?? (options.entities.length === 1 ? 'Paste Entity' : 'Paste Entities'),
    execute: () => {
      for (let i = 0; i < options.entities.length; i++) {
        const entity = options.entities[i];
        const location = locations[i];
        if (entity && location) insertEntityAt(options.world, entity, location);
      }
      invalidateEntityNameCache(options.world);
      options.execute?.();
    },
    undo: () => {
      for (const entity of options.entities) removeEntityKeepingObject(options.world, entity);
      invalidateEntityNameCache(options.world);
      options.undo?.();
    },
  };
}

function invalidateEntityNameCacheForEntity(entity: Entity): void {
  const world = entity.usedBy[0];
  if (world) invalidateEntityNameCache(world);
}

function getLocationForRemoval(entity: Entity): EntityLocation {
  const parent = entity.parent as Entity | null;
  const world = entity.usedBy[0];
  const list = parent?.children ?? world?.rootEntityList ?? [];
  return { parent, index: Math.max(0, list.indexOf(entity)) };
}

function moveEntityTo(world: World, entity: Entity, location: EntityLocation): void {
  measureHierarchyStage('reparent', () => {
    moveEntityToLocation(entity, location);
    world.updateRootEntity(entity);
  });
}

function getTopLevelEntities(entities: readonly Entity[]): Entity[] {
  if (entities.length <= 1) return [...entities];
  const selected = new Set(entities);
  return entities.filter(entity => {
    let parent = entity.parent as Entity | null;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parent.parent as Entity | null;
    }
    return true;
  });
}
