import { AmbientLight, Fog, PointLight } from '@haiyue/engine/lighting';
import { BasicMaterial, Camera2D, Camera3D, CartesianTransform3D, Component, DirectionalLight, EnvironmentLight, Entity, Geometry2D, Material2D, Mesh2D, Mesh3D, PbrMaterial, SphericalTransform3D, Transform2D, World } from '@haiyue/engine';
import { BasisTransform3D, DataComponent, KeyboardComponent, MeshHelper, ScriptComponent } from '@haiyue/engine/components';
import { BlinnPhongMaterial, CssMaterial, DepthMaterial, Material, NormalMaterial, RadialShadowMaterial, ToonMaterial } from '@haiyue/engine/material';
import { Physics2DBody, Physics2DJoint, Physics2DTo3DTransformSync } from '@haiyue/engine/physics/components';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import type { GETreeDataChangeDetail } from '@haiyue/ui';
import type { EntityLocation } from '../types';
import { PrefabInstanceComponent } from './prefabInstance';
import { colorToTuple, colorToVec3, toVec2, toVec3 } from '../domain/scene/tupleUtils';

export interface ComponentCloneExtension {
  cloneComponent?: (component: Component) => Component | null;
}

export interface CloneEditorEntityOptions {
  nameSuffix?: string;
  cloneExtensions?: ComponentCloneExtension[];
}

interface EntityNameCache {
  entityCount: number;
  counts: Map<string, number>;
}

const entityNameCaches = new WeakMap<World, EntityNameCache>();

function serializePhysicsJointTarget(target: Physics2DJoint['bodyA']): string | number {
  if (target instanceof Entity) return target.id;
  return target;
}

function isSelectionHelper(component: MeshHelper): boolean {
  const color = colorToTuple(component.color);
  return component.mode === 'aabb'
    && color[0] === 0.25
    && color[1] === 0.75
    && color[2] === 1
    && color[3] === 1;
}

function cloneMaterialForEntity(material: Material): Material {
  if (material instanceof CssMaterial) {
    return new CssMaterial({
      text: material.text,
      style: { ...material.style },
      color: material.color.clone(),
      blending: material.blending,
    });
  }
  if (material instanceof BasicMaterial) {
    return new BasicMaterial({
      color: material.color.clone(),
      texture: material.texture,
      blending: material.blending,
    });
  }
  if (material instanceof NormalMaterial) return new NormalMaterial({ space: material.space });
  if (material instanceof DepthMaterial) {
    return new DepthMaterial({
      near: material.near,
      far: material.far,
      isOrthographic: material.isOrthographic,
    });
  }
  if (material instanceof BlinnPhongMaterial) return material.clone();
  if (material instanceof PbrMaterial) return material.clone();
  if (material instanceof ToonMaterial) return material.clone();
  if (material instanceof RadialShadowMaterial) {
    return new RadialShadowMaterial({
      color: colorToVec3(material.color),
      opacity: material.opacity,
      innerRadius: material.innerRadius,
    });
  }
  return material;
}

export function cloneEditorComponent(component: Component, extensions: ComponentCloneExtension[] = []): Component | null {
  for (const extension of extensions) {
    const clone = extension.cloneComponent?.(component);
    if (clone) return clone;
  }
  if (component instanceof CartesianTransform3D) return component.clone();
  if (component instanceof SphericalTransform3D) {
    return new SphericalTransform3D({
      radius: component.radius,
      theta: component.theta,
      phi: component.phi,
      target: toVec3(component.target),
    });
  }
  if (component instanceof BasisTransform3D) {
    return new BasisTransform3D({
      coordinates: toVec3(component.coordinates),
      basisX: toVec3(component.basisX),
      basisY: toVec3(component.basisY),
      basisZ: toVec3(component.basisZ),
    });
  }
  if (component instanceof Transform2D) {
    return new Transform2D({
      x: component.x,
      y: component.y,
      rotation: component.rotation,
      scaleX: component.scaleX,
      scaleY: component.scaleY,
    });
  }
  if (component instanceof Camera3D) {
    const camera = new Camera3D({
      type: component.projectionType,
      fov: component.fov,
      aspect: component.aspect,
      near: component.near,
      far: component.far,
      left: component.orthoLeft,
      right: component.orthoRight,
      top: component.orthoTop,
      bottom: component.orthoBottom,
    });
    camera.reverseZ = component.reverseZ;
    camera.setDirty();
    return camera;
  }
  if (component instanceof Camera2D) {
    return new Camera2D({
      width: component.width,
      height: component.height,
      near: component.near,
      far: component.far,
      zoom: component.zoom,
    });
  }
  if (component instanceof Mesh3D) {
    return new Mesh3D(component.geometry, cloneMaterialForEntity(component.material));
  }
  if (component instanceof Mesh2D) {
    return new Mesh2D(
      new Geometry2D(
        new Float32Array(component.geometry.positions),
        component.geometry.indices
          ? component.geometry.indices instanceof Uint32Array
            ? new Uint32Array(component.geometry.indices)
            : new Uint16Array(component.geometry.indices)
          : undefined,
        { topology: component.geometry.topology },
      ),
      new Material2D({
        color: component.material.color.clone(),
        blending: component.material.blending,
      }),
    );
  }
  if (component instanceof DataComponent) return component.clone();
  if (component instanceof CanvasTextComponent) return component.clone();
  if (component instanceof KeyboardComponent) return new KeyboardComponent();
  if (component instanceof Physics2DBody) {
    return new Physics2DBody({
      type: component.type,
      shape: component.shape,
      width: component.width,
      height: component.height,
      radius: component.radius,
      density: component.density,
      friction: component.friction,
      restitution: component.restitution,
      fixedRotation: component.fixedRotation,
      linearDamping: component.linearDamping,
      angularDamping: component.angularDamping,
      bullet: component.bullet,
      allowSleep: component.allowSleep,
      isSensor: component.isSensor,
      categoryBits: component.categoryBits,
      maskBits: component.maskBits,
      groupIndex: component.groupIndex,
      syncTransform: component.syncTransform,
    });
  }
  if (component instanceof Physics2DJoint) {
    return new Physics2DJoint({
      type: component.type,
      bodyA: serializePhysicsJointTarget(component.bodyA),
      bodyB: serializePhysicsJointTarget(component.bodyB),
      anchor: component.anchor ? toVec2(component.anchor) : undefined,
      anchorA: component.anchorA ? toVec2(component.anchorA) : undefined,
      anchorB: component.anchorB ? toVec2(component.anchorB) : undefined,
      collideConnected: component.collideConnected,
      enableLimit: component.enableLimit,
      lowerAngle: component.lowerAngle,
      upperAngle: component.upperAngle,
      enableMotor: component.enableMotor,
      motorSpeed: component.motorSpeed,
      maxMotorTorque: component.maxMotorTorque,
      length: component.length ?? undefined,
      frequencyHz: component.frequencyHz,
      dampingRatio: component.dampingRatio,
    });
  }
  if (component instanceof Physics2DTo3DTransformSync) {
    return new Physics2DTo3DTransformSync({
      sourceEntity: component.sourceEntity == null ? null : serializePhysicsJointTarget(component.sourceEntity),
      plane: component.plane,
      fixedAxisValue: component.fixedAxisValue,
      offset: toVec3(component.offset),
      syncRotation: component.syncRotation,
      rotationAxis: component.rotationAxis,
      rotationOffset: component.rotationOffset,
    });
  }
  if (component instanceof MeshHelper) {
    if (isSelectionHelper(component)) return null;
    return new MeshHelper({ mode: component.mode, color: colorToTuple(component.color) });
  }
  if (component instanceof ScriptComponent) return new ScriptComponent({ ...component.scripts }, component.resource);
  if (component instanceof AmbientLight) return new AmbientLight({ color: component.color.clone(), intensity: component.intensity });
  if (component instanceof DirectionalLight) return new DirectionalLight({ color: component.color.clone(), intensity: component.intensity, direction: toVec3(component.direction), castShadow: component.castShadow, shadow: { ...component.shadow } });
  if (component instanceof EnvironmentLight) return new EnvironmentLight({ intensity: component.intensity, rotation: component.rotation, diffuseColor: component.diffuseColor.clone(), specularColor: component.specularColor.clone(), diffuseTexture: component.diffuseTexture, specularTexture: component.specularTexture });
  if (component instanceof Fog) return component.clone();
  if (component instanceof PointLight) return new PointLight({ color: component.color.clone(), intensity: component.intensity, range: component.range });
  if (component instanceof PrefabInstanceComponent) return new PrefabInstanceComponent(component.prefabId, component.sourceRevision);
  return null;
}

export function cloneEditorEntity(source: Entity, options: CloneEditorEntityOptions = { nameSuffix: ' Copy' }): Entity {
  const clone = new Entity(`${source.name}${options.nameSuffix ?? ''}`);
  clone.disabled = source.disabled;
  for (const component of source.components.values()) {
    const clonedComponent = cloneEditorComponent(component, options.cloneExtensions);
    if (clonedComponent) clone.addComponent(clonedComponent);
  }
  for (const child of source.children) {
    clone.addChild(cloneEditorEntity(child, options));
  }
  return clone;
}

export function getEntityLocation(entity: Entity): EntityLocation {
  const parent = entity.parent as Entity | null;
  const list = parent?.children ?? entity.usedBy[0]?.rootEntityList ?? [];
  return { parent, index: Math.max(0, list.indexOf(entity)) };
}

export function insertEntityAt(world: World, entity: Entity, location: EntityLocation): void {
  entity.parent = location.parent;
  if (location.parent) {
    const list = location.parent.children;
    const index = Math.max(0, Math.min(location.index, list.length));
    if (!list.includes(entity)) list.splice(index, 0, entity);
  }
  world.addEntity(entity);
  world.updateRootEntity(entity);
}

export function getUniqueEntityName(world: World, baseName: string): string {
  const counts = getEntityNameCounts(world);
  if (!counts.has(baseName)) return baseName;
  let index = 2;
  while (counts.has(`${baseName} ${index}`)) index++;
  return `${baseName} ${index}`;
}

export function invalidateEntityNameCache(world: World): void {
  entityNameCaches.delete(world);
}

export function removeEntityKeepingObject(world: World, entity: Entity): void {
  entity.removeComponent(MeshHelper);
  detachEntityFromParent(entity);
  world.removeEntity(entity);
}

export function setEntityDisabled(entity: Entity, disabled: boolean): void {
  entity.disabled = disabled;
}

export function isEntityDescendant(entity: Entity, possibleAncestor: Entity): boolean {
  let parent = entity.parent as Entity | null;
  while (parent) {
    if (parent === possibleAncestor) return true;
    parent = parent.parent as Entity | null;
  }
  return false;
}

export function getTopLevelEntities(entities: Iterable<Entity>): Entity[] {
  const list = [...entities];
  if (list.length <= 1) return list;
  const selected = new Set(list);
  const result: Entity[] = [];
  for (const entity of list) {
    let parent = entity.parent as Entity | null;
    let hasSelectedAncestor = false;
    while (parent) {
      if (selected.has(parent)) {
        hasSelectedAncestor = true;
        break;
      }
      parent = parent.parent as Entity | null;
    }
    if (!hasSelectedAncestor) result.push(entity);
  }
  return result;
}

function getEntityNameCounts(world: World): Map<string, number> {
  const cached = entityNameCaches.get(world);
  if (cached && cached.entityCount === world.entities.size) {
    return cached.counts;
  }

  const counts = new Map<string, number>();
  for (const entity of world.entities.values()) {
    counts.set(entity.name, (counts.get(entity.name) ?? 0) + 1);
  }
  entityNameCaches.set(world, { entityCount: world.entities.size, counts });
  return counts;
}

export function detachEntityFromParent(entity: Entity): void {
  const parent = entity.parent as Entity | null;
  if (!parent) return;
  const index = parent.children.indexOf(entity);
  if (index >= 0) parent.children.splice(index, 1);
  entity.parent = null;
  syncRootEntity(entity);
}

export function moveEntityHierarchy(
  world: World,
  sourceId: string | undefined,
  targetId: string | null | undefined,
  position: GETreeDataChangeDetail['dropPosition'],
): Entity | null {
  const source = sourceId ? world.getEntity(Number(sourceId)) : null;
  const target = targetId ? world.getEntity(Number(targetId)) : null;
  if (!source || !target || source === target || isEntityDescendant(target, source)) return null;

  detachEntityFromParent(source);

  if (position === 'inside') {
    target.children.push(source);
    source.parent = target;
    world.updateRootEntity(source);
    return source;
  }

  const targetParent = target.parent as Entity | null;
  if (!targetParent) {
    source.parent = null;
    world.updateRootEntity(source);
    return source;
  }

  const targetIndex = targetParent.children.indexOf(target);
  if (targetIndex < 0) return source;
  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
  targetParent.children.splice(insertIndex, 0, source);
  source.parent = targetParent;
  world.updateRootEntity(source);
  return source;
}

export function moveEntityToLocation(entity: Entity, location: EntityLocation): void {
  detachEntityFromParent(entity);
  entity.parent = location.parent;
  if (location.parent) {
    const list = location.parent.children;
    const index = Math.max(0, Math.min(location.index, list.length));
    list.splice(index, 0, entity);
  }
  syncRootEntity(entity);
}

function syncRootEntity(entity: Entity): void {
  for (const world of entity.usedBy) {
    world.updateRootEntity(entity);
  }
}
