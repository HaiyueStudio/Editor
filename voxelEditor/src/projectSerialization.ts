import { cloneAnimationClip } from './animation';
import type {
  PbrPaletteMaterial,
  SceneSize,
  Voxel,
  VoxelAnimationClip,
  VoxelLayer,
  VoxelModuleInstance,
  VoxelProject,
} from './model';

export interface SerializableVoxelProject {
  size: Readonly<SceneSize>;
  backgroundColor: string;
  currentColor: string;
  currentMaterialId: string;
  activeAnimationId: string | null;
  animationFrame: number;
  voxels: Iterable<Readonly<Voxel>>;
  modules: Iterable<Readonly<{
    id: string;
    name: string;
    size: Readonly<SceneSize>;
    voxels: Iterable<Readonly<Voxel>>;
  }>>;
  moduleInstances: Iterable<Readonly<VoxelModuleInstance>>;
  layers: Iterable<Readonly<VoxelLayer>>;
  palette: Iterable<Readonly<PbrPaletteMaterial>>;
  animations: Iterable<Readonly<VoxelAnimationClip>>;
}

/** Stable, detached project serialization used by persistence and export workers. */
export function serializeVoxelProject(source: SerializableVoxelProject): VoxelProject {
  const voxels = Array.from(source.voxels, voxel => ({ ...voxel }));
  voxels.sort(compareVoxel);
  return {
    format: 'haiyue-voxel',
    version: 1,
    size: { ...source.size },
    scene: { backgroundColor: source.backgroundColor },
    editor: {
      currentColor: source.currentColor,
      currentMaterialId: source.currentMaterialId,
      activeAnimationId: source.activeAnimationId,
      animationFrame: source.animationFrame,
    },
    voxels,
    modules: Array.from(source.modules, module => ({
      ...module,
      size: { ...module.size },
      voxels: Array.from(module.voxels, voxel => ({ ...voxel })).sort(compareVoxel),
    })),
    moduleInstances: Array.from(source.moduleInstances, instance => ({
      ...instance,
      position: { ...instance.position },
      rotation: { ...instance.rotation },
      scale: { ...instance.scale },
    })),
    layers: Array.from(source.layers, layer => ({ ...layer })),
    palette: Array.from(source.palette, material => ({
      ...material,
      ...(material.vox ? { vox: { ...material.vox, properties: { ...material.vox.properties } } } : {}),
    })),
    animations: Array.from(source.animations, cloneAnimationClip),
  };
}

function compareVoxel(a: Readonly<Voxel>, b: Readonly<Voxel>): number {
  return a.y - b.y || a.z - b.z || a.x - b.x;
}
