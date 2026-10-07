import { pixelData, composite } from '../dist/psdPrototype.js';

export function solid(width, height, rgba) {
  const image = pixelData(width, height);
  for (let i = 0; i < image.data.length; i += 4) image.data.set(rgba, i);
  return image;
}
export function syntheticDocument() {
  const document = { width: 32, height: 24, bitsPerChannel: 8, colorMode: 3, children: [
    { name: '底色 Background', left: 0, top: 0, imageData: solid(32, 24, [60, 120, 180, 255]), transparencyProtected: true },
    { name: '组 Group', blendMode: 'normal', opacity: 128 / 255, children: [
      { name: '半透明 Pixels', left: 3, top: 4, imageData: solid(10, 8, [220, 30, 90, 128]) },
      { name: 'Multiply', blendMode: 'multiply', left: 5, top: 6, imageData: solid(8, 6, [70, 170, 90, 200]) },
    ] },
    { name: 'Screen', blendMode: 'screen', left: -2, top: 12, imageData: solid(9, 9, [100, 50, 200, 255]) },
    { name: 'Hidden', hidden: true, left: 0, top: 0, imageData: solid(32, 24, [255, 0, 0, 255]) },
  ] };
  document.imageData = composite(document);
  return document;
}

export function applyEdit(document) {
  const layer = document.children[1].children[0];
  layer.name = 'Edited 编辑';
  layer.left += 2;
  layer.right += 2;
  layer.imageData.data.set([10, 240, 80, 255], 0);
  document.children[2].opacity = 128 / 255;
  return document;
}
