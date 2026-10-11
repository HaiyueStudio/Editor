import type { ImageLayer, ImageState } from './document.js';

/** Fields consumed by composition. Editing labels, locks and PSD round-trip metadata are not pixels. */
export const RENDER_LAYER_KEYS = [
  'kind', 'visible', 'x', 'y', 'opacity', 'blend', 'passThrough', 'fillOpacity',
  'advancedBlend', 'clipping', 'styles', 'smartFilters', 'filterMask', 'blendIf', 'mask',
] as const satisfies readonly (keyof ImageLayer)[];

/** Committed sample buffers are immutable; never scan native pixels to compare metadata. */
export function sameRenderMetadata(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>, keys = Object.keys(aa);
  return keys.length === Object.keys(bb).length && keys.every(key => Object.hasOwn(bb, key) && sameRenderMetadata(aa[key], bb[key]));
}

export const renderContent = (layer: ImageLayer) => layer.content?.type === 'adjustment' ? layer.content : undefined;
export function sameLayerRendering(a: ImageLayer, b: ImageLayer): boolean {
  return RENDER_LAYER_KEYS.every(key => sameRenderMetadata(a[key], b[key])) && sameRenderMetadata(renderContent(a), renderContent(b));
}
export function sameRenderSettings(a: ImageState, b: ImageState): boolean {
  return a.width === b.width && a.height === b.height && (a.bitDepth ?? 8) === (b.bitDepth ?? 8) &&
    (a.colorMode ?? 'rgb') === (b.colorMode ?? 'rgb') && sameRenderMetadata(a.icc, b.icc) &&
    sameRenderMetadata(a.display, b.display) && a.psdOrigin?.resources === b.psdOrigin?.resources;
}
export function sameRenderState(a: ImageState, b: ImageState): boolean {
  const layers = (aa: readonly ImageLayer[], bb: readonly ImageLayer[]): boolean => aa === bb ||
    aa.length === bb.length && aa.every((l, i) => l.bitmap === bb[i]!.bitmap && sameLayerRendering(l, bb[i]!) && layers(l.children, bb[i]!.children));
  return sameRenderSettings(a, b) && layers(a.layers, b.layers);
}

export function renderFingerprintInput(state: ImageState) {
  const layer = (l: ImageLayer): unknown => ({
    ...Object.fromEntries(RENDER_LAYER_KEYS.map(key => [key, l[key]])),
    bitmap: l.bitmap, content: renderContent(l), children: l.children.map(layer),
  });
  return { width: state.width, height: state.height, bitDepth: state.bitDepth ?? 8, colorMode: state.colorMode ?? 'rgb',
    layers: state.layers.map(layer), icc: state.icc, display: state.display, resources: state.psdOrigin?.resources };
}
