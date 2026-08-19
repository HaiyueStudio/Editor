import type { EditorDisposer, EditorLifecycleScopePort } from '@haiyue/editor-plugin-sdk';

interface OwnedResource {
  active: boolean;
  dispose: () => void | Promise<void>;
}

export class EditorLifecycleScope implements EditorLifecycleScopePort {
  private readonly resources: OwnedResource[] = [];
  private closing: Promise<void> | null = null;
  private isDisposed = false;

  constructor(readonly id: string) {
    if (!id.trim()) throw new TypeError('Lifecycle scope id is required.');
  }

  get disposed(): boolean { return this.isDisposed; }

  own<T extends EditorDisposer>(resource: T): T {
    this.assertActive();
    this.resources.push({ active: true, dispose: toDisposer(resource) });
    return resource;
  }

  defer(dispose: () => void | Promise<void>): () => void {
    this.assertActive();
    const resource: OwnedResource = { active: true, dispose };
    this.resources.push(resource);
    return () => { resource.active = false; };
  }

  fork(id: string): EditorLifecycleScope {
    const child = new EditorLifecycleScope(`${this.id}/${id}`);
    this.own(child);
    return child;
  }

  assertActive(): void {
    if (this.isDisposed || this.closing) throw new Error(`Lifecycle scope ${this.id} is disposed.`);
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.isDisposed) return Promise.resolve();
    this.closing = this.disposeOwned();
    return this.closing;
  }

  private async disposeOwned(): Promise<void> {
    const errors: unknown[] = [];
    this.isDisposed = true;
    for (const resource of this.resources.splice(0).reverse()) {
      if (!resource.active) continue;
      resource.active = false;
      try { await resource.dispose(); }
      catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `Lifecycle scope ${this.id} disposal failed.`);
  }
}

function toDisposer(resource: EditorDisposer): () => void | Promise<void> {
  if (typeof resource === 'function') return resource;
  if (resource && typeof resource.dispose === 'function') return () => resource.dispose();
  throw new TypeError('Owned resource must be a disposer function or implement dispose().');
}
