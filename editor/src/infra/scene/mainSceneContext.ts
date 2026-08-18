import type { Entity, World } from '@haiyue/engine';
import type { ScriptResource } from '@haiyue/engine/components';
import type { EditorComponentLibrary } from '../../domain/library/componentLibrary';
import type {
  SerializedGlobalSettings,
  SerializedSystem,
} from '../../export/runtimeScene';
import type { ResourcePool } from '../../resources/ResourcePool';
import { EditorSceneAdapter, type EditorSceneAdapterOptions } from '../../engine-adapter/EditorSceneAdapter';
import type { EditorSceneActions } from './editorSceneActions';
import type { ContentAuthoringStore } from '../../domain/content/ContentAuthoringStore';

export interface MainSceneContextDeps {
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  componentLibraries: EditorComponentLibrary[];
  getGlobalSettings(): SerializedGlobalSettings;
  setGlobalSettings(settings: SerializedGlobalSettings): void;
  applyGlobalSettingsToWorld(world: World): void;
  syncViewportClearColor(): void;
  clearResourceSelection(): void;
  setActiveScriptResource(resource: ScriptResource | null): void;
  setSelectedComponentName(name: string): void;
  renderGlobalSettingsPanel(world: World): void;
  refreshResourcePool(world: World): void;
  authoringStore?: ContentAuthoringStore;
}

export interface MainSceneContext {
  sceneActions: EditorSceneActions;
  entityContextMenuState: { targetId: string | null };
  getSystemConfigs(): SerializedSystem[];
  setSystemConfigs(systems: SerializedSystem[]): void;
  addSystemConfig(config: SerializedSystem): void;
  getEntityClipboard(): Entity[];
  setEntityClipboard(entities: Entity[]): void;
  clearEntityClipboard(): void;
}

export function createMainSceneContext(deps: MainSceneContextDeps): MainSceneContext {
  const adapter = new EditorSceneAdapter(deps as EditorSceneAdapterOptions);
  return {
    sceneActions: adapter.sceneActions,
    entityContextMenuState: adapter.entityContextMenuState,
    getSystemConfigs: () => adapter.getSystemConfigs(),
    setSystemConfigs: systems => adapter.setSystemConfigs(systems),
    addSystemConfig: config => adapter.addSystemConfig(config),
    getEntityClipboard: () => adapter.getEntityClipboard(),
    setEntityClipboard: entities => adapter.setEntityClipboard(entities),
    clearEntityClipboard: () => adapter.clearEntityClipboard(),
  };
}
