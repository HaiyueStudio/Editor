import { Entity, World } from '@haiyue/engine';

export class EditorEntityLookupIndex {
  private readonly byId = new Map<number, Entity>();
  private readonly byName = new Map<string, Set<Entity>>();
  private indexedSize = -1;

  constructor(private readonly world: World) {}

  find(nameOrId: string | number): Entity | null {
    this.sync();
    if (typeof nameOrId === 'number') return this.world.getEntity(nameOrId) ?? null;
    const numericId = Number(nameOrId);
    if (Number.isInteger(numericId) && String(numericId) === nameOrId) {
      const byId = this.world.getEntity(numericId);
      if (byId) return byId;
    }
    const set = this.byName.get(nameOrId);
    if (!set) {
      this.rebuild();
      return this.byName.get(nameOrId)?.values().next().value ?? null;
    }
    for (const entity of set) {
      if (this.isCurrentNameMatch(entity, nameOrId)) return entity;
    }
    this.rebuild();
    return this.byName.get(nameOrId)?.values().next().value ?? null;
  }

  findAll(name?: string): Entity[] {
    this.sync();
    if (name === undefined) return Array.from(this.world.entities.values());
    const set = this.byName.get(name);
    if (!set) {
      this.rebuild();
      return Array.from(this.byName.get(name) ?? []);
    }
    const result: Entity[] = [];
    let stale = false;
    for (const entity of set) {
      if (this.isCurrentNameMatch(entity, name)) result.push(entity);
      else stale = true;
    }
    if (!stale) return result;
    this.rebuild();
    return Array.from(this.byName.get(name) ?? []);
  }

  add(entity: Entity): void {
    this.sync();
    this.indexEntity(entity);
    this.indexedSize = this.world.entities.size;
  }

  remove(entity: Entity): void {
    this.unindexEntity(entity);
    this.indexedSize = this.world.entities.size;
  }

  invalidate(): void {
    this.indexedSize = -1;
  }

  private sync(): void {
    if (this.indexedSize === this.world.entities.size) return;
    this.rebuild();
  }

  private rebuild(): void {
    this.byId.clear();
    this.byName.clear();
    for (const entity of this.world.entities.values()) this.indexEntity(entity);
    this.indexedSize = this.world.entities.size;
  }

  private indexEntity(entity: Entity): void {
    this.byId.set(entity.id, entity);
    let set = this.byName.get(entity.name);
    if (!set) {
      set = new Set();
      this.byName.set(entity.name, set);
    }
    set.add(entity);
  }

  private unindexEntity(entity: Entity): void {
    this.byId.delete(entity.id);
    for (const [name, set] of this.byName) {
      if (!set.delete(entity)) continue;
      if (set.size === 0) this.byName.delete(name);
      break;
    }
  }

  private isCurrentNameMatch(entity: Entity, name: string): boolean {
    return this.world.entities.has(entity.id) && entity.name === name;
  }
}
