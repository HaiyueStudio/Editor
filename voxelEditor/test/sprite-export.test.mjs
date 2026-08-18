import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVoxelSpriteFrame,
  createSpriteAtlas,
  mergeSpriteProjectionBounds,
  scaleSpriteExportOptions,
  spriteSheetPlan,
  voxelSpriteProjectionBounds,
} from '../dist/sprite-exporter.js';

const options = { width: 64, height: 64, view: 'isometric', padding: 4, background: null };

test('sprite resolution scale increases output pixels without changing relative padding', () => {
  assert.deepEqual(scaleSpriteExportOptions(options, 2), {
    ...options,
    width: 128,
    height: 128,
    padding: 8,
  });
  assert.deepEqual(scaleSpriteExportOptions(options, 4), {
    ...options,
    width: 256,
    height: 256,
    padding: 16,
  });
  assert.deepEqual(scaleSpriteExportOptions(options, 16), {
    ...options,
    width: 1024,
    height: 1024,
    padding: 64,
  });
  assert.throws(() => scaleSpriteExportOptions(options, 3), /8× 或 16×/);
  assert.throws(() => scaleSpriteExportOptions({ ...options, width: 1024 }, 4), /8 到 2048/);
});

test('sprite projection removes covered faces and fits polygons into the requested frame', () => {
  const isolated = createVoxelSpriteFrame(
    { x: 4, y: 4, z: 4 },
    [{ x: 1, y: 1, z: 1, color: '#808080' }],
    options,
  );
  assert.equal(isolated.polygons.length, 3);
  assert.equal(isolated.width, 64);
  assert.equal(isolated.height, 64);
  assert.equal(isolated.polygons.every(polygon => polygon.points.every(([x, y]) => x >= 0 && x <= 64 && y >= 0 && y <= 64)), true);
  assert.equal(new Set(isolated.polygons.map(polygon => polygon.color)).size, 3);

  const adjacent = createVoxelSpriteFrame(
    { x: 4, y: 4, z: 4 },
    [
      { x: 1, y: 1, z: 1, color: '#ff0000' },
      { x: 2, y: 1, z: 1, color: '#00ff00' },
    ],
    options,
  );
  assert.equal(adjacent.polygons.length, 5);
});

test('front sprite projection keeps only the nearest occupied face', () => {
  const plan = createVoxelSpriteFrame(
    { x: 2, y: 2, z: 2 },
    [
      { x: 0, y: 0, z: 0, color: '#ff0000' },
      { x: 0, y: 0, z: 1, color: '#0000ff' },
    ],
    { ...options, view: 'front' },
  );
  assert.equal(plan.polygons.length, 1);
  assert.equal(plan.polygons[0].color, '#0000ff');
});

test('sprite sheet layout supports horizontal, vertical and bounded grid arrangements', () => {
  assert.deepEqual(spriteSheetPlan(4, 32, 16, 'horizontal'), { columns: 4, rows: 1, width: 128, height: 16 });
  assert.deepEqual(spriteSheetPlan(4, 32, 16, 'vertical'), { columns: 1, rows: 4, width: 32, height: 64 });
  assert.deepEqual(spriteSheetPlan(10, 32, 16, 'grid', 4), { columns: 4, rows: 3, width: 128, height: 48 });
  assert.throws(() => spriteSheetPlan(100, 2048, 2048, 'horizontal'), /安全上限/);
});

test('sprite bounds support large face counts without spreading point arrays into function arguments', () => {
  const voxels = Array.from({ length: 40_000 }, (_value, index) => ({
    x: index % 200,
    y: Math.floor(index / 200),
    z: 0,
    color: '#808080',
  }));
  const plan = createVoxelSpriteFrame(
    { x: 200, y: 200, z: 1 },
    voxels,
    { ...options, view: 'front' },
  );
  assert.equal(plan.polygons.length, 40_000);
  assert.equal(plan.polygons.every(polygon => polygon.points.length === 4), true);
});

test('animation frames can share projection bounds without changing voxel scale or centering', () => {
  const compactFrame = [{ x: 0, y: 0, z: 0, color: '#808080' }];
  const wideFrame = Array.from({ length: 4 }, (_value, x) => ({ x, y: 0, z: 0, color: '#808080' }));
  const sharedBounds = mergeSpriteProjectionBounds(
    voxelSpriteProjectionBounds(compactFrame, 'front'),
    voxelSpriteProjectionBounds(wideFrame, 'front'),
  );
  const stableOptions = { width: 100, height: 100, view: 'front', padding: 0, background: null };
  const compact = createVoxelSpriteFrame({ x: 4, y: 1, z: 1 }, compactFrame, stableOptions, sharedBounds);
  const wide = createVoxelSpriteFrame({ x: 4, y: 1, z: 1 }, wideFrame, stableOptions, sharedBounds);
  const polygonWidth = polygon => {
    const xs = polygon.points.map(point => point[0]);
    return Math.max(...xs) - Math.min(...xs);
  };

  assert.equal(compact.polygons.length, 1);
  assert.equal(wide.polygons.length, 4);
  assert.equal(polygonWidth(compact.polygons[0]), polygonWidth(wide.polygons[0]));
  assert.equal(polygonWidth(compact.polygons[0]), 25);
  assert.equal(Math.min(...compact.polygons[0].points.map(point => point[0])), 0);
  assert.equal(Math.min(...wide.polygons.flatMap(polygon => polygon.points).map(point => point[0])), 0);
  assert.equal(Math.max(...wide.polygons.flatMap(polygon => polygon.points).map(point => point[0])), 100);
});

test('sprite atlas carries stable names, pivot, direction, source frame and derived collision boxes', () => {
  const plan = createVoxelSpriteFrame(
    { x: 2, y: 2, z: 2 },
    [{ x: 0, y: 0, z: 0, color: '#ff0000' }],
    { ...options, view: 'front' },
  );
  const sheet = spriteSheetPlan(2, 64, 64, 'horizontal');
  const atlas = createSpriteAtlas([
    { name: 'walk/front_0002', frame: 2, direction: 'front', column: 0, row: 0, plan },
    { name: 'walk/right_0002', frame: 2, direction: 'right', column: 1, row: 0, plan },
  ], {
    image: 'walk.png', sheet, frameWidth: 64, frameHeight: 64,
    pivot: { x: 0.5, y: 1 }, fps: 12, loop: true,
    frameStart: 2, frameEnd: 5, directions: ['front', 'right'],
  });

  assert.deepEqual(atlas.meta.frameRange, { start: 2, end: 5 });
  assert.deepEqual(atlas.meta.directions, ['front', 'right']);
  assert.deepEqual(atlas.frames['walk/right_0002'].frame, { x: 64, y: 0, w: 64, h: 64 });
  assert.deepEqual(atlas.frames['walk/front_0002'].pivot, { x: 0.5, y: 1 });
  assert.equal(atlas.frames['walk/front_0002'].sourceFrame, 2);
  assert.equal(atlas.frames['walk/front_0002'].collision.w > 0, true);
  assert.equal(atlas.frames['walk/front_0002'].collision.h > 0, true);
});

test('opposite sprite directions expose the correct outer face', () => {
  const voxels = [
    { x: 0, y: 0, z: 0, color: '#ff0000' },
    { x: 0, y: 0, z: 1, color: '#0000ff' },
  ];
  const front = createVoxelSpriteFrame({ x: 1, y: 1, z: 2 }, voxels, { ...options, view: 'front' });
  const back = createVoxelSpriteFrame({ x: 1, y: 1, z: 2 }, voxels, { ...options, view: 'back' });
  assert.equal(front.polygons[0].color, '#0000ff');
  assert.equal(back.polygons[0].color, '#db0000');
});
