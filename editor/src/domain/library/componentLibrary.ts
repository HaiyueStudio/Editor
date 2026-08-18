import type {
  GEDropdownItem } from '@haiyue/ui';
import { AmbientLight, Fog, PointLight } from '@haiyue/engine/lighting';
import { BasisTransform3D, ClippingPlanes, DataComponent, KeyboardComponent, MeshHelper, ScriptComponent } from '@haiyue/engine/components';
import { Camera2D, Camera3D, CartesianTransform3D, Component, DirectionalLight, EnvironmentLight, Mesh2D, Mesh3D, SphericalTransform3D, Transform2D, type Entity, type System } from '@haiyue/engine';
import { type CssMaterialStyle } from '@haiyue/engine/material';
import { type RegistrationToken } from '@haiyue/engine/core';
import { Physics2DBody, Physics2DJoint, Physics2DTo3DTransformSync } from '@haiyue/engine/physics/components';
import type { RenderPipelineSystem } from '../../engine-adapter/EditorRenderProtocol';
import { CanvasText2DRenderSystem } from '@haiyue/extensions/canvas-text';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import { Grid2DComponent } from '@haiyue/extensions/grid';
import { createOptionalComponentDescriptors } from './optionalComponentManifest';
import type {
  ComponentDeserializationExtension,
  ComponentResourceUsageExtension,
  ComponentSerializationExtension,
  ComponentContribution,
  Disposable,
  EditorContribution,
  EditorComponentDescriptor,
  RuntimeComponentContribution,
  ViewportSystemInstallContext,
} from '../../types';

export interface EditorComponentLibrary extends ComponentSerializationExtension, ComponentDeserializationExtension, ComponentResourceUsageExtension {
  name: string;
  components?: EditorComponentDescriptor[];
  contributions?: readonly ComponentContribution[];
  getContributions?: () => readonly ComponentContribution[];
  cloneComponent?: (component: Component) => Component | null;
  installViewportSystems?: (context: ViewportSystemInstallContext) => Disposable | void;
}

type ViewportRenderSystem = System & RenderPipelineSystem & {
  autoUpdate: boolean;
  setCameraEntity?: (camera2DEntity: ComponentLibraryViewportCameraEntity) => unknown;
};

type ComponentLibraryViewportCameraEntity = ViewportSystemInstallContext['camera2DEntity'];

type ViewportRenderSystemConstructor<T extends ViewportRenderSystem> = new (...args: never[]) => T;

export interface ComponentLibraryRegistry {
  readonly libraries: EditorComponentLibrary[];
  register(library: EditorComponentLibrary): void;
  registerDescriptor(descriptor: EditorComponentDescriptor): RegistrationToken;
  registerContribution(contribution: EditorContribution): RegistrationToken;
  getContributions(): readonly ComponentContribution[];
  getDescriptors(): EditorComponentDescriptor[];
}

export interface BaseComponentDescriptorDeps {
  createDefaultMesh2DComponent: () => Mesh2D;
  createDefaultMeshComponent: () => Mesh3D;
  createDefaultScriptComponent: () => ScriptComponent;
}

export interface BuiltinComponentsLibraryDeps {
  getDefaultCanvasTextStyle: () => CssMaterialStyle;
}

export function createBaseComponentDescriptors(deps: BaseComponentDescriptorDeps): EditorComponentDescriptor[] {
  return [
    { name: 'AmbientLight', create: () => new AmbientLight() },
    { name: 'BasisTransform3D', create: () => new BasisTransform3D() },
    { name: 'Camera2D', create: () => new Camera2D() },
    { name: 'Camera3D', create: () => new Camera3D() },
    { name: 'CartesianTransform3D', create: () => new CartesianTransform3D() },
    {
      name: 'ClippingPlanes',
      create: () => new ClippingPlanes([{ normal: [1, 0, 0], constant: 0 }]),
    },
    { name: 'DataComponent', create: () => new DataComponent() },
    { name: 'DirectionalLight', create: () => new DirectionalLight() },
    { name: 'EnvironmentLight', create: () => new EnvironmentLight() },
    { name: 'Fog', create: () => new Fog() },
    { name: 'KeyboardComponent', create: () => new KeyboardComponent() },
    { name: 'Mesh2D', create: deps.createDefaultMesh2DComponent },
    { name: 'Mesh3D', create: deps.createDefaultMeshComponent },
    { name: 'MeshHelper', create: () => new MeshHelper() },
    { name: 'Physics2DBody', create: () => new Physics2DBody() },
    { name: 'Physics2DJoint', create: () => new Physics2DJoint({ bodyA: '', bodyB: '' }) },
    { name: 'Physics2DTo3DTransformSync', create: () => new Physics2DTo3DTransformSync() },
    { name: 'PointLight', create: () => new PointLight() },
    { name: 'ScriptComponent', create: deps.createDefaultScriptComponent },
    { name: 'SphericalTransform3D', create: () => new SphericalTransform3D() },
    { name: 'Transform2D', create: () => new Transform2D() },
    ...createOptionalComponentDescriptors(),
  ];
}

export function createComponentLibraryRegistry(baseDescriptors: EditorComponentDescriptor[]): ComponentLibraryRegistry {
  const descriptors: Array<{ descriptor: EditorComponentDescriptor; identity: symbol }> = [];
  const contributionRegistrations: Array<{ contribution: EditorContribution; identity: symbol }> = [];
  const libraries: EditorComponentLibrary[] = [];
  const getContributions = (): readonly ComponentContribution[] => [
    ...libraries
      .filter(library => library.name !== '@haiyue/editor-contributions')
      .flatMap(library => library.contributions ?? library.getContributions?.() ?? []),
    ...contributionRegistrations.flatMap(registration => registration.contribution.components ?? []),
  ];
  libraries.push(createContributionLibrary(getContributions));
  return {
    libraries,
    register(library) {
      libraries.push(library);
    },
    registerDescriptor(descriptor) {
      const registration = { descriptor, identity: Symbol('component-descriptor') };
      descriptors.push(registration);
      return registrationToken(() => removeIdentity(descriptors, registration.identity));
    },
    registerContribution(contribution) {
      const registration = { contribution, identity: Symbol('editor-contribution') };
      contributionRegistrations.push(registration);
      return registrationToken(() => removeIdentity(contributionRegistrations, registration.identity));
    },
    getContributions,
    getDescriptors() {
      const byName = new Map<string, EditorComponentDescriptor>();
      for (const descriptor of baseDescriptors) byName.set(descriptor.name, descriptor);
      for (const library of libraries) {
        for (const descriptor of library.components ?? []) byName.set(descriptor.name, descriptor);
      }
      for (const contribution of getContributions()) {
        byName.set(contribution.type, { name: contribution.type, create: contribution.create });
      }
      for (const { descriptor } of descriptors) byName.set(descriptor.name, descriptor);
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

function createContributionLibrary(getContributions: () => readonly ComponentContribution[]): EditorComponentLibrary {
  const resolveComponent = (component: Component): ComponentContribution | null => {
    const type = component.constructor.name;
    const contributions = getContributions();
    for (let index = contributions.length - 1; index >= 0; index--) {
      const contribution = contributions[index];
      if (contribution?.type === type) return contribution;
    }
    return null;
  };
  const resolveSerialized = (data: { type: string }): ComponentContribution | null => {
    const contributions = getContributions();
    for (let index = contributions.length - 1; index >= 0; index--) {
      const contribution = contributions[index];
      if (contribution?.type === data.type) return contribution;
    }
    return null;
  };
  return {
    name: '@haiyue/editor-contributions',
    getContributions,
    serializeComponent(component, options) {
      const contribution = resolveComponent(component);
      const serialized = contribution?.serialize(component, options);
      return isSerializedComponent(serialized) && serialized.type === contribution?.type
        ? serialized as ReturnType<NonNullable<ComponentSerializationExtension['serializeComponent']>>
        : null;
    },
    deserializeComponent(data) {
      return resolveSerialized(data)?.deserialize(data) ?? null;
    },
    cloneComponent(component) {
      const contribution = resolveComponent(component);
      return contribution?.clone?.(component) ?? null;
    },
    getIgnoredEntityChildren(entity) {
      const ignored: Entity[] = [];
      for (const component of entity.components.values()) {
        const contribution = resolveComponent(component);
        for (const child of contribution?.getIgnoredChildren?.(component) ?? []) ignored.push(child);
      }
      return ignored;
    },
    supportsComponentResourceUsage(component) {
      return resolveComponent(component)?.collectDependencies !== undefined;
    },
    collectComponentResourceUsage(component, context) {
      const contribution = resolveComponent(component);
      if (!contribution?.collectDependencies) return;
      const dependencies = contribution.collectDependencies(component, {
        resolveModelBySrc: src => context.resolveModelBySrc?.(src) ?? null,
      });
      for (const dependency of dependencies) context.addAssetId?.(dependency);
    },
    collectSerializedComponentResourceUsage(data, context) {
      const contribution = resolveSerialized(data);
      if (!contribution?.collectSerializedDependencies) return;
      const dependencies = contribution.collectSerializedDependencies(data, {
        resolveModelBySrc: src => context.resolveModelBySrc?.(src) ?? null,
      });
      for (const dependency of dependencies) context.addAssetId?.(dependency);
    },
    installViewportSystems(context) {
      const latestByType = new Map<string, ComponentContribution>();
      for (const contribution of getContributions()) {
        if (contribution.installViewport) latestByType.set(contribution.type, contribution);
      }
      const disposables: Disposable[] = [];
      for (const contribution of latestByType.values()) {
        const disposable = contribution.installViewport?.(context);
        if (disposable) disposables.push(disposable);
      }
      return disposables.length === 0 ? undefined : {
        dispose() {
          for (let index = disposables.length - 1; index >= 0; index--) disposables[index]?.dispose();
        },
      };
    },
  };
}

function registrationToken(cleanup: () => void): RegistrationToken {
  let active = true;
  return {
    get active() { return active; },
    unregister() {
      if (!active) return;
      active = false;
      cleanup();
    },
  };
}

function removeIdentity<T extends { identity: symbol }>(items: T[], identity: symbol): void {
  const index = items.findIndex(item => item.identity === identity);
  if (index >= 0) items.splice(index, 1);
}

function isSerializedComponent(value: unknown): value is { type: string; [key: string]: unknown } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function createBuiltinComponentsLibrary(deps: BuiltinComponentsLibraryDeps): EditorComponentLibrary {
  return {
    name: '@haiyue/extensions',
    contributions: [
      {
        type: 'CanvasTextComponent',
        create: () => new CanvasTextComponent({ text: 'Text', style: deps.getDefaultCanvasTextStyle() }),
        inspector: { fields: {} },
        serialize(component) {
          const value = component as CanvasTextComponent;
          return { type: 'CanvasTextComponent', text: value.text, style: { ...value.style } };
        },
        deserialize(data) {
          const value = data as { type?: unknown; text?: string; style?: CssMaterialStyle };
          if (value.type !== 'CanvasTextComponent') return null;
          return new CanvasTextComponent({
            ...(value.text === undefined ? {} : { text: value.text }),
            ...(value.style === undefined ? {} : { style: value.style }),
          });
        },
        clone: component => (component as CanvasTextComponent).clone(),
        installViewport(context) {
          return installViewportRenderSystem(
            context,
            CanvasText2DRenderSystem,
            () => new CanvasText2DRenderSystem(context.engine, context.camera2DEntity, { priority: 3, loadOp: 'load' }),
          );
        },
        runtimeExport: {
          imports: [{ from: '@haiyue/extensions/canvas-text', names: ['CanvasTextComponent', 'CanvasText2DRenderSystem'] }],
          systems: ['CanvasText2DRenderSystem'],
          deserializeExpression: 'new CanvasTextComponent({ text: data.text, style: data.style })',
          installSystems: `  const canvasTextCamera = findCamera2DEntity(world);
  if (canvasTextCamera && hasComponentType(world, CanvasTextComponent)) {
    applyViewportSettingsToCamera2D(canvasTextCamera, scene.globals);
    addRenderSystem(new CanvasText2DRenderSystem(engine, canvasTextCamera, { loadOp: 'load', priority: 4 }), { pass: 'shared', loadOp: 'load' });
  }`,
          has2D: true,
        },
      },
      {
        type: 'Grid2DComponent',
        create: () => new Grid2DComponent({ columns: 10, rows: 20, cellWidth: 32, cellHeight: 32 }),
        inspector: { fields: {} },
        serialize(component) {
          const value = component as Grid2DComponent;
          return {
            type: 'Grid2DComponent',
            columns: value.columns,
            rows: value.rows,
            cellWidth: value.cellWidth,
            cellHeight: value.cellHeight,
            originX: value.originX,
            originY: value.originY,
          };
        },
        deserialize(data) {
          const value = data as ConstructorParameters<typeof Grid2DComponent>[0] & { type?: unknown };
          return value.type === 'Grid2DComponent' ? new Grid2DComponent(value) : null;
        },
        clone: component => (component as Grid2DComponent).clone(),
        runtimeExport: {
          imports: [{ from: '@haiyue/extensions/grid', names: ['Grid2DComponent'] }],
          deserializeExpression: 'new Grid2DComponent(data)',
          has2D: true,
        },
      },
    ],
  };
}

function installViewportRenderSystem<T extends ViewportRenderSystem>(
  context: ViewportSystemInstallContext,
  constructor: ViewportRenderSystemConstructor<T>,
  createSystem: () => T,
): Disposable {
  const { world, camera2DEntity, registerRenderSystem } = context;
  let system = world.getSystem(constructor) as T | null;
  const created = system === null;
  if (!system) {
    system = createSystem();
    world.addSystem(system);
  }
  system.setCameraEntity?.(camera2DEntity);
  if (registerRenderSystem) {
    system.autoUpdate = false;
    registerRenderSystem(system);
  } else {
    system.autoUpdate = true;
  }
  return ownedViewportSystem(world, system, created);
}

function ownedViewportSystem(world: ViewportSystemInstallContext['world'], system: System, owned: boolean): Disposable {
  return {
    dispose() {
      if (owned && world.hasSystem(system)) world.removeSystem(system);
    },
  };
}

export function getStarterKitDropdownItems(starterKits: Array<{ name: string }>): GEDropdownItem[] {
  return starterKits.map(kit => ({ label: kit.name, value: kit.name }));
}

export function installComponentLibraryViewportSystems(
  libraries: readonly EditorComponentLibrary[],
  context: ViewportSystemInstallContext,
): Disposable {
  const disposables: Disposable[] = [];
  for (const library of libraries) {
    const disposable = library.installViewportSystems?.(context);
    if (disposable) disposables.push(disposable);
  }
  return {
    dispose() {
      for (let index = disposables.length - 1; index >= 0; index--) disposables[index]?.dispose();
    },
  };
}

export function getComponentDescriptors(registry: ComponentLibraryRegistry): EditorComponentDescriptor[] {
  return registry.getDescriptors();
}

export function getComponentContributions(libraries: readonly EditorComponentLibrary[]): readonly ComponentContribution[] {
  const registryLibrary = libraries.find(library => library.name === '@haiyue/editor-contributions');
  if (registryLibrary?.getContributions) return registryLibrary.getContributions();
  return libraries.flatMap(library => library.contributions ?? []);
}

export function getRuntimeComponentContributions(
  libraries: readonly EditorComponentLibrary[],
): readonly RuntimeComponentContribution[] {
  return getComponentContributions(libraries).map(contribution => Object.freeze({
    type: contribution.type,
    ...(contribution.runtimeExport === undefined ? {} : { runtimeExport: contribution.runtimeExport }),
  }));
}
