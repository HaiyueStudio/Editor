import type { EditorCommand } from '@haiyue/editor-plugin-sdk';
import type { ImageState, ImageLayer } from './document.js';

const TILE = 128;
interface Patch { x: number; y: number; width: number; height: number; xor: Uint8Array }
function replace(layers: readonly ImageLayer[], id: string, bitmap: ImageLayer['bitmap']): readonly ImageLayer[] {
  return layers.map(layer => layer.id === id ? { ...layer, bitmap } : layer.children.length ? { ...layer, children: replace(layer.children, id, bitmap) } : layer);
}
function find(layers: readonly ImageLayer[], id: string): ImageLayer | undefined {
  for (const layer of layers) { if (layer.id === id) return layer; const child = find(layer.children, id); if (child) return child; }
}
function retainedBytes(state: ImageState): number {
  const visit = (layers: readonly ImageLayer[]): number => layers.reduce((sum, l) => sum + (l.bitmap?.data.byteLength ?? 0) + (l.mask?.data.byteLength ?? 0) + visit(l.children), 0);
  return visit(state.layers) + (state.selection?.mask?.byteLength ?? 0) + (state.psdOrigin?.resources.byteLength ?? 0);
}
/** Same-size pixel edits retain only changed 128px tiles, with reversible XOR bytes. */
export function pixelHistory(label: string, before: ImageState, after: ImageState, id: string, read: () => ImageState, write: (state: ImageState) => void, bounds?: { x: number; y: number; width: number; height: number }): EditorCommand | undefined {
  const a = find(before.layers, id)?.bitmap, b = find(after.layers, id)?.bitmap;
  if (!a || !b || a.width !== b.width || a.height !== b.height) return;
  const patches: Patch[] = [];
  for (let y = bounds ? Math.floor(bounds.y / TILE) * TILE : 0; y < (bounds ? bounds.y + bounds.height : a.height); y += TILE) for (let x = bounds ? Math.floor(bounds.x / TILE) * TILE : 0; x < (bounds ? bounds.x + bounds.width : a.width); x += TILE) {
    const width = Math.min(TILE, a.width - x), height = Math.min(TILE, a.height - y);
    let changed = false;
    for (let row = 0; row < height && !changed; row++) {
      const start = ((y + row) * a.width + x) * 4;
      for (let i = start; i < start + width * 4; i++) if (a.data[i] !== b.data[i]) { changed = true; break; }
    }
    if (!changed) continue;
    const xor = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row++) for (let column = 0; column < width * 4; column++) {
      const i = ((y + row) * a.width + x) * 4 + column;
      xor[row * width * 4 + column] = a.data[i]! ^ b.data[i]!;
    }
    patches.push({ x, y, width, height, xor });
  }
  // Factory closure owns stripped metadata and deltas, never the dense before/after buffers.
  return command(label, id, { ...before, layers: replace(before.layers, id, null) }, { ...after, layers: replace(after.layers, id, null) },
    new WeakRef(before), new WeakRef(after), patches, read, write);
}
function command(label: string, id: string, before: ImageState, after: ImageState, beforeRef: WeakRef<ImageState>, afterRef: WeakRef<ImageState>, patches: Patch[], read: () => ImageState, write: (state: ImageState) => void): EditorCommand {
  const apply = (metadata: ImageState, ref: WeakRef<ImageState>) => {
    const cached = ref.deref(); if (cached) { write(cached); return; }
    const bitmap = find(read().layers, id)?.bitmap;
    if (!bitmap) throw new Error('撤销像素基底缺失。');
    const data = bitmap.data.slice();
    for (const patch of patches) for (let row = 0; row < patch.height; row++) for (let column = 0; column < patch.width * 4; column++) {
      const i = ((patch.y + row) * bitmap.width + patch.x) * 4 + column;
      data[i] = data[i]! ^ patch.xor[row * patch.width * 4 + column]!;
    }
    write({ ...metadata, layers: replace(metadata.layers, id, { width: bitmap.width, height: bitmap.height, data }) });
  };
  return { label, estimatedBytes: 1024 + retainedBytes(before) + retainedBytes(after) + patches.reduce((sum, p) => sum + p.xor.byteLength + 32, 0),
    execute: () => apply(after, afterRef), undo: () => apply(before, beforeRef), dispose: () => { patches.length = 0; } };
}
