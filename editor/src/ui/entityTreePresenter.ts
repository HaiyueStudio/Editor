import type { GETree, GETreeNodeData } from '@haiyue/ui';
import { Entity, World } from '@haiyue/engine';
import type { ResourcePool } from '../resources/ResourcePool';
import { PrefabInstanceComponent } from '../scene/prefabInstance';

export interface EntityTreePresenterOptions {
  resourcePool: ResourcePool;
}

export interface EntityTreePresenter {
  entityToTreeNode(entity: Entity): GETreeNodeData;
  refreshTreeSelection(treeElement: GETree | null, world: World, selection: Set<Entity>): void;
  refreshTreeStructure(treeElement: GETree | null, world: World, selection: Set<Entity>): void;
  setFilter(query: string): boolean;
  getEntityIdFromNode(node: GETreeNodeData): number | null;
}

export function createEntityTreePresenter(options: EntityTreePresenterOptions): EntityTreePresenter {
  const entityTreeNodeCache = new WeakMap<Entity, GETreeNodeData>();
  const normalizedEntityNames = new WeakMap<Entity, { source: string; normalized: string }>();
  const projectedParents = new WeakMap<Entity, Entity | null>();
  const projectedWorldVersions = new WeakMap<World, number>();
  const projectedQueries = new WeakMap<World, string>();
  const projectedRoots = new WeakMap<World, GETreeNodeData[]>();
  let filterQuery = '';

  const entityToTreeNode = (entity: Entity): GETreeNodeData => {
    const node = syncNodePresentation(entity);
    projectedParents.set(entity, entity.parent as Entity | null);
    const children = node.children ?? [];
    children.length = 0;
    if (node.prefabId === undefined) {
      for (const child of entity.children) children.push(entityToTreeNode(child));
    }
    node.children = children;
    return node;
  };

  const syncNodePresentation = (entity: Entity): GETreeNodeData => {
    const prefabInstance = entity.getComponent(PrefabInstanceComponent);
    const prefab = prefabInstance ? options.resourcePool.prefabs.get(prefabInstance.prefabId) : null;
    let node = entityTreeNodeCache.get(entity);
    if (!node) {
      node = {
        id: String(entity.id),
        renderer: 'editor-entity-tree-node',
        children: [],
        expanded: !prefab,
      };
      entityTreeNodeCache.set(entity, node);
    }
    node.label = entity.name;
    node.icon = prefab ? '▣' : entity.children.length ? '◇' : '□';
    node.disabled = entity.disabled;
    node.entityId = entity.id;
    node.prefabId = prefab?.id;
    node.prefabName = prefab?.name;
    return node;
  };

  const refreshTreeSelection = (treeElement: GETree | null, world: World, selection: Set<Entity>): void => {
    if (!treeElement) return;
    const selectedIds = collectSelectionIds(selection);
    const structureChanged = projectedWorldVersions.get(world) !== world.structureVersion || projectedQueries.get(world) !== filterQuery;
    let selectedPresentationChanged = false;
    for (const entity of selection) {
      if (isPresentationCurrent(entityTreeNodeCache.get(entity), entity, options.resourcePool)) continue;
      selectedPresentationChanged = true;
      break;
    }
    if (structureChanged
      && filterQuery === ''
      && acknowledgeSingleTreeMove(treeElement, world, selection)) {
      projectedWorldVersions.set(world, world.structureVersion);
      projectedQueries.set(world, filterQuery);
    } else if (structureChanged || selectedPresentationChanged || treeElement.data.length === 0) {
      refreshTreeStructure(treeElement, world, selection);
      return;
    }
    if (!sameIds(treeElement.selectedIds, selectedIds)) treeElement.selectedIds = selectedIds;
  };

  const refreshTreeStructure = (treeElement: GETree | null, world: World, selection: Set<Entity>): void => {
    if (!treeElement) return;
    let roots = projectedRoots.get(world);
    if (!roots) {
      roots = [];
      projectedRoots.set(world, roots);
    }
    roots.length = 0;
    if (filterQuery) {
      for (const entity of world.rootEntityList) {
        const node = entityToFilteredTreeNode(entity);
        if (node) roots.push(node);
      }
    } else {
      for (const entity of world.rootEntityList) roots.push(entityToTreeNode(entity));
    }
    treeElement.data = roots;
    clearExpansionSeeds(roots);
    projectedWorldVersions.set(world, world.structureVersion);
    projectedQueries.set(world, filterQuery);
    const selectedIds = collectSelectionIds(selection);
    if (!sameIds(treeElement.selectedIds, selectedIds)) treeElement.selectedIds = selectedIds;
  };

  const getEntityIdFromNode = (node: GETreeNodeData): number | null => {
    const raw = node.entityId ?? node.id;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  };

  const setFilter = (query: string): boolean => {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized === filterQuery) return false;
    filterQuery = normalized;
    return true;
  };

  function entityToFilteredTreeNode(entity: Entity): GETreeNodeData | null {
    const node = syncNodePresentation(entity);
    projectedParents.set(entity, entity.parent as Entity | null);
    const children = node.children ?? [];
    children.length = 0;
    if (node.prefabId === undefined) {
      for (const childEntity of entity.children) {
        const child = entityToFilteredTreeNode(childEntity);
        if (child) children.push(child);
      }
    }
    node.children = children;
    if (!getNormalizedEntityName(entity).includes(filterQuery) && children.length === 0) return null;
    node.expanded = true;
    return node;
  }

  function getNormalizedEntityName(entity: Entity): string {
    const cached = normalizedEntityNames.get(entity);
    if (cached?.source === entity.name) return cached.normalized;
    const normalized = entity.name.toLocaleLowerCase();
    normalizedEntityNames.set(entity, { source: entity.name, normalized });
    return normalized;
  }

  function acknowledgeSingleTreeMove(
    treeElement: GETree,
    world: World,
    selection: ReadonlySet<Entity>,
  ): boolean {
    if (selection.size !== 1) return false;
    const entity = selection.values().next().value as Entity | undefined;
    if (!entity || world.getEntity(entity.id) !== entity) return false;
    const node = entityTreeNodeCache.get(entity);
    if (!node) return false;

    const previousParent = projectedParents.get(entity);
    if (previousParent === undefined) return false;
    const nextParent = entity.parent as Entity | null;
    const nextParentNode = nextParent ? entityTreeNodeCache.get(nextParent) : null;
    const previousParentNode = previousParent ? entityTreeNodeCache.get(previousParent) : null;
    if (nextParentNode?.prefabId !== undefined || previousParentNode?.prefabId !== undefined) return false;
    const nextList = nextParentNode?.children ?? (nextParent ? null : treeElement.data);
    if (!nextList?.includes(node) || !isNodeAttachedToTree(entity, treeElement.data)) return false;
    if (node.prefabId === undefined && !sameProjectedChildren(entity, node.children ?? [])) return false;
    if (previousParent === nextParent) {
      const entities = nextParent?.children ?? world.rootEntityList;
      if (entities.length !== nextList.length) return false;
      for (let index = 0; index < entities.length; index++) {
        if (entityTreeNodeCache.get(entities[index]!) !== nextList[index]) return false;
      }
      syncNodePresentation(entity);
      if (nextParent) syncNodePresentation(nextParent);
      return true;
    }
    const previousList = previousParentNode?.children ?? (previousParent ? null : treeElement.data);
    if (previousList?.includes(node)) return false;

    projectedParents.set(entity, nextParent);
    syncNodePresentation(entity);
    if (previousParent) syncNodePresentation(previousParent);
    if (nextParent) syncNodePresentation(nextParent);
    return true;
  }

  function isNodeAttachedToTree(entity: Entity, roots: readonly GETreeNodeData[]): boolean {
    let current = entity;
    let node = entityTreeNodeCache.get(current);
    if (!node) return false;
    let parent = current.parent as Entity | null;
    while (parent) {
      const parentNode = entityTreeNodeCache.get(parent);
      if (!parentNode?.children?.includes(node)) return false;
      current = parent;
      node = parentNode;
      parent = current.parent as Entity | null;
    }
    return roots.includes(node);
  }

  function sameProjectedChildren(entity: Entity, nodes: readonly GETreeNodeData[]): boolean {
    if (entity.children.length !== nodes.length) return false;
    for (let index = 0; index < entity.children.length; index++) {
      if (entityTreeNodeCache.get(entity.children[index]!) !== nodes[index]) return false;
    }
    return true;
  }

  return { entityToTreeNode, refreshTreeSelection, refreshTreeStructure, setFilter, getEntityIdFromNode };
}

function isPresentationCurrent(
  node: GETreeNodeData | undefined,
  entity: Entity,
  resourcePool: ResourcePool,
): boolean {
  if (!node || node.label !== entity.name || node.disabled !== entity.disabled) return false;
  const prefabInstance = entity.getComponent(PrefabInstanceComponent);
  const prefab = prefabInstance ? resourcePool.prefabs.get(prefabInstance.prefabId) : null;
  return node.prefabId === prefab?.id && node.prefabName === prefab?.name;
}

function sameIds(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((id, index) => id === next[index]);
}

function collectSelectionIds(selection: ReadonlySet<Entity>): string[] {
  const result = new Array<string>(selection.size);
  let index = 0;
  for (const entity of selection) result[index++] = String(entity.id);
  return result;
}

function clearExpansionSeeds(nodes: readonly GETreeNodeData[]): void {
  for (const node of nodes) {
    delete node.expanded;
    if (node.children) clearExpansionSeeds(node.children);
  }
}
