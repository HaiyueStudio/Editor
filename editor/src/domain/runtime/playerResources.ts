import { Geometry3D } from '@haiyue/engine';
import { Material } from '@haiyue/engine/material';
import { ScriptResource } from '@haiyue/engine/components';
import type {
  RuntimePrefab,
  SerializedEditorScene,
  SerializedScript,
} from '../../export/runtimeScene';
import type { TextureSource } from '../../types';
import {
  deserializeGeometry,
  deserializeMaterial,
} from '../scene/deserialization';

export type PlayerSerializedResources = Omit<SerializedEditorScene['resources'], 'prefabs' | 'scripts'> & {
  prefabs?: SerializedEditorScene['resources']['prefabs'];
  scripts?: SerializedScript[];
};

export interface PlayerRuntimeResources {
  textureMap: Map<number, TextureSource>;
  geometryMap: Map<number, Geometry3D>;
  materialMap: Map<number, Material>;
  scriptMap: Map<number, ScriptResource>;
  prefabMap: Map<number, RuntimePrefab>;
}

export function deserializePlayerResources(resources: PlayerSerializedResources | undefined): PlayerRuntimeResources {
  const textureMap = new Map<number, TextureSource>();
  for (const textureData of resources?.textures ?? []) {
    if (textureData.src) textureMap.set(textureData.id, typeof textureData.src === 'string' ? textureData.src : { ...textureData.src });
  }

  const geometryMap = new Map<number, Geometry3D>();
  for (const geometryData of resources?.geometries ?? []) {
    geometryMap.set(geometryData.id, deserializeGeometry(geometryData));
  }

  const materialMap = new Map<number, Material>();
  for (const materialData of resources?.materials ?? []) {
    materialMap.set(materialData.id, deserializeMaterial(materialData, textureMap));
  }

  const scriptMap = new Map<number, ScriptResource>();
  for (const scriptData of resources?.scripts ?? []) {
    const resource = new ScriptResource({
      name: scriptData.name,
      scripts: scriptData.scripts,
    });
    scriptMap.set(scriptData.id, resource);
    scriptMap.set(resource.id, resource);
  }

  const prefabMap = new Map<number, RuntimePrefab>();
  for (const prefabData of resources?.prefabs ?? []) {
    prefabMap.set(prefabData.id, {
      id: prefabData.id,
      name: prefabData.name,
      root: prefabData.root,
    });
  }

  return { textureMap, geometryMap, materialMap, scriptMap, prefabMap };
}
