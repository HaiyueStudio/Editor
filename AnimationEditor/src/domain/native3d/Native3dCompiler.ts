import {
  AnimationExtensionRegistry,
  encodeAnimationBinary,
  parseAnimation,
  type AnimationDocument,
  type AnimationResource,
  type ParsedAnimation,
} from '@haiyue/animation-spec';
import {
  NATIVE_3D_EXTENSION_ID,
  type Native3dAsset,
  type Native3dProject,
  type Native3dTrack,
} from './Native3dProject';
import { parseNative3dProject } from './Native3dProjectCodec';

export interface Native3dCompilation {
  readonly document: AnimationDocument;
  readonly binary: ArrayBuffer;
  readonly parsed: ParsedAnimation;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface Native3dHyaArtifact {
  readonly fileName: string;
  readonly mimeType: 'application/vnd.haiyue.animation';
  readonly bytes: Uint8Array;
}

/** Compiles once; exact preview, export and runtime must all consume `binary`. */
export function compileNative3dProject(project: Native3dProject): Native3dCompilation {
  const source = parseNative3dProject(project);
  const payload = Object.freeze({
    format: 'haiyue-animation-3d@1',
    mode: 'native-3d',
    coordinateSystem: structuredClone(source.composition.coordinateSystem),
    viewport: structuredClone(source.composition.viewport),
    materials: structuredClone(source.materials),
    nodes: structuredClone(source.nodes),
    clips: source.timeline.clips.map(clip => ({
      format: 'haiyue-animation3d-clip@1',
      id: clip.id,
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.map(lowerTrack),
      events: structuredClone(clip.events),
    })),
    ...(source.stateMachine === undefined ? {} : { stateMachine: structuredClone(source.stateMachine) }),
  });
  const document: AnimationDocument = Object.freeze({
    format: 'haiyue-animation',
    version: '1.0',
    name: source.name,
    canvas: Object.freeze({
      width: source.composition.viewport.width,
      height: source.composition.viewport.height,
      coordinateSystem: 'screen-y-down',
    }),
    duration: source.composition.duration,
    frameRate: source.composition.frameRate,
    endBehavior: source.composition.endBehavior,
    resources: Object.freeze(source.assets.map(lowerResource)),
    nodes: Object.freeze([]),
    tracks: Object.freeze([]),
    extensionsUsed: Object.freeze([NATIVE_3D_EXTENSION_ID]),
    extensionsRequired: Object.freeze([NATIVE_3D_EXTENSION_ID]),
    extensions: Object.freeze({ [NATIVE_3D_EXTENSION_ID]: payload }),
  });
  const extensions = compilerRegistry();
  const binary = encodeAnimationBinary(document, { extensions });
  const parsed = parseAnimation(binary, { extensions });
  return Object.freeze({ document, binary, parsed, payload });
}

export function createNative3dHyaArtifact(project: Native3dProject): Native3dHyaArtifact {
  const compilation = compileNative3dProject(project);
  return Object.freeze({
    fileName: `${safeStem(project.name)}.hya`,
    mimeType: 'application/vnd.haiyue.animation',
    bytes: new Uint8Array(compilation.binary),
  });
}

function lowerTrack(track: Native3dTrack): Readonly<Record<string, unknown>> {
  const cubic = track.interpolation === 'cubic-spline';
  return Object.freeze({
    id: track.id,
    binding: structuredClone(track.binding),
    interpolation: track.interpolation,
    times: track.keyframes.map(keyframe => keyframe.time),
    values: track.keyframes.flatMap(keyframe => cubic
      ? [...keyframe.inTangent!, ...keyframe.value, ...keyframe.outTangent!]
      : [...keyframe.value]),
  });
}

function lowerResource(asset: Native3dAsset): AnimationResource {
  const common = {
    id: asset.id,
    uri: asset.delivery.uri,
    mimeType: asset.delivery.mimeType,
    ...(asset.delivery.integrity === undefined ? {} : { integrity: asset.delivery.integrity }),
  };
  if (asset.type === 'image') return { ...common, type: 'image' };
  if (asset.type === 'audio') return { ...common, type: 'audio' };
  return { ...common, type: 'binary' };
}

function compilerRegistry(): AnimationExtensionRegistry {
  const registry = new AnimationExtensionRegistry();
  // Project validation has already run. G06's animation-spec validator is the
  // delivery/runtime ingress; this local handler only lets the frozen core
  // binary codec preserve the opaque required extension verbatim.
  registry.register(Object.freeze({ id: NATIVE_3D_EXTENSION_ID, validateDocument() {} }));
  return registry;
}

function safeStem(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').replace(/[. ]+$/gu, '') || 'untitled-3d-animation';
}
