import type {
  RuntimeExportResult,
  RuntimeExportWarning,
  RuntimeMaterial,
  RuntimeEntity,
  RuntimeResourceCounts,
  RuntimeTexture,
  SerializedComponent,
  SerializedEditorScene,
  SerializedEntity,
  SerializedGlobalSettings,
  SerializedMaterial,
  SerializedPrefab,
  SerializedSystem,
  SerializedScript,
  SerializedTexture,
  SerializedTypedArray,
  Vec3Tuple,
} from './RuntimeSceneContract';
import { validateRuntimeScene } from './RuntimeSceneContract';

export * from './RuntimeSceneContract';

interface RuntimeRefs {
  geometries: Set<number>;
  materials: Set<number>;
  textures: Set<number>;
  prefabs: Set<number>;
  scripts: Set<number>;
}

export function exportRuntimeSceneFromEditorScene(editorScene: SerializedEditorScene): RuntimeExportResult {
  const warnings: RuntimeExportWarning[] = [];
  const refs: RuntimeRefs = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    prefabs: new Set(),
    scripts: new Set(),
  };
  const resources = editorScene.resources;
  const materialById = new Map(resources.materials.map(material => [material.id, material]));
  const prefabById = new Map((resources.prefabs ?? []).map(prefab => [prefab.id, prefab]));
  const scriptById = new Map((resources.scripts ?? []).map(script => [script.id, script]));

  for (const entity of editorScene.entities) collectEntityRefs(entity, refs, materialById, prefabById, scriptById, warnings, `entity:${entity.name}`);
  pruneUnexportableTextures(refs, resources.textures, warnings);
  if (refs.scripts.size > 0 && (resources.prefabs?.length ?? 0) > refs.prefabs.size) {
    warnings.push({
      code: 'dynamic-prefab-reference-risk',
      message: 'Some prefabs were removed even though scripts are present. If scripts spawn prefabs by name or id, add explicit export hints in a later phase.',
    });
  }

  const geometryIdMap = createIdMap(refs.geometries);
  const materialIdMap = createIdMap(refs.materials);
  const textureIdMap = createIdMap(refs.textures);
  const prefabIdMap = createIdMap(refs.prefabs);
  const scriptIdMap = createIdMap(refs.scripts);

  const geometries = resources.geometries
    .filter(geometry => refs.geometries.has(geometry.id))
    .map(geometry => ({ ...geometry, id: geometryIdMap.get(geometry.id)! }));
  const materials = resources.materials
    .filter(material => refs.materials.has(material.id))
    .map(material => remapMaterial(material, materialIdMap, textureIdMap, warnings));
  const textures = resources.textures
    .filter(texture => refs.textures.has(texture.id))
    .map(texture => remapTexture(texture, textureIdMap, warnings))
    .filter((texture): texture is RuntimeTexture => texture !== null);
  const prefabs = (resources.prefabs ?? [])
    .filter(prefab => refs.prefabs.has(prefab.id))
    .map(prefab => ({
      id: prefabIdMap.get(prefab.id)!,
      name: prefab.name,
      ...(prefab.assetKey === undefined ? {} : { assetKey: prefab.assetKey }),
      root: remapEntity(prefab.root, geometryIdMap, materialIdMap, prefabIdMap, scriptIdMap, warnings, `prefab:${prefab.name}`),
    }));
  const scripts = (resources.scripts ?? [])
    .filter(script => refs.scripts.has(script.id))
    .map(script => ({
      id: scriptIdMap.get(script.id)!,
      name: script.name,
      scripts: { ...script.scripts },
    }));
  const entities = editorScene.entities.map(entity =>
    remapEntity(entity, geometryIdMap, materialIdMap, prefabIdMap, scriptIdMap, warnings, `entity:${entity.name}`),
  );

  const inputCounts = countEditorResources(editorScene);
  const outputCounts = { geometries: geometries.length, materials: materials.length, textures: textures.length, prefabs: prefabs.length, scripts: scripts.length };

  const result: RuntimeExportResult = {
    scene: {
      version: 1,
      format: 'haiyue-runtime-scene',
      name: editorScene.name,
      globals: cloneSerializedGlobalSettings(editorScene.globals),
      systems: cloneSerializedSystems(editorScene.systems ?? []),
      resources: { geometries, materials, textures, prefabs, scripts },
      entities,
    },
    manifest: {
      version: 1,
      sceneName: editorScene.name,
      resources: {
        input: inputCounts,
        output: outputCounts,
        removed: {
          geometries: inputCounts.geometries - outputCounts.geometries,
          materials: inputCounts.materials - outputCounts.materials,
          textures: inputCounts.textures - outputCounts.textures,
          prefabs: inputCounts.prefabs - outputCounts.prefabs,
          scripts: inputCounts.scripts - outputCounts.scripts,
        },
      },
      idMaps: {
        geometries: mapToRecord(geometryIdMap),
        materials: mapToRecord(materialIdMap),
        textures: mapToRecord(textureIdMap),
        prefabs: mapToRecord(prefabIdMap),
        scripts: mapToRecord(scriptIdMap),
      },
      warnings,
    },
  };
  validateRuntimeScene(result.scene);
  return result;
}

function pruneUnexportableTextures(refs: RuntimeRefs, textures: SerializedTexture[], warnings: RuntimeExportWarning[]): void {
  const textureById = new Map(textures.map(texture => [texture.id, texture]));
  for (const textureId of [...refs.textures]) {
    const texture = textureById.get(textureId);
    if (!texture?.src) {
      refs.textures.delete(textureId);
      warnings.push({
        code: 'texture-without-src',
        message: `Texture ${texture?.name ?? textureId} has no serializable source and was skipped.`,
      });
    }
  }
}

function collectEntityRefs(
  entity: SerializedEntity,
  refs: RuntimeRefs,
  materialById: Map<number, SerializedMaterial>,
  prefabById: Map<number, SerializedPrefab>,
  scriptById: Map<number, SerializedScript>,
  warnings: RuntimeExportWarning[],
  path: string,
): void {
  for (const component of entity.components) {
    collectComponentRefs(component, refs, materialById, prefabById, scriptById, warnings, path);
  }
  for (const child of entity.children) {
    collectEntityRefs(child, refs, materialById, prefabById, scriptById, warnings, `${path}/${child.name}`);
  }
}

function collectComponentRefs(
  component: SerializedComponent,
  refs: RuntimeRefs,
  materialById: Map<number, SerializedMaterial>,
  prefabById: Map<number, SerializedPrefab>,
  scriptById: Map<number, SerializedScript>,
  warnings: RuntimeExportWarning[],
  path: string,
): void {
  if (component.type === 'Mesh3D') {
    refs.geometries.add(component.geometryId);
    refs.materials.add(component.materialId);
    const material = materialById.get(component.materialId);
    if (!material) {
      warnings.push({ code: 'missing-material', message: `Missing material ${component.materialId}.`, path });
    } else if (material.type === 'BasicMaterial' && material.textureId != null) {
      refs.textures.add(material.textureId);
    } else if (material.type === 'PbrMaterial') {
      for (const textureId of [
        material.baseColorTextureId,
        material.metallicRoughnessTextureId,
        material.normalTextureId,
        material.occlusionTextureId,
        material.emissiveTextureId,
        material.clearcoatTextureId,
        material.clearcoatRoughnessTextureId,
        material.clearcoatNormalTextureId,
        material.specularTextureId,
        material.specularColorTextureId,
        material.sheenColorTextureId,
        material.sheenRoughnessTextureId,
        material.transmissionTextureId,
        material.thicknessTextureId,
      ]) if (textureId != null) refs.textures.add(textureId);
    } else if (material.type === 'ToonMaterial') {
      for (const layer of material.layers) if (layer.textureId != null) refs.textures.add(layer.textureId);
    }
    return;
  }
  if (component.type === 'ScriptComponent' && component.scriptId != null) {
    refs.scripts.add(component.scriptId);
    if (!scriptById.has(component.scriptId)) warnings.push({ code: 'missing-script', message: `Missing script ${component.scriptId}.`, path });
    return;
  }
  if (component.type === 'PrefabInstance') {
    collectPrefabRef(component.prefabId, refs, materialById, prefabById, scriptById, warnings, path);
  }
}

function collectPrefabRef(
  prefabId: number,
  refs: RuntimeRefs,
  materialById: Map<number, SerializedMaterial>,
  prefabById: Map<number, SerializedPrefab>,
  scriptById: Map<number, SerializedScript>,
  warnings: RuntimeExportWarning[],
  path: string,
): void {
  if (refs.prefabs.has(prefabId)) return;
  const prefab = prefabById.get(prefabId);
  if (!prefab) {
    warnings.push({ code: 'missing-prefab', message: `Missing prefab ${prefabId}.`, path });
    return;
  }
  refs.prefabs.add(prefabId);
  collectEntityRefs(prefab.root, refs, materialById, prefabById, scriptById, warnings, `${path}/prefab:${prefab.name}`);
}

function createIdMap(ids: Set<number>): Map<number, number> {
  const result = new Map<number, number>();
  [...ids].sort((a, b) => a - b).forEach((id, index) => result.set(id, index + 1));
  return result;
}

function remapMaterial(
  material: SerializedMaterial,
  materialIdMap: Map<number, number>,
  textureIdMap: Map<number, number>,
  warnings: RuntimeExportWarning[],
): RuntimeMaterial {
  const id = materialIdMap.get(material.id)!;
  if (material.type === 'PbrMaterial') {
    const remap = (textureId: number | null | undefined): number | null => textureId == null ? null : textureIdMap.get(textureId) ?? null;
    return {
      ...material,
      id,
      baseColorTextureId: remap(material.baseColorTextureId),
      metallicRoughnessTextureId: remap(material.metallicRoughnessTextureId),
      normalTextureId: remap(material.normalTextureId),
      occlusionTextureId: remap(material.occlusionTextureId),
      emissiveTextureId: remap(material.emissiveTextureId),
      clearcoatTextureId: remap(material.clearcoatTextureId),
      clearcoatRoughnessTextureId: remap(material.clearcoatRoughnessTextureId),
      clearcoatNormalTextureId: remap(material.clearcoatNormalTextureId),
      specularTextureId: remap(material.specularTextureId),
      specularColorTextureId: remap(material.specularColorTextureId),
      sheenColorTextureId: remap(material.sheenColorTextureId),
      sheenRoughnessTextureId: remap(material.sheenRoughnessTextureId),
      transmissionTextureId: remap(material.transmissionTextureId),
      thicknessTextureId: remap(material.thicknessTextureId),
    };
  }
  if (material.type === 'ToonMaterial') {
    return {
      ...material,
      id,
      layers: material.layers.map(layer => ({
        ...layer,
        textureId: layer.textureId == null ? null : textureIdMap.get(layer.textureId) ?? null,
      })),
    };
  }
  if (material.type !== 'BasicMaterial') return { ...material, id } as RuntimeMaterial;
  const textureId = material.textureId == null ? null : textureIdMap.get(material.textureId) ?? null;
  if (material.textureId != null && textureId == null) {
    warnings.push({ code: 'missing-texture', message: `Texture ${material.textureId} referenced by material ${material.name} was not exported.` });
  }
  return { ...material, id, textureId };
}

function remapTexture(texture: SerializedTexture, textureIdMap: Map<number, number>, warnings: RuntimeExportWarning[]): RuntimeTexture | null {
  if (!texture.src) {
    warnings.push({ code: 'texture-without-src', message: `Texture ${texture.name} has no serializable source and was skipped.` });
    return null;
  }
  return {
    id: textureIdMap.get(texture.id)!,
    name: texture.name,
    src: texture.src,
    ...(texture.width === undefined ? {} : { width: texture.width }),
    ...(texture.height === undefined ? {} : { height: texture.height }),
    ...(texture.fileType === undefined ? {} : { fileType: texture.fileType }),
  };
}

function remapEntity(
  entity: SerializedEntity,
  geometryIdMap: Map<number, number>,
  materialIdMap: Map<number, number>,
  prefabIdMap: Map<number, number>,
  scriptIdMap: Map<number, number>,
  warnings: RuntimeExportWarning[],
  path: string,
): RuntimeEntity {
  return {
    name: entity.name,
    disabled: entity.disabled,
    components: entity.components
      .map(component => remapComponent(component, geometryIdMap, materialIdMap, prefabIdMap, scriptIdMap, warnings, path))
      .filter((component): component is SerializedComponent => component !== null),
    children: entity.children.map(child => remapEntity(child, geometryIdMap, materialIdMap, prefabIdMap, scriptIdMap, warnings, `${path}/${child.name}`)),
  };
}

function remapComponent(
  component: SerializedComponent,
  geometryIdMap: Map<number, number>,
  materialIdMap: Map<number, number>,
  prefabIdMap: Map<number, number>,
  scriptIdMap: Map<number, number>,
  warnings: RuntimeExportWarning[],
  path: string,
): SerializedComponent | null {
  if (component.type === 'Mesh3D') {
    const geometryId = geometryIdMap.get(component.geometryId);
    const materialId = materialIdMap.get(component.materialId);
    if (!geometryId || !materialId) {
      warnings.push({ code: 'dropped-mesh3d', message: 'Mesh3D was dropped because geometry or material is missing.', path });
      return null;
    }
    return { ...component, geometryId, materialId };
  }
  if (component.type === 'PrefabInstance') {
    const prefabId = prefabIdMap.get(component.prefabId);
    if (!prefabId) {
      warnings.push({ code: 'dropped-prefab-instance', message: `PrefabInstance ${component.prefabId} was dropped because prefab is missing.`, path });
      return null;
    }
    return { ...component, prefabId };
  }
  if (component.type === 'ScriptComponent') {
    const scriptId = component.scriptId == null ? null : scriptIdMap.get(component.scriptId) ?? null;
    if (component.scriptId != null && scriptId == null) {
      warnings.push({ code: 'script-component-inline-only', message: `ScriptComponent lost missing script resource ${component.scriptId}; inline scripts were kept.`, path });
    }
    return { ...component, scriptId };
  }
  return cloneSerializedComponent(component);
}

function cloneSerializedGlobalSettings(settings: SerializedGlobalSettings): SerializedGlobalSettings {
  const inputMap: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(settings.inputMap)) inputMap[key] = [...values];
  return {
    ...settings,
    clearColor: [...settings.clearColor],
    parameters: { ...settings.parameters },
    inputMap,
  };
}

function cloneSerializedSystems(systems: SerializedSystem[]): SerializedSystem[] {
  return systems.map(system => {
    if (system.type === 'Physics2DSystem') return { ...system, gravity: [...system.gravity] };
    return { ...system };
  });
}

function cloneVec3(value: Vec3Tuple): Vec3Tuple {
  return [...value] as Vec3Tuple;
}

function cloneVec4(value: [number, number, number, number]): [number, number, number, number] {
  return [...value] as [number, number, number, number];
}

function cloneSerializedComponent(component: SerializedComponent): SerializedComponent {
  switch (component.type) {
    case 'CartesianTransform3D':
      return { ...component, position: cloneVec3(component.position), rotation: cloneVec3(component.rotation), scale: cloneVec3(component.scale), anchor: cloneVec3(component.anchor) };
    case 'SphericalTransform3D':
      return { ...component, target: cloneVec3(component.target) };
    case 'BasisTransform3D':
      return { ...component, coordinates: cloneVec3(component.coordinates), basisX: cloneVec3(component.basisX), basisY: cloneVec3(component.basisY), basisZ: cloneVec3(component.basisZ) };
    case 'DataComponent':
      return { ...component, data: structuredClone(component.data) };
    case 'Physics2DJoint':
      return {
        ...component,
        anchor: component.anchor ? [...component.anchor] : null,
        anchorA: component.anchorA ? [...component.anchorA] : null,
        anchorB: component.anchorB ? [...component.anchorB] : null,
      };
    case 'Physics2DTo3DTransformSync':
      return { ...component, offset: cloneVec3(component.offset) };
    case 'CanvasTextComponent':
      return { ...component, style: { ...component.style } };
    case 'GltfModelComponent':
      return {
        ...component,
        ...(component.baseColorFactor === undefined ? {} : { baseColorFactor: cloneVec4(component.baseColorFactor) }),
      };
    case 'Tilemap2DComponent':
      return { ...component, cells: [...component.cells], palette: component.palette.map(color => cloneVec4(color)) };
    case 'Mesh2D':
      return {
        ...component,
        positions: cloneSerializedNumericArray(component.positions),
        indices: component.indices ? cloneSerializedNumericArray(component.indices) : null,
        color: cloneVec4(component.color),
      };
    case 'MeshHelper':
      return { ...component, color: cloneVec4(component.color) };
    case 'ScriptComponent':
      return { ...component, scripts: { ...component.scripts } };
    case 'AmbientLight':
      return { ...component, color: cloneVec4(component.color) };
    case 'DirectionalLight':
      return { ...component, color: cloneVec4(component.color), direction: cloneVec3(component.direction), shadow: { ...component.shadow } };
    case 'EnvironmentLight':
      return { ...component, diffuseColor: cloneVec4(component.diffuseColor), specularColor: cloneVec4(component.specularColor) };
    case 'Fog':
      return { ...component, color: cloneVec4(component.color) };
    case 'PointLight':
      return { ...component, color: cloneVec4(component.color) };
    default:
      return { ...component };
  }
}

function cloneSerializedNumericArray<T extends number[] | SerializedTypedArray>(value: T): T {
  if (Array.isArray(value)) return [...value] as T;
  return { ...value } as T;
}

function countEditorResources(scene: SerializedEditorScene): RuntimeResourceCounts {
  return {
    geometries: scene.resources.geometries.length,
    materials: scene.resources.materials.length,
    textures: scene.resources.textures.length,
    prefabs: scene.resources.prefabs?.length ?? 0,
    scripts: scene.resources.scripts?.length ?? 0,
  };
}

function mapToRecord(map: Map<number, number>): Record<number, number> {
  const result: Record<number, number> = {};
  for (const [from, to] of map) result[from] = to;
  return result;
}
