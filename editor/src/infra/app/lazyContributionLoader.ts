import type { EnginePlugin } from '@haiyue/engine/core';
import {
  collectOptionalCapabilitiesForProject,
  type OptionalEditorCapability,
} from '../../domain/library/optionalComponentManifest';

type ConfiguredSystemRuntimeContribution =
  typeof import('./configuredSystemRuntimeContribution');
type EditorInspectorContribution = readonly [
  typeof import('../inspector/mainInspectorRenderer'),
  typeof import('../inspector/inspectorRenderer'),
];

let configuredSystemRuntimePromise:
  Promise<ConfiguredSystemRuntimeContribution> | null = null;
let editorInspectorContributionPromise:
  Promise<EditorInspectorContribution> | null = null;

/**
 * Loads Physics/RadialShadow runtime code only after a project asks for one
 * of those configured systems. Once loaded, empty configs still resolve the
 * contribution so previously installed systems can be removed.
 */
export function loadConfiguredSystemRuntime(
  required: boolean,
): Promise<ConfiguredSystemRuntimeContribution | null> | null {
  if (!required && !configuredSystemRuntimePromise) return null;
  configuredSystemRuntimePromise ??= import('./configuredSystemRuntimeContribution');
  return configuredSystemRuntimePromise;
}

/** Loads the entity Inspector only after an entity is selected. */
export function loadEditorInspectorContribution(): Promise<EditorInspectorContribution> {
  editorInspectorContributionPromise ??= Promise.all([
    import('../inspector/mainInspectorRenderer'),
    import('../inspector/inspectorRenderer'),
  ]);
  return editorInspectorContributionPromise;
}

export type OptionalPluginFactory = () => Promise<EnginePlugin>;

export interface OptionalEditorCapabilityLoaderOptions {
  installPlugin(plugin: EnginePlugin): void;
  reportFailure(capability: OptionalEditorCapability, error: unknown): void;
  factories?: Readonly<Partial<Record<OptionalEditorCapability, OptionalPluginFactory>>>;
}

const defaultOptionalPluginFactories: Readonly<
  Record<OptionalEditorCapability, OptionalPluginFactory>
> = Object.freeze({
  gltf: () => import('@haiyue/extensions/gltf')
    .then(module => module.createGltfPlugin()),
  spine: () => import('@haiyue/extensions/spine')
    .then(module => module.createSpinePlugin()),
  tilemap: () => import('@haiyue/extensions/tilemap')
    .then(module => module.createTilemapPlugin()),
  tween: () => import('./tweenEditorContribution')
    .then(module => module.createTweenEditorPlugin()),
});

/**
 * Activates optional editor families independently. Every activation settles
 * to a capability-local result so unrelated plugins can still start; project
 * activation rejects only after all required capabilities have been attempted.
 */
export class OptionalEditorCapabilityLoader {
  private readonly _activation = new Map<
    OptionalEditorCapability,
    Promise<boolean>
  >();
  private readonly _active = new Set<OptionalEditorCapability>();
  private readonly _listeners = new Set<
    (capability: OptionalEditorCapability) => void
  >();
  private readonly _factories:
    Readonly<Record<OptionalEditorCapability, OptionalPluginFactory>>;

  constructor(private readonly _options: OptionalEditorCapabilityLoaderOptions) {
    this._factories = {
      ...defaultOptionalPluginFactories,
      ..._options.factories,
    };
  }

  isActive(capability: OptionalEditorCapability): boolean {
    return this._active.has(capability);
  }

  activate(capability: OptionalEditorCapability): Promise<boolean> {
    const existing = this._activation.get(capability);
    if (existing) return existing;
    const activation = Promise.resolve()
      .then(() => this._factories[capability]())
      .then(plugin => {
        this._options.installPlugin(plugin);
        this._active.add(capability);
        for (const listener of this._listeners) {
          try {
            listener(capability);
          } catch (error) {
            this._options.reportFailure(capability, error);
          }
        }
        return true;
      })
      .catch(error => {
        // A failed dynamic import may be transient (network, cache, or CSP
        // recovery). Do not permanently poison this capability for the rest
        // of the editor session.
        if (this._activation.get(capability) === activation) {
          this._activation.delete(capability);
        }
        this._options.reportFailure(capability, error);
        return false;
      });
    this._activation.set(capability, activation);
    return activation;
  }

  async activateForProject(project: unknown): Promise<void> {
    const required = collectOptionalCapabilitiesForProject(project);
    const results = await Promise.all(
      required.map(async capability => ({
        capability,
        active: await this.activate(capability),
      })),
    );
    const unavailable = results
      .filter(result => !result.active)
      .map(result => result.capability);
    if (unavailable.length > 0) {
      throw new Error(
        `Project requires unavailable editor capabilities: ${unavailable.join(', ')}. `
        + 'The current document was left unchanged to preserve its serialized components.',
      );
    }
  }

  subscribe(
    listener: (capability: OptionalEditorCapability) => void,
  ): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }
}
