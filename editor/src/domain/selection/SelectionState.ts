import type { Entity } from '@haiyue/engine';

export interface EditorResourceSelection {
  geometryId: number | null;
  geometry2DId: number | null;
  materialId: number | null;
  material2DId: number | null;
  textureId: number | null;
  modelId: number | null;
  prefabId: number | null;
}

export interface SelectionSnapshot {
  readonly active: Entity | null;
  readonly entities: ReadonlySet<Entity>;
  readonly resources: Readonly<EditorResourceSelection>;
}

export interface SelectionController {
  readonly active: Entity | null;
  readonly selection: Set<Entity>;
  readonly size: number;
  setActive(entity: Entity | null): void;
  setSelection(selection: ReadonlySet<Entity>, active?: Entity | null): void;
  setEntities(entities: readonly Entity[], active?: Entity | null): void;
  clear(): void;
}

const EMPTY_RESOURCES: EditorResourceSelection = {
  geometryId: null, geometry2DId: null, materialId: null, material2DId: null,
  textureId: null, modelId: null, prefabId: null,
};

export class SelectionState implements SelectionController {
  private _active: Entity | null = null;
  private _selection = new Set<Entity>();
  private _resources: EditorResourceSelection;

  constructor(
    private readonly _changed: (snapshot: SelectionSnapshot) => void = () => {},
    resources: Partial<EditorResourceSelection> = {},
  ) {
    this._resources = { ...EMPTY_RESOURCES, ...resources };
  }

  get active(): Entity | null { return this._active; }
  /** Returns a copy so callers cannot mutate domain state without a command. */
  get selection(): Set<Entity> { return new Set(this._selection); }
  get size(): number { return this._selection.size; }

  snapshot(): SelectionSnapshot {
    return Object.freeze({
      active: this._active,
      entities: new Set(this._selection),
      resources: Object.freeze({ ...this._resources }),
    });
  }

  setSelection(selection: ReadonlySet<Entity>, active?: Entity | null): void {
    const nextActive = active === undefined ? getLastEntity(selection) : active;
    if (nextActive === this._active && sameEntitySet(this._selection, selection)) return;
    this._selection = new Set(selection);
    this._active = nextActive;
    this._changed(this.snapshot());
  }

  setEntities(entities: readonly Entity[], active?: Entity | null): void {
    this.setSelection(new Set(entities), active === undefined ? entities.at(-1) ?? null : active);
  }

  setActive(entity: Entity | null): void {
    if (entity === this._active) return;
    this._active = entity;
    this._changed(this.snapshot());
  }

  setResourceSelection(selection: Partial<EditorResourceSelection>): void {
    this._resources = { ...this._resources, ...selection };
    this._changed(this.snapshot());
  }

  clearResourceSelection(): void { this.setResourceSelection(EMPTY_RESOURCES); }

  clearResourceIf(type: keyof EditorResourceSelection, id: number): void {
    if (this._resources[type] !== id) return;
    this.setResourceSelection({ [type]: null });
  }

  clear(): void {
    this._selection.clear();
    this._active = null;
    this._resources = { ...EMPTY_RESOURCES };
    this._changed(this.snapshot());
  }

  restore(snapshot: SelectionSnapshot): void {
    this._active = snapshot.active;
    this._selection = new Set(snapshot.entities);
    this._resources = { ...snapshot.resources };
  }
}

function getLastEntity(selection: ReadonlySet<Entity>): Entity | null {
  let last: Entity | null = null;
  for (const entity of selection) last = entity;
  return last;
}

function sameEntitySet(left: ReadonlySet<Entity>, right: ReadonlySet<Entity>): boolean {
  if (left.size !== right.size) return false;
  for (const entity of left) {
    if (!right.has(entity)) return false;
  }
  return true;
}
