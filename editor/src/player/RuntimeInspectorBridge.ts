import {
  Camera2D,
  Camera3D,
  CartesianTransform3D,
  type Component,
  type Entity,
  SphericalTransform3D,
  Transform2D,
  type World,
} from '@haiyue/engine';
import { DataComponent } from '@haiyue/engine/components';
import { getEditorOrigin, type RuntimeInspectorFieldEdit } from './PlayerProtocol';

type RuntimeInspectorFieldType = 'boolean' | 'json' | 'number' | 'select' | 'string';

interface RuntimeInspectorFieldSnapshot {
  path: string;
  label: string;
  type: RuntimeInspectorFieldType;
  value: unknown;
  options?: { label: string; value: string }[];
}

/** Owns runtime selection, editable field projection, and snapshot deduplication. */
export class RuntimeInspectorBridge {
  private revision = 0;
  private lastFingerprint: number | null = null;
  private selectedId: number | null = null;

  constructor(private readonly resolveWorld: () => World | null) {}

  get selectedEntityId(): number | null { return this.selectedId; }

  select(entityId: number | null, post = true): void {
    this.selectedId = entityId;
    this.lastFingerprint = null;
    if (post) this.postSnapshot();
  }

  reset(): void {
    this.selectedId = null;
    this.lastFingerprint = null;
  }

  sync(): void {
    const world = this.resolveWorld();
    if (!world) return;
    const entity = this.selectedId == null ? null : world.getEntity(this.selectedId);
    const fingerprint = getInspectorFingerprint(entity, world.structureVersion);
    if (fingerprint !== this.lastFingerprint) this.postSnapshot();
  }

  postSnapshot(): void {
    const world = this.resolveWorld();
    if (!world) return;
    const entity = this.selectedId == null ? null : world.getEntity(this.selectedId);
    this.lastFingerprint = getInspectorFingerprint(entity, world.structureVersion);
    window.parent.postMessage({
      type: 'game-editor-player-inspector',
      revision: ++this.revision,
      time: Date.now(),
      snapshot: entity ? {
        entity: { id: entity.id, name: entity.name, disabled: entity.disabled, fields: getEntityFields(entity) },
        components: [...entity.components.values()].map(component => ({
          id: component.id,
          name: component.name,
          type: component.constructor.name,
          disabled: component.disabled,
          destroyed: component.destroyed,
          fields: getComponentFields(component),
        })),
      } : null,
    }, getEditorOrigin());
  }

  applyEdit(edit: RuntimeInspectorFieldEdit): void {
    const world = this.resolveWorld();
    if (!world || !edit.path) {
      postEditResult(false, edit, 'Runtime world or edit path is not available.');
      return;
    }
    const entity = world.getEntity(Number(edit.entityId));
    if (!entity) {
      postEditResult(false, edit, `Entity ${edit.entityId ?? ''} was not found.`);
      return;
    }
    let applied = false;
    if (edit.componentId == null) {
      if (edit.path === 'name') {
        entity.name = String(edit.value ?? '');
        applied = true;
      } else if (edit.path === 'disabled') {
        entity.disabled = Boolean(edit.value);
        applied = true;
      }
    } else {
      const component = entity.components.get(Number(edit.componentId));
      if (component) applied = applyComponentFieldEdit(component, edit.path, edit.value);
    }
    postEditResult(applied, edit, applied ? undefined : `Field "${edit.path}" is not editable.`);
    if (applied) this.postSnapshot();
  }
}

function createField(
  path: string,
  label: string,
  type: RuntimeInspectorFieldType,
  value: unknown,
  options?: { label: string; value: string }[],
): RuntimeInspectorFieldSnapshot {
  return { path, label, type, value, ...(options === undefined ? {} : { options }) };
}

function createVectorFields(prefix: string, label: string, values: ArrayLike<number>, axes: string[]): RuntimeInspectorFieldSnapshot[] {
  return axes.map((axis, index) => createField(`${prefix}.${index}`, `${label} ${axis}`, 'number', values[index] ?? 0));
}

function getEntityFields(entity: Entity): RuntimeInspectorFieldSnapshot[] {
  return [
    createField('name', 'Name', 'string', entity.name),
    createField('disabled', 'Disabled', 'boolean', entity.disabled),
  ];
}

function getComponentFields(component: Component): RuntimeInspectorFieldSnapshot[] {
  const fields: RuntimeInspectorFieldSnapshot[] = [createField('disabled', 'Disabled', 'boolean', component.disabled)];
  if (component instanceof Transform2D) {
    fields.push(
      createField('x', 'X', 'number', component.x),
      createField('y', 'Y', 'number', component.y),
      createField('rotation', 'Rotation', 'number', component.rotation),
      createField('scaleX', 'Scale X', 'number', component.scaleX),
      createField('scaleY', 'Scale Y', 'number', component.scaleY),
    );
  } else if (component instanceof CartesianTransform3D) {
    fields.push(
      ...createVectorFields('position', 'Position', component.position, ['X', 'Y', 'Z']),
      ...createVectorFields('rotation', 'Rotation', component.rotation, ['X', 'Y', 'Z']),
      ...createVectorFields('scale', 'Scale', component.scale, ['X', 'Y', 'Z']),
    );
  } else if (component instanceof SphericalTransform3D) {
    fields.push(
      createField('radius', 'Radius', 'number', component.radius),
      createField('theta', 'Theta', 'number', component.theta),
      createField('phi', 'Phi', 'number', component.phi),
      ...createVectorFields('target', 'Target', component.target, ['X', 'Y', 'Z']),
    );
  } else if (component instanceof Camera3D) {
    fields.push(
      createField('projectionType', 'Projection', 'select', component.projectionType, [
        { label: 'Perspective', value: 'perspective' },
        { label: 'Orthographic', value: 'orthographic' },
      ]),
      createField('fov', 'FOV', 'number', component.fov),
      createField('near', 'Near', 'number', component.near),
      createField('far', 'Far', 'number', component.far),
      createField('reverseZ', 'Reverse Z', 'boolean', component.reverseZ),
      createField('orthoLeft', 'Ortho Left', 'number', component.orthoLeft),
      createField('orthoRight', 'Ortho Right', 'number', component.orthoRight),
      createField('orthoTop', 'Ortho Top', 'number', component.orthoTop),
      createField('orthoBottom', 'Ortho Bottom', 'number', component.orthoBottom),
    );
  } else if (component instanceof Camera2D) {
    fields.push(
      createField('width', 'Width', 'number', component.width),
      createField('height', 'Height', 'number', component.height),
      createField('zoom', 'Zoom', 'number', component.zoom),
      createField('near', 'Near', 'number', component.near),
      createField('far', 'Far', 'number', component.far),
      createField('viewportMode', 'Viewport Mode', 'select', component.viewportMode, [
        { label: 'Expand', value: 'expand' },
        { label: 'Fit', value: 'fit' },
        { label: 'Fill', value: 'fill' },
        { label: 'Fixed', value: 'fixed' },
      ]),
      createField('designWidth', 'Design Width', 'number', component.designWidth),
      createField('designHeight', 'Design Height', 'number', component.designHeight),
    );
  } else if (component instanceof DataComponent) {
    fields.push(createField('value', 'JSON', 'json', component.value));
  }
  return fields;
}

function getInspectorFingerprint(entity: Entity | null | undefined, structureVersion: number): number {
  if (!entity) return 0;
  let hash = mixHash(2166136261, entity.id);
  hash = mixHash(hash, entity.name);
  hash = mixHash(hash, entity.disabled);
  hash = mixHash(hash, structureVersion);
  for (const component of entity.components.values()) {
    hash = mixHash(hash, component.id);
    hash = mixHash(hash, component.disabled);
    hash = mixHash(hash, component.destroyed);
    if (component instanceof Transform2D) {
      hash = mixHash(hash, component.x);
      hash = mixHash(hash, component.y);
      hash = mixHash(hash, component.rotation);
      hash = mixHash(hash, component.scaleX);
      hash = mixHash(hash, component.scaleY);
    } else if (component instanceof CartesianTransform3D) {
      hash = mixVector(hash, component.position);
      hash = mixVector(hash, component.rotation);
      hash = mixVector(hash, component.scale);
    } else if (component instanceof SphericalTransform3D) {
      hash = mixHash(hash, component.radius);
      hash = mixHash(hash, component.theta);
      hash = mixHash(hash, component.phi);
      hash = mixVector(hash, component.target);
    } else if (component instanceof Camera3D) {
      hash = mixHash(hash, component.projectionType);
      hash = mixHash(hash, component.fov);
      hash = mixHash(hash, component.near);
      hash = mixHash(hash, component.far);
      hash = mixHash(hash, component.reverseZ);
      hash = mixHash(hash, component.orthoLeft);
      hash = mixHash(hash, component.orthoRight);
      hash = mixHash(hash, component.orthoTop);
      hash = mixHash(hash, component.orthoBottom);
    } else if (component instanceof Camera2D) {
      hash = mixHash(hash, component.width);
      hash = mixHash(hash, component.height);
      hash = mixHash(hash, component.zoom);
      hash = mixHash(hash, component.near);
      hash = mixHash(hash, component.far);
      hash = mixHash(hash, component.viewportMode);
      hash = mixHash(hash, component.designWidth);
      hash = mixHash(hash, component.designHeight);
    }
  }
  return hash >>> 0;
}

function mixVector(hash: number, values: ArrayLike<number>): number {
  for (let index = 0; index < values.length; index++) hash = mixHash(hash, values[index] ?? 0);
  return hash;
}

function mixHash(hash: number, value: string | number | boolean): number {
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return hash;
  }
  const normalized = typeof value === 'boolean' ? Number(value) : Math.round(value * 1_000_000);
  return Math.imul(hash ^ normalized, 16777619);
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function setVectorValue(component: CartesianTransform3D | SphericalTransform3D, path: string, value: unknown): boolean {
  const [key, indexText] = path.split('.');
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 0 || index > 2) return false;
  if (component instanceof CartesianTransform3D) {
    if (key === 'position') {
      const next = [...component.position] as [number, number, number];
      next[index] = toFiniteNumber(value, next[index] ?? 0);
      component.setPosition(next[0], next[1], next[2]);
      return true;
    }
    if (key === 'rotation') {
      const next = [...component.rotation] as [number, number, number];
      next[index] = toFiniteNumber(value, next[index] ?? 0);
      component.setRotation(next[0], next[1], next[2]);
      return true;
    }
    if (key === 'scale') {
      const next = [...component.scale] as [number, number, number];
      next[index] = toFiniteNumber(value, next[index] ?? 1);
      component.setScale(next[0], next[1], next[2]);
      return true;
    }
  }
  if (component instanceof SphericalTransform3D && key === 'target') {
    const next = [...component.target] as [number, number, number];
    next[index] = toFiniteNumber(value, next[index] ?? 0);
    component.setTarget(next[0], next[1], next[2]);
    return true;
  }
  return false;
}

function applyComponentFieldEdit(component: Component, path: string, value: unknown): boolean {
  if (path === 'disabled') {
    component.disabled = Boolean(value);
    return true;
  }
  if (component instanceof Transform2D) {
    if (path === 'x') component.x = toFiniteNumber(value, component.x);
    else if (path === 'y') component.y = toFiniteNumber(value, component.y);
    else if (path === 'rotation') component.rotation = toFiniteNumber(value, component.rotation);
    else if (path === 'scaleX') component.scaleX = toFiniteNumber(value, component.scaleX);
    else if (path === 'scaleY') component.scaleY = toFiniteNumber(value, component.scaleY);
    else return false;
    return true;
  }
  if (component instanceof CartesianTransform3D || component instanceof SphericalTransform3D) {
    if (setVectorValue(component, path, value)) return true;
    if (component instanceof SphericalTransform3D) {
      if (path === 'radius') component.radius = toFiniteNumber(value, component.radius);
      else if (path === 'theta') component.theta = toFiniteNumber(value, component.theta);
      else if (path === 'phi') component.phi = toFiniteNumber(value, component.phi);
      else return false;
      return true;
    }
  }
  if (component instanceof Camera3D) {
    if (path === 'projectionType' && (value === 'perspective' || value === 'orthographic')) component.projectionType = value;
    else if (path === 'fov') component.fov = toFiniteNumber(value, component.fov);
    else if (path === 'near') component.near = toFiniteNumber(value, component.near);
    else if (path === 'far') component.far = toFiniteNumber(value, component.far);
    else if (path === 'reverseZ') component.reverseZ = Boolean(value);
    else if (path === 'orthoLeft') component.orthoLeft = toFiniteNumber(value, component.orthoLeft);
    else if (path === 'orthoRight') component.orthoRight = toFiniteNumber(value, component.orthoRight);
    else if (path === 'orthoTop') component.orthoTop = toFiniteNumber(value, component.orthoTop);
    else if (path === 'orthoBottom') component.orthoBottom = toFiniteNumber(value, component.orthoBottom);
    else return false;
    component.setDirty();
    return true;
  }
  if (component instanceof Camera2D) {
    if (path === 'width') component.width = Math.max(1, toFiniteNumber(value, component.width));
    else if (path === 'height') component.height = Math.max(1, toFiniteNumber(value, component.height));
    else if (path === 'zoom') component.zoom = Math.max(0.001, toFiniteNumber(value, component.zoom));
    else if (path === 'near') component.near = toFiniteNumber(value, component.near);
    else if (path === 'far') component.far = toFiniteNumber(value, component.far);
    else if (path === 'viewportMode' && (value === 'expand' || value === 'fit' || value === 'fill' || value === 'fixed')) component.viewportMode = value;
    else if (path === 'designWidth') component.designWidth = Math.max(1, toFiniteNumber(value, component.designWidth));
    else if (path === 'designHeight') component.designHeight = Math.max(1, toFiniteNumber(value, component.designHeight));
    else return false;
    component.resize(component.width, component.height);
    return true;
  }
  if (component instanceof DataComponent && path === 'value' && value && typeof value === 'object' && !Array.isArray(value)) {
    component.value = value as Record<string, never>;
    return true;
  }
  return false;
}

function postEditResult(success: boolean, edit: RuntimeInspectorFieldEdit, message?: string): void {
  window.parent.postMessage({
    type: 'game-editor-player-field-edit-result',
    time: Date.now(),
    success,
    edit,
    message,
  }, getEditorOrigin());
}
