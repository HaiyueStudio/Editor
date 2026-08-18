import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import { Entity, Mesh2D, Mesh3D } from '@haiyue/engine';
import { ScriptComponent, ScriptResource } from '@haiyue/engine/components';
import { getUniqueName } from '../../domain/resource/resourceNames';
import {
  createDefaultMesh2DComponent as createDefaultMesh2DComponentFromResources,
  createDefaultMeshComponent as createDefaultMeshComponentFromResources,
  createDefaultScriptComponent as createDefaultScriptComponentFromResources,
  type EditorDefaultMaterialKind,
} from '../../domain/resource/resourceDefaults';
import {
  ensureCanvasTextMesh as ensureCanvasTextMeshWithDeps,
  syncCanvasTextGeometry as syncCanvasTextGeometryWithDeps,
} from '../inspector/canvasTextMesh';
import { ResourcePool } from '../../resources/ResourcePool';
import { PrefabInstanceComponent } from '../../scene/prefabInstance';
import type { ResourcePanelSelection } from './resourcePanelAdapter';

export interface MainResourceContext {
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  resourceSelection: ResourcePanelSelection;
  getResourceName(resource: object, fallback: string): string;
  createDefaultMeshComponent(): Mesh3D;
  createDefaultMesh2DComponent(): Mesh2D;
  createDefaultScriptComponent(): ScriptComponent;
  ensureCanvasTextMesh(entity: Entity, component: CanvasTextComponent): void;
  syncCanvasTextGeometry(entity: Entity, component: CanvasTextComponent): void;
  getUniqueGeometryName(baseName: string): string;
  getUniqueMaterialName(baseName: string): string;
  getUniqueScriptName(baseName: string): string;
}

export interface MainResourceContextDeps {
  getActiveScriptResource(): ScriptResource | null;
  getDefaultMaterialKind?: () => EditorDefaultMaterialKind;
  resourceSelection?: ResourcePanelSelection;
}

export function createMainResourceContext(deps: MainResourceContextDeps): MainResourceContext {
  const resourceDisplayNames = new WeakMap<object, string>();
  const resourceSelection: ResourcePanelSelection = deps.resourceSelection ?? {
    geometryId: null,
    geometry2DId: null,
    materialId: null,
    material2DId: null,
    textureId: null,
    modelId: null,
    prefabId: null,
  };

  const getResourceName = (resource: object, fallback: string): string => {
    return resourceDisplayNames.get(resource) ?? fallback;
  };

  const resourcePool = new ResourcePool({
    getResourceName,
    getPrefabId(entity) {
      return entity.getComponent(PrefabInstanceComponent)?.prefabId ?? null;
    },
  });

  const getUniqueGeometryName = (baseName: string): string => {
    return getUniqueName(baseName, [...resourcePool.geometries.values()].map(item => item.name));
  };

  const getUniqueMaterialName = (baseName: string): string => {
    return getUniqueName(baseName, [...resourcePool.materials.values()].map(item => item.name));
  };

  const getUniqueScriptName = (baseName: string): string => {
    return getUniqueName(baseName, [...resourcePool.scripts.values()].map(item => item.name));
  };

  const createDefaultMeshComponent = (): Mesh3D => {
    return createDefaultMeshComponentFromResources(
      resourcePool,
      resourceDisplayNames,
      getUniqueGeometryName,
      getUniqueMaterialName,
      deps.getDefaultMaterialKind?.() ?? 'basic',
    );
  };

  const createDefaultMesh2DComponent = (): Mesh2D => {
    return createDefaultMesh2DComponentFromResources(resourcePool, resourceDisplayNames, getUniqueGeometryName, getUniqueMaterialName);
  };

  const createDefaultScriptComponent = (): ScriptComponent => {
    return createDefaultScriptComponentFromResources(resourcePool, deps.getActiveScriptResource());
  };

  const ensureCanvasTextMesh = (entity: Entity, component: CanvasTextComponent): void => {
    ensureCanvasTextMeshWithDeps({ resourcePool, resourceDisplayNames, getUniqueGeometryName, getUniqueMaterialName }, entity, component);
  };

  const syncCanvasTextGeometry = (entity: Entity, component: CanvasTextComponent): void => {
    syncCanvasTextGeometryWithDeps({ resourcePool, resourceDisplayNames, getUniqueGeometryName, getUniqueMaterialName }, entity, component);
  };

  return {
    resourcePool,
    resourceDisplayNames,
    resourceSelection,
    getResourceName,
    createDefaultMeshComponent,
    createDefaultMesh2DComponent,
    createDefaultScriptComponent,
    ensureCanvasTextMesh,
    syncCanvasTextGeometry,
    getUniqueGeometryName,
    getUniqueMaterialName,
    getUniqueScriptName,
  };
}
