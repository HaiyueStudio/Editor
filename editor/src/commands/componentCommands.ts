import type { Component, Entity } from '@haiyue/engine';
import type { JsonObject } from '@haiyue/engine/components';
import type {
  Camera2DSnapshot,
  Camera3DSnapshot,
  Command,
  SphericalTransformSnapshot,
  Tilemap2DSnapshot,
  Transform2DSnapshot,
  TransformSnapshot,
} from '../types';

export interface SnapshotEditCommandOptions<TSnapshot> {
  label: string;
  entity: Entity;
  before: TSnapshot;
  after: TSnapshot;
  apply: (snapshot: TSnapshot) => void;
  onChange: (entity: Entity) => void;
}

export function snapshotEditCommand<TSnapshot>(options: SnapshotEditCommandOptions<TSnapshot>): Command {
  const { label, entity, before, after, apply, onChange } = options;
  return {
    label,
    execute: () => {
      apply(after);
      onChange(entity);
    },
    undo: () => {
      apply(before);
      onChange(entity);
    },
  };
}

export function editTransformCommand(
  options: Omit<SnapshotEditCommandOptions<TransformSnapshot>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit Transform' });
}

export function editSphericalTransformCommand(
  options: Omit<SnapshotEditCommandOptions<SphericalTransformSnapshot>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit Spherical Transform' });
}

export function editTransform2DCommand(
  options: Omit<SnapshotEditCommandOptions<Transform2DSnapshot>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit Transform2D' });
}

export function editCamera3DCommand(
  options: Omit<SnapshotEditCommandOptions<Camera3DSnapshot>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit Camera' });
}

export function editCamera2DCommand(
  options: Omit<SnapshotEditCommandOptions<Camera2DSnapshot>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit Camera' });
}

export function editMesh2DCommand<TSnapshot>(
  options: Omit<SnapshotEditCommandOptions<TSnapshot>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit Mesh2D' });
}

export function editCanvasTextCommand<TSnapshot>(
  options: Omit<SnapshotEditCommandOptions<TSnapshot>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit Canvas Text' });
}

export function editDataComponentCommand(
  options: Omit<SnapshotEditCommandOptions<JsonObject>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit DataComponent' });
}

export function editTilemap2DCommand(
  options: Omit<SnapshotEditCommandOptions<Tilemap2DSnapshot>, 'label'>,
): Command {
  return snapshotEditCommand({ ...options, label: 'Edit Tilemap2D' });
}

export interface PropertyChangeCommandOptions<TValue> {
  label: string;
  entity: Entity;
  before: TValue;
  after: TValue;
  apply: (value: TValue) => void;
  onChange: (entity: Entity) => void;
}

export function propertyChangeCommand<TValue>(options: PropertyChangeCommandOptions<TValue>): Command {
  const { label, entity, before, after, apply, onChange } = options;
  return {
    label,
    execute: () => {
      apply(after);
      onChange(entity);
    },
    undo: () => {
      apply(before);
      onChange(entity);
    },
  };
}

export function changeMeshGeometryCommand<TGeometry>(
  options: Omit<PropertyChangeCommandOptions<TGeometry>, 'label'>,
): Command {
  return propertyChangeCommand({ ...options, label: 'Change Mesh Geometry' });
}

export function changeMeshMaterialCommand<TMaterial>(
  options: Omit<PropertyChangeCommandOptions<TMaterial>, 'label'>,
): Command {
  return propertyChangeCommand({ ...options, label: 'Change Mesh Material' });
}

export function changeMesh2DMaterialCommand<TMaterial>(
  options: Omit<PropertyChangeCommandOptions<TMaterial>, 'label'>,
): Command {
  return propertyChangeCommand({ ...options, label: 'Change Mesh2D Material' });
}

export function changeMaterialTextureCommand<TTexture>(
  options: Omit<PropertyChangeCommandOptions<TTexture>, 'label'>,
): Command {
  return propertyChangeCommand({ ...options, label: 'Change Material Texture' });
}

export function changeScriptResourceCommand<TScriptResource>(
  options: Omit<PropertyChangeCommandOptions<TScriptResource>, 'label'>,
): Command {
  return propertyChangeCommand({ ...options, label: 'Change Script Resource' });
}

export interface AddComponentCommandOptions {
  entity: Entity;
  component: Component;
  beforeComponents: Component[];
  add: () => void;
  restore: (components: Component[]) => void;
  onExecute: (entity: Entity, component: Component) => void;
  onUndo: (entity: Entity, beforeComponents: Component[]) => void;
}

export function addComponentCommand(options: AddComponentCommandOptions): Command {
  const { entity, component, beforeComponents, add, restore, onExecute, onUndo } = options;
  return {
    label: 'Add Component',
    execute: () => {
      add();
      onExecute(entity, component);
    },
    undo: () => {
      restore(beforeComponents);
      onUndo(entity, beforeComponents);
    },
  };
}

export interface RemoveComponentCommandOptions {
  entity: Entity;
  component: Component;
  beforeComponents: Component[];
  remove: () => void;
  restore: (components: Component[]) => void;
  onExecute: (entity: Entity, component: Component, beforeComponents: Component[]) => void;
  onUndo: (entity: Entity, component: Component, beforeComponents: Component[]) => void;
}

export function removeComponentCommand(options: RemoveComponentCommandOptions): Command {
  const { entity, component, beforeComponents, remove, restore, onExecute, onUndo } = options;
  return {
    label: 'Remove Component',
    execute: () => {
      remove();
      onExecute(entity, component, beforeComponents);
    },
    undo: () => {
      restore(beforeComponents);
      onUndo(entity, component, beforeComponents);
    },
  };
}
