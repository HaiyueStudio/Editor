import type { GEDropdownItem } from '@haiyue/ui';
import type { EditorPluginContext, EnginePlugin, PluginRollbackScope, RegistrationToken } from '@haiyue/engine/core';
import { ClippingPlanes } from '@haiyue/engine/components';
import type { EditorComponentDescriptor, EditorContribution, EditorResourceImporter, EditorStarterKit } from '../../types';
import { InspectorRegistry, type InspectorRenderer } from '../inspector/InspectorRegistry';
import {
  createBaseComponentDescriptors,
  createBuiltinComponentsLibrary,
  createComponentLibraryRegistry,
  getComponentDescriptors as getComponentDescriptorsFromRegistry,
  getStarterKitDropdownItems as getStarterKitDropdownItemsFromRegistry,
  type BaseComponentDescriptorDeps,
  type BuiltinComponentsLibraryDeps,
  type EditorComponentLibrary,
} from '../../domain/library/componentLibrary';
import { EditorPluginHost } from '../../engine-adapter/EditorPluginHost';
import { clippingPlanesInspectorSchema } from '../../domain/library/coreComponentInspectorSchemas';

export interface MainComponentContext {
  inspectorRegistry: InspectorRegistry;
  componentLibraries: EditorComponentLibrary[];
  starterKits: EditorStarterKit[];
  resourceImporters: EditorResourceImporter[];
  registerStarterKit(kit: EditorStarterKit): void;
  registerComponentDescriptor(descriptor: EditorComponentDescriptor): void;
  registerContribution(contribution: EditorContribution): RegistrationToken;
  installEditorPlugin(plugin: EnginePlugin): void;
  uninstallEditorPlugin(name: string): void;
  enableEditorPlugin(name: string): void;
  disableEditorPlugin(name: string): void;
  isEditorPluginEnabled(name: string): boolean;
  getStarterKitDropdownItems(): GEDropdownItem[];
  getComponentContributions(): readonly import('../../types').ComponentContribution[];
  getComponentDescriptors(): EditorComponentDescriptor[];
}

export interface MainComponentContextDeps extends BaseComponentDescriptorDeps, BuiltinComponentsLibraryDeps {}

export function createMainComponentContext(deps: MainComponentContextDeps): MainComponentContext {
  const inspectorRegistry = new InspectorRegistry();
  inspectorRegistry.registerSchema(ClippingPlanes, clippingPlanesInspectorSchema);
  const componentRegistry = createComponentLibraryRegistry(createBaseComponentDescriptors({
    createDefaultMesh2DComponent: deps.createDefaultMesh2DComponent,
    createDefaultMeshComponent: deps.createDefaultMeshComponent,
    createDefaultScriptComponent: deps.createDefaultScriptComponent,
  }));
  const builtinLibrary = createBuiltinComponentsLibrary({
    getDefaultCanvasTextStyle: deps.getDefaultCanvasTextStyle,
  });
  componentRegistry.register(builtinLibrary);
  for (const contribution of builtinLibrary.contributions ?? []) {
    if (contribution.inspector) inspectorRegistry.registerSchema(contribution.type, contribution.inspector);
  }

  const starterKits: EditorStarterKit[] = [];
  const resourceImporters: EditorResourceImporter[] = [];
  const editorPluginHost = new EditorPluginHost({
    createContext: tracker => createEditorExtensionContext({
      componentRegistry,
      inspectorRegistry,
      resourceImporters,
      starterKits,
      tracker,
    }),
  });

  const contextApi: MainComponentContext = {
    inspectorRegistry,
    componentLibraries: componentRegistry.libraries,
    starterKits,
    resourceImporters,
    registerStarterKit(kit) {
      starterKits.push(kit);
    },
    registerComponentDescriptor(descriptor) {
      componentRegistry.registerDescriptor(descriptor);
    },
    registerContribution(contribution) {
      return registerEditorContribution({ componentRegistry, inspectorRegistry, resourceImporters, starterKits }, contribution);
    },
    installEditorPlugin(plugin) {
      editorPluginHost.installPlugin(plugin);
    },
    uninstallEditorPlugin(name) {
      editorPluginHost.removePlugin(name);
    },
    enableEditorPlugin(name) {
      editorPluginHost.enablePlugin(name);
    },
    disableEditorPlugin(name) {
      editorPluginHost.disablePlugin(name);
    },
    isEditorPluginEnabled(name) {
      return editorPluginHost.isPluginEnabled(name);
    },
    getStarterKitDropdownItems() {
      return getStarterKitDropdownItemsFromRegistry(starterKits);
    },
    getComponentContributions() {
      return componentRegistry.getContributions();
    },
    getComponentDescriptors() {
      return getComponentDescriptorsFromRegistry(componentRegistry);
    },
  };
  return contextApi;
}

function createEditorExtensionContext(deps: {
  componentRegistry: ReturnType<typeof createComponentLibraryRegistry>;
  inspectorRegistry: InspectorRegistry;
  resourceImporters: EditorResourceImporter[];
  starterKits: EditorStarterKit[];
  tracker: PluginRollbackScope;
}): EditorPluginContext<EditorComponentDescriptor, InspectorRenderer, EditorResourceImporter, EditorStarterKit, EditorContribution> {
  return {
    scope: 'editor',
    rollback: deps.tracker,
    unregister: () => deps.tracker.unregister(),
    registerComponentDescriptor(descriptor) {
      const registration = deps.componentRegistry.registerDescriptor(descriptor);
      return deps.tracker.track(() => registration.unregister());
    },
    registerContribution(contribution) {
      const registration = registerEditorContribution(deps, contribution);
      return deps.tracker.track(() => registration.unregister());
    },
    registerInspectorRenderer(key, renderer) {
      const registration = deps.inspectorRegistry.register(key, renderer);
      return deps.tracker.track(() => registration.unregister());
    },
    registerResourceImporter(importer) {
      deps.resourceImporters.push(importer);
      return deps.tracker.track(() => {
        const index = deps.resourceImporters.indexOf(importer);
        if (index >= 0) deps.resourceImporters.splice(index, 1);
      });
    },
    registerStarterKit(kit) {
      deps.starterKits.push(kit);
      return deps.tracker.track(() => {
        const index = deps.starterKits.indexOf(kit);
        if (index >= 0) deps.starterKits.splice(index, 1);
      });
    },
  };
}

function registerEditorContribution(
  deps: {
    componentRegistry: ReturnType<typeof createComponentLibraryRegistry>;
    inspectorRegistry: InspectorRegistry;
    resourceImporters: EditorResourceImporter[];
    starterKits: EditorStarterKit[];
  },
  contribution: EditorContribution,
): RegistrationToken {
  const componentRegistration = deps.componentRegistry.registerContribution(contribution);
  const inspectorRegistrations = (contribution.components ?? [])
    .filter(component => component.inspector !== undefined)
    .map(component => deps.inspectorRegistry.registerSchema(component.type, component.inspector!));
  const importers = [...(contribution.resourceImporters ?? [])];
  const kits = [...(contribution.starterKits ?? [])];
  deps.resourceImporters.push(...importers);
  deps.starterKits.push(...kits);
  let active = true;
  return {
    get active() { return active; },
    unregister() {
      if (!active) return;
      active = false;
      for (let index = inspectorRegistrations.length - 1; index >= 0; index--) inspectorRegistrations[index]?.unregister();
      componentRegistration.unregister();
      for (const importer of importers) removeExact(deps.resourceImporters, importer);
      for (const kit of kits) removeExact(deps.starterKits, kit);
    },
  };
}

function removeExact<T>(items: T[], item: T): void {
  const index = items.indexOf(item);
  if (index >= 0) items.splice(index, 1);
}
