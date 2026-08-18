import {
  cloneAnimationEditorProject,
  createEmptyAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorAsset,
  type AnimationEditorProject,
} from '../domain/AnimationEditorProject';
import { createBasicAnimationNode } from '../domain/SceneAuthoring';
import { createCoreTransformTrack, createTimelineClip, createTimelineKeyframe } from '../domain/TimelineAuthoring';
import { availableAdvancedPropertyBindings, createAdvancedPropertyTrack } from '../domain/AdvancedContentAuthoring';
import {
  createRegularSpriteSheetFrameMap,
} from '../domain/SpriteSheetGridAuthoring';
import {
  createSpriteSheetSequence,
  generateSpriteSheetProjectAnimation,
} from '../domain/SpriteSheetSequenceAuthoring';
import {
  addNative3dAsset,
  addNative3dCamera,
  addNative3dMaterial,
  addNative3dModel,
  addNative3dPrimitive,
  createNative3dClip,
  createNative3dTrack,
} from '../domain/native3d/Native3dAuthoring';
import {
  createNative3dProject,
  type Native3dProject,
} from '../domain/native3d/Native3dProject';

export type DesignerProjectFamily = '2d' | '3d';
export type DesignerTemplateId =
  | 'tween-ui'
  | 'spritesheet'
  | 'path-vector'
  | 'particle'
  | 'native3d-camera-object'
  | 'gltf-character';

export type DesignerProject = AnimationEditorProject | Native3dProject;

export interface DesignerTemplateDefinition {
  readonly id: DesignerTemplateId;
  readonly family: DesignerProjectFamily;
  readonly name: Readonly<{ 'zh-CN': string; 'en-US': string }>;
  readonly description: Readonly<{ 'zh-CN': string; 'en-US': string }>;
  readonly tags: readonly string[];
}

export const DESIGNER_TEMPLATES: readonly DesignerTemplateDefinition[] = Object.freeze([
  template('tween-ui', '2d', 'Tween UI 动效', 'Tween UI Motion', '包含位移、缩放和缓动关键帧的 UI 卡片。', 'A UI card with position, scale, and easing keys.', ['2d', 'tween']),
  template('spritesheet', '2d', 'SpriteSheet 序列', 'SpriteSheet Sequence', '包含规则网格、序列和 step 关键帧的图集动画。', 'An atlas animation with a regular grid, sequence, and step keys.', ['2d', 'spritesheet']),
  template('path-vector', '2d', 'Path / Vector', 'Path / Vector', '包含可编辑路径、描边、Trim Path 和 Morph 轨道。', 'An editable path with stroke, Trim Path, and a Morph track.', ['2d', 'vector']),
  template('particle', '2d', '粒子动效', 'Particle Motion', '包含固定种子的 2D 粒子发射器和位置动画。', 'A deterministic Particle2D emitter with position animation.', ['2d', 'particle']),
  template('native3d-camera-object', '3d', '原生 3D 摄像机与物体', 'Native 3D Camera & Object', '包含摄像机、PBR 材质、立方体和 TRS 动画。', 'A camera, PBR material, box, and TRS animation.', ['3d', 'camera', 'primitive']),
  template('gltf-character', '3d', 'glTF 角色样例', 'glTF Character Sample', '引用仓库内真实 glTF 角色夹具并提供模型变换动画。', 'References the checked-in real glTF fixture and includes model motion.', ['3d', 'gltf', 'character']),
]);

export function designerTemplate(templateId: DesignerTemplateId): DesignerTemplateDefinition {
  const result = DESIGNER_TEMPLATES.find(candidate => candidate.id === templateId);
  if (!result) throw new Error(`Unknown designer template "${templateId}".`);
  return result;
}

export function createDesignerTemplateProject(templateId: DesignerTemplateId): DesignerProject {
  if (templateId === 'tween-ui') return tweenUiTemplate();
  if (templateId === 'spritesheet') return spriteSheetTemplate();
  if (templateId === 'path-vector') return pathVectorTemplate();
  if (templateId === 'particle') return particleTemplate();
  if (templateId === 'native3d-camera-object') return native3dCameraObjectTemplate();
  return gltfCharacterTemplate();
}

export function designerProjectFamily(project: DesignerProject): DesignerProjectFamily {
  return 'mode' in project && project.mode === '3d' ? '3d' : '2d';
}

function tweenUiTemplate(): AnimationEditorProject {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({
    id: 'template-tween-ui', name: 'Tween UI Motion', width: 960, height: 540, duration: 2, frameRate: 60,
  }));
  const card = createBasicAnimationNode(project as AnimationEditorProject, 'rectangle');
  card.id = 'ui-card';
  card.name = 'UI Card';
  card.transform.position = [240, 270];
  project.nodes.push(card);
  const position = createCoreTransformTrack(project as AnimationEditorProject, card.id, 'position', 0);
  position.keyframes[0]!.interpolation = 'cubic-bezier';
  position.keyframes[0]!.easing = [0.2, 0.8, 0.2, 1];
  const positionEnd = createTimelineKeyframe({ ...project, timeline: { ...project.timeline, tracks: [position] } }, position.id, 1.5, [720, 270]);
  positionEnd.interpolation = 'cubic-bezier';
  positionEnd.easing = [0.2, 0.8, 0.2, 1];
  const scale = createCoreTransformTrack({ ...project, timeline: { ...project.timeline, tracks: [position] } } as AnimationEditorProject, card.id, 'scale', 0);
  const scaleMiddle = createTimelineKeyframe({ ...project, timeline: { ...project.timeline, tracks: [position, scale] } }, scale.id, 0.75, [1.14, 1.14]);
  scaleMiddle.interpolation = 'cubic-bezier';
  scaleMiddle.easing = [0.34, 1.56, 0.64, 1];
  createTimelineKeyframe({ ...project, timeline: { ...project.timeline, tracks: [position, scale] } }, scale.id, 1.5, [1, 1]);
  project.timeline.tracks.push(position, scale);
  project.timeline.clips.push(createTimelineClip(project as AnimationEditorProject, 0));
  project.timeline.clips[0]!.name = 'UI Entrance';
  project.timeline.clips[0]!.duration = 1.5;
  return freezeAnimationEditorProject(project as AnimationEditorProject);
}

function spriteSheetTemplate(): AnimationEditorProject {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({
    id: 'template-spritesheet', name: 'SpriteSheet Sequence', width: 640, height: 360, duration: 2, frameRate: 12,
  }));
  const asset = embeddedSpriteSheetAsset();
  project.assets.push(asset);
  const sprite = createBasicAnimationNode(project as AnimationEditorProject, 'sprite', { imageAssetId: asset.id });
  sprite.id = 'sprite-character';
  sprite.name = 'Sprite Character';
  project.nodes.push(sprite);
  const component = sprite.components[0]!;
  const frameMap = createRegularSpriteSheetFrameMap(asset.id, 4, 1, { columns: 4, rows: 1 });
  const sequence = createSpriteSheetSequence(frameMap, { start: 0, end: 3, fps: 4, loop: true, mode: 'forward' });
  const generated = generateSpriteSheetProjectAnimation(project as AnimationEditorProject, sprite.id, component.id, frameMap, sequence);
  return freezeAnimationEditorProject({ ...generated.project, name: project.name } as AnimationEditorProject);
}

function pathVectorTemplate(): AnimationEditorProject {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({
    id: 'template-path-vector', name: 'Path & Vector Motion', width: 800, height: 500, duration: 2, frameRate: 60,
  }));
  const vector = createBasicAnimationNode(project as AnimationEditorProject, 'vector');
  vector.id = 'vector-badge';
  vector.name = 'Vector Badge';
  project.nodes.push(vector);
  const bindings = availableAdvancedPropertyBindings(project as AnimationEditorProject, vector.id);
  const morph = bindings.find(binding => binding.target.kind === 'component-property' && binding.target.property === 'vector.morph');
  const trim = bindings.find(binding => binding.target.kind === 'component-property' && binding.target.property === 'vector.modifier.trim-end');
  for (const binding of [morph, trim]) {
    if (!binding) continue;
    const track = createAdvancedPropertyTrack({ ...project, timeline: { ...project.timeline } } as AnimationEditorProject, vector.id, binding.key, 0);
    const endValue = track.keyframes[0]!.value.map((value, index) => binding === trim ? (index === 0 ? 1 : value) : value + (index % 2 === 0 ? 10 : -8));
    createTimelineKeyframe({ ...project, timeline: { ...project.timeline, tracks: [track] } }, track.id, 1.5, endValue);
    project.timeline.tracks.push(track);
  }
  project.timeline.clips.push({ id: 'vector-motion', name: 'Vector Motion', start: 0, duration: 2, color: '#22d3ee' });
  return freezeAnimationEditorProject(project as AnimationEditorProject);
}

function particleTemplate(): AnimationEditorProject {
  const project = cloneAnimationEditorProject(createEmptyAnimationEditorProject({
    id: 'template-particle', name: 'Deterministic Particle Motion', width: 800, height: 500, duration: 3, frameRate: 60,
  }));
  const emitter = createBasicAnimationNode(project as AnimationEditorProject, 'particle');
  emitter.id = 'particle-emitter';
  emitter.name = 'Particle Emitter';
  project.nodes.push(emitter);
  const position = createCoreTransformTrack(project as AnimationEditorProject, emitter.id, 'position', 0);
  createTimelineKeyframe({ ...project, timeline: { ...project.timeline, tracks: [position] } }, position.id, 2.5, [600, 320]);
  project.timeline.tracks.push(position);
  project.timeline.clips.push({ id: 'particle-motion', name: 'Particle Motion', start: 0, duration: 3, color: '#38bdf8' });
  return freezeAnimationEditorProject(project as AnimationEditorProject);
}

function native3dCameraObjectTemplate(): Native3dProject {
  let project = createNative3dProject({ id: 'template-native-3d', name: 'Native 3D Camera & Object', duration: 3, frameRate: 60 });
  project = addNative3dMaterial(project, defaultMaterial('material-blue', [0.08, 0.42, 0.95, 1]));
  project = addNative3dCamera(project, {
    nodeId: 'camera', componentId: 'camera-component', transform: {
      translation: [4, 3, 6], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
    },
  });
  project = addNative3dPrimitive(project, {
    nodeId: 'box', componentId: 'box-component', primitive: 'box', materialId: 'material-blue', name: 'Animated Box',
  });
  project = createNative3dClip(project, { id: 'box-motion', name: 'Box Motion', duration: 3 });
  project = createNative3dTrack(project, 'box-motion', {
    id: 'box-translation', name: 'Box · Translation', interpolation: 'linear',
    binding: { id: 'box-translation-binding', target: { kind: 'node-id', nodeId: 'box' }, path: 'transform.translation', valueType: 'vec3', valueSize: 3 },
    keyframes: [
      { id: 'box-translation-0', time: 0, value: [-1.5, 0, 0] },
      { id: 'box-translation-1', time: 1.5, value: [0, 1, 0] },
      { id: 'box-translation-2', time: 3, value: [1.5, 0, 0] },
    ],
  });
  return project;
}

function gltfCharacterTemplate(): Native3dProject {
  let project = createNative3dProject({ id: 'template-gltf-character', name: 'glTF Character Sample', duration: 2, frameRate: 30 });
  project = addNative3dAsset(project, {
    id: 'character-gltf', name: 'Animation Characterization', type: 'model',
    source: { kind: 'external', uri: 'samples/gltf/animation-characterization.gltf' },
    delivery: { uri: 'samples/gltf/animation-characterization.gltf', mimeType: 'model/gltf+json' },
    provenance: { importer: '@haiyue/animation3d-gltf', sourceFormat: 'gltf-2.0' },
  });
  project = addNative3dCamera(project, { nodeId: 'camera', componentId: 'camera-component' });
  project = addNative3dModel(project, { nodeId: 'character', componentId: 'character-model', resource: 'character-gltf', name: 'glTF Character' });
  project = createNative3dClip(project, { id: 'character-motion', name: 'Character Motion', duration: 2 });
  project = createNative3dTrack(project, 'character-motion', {
    id: 'character-translation', name: 'Character · Translation', interpolation: 'linear',
    binding: { id: 'character-translation-binding', target: { kind: 'node-id', nodeId: 'character' }, path: 'transform.translation', valueType: 'vec3', valueSize: 3 },
    keyframes: [
      { id: 'character-translation-0', time: 0, value: [0, 0, 0] },
      { id: 'character-translation-1', time: 2, value: [0.5, 0, 0] },
    ],
  });
  return project;
}

function template(
  id: DesignerTemplateId,
  family: DesignerProjectFamily,
  zhName: string,
  enName: string,
  zhDescription: string,
  enDescription: string,
  tags: readonly string[],
): DesignerTemplateDefinition {
  return Object.freeze({
    id,
    family,
    name: Object.freeze({ 'zh-CN': zhName, 'en-US': enName }),
    description: Object.freeze({ 'zh-CN': zhDescription, 'en-US': enDescription }),
    tags: Object.freeze([...tags]),
  });
}

function embeddedSpriteSheetAsset(): AnimationEditorAsset {
  // A deterministic 4×1 SVG atlas. Distinct cells make the template useful in
  // browser pixels without checking in an opaque generated PNG.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="1"><path fill="#38bdf8" d="M0 0h1v1H0z"/><path fill="#a78bfa" d="M1 0h1v1H1z"/><path fill="#fb7185" d="M2 0h1v1H2z"/><path fill="#fbbf24" d="M3 0h1v1H3z"/></svg>';
  const data = typeof btoa === 'function'
    ? btoa(svg)
    : 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjEiPjwvc3ZnPg==';
  return {
    id: 'sprite-atlas', name: 'Template Atlas', type: 'image',
    source: { kind: 'embedded', fileName: 'template-atlas.svg', mimeType: 'image/svg+xml', encoding: 'base64', data },
    delivery: { uri: 'assets/template-atlas.svg', mimeType: 'image/svg+xml', width: 4, height: 1, colorSpace: 'srgb' },
  };
}

function defaultMaterial(id: string, color: readonly [number, number, number, number]) {
  return {
    id, name: 'Blue PBR', baseColorFactor: color, metallicFactor: 0.15, roughnessFactor: 0.42,
    emissiveFactor: [0, 0, 0] as const, alphaMode: 'opaque' as const, doubleSided: false,
  };
}
