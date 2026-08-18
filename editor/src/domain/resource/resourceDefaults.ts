import { BasicMaterial, ColorSRGB, Material2D, Mesh2D, Mesh3D, PbrMaterial, createBox3D } from '@haiyue/engine';
import { BlinnPhongMaterial, DepthMaterial, NormalMaterial, ToonMaterial, type CssMaterialStyle, type Material } from '@haiyue/engine/material';
import { ScriptComponent, ScriptResource } from '@haiyue/engine/components';
import { createRect2D } from '@haiyue/engine/geometry';
import type { ResourcePool } from '../../resources/ResourcePool';

export type EditorDefaultMaterialKind = 'pbr' | 'basic' | 'blinn-phong' | 'toon' | 'normal' | 'depth';

export function createDefaultMeshComponent(
  resourcePool: ResourcePool,
  resourceDisplayNames: WeakMap<object, string>,
  getUniqueGeometryName: (baseName: string) => string,
  getUniqueMaterialName: (baseName: string) => string,
  materialKind: EditorDefaultMaterialKind = 'pbr',
): Mesh3D {
  let geometry = [...resourcePool.geometries.values()][0]?.resource;
  if (!geometry) {
    geometry = createBox3D({ width: 1.2, height: 1.2, depth: 1.2 });
    const name = getUniqueGeometryName('Box');
    resourceDisplayNames.set(geometry, name);
    resourcePool.registerGeometry(geometry, name);
  }
  const { material, baseName } = createDefaultMesh3DMaterial(materialKind);
  const materialName = getUniqueMaterialName(baseName);
  resourceDisplayNames.set(material, materialName);
  resourcePool.registerMaterial(material, materialName);
  return new Mesh3D(geometry, material);
}

export function createDefaultMesh3DMaterial(kind: EditorDefaultMaterialKind): { material: Material; baseName: string } {
  if (kind === 'pbr') {
    return {
      material: new PbrMaterial({ baseColor: [0.52, 0.68, 0.86, 1], metallic: 0.15, roughness: 0.42 }),
      baseName: 'PBR',
    };
  }
  if (kind === 'blinn-phong') {
    return {
      material: new BlinnPhongMaterial({
        ambient: [0.08, 0.08, 0.09, 1],
        diffuse: [0.74, 0.78, 0.84, 1],
        specular: [1, 1, 1, 1],
        shininess: 32,
      }),
      baseName: 'BlinnPhong',
    };
  }
  if (kind === 'normal') {
    return { material: new NormalMaterial({ space: 'view' }), baseName: 'Normal' };
  }
  if (kind === 'toon') {
    return { material: new ToonMaterial(), baseName: 'Toon' };
  }
  if (kind === 'depth') {
    return { material: new DepthMaterial(), baseName: 'Depth' };
  }
  return {
    material: new BasicMaterial({ color: new ColorSRGB(0.72, 0.78, 0.86) }),
    baseName: 'Basic',
  };
}

export function createDefaultMesh2DComponent(
  resourcePool?: ResourcePool,
  resourceDisplayNames?: WeakMap<object, string>,
  getUniqueGeometryName?: (baseName: string) => string,
  getUniqueMaterialName?: (baseName: string) => string,
): Mesh2D {
  const geometry = createRect2D({ width: 120, height: 80 });
  const material = new Material2D({ color: new ColorSRGB(0.25, 0.62, 1, 1), blending: 'normal' });
  if (resourcePool && resourceDisplayNames && getUniqueGeometryName && getUniqueMaterialName) {
    const geometryName = getUniqueGeometryName('Rect2D');
    const materialName = getUniqueMaterialName('Basic2D');
    resourceDisplayNames.set(geometry, geometryName);
    resourceDisplayNames.set(material, materialName);
    resourcePool.registerGeometry2D(geometry, geometryName);
    resourcePool.registerMaterial2D(material, materialName);
  }
  return new Mesh2D(geometry, material);
}

export function getDefaultScriptResource(resourcePool: ResourcePool, activeScriptResource: ScriptResource | null): ScriptResource | null {
  return activeScriptResource ?? [...resourcePool.scripts.values()][0]?.resource ?? null;
}

export function createDefaultScriptComponent(resourcePool: ResourcePool, activeScriptResource: ScriptResource | null): ScriptComponent {
  return new ScriptComponent({}, getDefaultScriptResource(resourcePool, activeScriptResource));
}

export function getDefaultCanvasTextStyle(): CssMaterialStyle {
  return {
    width: 256,
    height: 96,
    backgroundColor: 'rgba(16,24,36,0.85)',
    borderColor: '#5f7ea6',
    borderWidth: 2,
    borderRadius: 8,
    padding: 12,
    textAlign: 'center',
    verticalAlign: 'middle',
    fontSize: 28,
    fontFamily: 'sans-serif',
    fontWeight: '600',
    color: '#f4f8ff',
  };
}
