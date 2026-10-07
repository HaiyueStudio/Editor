import { initializeCanvas, readPsd, writePsdUint8Array, type Psd, type Layer, type PixelData } from 'ag-psd';

// P0 uses straight-alpha byte arrays exclusively. No canvas alpha premultiplication.
initializeCanvas(() => { throw new Error('P0 does not use Canvas'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' } as ImageData));

export class PsdAdmissionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export interface Diagnostic { code: string; path: string; detail: string }
export interface PsdInspection { document: Psd; diagnostics: Diagnostic[]; estimatedPixelBytes: number; resourceIds?: number[] }
export const P0_LIMITS = Object.freeze({ fileBytes: 128 * 1024 * 1024, pixelBytes: 256 * 1024 * 1024, layers: 512, depth: 32, dimension: 16384 });

export function inspectHeader(bytes: Uint8Array) {
  if (bytes.byteLength < 26) throw new PsdAdmissionError('truncated-header', 'PSD header requires 26 bytes');
  if (bytes.byteLength > P0_LIMITS.fileBytes) throw new PsdAdmissionError('file-budget', 'P0 input file limit exceeded');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0) !== 0x38425053) throw new PsdAdmissionError('invalid-signature', 'Expected 8BPS');
  if (v.getUint16(4) !== 1) throw new PsdAdmissionError('unsupported-version', 'P0 accepts PSD v1 only; PSB excluded');
  for (let i = 6; i < 12; i++) if (bytes[i] !== 0) throw new PsdAdmissionError('invalid-reserved', 'Reserved header bytes must be zero');
  const channels = v.getUint16(12), height = v.getUint32(14), width = v.getUint32(18);
  const depth = v.getUint16(22), mode = v.getUint16(24);
  if (depth !== 8) throw new PsdAdmissionError('unsupported-depth', `P0 requires 8-bit; got ${depth}`);
  if (mode !== 3) throw new PsdAdmissionError('unsupported-color-mode', `P0 requires RGB (3); got ${mode}`);
  if (channels < 3 || channels > 56) throw new PsdAdmissionError('invalid-channels', `Invalid RGB channel count ${channels}`);
  if (!width || !height || width > P0_LIMITS.dimension || height > P0_LIMITS.dimension || width * height * 4 > P0_LIMITS.pixelBytes)
    throw new PsdAdmissionError('canvas-budget', 'Invalid or over-budget canvas dimensions');
  return { width, height, channels, depth, mode };
}

export function inspectPsd(bytes: Uint8Array): PsdInspection {
  const header = inspectHeader(bytes);
  const diagnostics: Diagnostic[] = [];
  const warnings = new Set<string>();
  const options = { useImageData: true, useRawThumbnail: true, totalMemoryLimit: P0_LIMITS.pixelBytes,
    logMissingFeatures: true, log: (...args: unknown[]) => { warnings.add(args.map(String).join(' ')); } };
  try {
    const resourceIds = imageResourceIds(bytes);
    if (resourceIds.includes(1039)) diagnostics.push({ code: 'icc-profile', path: '/', detail: 'ag-psd 31.0.2 does not preserve the ICC resource; color-managed editing is unverified' });
    // Inspect geometry before any channel decompression, including off-canvas layers and masks.
    const structure = readPsd(bytes, { ...options, useRawData: true });
    let estimatedPixelBytes = header.width * header.height * 4, count = 0;
    const visit = (layers: Layer[], depth: number) => {
      if (depth > P0_LIMITS.depth) throw new PsdAdmissionError('layer-depth', 'Layer nesting limit exceeded');
      for (const layer of layers) {
        if (++count > P0_LIMITS.layers) throw new PsdAdmissionError('layer-count', 'Layer count limit exceeded');
        for (const area of [layer, layer.mask, layer.realMask]) {
          if (!area) continue;
          const w = (area.right ?? 0) - (area.left ?? 0), h = (area.bottom ?? 0) - (area.top ?? 0);
          if (w < 0 || h < 0 || w > P0_LIMITS.dimension || h > P0_LIMITS.dimension)
            throw new PsdAdmissionError('layer-budget', 'Invalid or over-budget layer/mask bounds');
          estimatedPixelBytes += w * h * 4;
        }
        if (estimatedPixelBytes > P0_LIMITS.pixelBytes) throw new PsdAdmissionError('pixel-budget', 'Decoded pixel budget exceeded');
        if (layer.children) visit(layer.children, depth + 1);
      }
    };
    visit(structure.children ?? [], 0);
    const document = readPsd(bytes, options);
    for (const warning of warnings) diagnostics.push({ code: 'parser-warning', path: '/', detail: warning });
    if (header.channels > 4) diagnostics.push({ code: 'extra-channels', path: '/', detail: 'Extra channels are outside the P0 editing contract' });
    diagnostics.push(...editingDiagnostics(document));
    return { document, diagnostics, estimatedPixelBytes, resourceIds };
  } catch (error) {
    if (error instanceof PsdAdmissionError) throw error;
    throw new PsdAdmissionError('decode-failed', error instanceof Error ? error.message : String(error));
  }
}

export function editingDiagnostics(document: Psd): Diagnostic[] {
  const result: Diagnostic[] = [];
  const add = (code: string, path: string, detail = code) => result.push({ code, path, detail });
  if (document.artboards) add('artboards', '/');
  const visit = (layers: Layer[], parent: string) => {
    layers.forEach((layer, i) => {
      const path = `${parent}/${i}:${layer.name ?? '(unnamed)'}`;
      for (const key of ['text', 'vectorFill', 'vectorStroke', 'vectorMask', 'placedLayer', 'adjustment', 'effects', 'mask', 'realMask', 'artboard', 'filterMask'] as const) {
        if (layer[key as keyof Layer] !== undefined) add(key, path);
      }
      if (layer.clipping) add('clipping', path);
      if (layer.knockout) add('knockout', path);
      const ranges = layer.blendingRanges;
      if (ranges && [ranges.compositeGrayBlendSource, ranges.compositeGraphBlendDestinationRange,
        ...ranges.ranges.flatMap(r => [r.sourceRange, r.destRange])].some(r => r.join(',') !== '0,0,255,255')) add('blend-if', path);
      if (layer.fillOpacity !== undefined && layer.fillOpacity !== 1) add('fill-opacity', path);
      const mode = layer.blendMode ?? 'normal';
      if (!['normal', 'multiply', 'screen'].includes(mode) && !(layer.children && mode === 'pass through')) add('blend-mode', path, mode);
      if (layer.children) {
        if (mode === 'pass through' && (layer.opacity ?? 1) !== 1) add('pass-through-opacity', path);
        visit(layer.children, path);
      } else if (!layer.imageData && (layer.right ?? 0) > (layer.left ?? 0) && (layer.bottom ?? 0) > (layer.top ?? 0)) add('missing-pixels', path);
    });
  };
  visit(document.children ?? [], '');
  return result;
}

export function pixelData(width: number, height: number): PixelData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

// Reference CPU compositor: encoded RGB, straight alpha, bottom-to-top layer order.
// This is a correctness prototype, not the production tile/GPU renderer.
export function composite(document: Psd): PixelData {
  const unsupported = editingDiagnostics(document);
  if (unsupported.length) throw new PsdAdmissionError('unsupported-composite', JSON.stringify(unsupported));
  const { width, height } = document;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height * 4 > P0_LIMITS.pixelBytes)
    throw new PsdAdmissionError('canvas-budget', 'Invalid composite dimensions');
  const output = pixelData(width, height);
  const blend = (target: PixelData, source: PixelData, left: number, top: number, opacity: number, mode: string) => {
    for (let y = Math.max(0, top); y < Math.min(height, top + source.height); y++) {
      for (let x = Math.max(0, left); x < Math.min(width, left + source.width); x++) {
        const s = ((y - top) * source.width + x - left) * 4, d = (y * width + x) * 4;
        const sa = source.data[s + 3]! / 255 * opacity, da = target.data[d + 3]! / 255;
        const alpha = sa + da * (1 - sa);
        if (sa === 0) continue;
        for (let c = 0; c < 3; c++) {
          const cs = source.data[s + c]! / 255, cb = target.data[d + c]! / 255;
          const b = mode === 'multiply' ? cs * cb : mode === 'screen' ? cs + cb - cs * cb : cs;
          target.data[d + c] = Math.round(((1 - sa) * da * cb + (1 - da) * sa * cs + sa * da * b) / alpha * 255);
        }
        target.data[d + 3] = Math.round(alpha * 255);
      }
    }
  };
  const render = (layers: Layer[], target: PixelData) => {
    for (const layer of layers) {
      if (layer.hidden) continue;
      const mode = layer.blendMode ?? 'normal', opacity = layer.opacity ?? 1;
      if (layer.children) {
        if (mode === 'pass through') render(layer.children, target);
        else {
          const group = pixelData(width, height);
          render(layer.children, group);
          blend(target, group, 0, 0, opacity, mode);
        }
      } else if (layer.imageData) blend(target, layer.imageData, layer.left ?? 0, layer.top ?? 0, opacity, mode);
    }
  };
  if (!document.children?.length && document.imageData) return { ...document.imageData, data: document.imageData.data.slice() };
  render(document.children ?? [], output);
  return output;
}

export function exportEditedPsd(inspection: PsdInspection): Uint8Array {
  const diagnostics = [...inspection.diagnostics, ...editingDiagnostics(inspection.document)];
  if (diagnostics.length) throw new PsdAdmissionError('unsafe-export', 'P0 cannot export this document as fully editable: ' + diagnostics.map(d => d.code).join(', '));
  const document = inspection.document;
  const imageResources = { ...document.imageResources };
  delete imageResources.thumbnail;
  delete imageResources.thumbnailRaw;
  const imageData = composite(document);
  const bytes = writePsdUint8Array({ ...document, imageResources, imageData }, { noBackground: true });
  const decoded = readPsd(bytes, { useImageData: true, skipThumbnail: true, totalMemoryLimit: P0_LIMITS.pixelBytes });
  for (let i = 3; i < imageData.data.length; i += 4) {
    if (decoded.imageData?.data[i] !== imageData.data[i])
      throw new PsdAdmissionError('composite-alpha-corruption', 'Codec changed composite alpha; export refused');
  }
  const outputResources = imageResourceIds(bytes);
  const lost = inspection.resourceIds?.filter(id => id !== 1033 && id !== 1036 && !outputResources.includes(id)) ?? [];
  if (lost.length) throw new PsdAdmissionError('resource-loss', `PSD resources would be dropped: ${lost.join(', ')}`);
  return bytes;
}

// Public file-structure scan catches resources the library silently skips (notably ICC).
export function imageResourceIds(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ensure = (end: number) => { if (end > bytes.length) throw new PsdAdmissionError('truncated-resource', 'Truncated PSD section'); };
  ensure(30);
  let offset = 30 + view.getUint32(26);
  ensure(offset + 4);
  const end = offset + 4 + view.getUint32(offset);
  ensure(end); offset += 4;
  const ids: number[] = [];
  while (offset < end) {
    ensure(offset + 7);
    ids.push(view.getUint16(offset + 4));
    const nameLength = bytes[offset + 6]! + 1;
    offset += 6 + nameLength + nameLength % 2;
    ensure(offset + 4);
    const length = view.getUint32(offset);
    offset += 4 + length + length % 2;
    if (offset > end) throw new PsdAdmissionError('truncated-resource', 'Resource crosses section boundary');
  }
  return ids;
}
