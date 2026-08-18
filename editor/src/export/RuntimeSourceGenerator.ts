import type { RuntimeDependencyGraph } from './dependencyGraph';
import { createComponentImportBlock, createEngineImportBlock } from './RuntimeImportPlanner';
import { RUNTIME_DESERIALIZATION_TS, RUNTIME_PLAYER_TS } from './templates/runtimeProjectTemplates';

export function createRuntimePlayerTs(dependencyGraph: RuntimeDependencyGraph): string {
  const playerEngineImports = [...new Set([...dependencyGraph.engineImports, 'System'])].sort();
  return RUNTIME_PLAYER_TS
    .replace('__ENGINE_IMPORT_BLOCK__', createEngineImportBlock(playerEngineImports))
    .replace('__COMPONENT_IMPORT_BLOCK__', createComponentImportBlock(dependencyGraph.runtimeImports))
    .replace('__INSTALL_RUNTIME_SYSTEMS__', createInstallRuntimeSystemsBody(dependencyGraph))
    .replace('__HAS_BLINN_PHONG_HELPER__', dependencyGraph.systems.includes('BlinnPhongRenderSystem') ? HAS_BLINN_PHONG_HELPER : '')
    .replace('__HAS_TOON_HELPER__', dependencyGraph.systems.includes('ToonRenderSystem') ? HAS_TOON_HELPER : '')
    .replace('__HAS_RADIAL_SHADOW_HELPER__', dependencyGraph.systems.includes('RadialShadowRenderFeature') ? HAS_RADIAL_SHADOW_HELPER : '')
    .replace('__PHYSICS_API_HELPERS__', createPhysicsApiHelpers(dependencyGraph))
    .replace('__COMPONENT_API_ENTRIES__', createComponentApiEntries(dependencyGraph))
    .replace('__SET_TEXT_BODY__', createSetTextBody(dependencyGraph));
}

export function createRuntimeDeserializationTs(dependencyGraph: RuntimeDependencyGraph): string {
  return RUNTIME_DESERIALIZATION_TS
    .replace('__ENGINE_IMPORT_BLOCK__', createEngineImportBlock(dependencyGraph.engineImports))
    .replace('__COMPONENT_IMPORT_BLOCK__', createComponentImportBlock(dependencyGraph.runtimeImports))
    .replace('__OPTIONAL_COMPONENT_CASES__', createOptionalComponentCases(dependencyGraph))
    .replace('__CANVAS_TEXT_BINDING__', createCanvasTextBinding(dependencyGraph));
}

function createOptionalComponentCases(graph: RuntimeDependencyGraph): string {
  const cases: string[] = [];
  const contributedTypes = new Set(Object.keys(graph.deserializers));
  for (const type of [...contributedTypes].sort()) {
    cases.push(`    case ${JSON.stringify(type)}:
      return ${graph.deserializers[type]};`);
  }
  return cases.join('\n');
}

function createCanvasTextBinding(graph: RuntimeDependencyGraph): string {
  if (!graph.features.hasCanvasText) return '';
  return `  const canvasText = entity.getComponent(CanvasTextComponent);
  const mesh = entity.getComponent(Mesh3D);
  if (canvasText && mesh?.material instanceof CssMaterial) canvasText.material = mesh.material;`;
}

function createPhysicsApiHelpers(graph: RuntimeDependencyGraph): string {
  if (!graph.engineImports.includes('Physics2DBody') || !graph.engineImports.includes('Physics2DSystem')) {
    return `function createPhysicsApi(_runtime: PlayerRuntime): Record<string, unknown> {
  return {};
}`;
  }
  return `function getPhysicsBody(target: Entity | Physics2DBody | number | string | null | undefined, runtime: PlayerRuntime): Physics2DBody | null {
  if (!target) return null;
  if (target instanceof Physics2DBody) return target;
  const entity = target instanceof Entity ? target : findEntity(runtime.world, target);
  return entity?.getComponent(Physics2DBody) ?? null;
}

function createPhysicsApi(runtime: PlayerRuntime): Record<string, unknown> {
  return {
    getSystem: () => findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null,
    body: (target: Entity | Physics2DBody | number | string) => getPhysicsBody(target, runtime),
    hitTest: (x: number, y: number) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      return physics?.hitTest(runtime.world, x, y) ?? null;
    },
    applyImpulse: (target: Entity | Physics2DBody | number | string, x: number, y: number) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      const body = getPhysicsBody(target, runtime);
      return !!physics && !!body && physics.applyLinearImpulse(body, x, y);
    },
    applyForce: (target: Entity | Physics2DBody | number | string, x: number, y: number) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      const body = getPhysicsBody(target, runtime);
      return !!physics && !!body && physics.applyForce(body, x, y);
    },
    getVelocity: (target: Entity | Physics2DBody | number | string, out: { x: number; y: number } = { x: 0, y: 0 }) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      const body = getPhysicsBody(target, runtime);
      return physics && body && physics.getLinearVelocity(body, out) ? out : null;
    },
    getMass: (target: Entity | Physics2DBody | number | string) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      const body = getPhysicsBody(target, runtime);
      return physics && body ? physics.getBodyMass(body) : null;
    },
    setVelocity: (target: Entity | Physics2DBody | number | string, x: number, y: number) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      const body = getPhysicsBody(target, runtime);
      return !!physics && !!body && physics.setLinearVelocity(body, x, y);
    },
    setAngularVelocity: (target: Entity | Physics2DBody | number | string, velocity: number) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      const body = getPhysicsBody(target, runtime);
      return !!physics && !!body && physics.setAngularVelocity(body, velocity);
    },
    teleport: (target: Entity | Physics2DBody | number | string, x: number, y: number, angle?: number) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      const body = getPhysicsBody(target, runtime);
      return !!physics && !!body && physics.teleportBody(body, x, y, angle);
    },
    stop: (target: Entity | Physics2DBody | number | string) => {
      const physics = findSystem(runtime.world, Physics2DSystem) as Physics2DSystem | null;
      const body = getPhysicsBody(target, runtime);
      if (!physics || !body) return false;
      return physics.setLinearVelocity(body, 0, 0) && physics.setAngularVelocity(body, 0);
    },
  };
}`;
}

function createSetTextBody(graph: RuntimeDependencyGraph): string {
  if (!graph.features.hasCanvasText) {
    return `      void entityOrId;
      void text;
      return false;`;
  }
  return `      const entity = entityOrId instanceof Entity ? entityOrId : findEntity(runtime.world, entityOrId);
      const canvasText = entity?.getComponent(CanvasTextComponent);
      if (!canvasText) return false;
      canvasText.text = text;
      return true;`;
}

function createInstallRuntimeSystemsBody(graph: RuntimeDependencyGraph): string {
  const lines: string[] = [];
  lines.push(...graph.systemInstallers);
  if (graph.systems.includes('Render3DSystem')) {
    lines.push(`  let cameraEntity = findCameraEntity(world);
  if (!cameraEntity) {
    cameraEntity = new Entity('Camera');
    cameraEntity.addComponent(new Camera3D({ type: 'perspective', fov: Math.PI / 4, near: 0.1, far: 100 }));
    cameraEntity.addComponent(new SphericalTransform3D({ radius: 8, theta: Math.PI / 4, phi: Math.PI / 3 }));
    world.addEntity(cameraEntity);
  }

  const render3DSystem = new Render3DSystem(engine, cameraEntity, { loadOp: 'clear', priority: 0, reverseZ: engine.reverseZ });
  addRenderSystem(
    render3DSystem,
    { pass: 'shared', loadOp: 'clear' },
  );`);
  }
  if (graph.systems.includes('BlinnPhongRenderSystem')) lines.push(`  if (cameraEntity && hasBlinnPhongMesh(world)) world.addSystem(new BlinnPhongRenderSystem(engine, cameraEntity, { priority: -1, render3DSystem }));`);
  if (graph.systems.includes('ToonRenderSystem')) lines.push(`  if (cameraEntity && hasToonMesh(world)) world.addSystem(new ToonRenderSystem(engine, cameraEntity, { priority: -1, render3DSystem }));`);
  if (graph.systems.includes('RadialShadowRenderFeature')) lines.push(`  if (cameraEntity && hasRadialShadowMesh(world) && !(scene.systems ?? []).some(config => !config.disabled && config.type === 'RadialShadowRenderFeature')) addRenderSystem(new RadialShadowRenderFeature(engine, cameraEntity, { loadOp: 'load', priority: 20 }), { pass: 'shared', loadOp: 'load' });`);
  if (graph.systems.includes('InstancedMesh3DRenderSystem')) lines.push(`  if (cameraEntity && hasComponentType(world, InstancedMesh3D)) {
    const instancedSystem = new InstancedMesh3DRenderSystem(engine, cameraEntity, { loadOp: 'load' });
    instancedSystem.priority = 2;
    addRenderSystem(instancedSystem, { pass: 'shared', loadOp: 'load' });
  }`);
  if (graph.systems.includes('Physics2DTo3DTransformSyncSystem')) lines.push(`  if (hasComponentType(world, Physics2DTo3DTransformSync)) world.addSystem(new Physics2DTo3DTransformSyncSystem({ priority: 0.5 }));`);

  const twoDSystemLines: string[] = [];
  if (graph.systems.includes('Mesh2DRenderSystem')) twoDSystemLines.push(`  if (hasComponentType(world, Mesh2D)) addRenderSystem(new Mesh2DRenderSystem(engine, camera2DEntity, { loadOp: 'load', priority: 3 }), { pass: 'shared', loadOp: 'load' });`);
  if (twoDSystemLines.length > 0) {
    lines.push(`  const camera2DEntity = findCamera2DEntity(world);
  if (camera2DEntity) {
    applyViewportSettingsToCamera2D(camera2DEntity, scene.globals);
${twoDSystemLines.map(line => `  ${line}`).join('\n')}
  }`);
  }
  const configuredSystemLines: string[] = [];
  if (graph.systems.includes('Physics2DSystem')) {
    configuredSystemLines.push(`    if (config.type === 'Physics2DSystem') {
      world.addSystem(new Physics2DSystem({
        gravity: config.gravity,
        pixelsPerMeter: config.pixelsPerMeter,
        fixedTimeStep: config.fixedTimeStep,
        maxSubSteps: config.maxSubSteps,
        velocityIterations: config.velocityIterations,
        positionIterations: config.positionIterations,
        syncStaticBodiesFromTransform: config.syncStaticBodiesFromTransform,
        priority: config.priority,
      }));
      continue;
    }`);
  }
  if (graph.systems.includes('RadialShadowRenderFeature')) {
    configuredSystemLines.push(`    if (config.type === 'RadialShadowRenderFeature') {
      const radialCameraEntity = findCameraEntity(world);
      if (radialCameraEntity) {
        addRenderSystem(new RadialShadowRenderFeature(engine, radialCameraEntity, {
          loadOp: config.loadOp,
          priority: config.priority,
        }), { pass: 'shared', loadOp: config.loadOp });
      }
      continue;
    }`);
  }
  if (configuredSystemLines.length > 0) {
    lines.push(`  for (const config of scene.systems ?? []) {
    if (config.disabled) continue;
${configuredSystemLines.join('\n')}
  }`);
  }

  return lines.length > 0 ? lines.join('\n') : '  void world;\n  void engine;\n  void scene;';
}

function createComponentApiEntries(graph: RuntimeDependencyGraph): string {
  const entries = new Set<string>([
    ...graph.engineImports,
    ...graph.runtimeImports.flatMap(item => item.names).filter(name => name.endsWith('Component')),
  ]);
  const hidden = new Set(['Component', 'InputMap', 'Material', 'RenderIntegration', 'RenderPipelineEntryOptions', 'ScriptResource', 'System', 'HaiyueEngine', 'World']);
  return [...entries]
    .filter(name => !hidden.has(name) && (!name.endsWith('System') || name === 'Physics2DSystem' || name === 'InstancedMesh3DRenderSystem'))
    .sort()
    .map(name => `    ${name},`)
    .join('\n');
}

const HAS_BLINN_PHONG_HELPER = String.raw`function hasBlinnPhongMesh(world: World): boolean {
  for (const entity of world.entities.values()) {
    const mesh = entity.getComponent(Mesh3D);
    if (mesh?.material instanceof BlinnPhongMaterial) return true;
  }
  return false;
}
`;

const HAS_TOON_HELPER = String.raw`function hasToonMesh(world: World): boolean {
  for (const entity of world.entities.values()) {
    const mesh = entity.getComponent(Mesh3D);
    if (mesh?.material instanceof ToonMaterial) return true;
  }
  return false;
}
`;

const HAS_RADIAL_SHADOW_HELPER = String.raw`function hasRadialShadowMesh(world: World): boolean {
  for (const entity of world.entities.values()) {
    const mesh = entity.getComponent(Mesh3D);
    if (mesh?.material.type === 'radial-shadow') return true;
  }
  return false;
}
`;
