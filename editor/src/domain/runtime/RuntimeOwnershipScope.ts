export interface RuntimeEngineOwner {
  stop(): unknown;
  destroy(): unknown;
}

export interface RuntimeWorldOwner {
  destroy(): unknown;
}

export interface RuntimeDisposableOwner {
  destroy(): unknown;
}

/** Single teardown order shared by play start, restart, stop, and failure cleanup. */
export class RuntimeOwnershipScope {
  private engine: RuntimeEngineOwner | null = null;
  private world: RuntimeWorldOwner | null = null;
  private pointer: RuntimeDisposableOwner | null = null;

  bindEngine(engine: RuntimeEngineOwner): this { this.engine = engine; return this; }
  bindWorld(world: RuntimeWorldOwner): this { this.world = world; return this; }
  bindPointer(pointer: RuntimeDisposableOwner): this { this.pointer = pointer; return this; }

  release(): void {
    const engine = this.engine;
    const world = this.world;
    const pointer = this.pointer;
    this.engine = null;
    this.world = null;
    this.pointer = null;
    engine?.stop();
    world?.destroy();
    pointer?.destroy();
    engine?.destroy();
  }
}
