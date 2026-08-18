import {
  ScriptComponent,
  SCRIPT_LIFECYCLES,
  ScriptResource,
  type ScriptLifecycleName,
} from '@haiyue/engine/components';
import type {
  ScriptEditorController,
  ScriptEditorControllerOptions,
} from './scriptEditor';
import type { ScriptEditorControllerPort } from './ScriptEditorControllerPort';
import { normalizeScriptLifecycle } from './scriptAuthoringText';

export interface LazyScriptEditorControllerOptions extends ScriptEditorControllerOptions {
  reportError: (message: string, error: unknown) => void;
}

/**
 * Keeps the editor shell independent from the code editor/highlighter closure.
 * The real controller is loaded only when a script editor is first rendered.
 */
export class LazyScriptEditorController implements ScriptEditorControllerPort {
  private readonly _options: LazyScriptEditorControllerOptions;
  private _lifecycle: ScriptLifecycleName = 'onUpdate';
  private _controller: ScriptEditorController | null = null;
  private _controllerPromise: Promise<ScriptEditorController> | null = null;
  private _generation = 0;

  constructor(options: LazyScriptEditorControllerOptions) {
    this._options = options;
  }

  get lifecycle(): ScriptLifecycleName {
    return this._lifecycle;
  }

  set lifecycle(value: string) {
    this._lifecycle = normalizeScriptLifecycle(value);
    if (this._controller) this._controller.lifecycle = this._lifecycle;
  }

  getTarget(target: ScriptComponent | ScriptResource | null): ScriptComponent | ScriptResource | null {
    if (!target) return null;
    if (target instanceof ScriptResource) return target;
    if (target.resource) return target.resource;
    const hasLocalScript = SCRIPT_LIFECYCLES.some(lifecycle => target.scripts[lifecycle].trim());
    const onlyScriptResource = this._options.getOnlyScriptResource();
    return !hasLocalScript && onlyScriptResource ? onlyScriptResource : target;
  }

  reset(): void {
    this._generation++;
    this._controller?.reset();
  }

  setCode(target: ScriptComponent | ScriptResource, code: string): void {
    this.invoke(controller => controller.setCode(target, code));
  }

  render(target: ScriptComponent | ScriptResource): void {
    const resolvedTarget = this.getTarget(target) ?? target;
    this._generation++;
    this.invoke(controller => controller.render(resolvedTarget));
  }

  openResource(resource: ScriptResource): void {
    if (this._options.overlayTitle) this._options.overlayTitle.textContent = resource.name;
    if (this._options.overlay) this._options.overlay.hidden = false;
    this._generation++;
    this.invoke(controller => controller.openResource(resource));
  }

  closeResource(): void {
    this._generation++;
    if (this._options.overlay) this._options.overlay.hidden = true;
    this._options.host?.replaceChildren();
    this._controller?.closeResource();
  }

  private loadController(): Promise<ScriptEditorController> {
    if (this._controller) return Promise.resolve(this._controller);
    this._controllerPromise ??= import('./scriptEditor').then(module => {
      const { reportError: _reportError, ...controllerOptions } = this._options;
      const controller = new module.ScriptEditorController(controllerOptions);
      controller.lifecycle = this._lifecycle;
      this._controller = controller;
      return controller;
    }).catch(error => {
      this._controllerPromise = null;
      throw error;
    });
    return this._controllerPromise;
  }

  private invoke(action: (controller: ScriptEditorController) => void): void {
    const generation = this._generation;
    void this.loadController().then(controller => {
      if (generation !== this._generation) return;
      controller.lifecycle = this._lifecycle;
      action(controller);
    }).catch(error => this._options.reportError('Failed to load script authoring tools.', error));
  }
}
