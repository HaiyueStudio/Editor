import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommandBus,
  Entity,
  World,
  addEntityCommand,
  getEntityLocation,
  loadEditorSceneCommand,
  moveEntityCommand,
  pasteEntitiesCommand,
  removeEntitiesCommand,
} from '../dist-test/testing.js';

function createCommandBus() {
  return new CommandBus(() => {});
}

test('entity add/remove commands round-trip through undo and redo', () => {
  const world = new World();
  const parent = new Entity('Parent');
  const child = new Entity('Child');
  const bus = createCommandBus();

  bus.execute(addEntityCommand({ world, entity: parent }));
  bus.execute(addEntityCommand({ world, entity: child, parent }));

  assert.equal(world.getEntity(parent.id), parent);
  assert.equal(world.getEntity(child.id), child);
  assert.deepEqual(parent.children, [child]);

  bus.undo();
  assert.equal(world.getEntity(child.id), null);
  assert.deepEqual(parent.children, []);

  bus.redo();
  assert.equal(world.getEntity(child.id), child);
  assert.deepEqual(parent.children, [child]);

  bus.execute(removeEntitiesCommand({ world, entities: [parent] }));
  assert.equal(world.getEntity(parent.id), null);
  assert.equal(world.getEntity(child.id), null);

  bus.undo();
  assert.equal(world.getEntity(parent.id), parent);
  assert.equal(world.getEntity(child.id), child);
  assert.deepEqual(parent.children, [child]);
});

test('entity move command restores hierarchy location', () => {
  const world = new World();
  const a = new Entity('A');
  const b = new Entity('B');
  const c = new Entity('C');
  world.addEntity(a);
  world.addEntity(b);
  world.addEntity(c);
  const bus = createCommandBus();

  bus.execute(moveEntityCommand({
    world,
    entity: c,
    from: getEntityLocation(c),
    to: { parent: a, index: 0 },
  }));

  assert.deepEqual(world.rootEntityList, [a, b]);
  assert.deepEqual(a.children, [c]);

  bus.undo();
  assert.deepEqual(world.rootEntityList, [a, b, c]);
  assert.deepEqual(a.children, []);

  bus.redo();
  assert.deepEqual(world.rootEntityList, [a, b]);
  assert.deepEqual(a.children, [c]);
});

test('entity paste command groups multiple inserted entities', () => {
  const world = new World();
  const parent = new Entity('Parent');
  const first = new Entity('First');
  const second = new Entity('Second');
  world.addEntity(parent);
  const bus = createCommandBus();

  bus.execute(pasteEntitiesCommand({ world, parent, entities: [first, second] }));
  assert.deepEqual(parent.children, [first, second]);
  assert.equal(world.getEntity(first.id), first);
  assert.equal(world.getEntity(second.id), second);

  bus.undo();
  assert.deepEqual(parent.children, []);
  assert.equal(world.getEntity(first.id), null);
  assert.equal(world.getEntity(second.id), null);

  bus.redo();
  assert.deepEqual(parent.children, [first, second]);
  assert.equal(world.getEntity(first.id), first);
  assert.equal(world.getEntity(second.id), second);
});

test('entity remove command ignores selected descendants of removed roots', () => {
  const world = new World();
  const parent = new Entity('Parent');
  const child = new Entity('Child');
  parent.addChild(child);
  world.addEntity(parent);
  const bus = createCommandBus();

  bus.execute(removeEntitiesCommand({ world, entities: [parent, child] }));
  assert.equal(world.getEntity(parent.id), null);
  assert.equal(world.getEntity(child.id), null);

  bus.undo();
  assert.equal(world.getEntity(parent.id), parent);
  assert.equal(world.getEntity(child.id), child);
  assert.deepEqual(parent.children, [child]);
});

test('command bus groups commands into one undo entry', () => {
  const world = new World();
  const first = new Entity('First');
  const second = new Entity('Second');
  const bus = createCommandBus();

  bus.runGroup('Add Pair', () => {
    bus.execute(addEntityCommand({ world, entity: first }));
    bus.execute(addEntityCommand({ world, entity: second }));
  });

  assert.deepEqual(world.rootEntityList, [first, second]);
  bus.undo();
  assert.deepEqual(world.rootEntityList, []);
  bus.redo();
  assert.deepEqual(world.rootEntityList, [first, second]);
});

test('command bus merges compatible consecutive commands', () => {
  let value = 0;
  const bus = createCommandBus();
  const createSetCommand = (before, after) => ({
    label: 'Set Value',
    execute: () => { value = after; },
    undo: () => { value = before; },
    mergeWith(next) {
      if (next.label !== 'Set Value') return null;
      return createSetCommand(before, next.afterValue);
    },
    afterValue: after,
  });

  bus.execute(createSetCommand(0, 1));
  bus.execute(createSetCommand(1, 2));

  assert.equal(value, 2);
  bus.undo();
  assert.equal(value, 0);
  assert.equal(bus.canUndo, false);
  bus.redo();
  assert.equal(value, 2);
});

test('load scene command restores previous scene snapshot on undo', () => {
  const applied = [];
  const before = {
    version: 1,
    name: 'Before',
    globals: {},
    systems: [],
    resources: {},
    entities: [],
  };
  const after = {
    version: 1,
    name: 'After',
    globals: {},
    systems: [],
    resources: {},
    entities: [],
  };
  const bus = createCommandBus();

  bus.execute(loadEditorSceneCommand({
    before,
    after,
    apply: scene => { applied.push(scene.name); },
  }));

  assert.deepEqual(applied, ['After']);
  bus.undo();
  assert.deepEqual(applied, ['After', 'Before']);
  bus.redo();
  assert.deepEqual(applied, ['After', 'Before', 'After']);
});
