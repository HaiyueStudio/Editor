const GLTF_CORE_MODULES = Object.freeze([
  'GltfAccessorReader.ts',
  'GltfAnimationRuntime.ts',
  'GltfExtensionAdapter.ts',
  'GltfLoaderContract.ts',
  'GltfLoaderErrors.ts',
  'GltfMaterialDescriptor.ts',
  'GltfModelComponent.ts',
  'GltfSchema.ts',
  'GltfUvSemanticPlanner.ts',
]);

/**
 * Manual chunks are deliberately limited to dependency families that already
 * form a hard boundary. Architecture naming is handled separately so naming
 * evidence never changes lazy-loading behavior on its own.
 */
export function editorBundleManualChunk(moduleId) {
  const id = normalizeModuleId(moduleId);
  if (id === '\0commonjsHelpers.js') return 'commonjs-runtime';
  // Theme restoration runs before the first custom-element paint. Keep this
  // tiny storage adapter separate from the deferred localization/options chunk.
  if (id.endsWith('/editor/src/infra/theme/editorTheme.ts')
    || id === '/src/infra/theme/editorTheme.ts') {
    return 'editor-theme';
  }
  if (id.endsWith('/editor/src/infra/options/editorOptions.ts')
    || id === '/src/infra/options/editorOptions.ts') {
    return 'editor-localization';
  }
  if (id.endsWith('/editor/src/script/scriptEditor.ts')
    || id.endsWith('/editor/src/script/scriptSyntaxHighlighter.ts')
    || id === '/src/script/scriptEditor.ts'
    || id === '/src/script/scriptSyntaxHighlighter.ts') {
    return 'script-authoring';
  }
  // This tiny domain module is shared by the editor and player entries. Keep
  // it independent so Rollup cannot coalesce it with the renderer closure
  // shared by player.ts and the lazy viewport startup entry.
  if (id.endsWith('/editor/src/domain/settings/globalSettings.ts')
    || id === '/src/domain/settings/globalSettings.ts') {
    return 'editor-settings';
  }
  // Keep the animation parser beside scene deserialization. In the monorepo
  // Rollup naturally placed these modules in the same shared chunk; package
  // source-condition resolution otherwise makes the parser content-only and
  // shifts an existing cost across capability budget boundaries.
  if (id.endsWith('/editor/src/domain/scene/deserialization.ts')
    || id === '/src/domain/scene/deserialization.ts'
    || id.includes('/node_modules/@haiyue/animation-spec/src/')) {
    return 'scene-deserialization';
  }
  // Physics is a real lazy contribution. Preserve its existing isolated
  // backend boundary while replacing the misleading feature-derived name.
  if (id.includes('/node_modules/box2d.ts/')
    || id.endsWith('/engine/src/physics/Box2D.ts')
    || id.endsWith('/engine/src/physics/Box2DPhysics2DBackend.ts')) {
    return 'physics';
  }
  if (isSharedRenderingFoundation(id)) return 'runtime-rendering-shared';
  return undefined;
}

export function editorBundleChunkFileName(chunkInfo) {
  const ids = Array.isArray(chunkInfo?.moduleIds)
    ? chunkInfo.moduleIds.map(normalizeModuleId)
    : [];
  const optionalCapabilities = new Set(
    ids.map(optionalRuntimeCapability).filter(Boolean),
  );
  if (optionalCapabilities.size === 1) {
    return `chunks/${[...optionalCapabilities][0]}-[hash].js`;
  }
  if (optionalCapabilities.size > 1) return 'chunks/optional-runtime-shared-[hash].js';
  if (ids.some(id => id.endsWith('editor/src/infra/app/mainEditorApp.ts')
    || id.endsWith('src/infra/app/mainEditorApp.ts'))) {
    return 'chunks/editor-shell-[hash].js';
  }
  if (ids.some(id => id.includes('/editor/src/export/projectZip.ts')
    || id.includes('/node_modules/jszip/'))) {
    return 'chunks/import-export-archive-[hash].js';
  }
  if (ids.some(id => id.includes('/editor/src/export/texturePipeline.ts'))) {
    return 'chunks/import-export-textures-[hash].js';
  }
  if (ids.some(isExportCodegen)) return 'chunks/import-export-codegen-[hash].js';
  if (ids.some(id => id.endsWith('/editor/src/script/scriptSyntaxHighlighter.ts')
    || id.endsWith('/editor/src/script/scriptEditor.ts'))) {
    return 'chunks/script-authoring-[hash].js';
  }
  if (ids.some(id => id.endsWith('/editor/src/player/PlayerDebugRuntime.ts'))) {
    return 'chunks/player-debug-[hash].js';
  }
  if (ids.some(id => id.endsWith('/editor/src/player/PlayerShadowRuntime.ts'))) {
    return 'chunks/player-shadow-[hash].js';
  }
  if (ids.some(id => id.endsWith('/editor/src/domain/runtime/RuntimeOwnershipScope.ts')
    || id.endsWith('/engine/src/systems/Render3DSystem.ts'))) {
    return 'chunks/runtime-core-rendering-[hash].js';
  }
  if (ids.some(id => id.endsWith('/editor/src/domain/scene/typedArraySerialization.ts')
    || id.endsWith('/engine/src/assets/AssetManager.ts'))) {
    return 'chunks/runtime-core-assets-[hash].js';
  }
  return 'chunks/[name]-[hash].js';
}

export function optionalRuntimeCapability(moduleId) {
  const id = normalizeModuleId(moduleId);
  if (isPhysicsRuntime(id)) return 'physics';
  if (isGltfRuntime(id)) return 'gltf';
  if (isSpineRuntime(id)) return 'spine';
  if (isTilemapRuntime(id)) return 'tilemap';
  if (isTweenRuntime(id)) return 'tween';
  return null;
}

function isPhysicsRuntime(id) {
  return id.includes('/node_modules/box2d.ts/')
    || id.endsWith('/node_modules/@haiyue/engine/dist/physics.js')
    || id.endsWith('/engine/src/physics/Box2D.ts')
    || id.endsWith('/engine/src/physics/Box2DPhysics2DBackend.ts')
    || id.endsWith('/engine/src/physics/Physics2DSystem.ts')
    || id.endsWith('/engine/src/physics/Physics3DSystem.ts')
    || id.endsWith('/editor/src/infra/app/configuredSystemRuntimeContribution.ts');
}

function isGltfRuntime(id) {
  if (id.endsWith('/node_modules/@haiyue/extensions/dist/gltf.js')) return true;
  if (id.endsWith('/extensions/src/gltf.ts')) return true;
  const marker = '/extensions/src/gltf/';
  const offset = id.lastIndexOf(marker);
  if (offset < 0) return false;
  const file = id.slice(offset + marker.length);
  return !GLTF_CORE_MODULES.includes(file);
}

function isSpineRuntime(id) {
  return id.endsWith('/node_modules/@haiyue/extensions/dist/spine.js')
    || id.endsWith('/extensions/src/spine.ts')
    || (id.includes('/extensions/src/spine/') && !id.endsWith('/Spine2DComponent.ts'))
    || id.endsWith('/extensions/src/shaders/spine2d.wgsl');
}

function isTilemapRuntime(id) {
  return id.endsWith('/node_modules/@haiyue/extensions/dist/tilemap.js')
    || id.endsWith('/extensions/src/tilemap.ts')
    || (id.includes('/extensions/src/tilemap/') && !id.endsWith('/Tilemap2DComponent.ts'))
    || id.endsWith('/extensions/src/shaders/tilemap2d.wgsl');
}

function isTweenRuntime(id) {
  return id.endsWith('/node_modules/@haiyue/extensions/dist/tween.js')
    || id.endsWith('/extensions/src/tween.ts')
    || id.endsWith('/extensions/src/tween/Tween2DSystem.ts')
    || id.endsWith('/editor/src/infra/app/tweenEditorContribution.ts');
}

function isExportCodegen(id) {
  return id.includes('/editor/src/export/projectTemplate.ts')
    || id.includes('/editor/src/export/dependencyGraph.ts')
    || id.includes('/editor/src/export/RuntimeImportPlanner.ts')
    || id.includes('/editor/src/export/RuntimeSourceGenerator.ts')
    || id.includes('/editor/src/export/runtimeDataPrecompile.ts')
    || id.includes('/editor/src/export/templates/');
}

function isSharedRenderingFoundation(id) {
  return [
    '/engine/src/math/constants.ts',
    '/engine/src/renderer/BaseRenderer.ts',
    '/engine/src/renderer/PipelineWarmup.ts',
    '/engine/src/renderer/RendererResourceCache.ts',
    '/engine/src/renderer/SharedGeometry3DGPUCache.ts',
    '/engine/src/renderer/ZeroVectorCache.ts',
    '/engine/src/renderer/gpuDescriptors.ts',
    '/engine/src/renderer/pipelineKey.ts',
    '/engine/src/renderer/utils.ts',
    '/engine/src/shader/BuiltinRenderShader.ts',
    '/engine/src/shader/WgslFeatureComposer.ts',
    '/engine/src/shaders/generated/2d-ui-artifact.generated.ts',
    '/engine/src/shaders/generated/2d-ui-bitmap-text.generated.wgsl',
    '/engine/src/shaders/generated/2d-ui-gui-image.generated.wgsl',
    '/engine/src/shaders/generated/2d-ui-gui-shape.generated.wgsl',
    '/engine/src/shaders/generated/2d-ui-gui-text.generated.wgsl',
    '/engine/src/shaders/generated/2d-ui-mesh2d.generated.wgsl',
    '/engine/src/shaders/generated/2d-ui-particle2d.generated.wgsl',
    '/engine/src/shaders/generated/2d-ui-radial-shadow.generated.wgsl',
    '/engine/src/systems/worldMatrix.ts',
  ].some(suffix => id.endsWith(suffix));
}

function normalizeModuleId(id) {
  return typeof id === 'string' ? id.replaceAll('\\', '/') : '';
}
