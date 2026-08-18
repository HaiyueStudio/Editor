import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandHistory } from '../dist/commands.js';
import { VoxelDocument } from '../dist/model.js';

class FakeClassList {
  values = new Set();
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement extends EventTarget {
  value = '';
  checked = false;
  files = null;
  items = [];
  textContent = '';
  classList = new FakeClassList();
  clickCount = 0;
  click() { this.clickCount += 1; }
}

const controllerIds = [
  'project-file', 'image-file', 'export-progress', 'export-progress-label',
  'export-progress-percent', 'export-progress-bar', 'export-menu',
  'import-project', 'import-image', 'import-image-header',
  'cancel-export', 'export-sprite-frame', 'export-sprite-sheet',
  'pixel-art-width', 'pixel-art-height', 'pixel-art-colors', 'pixel-art-dither', 'pixel-art-merge',
];

function installDom() {
  const elements = new Map(controllerIds.map(id => [id, new FakeElement()]));
  elements.get('pixel-art-width').value = '2';
  elements.get('pixel-art-height').value = '1';
  elements.get('pixel-art-colors').value = '64';
  elements.get('pixel-art-merge').checked = true;
  const pixelData = new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 0,
  ]);
  globalThis.document = {
    getElementById: id => elements.get(id) ?? null,
    createElement(tagName) {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage() {},
            getImageData: () => ({ width: 2, height: 1, data: pixelData }),
          }),
        };
      }
      return new FakeElement();
    },
  };
  globalThis.window = { setTimeout };
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1, close() {} });
  return elements;
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('header project and image actions use the shared IO pipeline', async () => {
  const elements = installDom();
  const { ProjectIOController } = await import('../dist/project-io-controller.js');
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  const copied = [];
  new ProjectIOController({
    document,
    history: new CommandHistory(),
    notify() {},
    resetCamera() {},
    setCopiedModuleId: moduleId => copied.push(moduleId),
  });

  assert.deepEqual(elements.get('export-menu').items.map(item => item.value ?? 'separator'), [
    'json', 'vox', 'separator', 'gltf', 'sprite',
  ]);
  elements.get('import-project').dispatchEvent(new Event('click'));
  assert.equal(elements.get('project-file').clickCount, 1);
  for (const id of ['import-image', 'import-image-header']) {
    elements.get(id).dispatchEvent(new Event('click'));
  }
  assert.equal(elements.get('image-file').clickCount, 2);

  elements.get('image-file').files = [{ name: 'icon.png' }];
  elements.get('image-file').dispatchEvent(new Event('change'));
  await settle();
  assert.equal(document.modules.length, 1);
  assert.equal(document.modules[0].name, 'icon');
  assert.deepEqual(document.modules[0].size, { x: 2, y: 1, z: 1 });
  assert.deepEqual(document.modules[0].voxels.map(voxel => voxel.color), ['#ff0000']);
  assert.deepEqual(copied, [document.modules[0].id]);
});

test('a rejected project file leaves the active editor project and history unchanged', async () => {
  const elements = installDom();
  const { ProjectIOController } = await import('../dist/project-io-controller.js');
  const document = new VoxelDocument({ x: 8, y: 9, z: 10 });
  document.setVoxel(2, 0, 3, '#123456');
  const before = document.toJSON();
  const history = new CommandHistory();
  const notices = [];
  let cameraResets = 0;
  new ProjectIOController({
    document,
    history,
    notify: (message, error) => notices.push({ message, error }),
    resetCamera: () => { cameraResets += 1; },
    setCopiedModuleId() {},
  });
  elements.get('project-file').files = [{
    name: 'broken.json',
    type: 'application/json',
    text: async () => JSON.stringify({
      format: 'haiyue-voxel',
      version: 1,
      size: { x: 4, y: 4, z: 4 },
      voxels: [],
      modules: [{
        id: 'broken',
        name: 'broken',
        size: { x: 1, y: 1, z: 1 },
        voxels: [{ x: 0, y: 0, z: 0, color: 'invalid' }],
      }],
    }),
  }];

  elements.get('project-file').dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(document.toJSON(), before);
  assert.equal(history.canUndo, false);
  assert.equal(cameraResets, 0);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].error, true);
  assert.match(notices[0].message, /无效颜色/);
  assert.equal(elements.get('project-file').value, '');
});
