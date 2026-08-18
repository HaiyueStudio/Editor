import type { RuntimeEntity, RuntimeExportWarning, RuntimeScene } from './RuntimeSceneContract';
import type { RuntimeComponentContribution, RuntimeExportImport } from '../types';

export interface RuntimeDependencyGraph {
  componentTypes: string[];
  materialTypes: string[];
  engineImports: string[];
  runtimeImports: RuntimeExportImport[];
  deserializers: Readonly<Record<string, string>>;
  systemInstallers: string[];
  systems: string[];
  features: {
    has2D: boolean;
    has3D: boolean;
    hasScripts: boolean;
    hasPrefabs: boolean;
    hasCanvasText: boolean;
    hasExternalScriptImports: boolean;
  };
  warnings: RuntimeExportWarning[];
}

const ENGINE_COMPONENT_IMPORTS: Record<string, string[]> = {
  AmbientLight: ['AmbientLight'],
  BasisTransform3D: ['BasisTransform3D'],
  Camera2D: ['Camera2D'],
  Camera3D: ['Camera3D'],
  CartesianTransform3D: ['CartesianTransform3D'],
  DataComponent: ['DataComponent'],
  DirectionalLight: ['DirectionalLight'],
  EnvironmentLight: ['EnvironmentLight'],
  Fog: ['Fog'],
  KeyboardComponent: ['KeyboardComponent'],
  Mesh2D: ['Geometry2D', 'Material2D', 'Mesh2D', 'Mesh2DRenderSystem'],
  Mesh3D: ['Mesh3D', 'Render3DSystem'],
  MeshHelper: ['MeshHelper'],
  Physics2DBody: ['Physics2DBody', 'Physics2DSystem'],
  Physics2DJoint: ['Physics2DJoint', 'Physics2DSystem'],
  Physics2DTo3DTransformSync: ['Physics2DTo3DTransformSync', 'Physics2DTo3DTransformSyncSystem'],
  PointLight: ['PointLight'],
  ScriptComponent: ['ScriptComponent', 'ScriptResource'],
  SphericalTransform3D: ['SphericalTransform3D'],
  Transform2D: ['Transform2D'],
  Transform3D: ['Transform3D'],
};

const MATERIAL_IMPORTS: Record<string, string[]> = {
  BasicMaterial: ['BasicMaterial'],
  BlinnPhongMaterial: ['BlinnPhongMaterial', 'BlinnPhongRenderSystem'],
  CssMaterial: ['CssMaterial', 'Mesh3D', 'Render3DSystem'],
  DepthMaterial: ['DepthMaterial'],
  NormalMaterial: ['NormalMaterial'],
  PbrMaterial: ['PbrMaterial'],
  RadialShadowMaterial: ['RadialShadowMaterial', 'RadialShadowRenderFeature'],
  ToonMaterial: ['ToonMaterial', 'ToonRenderSystem'],
};

const SCRIPT_IMPORT_PATTERN = /\b(?:import\s*(?:\(|[\s\w*{},]*from\s*)|export\s+[\s\w*{},]*from\s*|require\s*\()\s*['"`]/;
const SCRIPT_UNSUPPORTED_DYNAMIC_PATTERN = /\b(?:import\.meta|eval\s*\(|Function\s*\()/;

export function analyzeRuntimeDependencies(
  scene: RuntimeScene,
  contributions: readonly RuntimeComponentContribution[] = [],
): RuntimeDependencyGraph {
  const componentTypes = new Set<string>();
  const materialTypes = new Set<string>();
  const engineImports = new Set<string>([
    'AmbientLight',
    'BasicMaterial',
    'BasisTransform3D',
    'BlinnPhongMaterial',
    'Camera2D',
    'Camera3D',
    'CartesianTransform3D',
    'ColorSRGB',
    'Component',
    'CssMaterial',
    'DataComponent',
    'DepthMaterial',
    'DirectionalLight',
    'EnvironmentLight',
    'Fog',
    'Entity',
    'Geometry2D',
    'Geometry3D',
    'InputMap',
    'InstancedMaterial',
    'InstancedMesh3D',
    'InstancedMesh3DRenderSystem',
    'createRoundedBox3D',
    'KeyboardComponent',
    'Material',
    'Material2D',
    'Mesh2D',
    'Mesh3D',
    'MeshHelper',
    'NormalMaterial',
    'PointLight',
    'ScriptComponent',
    'ScriptResource',
    'SphericalTransform3D',
    'Transform2D',
    'Transform3D',
    'HaiyueEngine',
    'World',
  ]);
  const systems = new Set<string>();
  const warnings: RuntimeExportWarning[] = [];
  const runtimeImports = new Map<string, Set<string>>();
  const deserializers: Record<string, string> = {};
  const systemInstallers: string[] = [];

  for (const entity of scene.entities ?? []) collectEntityComponentTypes(entity, componentTypes);
  for (const prefab of scene.resources.prefabs ?? []) collectEntityComponentTypes(prefab.root, componentTypes);
  for (const material of scene.resources.materials ?? []) materialTypes.add(material.type);

  for (const type of componentTypes) {
    for (const name of ENGINE_COMPONENT_IMPORTS[type] ?? []) engineImports.add(name);
    const contribution = resolveRuntimeContribution(contributions, type);
    if (contribution) {
      for (const name of contribution.engineImports ?? []) engineImports.add(name);
      for (const name of contribution.systems ?? []) systems.add(name);
      for (const item of contribution.imports ?? []) {
        const names = runtimeImports.get(item.from) ?? new Set<string>();
        for (const name of item.names) names.add(name);
        runtimeImports.set(item.from, names);
      }
      if (contribution.deserializeExpression) deserializers[type] = contribution.deserializeExpression;
      if (contribution.installSystems) systemInstallers.push(contribution.installSystems);
    }
  }
  for (const type of materialTypes) {
    for (const name of MATERIAL_IMPORTS[type] ?? []) engineImports.add(name);
  }

  const contributedRuntime = [...componentTypes]
    .map(type => resolveRuntimeContribution(contributions, type))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const has2D = componentTypes.has('Camera2D') || componentTypes.has('Mesh2D') || contributedRuntime.some(item => item.has2D === true);
  const has3D = componentTypes.has('Camera3D') || componentTypes.has('Mesh3D') || componentTypes.has('InstancedMesh3D') || componentTypes.has('MeshHelper') || componentTypes.has('AmbientLight') || componentTypes.has('DirectionalLight') || componentTypes.has('EnvironmentLight') || componentTypes.has('Fog') || componentTypes.has('PointLight') || contributedRuntime.some(item => item.has3D === true);
  if (has3D || materialTypes.has('CssMaterial')) {
    engineImports.add('Camera3D');
    engineImports.add('Render3DSystem');
    engineImports.add('SphericalTransform3D');
    systems.add('Render3DSystem');
  }
  if (materialTypes.has('BlinnPhongMaterial')) systems.add('BlinnPhongRenderSystem');
  if (materialTypes.has('ToonMaterial')) systems.add('ToonRenderSystem');
  if (materialTypes.has('RadialShadowMaterial')) {
    engineImports.add('RadialShadowRenderFeature');
    systems.add('RadialShadowRenderFeature');
  }
  if (componentTypes.has('InstancedMesh3D')) systems.add('InstancedMesh3DRenderSystem');
  if (componentTypes.has('Mesh2D')) systems.add('Mesh2DRenderSystem');
  if (componentTypes.has('Physics2DBody') || componentTypes.has('Physics2DJoint')) systems.add('Physics2DSystem');
  if (componentTypes.has('Physics2DTo3DTransformSync')) systems.add('Physics2DTo3DTransformSyncSystem');
  for (const system of scene.systems ?? []) {
    if (system.disabled) continue;
    systems.add(system.type);
    if (system.type === 'Physics2DSystem') engineImports.add('Physics2DSystem');
    if (system.type === 'RadialShadowRenderFeature') {
      engineImports.add('RadialShadowMaterial');
      engineImports.add('RadialShadowRenderFeature');
    }
  }

  const hasScripts = componentTypes.has('ScriptComponent') || (scene.resources.scripts?.length ?? 0) > 0;
  if (hasScripts) {
    engineImports.add('ScriptComponent');
    engineImports.add('ScriptResource');
    engineImports.add('Physics2DBody');
    engineImports.add('Physics2DSystem');
    engineImports.add('InstancedMaterial');
    engineImports.add('InstancedMesh3D');
    engineImports.add('InstancedMesh3DRenderSystem');
    engineImports.add('createRoundedBox3D');
    warnings.push({
      code: 'script-dynamic-dependency-risk',
      message: 'Runtime scripts use injected APIs only during dependency pruning. Classes not used by the exported scene may not be available in script api.read.components.',
    });
  }

  const hasExternalScriptImports = hasUnsupportedScriptImports(scene, warnings);

  return {
    componentTypes: [...componentTypes].sort(),
    materialTypes: [...materialTypes].sort(),
    engineImports: [...engineImports].sort(),
    runtimeImports: [...runtimeImports.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([from, names]) => ({ from, names: [...names].sort() })),
    deserializers,
    systemInstallers,
    systems: [...systems].sort(),
    features: {
      has2D,
      has3D,
      hasScripts,
      hasPrefabs: (scene.resources.prefabs?.length ?? 0) > 0 || componentTypes.has('PrefabInstance'),
      hasCanvasText: componentTypes.has('CanvasTextComponent'),
      hasExternalScriptImports,
    },
    warnings,
  };
}

function resolveRuntimeContribution(
  contributions: readonly RuntimeComponentContribution[],
  type: string,
) {
  for (let index = contributions.length - 1; index >= 0; index--) {
    const contribution = contributions[index];
    if (contribution?.type === type && contribution.runtimeExport) return contribution.runtimeExport;
  }
  return null;
}

function collectEntityComponentTypes(entity: RuntimeEntity, componentTypes: Set<string>): void {
  for (const component of entity.components ?? []) componentTypes.add(component.type);
  for (const child of entity.children ?? []) collectEntityComponentTypes(child, componentTypes);
}

function hasUnsupportedScriptImports(scene: RuntimeScene, warnings: RuntimeExportWarning[]): boolean {
  let hasUnsupportedImport = false;
  for (const script of scene.resources.scripts ?? []) {
    for (const [lifecycle, code] of Object.entries(script.scripts ?? {})) {
      if (!SCRIPT_IMPORT_PATTERN.test(code)) continue;
      hasUnsupportedImport = true;
      warnings.push({
        code: 'unsupported-script-import',
        message: `Script ${script.name}.${lifecycle} contains import/export/require. Exported runtime scripts should use injected APIs only.`,
        path: `script:${script.name}.${lifecycle}`,
      });
    }
    for (const [lifecycle, code] of Object.entries(script.scripts ?? {})) {
      if (!SCRIPT_UNSUPPORTED_DYNAMIC_PATTERN.test(code)) continue;
      hasUnsupportedImport = true;
      warnings.push({
        code: 'unsupported-script-dynamic-code',
        message: `Script ${script.name}.${lifecycle} contains import.meta, eval(), or Function(). Exported runtime scripts should use static injected APIs only.`,
        path: `script:${script.name}.${lifecycle}`,
      });
    }
  }
  return hasUnsupportedImport;
}
