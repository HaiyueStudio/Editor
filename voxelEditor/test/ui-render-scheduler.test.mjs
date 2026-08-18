import assert from 'node:assert/strict';
import test from 'node:test';
import { VoxelDocument } from '../dist/model.js';
import { UiRenderScheduler } from '../dist/ui-render-scheduler.js';

const clean = () => ({
  scene: false,
  view: false,
  render: false,
  palette: false,
  modules: false,
  animation: false,
  grid: false,
  selection: 'none',
});

test('one document change schedules exactly one voxel render submission', () => {
  const project = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const frames = [];
  let renderSubmissions = 0;
  const scheduler = new UiRenderScheduler(dirty => {
    if (dirty.render) renderSubmissions += 1;
  }, callback => { frames.push(callback); return frames.length; });
  project.addEventListener('change', event => scheduler.schedule(event.detail.dirty));

  project.setVoxel(1, 2, 3, '#69d2e7');

  assert.equal(frames.length, 1);
  assert.equal(renderSubmissions, 0);
  frames.shift()(16);
  assert.equal(renderSubmissions, 1);
});

test('multiple document invalidations produce one UI and render commit per frame', () => {
  const frames = [];
  const commits = [];
  const scheduler = new UiRenderScheduler(
    dirty => commits.push(dirty),
    callback => { frames.push(callback); return frames.length; },
  );

  scheduler.schedule({ ...clean(), scene: true, render: true, selection: 'retain' });
  scheduler.schedule({ ...clean(), palette: true, modules: true });
  scheduler.requestRender();

  assert.equal(frames.length, 1);
  assert.equal(commits.length, 0);
  frames.shift()(16);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], {
    scene: true,
    view: false,
    render: true,
    palette: true,
    modules: true,
    animation: false,
    grid: false,
    selection: 'retain',
  });

  scheduler.schedule({ ...clean(), animation: true, selection: 'clear' });
  assert.equal(frames.length, 1);
  frames.shift()(32);
  assert.equal(commits.length, 2);
  assert.equal(commits[1].animation, true);
  assert.equal(commits[1].selection, 'clear');
});

test('an invalidation raised while committing is deferred to the next frame', () => {
  const frames = [];
  const commits = [];
  let scheduler;
  scheduler = new UiRenderScheduler(dirty => {
    commits.push(dirty);
    if (commits.length === 1) scheduler.requestRender();
  }, callback => { frames.push(callback); return frames.length; });

  scheduler.schedule({ ...clean(), palette: true });
  frames.shift()(16);
  assert.equal(commits.length, 1);
  assert.equal(frames.length, 1);
  frames.shift()(32);
  assert.equal(commits.length, 2);
  assert.equal(commits[1].render, true);
});

test('voxel patches are coalesced without forcing a full render', () => {
  const frames = [];
  const commits = [];
  const scheduler = new UiRenderScheduler(
    (_dirty, impact) => commits.push(impact),
    callback => { frames.push(callback); return frames.length; },
  );
  scheduler.schedule({ ...clean(), render: true }, {
    fullRender: false, voxelKeys: [1, 2], instanceIds: [], materialIds: ['material-1'],
  });
  scheduler.schedule({ ...clean(), render: true }, {
    fullRender: false, voxelKeys: [2, 3], instanceIds: [], materialIds: ['material-1'],
  });
  frames.shift()(16);
  assert.equal(commits[0].fullRender, false);
  assert.deepEqual([...commits[0].voxelKeys], [1, 2, 3]);
  assert.deepEqual([...commits[0].materialIds], ['material-1']);
});
