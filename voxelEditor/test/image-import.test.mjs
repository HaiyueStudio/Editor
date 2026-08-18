import assert from 'node:assert/strict';
import test from 'node:test';
import { pixelArtDimension, rasterizePixelArt } from '../dist/image-importer.js';

test('image import preserves RGB colors, flips image rows and skips transparent pixels', () => {
  const pixels = rasterizePixelArt({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,   0, 255, 0, 0,
      0, 0, 255, 255,   255, 255, 255, 255,
    ]),
  }, 2, 2);

  assert.deepEqual(pixels, [
    { x: 0, y: 1, color: '#ff0000' },
    { x: 0, y: 0, color: '#0000ff' },
    { x: 1, y: 0, color: '#ffffff' },
  ]);
});

test('image import uses nearest-neighbour colors when changing pixel-art dimensions', () => {
  const pixels = rasterizePixelArt({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([18, 52, 86, 255]),
  }, 3, 2);

  assert.equal(pixels.length, 6);
  assert.ok(pixels.every(pixel => pixel.color === '#123456'));
  assert.deepEqual(pixels.map(pixel => [pixel.x, pixel.y]), [
    [0, 1], [1, 1], [2, 1],
    [0, 0], [1, 0], [2, 0],
  ]);
});

test('pixel-art dimensions are rounded and constrained to the scene limit', () => {
  assert.equal(pixelArtDimension(31.6, '宽度'), 32);
  assert.throws(() => pixelArtDimension(0, '宽度'), /1 到 256/);
  assert.throws(() => pixelArtDimension(257, '高度'), /1 到 256/);
});

test('image import quantizes gradients to the requested palette size', () => {
  const data = [];
  for (let index = 0; index < 32; index += 1) data.push(index * 8, 255 - index * 8, index * 3, 255);
  const voxels = rasterizePixelArt({ width: 32, height: 1, data }, 32, 1, { maxColors: 16 });
  assert.ok(new Set(voxels.map(voxel => voxel.color)).size <= 16);
});

test('image import color merge and dithering remain deterministic', () => {
  const source = { width: 3, height: 1, data: [100, 100, 100, 255, 106, 103, 101, 255, 240, 240, 240, 255] };
  const options = { maxColors: 16, mergeThreshold: 12, dither: true };
  assert.deepEqual(rasterizePixelArt(source, 3, 1, options), rasterizePixelArt(source, 3, 1, options));
  assert.equal(new Set(rasterizePixelArt(source, 3, 1, options).map(voxel => voxel.color)).size, 2);
});
