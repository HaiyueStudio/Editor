import type { GETree } from '@haiyue/ui';
import type { Entity } from '@haiyue/engine';
import { markSelectedEntities3D } from '../../ui/viewport/viewportInteraction';

export interface SelectEntitiesDeps {
  renderInspector(entity: Entity | null, selectionCount?: number): void;
}

export function createSelectEntities(deps: SelectEntitiesDeps): (
  entities: Entity[],
  treeElement: GETree | null,
  previousSelected: Set<Entity>,
  activeEntity?: Entity | null,
) => Set<Entity> {
  return (
    entities,
    treeElement,
    previousSelected,
    activeEntity = entities[entities.length - 1] ?? null,
  ): Set<Entity> => {
    const nextSelection = new Set(entities);
    markSelectedEntities3D(entities, treeElement, previousSelected);
    deps.renderInspector(activeEntity, entities.length);
    return nextSelection;
  };
}
