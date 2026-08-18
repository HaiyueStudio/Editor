import type {
  GEContextMenuSelectDetail,
  GETree,
  GETreeDataChangeDetail,
  GETreeNodeData,
  GETreeNodeContextMenuDetail,
  GETreeSelectionChangeDetail,
} from '@haiyue/ui';
import type { CommandBus } from '../../commands/CommandBus';
import { moveEntityCommand, pasteEntitiesCommand, removeEntitiesCommand } from '../../commands/entityCommands';
import type { Command } from '../../types';
import type { SelectionController } from '../../domain/selection/SelectionState';
import {
  GEOMETRY_DRAG_MIME,
  MATERIAL_DRAG_MIME,
  MESH_DRAG_MIME,
  TEXTURE_DRAG_MIME,
} from '../resource-ui/resourceCards';
import {
  cloneEditorEntity,
  getEntityLocation,
  setEntityDisabled,
  isEntityDescendant,
} from '../../scene/entityHierarchy';
import type { EditorEntityTreeNodeVisibilityDetail } from '../../ui/entityTreeNode';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import { Mesh3D, type Entity, type Geometry3D, type World } from '@haiyue/engine';
import { type Material } from '@haiyue/engine/material';
import type { TextureSource } from '../../types';
import {
  measureHierarchyStage,
  runHierarchyTransaction,
} from '../../domain/scene/hierarchyTransactionMetrics';

type EntityContextMenu = HTMLElement & {
  items: Array<{ label?: string; value?: string; disabled?: boolean; separator?: boolean }>;
  openAt(x: number, y: number): void;
};

export interface EntityTreeEventDeps {
  world: World;
  tree: GETree | null;
  entityContextMenu: EntityContextMenu | null;
  selectionState: SelectionController;
  getCommandBus: () => CommandBus | null;
  componentLibraries: EditorComponentLibrary[];
  contextMenuState: { targetId: string | null };
  getEntityClipboard: () => Entity[];
  setEntityClipboard: (entities: Entity[]) => void;
  entityToTreeNode: (entity: Entity) => GETreeNodeData;
  getEntityIdFromNode: (node: unknown) => number | null;
  resourcePool: {
    geometries: Map<number, { name: string; resource: Geometry3D }>;
    materials: Map<number, { resource: Material }>;
    textures: Map<number, { resource: TextureSource }>;
  };
  changeMeshGeometry: (entity: Entity, geometry: Geometry3D) => boolean;
  changeMeshMaterial: (entity: Entity, material: Material) => boolean;
  changeMaterialTexture: (entity: Entity, texture: TextureSource) => boolean;
  refreshTreeSelection: () => void;
  refreshResourcePool: () => void;
  selectEntities: (entities: Entity[], activeEntity?: Entity | null) => Set<Entity>;
  createEntityUnderTarget: (target: Entity | null) => void;
  create2DEntityUnderTarget: (target: Entity | null) => void;
  create2DCameraUnderTarget: (target: Entity | null) => void;
  createPrefabFromEntity: (source: Entity) => void;
}

export function setupEntityTreeEvents(deps: EntityTreeEventDeps): void {
  const { tree, world, selectionState } = deps;
  if (!tree) return;

  tree.data = world.rootEntityList.map(deps.entityToTreeNode);

  const updateEntityContextMenuItems = () => {
    const hasSelection = selectionState.selection.size > 0;
    const hasTarget = deps.contextMenuState.targetId !== null;
    if (!deps.entityContextMenu) return;
    deps.entityContextMenu.items = [
      { label: '添加实体', value: 'add-entity' },
      { label: '添加 2D 元素', value: 'add-2d-entity' },
      { label: '添加 2D 相机', value: 'add-2d-camera' },
      { label: '创建为 Prefab', value: 'create-prefab', disabled: !hasTarget && !hasSelection },
      { separator: true },
      { label: '删除', value: 'delete', disabled: !hasSelection },
      { label: '复制', value: 'copy', disabled: !hasSelection },
      { label: '粘贴', value: 'paste', disabled: deps.getEntityClipboard().length === 0 },
      { label: '剪切', value: 'cut', disabled: !hasSelection },
    ];
  };

  const copyEntitiesToClipboard = (entities: Iterable<Entity>): boolean => {
    const topLevelEntities = getTopLevelEntitiesFromSelection(entities);
    if (topLevelEntities.length === 0) return false;
    deps.setEntityClipboard(topLevelEntities.map(entity => cloneEditorEntity(entity, { cloneExtensions: deps.componentLibraries })));
    return true;
  };

  updateEntityContextMenuItems();
  tree.addEventListener('dragover', event => handleResourceDragOver(deps, event), { capture: true });
  tree.addEventListener('drop', event => handleResourceDrop(deps, event), { capture: true });

  tree.addEventListener('node-context-menu', (event) => {
    const detail = (event as CustomEvent<GETreeNodeContextMenuDetail>).detail;
    deps.contextMenuState.targetId = detail.id;
    updateEntityContextMenuItems();
    deps.entityContextMenu?.openAt(detail.clientX, detail.clientY);
  });

  deps.entityContextMenu?.addEventListener('item-select', (event) => {
    const value = (event as CustomEvent<GEContextMenuSelectDetail>).detail.value;
    const targetEntity = deps.contextMenuState.targetId
      ? world.getEntity(Number(deps.contextMenuState.targetId))
      : null;
    if (value === 'add-entity') {
      deps.createEntityUnderTarget(targetEntity);
    } else if (value === 'add-2d-entity') {
      deps.create2DEntityUnderTarget(targetEntity);
    } else if (value === 'add-2d-camera') {
      deps.create2DCameraUnderTarget(targetEntity);
    } else if (value === 'create-prefab') {
      const source = targetEntity ?? selectionState.active;
      if (source) deps.createPrefabFromEntity(source);
    } else if (value === 'delete') {
      tree.deleteSelection();
    } else if (value === 'copy') {
      copyEntitiesToClipboard(selectionState.selection);
      updateEntityContextMenuItems();
    } else if (value === 'paste') {
      pasteClipboardEntities(deps, targetEntity);
    } else if (value === 'cut') {
      if (copyEntitiesToClipboard(selectionState.selection)) {
        tree.deleteSelection();
        updateEntityContextMenuItems();
      }
    }
  });

  tree.addEventListener('selection-change', (event) => {
    const detail = (event as CustomEvent<GETreeSelectionChangeDetail>).detail;
    const entities = detail.selectedIds
      .map(id => world.getEntity(Number(id)))
      .filter((entity): entity is Entity => entity !== null);
    const active = detail.node?.entityId ? world.getEntity(Number(detail.node.entityId)) : null;
    selectionState.setSelection(deps.selectEntities(entities, active), active);
  });

  tree.addEventListener('entity-visibility-toggle', (event) => {
    const detail = (event as CustomEvent<EditorEntityTreeNodeVisibilityDetail>).detail;
    const entity = world.getEntity(detail.entityId);
    if (!entity || entity.disabled === detail.disabled) return;
    const previous = entity.disabled;
    deps.getCommandBus()?.execute({
      label: 'Toggle Entity Visibility',
      execute: () => {
        setEntityDisabled(entity, detail.disabled);
        deps.refreshTreeSelection();
      },
      undo: () => {
        setEntityDisabled(entity, previous);
        deps.refreshTreeSelection();
      },
    });
  });

  tree.addEventListener('data-change', (event) => {
    const detail = (event as CustomEvent<GETreeDataChangeDetail>).detail;
    if (detail.action === 'copy') return;
    if (detail.action === 'drop') handleDrop(deps, detail);
    if (detail.action === 'delete') handleDelete(deps, detail);
    if (detail.action === 'paste') handlePaste(deps, detail);
  });
}

function hasResourceDragType(types: DOMStringList | readonly string[] | null | undefined): boolean {
  if (!types) return false;
  const has = typeof (types as DOMStringList).contains === 'function'
    ? (value: string) => (types as DOMStringList).contains(value)
    : (value: string) => Array.prototype.includes.call(types, value);
  return has(GEOMETRY_DRAG_MIME) ||
    has(MESH_DRAG_MIME) ||
    has(MATERIAL_DRAG_MIME) ||
    has(TEXTURE_DRAG_MIME);
}

function getEventTreeRow(event: DragEvent): HTMLElement | null {
  for (const item of event.composedPath()) {
    if (item instanceof HTMLElement && item.classList.contains('row') && item.dataset.id) return item;
  }
  return null;
}

function getDroppedGeometry(deps: EntityTreeEventDeps, event: DragEvent, geometryId: string | undefined): Geometry3D | null {
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

function handleResourceDragOver(_deps: EntityTreeEventDeps, event: DragEvent): void {
  if (!hasResourceDragType(event.dataTransfer?.types)) return;
  const row = getEventTreeRow(event);
  if (!row) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function handleResourceDrop(deps: EntityTreeEventDeps, event: DragEvent): void {
  if (!hasResourceDragType(event.dataTransfer?.types)) return;
  const row = getEventTreeRow(event);
  const target = row?.dataset.id ? deps.world.getEntity(Number(row.dataset.id)) : null;
  if (!target?.getComponent(Mesh3D)) return;

  event.preventDefault();
  event.stopPropagation();

  const geometryId = event.dataTransfer?.getData(GEOMETRY_DRAG_MIME) || event.dataTransfer?.getData(MESH_DRAG_MIME);
  const materialId = event.dataTransfer?.getData(MATERIAL_DRAG_MIME);
  const textureId = event.dataTransfer?.getData(TEXTURE_DRAG_MIME);
  const geometry = getDroppedGeometry(deps, event, geometryId);
  const material = materialId ? deps.resourcePool.materials.get(Number(materialId))?.resource : null;
  const texture = textureId ? deps.resourcePool.textures.get(Number(textureId))?.resource : null;
  let changed = false;
  if (geometry) changed = deps.changeMeshGeometry(target, geometry) || changed;
  if (material) changed = deps.changeMeshMaterial(target, material) || changed;
  if (texture) changed = deps.changeMaterialTexture(target, texture) || changed;
  if (!changed) return;

  deps.selectionState.setSelection(deps.selectEntities([target], target), target);
  deps.refreshTreeSelection();
}

function handleDrop(deps: EntityTreeEventDeps, detail: GETreeDataChangeDetail): void {
  runHierarchyTransaction(() => handleDropTransaction(deps, detail));
}

function handleDropTransaction(deps: EntityTreeEventDeps, detail: GETreeDataChangeDetail): void {
  const source = detail.sourceId ? deps.world.getEntity(Number(detail.sourceId)) : null;
  const target = detail.targetId ? deps.world.getEntity(Number(detail.targetId)) : null;
  const to = source && target ? getDropLocation(deps.world, source, target, detail.dropPosition) : null;
  if (!source || !to) {
    deps.refreshTreeSelection();
    return;
  }
  const before = getEntityLocation(source);
  executeCommand(deps, moveEntityCommand({
    label: 'Move Entity',
    world: deps.world,
    entity: source,
    from: before,
    to,
    execute: () => {
      measureHierarchyStage('viewport-inspector-sync', () => {
        deps.selectionState.setSelection(deps.selectEntities([source], source), source);
        deps.refreshTreeSelection();
      });
    },
    undo: () => {
      measureHierarchyStage('viewport-inspector-sync', () => {
        deps.selectionState.setSelection(deps.selectEntities([source], source), source);
        deps.refreshTreeSelection();
      });
    },
  }));
}

function handleDelete(deps: EntityTreeEventDeps, detail: GETreeDataChangeDetail): void {
  const deletedEntities = (detail.deletedIds ?? [])
    .map(id => deps.world.getEntity(Number(id)))
    .filter((entity): entity is Entity => entity !== null);
  executeCommand(deps, removeEntitiesCommand({
    label: 'Delete Entity',
    world: deps.world,
    entities: deletedEntities,
    execute: () => {
      deps.selectionState.setSelection(deps.selectEntities([], null), null);
      deps.refreshTreeSelection();
      deps.refreshResourcePool();
    },
    undo: () => {
      const active = deletedEntities[deletedEntities.length - 1] ?? null;
      deps.selectionState.setSelection(deps.selectEntities(deletedEntities, active), active);
      deps.refreshTreeSelection();
      deps.refreshResourcePool();
    },
  }));
}

function handlePaste(deps: EntityTreeEventDeps, detail: GETreeDataChangeDetail): void {
  const targetEntity = detail.targetId ? deps.world.getEntity(Number(detail.targetId)) : null;
  const pastedEntities = (detail.pastedNodes ?? [])
    .map(node => {
      const sourceId = deps.getEntityIdFromNode(node);
      const source = sourceId === null ? null : deps.world.getEntity(sourceId);
      return source ? cloneEditorEntity(source, { cloneExtensions: deps.componentLibraries }) : null;
    })
    .filter((entity): entity is Entity => entity !== null);
  executePaste(deps, targetEntity, pastedEntities);
}

function pasteClipboardEntities(deps: EntityTreeEventDeps, targetEntity: Entity | null): void {
  const pastedEntities = deps.getEntityClipboard().map(entity => cloneEditorEntity(entity, { cloneExtensions: deps.componentLibraries }));
  executePaste(deps, targetEntity, pastedEntities);
}

function executePaste(deps: EntityTreeEventDeps, targetEntity: Entity | null, pastedEntities: Entity[]): void {
  executeCommand(deps, pasteEntitiesCommand({
    label: 'Paste Entity',
    world: deps.world,
    entities: pastedEntities,
    parent: targetEntity,
    execute: () => {
      const active = pastedEntities[pastedEntities.length - 1] ?? null;
      deps.selectionState.setSelection(deps.selectEntities(pastedEntities, active), active);
      deps.refreshTreeSelection();
      deps.refreshResourcePool();
    },
    undo: () => {
      deps.selectionState.setSelection(deps.selectEntities(targetEntity ? [targetEntity] : [], targetEntity), targetEntity);
      deps.refreshTreeSelection();
      deps.refreshResourcePool();
    },
  }));
}

function getDropLocation(
  world: World,
  source: Entity,
  target: Entity,
  position: GETreeDataChangeDetail['dropPosition'],
) {
  if (source === target || isEntityDescendant(target, source)) return null;
  if (position === 'inside') {
    return { parent: target, index: target.children.length };
  }
  const parent = target.parent as Entity | null;
  const siblings = parent?.children ?? world.rootEntityList;
  const targetIndex = siblings.indexOf(target);
  if (targetIndex < 0) return null;
  const sourceBeforeTarget = siblings.indexOf(source);
  let index = position === 'before' ? targetIndex : targetIndex + 1;
  if (source.parent === parent && sourceBeforeTarget >= 0 && sourceBeforeTarget < index) index--;
  return { parent, index };
}

function executeCommand(deps: Pick<EntityTreeEventDeps, 'getCommandBus'>, command: Command): void {
  const commandBus = deps.getCommandBus();
  if (commandBus) commandBus.execute(command);
  else command.execute();
}

function getTopLevelEntitiesFromSelection(entities: Iterable<Entity>): Entity[] {
  const selected = new Set(entities);
  return [...selected].filter(entity => {
    let parent = entity.parent as Entity | null;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parent.parent as Entity | null;
    }
    return true;
  });
}
