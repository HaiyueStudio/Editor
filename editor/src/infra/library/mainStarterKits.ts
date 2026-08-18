import type { Entity, World } from '@haiyue/engine';
import type { GETree } from '@haiyue/ui';
import type { CommandBus } from '../../commands/CommandBus';
import type { ResourcePool } from '../../resources/ResourcePool';
import {
  cloneGlobalSettings,
  normalizeGlobalSettings,
} from '../../domain/settings/globalSettings';
import {
  getUniqueEntityName,
  removeEntityKeepingObject,
} from '../../scene/entityHierarchy';
import type { SerializedGlobalSettings } from '../../export/runtimeScene';
import type { EditorStarterKit } from '../../types';
import { createTetrisStarterKit } from '../../starter-kits/tetrisKit';

export interface RegisterMainStarterKitsDeps {
  registerStarterKit(kit: EditorStarterKit): void;
  getCommandBus(): CommandBus | null;
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  getGlobalSettings(): SerializedGlobalSettings;
  setGlobalSettings(settings: SerializedGlobalSettings): void;
  applyGlobalSettingsToWorld(world: World): void;
  selectEntities(
    entities: Entity[],
    tree: GETree | null,
    previous: Set<Entity>,
    active?: Entity | null,
  ): Set<Entity>;
  refreshTreeSelection(tree: GETree | null, world: World, selection: Set<Entity>): void;
  refreshResourcePool(world: World): void;
  renderGlobalSettingsPanel(world: World): void;
  renderInspector(entity: Entity | null, selectionCount?: number): void;
}

export function registerMainStarterKits(deps: RegisterMainStarterKitsDeps): void {
  deps.registerStarterKit(createTetrisStarterKit({
    getCommandBus: deps.getCommandBus,
    resourcePool: deps.resourcePool,
    resourceDisplayNames: deps.resourceDisplayNames,
    getGlobalSettings: deps.getGlobalSettings,
    setGlobalSettings: deps.setGlobalSettings,
    cloneGlobalSettings,
    normalizeGlobalSettings,
    applyGlobalSettingsToWorld: deps.applyGlobalSettingsToWorld,
    getUniqueEntityName,
    removeEntityKeepingObject,
    selectEntities: deps.selectEntities,
    refreshTreeSelection: deps.refreshTreeSelection,
    refreshResourcePool: deps.refreshResourcePool,
    renderGlobalSettingsPanel: deps.renderGlobalSettingsPanel,
    renderInspector: deps.renderInspector,
  }));
}
