import type { EnginePlugin } from '@haiyue/engine/core';
import {
  Tween2DComponent,
  Tween2DSystem,
} from '@haiyue/extensions/tween';
import type { InspectorSchema, ViewportSystemInstallContext } from '../../types';

export function createTweenEditorPlugin(): EnginePlugin {
  return {
    name: '@haiyue/extensions/tween',
    version: '0.1.0',
    installEditor(context) {
      context.registerContribution({ components: [{
        type: 'Tween2DComponent',
        create: () => new Tween2DComponent({
          to: { x: 120, y: 0 },
          duration: 160,
          easing: 'cubicOut',
        }),
        inspector: Tween2DComponent.editor as InspectorSchema,
        serialize(component: Tween2DComponent) {
          return {
            type: 'Tween2DComponent',
            ...(component.from ? { from: { ...component.from } } : {}),
            to: { ...component.to },
            duration: component.duration,
            delay: component.delay,
            easing: typeof component.easing === 'string' ? component.easing : 'linear',
            removeOnComplete: component.removeOnComplete,
          };
        },
        deserialize(data: unknown) {
          const value = data as ConstructorParameters<typeof Tween2DComponent>[0] & {
            type?: unknown;
          };
          return value.type === 'Tween2DComponent'
            ? new Tween2DComponent(value)
            : null;
        },
        clone: (component: Tween2DComponent) => component.clone(),
        installViewport(viewport: ViewportSystemInstallContext) {
          const existing = viewport.world.getSystem(Tween2DSystem);
          const system = existing ?? new Tween2DSystem({ priority: 0 });
          if (!existing) viewport.world.addSystem(system);
          return {
            dispose() {
              if (!existing && viewport.world.hasSystem(system)) {
                viewport.world.removeSystem(system);
              }
            },
          };
        },
        runtimeExport: {
          imports: [{
            from: '@haiyue/extensions/tween',
            names: ['Tween2DComponent', 'Tween2DSystem'],
          }],
          systems: ['Tween2DSystem'],
          deserializeExpression: 'new Tween2DComponent(data)',
          installSystems: '  if (hasComponentType(world, Tween2DComponent)) world.addSystem(new Tween2DSystem({ priority: 1 }));',
          has2D: true,
        },
      }] });
    },
  };
}
