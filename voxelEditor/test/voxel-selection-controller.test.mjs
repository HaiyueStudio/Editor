import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandHistory } from '../dist/commands.js';
import { VoxelDocument } from '../dist/model.js';
import { VoxelSelection } from '../dist/selection.js';
import { VoxelSelectionController } from '../dist/voxel-selection-controller.js';

function fixture() {
  const document = new VoxelDocument({ x: 8, y: 8, z: 8 });
  document.setVoxel(1, 1, 1, '#ff0000');
  document.setVoxel(2, 1, 1, '#00ff00');
  const history = new CommandHistory();
  const selection = new VoxelSelection();
  selection.apply(document.viewVoxels.values());
  const countElement = { textContent: '' };
  const rendererSelections = [];
  const notifications = [];
  const controller = new VoxelSelectionController({
    document,
    history,
    selection,
    countElement,
    getRenderer: () => ({
      setSelection(keys) {
        rendererSelections.push([...keys]);
        return true;
      },
    }),
    getOffset: () => ({ x: 2, y: 0, z: 0 }),
    getPivot: () => null,
    syncTransform: () => false,
    syncViewportCount: () => {},
    requestRender: () => {},
    notify: (message, error = false) => notifications.push({ message, error }),
  });
  return { controller, document, history, countElement, rendererSelections, notifications };
}

test('selection controller owns transform commit, selection sync, and undo', () => {
  const state = fixture();
  state.controller.move();

  assert.equal(state.document.get(1, 1, 1), undefined);
  assert.equal(state.document.get(2, 1, 1), undefined);
  assert.equal(state.document.get(3, 1, 1)?.color, '#ff0000');
  assert.equal(state.document.get(4, 1, 1)?.color, '#00ff00');
  assert.deepEqual([...state.controller.keys].sort(), ['3,1,1', '4,1,1']);
  assert.equal(state.countElement.textContent, '2');
  assert.equal(state.history.undoLabel, '移动选择');
  assert.match(state.notifications.at(-1).message, /移动选择完成/);

  assert.equal(state.history.undo(), '移动选择');
  assert.equal(state.document.get(1, 1, 1)?.color, '#ff0000');
  assert.equal(state.document.get(2, 1, 1)?.color, '#00ff00');
});

test('selection clipboard remains controller-owned across copy and paste', () => {
  const state = fixture();
  state.controller.copy();
  state.controller.paste();

  assert.equal(state.document.voxelCount, 4);
  assert.equal(state.document.get(3, 1, 1)?.color, '#ff0000');
  assert.equal(state.document.get(4, 1, 1)?.color, '#00ff00');
  assert.deepEqual([...state.controller.keys].sort(), ['3,1,1', '4,1,1']);
  assert.equal(state.history.undoLabel, '粘贴体素');
  assert.match(state.notifications[0].message, /已复制 2 个体素/);
  assert.match(state.notifications.at(-1).message, /已粘贴 2 个体素/);
});
