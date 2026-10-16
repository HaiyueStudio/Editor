import { createProject, passOf, type ShaderProject } from './model.js';

// JavaScript assembles the example; mine placement, input and gameplay run on the GPU.
export function minesweeperExample(): ShaderProject {
  const p = createProject('Minefield');
  p.id = 'example-minesweeper';
  p.description = '扫雷：左键翻格，Shift＋左键插旗，F 切换插旗模式，R 重新开局。Common 设置行列数和雷数；Buffer A 保存完整盘面。';
  p.tabs = ['image', 'common', 'buffer-a']; p.common = MINES_COMMON;
  const state = passOf(p, 'buffer-a'); state.enabled = true; state.code = MINES_STATE;
  state.channels[0] = { kind: 'buffer', pass: 'buffer-a' };
  state.channels[1] = { kind: 'keyboard' };
  const image = passOf(p, 'image'); image.code = MINES_IMAGE;
  image.channels[0] = { kind: 'buffer', pass: 'buffer-a' };
  image.channels[1] = { kind: 'builtin', texture: 'msdf' };
  return p;
}

export const MINES_COMMON = `// 修改后点击运行：从新盘面开始。
// 行列分别支持 2–20；雷数自动限制为 1 到总格数 - 1。
const MINE_ROWS: i32 = 9;
const MINE_COLUMNS: i32 = 9;
const MINE_COUNT: i32 = 10;
const MINE_SEED: u32 = 23u;

const ROWS: i32 = clamp(MINE_ROWS, 2, 20);
const COLS: i32 = clamp(MINE_COLUMNS, 2, 20);
const CELLS: i32 = ROWS * COLS;
const MINES: i32 = clamp(MINE_COUNT, 1, CELLS - 1);

// Buffer A：每格 RGBA = (是否有雷, 周围雷数, 状态, 1)。
// 状态：0 未翻开 / 1 已翻开 / 2 旗标 / 3 踩中的雷。
// 第 CELLS 个像素：(阶段, 上帧鼠标是否按下, 局号, 首击格编号 + 1)。
// 阶段：0 待首击 / 1 游戏中 / 2 胜利 / 3 失败。
// 第 CELLS+1 个像素：(旗数, 已翻开安全格数, 插旗模式, 有效标记)。
fn dataAt(tex: texture_2d<f32>, index: i32) -> vec4f {
  let size = vec2i(textureDimensions(tex));
  return textureLoad(tex, vec2i(index % size.x, size.y - 1 - index / size.x), 0);
}
fn dataIndex(coord: vec2f) -> i32 {
  return i32(floor(coord.x)) + i32(floor(coord.y)) * i32(iResolution.x);
}
// 统一布局供状态与 Image 使用，避免矩形盘面点击错位。
// 单位为画布高度，坐标从左上角起。
fn boardLayout() -> vec3f {
  let aspect = iResolution.x / iResolution.y;
  let reserved = select(0.08, 0.44, aspect > 1.3);
  let size = min(0.66 / f32(ROWS), max(0.12, aspect - reserved) / f32(COLS));
  let left = (aspect - size * f32(COLS) - select(0.0, 0.32, aspect > 1.3)) * 0.5;
  return vec3f(left, 0.20, size);
}
fn clickedCell() -> i32 {
  let boardView = boardLayout();
  let p = vec2f(iMouse.x, iResolution.y - iMouse.y) / iResolution.y;
  let cell = vec2i(floor((p - boardView.xy) / boardView.z));
  if (any(cell < vec2i(0)) || cell.x >= COLS || cell.y >= ROWS) { return -1; }
  return cell.y * COLS + cell.x;
}
fn cellAt(x: i32, y: i32) -> i32 {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) { return -1; }
  return y * COLS + x;
}
fn hash(value: u32) -> u32 {
  var x = value;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}
// 雷较少时保护首击周围 3×3；高密度时至少保护点击格。
fn protectedCell(index: i32, first: i32) -> bool {
  let x = first % COLS; let y = first / COLS;
  let area = (min(COLS - 1, x + 1) - max(0, x - 1) + 1)
           * (min(ROWS - 1, y + 1) - max(0, y - 1) + 1);
  return index == first || (MINES <= CELLS - area
    && abs(index % COLS - x) <= 1 && abs(index / COLS - y) <= 1);
}
// 随机键排名最小的 MINES 格为雷，排除保护区。
// 排名而非概率阈值保证雷数精确；相同键用格编号打破平局。
fn mineAt(index: i32, first: i32, round: i32) -> bool {
  if (index < 0 || protectedCell(index, first)) { return false; }
  let seed = MINE_SEED + u32(round) * 7919u;
  let key = hash(u32(index) + seed);
  var rank = 0;
  for (var other = 0; other < CELLS; other++) {
    if (protectedCell(other, first)) { continue; }
    let candidate = hash(u32(other) + seed);
    if (candidate < key || (candidate == key && other < index)) { rank++; }
  }
  return rank < MINES;
}`;

export const MINES_STATE = `// A：iChannel0 自身反馈；iChannel1 键盘。
// 只在首个有效翻格时布雷。按下边沿触发，拖动不会连续翻格。
// 空白区域按八邻域逐帧扩展；保持播放时会自动展开到边界。
fn keyPressed(code: i32) -> bool {
  return textureLoad(iChannel1, vec2i(code, 1), 0).r > 0.5;
}
fn mainImage(fragCoord: vec2f) -> vec4f {
  let index = dataIndex(fragCoord);
  if (index > CELLS + 1) { return vec4f(0.0); }
  let header = dataAt(iChannel0, CELLS);
  let counters = dataAt(iChannel0, CELLS + 1);
  let down = iMouse.z > 0.0;
  let fresh = iFrame == 0 || counters.w != 47.0;
  if (fresh || keyPressed(82)) {
    if (index == CELLS) {
      return vec4f(0.0, select(0.0, 1.0, down), select(f32((i32(header.z) + 1) % 256), 0.0, fresh), 0.0);
    }
    if (index == CELLS + 1) { return vec4f(0.0, 0.0, 0.0, 47.0); }
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let phase = i32(header.x);
  let clicked = clickedCell();
  let click = down && header.y < 0.5 && clicked >= 0 && phase < 2;
  var mode = counters.z;
  if (keyPressed(70)) { mode = 1.0 - mode; } // F：插旗模式
  let flag = mode > 0.5 || textureLoad(iChannel1, vec2i(16, 2), 0).r > 0.5;
  var first = i32(header.w) - 1;
  let generate = click && !flag && first < 0 && dataAt(iChannel0, max(clicked, 0)).b != 2.0;
  if (generate) { first = clicked; }

  // 两个元数据像素汇总上一帧的结果，胜负判定最多延迟一帧。
  if (index >= CELLS) {
    var flags = 0; var opened = 0; var exploded = false;
    for (var cell = 0; cell < CELLS; cell++) {
      let data = dataAt(iChannel0, cell);
      if (data.b == 2.0) { flags++; }
      if (data.r == 0.0 && data.b == 1.0) { opened++; }
      exploded = exploded || data.b == 3.0;
    }
    var nextPhase = select(phase, 1, generate);
    if (phase == 1) {
      if (exploded) { nextPhase = 3; }
      else if (opened == CELLS - MINES) { nextPhase = 2; }
    }
    if (index == CELLS) { return vec4f(f32(nextPhase), select(0.0, 1.0, down), header.z, f32(first + 1)); }
    return vec4f(f32(flags), f32(opened), mode, 47.0);
  }

  var data = dataAt(iChannel0, index);
  let x = index % COLS; let y = index / COLS;
  if (generate) {
    var count = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) { continue; }
        if (mineAt(cellAt(x + dx, y + dy), first, i32(header.z))) { count++; }
      }
    }
    data = vec4f(select(0.0, 1.0, mineAt(index, first, i32(header.z))), f32(count), data.b, 1.0);
  }
  if (phase >= 2) {
    // 完成时自动标记剩余地雷，让存储数据、旗标和计数一致。
    if (phase == 2 && data.r > 0.5) { data.b = 2.0; }
    return data;
  }
  if (click && clicked == index) {
    if (flag && (data.b == 0.0 || data.b == 2.0)) { data.b = select(2.0, 0.0, data.b == 2.0); }
    else if (!flag && data.b == 0.0) { data.b = select(1.0, 3.0, data.r > 0.5); }
  }
  // 只传播安全的空白展开，旗标与已结束的棋盘不被修改。
  if (phase == 1 && data.b == 0.0 && data.r == 0.0) {
    var expand = false;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let neighbor = cellAt(x + dx, y + dy);
        if (neighbor < 0) { continue; }
        let old = dataAt(iChannel0, neighbor);
        expand = expand || (old.r == 0.0 && old.g == 0.0 && old.b == 1.0);
      }
    }
    if (expand) { data.b = 1.0; }
  }
  return data;
}`;


const text = (name: string, value: string) => `const ${name} = array<u32, 40>(${Array.from({ length: 40 }, (_, i) => String(value.charCodeAt(i) || 0) + 'u').join(', ')});`;
export const MINES_IMAGE = `// Image：iChannel0 为 A 的盘面，iChannel1 为 MSDF 字体。
// 操作：左键翻格；Shift＋左键插旗；F 切换模式；R 新局。
// A 中只存精确数据，所有颜色、文字和图标在此绘制。
${text('TITLE', 'MINEFIELD')}
${text('SUBTITLE', 'FIRST CLICK IS ALWAYS SAFE.')}
${text('CONTROLS', 'CLICK: OPEN   SHIFT+CLICK: FLAG')}
${text('SHORTCUTS', 'F: FLAG MODE   R: RESTART')}
${text('MINE_LABEL', 'MINES')}
${text('FLAG_LABEL', 'FLAGS')}
${text('SAFE_LABEL', 'SAFE')}
${text('READY', 'READY')}
${text('PLAYING', 'PLAYING')}
${text('WON', 'CLEARED!')}
${text('LOST', 'BOOM!')}
${text('FLAG_MODE', 'FLAG MODE')}
${text('OPEN_MODE', 'OPEN MODE')}
fn glyph(code: u32, uv: vec2f) -> f32 {
  let atlas = (vec2f(f32(code % 16u), f32(code / 16u)) + vec2f(0.12, 0.14)
    + clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(0.76, 0.72)) / 16.0;
  let distance = 1.0 - textureSampleLevel(iChannel1, iSampler, atlas, 0.0).a;
  let aa = max(fwidth(distance), 0.002);
  return smoothstep(0.5 - aa, 0.5 + aa, distance)
    * select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));
}
fn label(p: vec2f, origin: vec2f, size: f32, letters: array<u32, 40>) -> f32 {
  let uv = (p - origin) / vec2f(size * 0.62, size);
  let index = i32(floor(uv.x));
  let code = letters[clamp(index, 0, 39)];
  return glyph(code, vec2f(fract(uv.x), uv.y)) * select(0.0, 1.0, index >= 0 && index < 40 && code != 0u);
}
fn number(value: i32, p: vec2f, origin: vec2f, size: f32) -> f32 {
  let uv = (p - origin) / vec2f(size * 0.62, size);
  let index = i32(floor(uv.x));
  var divisor = 1;
  if (index == 0) { divisor = 100; }
  if (index == 1) { divisor = 10; }
  return glyph(u32(48 + (value / divisor) % 10), vec2f(fract(uv.x), uv.y))
    * select(0.0, 1.0, index >= 0 && index < 3);
}
fn numberColor(count: i32) -> vec3f {
  switch count {
    case 1: { return vec3f(0.34, 0.68, 1.0); }
    case 2: { return vec3f(0.43, 0.87, 0.62); }
    case 3: { return vec3f(1.0, 0.55, 0.36); }
    case 4: { return vec3f(0.72, 0.57, 1.0); }
    case 5: { return vec3f(1.0, 0.39, 0.49); }
    case 6: { return vec3f(0.25, 0.87, 0.88); }
    default: { return vec3f(0.85); }
  }
}
fn mainImage(fragCoord: vec2f) -> vec4f {
  let p = vec2f(fragCoord.x, iResolution.y - fragCoord.y) / iResolution.y;
  let aspect = iResolution.x / iResolution.y;
  let boardView = boardLayout();
  let origin = boardView.xy; let size = boardView.z;
  let board = vec2f(f32(COLS), f32(ROWS)) * size;
  let grid = (p - origin) / size;
  let local = fract(grid);
  let cell = clamp(vec2i(floor(grid)), vec2i(0), vec2i(COLS - 1, ROWS - 1));
  let index = cell.y * COLS + cell.x;
  let data = dataAt(iChannel0, index);
  let header = dataAt(iChannel0, CELLS);
  let counters = dataAt(iChannel0, CELLS + 1);
  let phase = i32(header.x);
  let inside = all(p >= origin) && all(p < origin + board);
  let accent = select(vec3f(0.73, 0.95, 0.38), vec3f(1.0, 0.34, 0.37), phase == 3);
  var color = vec3f(0.035, 0.047, 0.064) + vec3f(p.y * 0.018);
  let outer = all(p >= origin - vec2f(0.004)) && all(p <= origin + board + vec2f(0.004));
  if (outer) { color = select(vec3f(0.12, 0.18, 0.22), accent, phase >= 2); }
  let edge = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y)) * size * iResolution.y;
  let mask = smoothstep(0.7, 1.6, edge);
  let open = data.b == 1.0;
  var face = select(vec3f(0.15, 0.20, 0.26) + vec3f((1.0 - local.y) * 0.025), vec3f(0.060, 0.085, 0.106), open);
  if (data.b == 3.0) { face = vec3f(0.54, 0.10, 0.14); }
  if (inside) { color = mix(vec3f(0.030, 0.045, 0.059), face, mask); }
  // 先统一计算字形导数，再按是否翻开和是否位于盘面内选择颜色。
  let digit = glyph(u32(48 + i32(data.g)), (local - vec2f(0.25, 0.14)) / vec2f(0.50, 0.74));
  if (inside && open && data.g > 0.0) { color = mix(color, numberColor(i32(data.g)), digit); }
  let pole = local.x > 0.33 && local.x < 0.39 && local.y > 0.22 && local.y < 0.77;
  let triangle = local.x > 0.37 && local.x < 0.76 && abs(local.y - 0.32) < (0.76 - local.x) * 0.36;
  let foot = local.x > 0.23 && local.x < 0.55 && local.y > 0.74 && local.y < 0.80;
  let flag = data.b == 2.0 || (phase == 2 && data.r > 0.5);
  if (inside && flag && (pole || triangle || foot)) { color = vec3f(1.0, 0.77, 0.30); }
  let q = local - vec2f(0.5);
  let rays = min(min(abs(q.x), abs(q.y)), min(abs(q.x - q.y), abs(q.x + q.y))) < 0.032;
  let mine = length(q) < 0.18 || (rays && length(q) < 0.31);
  if (inside && phase == 3 && data.r > 0.5 && !flag && mine) { color = vec3f(1.0, 0.61, 0.56); }
  let cross = min(abs(q.x - q.y), abs(q.x + q.y)) < 0.055 && max(abs(q.x), abs(q.y)) < 0.3;
  if (inside && phase == 3 && flag && data.r == 0.0 && cross) { color = vec3f(1.0, 0.32, 0.38); }

  color = mix(color, vec3f(0.94, 0.96, 0.91), label(p, vec2f(origin.x, 0.045), 0.052, TITLE));
  color = mix(color, vec3f(0.49, 0.61, 0.66), label(p, vec2f(origin.x, 0.111), 0.026, SUBTITLE));
  color = mix(color, vec3f(0.70, 0.77, 0.79), label(p, vec2f(origin.x, 0.906), 0.028, CONTROLS));
  color = mix(color, vec3f(0.49, 0.61, 0.66), label(p, vec2f(origin.x, 0.947), 0.027, SHORTCUTS));
  let right = origin.x + board.x + 0.055;
  let visible = select(0.0, 1.0, aspect > 1.3);
  color = mix(color, vec3f(0.49, 0.61, 0.66), visible * label(p, vec2f(right, 0.20), 0.028, MINE_LABEL));
  color = mix(color, accent, visible * number(MINES, p, vec2f(right, 0.244), 0.062));
  color = mix(color, vec3f(0.49, 0.61, 0.66), visible * label(p, vec2f(right, 0.36), 0.028, FLAG_LABEL));
  color = mix(color, vec3f(1.0, 0.77, 0.30), visible * number(i32(counters.x), p, vec2f(right, 0.404), 0.062));
  color = mix(color, vec3f(0.49, 0.61, 0.66), visible * label(p, vec2f(right, 0.52), 0.028, SAFE_LABEL));
  color = mix(color, vec3f(0.64, 0.82, 0.90), visible * number(i32(counters.y), p, vec2f(right, 0.564), 0.062));
  let ready = label(p, vec2f(right, 0.72), 0.032, READY);
  let playing = label(p, vec2f(right, 0.72), 0.032, PLAYING);
  let won = label(p, vec2f(right, 0.72), 0.032, WON);
  let lost = label(p, vec2f(right, 0.72), 0.032, LOST);
  let message = select(select(ready, playing, phase == 1), select(won, lost, phase == 3), phase >= 2);
  color = mix(color, accent, visible * message);
  let mode = select(label(p, vec2f(right, 0.79), 0.023, OPEN_MODE), label(p, vec2f(right, 0.79), 0.023, FLAG_MODE), counters.z > 0.5);
  color = mix(color, vec3f(1.0, 0.77, 0.30), visible * mode);
  return vec4f(color, 1.0);
}`;

