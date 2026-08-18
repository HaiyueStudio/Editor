import type { Camera3D, Component, Entity, Geometry2D, Geometry3D, Material2D, World, HaiyueEngine } from '@haiyue/engine';
import type { Material } from '@haiyue/engine/material';
import type { ScriptResource } from '@haiyue/engine/components';
import type { AssetJobState } from '@haiyue/engine/core';
import type { CompressedTextureSourceDescriptor } from '@haiyue/engine/assets';
import type { RenderPipelineEntryOptions, RenderPipelineSystem } from './engine-adapter/EditorRenderProtocol';
import type { GETree } from '@haiyue/ui';
import type { GltfAssetStats, GltfCompatibilityReport } from '@haiyue/extensions/gltf';
import type { SerializedComponent, SerializedEntity } from './export/runtimeScene';
import type { WorkflowPrepareContext } from './domain/workflows/CoreWorkflowCoordinator';

export type Vec3Tuple = [number, number, number];
export type Vec2Tuple = [number, number];
export type Vec4Tuple = [number, number, number, number];
export type TextureSource = string | ImageBitmap | HTMLCanvasElement | HTMLImageElement | GPUTexture | CompressedTextureSourceDescriptor;
export type EditorComponentFactory = () => Component | null;
export type GenericEditorFieldType =
  | 'number'
  | 'string'
  | 'text'
  | 'boolean'
  | 'select'
  | 'color'
  | 'json'
  | 'vector'
  | 'int-array'
  | 'asset-ref'
  | 'custom'
  | 'object'
  | 'array';

export interface SerializeEntityOptions {
  includePrefabInstance?: boolean;
  excludePrefabInstanceForEntityIds?: ReadonlySet<number>;
}

export interface ComponentSerializationExtension {
  serializeComponent?: (component: Component, options: SerializeEntityOptions) => SerializedComponent | null;
  getIgnoredEntityChildren?: (entity: Entity) => readonly Entity[];
}

export interface ComponentDeserializationExtension {
  deserializeComponent?: (data: SerializedComponent) => Component | null;
}

export interface ComponentResourceUsageContext {
  addModelBySrc(src: string | null | undefined): void;
  addAssetId?(assetId: AssetId): void;
  resolveModelBySrc?(src: string | null | undefined): AssetId | null;
}

/** Opaque editor asset identity. Built-in resources use `kind:numericId`. */
export type AssetId = string;

export interface ComponentDependencyContext {
  resolveModelBySrc(src: string | null | undefined): AssetId | null;
}

export interface Disposable {
  dispose(): void;
}

export interface RuntimeExportImport {
  readonly from: string;
  readonly names: readonly string[];
}

/** Trusted source-generation metadata contributed to exported runtime projects. */
export interface RuntimeExportContribution {
  readonly imports?: readonly RuntimeExportImport[];
  readonly engineImports?: readonly string[];
  readonly systems?: readonly string[];
  /** JavaScript/TypeScript expression evaluated inside `deserializeComponent(data, ...)`. */
  readonly deserializeExpression?: string;
  /** Statements evaluated inside `installRuntimeSystems(...)`. */
  readonly installSystems?: string;
  readonly has2D?: boolean;
  readonly has3D?: boolean;
}

export interface RuntimeComponentContribution {
  readonly type: string;
  readonly runtimeExport?: RuntimeExportContribution;
}

export interface ComponentContribution<T extends Component = Component> {
  readonly type: string;
  readonly create: () => T;
  readonly inspector: InspectorSchema;
  readonly serialize: (component: T, options: SerializeEntityOptions) => unknown;
  readonly deserialize: (data: unknown) => T | null;
  readonly collectDependencies?: (component: T, context: ComponentDependencyContext) => readonly AssetId[];
  readonly collectSerializedDependencies?: (data: unknown, context: ComponentDependencyContext) => readonly AssetId[];
  readonly clone?: (component: T) => T;
  readonly getIgnoredChildren?: (component: T) => readonly Entity[];
  readonly installViewport?: (context: ViewportSystemInstallContext) => Disposable;
  readonly runtimeExport?: RuntimeExportContribution;
}

export interface EditorContribution {
  readonly components?: readonly ComponentContribution[];
  readonly resourceImporters?: readonly EditorResourceImporter[];
  readonly starterKits?: readonly EditorStarterKit[];
}

export interface ComponentResourceUsageExtension {
  /** Optional fast rejection used while synchronizing large Worlds. */
  supportsComponentResourceUsage?: (component: Component) => boolean;
  collectComponentResourceUsage?: (component: Component, context: ComponentResourceUsageContext) => void;
  collectSerializedComponentResourceUsage?: (data: SerializedComponent, context: ComponentResourceUsageContext) => void;
}

export interface Command {
  label: string;
  execute(): void;
  undo(): void;
  mergeWith?(next: Command): Command | null;
}

export interface PickHit {
  entity: Entity;
  distance: number;
  kind?: '3d' | '2d';
}

export interface InspectorContext {
  world: World;
  getActiveEntity: () => Entity | null;
  setActiveEntity: (entity: Entity | null) => void;
  getSelection: () => Set<Entity>;
  setSelection: (entities: Entity[], activeEntity?: Entity | null) => void;
  refreshSceneTree: () => void;
}

export interface PrefabResourceItem {
  id: number;
  name: string;
  root: SerializedEntity;
  refs: number;
  sourceEntityId?: number | undefined;
  revision: number;
  assetKey: string;
  status: AssetJobState;
  basePrefabId?: number | undefined;
  baseRevision?: number | undefined;
  variantOverrides?: PrefabVariantOverride[] | undefined;
}

export interface PrefabVariantOverride {
  path: number[];
  name?: string;
  disabled?: boolean;
  components?: SerializedComponent[];
  children?: SerializedEntity[];
}

export interface PrefabVariantConflict {
  path: number[];
  fields: string[];
  baseRevision: number | undefined;
  currentBaseRevision: number | undefined;
}

export interface ModelResourceItem {
  id: number;
  name: string;
  src: string;
  refs: number;
  fileName?: string | undefined;
  fileType?: string | undefined;
  fileSize?: number | undefined;
  previewUrl?: string | undefined;
  assetKey: string;
  status: AssetJobState;
  vertexCount?: number | undefined;
  triangleCount?: number | undefined;
  assetStats?: GltfAssetStats | undefined;
  compatibilityReport?: GltfCompatibilityReport | undefined;
  previewError?: string | undefined;
}

export interface Geometry3DResourceItem {
  name: string;
  resource: Geometry3D;
  refs: number;
}

export interface Geometry2DResourceItem {
  name: string;
  resource: Geometry2D;
  refs: number;
}

export interface MaterialResourceItem {
  name: string;
  resource: Material;
  refs: number;
}

export interface Material2DResourceItem {
  name: string;
  resource: Material2D;
  refs: number;
}

export interface EntityLocation {
  parent: Entity | null;
  index: number;
}

export interface TransformSnapshot {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
}

export interface SphericalTransformSnapshot {
  radius: number;
  theta: number;
  phi: number;
  target: Vec3Tuple;
}

export interface Transform2DSnapshot {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface Camera3DSnapshot {
  projectionType: Camera3D['projectionType'];
  fov: number;
  near: number;
  far: number;
  orthoLeft: number;
  orthoRight: number;
  orthoTop: number;
  orthoBottom: number;
  reverseZ: boolean;
}

export interface Camera2DSnapshot {
  width: number;
  height: number;
  near: number;
  far: number;
  zoom: number;
}

export interface Tilemap2DSnapshot {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  originX: number;
  originY: number;
  gap: number;
  cells: number[];
  palette: Array<[number, number, number, number]>;
}

export interface GenericEditorFieldSchema {
  type: GenericEditorFieldType;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  options?: Array<{ label: string; value: string }>;
  size?: 2 | 3 | 4;
  assetType?: string;
  allowCustomValue?: boolean;
  placeholder?: string;
  group?: string;
  unit?: string;
  item?: GenericEditorFieldSchema;
  fields?: Record<string, GenericEditorFieldSchema>;
  visibleWhen?: (component: Component) => boolean;
  validate?: (value: unknown, component: Component) => string | null | undefined;
  render?: (context: GenericEditorCustomFieldRenderContext) => HTMLElement;
  readValue?: (element: HTMLElement, component: Component) => unknown;
  get?: (component: Component) => unknown;
  set?: (component: Component, value: unknown) => void;
}

export interface GenericEditorCustomFieldRenderContext {
  component: Component;
  fieldName: string;
  field: GenericEditorFieldSchema;
  value: unknown;
  onCommit: () => void;
  formatNumber: (value: number) => string;
}

export interface GenericComponentEditorSchema {
  fields: Record<string, GenericEditorFieldSchema>;
}

export type InspectorFieldSchema = GenericEditorFieldSchema;
export type InspectorSchema = GenericComponentEditorSchema;

export interface PlayDevicePreset {
  label: string;
  width: number | null;
  height: number | null;
  dpr: number;
}

export interface ScriptEditorHandle {
  textarea: HTMLTextAreaElement;
  highlight: HTMLElement;
}

export interface TextureResourceItem {
  id: number;
  name: string;
  resource: TextureSource;
  refs: number;
  previewUrl?: string | undefined;
  assetKey: string;
  gpuAssetKey?: string | undefined;
  status: AssetJobState;
  assetError?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  fileType?: string | undefined;
  fileSize?: number | undefined;
  ownedObjectUrl?: string | undefined;
  compressedInfo?: TextureCompressedInfo | undefined;
  previewError?: string | undefined;
}

export interface TextureCompressedInfo {
  container: 'ktx2' | string;
  vkFormat?: number;
  dimension?: string;
  supercompression?: string;
  gpuFormat?: string | null;
  requiredFeature?: string | null;
  uploadPath?: string;
  supportedByBuiltInLoader?: boolean;
  unsupportedReason?: string;
  depth?: number;
  layers?: number;
  faces?: number;
  levels?: number;
}

export interface ScriptResourceItem {
  id: number;
  name: string;
  resource: ScriptResource;
  refs: number;
  fileName?: string | undefined;
  fileSize?: number | undefined;
}

export interface EditorComponentDescriptor {
  name: string;
  create: EditorComponentFactory;
}

export type EditorResourceImporterTarget = 'geometry' | 'material' | 'texture' | 'model' | 'prefab' | 'script';

export interface PreparedResourceImport {
  readonly resourceCount: number;
  commit(): void;
  dispose(): void;
}

export interface EditorResourceImporter {
  name: string;
  label: string;
  accept: string;
  target?: EditorResourceImporterTarget;
  prepareImport(files: FileList | File[], context: WorkflowPrepareContext): Promise<PreparedResourceImport> | PreparedResourceImport;
}

export interface EditorStarterKitApplyContext {
  world: World;
  tree: GETree | null;
  getSelection: () => Set<Entity>;
  setActive: (entity: Entity | null) => void;
  setSelection: (selection: Set<Entity>) => void;
  ensure2DCamera?: (entity: Entity) => void;
}

export interface ViewportSystemInstallContext {
  world: World;
  engine: HaiyueEngine;
  camera2DEntity: Entity;
  registerRenderSystem?: (system: RenderPipelineSystem, options?: RenderPipelineEntryOptions) => void;
}

export interface EditorStarterKit {
  name: string;
  description?: string;
  apply(context: EditorStarterKitApplyContext): void;
}
