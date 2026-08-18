import type {
  ScriptComponent,
  ScriptLifecycleName,
  ScriptResource,
} from '@haiyue/engine/components';

export interface ScriptEditorControllerPort {
  get lifecycle(): ScriptLifecycleName;
  set lifecycle(value: string);
  getTarget(target: ScriptComponent | ScriptResource | null): ScriptComponent | ScriptResource | null;
  reset(): void;
  setCode(target: ScriptComponent | ScriptResource, code: string): void;
  render(target: ScriptComponent | ScriptResource): void;
  openResource(resource: ScriptResource): void;
  closeResource(): void;
}
