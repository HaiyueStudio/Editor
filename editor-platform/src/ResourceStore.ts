import type { EditorDisposable } from '@haiyue/editor-plugin-sdk';

/** Owned binary resources. JSON operations carry handles, never pixel arrays. */
export class EditorResourceStore implements EditorDisposable {
  private items = new Map<string, Uint8Array>();
  private bytes = 0;
  private nextId = 0;
  private disposed = false;
  constructor(private readonly byteBudget = 256 * 1024 * 1024, private readonly maxItems = 64) {
    if (!Number.isSafeInteger(byteBudget) || byteBudget < 1 || !Number.isSafeInteger(maxItems) || maxItems < 1) throw new RangeError('Invalid resource limits.');
  }
  put(bytes: Uint8Array): { resourceId: string; byteLength: number } {
    if (this.disposed) throw new Error('Resource store is disposed.');
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array.');
    if (this.items.size >= this.maxItems || bytes.byteLength + this.bytes > this.byteBudget) throw new RangeError('Resource budget exceeded; release unused resources.');
    const owned = new Uint8Array(bytes), resourceId = `resource-${crypto.randomUUID()}-${++this.nextId}`;
    this.items.set(resourceId, owned); this.bytes += owned.byteLength;
    return { resourceId, byteLength: owned.byteLength };
  }
  read(resourceId: string, offset = 0, length?: number): Uint8Array {
    const bytes = this.items.get(resourceId);
    if (!bytes) throw new Error('Resource is unavailable.');
    const count = length ?? bytes.length - offset;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(count) || offset < 0 || count < 0 || offset + count > bytes.length) throw new RangeError('Invalid resource range.');
    return bytes.slice(offset, offset + count);
  }
  size(resourceId: string): number {
    const bytes = this.items.get(resourceId);
    if (!bytes) throw new Error('Resource is unavailable.');
    return bytes.length;
  }
  release(resourceId: string): void {
    const bytes = this.items.get(resourceId);
    if (bytes) { this.bytes -= bytes.byteLength; this.items.delete(resourceId); }
  }
  dispose(): void { this.disposed = true; this.items.clear(); this.bytes = 0; }
}
