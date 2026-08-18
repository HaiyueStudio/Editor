import type {
  AnimationEndBehavior,
  AnimationTransform2D,
  HyaStateMachineDefinition,
  HyaStateMachineLayer,
  HyaStateMachineState,
} from '@haiyue/animation-spec';

export const ANIMATION_EDITOR_PROJECT_FORMAT = 'haiyue-animation-editor-project@1' as const;
export const ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION = 1 as const;

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject { readonly [key: string]: JsonValue; }

export interface AnimationEditorComposition {
  readonly canvas: Readonly<{
    width: number;
    height: number;
    coordinateSystem: 'screen-y-down';
  }>;
  readonly duration: number;
  readonly frameRate: number;
  readonly endBehavior: AnimationEndBehavior;
}

export type AnimationEditorAssetSource =
  | Readonly<{ kind: 'external'; uri: string }>
  | Readonly<{
      kind: 'embedded';
      fileName: string;
      mimeType: string;
      encoding: 'base64';
      data: string;
    }>;

export interface AnimationEditorAsset {
  readonly id: string;
  readonly name: string;
  readonly type: 'image' | 'audio' | 'binary';
  readonly source: AnimationEditorAssetSource;
  readonly delivery: Readonly<{
    uri: string;
    mimeType?: string;
    integrity?: string;
    width?: number;
    height?: number;
    colorSpace?: 'srgb' | 'linear';
  }>;
}

export interface AnimationEditorComponentPayload extends JsonObject {
  readonly type: string;
}

export interface AnimationEditorEffectPayload extends JsonObject {
  readonly kind: 'tint' | 'fill' | 'opacity' | 'color-matrix' | 'blur' | 'drop-shadow';
}

export type AnimationEditorComponentPartRole =
  | 'fill'
  | 'stroke'
  | 'gradient'
  | 'modifier'
  | 'text-animator'
  | 'text-selector';

export interface AnimationEditorComponentRecord {
  readonly id: string;
  readonly name?: string;
  readonly component: AnimationEditorComponentPayload;
  readonly parts?: readonly Readonly<{
    id: string;
    role: AnimationEditorComponentPartRole;
    index?: number;
  }>[];
}

export interface AnimationEditorEffectRecord {
  readonly id: string;
  readonly name?: string;
  readonly effect: AnimationEditorEffectPayload;
}

export interface AnimationEditorCompositeLayer {
  readonly id: string;
  readonly kind: 'mask' | 'matte';
  readonly sourceNodeId: string;
  readonly mode: 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted';
  readonly operation?: 'add' | 'subtract' | 'intersect' | 'difference';
  readonly feather?: readonly [number, number];
  readonly expansion?: number;
}

export interface AnimationEditorNode {
  readonly id: string;
  readonly name: string;
  readonly parent?: string;
  readonly start?: number;
  readonly duration?: number;
  readonly transform: Readonly<AnimationTransform2D>;
  readonly components: readonly AnimationEditorComponentRecord[];
  readonly effects: readonly AnimationEditorEffectRecord[];
  readonly compositeLayers: readonly AnimationEditorCompositeLayer[];
  readonly extensions?: JsonObject;
  readonly editor?: Readonly<{
    hidden?: boolean;
    locked?: boolean;
    expanded?: boolean;
    color?: string;
  }>;
}

export type AnimationEditorComponentProperty =
  | 'sprite.uv-rect'
  | 'vector.morph'
  | 'vector.fill.color'
  | 'vector.fill.opacity'
  | 'vector.gradient.start'
  | 'vector.gradient.end'
  | 'vector.gradient.stops'
  | 'vector.stroke.color'
  | 'vector.stroke.opacity'
  | 'vector.stroke.width'
  | 'vector.stroke.dash-offset'
  | 'vector.modifier.trim-start'
  | 'vector.modifier.trim-end'
  | 'vector.modifier.trim-offset'
  | 'vector.modifier.round-radius'
  | 'text.selector.start'
  | 'text.selector.end'
  | 'text.selector.offset'
  | 'text.selector.amount'
  | 'text.animator.position'
  | 'text.animator.scale'
  | 'text.animator.rotation'
  | 'text.animator.opacity'
  | 'text.animator.fill-color'
  | 'text.animator.tracking';

export type AnimationEditorEffectProperty =
  | 'tint.black'
  | 'tint.white'
  | 'tint.amount'
  | 'fill.color'
  | 'fill.opacity'
  | 'opacity.value'
  | 'color-matrix.matrix'
  | 'blur.radius'
  | 'drop-shadow.color'
  | 'drop-shadow.opacity'
  | 'drop-shadow.offset'
  | 'drop-shadow.blur';

export type AnimationEditorTrackTarget =
  | Readonly<{
      kind: 'node-transform';
      nodeId: string;
      property: 'position' | 'rotation' | 'scale' | 'opacity';
    }>
  | Readonly<{
      kind: 'component-property';
      nodeId: string;
      componentId: string;
      partId?: string;
      property: AnimationEditorComponentProperty;
    }>
  | Readonly<{
      kind: 'effect-property';
      nodeId: string;
      effectId: string;
      property: AnimationEditorEffectProperty;
    }>
  | Readonly<{
      kind: 'composite-property';
      nodeId: string;
      compositeLayerId: string;
      property: 'expansion';
    }>;

export interface AnimationEditorKeyframe {
  readonly id: string;
  readonly time: number;
  readonly value: readonly number[];
  readonly interpolation: 'step' | 'linear' | 'cubic-bezier';
  readonly easing?: readonly [number, number, number, number];
  readonly spatialIn?: readonly [number, number];
  readonly spatialOut?: readonly [number, number];
}

export interface AnimationEditorTrack {
  readonly id: string;
  readonly name: string;
  readonly target: AnimationEditorTrackTarget;
  readonly valueSize: number;
  readonly enabled?: boolean;
  readonly color?: string;
  readonly keyframes: readonly AnimationEditorKeyframe[];
}

export interface AnimationEditorClip {
  readonly id: string;
  readonly name: string;
  readonly start: number;
  readonly duration: number;
  readonly color?: string;
}

export interface AnimationEditorTimeline {
  readonly tracks: readonly AnimationEditorTrack[];
  readonly clips: readonly AnimationEditorClip[];
}

export interface AnimationEditorState extends HyaStateMachineState {
  readonly editorPosition?: readonly [number, number];
}

export interface AnimationEditorStateLayer extends Omit<HyaStateMachineLayer, 'states'> {
  readonly states: readonly AnimationEditorState[];
}

export interface AnimationEditorStateMachine extends Omit<HyaStateMachineDefinition, 'layers'> {
  readonly layers: readonly AnimationEditorStateLayer[];
}

export interface AnimationEditorMetadata {
  readonly activePanel?: 'timeline' | 'state-machine';
  readonly viewport?: Readonly<{
    zoom: number;
    center: readonly [number, number];
    showGrid: boolean;
  }>;
  readonly timeline?: Readonly<{
    playhead: number;
    pixelsPerSecond: number;
    scrollX: number;
  }>;
}

export interface AnimationEditorProject {
  readonly format: typeof ANIMATION_EDITOR_PROJECT_FORMAT;
  readonly schemaVersion: typeof ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly composition: AnimationEditorComposition;
  readonly assets: readonly AnimationEditorAsset[];
  readonly nodes: readonly AnimationEditorNode[];
  readonly timeline: AnimationEditorTimeline;
  readonly stateMachine: AnimationEditorStateMachine | null;
  readonly editor?: AnimationEditorMetadata;
}

export type DeepMutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? number extends T['length']
      ? DeepMutable<T[number]>[]
      : { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

export function createEmptyAnimationEditorProject(
  options: { id?: string; name?: string; width?: number; height?: number; duration?: number; frameRate?: number } = {},
): AnimationEditorProject {
  const width = positiveOr(options.width, 800);
  const height = positiveOr(options.height, 500);
  const duration = positiveOr(options.duration, 1);
  const frameRate = positiveOr(options.frameRate, 60);
  return freezeAnimationEditorProject({
    format: ANIMATION_EDITOR_PROJECT_FORMAT,
    schemaVersion: ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION,
    id: options.id?.trim() || 'untitled-animation',
    name: options.name?.trim() || 'Untitled Animation',
    composition: {
      canvas: { width, height, coordinateSystem: 'screen-y-down' },
      duration,
      frameRate,
      endBehavior: 'hold',
    },
    assets: [],
    nodes: [],
    timeline: { tracks: [], clips: [] },
    stateMachine: null,
    editor: {
      activePanel: 'timeline',
      viewport: { zoom: 1, center: [width / 2, height / 2], showGrid: true },
      timeline: { playhead: 0, pixelsPerSecond: 240, scrollX: 0 },
    },
  });
}

export function cloneAnimationEditorProject(project: AnimationEditorProject): DeepMutable<AnimationEditorProject> {
  return cloneProjectData(project) as DeepMutable<AnimationEditorProject>;
}

export function freezeAnimationEditorProject(project: AnimationEditorProject): AnimationEditorProject {
  return deepFreeze(cloneProjectData(project));
}

/** Editor layout and playhead changes do not make authored content dirty. */
export function animationEditorProjectFingerprint(project: AnimationEditorProject): string {
  const { editor: _editor, ...content } = project;
  const serialized = JSON.stringify(content);
  let first = 0x811c9dc5;
  let second = 5381;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second, 33) ^ code;
  }
  return `${serialized.length}:${first >>> 0}:${second >>> 0}`;
}

export function animationEditorProjectSnapshotKey(project: AnimationEditorProject): string {
  return JSON.stringify(project);
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function cloneProjectData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => cloneProjectData(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const clone: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) clone[key] = cloneProjectData(child);
  return clone as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
