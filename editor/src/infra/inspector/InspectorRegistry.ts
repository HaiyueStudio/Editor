import type { Component, Entity } from '@haiyue/engine';
import type { RegistrationToken } from '@haiyue/engine/core';
import type { InspectorSchema } from '../../types';
import type { InspectorRendererDeps } from './inspectorRenderer';
import type { getGenericEditorSchema } from '../../ui/inspector/genericComponentEditor';

export type InspectorComponentKey = string | Function;

export interface InspectorRenderContext<T extends Component = Component> {
  deps: InspectorRendererDeps;
  entity: Entity;
  component: T;
  componentName: string;
  genericSchema: ReturnType<typeof getGenericEditorSchema> | null;
}

export type InspectorRenderer<T extends Component = Component> = (context: InspectorRenderContext<T>) => boolean | void;

export interface InspectorRegistration {
  readonly identity: symbol;
  key: InspectorComponentKey;
  render?: InspectorRenderer;
  schema?: InspectorSchema;
}

export class InspectorRegistry {
  private readonly registrations: InspectorRegistration[] = [];

  register<T extends Component>(key: InspectorComponentKey, render: InspectorRenderer<T>): RegistrationToken {
    return this._register({ key, render: render as InspectorRenderer });
  }

  registerSchema(key: InspectorComponentKey, schema: InspectorSchema): RegistrationToken {
    return this._register({ key, schema });
  }

  render(context: InspectorRenderContext): boolean {
    const registration = this.resolve(context.component);
    if (!registration) return false;
    return registration.render?.(context) !== false;
  }

  resolve(component: Component): InspectorRegistration | null {
    return this._resolve(component, registration => registration.render !== undefined);
  }

  resolveSchema(component: Component): InspectorSchema | null {
    return this._resolve(component, registration => registration.schema !== undefined)?.schema ?? null;
  }

  private _register(registration: Omit<InspectorRegistration, 'identity'>): RegistrationToken {
    const stored: InspectorRegistration = { ...registration, identity: Symbol('inspector-registration') };
    this.registrations.push(stored);
    let active = true;
    return {
      get active() { return active; },
      unregister: () => {
        if (!active) return;
        active = false;
        const index = this.registrations.indexOf(stored);
        if (index >= 0) this.registrations.splice(index, 1);
      },
    };
  }

  private _resolve(component: Component, accept: (registration: InspectorRegistration) => boolean): InspectorRegistration | null {
    const ctor = component.constructor;
    for (let i = this.registrations.length - 1; i >= 0; i--) {
      const registration = this.registrations[i];
      if (!registration || !accept(registration)) continue;
      if (typeof registration.key === 'string') {
        if (registration.key === ctor.name) return registration;
      } else if (component instanceof registration.key) {
        return registration;
      }
    }
    return null;
  }
}
