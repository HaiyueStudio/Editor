import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommandBus,
  Entity,
  PrefabInstanceComponent,
  World,
  createEntityTreePresenter,
  getEntityLocation,
  moveEntityCommand,
  readHierarchyTransactionMetrics,
} from '../dist-test/testing.js';

function createLargeHierarchy(entityCount) {
  const world = new World(`Hierarchy ${entityCount}`);
  const roots = [];
  const branchSize = 100;
  for (let rootIndex = 0; roots.length * branchSize < entityCount; rootIndex++) {
    const root = new Entity(`Root ${rootIndex}`);
    roots.push(root);
    for (let childIndex = 1; childIndex < branchSize; childIndex++) {
      if (rootIndex * branchSize + childIndex >= entityCount) break;
      root.addChild(new Entity(`Entity ${rootIndex}:${childIndex}`));
    }
    world.addEntity(root);
  }
  return { world, roots };
}

function createTreeDouble() {
  return {
    _data: [],
    dataWrites: 0,
    selectedIds: [],
    get data() { return this._data; },
    set data(value) {
      this.dataWrites++;
      this._data = value;
    },
  };
}

function moveProjectedNode(tree, sourceId, nextParentId) {
  let source = null;
  let sourceList = null;
  let nextParent = null;
  const stack = [{ nodes: tree.data }];
  while (stack.length) {
    const { nodes } = stack.pop();
    for (const node of nodes) {
      if (node.id === sourceId) {
        source = node;
        sourceList = nodes;
      }
      if (node.id === nextParentId) nextParent = node;
      if (node.children?.length) stack.push({ nodes: node.children });
    }
  }
  assert.ok(source && sourceList && nextParent);
  sourceList.splice(sourceList.indexOf(source), 1);
  (nextParent.children ??= []).push(source);
}

test('10K hierarchy reparent acknowledges the incrementally moved subtree without a full projection', () => {
  const { world, roots } = createLargeHierarchy(10_000);
  const presenter = createEntityTreePresenter({ resourcePool: { prefabs: new Map() } });
  const tree = createTreeDouble();
  presenter.refreshTreeStructure(tree, world, new Set());
  assert.equal(tree.dataWrites, 1);

  const source = roots[0].children[0];
  const target = roots[1];
  const from = getEntityLocation(source);
  moveProjectedNode(tree, String(source.id), String(target.id));
  const bus = new CommandBus(() => {});
  bus.execute(moveEntityCommand({
    world,
    entity: source,
    from,
    to: { parent: target, index: target.children.length },
  }));
  presenter.refreshTreeSelection(tree, world, new Set([source]));

  assert.equal(tree.dataWrites, 1, 'the tree-owned drag projection is acknowledged instead of rebuilt');
  assert.equal(source.parent, target);
  assert.equal(tree.data[1].children.at(-1).id, String(source.id));
  assert.ok(readHierarchyTransactionMetrics().reparent >= 0);

  bus.undo();
  presenter.refreshTreeSelection(tree, world, new Set([source]));
  assert.equal(tree.dataWrites, 2, 'undo repairs an external projection that did not pre-apply the move');
  assert.equal(source.parent, roots[0]);

  bus.redo();
  presenter.refreshTreeSelection(tree, world, new Set([source]));
  assert.equal(tree.dataWrites, 3);
  assert.equal(source.parent, target);
});

test('10K incremental hierarchy transaction remains below the 50ms P95 product budget', () => {
  const samples = [];
  for (let iteration = 0; iteration < 25; iteration++) {
    const { world, roots } = createLargeHierarchy(10_000);
    const presenter = createEntityTreePresenter({ resourcePool: { prefabs: new Map() } });
    const tree = createTreeDouble();
    presenter.refreshTreeStructure(tree, world, new Set());
    const source = roots[0].children[0];
    const target = roots[1];
    const startedAt = performance.now();
    moveProjectedNode(tree, String(source.id), String(target.id));
    const from = getEntityLocation(source);
    moveEntityCommand({
      world,
      entity: source,
      from,
      to: { parent: target, index: target.children.length },
    }).execute();
    presenter.refreshTreeSelection(tree, world, new Set([source]));
    samples.push(performance.now() - startedAt);
    assert.equal(tree.dataWrites, 1);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  assert.ok(p95 <= 50, `10K hierarchy transaction P95 ${p95.toFixed(2)}ms exceeds 50ms`);
});

test('prefab hierarchy projection keeps instance internals opaque after a reparent', () => {
  const world = new World('Prefab hierarchy');
  const prefabRoot = new Entity('Prefab root');
  prefabRoot.addComponent(new PrefabInstanceComponent(7, 1));
  prefabRoot.addChild(new Entity('Prefab internal child'));
  const source = new Entity('Movable');
  world.addEntity(prefabRoot);
  world.addEntity(source);
  const presenter = createEntityTreePresenter({
    resourcePool: { prefabs: new Map([[7, { id: 7, name: 'Prefab' }]]) },
  });
  const tree = createTreeDouble();
  presenter.refreshTreeStructure(tree, world, new Set());
  assert.equal(tree.data[0].children.length, 0);

  moveProjectedNode(tree, String(source.id), String(prefabRoot.id));
  moveEntityCommand({
    world,
    entity: source,
    from: { parent: null, index: 1 },
    to: { parent: prefabRoot, index: prefabRoot.children.length },
  }).execute();
  presenter.refreshTreeSelection(tree, world, new Set([source]));

  assert.equal(tree.dataWrites, 2, 'prefab boundary changes deliberately fall back to a safe projection');
  assert.equal(tree.data[0].children.length, 0);
  assert.equal(source.parent, prefabRoot);
});
