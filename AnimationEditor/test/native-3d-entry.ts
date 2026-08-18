export * as native3dEditor from '../src/domain/native3d';
export * as native3dPreview from '../src/preview/native3d';
export * as native3dSpec from '@haiyue/animation-spec/native3d';
export * as animationSpec from '@haiyue/animation-spec';
export * as native3dRuntime from '@haiyue/extensions/animation3d';

export {
  disposeGltfModel,
  loadGltfModel,
} from '@haiyue/extensions/gltf';
export { createGltfAnimation3DClips } from '@haiyue/extensions/gltf-animation3d';

export {
  Camera3D,
  Entity,
  HaiyueEngine,
  Mesh3D,
  Scene,
} from '@haiyue/engine';
export { Transform3D } from '@haiyue/engine/components';
export { createNative3dHyaPackageArtifact } from '../src/compiler/Native3dHyaPackageIO';
