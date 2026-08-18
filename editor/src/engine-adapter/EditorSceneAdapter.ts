import type { Entity, World } from '@haiyue/engine';
import type { ScriptResource } from '@haiyue/engine/components';
import type { EditorComponentLibrary } from '../domain/library/componentLibrary';
import type {
  SerializedGlobalSettings,
  SerializedSystem,
} from '../export/runtimeScene';
import type { ResourcePool } from '../resources/ResourcePool';
import { createEditorSceneActions, type EditorSceneActions } from '../infra/scene/editorSceneActions';

export interface EditorSceneAdapterOptions {
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
}

export class EditorSceneAdapter {
  readonly sceneActions: EditorSceneActions;
  readonly entityContextMenuState = { targetId: null as string | null };
  private _systemConfigs: SerializedSystem[] = [];
  private _entityClipboard: Entity[] = [];

  constructor(options: EditorSceneAdapterOptions) {
    this.sceneActions = createEditorSceneActions({
      resourcePool: options.resourcePool,
      resourceDisplayNames: options.resourceDisplayNames,
      componentLibraries: options.componentLibraries,
      getGlobalSettings: options.getGlobalSettings,
      setGlobalSettings: options.setGlobalSettings,
      getSystemConfigs: () => this._systemConfigs,
      setSystemConfigs: systems => { this._systemConfigs = systems; },
      applyGlobalSettingsToWorld: options.applyGlobalSettingsToWorld,
      syncViewportClearColor: options.syncViewportClearColor,
      clearResourceSelection: options.clearResourceSelection,
      setActiveScriptResource: options.setActiveScriptResource,
      setSelectedComponentName: options.setSelectedComponentName,
      clearEntityClipboard: () => { this._entityClipboard = []; },
      renderGlobalSettingsPanel: options.renderGlobalSettingsPanel,
      refreshResourcePool: options.refreshResourcePool,
    });
  }

  getSystemConfigs(): SerializedSystem[] {
    return this._systemConfigs;
  }

  setSystemConfigs(systems: SerializedSystem[]): void {
    this._systemConfigs = systems;
  }

  addSystemConfig(config: SerializedSystem): void {
    this._systemConfigs.push(config);
  }

  getEntityClipboard(): Entity[] {
    return this._entityClipboard;
  }

  setEntityClipboard(entities: Entity[]): void {
    this._entityClipboard = entities;
  }

  clearEntityClipboard(): void {
    this._entityClipboard = [];
  }
}
