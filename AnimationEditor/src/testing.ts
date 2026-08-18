export {
  ANIMATION_EDITOR_PROJECT_FORMAT,
  ANIMATION_EDITOR_PROJECT_SCHEMA_VERSION,
  animationEditorProjectFingerprint,
  cloneAnimationEditorProject,
  createEmptyAnimationEditorProject,
  freezeAnimationEditorProject,
} from './domain/AnimationEditorProject';
export type {
  AnimationEditorProject,
  AnimationEditorNode,
  AnimationEditorTrack,
  DeepMutable,
} from './domain/AnimationEditorProject';
export {
  minimumCompositionDuration,
  setCompositionDuration,
} from './domain/CompositionAuthoring';
export {
  MAX_SPRITE_SHEET_COLUMNS,
  MAX_SPRITE_SHEET_ROWS,
  generateSpriteSheetAnimation,
  inferSpriteSheetGrid,
  setSpriteSheetFrame,
  spriteSheetFrameIndex,
  spriteSheetFrameUvRect,
} from './domain/SpriteSheetAuthoring';
export {
  animationAssetReferences,
  animationNodeContentKind,
  applyAnimationNodeHierarchy,
  buildAnimationNodeHierarchy,
  createBasicAnimationNode,
  deleteAnimationNodeSubtrees,
  duplicateAnimationNodes,
} from './domain/SceneAuthoring';
export type {
  AnimationEditorBasicNodeKind,
  AnimationEditorHierarchyNode,
  DeleteNodesResult,
} from './domain/SceneAuthoring';
export {
  CORE_TRANSFORM_PROPERTIES,
  availableCoreTransformProperties,
  coreTransformPropertyLabel,
  createCoreTransformTrack,
  createTimelineClip,
  createTimelineKeyframe,
  deleteTimelineClips,
  deleteTimelineKeyframes,
  deleteTimelineTracks,
  moveTimelineKeyframe,
  sampleAnimationEditorTrack,
  snapTimelineTime,
  timelineTrackValueLabels,
} from './domain/TimelineAuthoring';
export {
  advancedBindingForTrack,
  advancedTrackExpectedValueSize,
  advancedTrackValueLabels,
  availableAdvancedPropertyBindings,
  createAdvancedEffect,
  createAdvancedPropertyTrack,
  createAdvancedVectorComponent,
  createCompositeLayer,
  createTextAnimatorParts,
  isStepOnlyAdvancedTrack,
} from './domain/AdvancedContentAuthoring';
export type {
  AdvancedEffectKind,
  AdvancedPropertyBinding,
} from './domain/AdvancedContentAuthoring';
export type {
  CoreTransformProperty,
  TimelineKeyframeReference,
} from './domain/TimelineAuthoring';
export {
  conditionOperatorsForParameter,
  createAnimationEditorStateMachine,
  createStateMachineCondition,
  createStateMachineLayer,
  createStateMachineMotion,
  createStateMachineParameter,
  createStateMachineState,
  createStateMachineTransition,
  deleteStateMachineLayer,
  deleteStateMachineParameter,
  deleteStateMachineState,
  deleteStateMachineTransition,
  motionKindLabel,
  renameStateMachineParameter,
  stateMachineClipReferences,
  stateMachineParameterReferences,
} from './domain/StateMachineAuthoring';
export type {
  StateMachineMotionKind,
  StateMachineParameterType,
  StateMachineReference,
} from './domain/StateMachineAuthoring';
export {
  stateMachineAudioUnmixablePath,
  stateMachineComponentChannel,
  stateMachineTrackChannel,
} from './domain/StateMachineChannelCapability';
export { DirtyState } from './domain/DirtyState';
export { AnimationEditorStore } from './domain/AnimationEditorStore';
export type { AnimationEditorStoreChange } from './domain/AnimationEditorStore';
export { CommandHistory, createProjectMutationCommand } from './domain/CommandHistory';
export type { CommandHistorySnapshot, EditorCommand } from './domain/CommandHistory';
export { SelectionStore } from './domain/SelectionStore';
export type { AnimationEditorSelectionItem } from './domain/SelectionStore';
export {
  ANIMATION_EDITOR_PROJECT_FILE_SUFFIX,
  ANIMATION_EDITOR_PROJECT_MIME_TYPE,
  AnimationEditorProjectFormatError,
  createProjectFileArtifact,
  decodeAnimationEditorProject,
  parseAnimationEditorProject,
  projectFileName,
  projectNameFromFileName,
  serializeAnimationEditorProject,
} from './persistence/ProjectCodec';
export type {
  ProjectDecodeResult,
  ProjectDiagnostic,
  ProjectFileArtifact,
} from './persistence/ProjectCodec';
export {
  MemoryAnimationEditorProjectPersistence,
  recentProjectId,
} from './persistence/ProjectStorage';
export type {
  AnimationEditorProjectPersistence,
  ProjectSnapshot,
  RecentProject,
} from './persistence/ProjectStorage';
export { AnimationEditorProjectSession } from './persistence/ProjectSession';
export {
  ANIMATION_EDITOR_ASSET_IMPORT_MAX_BYTES,
  ANIMATION_EDITOR_ASSET_IMPORT_MAX_TOTAL_BYTES,
  AnimationEditorAssetImportError,
  animationAssetIdForFile,
  classifyAnimationAssetFile,
  createAnimationEditorAssetFromFile,
} from './persistence/AssetImport';
export {
  AnimationEditorCompileError,
  compileAnimationEditorProject,
} from './compiler/AnimationEditorCompiler';
export type {
  AnimationEditorCompilation,
  AnimationEditorCompileDiagnostic,
  AnimationEditorCompileDiagnosticCode,
  AnimationEditorCompileOptions,
} from './compiler/AnimationEditorCompiler';
export {
  createHyaFileArtifact,
  hyaFileName,
} from './compiler/HyaFileIO';
export type { HyaFileArtifact } from './compiler/HyaFileIO';
export {
  HYA_PACKAGE_FILE_SUFFIX,
  HYA_PACKAGE_FORMAT,
  HYA_PACKAGE_MAX_ARCHIVE_BYTES,
  HYA_PACKAGE_MAX_ASSET_BYTES,
  HYA_PACKAGE_MIME_TYPE,
  HyaPackageError,
  createHyaPackageArtifact,
  hyaPackageFileName,
} from './compiler/HyaPackageIO';
export type {
  HyaPackageArtifact,
  HyaPackageErrorCode,
  HyaPackageFile,
  HyaPackageManifest,
  HyaPackageManifestResource,
} from './compiler/HyaPackageIO';
export {
  ANIMATION_EDITOR_LOCALES,
  ANIMATION_EDITOR_LOCALE_STORAGE_KEY,
  getAnimationEditorLocale,
  localizedText,
  localizeLiteral,
  normalizeAnimationEditorLocale,
  translate,
} from './localization';
export type {
  AnimationEditorLocale,
  AnimationEditorTranslationKey,
} from './localization';
export {
  DESIGNER_TEMPLATES,
  createDesignerTemplateProject,
  designerProjectFamily,
  designerTemplate,
} from './integration/DesignerTemplates';
export type {
  DesignerProject,
  DesignerProjectFamily,
  DesignerTemplateDefinition,
  DesignerTemplateId,
} from './integration/DesignerTemplates';
export {
  compileDesignerProject,
  createDesignerHyaArtifact,
  createDesignerPackageArtifact,
  createDesignerProjectFileArtifact,
  detectDesignerProjectFamily,
  parseDesignerProject,
  relinkAnimationEditorAsset,
  serializeDesignerProject,
} from './integration/DesignerProjectIO';
export { DesignerTaskCoordinator } from './integration/DesignerTaskCoordinator';
export { createNative3dHyaPackageArtifact } from './compiler/Native3dHyaPackageIO';
