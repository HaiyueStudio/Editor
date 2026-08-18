export const MAX_PIXEL_ART_AXIS = 256;

export interface RasterImageData {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface PixelArtVoxel {
  x: number;
  y: number;
  color: string;
}

export interface PixelArtImportOptions {
  alphaThreshold?: number;
  /** Zero keeps source colors; supported UI presets are 16/32/64/128/255. */
  maxColors?: number;
  dither?: boolean;
  /** RGB colors inside this per-channel distance are merged before quantization. */
  mergeThreshold?: number;
}

interface Rgb { r: number; g: number; b: number }
interface WeightedRgb extends Rgb { count: number }
interface Sample extends Rgb { visible: boolean }

/** Converts RGBA pixels to bottom-up voxel coordinates, with optional palette reduction. */
export function rasterizePixelArt(
  source: RasterImageData,
  targetWidth: number,
  targetHeight: number,
  options: number | PixelArtImportOptions = {},
): PixelArtVoxel[] {
  const sourceWidth = positiveInteger(source.width, '图片宽度');
  const sourceHeight = positiveInteger(source.height, '图片高度');
  const width = pixelArtDimension(targetWidth, '像素画宽度');
  const height = pixelArtDimension(targetHeight, '像素画高度');
  if (source.data.length < sourceWidth * sourceHeight * 4) throw new Error('图片像素数据不完整。');
  const settings = typeof options === 'number' ? { alphaThreshold: options } : options;
  const threshold = clampChannel(settings.alphaThreshold ?? 1);
  const maxColors = Math.max(0, Math.min(255, Math.round(settings.maxColors ?? 0)));
  const mergeThreshold = Math.max(0, Math.min(64, Math.round(settings.mergeThreshold ?? 0)));
  const samples: Sample[] = [];
  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((targetY + 0.5) * sourceHeight / height));
    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((targetX + 0.5) * sourceWidth / width));
      const offset = (sourceY * sourceWidth + sourceX) * 4;
      samples.push({
        r: channel(source.data, offset),
        g: channel(source.data, offset + 1),
        b: channel(source.data, offset + 2),
        visible: channel(source.data, offset + 3) >= threshold,
      });
    }
  }
  const palette = maxColors > 0 ? buildPalette(samples, maxColors, mergeThreshold) : [];
  const work = samples.map(sample => ({ ...sample }));
  const voxels: PixelArtVoxel[] = [];
  for (let index = 0; index < work.length; index += 1) {
    const sample = work[index]!;
    if (!sample.visible) continue;
    const mapped = palette.length > 0 ? nearestColor(sample, palette) : sample;
    const targetX = index % width;
    const targetY = Math.floor(index / width);
    voxels.push({ x: targetX, y: height - targetY - 1, color: rgbHex(mapped.r, mapped.g, mapped.b) });
    if (settings.dither && palette.length > 0) {
      diffuse(work, width, height, targetX + 1, targetY, sample, mapped, 7 / 16);
      diffuse(work, width, height, targetX - 1, targetY + 1, sample, mapped, 3 / 16);
      diffuse(work, width, height, targetX, targetY + 1, sample, mapped, 5 / 16);
      diffuse(work, width, height, targetX + 1, targetY + 1, sample, mapped, 1 / 16);
    }
  }
  return voxels;
}

export function pixelArtDimension(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label}无效。`);
  const dimension = Math.round(value);
  if (dimension < 1 || dimension > MAX_PIXEL_ART_AXIS) {
    throw new Error(`${label}必须在 1 到 ${MAX_PIXEL_ART_AXIS} 之间。`);
  }
  return dimension;
}

function buildPalette(samples: readonly Sample[], maxColors: number, mergeThreshold: number): Rgb[] {
  const step = mergeThreshold + 1;
  const groups = new Map<string, WeightedRgb>();
  for (const sample of samples) {
    if (!sample.visible) continue;
    const key = `${Math.round(sample.r / step)},${Math.round(sample.g / step)},${Math.round(sample.b / step)}`;
    const group = groups.get(key);
    if (group) {
      group.r += sample.r;
      group.g += sample.g;
      group.b += sample.b;
      group.count += 1;
    } else groups.set(key, { r: sample.r, g: sample.g, b: sample.b, count: 1 });
  }
  const colors = Array.from(groups.values(), group => ({
    r: group.r / group.count, g: group.g / group.count, b: group.b / group.count, count: group.count,
  }));
  if (colors.length <= maxColors) return colors.map(roundedRgb);
  let boxes: WeightedRgb[][] = [colors];
  while (boxes.length < maxColors) {
    let splitIndex = -1;
    let splitRange = -1;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index]!;
      if (box.length < 2) continue;
      const range = colorRange(box).range;
      if (range > splitRange) { splitRange = range; splitIndex = index; }
    }
    if (splitIndex < 0) break;
    const box = boxes.splice(splitIndex, 1)[0]!;
    const axis = colorRange(box).axis;
    box.sort((a, b) => a[axis] - b[axis]);
    const total = box.reduce((sum, color) => sum + color.count, 0);
    let accumulated = 0;
    let cut = 1;
    for (; cut < box.length; cut += 1) {
      accumulated += box[cut - 1]!.count;
      if (accumulated >= total / 2) break;
    }
    boxes.push(box.slice(0, cut), box.slice(cut));
  }
  return boxes.map(box => {
    const count = box.reduce((sum, color) => sum + color.count, 0);
    return roundedRgb({
      r: box.reduce((sum, color) => sum + color.r * color.count, 0) / count,
      g: box.reduce((sum, color) => sum + color.g * color.count, 0) / count,
      b: box.reduce((sum, color) => sum + color.b * color.count, 0) / count,
    });
  });
}

function colorRange(colors: readonly Rgb[]): { axis: keyof Rgb; range: number } {
  let best: { axis: keyof Rgb; range: number } = { axis: 'r', range: -1 };
  for (const axis of ['r', 'g', 'b'] as const) {
    let min = 255;
    let max = 0;
    for (const color of colors) { min = Math.min(min, color[axis]); max = Math.max(max, color[axis]); }
    if (max - min > best.range) best = { axis, range: max - min };
  }
  return best;
}

function nearestColor(color: Rgb, palette: readonly Rgb[]): Rgb {
  let best = palette[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    const distance = (color.r - candidate.r) ** 2 + (color.g - candidate.g) ** 2 + (color.b - candidate.b) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
  }
  return best;
}

function diffuse(
  samples: Sample[], width: number, height: number, x: number, y: number,
  source: Rgb, mapped: Rgb, amount: number,
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const target = samples[y * width + x]!;
  if (!target.visible) return;
  target.r = clampChannel(target.r + (source.r - mapped.r) * amount);
  target.g = clampChannel(target.g + (source.g - mapped.g) * amount);
  target.b = clampChannel(target.b + (source.b - mapped.b) * amount);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label}无效。`);
  return value;
}

function channel(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  return Number.isFinite(value) ? clampChannel(value!) : 0;
}

function roundedRgb(color: Rgb): Rgb {
  return { r: clampChannel(color.r), g: clampChannel(color.g), b: clampChannel(color.b) };
}

function clampChannel(value: number): number { return Math.max(0, Math.min(255, Math.round(value))); }
function rgbHex(red: number, green: number, blue: number): string { return `#${hex(red)}${hex(green)}${hex(blue)}`; }
function hex(value: number): string { return value.toString(16).padStart(2, '0'); }
