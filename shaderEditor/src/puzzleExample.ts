import { createProject, passOf, type ShaderProject } from './model.js';

// Only project construction runs in JavaScript; game state and logic live in shaders.
export function puzzleExample(): ShaderProject {
  const p = createProject('Sliding city');
  p.id = 'example-puzzle';
  p.description = '滑块拼图：先点击画布，方向键 / WASD 移动图片块，R 重新打乱，按住空格查看原图。Common 调整行列数，Buffer A 可替换图片。';
  p.tabs = ['image', 'common', 'buffer-a', 'buffer-b', 'buffer-c'];
  p.common = PUZZLE_COMMON;
  const a = passOf(p, 'buffer-a'), b = passOf(p, 'buffer-b'), c = passOf(p, 'buffer-c'), image = passOf(p, 'image');
  for (const pass of [a, b, c]) pass.enabled = true;
  a.code = PUZZLE_PICTURE; a.channels[0] = { kind: 'builtin', texture: 'future-city' };
  b.code = PUZZLE_STATE; b.channels[0] = { kind: 'buffer', pass: 'buffer-b' }; b.channels[1] = { kind: 'buffer', pass: 'buffer-c' };
  c.code = PUZZLE_INPUT; c.channels[0] = { kind: 'keyboard' }; c.channels[1] = { kind: 'buffer', pass: 'buffer-c' };
  image.code = PUZZLE_IMAGE;
  image.channels = [{ kind: 'buffer', pass: 'buffer-a' }, { kind: 'buffer', pass: 'buffer-b' }, { kind: 'buffer', pass: 'buffer-c' }, { kind: 'builtin', texture: 'msdf' }];
  return p;
}

export const PUZZLE_COMMON = `// 改参数后点击运行；状态会重新初始化。
// 从左上角开始按行编号，最后一块（原图右下角）为空位。
const PUZZLE_ROWS: i32 = 4;       // X 行，支持 2–8
const PUZZLE_COLUMNS: i32 = 4;    // Y 列，支持 2–8
const PUZZLE_SHUFFLE_STEPS: i32 = 64; // 0 = 已完成，可用于学习；最多 256
const PUZZLE_SEED: u32 = 17u;    // 相同种子可复现初始棋盘
const PUZZLE_SHOW_NUMBERS: bool = true;
const ROWS: i32 = clamp(PUZZLE_ROWS, 2, 8);
const COLS: i32 = clamp(PUZZLE_COLUMNS, 2, 8);
const COUNT: i32 = ROWS * COLS;

// 数据从纹理左下角起排列；textureLoad 防止线性过滤混合状态。
// 窄画布一行放不下时自动换行。
fn dataAt(tex: texture_2d<f32>, index: i32) -> vec4f {
  let size = vec2i(textureDimensions(tex));
  return textureLoad(tex, vec2i(index % size.x, size.y - 1 - index / size.x), 0);
}
fn dataIndex(coord: vec2f) -> i32 {
  return i32(floor(coord.x)) + i32(floor(coord.y)) * i32(iResolution.x);
}
// 方向表示图片块的移动方向，返回能移入空位的相邻格。
// 1 左 / 2 右 / 3 上 / 4 下；越界返回 -1，禁止跨行。
fn neighbor(empty: i32, direction: i32) -> i32 {
  let x = empty % COLS; let y = empty / COLS;
  if (direction == 1 && x + 1 < COLS) { return empty + 1; }
  if (direction == 2 && x > 0) { return empty - 1; }
  if (direction == 3 && y + 1 < ROWS) { return empty + COLS; }
  if (direction == 4 && y > 0) { return empty - COLS; }
  return -1;
}`;

export const PUZZLE_PICTURE = `// Buffer A：原图。替换 iChannel0 即可使用自己的图片。
// Image 根据块编号裁切；完整 UV 保留原图所有内容。
fn mainImage(fragCoord: vec2f) -> vec4f {
  return vec4f(channel0(fragCoord / iResolution.xy).rgb, 1.0);
}`;

export const PUZZLE_INPUT = `// C：iChannel0 键盘，iChannel1 自身上一帧。
// 首个像素 RGBA = (指令, 序号, 空格是否按住, 有效标记)。
// 序号只在按下时递增；B 只消费一次。B 在 C 之前渲染，
// 因此读取上一帧 C，固定延迟一帧而不丢按键。
fn pressed(key: i32) -> bool {
  // 原始键盘纹理从上往下为 toggle / pressed / held。
  return textureLoad(iChannel0, vec2i(key, 1), 0).r > 0.5;
}
fn mainImage(fragCoord: vec2f) -> vec4f {
  if (dataIndex(fragCoord) != 0) { return vec4f(0.0); }
  var previous = dataAt(iChannel1, 0);
  if (iFrame == 0) { previous = vec4f(0.0); }
  var command = 0;
  if (pressed(37) || pressed(65)) { command = 1; }
  else if (pressed(39) || pressed(68)) { command = 2; }
  else if (pressed(38) || pressed(87)) { command = 3; }
  else if (pressed(40) || pressed(83)) { command = 4; }
  else if (pressed(82)) { command = 5; } // R：新的可解棋盘
  var sequence = i32(previous.y);
  if (command != 0) { sequence = (sequence + 1) % 1024; }
  else { command = i32(previous.x); }
  let reference = textureLoad(iChannel0, vec2i(32, 2), 0).r;
  return vec4f(f32(command), f32(sequence), reference, 1.0);
}`;

export const PUZZLE_STATE = `// B：iChannel0 自身上一帧，iChannel1 上一帧 C。
// 像素 [0, COUNT) 的 R 存图片块编号（COUNT-1 = 空位）。
// 像素 COUNT = (空位位置, 移动次数, 已消费的指令序号, 是否完成)。
// 像素 COUNT+1 = (行数, 列数, 第几次打乱, 有效标记)。
fn mainImage(fragCoord: vec2f) -> vec4f {
  let index = dataIndex(fragCoord);
  if (index > COUNT + 1) { return vec4f(0.0); }
  var tiles: array<i32, 64>;
  let status = dataAt(iChannel0, COUNT);
  let config = dataAt(iChannel0, COUNT + 1);
  let input = dataAt(iChannel1, 0);
  let sequence = i32(input.y);
  let fresh = iFrame == 0 || config.w != 23.0 || config.x != f32(ROWS) || config.y != f32(COLS);
  let changed = sequence != i32(status.z);
  let restart = !fresh && changed && i32(input.x) == 5;
  var round = i32(config.z);
  var empty = i32(status.x);
  var moves = i32(status.y);
  if (fresh || restart) {
    round = select((round + 1) % 256, 0, fresh);
    moves = 0; empty = COUNT - 1;
    for (var i = 0; i < COUNT; i++) { tiles[i] = i; }
    var random = PUZZLE_SEED + u32(round) * 97u;
    var previousEmpty = -1;
    // 从完成状态走合法步，避免直接交换随机块导致无解。
    for (var step = 0; step < clamp(PUZZLE_SHUFFLE_STEPS, 0, 256); step++) {
      random = random * 1664525u + 1013904223u;
      let first = i32((random >> 16u) % 4u);
      for (var attempt = 0; attempt < 4; attempt++) {
        let next = neighbor(empty, 1 + (first + attempt) % 4);
        if (next >= 0 && next != previousEmpty) {
          tiles[empty] = tiles[next]; tiles[next] = COUNT - 1;
          previousEmpty = empty; empty = next; break;
        }
      }
    }
    var ordered = true;
    for (var i = 0; i < COUNT; i++) { ordered = ordered && tiles[i] == i; }
    // 小棋盘可能绕回起点，非零打乱步数保证不会直接完成。
    if (ordered && PUZZLE_SHUFFLE_STEPS > 0) {
      let next = neighbor(empty, 2);
      tiles[empty] = tiles[next]; tiles[next] = COUNT - 1; empty = next;
    }
  } else {
    for (var i = 0; i < COUNT; i++) { tiles[i] = i32(dataAt(iChannel0, i).r); }
    if (changed) {
      let next = neighbor(empty, i32(input.x));
      if (next >= 0) {
        tiles[empty] = tiles[next]; tiles[next] = COUNT - 1; empty = next;
        moves = min(moves + 1, 999);
      }
    }
  }
  var solved = true;
  for (var i = 0; i < COUNT; i++) { solved = solved && tiles[i] == i; }
  if (index == COUNT) { return vec4f(f32(empty), f32(moves), f32(sequence), select(0.0, 1.0, solved)); }
  if (index == COUNT + 1) { return vec4f(f32(ROWS), f32(COLS), f32(round), 23.0); }
  return vec4f(f32(tiles[index]), 0.0, 0.0, 1.0);
}`;


// Fixed glyph arrays keep all text rendering inside the Image shader.
const text = (name: string, value: string) => `const ${name} = array<u32, 32>(${Array.from({ length: 32 }, (_, i) => String(value.charCodeAt(i) || 0) + 'u').join(', ')});`;
export const PUZZLE_IMAGE = `// Image：A 原图 / B 棋盘 / C 输入 / 内置 MSDF。
// 点击画布后，方向键 / WASD 移动图片块，R 打乱，按住空格查看原图。
${text('TITLE', 'SLIDING CITY')}
${text('SUBTITLE', 'A PICTURE. ONE MISSING PIECE.')}
${text('CONTROLS', 'ARROWS / WASD : SLIDE TILES')}
${text('SHORTCUTS', 'R : SHUFFLE   SPACE : PEEK')}
${text('REFERENCE', 'REFERENCE')}
${text('MOVES', 'MOVES')}
${text('SOLVED', 'SOLVED!')}
${text('PLAY', 'YOUR MOVE')}
fn glyph(code: u32, uv: vec2f) -> f32 {
  let atlas = (vec2f(f32(code % 16u), f32(code / 16u)) + vec2f(0.12, 0.14) + clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(0.76, 0.72)) / 16.0;
  let distance = 1.0 - textureSampleLevel(iChannel3, iSampler, atlas, 0.0).a;
  let aa = max(fwidth(distance), 0.002);
  return smoothstep(0.5 - aa, 0.5 + aa, distance) * select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));
}
fn label(p: vec2f, origin: vec2f, size: f32, letters: array<u32, 32>, length: i32) -> f32 {
  let uv = (p - origin) / vec2f(size * 0.62, size);
  let index = i32(floor(uv.x));
  let shape = glyph(letters[clamp(index, 0, 31)], vec2f(fract(uv.x), uv.y));
  return shape * select(0.0, 1.0, index >= 0 && index < length);
}
fn number(value: i32, p: vec2f, origin: vec2f, size: f32, digits: i32) -> f32 {
  let uv = (p - origin) / vec2f(size * 0.62, size);
  let index = i32(floor(uv.x));
  var divisor = 1;
  if (digits - index == 3) { divisor = 100; }
  if (digits - index == 2) { divisor = 10; }
  let shape = glyph(u32(48 + (value / divisor) % 10), vec2f(fract(uv.x), uv.y));
  return shape * select(0.0, 1.0, index >= 0 && index < digits);
}
fn mainImage(fragCoord: vec2f) -> vec4f {
  let p = vec2f(fragCoord.x, iResolution.y - fragCoord.y) / iResolution.y;
  let aspect = iResolution.x / iResolution.y;
  let wide = aspect > 1.3;
  let side = min(0.68, aspect * 0.86);
  let left = (aspect - side - select(0.0, 0.34, wide)) * 0.5;
  let origin = vec2f(left, 0.20);
  let uv = (p - origin) / side;
  let grid = uv * vec2f(f32(COLS), f32(ROWS));
  let cell = clamp(vec2i(floor(grid)), vec2i(0), vec2i(COLS - 1, ROWS - 1));
  let position = cell.y * COLS + cell.x;
  let status = dataAt(iChannel1, COUNT);
  let peek = dataAt(iChannel2, 0).z > 0.5;
  let tile = select(i32(dataAt(iChannel1, position).r), position, peek);
  let local = fract(grid);
  let sourceUV = (vec2f(f32(tile % COLS), f32(tile / COLS)) + local) / vec2f(f32(COLS), f32(ROWS));
  let picture = channel0(vec2f(sourceUV.x, 1.0 - sourceUV.y)).rgb;
  let inside = all(uv >= vec2f(0.0)) && all(uv < vec2f(1.0));
  let tilePixels = side * iResolution.y / vec2f(f32(COLS), f32(ROWS));
  let edge = min(min(local.x, 1.0 - local.x) * tilePixels.x, min(local.y, 1.0 - local.y) * tilePixels.y);
  let mask = smoothstep(1.0, 2.4, edge);
  let accent = vec3f(0.73, 0.95, 0.38);
  var color = vec3f(0.035, 0.047, 0.064) + 0.018 * vec3f(p.y);
  let shadowUV = abs((p - origin - vec2f(side * 0.5)) / side);
  let border = max(shadowUV.x, shadowUV.y);
  color = mix(color, select(vec3f(0.12, 0.18, 0.22), accent, status.w > 0.5), select(0.0, 1.0, border < 0.508));
  let isTile = tile != COUNT - 1 || peek;
  let tileColor = mix(vec3f(0.018, 0.026, 0.035), picture, mask);
  if (inside) { color = select(vec3f(0.023, 0.034, 0.045), tileColor, isTile); }
  // 小编号帮助辨识颜色相近的图块；所有导数采样在分支外计算。
  let fontSize = min(side / f32(COLS), side / f32(ROWS)) * 0.19;
  let badgeOrigin = origin + vec2f(cell) * side / vec2f(f32(COLS), f32(ROWS)) + vec2f(0.008);
  let digits = select(1, 2, tile + 1 >= 10);
  let numeral = number(tile + 1, p, badgeOrigin, fontSize, digits);
  let inBadge = all(p >= badgeOrigin) && all(p <= badgeOrigin + vec2f(fontSize * 1.4, fontSize * 1.05));
  if (inside && isTile && !peek && PUZZLE_SHOW_NUMBERS) {
    color = mix(color, vec3f(0.012, 0.02, 0.026), select(0.0, 0.72, inBadge));
    color = mix(color, vec3f(0.95), numeral);
  }
  color = mix(color, vec3f(0.94, 0.96, 0.91), label(p, vec2f(left, 0.048), 0.047, TITLE, 12));
  color = mix(color, vec3f(0.44, 0.56, 0.60), label(p, vec2f(left, 0.109), 0.026, SUBTITLE, 29));
  color = mix(color, vec3f(0.65, 0.73, 0.76), label(p, vec2f(left, 0.913), 0.028, CONTROLS, 27));
  color = mix(color, vec3f(0.44, 0.56, 0.60), label(p, vec2f(left, 0.948), 0.027, SHORTCUTS, 26));
  let right = left + side + 0.065;
  let miniUV = (p - vec2f(right, 0.245)) / 0.24;
  let mini = channel0(vec2f(miniUV.x, 1.0 - miniUV.y)).rgb;
  if (wide && all(miniUV >= vec2f(0.0)) && all(miniUV <= vec2f(1.0))) { color = mini; }
  let visible = select(0.0, 1.0, wide);
  color = mix(color, vec3f(0.44, 0.56, 0.60), visible * label(p, vec2f(right, 0.20), 0.027, REFERENCE, 9));
  color = mix(color, accent, visible * number(i32(status.y), p, vec2f(right, 0.59), 0.065, 3));
  color = mix(color, vec3f(0.44, 0.56, 0.60), visible * label(p, vec2f(right, 0.55), 0.028, MOVES, 5));
  let message = select(label(p, vec2f(right, 0.75), 0.026, PLAY, 9), label(p, vec2f(right, 0.75), 0.030, SOLVED, 7), status.w > 0.5);
  color = mix(color, accent, visible * message);
  return vec4f(color, 1.0);
}`;

