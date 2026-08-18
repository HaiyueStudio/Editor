import type { RuntimeExportImport } from '../types';

function formatNamedImport(names: string[]): string {
  return names.map(name => `  ${name},`).join('\n');
}

const ROOT_GOLDEN_PATH_IMPORTS = new Set([
  'BasicMaterial', 'Camera2D', 'Camera3D', 'CartesianTransform3D', 'ColorSRGB',
  'Component', 'createBox3D', 'createPlane3D', 'createSphere3D', 'DirectionalLight',
  'EngineError', 'EngineErrorCode', 'Entity', 'EnvironmentLight', 'Geometry2D',
  'Geometry3D', 'HaiyueEngine', 'HaiyueEngineOptions', 'Material2D', 'Mesh2D',
  'Mesh3D', 'OrbitControl', 'PbrMaterial', 'RenderProfileName', 'Scene', 'SceneOptions',
  'SphericalTransform3D', 'System', 'Transform2D', 'World',
]);

const ENGINE_IMPORT_MODULES: Readonly<Record<string, string>> = Object.freeze({
  AmbientLight: '@haiyue/engine/lighting',
  BasisTransform3D: '@haiyue/engine/components',
  BlinnPhongMaterial: '@haiyue/engine/material',
  BlinnPhongRenderSystem: '@haiyue/engine/systems',
  CssMaterial: '@haiyue/engine/material',
  DataComponent: '@haiyue/engine/components',
  DepthMaterial: '@haiyue/engine/material',
  Fog: '@haiyue/engine/lighting',
  InputMap: '@haiyue/engine/input',
  InstancedMaterial: '@haiyue/engine/material',
  InstancedMesh3D: '@haiyue/engine/components',
  InstancedMesh3DRenderSystem: '@haiyue/engine/systems',
  KeyboardComponent: '@haiyue/engine/components',
  Material: '@haiyue/engine/material',
  Mesh2DRenderSystem: '@haiyue/engine/systems',
  MeshHelper: '@haiyue/engine/components',
  NormalMaterial: '@haiyue/engine/material',
  Physics2DBody: '@haiyue/engine/physics',
  Physics2DJoint: '@haiyue/engine/physics',
  Physics2DSystem: '@haiyue/engine/physics',
  Physics2DTo3DTransformSync: '@haiyue/engine/components',
  Physics2DTo3DTransformSyncSystem: '@haiyue/engine/systems',
  PointLight: '@haiyue/engine/lighting',
  RadialShadowMaterial: '@haiyue/engine/material',
  RadialShadowRenderFeature: '@haiyue/engine/systems',
  Render3DSystem: '@haiyue/engine/systems',
  ScriptComponent: '@haiyue/engine/components',
  ScriptResource: '@haiyue/engine/components',
  ToonMaterial: '@haiyue/engine/material',
  ToonRenderSystem: '@haiyue/engine/systems',
  Transform3D: '@haiyue/engine/components',
  createRoundedBox3D: '@haiyue/engine/geometry',
});

export function createEngineImportBlock(names: readonly string[]): string {
  const byModule = new Map<string, string[]>();
  for (const name of [...new Set(names)].sort()) {
    const moduleId = ROOT_GOLDEN_PATH_IMPORTS.has(name) ? '@haiyue/engine' : ENGINE_IMPORT_MODULES[name];
    if (!moduleId) throw new Error(`Runtime export has no stable engine subpath for ${name}.`);
    const imports = byModule.get(moduleId);
    if (imports) imports.push(name);
    else byModule.set(moduleId, [name]);
  }
  return [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moduleId, moduleNames]) => `import {\n${formatNamedImport(moduleNames)}\n} from '${moduleId}';\n`)
    .join('');
}

export function createComponentImportBlock(runtimeImports: readonly RuntimeExportImport[]): string {
  if (runtimeImports.length === 0) return '';
  const byModule = new Map<string, string[]>();
  for (const item of runtimeImports) {
    const imports = byModule.get(item.from);
    if (imports) imports.push(...item.names);
    else byModule.set(item.from, [...item.names]);
  }
  return [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moduleId, moduleNames]) => `\nimport {\n${formatNamedImport([...new Set(moduleNames)].sort())}\n} from '${moduleId}';`)
    .join('');
}

