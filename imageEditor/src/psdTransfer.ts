/** Collect unique buffers without traversing individual samples or transferring a live document. */
export function psdTransferBuffers(result: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>(), seen = new Set<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof ArrayBuffer) buffers.add(value);
    else if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
    } else for (const child of Object.values(value)) visit(child);
  };
  visit(result);
  return [...buffers];
}
