import type { Layer, Psd } from 'ag-psd';
import { checkSize, IMAGE_LIMITS } from './document.js';

export interface PsdMemoryEstimate {
  paged?:boolean;
  fileBytes: number;
  layerCount: number;
  layerPixelBytes: number;
  compositePixelBytes: number;
  estimatedDecodedBytes: number;
  limitBytes: number;
  compositeOnly: boolean;
}

/** Admission uses decoded storage, never the compressed file size. No pixel allocation here. */
export function estimatePsdMemory(psd: Psd, fileBytes: number, depth: number, cmyk: boolean): PsdMemoryEstimate {
  checkSize(psd.width, psd.height);
  const rgbaBytes = depth === 8 ? 4 : 16, pixelBytes = rgbaBytes + (cmyk ? 16 : 0);
  const compositePixelBytes = psd.width * psd.height * pixelBytes;
  let layerPixelBytes = 0, layerCount = 0;
  const visit = (layers: Layer[], nesting: number) => {
    if (nesting > IMAGE_LIMITS.depth) throw new Error('PSD 分组嵌套超过限制。');
    for (const layer of layers) {
      if (++layerCount > IMAGE_LIMITS.layers) throw new Error('PSD 图层超过 128 个。');
      for (const area of [layer, layer.mask, layer.realMask]) if (area) {
        const w = (area.right ?? 0) - (area.left ?? 0), h = (area.bottom ?? 0) - (area.top ?? 0);
        if (w < 0 || h < 0) throw new Error('PSD 图层范围无效。');
        if (w && h) checkSize(w, h);
        // RGB codec allocates group rectangles too; masks decode to RGBA before conversion.
        layerPixelBytes += w * h * pixelBytes;
      }
      if (layer.children) visit(layer.children, nesting + 1);
    }
  };
  visit(psd.children ?? [], 0);
  const estimatedDecodedBytes = layerPixelBytes + compositePixelBytes;
  return { fileBytes, layerCount, layerPixelBytes, compositePixelBytes, estimatedDecodedBytes,
    limitBytes: IMAGE_LIMITS.bytes, compositeOnly: estimatedDecodedBytes > IMAGE_LIMITS.bytes };
}

export const memoryMiB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MiB';
