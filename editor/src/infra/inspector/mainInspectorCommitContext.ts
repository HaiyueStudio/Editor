import type { Entity, Geometry3D, World } from '@haiyue/engine';
import type { Material } from '@haiyue/engine/material';
import type { CommandBus } from '../../commands/CommandBus';
import type { SerializedGlobalSettings } from '../../export/runtimeScene';
import type { ResourcePool } from '../../resources/ResourcePool';
import type { EditorComponentDescriptor,
  InspectorContext,
  TextureSource } from '../../types';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import type { InspectorCommitState } from './commitHandlers';
import type { InspectorRegistry } from './InspectorRegistry';
import {
  createEditorInspectorAdapter,
  type EditorInspectorAdapterOptions,
  type EditorInspectorAdapterResult,
} from '../../engine-adapter/EditorInspectorAdapter';

type EditorDom = ReturnType<typeof import('../../dom').getEditorDom>;

export interface MainInspectorCommitContextDeps {
  editorDom: EditorDom;
  inspectorCommitState: InspectorCommitState;
  getInspectorContext(): InspectorContext | null;
  getCommandBus(): CommandBus | null;
  getSuppressInspectorInput(): boolean;
  getSelectedComponentName(): string;
  setSelectedComponentName(componentName: string): void;
  getComponentDescriptors(): EditorComponentDescriptor[];
  inspectorRegistry?: InspectorRegistry;
  resourcePool: ResourcePool;
  getGlobalSettings(): SerializedGlobalSettings;
  setGlobalSettings(settings: SerializedGlobalSettings): void;
  applyGlobalSettingsToWorld(world: World): void;
  syncViewportClearColor(): void;
  renderGlobalSettingsPanel(world: World | null): void;
  renderInspector(entity: Entity | null, selectionCount?: number): void;
  refreshEditorView(entity?: Entity | null): void;
  refreshResourcePool(world: World): void;
  refreshSceneTree(): void;
  renderResourcePool(): void;
  ensureCanvasTextMesh(entity: Entity, component: CanvasTextComponent): void;
  syncCanvasTextGeometry(entity: Entity, component: CanvasTextComponent): void;
}

export interface MainInspectorCommitContext extends EditorInspectorAdapterResult {
  changeMeshGeometry(entity: Entity, nextGeometry: Geometry3D): boolean;
  changeMeshMaterial(entity: Entity, nextMaterial: Material): boolean;
  changeMaterialTexture(entity: Entity, texture: TextureSource): boolean;
}

export function createMainInspectorCommitContext(deps: MainInspectorCommitContextDeps): MainInspectorCommitContext {
  return createEditorInspectorAdapter(deps as EditorInspectorAdapterOptions);
}
