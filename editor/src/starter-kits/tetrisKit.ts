import { Camera2D, Entity, Transform2D } from '@haiyue/engine';
import { DataComponent, KeyboardComponent, ScriptComponent, ScriptResource } from '@haiyue/engine/components';
import { InputMap } from '@haiyue/engine/input';
import { Tilemap2DComponent } from '@haiyue/extensions/tilemap';
import type { CommandBus } from '../commands/CommandBus';
import type { ResourcePool } from '../resources/ResourcePool';
import type { EditorStarterKit, EditorStarterKitApplyContext, ScriptResourceItem } from '../types';
import type { SerializedGlobalSettings } from '../export/runtimeScene';

const TETRIS_STARTER_SCRIPT = `
const components = api.read.components || {};
function getTilemap(entity) {
  const Tilemap2D = components.Tilemap2DComponent;
  const direct = Tilemap2D
    ? entity?.getComponent?.(Tilemap2D)
    : entity?.getComponent?.('Tilemap2DComponent');
  if (direct) return direct;
  for (const component of entity?.components?.values?.() || []) {
    if (component?.name === 'Tilemap2DComponent' || String(component?.UniqueSymbol) === 'Symbol(Tilemap2DComponent)') {
      return component;
    }
  }
  return null;
}

let boardEntity = api.read?.find('Tetris Board');
let board = getTilemap(boardEntity);
if (!board) {
  for (const entity of api.read?.findAll?.() || []) {
    const tilemap = getTilemap(entity);
    if (!tilemap || tilemap.columns !== 10 || tilemap.rows !== 20) continue;
    boardEntity = entity;
    board = tilemap;
    break;
  }
}
const config = api.read.data() || {};

if (!board) {
  api.debug.console.warn('Tetris Starter Kit requires Tetris Board with Tilemap2DComponent.');
  return;
}

const state = component.state || (component.state = {});
const shapes = config.shapes || {
  I: [[0,1],[1,1],[2,1],[3,1]],
  J: [[0,0],[0,1],[1,1],[2,1]],
  L: [[2,0],[0,1],[1,1],[2,1]],
  O: [[1,0],[2,0],[1,1],[2,1]],
  S: [[1,0],[2,0],[0,1],[1,1]],
  T: [[1,0],[0,1],[1,1],[2,1]],
  Z: [[0,0],[1,0],[1,1],[2,1]],
};
const kinds = config.kinds || ['I','J','L','O','S','T','Z'];
const palette = config.paletteIndex || { I: 1, J: 2, L: 3, O: 4, S: 5, T: 6, Z: 7 };
const scoreByLines = [0, 100, 300, 500, 800];
const scoreHud = getTilemap(api.read?.find('Tetris Scoreboard'));
const nextHud = getTilemap(api.read?.find('Tetris Next Preview'));
const statusHud = getTilemap(api.read?.find('Tetris Status'));
const digits = {
  0: ['111','101','101','101','111'],
  1: ['010','110','010','010','111'],
  2: ['111','001','111','100','111'],
  3: ['111','001','111','001','111'],
  4: ['101','101','111','001','001'],
  5: ['111','100','111','001','111'],
  6: ['111','100','111','101','111'],
  7: ['111','001','001','001','001'],
  8: ['111','101','111','101','111'],
  9: ['111','101','111','001','111'],
};

function cloneGrid() {
  return Array.from({ length: board.rows }, () => Array(board.columns).fill(0));
}

function randomKind() {
  return kinds[Math.floor(Math.random() * kinds.length)] || 'T';
}

function makePiece(kind) {
  return { kind, x: Math.floor(board.columns / 2) - 2, y: 0, r: 0 };
}

function cells(piece) {
  const source = shapes[piece.kind] || shapes.T;
  return source.map(([x, y]) => {
    let px = x;
    let py = y;
    for (let i = 0; i < piece.r % 4; i++) {
      const nextX = 3 - py;
      py = px;
      px = nextX;
    }
    return { x: piece.x + px, y: piece.y + py };
  });
}

function collides(piece) {
  for (const cell of cells(piece)) {
    if (cell.x < 0 || cell.x >= board.columns || cell.y >= board.rows) return true;
    if (cell.y >= 0 && state.grid[cell.y][cell.x]) return true;
  }
  return false;
}

function spawn() {
  state.current = makePiece(state.next || randomKind());
  state.next = randomKind();
  if (collides(state.current)) state.phase = 'gameover';
}

function reset() {
  state.grid = cloneGrid();
  state.current = makePiece(randomKind());
  state.next = randomKind();
  state.score = 0;
  state.lines = 0;
  state.level = 1;
  state.drop = 0;
  state.phase = 'playing';
  if (collides(state.current)) state.phase = 'gameover';
}

function move(dx, dy) {
  const next = { ...state.current, x: state.current.x + dx, y: state.current.y + dy };
  if (collides(next)) return false;
  state.current = next;
  return true;
}

function rotate(dir) {
  const next = { ...state.current, r: (state.current.r + dir + 4) % 4 };
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    const kicked = { ...next, x: next.x + kick };
    if (!collides(kicked)) {
      state.current = kicked;
      return;
    }
  }
}

function lock() {
  for (const cell of cells(state.current)) {
    if (cell.y >= 0 && cell.y < board.rows && cell.x >= 0 && cell.x < board.columns) {
      state.grid[cell.y][cell.x] = palette[state.current.kind] || 1;
    }
  }
  let cleared = 0;
  state.grid = state.grid.filter(row => {
    const full = row.every(Boolean);
    if (full) cleared++;
    return !full;
  });
  while (state.grid.length < board.rows) state.grid.unshift(Array(board.columns).fill(0));
  if (cleared) {
    state.lines += cleared;
    state.level = Math.floor(state.lines / 10) + 1;
    state.score += (scoreByLines[cleared] || cleared * 200) * state.level;
  }
  spawn();
}

function hardDrop() {
  while (move(0, 1)) state.score += 2;
  lock();
}

function setTilemapTransform(entity, x, y) {
  const transform = entity?.getComponent?.('Transform2D');
  if (!transform) return;
  transform.x = x;
  transform.y = y;
}

function layoutTilemap(tilemap, cellWidth, cellHeight, gap) {
  if (!tilemap) return;
  tilemap.cellWidth = cellWidth;
  tilemap.cellHeight = cellHeight;
  tilemap.gap = gap;
}

function updateLayout() {
  const canvas = document.getElementById('player-canvas');
  const width = Math.max(1, canvas?.clientWidth || window.innerWidth || 1280);
  const height = Math.max(1, canvas?.clientHeight || window.innerHeight || 720);
  const portrait = height >= width;
  const margin = portrait ? 16 : 28;
  const hudReserve = portrait ? 150 : 80;
  const sideReserve = portrait ? margin * 2 : Math.min(300, Math.max(220, width * 0.28));
  const cell = Math.max(10, Math.floor(Math.min(
    (height - hudReserve) / board.rows,
    (width - sideReserve) / board.columns,
    portrait ? 34 : 36,
  )));
  const gap = Math.max(1, Math.floor(cell * 0.08));
  const boardWidth = board.columns * cell;
  const boardHeight = board.rows * cell;
  const boardX = portrait ? -boardWidth / 2 : -boardWidth / 2 - Math.min(130, width * 0.12);
  const boardY = portrait ? -boardHeight / 2 - 8 : -boardHeight / 2;
  layoutTilemap(board, cell, cell, gap);
  setTilemapTransform(boardEntity, boardX, boardY);

  if (scoreHud) {
    const scoreCell = Math.max(5, Math.floor(cell * 0.32));
    layoutTilemap(scoreHud, scoreCell, scoreCell, Math.max(1, Math.floor(scoreCell * 0.18)));
    const scoreWidth = scoreHud.columns * scoreCell;
    const x = portrait ? -scoreWidth / 2 : boardX + boardWidth + 40;
    const y = portrait ? Math.min(height / 2 - 48, boardY + boardHeight + 20) : boardY + boardHeight - scoreHud.rows * scoreCell;
    setTilemapTransform(api.read?.find('Tetris Scoreboard'), x, y);
  }

  if (nextHud) {
    const previewCell = Math.max(12, Math.floor(cell * (portrait ? 0.68 : 0.82)));
    layoutTilemap(nextHud, previewCell, previewCell, Math.max(1, Math.floor(previewCell * 0.08)));
    const previewWidth = nextHud.columns * previewCell;
    const x = portrait ? -previewWidth / 2 - Math.min(70, width * 0.16) : boardX + boardWidth + 70;
    const y = portrait ? Math.max(-height / 2 + 34, boardY - previewCell * 4 - 24) : boardY + boardHeight * 0.42;
    setTilemapTransform(api.read?.find('Tetris Next Preview'), x, y);
  }

  if (statusHud) {
    const statusCell = Math.max(10, Math.floor(cell * (portrait ? 0.42 : 0.55)));
    layoutTilemap(statusHud, statusCell, statusCell, Math.max(1, Math.floor(statusCell * 0.12)));
    const statusWidth = statusHud.columns * statusCell;
    const x = portrait ? -statusWidth / 2 + Math.min(80, width * 0.18) : boardX + boardWidth + 62;
    const y = portrait ? Math.max(-height / 2 + 42, boardY - statusCell - 30) : boardY + boardHeight * 0.24;
    setTilemapTransform(api.read?.find('Tetris Status'), x, y);
  }
}

function drawScoreHud() {
  if (!scoreHud) return;
  scoreHud.clear(0);
  const text = String(Math.min(999999, state.score)).padStart(6, '0');
  for (let i = 0; i < text.length; i++) {
    const pattern = digits[text[i]] || digits[0];
    const ox = i * 4;
    for (let y = 0; y < pattern.length; y++) {
      for (let x = 0; x < pattern[y].length; x++) {
        if (pattern[y][x] === '1') scoreHud.setCell(ox + x, scoreHud.rows - 1 - y, 1);
      }
    }
  }
}

function drawNextHud() {
  if (!nextHud) return;
  nextHud.clear(0);
  const preview = makePiece(state.next);
  preview.x = 0;
  preview.y = 0;
  preview.r = 0;
  for (const cell of cells(preview)) {
    if (cell.x >= 0 && cell.x < nextHud.columns && cell.y >= 0 && cell.y < nextHud.rows) {
      nextHud.setCell(cell.x, nextHud.rows - 1 - cell.y, palette[state.next] || 1);
    }
  }
}

function drawStatusHud() {
  if (!statusHud) return;
  const value = state.phase === 'playing' ? 1 : state.phase === 'paused' ? 4 : 7;
  statusHud.clear(value);
}

function draw() {
  updateLayout();
  board.clear(8);
  for (let y = 0; y < board.rows; y++) {
    for (let x = 0; x < board.columns; x++) {
      const value = state.grid[y][x];
      if (value) board.setCell(x, board.rows - 1 - y, value);
    }
  }
  if (state.phase !== 'gameover') {
    for (const cell of cells(state.current)) {
      if (cell.y >= 0) board.setCell(cell.x, board.rows - 1 - cell.y, palette[state.current.kind] || 1);
    }
  }
  api.scene?.setText('Tetris Score', 'Score ' + state.score + '\\nLines ' + state.lines + '\\nLevel ' + state.level);
  api.scene?.setText('Tetris Next', 'Next\\n' + state.next);
  api.scene?.setText('Tetris Status', state.phase === 'playing' ? 'Playing' : state.phase === 'paused' ? 'Paused' : 'Game Over\\nPress R');
  drawScoreHud();
  drawNextHud();
  drawStatusHud();
}

if (!state.ready) {
  reset();
  state.ready = true;
  api.debug.console.log('Tetris Starter Kit ready.');
}

if (api.input.wasPressed('Restart')) reset();
if (api.input.wasPressed('Pause')) state.phase = state.phase === 'paused' ? 'playing' : state.phase === 'playing' ? 'paused' : state.phase;

if (state.phase === 'playing') {
  if (api.input.wasPressed('MoveLeft')) move(-1, 0);
  if (api.input.wasPressed('MoveRight')) move(1, 0);
  if (api.input.wasPressed('Rotate') || api.input.wasPressed('RotateCW')) rotate(1);
  if (api.input.wasPressed('RotateCCW')) rotate(-1);
  if (api.input.wasPressed('HardDrop')) hardDrop();
  state.drop += delta * (api.input.isPressed('SoftDrop') ? 12 : 1);
  const interval = Math.max(110, Number(config.dropMs || 650) - (state.level - 1) * 42);
  if (state.drop >= interval) {
    state.drop = 0;
    if (!move(0, 1)) lock();
  }
}

draw();
`;

export interface TetrisStarterKitDeps {
  getCommandBus: () => CommandBus | null;
  resourcePool: ResourcePool;
  resourceDisplayNames: WeakMap<object, string>;
  getGlobalSettings: () => SerializedGlobalSettings;
  setGlobalSettings: (settings: SerializedGlobalSettings) => void;
  cloneGlobalSettings: (settings: SerializedGlobalSettings) => SerializedGlobalSettings;
  normalizeGlobalSettings: (settings: Partial<SerializedGlobalSettings>) => SerializedGlobalSettings;
  applyGlobalSettingsToWorld: (world: EditorStarterKitApplyContext['world']) => void;
  getUniqueEntityName: (world: EditorStarterKitApplyContext['world'], baseName: string) => string;
  removeEntityKeepingObject: (world: EditorStarterKitApplyContext['world'], entity: Entity) => void;
  selectEntities: (
    entities: Entity[],
    tree: EditorStarterKitApplyContext['tree'],
    previous: Set<Entity>,
    active: Entity | null,
  ) => Set<Entity>;
  refreshTreeSelection: (
    tree: EditorStarterKitApplyContext['tree'],
    world: EditorStarterKitApplyContext['world'],
    selection: Set<Entity>,
  ) => void;
  refreshResourcePool: (world: EditorStarterKitApplyContext['world']) => void;
  renderGlobalSettingsPanel: (world: EditorStarterKitApplyContext['world']) => void;
  renderInspector: (entity: Entity | null, selectionCount: number) => void;
}

function createStarterTilemapEntity(name: string, x: number, y: number, tilemap: Tilemap2DComponent): Entity {
  const entity = new Entity(name);
  entity.addComponent(new Transform2D({ x, y }));
  entity.addComponent(tilemap);
  return entity;
}

export function createTetrisStarterKit(deps: TetrisStarterKitDeps): EditorStarterKit {
  return {
    name: 'Tetris Starter Kit',
    description: 'Camera2D, Tilemap board, GameManager script, DataComponent config, HUD placeholders and Tetris input mapping.',
    apply: context => applyTetrisStarterKit(context, deps),
  };
}

function applyTetrisStarterKit(context: EditorStarterKitApplyContext, deps: TetrisStarterKitDeps): void {
  const { world, tree, getSelection, setActive, setSelection, ensure2DCamera } = context;
  const root = new Entity(deps.getUniqueEntityName(world, 'Tetris Starter Kit'));
  const camera = new Entity('Tetris Camera2D');
  camera.addComponent(new Camera2D({ width: 1280, height: 720, zoom: 1 }));

  const board = new Entity('Tetris Board');
  board.addComponent(new Transform2D({ x: -160, y: -320 }));
  board.addComponent(new Tilemap2DComponent({
    columns: 10,
    rows: 20,
    cellWidth: 32,
    cellHeight: 32,
    gap: 2,
    palette: [
      [0, 0, 0, 0],
      [0.13, 0.83, 0.93, 1],
      [0.15, 0.39, 0.92, 1],
      [0.98, 0.45, 0.10, 1],
      [0.98, 0.80, 0.18, 1],
      [0.20, 0.78, 0.35, 1],
      [0.65, 0.33, 0.92, 1],
      [0.94, 0.24, 0.34, 1],
      [0.07, 0.10, 0.15, 1],
    ],
  }));

  const managerScript = new ScriptResource({
    name: 'Tetris GameManager',
    scripts: { onUpdate: TETRIS_STARTER_SCRIPT },
  });
  deps.resourceDisplayNames.set(managerScript, managerScript.name);

  const manager = new Entity('Tetris GameManager');
  manager.addComponent(new KeyboardComponent());
  manager.addComponent(new DataComponent({
    dropMs: 650,
    kinds: ['I', 'J', 'L', 'O', 'S', 'T', 'Z'],
    paletteIndex: { I: 1, J: 2, L: 3, O: 4, S: 5, T: 6, Z: 7 },
    shapes: {
      I: [[0, 1], [1, 1], [2, 1], [3, 1]],
      J: [[0, 0], [0, 1], [1, 1], [2, 1]],
      L: [[2, 0], [0, 1], [1, 1], [2, 1]],
      O: [[1, 0], [2, 0], [1, 1], [2, 1]],
      S: [[1, 0], [2, 0], [0, 1], [1, 1]],
      T: [[1, 0], [0, 1], [1, 1], [2, 1]],
      Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    },
  }));
  manager.addComponent(new ScriptComponent({}, managerScript));

  const score = createStarterTilemapEntity('Tetris Scoreboard', 235, 210, new Tilemap2DComponent({
    columns: 23,
    rows: 5,
    cellWidth: 12,
    cellHeight: 12,
    gap: 2,
    palette: [
      [0, 0, 0, 0],
      [0.80, 0.92, 1.00, 1],
    ],
  }));
  const next = createStarterTilemapEntity('Tetris Next Preview', 270, 40, new Tilemap2DComponent({
    columns: 4,
    rows: 4,
    cellWidth: 28,
    cellHeight: 28,
    gap: 2,
    palette: [
      [0, 0, 0, 0],
      [0.13, 0.83, 0.93, 1],
      [0.15, 0.39, 0.92, 1],
      [0.98, 0.45, 0.10, 1],
      [0.98, 0.80, 0.18, 1],
      [0.20, 0.78, 0.35, 1],
      [0.65, 0.33, 0.92, 1],
      [0.94, 0.24, 0.34, 1],
    ],
  }));
  const status = createStarterTilemapEntity('Tetris Status', 260, -120, new Tilemap2DComponent({
    columns: 6,
    rows: 1,
    cellWidth: 22,
    cellHeight: 22,
    gap: 3,
    cells: [1, 1, 1, 1, 1, 1],
    palette: [
      [0, 0, 0, 0],
      [0.20, 0.78, 0.35, 1],
      [0.15, 0.39, 0.92, 1],
      [0.98, 0.45, 0.10, 1],
      [0.98, 0.80, 0.18, 1],
      [0.20, 0.78, 0.35, 1],
      [0.65, 0.33, 0.92, 1],
      [0.94, 0.24, 0.34, 1],
    ],
  }));

  root.addChild(camera);
  root.addChild(board);
  root.addChild(score);
  root.addChild(next);
  root.addChild(status);
  root.addChild(manager);

  const previousSettings = deps.cloneGlobalSettings(deps.getGlobalSettings());
  const previousWorldName = world.name;
  let scriptItem: ScriptResourceItem | null = null;

  deps.getCommandBus()?.execute({
    label: 'Add Tetris Starter Kit',
    execute: () => {
      world.name = 'Tetris Starter';
      deps.setGlobalSettings(deps.normalizeGlobalSettings({
        designWidth: 1280,
        designHeight: 720,
        clearColor: [0.03, 0.04, 0.06, 1],
        reverseZ: deps.getGlobalSettings().reverseZ === true,
        parameters: { starterKit: 'tetris' },
        inputMap: InputMap.defaultTetris().toJSON(),
      }));
      deps.applyGlobalSettingsToWorld(world);
      world.addEntity(root);
      scriptItem = deps.resourcePool.registerScript(managerScript, { name: managerScript.name });
      ensure2DCamera?.(camera);
      setActive(manager);
      setSelection(deps.selectEntities([manager], tree, getSelection(), manager));
      deps.refreshTreeSelection(tree, world, getSelection());
      deps.refreshResourcePool(world);
      deps.renderGlobalSettingsPanel(world);
      deps.renderInspector(manager, 1);
    },
    undo: () => {
      deps.removeEntityKeepingObject(world, root);
      managerScript.name = 'Tetris GameManager';
      const item = scriptItem ?? deps.resourcePool.scripts.get(managerScript.id);
      if (item) {
        item.refs = 0;
        deps.resourcePool.unregisterScript(item.id);
      }
      world.name = previousWorldName;
      deps.setGlobalSettings(deps.cloneGlobalSettings(previousSettings));
      deps.applyGlobalSettingsToWorld(world);
      setActive(null);
      setSelection(deps.selectEntities([], tree, getSelection(), null));
      deps.refreshTreeSelection(tree, world, getSelection());
      deps.refreshResourcePool(world);
      deps.renderGlobalSettingsPanel(world);
      deps.renderInspector(null, 0);
    },
  });
}
