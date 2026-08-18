import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import { CartesianTransform3D, Entity, Mesh3D, createPlane3D } from '@haiyue/engine';
import { CssMaterial, type CssMaterialStyle } from '@haiyue/engine/material';
import { Transform3D } from '@haiyue/engine/components';
import type { ResourcePool } from '../../resources/ResourcePool';

export interface CanvasTextMeshDeps {
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  getUniqueGeometryName: (baseName: string) => string;
  getUniqueMaterialName: (baseName: string) => string;
}

function getCanvasTextSize(style: CssMaterialStyle): { width: number; height: number } {
  const width = typeof style.width === 'number' && Number.isFinite(style.width) ? style.width : 256;
  const height = typeof style.height === 'number' && Number.isFinite(style.height) ? style.height : 96;
  return { width, height };
}

export function ensureCanvasTextMesh(
  deps: CanvasTextMeshDeps,
  entity: Entity,
  component: CanvasTextComponent,
): void {
  const size = getCanvasTextSize(component.style);
  if (!entity.getComponent(Transform3D)) {
    entity.addComponent(new CartesianTransform3D());
  }
  const mesh = entity.getComponent(Mesh3D);
  if (!mesh) {
    const geometry = createPlane3D({ width: size.width / 100, height: size.height / 100 });
    const geometryName = deps.getUniqueGeometryName('Canvas Text Plane');
    const materialName = deps.getUniqueMaterialName('Canvas Text');
    deps.resourceDisplayNames.set(geometry, geometryName);
    deps.resourceDisplayNames.set(component.material, materialName);
    deps.resourcePool.registerGeometry(geometry, geometryName);
    deps.resourcePool.registerMaterial(component.material, materialName);
    entity.addComponent(new Mesh3D(geometry, component.material));
    return;
  }
  if (mesh.material instanceof CssMaterial) {
    component.material = mesh.material;
    syncCanvasTextGeometry(deps, entity, component);
  }
}

export function syncCanvasTextGeometry(
  deps: CanvasTextMeshDeps,
  entity: Entity,
  component: CanvasTextComponent,
): void {
  const mesh = entity.getComponent(Mesh3D);
  if (!mesh || mesh.material !== component.material) return;
  const size = getCanvasTextSize(component.style);
  const geometry = createPlane3D({ width: size.width / 100, height: size.height / 100 });
  const geometryName = deps.getUniqueGeometryName('Canvas Text Plane');
  deps.resourceDisplayNames.set(geometry, geometryName);
  deps.resourcePool.registerGeometry(geometry, geometryName);
  mesh.geometry = geometry;
}
