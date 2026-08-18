import type { Particle3DAuthoringDescriptor } from '../ParticleAuthoringTypes';

export const NATIVE_3D_PROJECT_FORMAT = 'haiyue-animation-editor-project-3d@1' as const;
export const NATIVE_3D_PROJECT_SCHEMA_VERSION = 1 as const;
export const NATIVE_3D_EXTENSION_ID = 'org.haiyue.animation-3d@1' as const;

export type Native3dVec2 = readonly [number, number];
export type Native3dVec3 = readonly [number, number, number];
export type Native3dVec4 = readonly [number, number, number, number];

export interface Native3dCoordinateSystem {
  readonly handedness: 'right';
  readonly upAxis: '+y';
  readonly forwardAxis: '-z';
  readonly unit: 'meter';
  readonly angles: 'radian';
  readonly rotationStorage: 'normalized-xyzw-quaternion';
}

export const NATIVE_3D_COORDINATE_SYSTEM: Native3dCoordinateSystem = Object.freeze({
  handedness: 'right',
  upAxis: '+y',
  forwardAxis: '-z',
  unit: 'meter',
  angles: 'radian',
  rotationStorage: 'normalized-xyzw-quaternion',
});

export interface Native3dTransform {
  readonly translation: Native3dVec3;
  readonly rotation: Native3dVec4;
  readonly scale: Native3dVec3;
}

export const IDENTITY_NATIVE_3D_TRANSFORM: Native3dTransform = Object.freeze({
  translation: Object.freeze([0, 0, 0] as const),
  rotation: Object.freeze([0, 0, 0, 1] as const),
  scale: Object.freeze([1, 1, 1] as const),
});

export interface Native3dMaterial {
  readonly id: string;
  readonly name: string;
  readonly baseColorFactor: Native3dVec4;
  readonly metallicFactor: number;
  readonly roughnessFactor: number;
  readonly emissiveFactor: Native3dVec3;
  readonly alphaMode: 'opaque' | 'mask' | 'blend';
  readonly alphaCutoff?: number;
  readonly doubleSided: boolean;
  readonly baseColorTexture?: string;
  readonly normalTexture?: string;
  readonly metallicRoughnessTexture?: string;
  readonly emissiveTexture?: string;
}

export type Native3dAssetSource =
  | Readonly<{ kind: 'external'; uri: string }>
  | Readonly<{ kind: 'embedded'; encoding: 'base64'; data: string }>;

export interface Native3dAsset {
  readonly id: string;
  readonly name: string;
  readonly type: 'image' | 'audio' | 'binary' | 'model';
  readonly source: Native3dAssetSource;
  readonly delivery: Readonly<{ uri: string; mimeType: string; integrity?: string }>;
  readonly dependencyAssetIds?: readonly string[];
  readonly provenance?: Readonly<{
    importer?: string;
    sourceFormat?: string;
    sourceHash?: string;
  }>;
}

export type Native3dCameraProjection =
  | Readonly<{ kind: 'perspective'; fovYRadians: number; near: number; far: number }>
  | Readonly<{ kind: 'orthographic'; orthoHeight: number; near: number; far: number }>;

export type Native3dComponent =
  | Readonly<{ id: string; kind: 'camera3d'; projection: Native3dCameraProjection }>
  | Readonly<{
      id: string;
      kind: 'primitive3d';
      primitive: 'box' | 'sphere' | 'plane' | 'cylinder' | 'cone';
      materialId: string;
    }>
  | Readonly<{
      id: string;
      kind: 'model3d';
      resource: string;
      materialOverrides?: readonly Readonly<{ slot: string; materialId: string }>[];
    }>
  | Readonly<{ id: string; kind: 'particle3d'; descriptor: Particle3DAuthoringDescriptor }>;

export interface Native3dNode {
  readonly id: string;
  readonly name: string;
  readonly parent?: string;
  readonly start?: number;
  readonly duration?: number;
  readonly transform: Native3dTransform;
  readonly components: readonly Native3dComponent[];
}

export type Native3dBindingTarget =
  | Readonly<{ kind: 'node-id'; nodeId: string }>
  | Readonly<{ kind: 'node-path'; segments: readonly string[] }>
  | Readonly<{ kind: 'slot'; slot: string }>;

export type Native3dBinding =
  | Readonly<{ id: string; target: Native3dBindingTarget; path: 'transform.translation'; valueType: 'vec3'; valueSize: 3 }>
  | Readonly<{ id: string; target: Native3dBindingTarget; path: 'transform.rotation'; valueType: 'quaternion'; valueSize: 4 }>
  | Readonly<{ id: string; target: Native3dBindingTarget; path: 'transform.scale'; valueType: 'vec3'; valueSize: 3 }>
  | Readonly<{ id: string; target: Native3dBindingTarget; path: 'morph.weights'; valueType: 'weights'; valueSize: number }>
  | Readonly<{
      id: string;
      target: Native3dBindingTarget;
      path: 'property';
      component: 'material3d' | 'camera3d';
      property: 'baseColorFactor' | 'metallicFactor' | 'roughnessFactor' | 'emissiveFactor' | 'alphaCutoff'
        | 'fovYRadians' | 'near' | 'far' | 'orthoHeight';
      valueType: 'scalar' | 'vec3' | 'vec4';
      valueSize: 1 | 3 | 4;
    }>;

export interface Native3dKeyframe {
  readonly id: string;
  readonly time: number;
  readonly value: readonly number[];
  readonly inTangent?: readonly number[];
  readonly outTangent?: readonly number[];
}

export interface Native3dTrack {
  readonly id: string;
  readonly name: string;
  readonly binding: Native3dBinding;
  readonly interpolation: 'step' | 'linear' | 'cubic-spline';
  readonly keyframes: readonly Native3dKeyframe[];
}

export interface Native3dEvent {
  readonly id: string;
  readonly time: number;
  readonly name: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface Native3dClip {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly Native3dTrack[];
  readonly events: readonly Native3dEvent[];
}

export interface Native3dProject {
  readonly format: typeof NATIVE_3D_PROJECT_FORMAT;
  readonly schemaVersion: typeof NATIVE_3D_PROJECT_SCHEMA_VERSION;
  readonly mode: '3d';
  readonly id: string;
  readonly name: string;
  readonly composition: Readonly<{
    viewport: Readonly<{ width: number; height: number }>;
    coordinateSystem: Native3dCoordinateSystem;
    duration: number;
    frameRate: number;
    endBehavior: 'hold' | 'loop' | 'destroy';
  }>;
  readonly assets: readonly Native3dAsset[];
  readonly materials: readonly Native3dMaterial[];
  readonly nodes: readonly Native3dNode[];
  readonly timeline: Readonly<{ clips: readonly Native3dClip[] }>;
  readonly stateMachine?: Readonly<Record<string, unknown>> | null;
  readonly editor?: Readonly<{
    selectedNodeIds?: readonly string[];
    activeClipId?: string;
    viewportCamera?: Readonly<{ position: Native3dVec3; target: Native3dVec3; up: Native3dVec3 }>;
    gizmo?: Readonly<{ tool: 'translate' | 'rotate' | 'scale'; space: 'local' | 'world' }>;
  }>;
}

export interface CreateNative3dProjectOptions {
  readonly id: string;
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration?: number;
  readonly frameRate?: number;
  readonly endBehavior?: 'hold' | 'loop' | 'destroy';
}

export function createNative3dProject(options: CreateNative3dProjectOptions): Native3dProject {
  return freezeNative3dProject({
    format: NATIVE_3D_PROJECT_FORMAT,
    schemaVersion: NATIVE_3D_PROJECT_SCHEMA_VERSION,
    mode: '3d',
    id: options.id,
    name: options.name ?? '未命名 3D 动画',
    composition: {
      viewport: { width: options.width ?? 1280, height: options.height ?? 720 },
      coordinateSystem: NATIVE_3D_COORDINATE_SYSTEM,
      duration: options.duration ?? 2,
      frameRate: options.frameRate ?? 30,
      endBehavior: options.endBehavior ?? 'loop',
    },
    assets: [],
    materials: [],
    nodes: [],
    timeline: { clips: [] },
    stateMachine: null,
    editor: {
      selectedNodeIds: [],
      viewportCamera: { position: [4, 3, 6], target: [0, 0, 0], up: [0, 1, 0] },
      gizmo: { tool: 'translate', space: 'local' },
    },
  });
}

export function cloneNative3dProject(project: Native3dProject): Native3dProject {
  return structuredClone(project);
}

export function freezeNative3dProject<T extends Native3dProject>(project: T): T {
  return deepFreeze(project);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
