export {
  ResourcePool } from './resources/ResourcePool';
export { presentModelCompatibility } from './domain/resource/modelCompatibility';
export { PrefabInstanceComponent } from './scene/prefabInstance';
export { createBuiltinComponentsLibrary } from './domain/library/componentLibrary';
export {
  clippingPlanesInspectorSchema,
  validateClippingPlanesEditorValue,
} from './domain/library/coreComponentInspectorSchemas';
export { createMainComponentContext } from './infra/library/mainComponentContext';
export { InspectorRegistry } from './infra/inspector/InspectorRegistry';
export { generateRuntimeProjectFiles,
  serializeRuntimeProjectFiles } from './export/projectTemplate';
export { deserializePlayerResources } from './domain/runtime/playerResources';
export { createEntityTreePresenter } from './ui/entityTreePresenter';
export {
  HIERARCHY_TRANSACTION_MEASURE_PREFIX,
  measureHierarchyStage,
  readHierarchyTransactionMetrics,
  runHierarchyTransaction,
} from './domain/scene/hierarchyTransactionMetrics';
export { EditorStore, defineEditorSelector, editorSelectors, parseEditorSessionState } from './domain/store/EditorStore';
export { BinaryWriter, precompileRuntimeScene } from './export/runtimeDataPrecompile';
export { ExportWorkerClient } from './export/ExportWorkerClient';
export { createRuntimeProjectZipBytes } from './export/projectZip';
export { DocumentAutoRecovery, DocumentFileSession } from './infra/file/documentLifecycle';
export { createDocumentRecoveryRecord } from './infra/file/documentRecovery';
export { ProjectState } from './domain/store/ProjectState';
export { SessionState } from './domain/store/SessionState';
export { RuntimeState } from './domain/store/RuntimeState';
export { InspectorState } from './domain/store/InspectorState';
export { PlayState } from './domain/store/PlayState';
export { SelectionState } from './domain/selection/SelectionState';
export { EditorEventBus } from './domain/events/EditorEventBus';
export { CoreWorkflowCoordinator } from './domain/workflows/CoreWorkflowCoordinator';
export { PlaySession } from './play/playSession';
export {
  EDITOR_RENDER_DIAGNOSTICS_SCHEMA,
  deriveRenderDomainDiagnostics,
} from './domain/diagnostics/RenderDomainDiagnostics';
export {
  createAnimationAuthoringDocument,
  createBlendTreeMotion,
  parseAnimationAuthoringDocument,
  sampleAnimationTimeline,
  validateAnimationAuthoringDocument,
} from './domain/content/AnimationAuthoring';
export { ContentAuthoringStore, parseContentAuthoringBundle } from './domain/content/ContentAuthoringStore';
export { prepareHyaAnimationAsset } from './infra/content/HyaAnimationImport';
export { MaterialGraphCompilerClient } from './infra/content/MaterialGraphCompilerClient';
export { loadPlayerOptionalRuntime } from './player/PlayerOptionalRuntime';
export { AssetOperationCenter } from './infra/resource/AssetOperationCenter';
export { OptionalEditorCapabilityLoader } from './infra/app/lazyContributionLoader';
export {
  applyEditorTheme,
  applyStoredEditorTheme,
  DEFAULT_EDITOR_THEME,
  EDITOR_THEME_STORAGE_KEY,
  installLegacyButtonThemeBridge,
  normalizeEditorTheme,
  readStoredEditorTheme,
  storeEditorTheme,
} from './infra/theme/editorTheme';
export { sceneRayTracingPlugin } from './platform/sceneRayTracingPlugin';
export { createTweenEditorPlugin } from './infra/app/tweenEditorContribution';
export {
  collectOptionalCapabilitiesForProject,
  getOptionalCapabilityForComponentType,
} from './domain/library/optionalComponentManifest';
export { applyCartesianTransformInputs, renderMixedCartesianTransformInputs } from './ui/inspector/transformEditor';
export {
  EditorShortcutRegistry,
  ShortcutConflictError,
  normalizeShortcutChord,
  } from './infra/shortcuts/EditorShortcutRegistry';
export { EditorAssetAdapter } from './engine-adapter/EditorAssetAdapter';
export { EditorSceneAdapter } from './engine-adapter/EditorSceneAdapter';
export { EditorPluginHost } from './engine-adapter/EditorPluginHost';
export { RuntimeOwnershipScope } from './domain/runtime/RuntimeOwnershipScope';
export {
  createEditorRendererWarmupDegradationPolicy,
  disableOptionalRendererCapability,
} from './engine-adapter/EditorViewportBootstrap';
export {
  addEntityCommand,
  moveEntityCommand,
  pasteEntitiesCommand,
  removeEntitiesCommand,
  } from './commands/entityCommands';
export { loadEditorSceneCommand } from './commands/sceneCommands';
export { CommandBus } from './commands/CommandBus';
export { snapshotEditCommand } from './commands/componentCommands';
export { getEntityLocation } from './scene/entityHierarchy';
export {
  deserializeComponent,
  deserializeEntity,
  deserializeGeometry,
  deserializeMaterial,
  deserializeScriptResource,
  remapSerializedEntityScriptIds,
  validateSerializedEditorScene,
  } from './domain/scene/deserialization';
export {
  serializeComponent,
  serializeEditorScene,
  serializeEntity,
  serializeGeometry,
  serializeMaterial,
  serializeTextureItem,
  } from './domain/scene/serialization';
export { validateRuntimeScene } from './export/runtimeScene';
export { exportRuntimeSceneFromEditorScene } from './export/runtimeScene';
export {
  applyGenericComponentSnapshot,
  snapshotGenericComponent,
} from './ui/inspector/genericComponentEditor';
export {
  BasicMaterial,
  CartesianTransform3D,
  Entity,
  EngineErrorCode,
  Geometry2D,
  Geometry3D,
  Material2D,
  Mesh2D,
  Mesh3D,
  PbrMaterial,
  World,
  } from '@haiyue/engine';
export { ErrorDomain, ErrorRecovery } from '@haiyue/engine/core';
export { DataComponent, ScriptComponent, ScriptResource } from '@haiyue/engine/components';
export { ClippingPlanes } from '@haiyue/engine/components';
export { ToonMaterial } from '@haiyue/engine/material';
export { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
export { createGltfPlugin, GltfModelComponent } from '@haiyue/extensions/gltf';
export { createSpinePlugin, Spine2DComponent } from '@haiyue/extensions/spine';
export { createTilemapPlugin } from '@haiyue/extensions/tilemap';
