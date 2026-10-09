import type { ImageState } from './document.js';
import { paintDocument } from './canvasView.js';
export async function exportRaster(state: ImageState, format: 'png' | 'jpeg', quality: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  try {
    paintDocument(canvas, state);
    if (format === 'jpeg') { const ctx = canvas.getContext('2d')!; ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('导出失败。')), `image/${format}`, quality));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { canvas.width = canvas.height = 1; }
}
