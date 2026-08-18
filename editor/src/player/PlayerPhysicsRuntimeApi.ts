import type { Entity } from '@haiyue/engine';
import {
  Physics2DBody,
  Physics2DJoint,
  Physics2DSystem,
  Physics2DTo3DTransformSync,
  Physics2DTo3DTransformSyncSystem,
} from '@haiyue/engine/physics';
import type { PlayerRuntime } from '../engine-adapter/PlayerRuntimeAdapter';

export const physicsRuntimeComponents: Readonly<Record<string, unknown>> = Object.freeze({
  Physics2DBody,
  Physics2DJoint,
  Physics2DTo3DTransformSync,
  Physics2DTo3DTransformSyncSystem,
  Physics2DSystem,
});

export function createPlayerPhysicsApi(runtime: PlayerRuntime): Record<string, unknown> {
  const getSystem = () => runtime.world.getSystem(Physics2DSystem) as Physics2DSystem | null;
  const getBody = (
    target: Entity | Physics2DBody | number | string | null | undefined,
  ): Physics2DBody | null => {
    if (!target) return null;
    if (target instanceof Physics2DBody) return target;
    const entity = typeof target === 'object'
      ? target
      : findEntity(runtime, target);
    return entity?.getComponent(Physics2DBody) ?? null;
  };
  return {
    getSystem,
    body: (target: Entity | Physics2DBody | number | string) => getBody(target),
    hitTest: (x: number, y: number) => getSystem()?.hitTest(runtime.world, x, y) ?? null,
    applyImpulse: (target: Entity | Physics2DBody | number | string, x: number, y: number) => {
      const physics = getSystem();
      const body = getBody(target);
      return !!physics && !!body && physics.applyLinearImpulse(body, x, y);
    },
    applyForce: (target: Entity | Physics2DBody | number | string, x: number, y: number) => {
      const physics = getSystem();
      const body = getBody(target);
      return !!physics && !!body && physics.applyForce(body, x, y);
    },
    getVelocity: (
      target: Entity | Physics2DBody | number | string,
      out: { x: number; y: number } = { x: 0, y: 0 },
    ) => {
      const physics = getSystem();
      const body = getBody(target);
      return physics && body && physics.getLinearVelocity(body, out) ? out : null;
    },
    getMass: (target: Entity | Physics2DBody | number | string) => {
      const physics = getSystem();
      const body = getBody(target);
      return physics && body ? physics.getBodyMass(body) : null;
    },
    setVelocity: (target: Entity | Physics2DBody | number | string, x: number, y: number) => {
      const physics = getSystem();
      const body = getBody(target);
      return !!physics && !!body && physics.setLinearVelocity(body, x, y);
    },
    setAngularVelocity: (
      target: Entity | Physics2DBody | number | string,
      velocity: number,
    ) => {
      const physics = getSystem();
      const body = getBody(target);
      return !!physics && !!body && physics.setAngularVelocity(body, velocity);
    },
    teleport: (
      target: Entity | Physics2DBody | number | string,
      x: number,
      y: number,
      angle?: number,
    ) => {
      const physics = getSystem();
      const body = getBody(target);
      return !!physics && !!body && physics.teleportBody(body, x, y, angle);
    },
    stop: (target: Entity | Physics2DBody | number | string) => {
      const physics = getSystem();
      const body = getBody(target);
      if (!physics || !body) return false;
      return physics.setLinearVelocity(body, 0, 0) && physics.setAngularVelocity(body, 0);
    },
  };
}

function findEntity(runtime: PlayerRuntime, nameOrId: string | number): Entity | null {
  if (typeof nameOrId === 'number') return runtime.world.getEntity(nameOrId);
  for (const entity of runtime.world.entities.values()) {
    if (entity.name === nameOrId) return entity;
  }
  return runtime.world.getEntity(nameOrId);
}
