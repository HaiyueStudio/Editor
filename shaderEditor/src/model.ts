import { builtinTexture, type BuiltinTextureId } from './builtinTextures.js';

export const PASS_IDS = ['buffer-a', 'buffer-b', 'buffer-c', 'buffer-d', 'image'] as const;
export type PassId = typeof PASS_IDS[number];
export type RenderPassId = PassId | 'sound';
export type CodeId = RenderPassId | 'common';
export interface SoundPass { glsl?: string; id: 'sound'; enabled: boolean; code: string; channels: Channel[]; duration: number; volume: number }
export type RenderPass = ShaderPass | SoundPass;
export type BufferId = Exclude<PassId, 'image'>;
export const CUBE_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;
export type CubeFace = typeof CUBE_FACES[number];
export const CUBE_FACE_LABELS: Record<CubeFace, string> = { px: '+X 右', nx: '−X 左', py: '+Y 上', ny: '−Y 下', pz: '+Z 前', nz: '−Z 后' };
export type Channel = { kind: 'none' } | { kind: 'image'; assetId: string } | { kind: 'cubemap'; assetId: string } | { kind: 'buffer'; pass: BufferId } | { kind: 'builtin'; texture: BuiltinTextureId } | { kind: 'video'; assetId: string } | { kind: 'keyboard' };
export type PreviewMode = 'canvas' | 'scene';
export type PreviewMesh = 'sphere' | 'box' | 'torus';
export interface ShaderPass { glsl?: string; id: PassId; enabled: boolean; code: string; channels: Channel[] }
export interface ImageAsset { id: string; name: string; kind?: 'image'; dataUrl: string }
export interface CubeAsset { id: string; name: string; kind: 'cubemap'; faces: Record<CubeFace, string> }
export interface VideoAsset { id: string; name: string; kind: 'video'; dataUrl: string }
export type TextureAsset = ImageAsset | CubeAsset | VideoAsset;
export const channelTypes = (channels: readonly Channel[]) => channels.map(c => c.kind === 'none' ? null : c.kind === 'cubemap' ? 'cube' as const : '2d' as const);
export interface ShaderProject {
  format: 'haiyue-shader'; version: 1; id: string; name: string; description: string;
  updatedAt: string; tabs?: CodeId[]; common: string; commonGlsl?: string; sound: SoundPass; passes: ShaderPass[]; assets: TextureAsset[];
  preview: { mode: PreviewMode; mesh: PreviewMesh; scale: number };
}
export interface ShaderDiagnostic { pass: CodeId; severity: 'error' | 'warning' | 'info'; message: string; line: number; column: number }
export const LIMITS = { code: 100_000, imageBytes: 8 * 1024 * 1024, videoBytes: 24 * 1024 * 1024, projectBytes: 48 * 1024 * 1024, assets: 16, dimension: 4096 } as const;
export const PASS_LABELS: Record<CodeId, string> = { sound: 'Sound', common: 'Common', image: 'Image', 'buffer-a': 'Buffer A', 'buffer-b': 'Buffer B', 'buffer-c': 'Buffer C', 'buffer-d': 'Buffer D' };
export const DEFAULT_CODE = `// fragCoord: 像素坐标，原点在左下角
fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  let color = vec3f(0.5) + 0.5 * cos(vec3f(iTime) + uv.xyx + vec3f(0.0, 2.0, 4.0));
  return vec4f(color, 1.0);
}`;
export const BUFFER_CODE = `fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  return vec4f(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}`;
export const SOUND_CODE = `// 左右声道范围 -1 到 1；时间单位为秒。\nfn mainSound(sampleIndex: i32, time: f32) -> vec2f {\n  let beat = floor(time * 4.0);\n  let note = select(select(60.0, 64.0, beat % 4.0 == 1.0), select(67.0, 72.0, beat % 4.0 == 3.0), beat % 4.0 >= 2.0);\n  let frequency = 440.0 * pow(2.0, (note - 69.0) / 12.0);\n  let phase = fract(time * 4.0);\n  let envelope = smoothstep(0.0, 0.02, phase) * exp(-phase * 5.0);\n  let tone = sin(6.2831853 * frequency * time) * envelope * 0.3;\n  return vec2f(tone, tone);\n}`;
export function createSound(): SoundPass { return { id: 'sound', enabled: false, code: SOUND_CODE, channels: emptyChannels(), duration: 60, volume: 0.25 }; }
export function emptyChannels(): Channel[] { return Array.from({ length: 4 }, () => ({ kind: 'none' })); }
export function createProject(name = 'Untitled shader'): ShaderProject {
  return { format: 'haiyue-shader', version: 1, id: crypto.randomUUID(), name, description: '', updatedAt: new Date().toISOString(), tabs: ['image'], common: '', sound: createSound(),
    passes: PASS_IDS.map(id => ({ id, enabled: id === 'image', code: id === 'image' ? DEFAULT_CODE : BUFFER_CODE, channels: emptyChannels() })),
    assets: [], preview: { mode: 'canvas', mesh: 'sphere', scale: 1 } };
}
/** Explicitly added tabs plus legacy/externally configured modules; never hide authored code. */
export function codeTabs(project: Readonly<ShaderProject>): CodeId[] {
  const tabs = new Set<CodeId>(['image', ...(project.tabs ?? [])]);
  if (project.common || project.commonGlsl !== undefined) tabs.add('common');
  for (const pass of [...project.passes, project.sound]) {
    const initial = pass.id === 'image' ? DEFAULT_CODE : pass.id === 'sound' ? SOUND_CODE : BUFFER_CODE;
    if (pass.enabled || pass.code !== initial || pass.glsl !== undefined || pass.channels.some(c => c.kind !== 'none')) tabs.add(pass.id);
  }
  return [...tabs];
}
export function revealCodeTab(project: ShaderProject, id: CodeId) { project.tabs = [...new Set([...codeTabs(project), id])]; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function validateProject(value: unknown): ShaderProject {
  assert(value && typeof value === 'object', '工程内容无效。');
  const p = value as ShaderProject;
  assert(p.format === 'haiyue-shader' && p.version === 1, '不支持的 Shader 工程版本。');
  assert(typeof p.id === 'string' && /^[\w-]{1,80}$/.test(p.id), '工程 ID 无效。');
  assert(typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 120, '名称长度须为 1–120。');
  assert(typeof p.description === 'string' && p.description.length <= 2000, '描述过长。');
  assert(typeof p.updatedAt === 'string' && Number.isFinite(Date.parse(p.updatedAt)), '保存日期无效。');
  assert(Array.isArray(p.assets) && p.assets.length <= LIMITS.assets, '最多保存 16 个纹理资源。');
  const ids = new Set<string>(); let imageCharacters = 0;
  for (const a of p.assets) {
    assert(a && typeof a.id === 'string' && /^[\w-]{1,80}$/.test(a.id) && !ids.has(a.id), '图片 ID 无效或重复。'); ids.add(a.id);
    assert(typeof a.name === 'string' && a.name.length <= 200, '图片名称无效。');
    assert(a.kind === undefined || a.kind === 'image' || a.kind === 'cubemap' || a.kind === 'video', '纹理资源类型无效。');
    if (a.kind === 'video') {
      assert(typeof a.dataUrl === 'string' && /^data:video\/(mp4|webm);base64,[A-Za-z0-9+/]+=*$/.test(a.dataUrl), '视频必须是 MP4 或 WebM。');
      assert(a.dataUrl.length <= LIMITS.videoBytes * 1.34, '单个视频不能超过 24 MB。');
      imageCharacters += a.dataUrl.length; continue;
    }
    if (a.kind === 'cubemap') assert(a.faces && typeof a.faces === 'object' && Object.keys(a.faces).length === 6 && CUBE_FACES.every(face => typeof a.faces[face] === 'string'), '立方体贴图需要 px、nx、py、ny、pz、nz 六个面。');
    const images = a.kind === 'cubemap' ? CUBE_FACES.map(face => a.faces[face]) : [a.dataUrl];
    for (const dataUrl of images) {
      assert(typeof dataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl), '图片必须是 PNG、JPEG 或 WebP。');
      assert(dataUrl.length <= LIMITS.imageBytes * 1.34, '单张图片不能超过 8 MB。'); imageCharacters += dataUrl.length;
    }
  }
  assert(imageCharacters < LIMITS.projectBytes - 1_000_000, '工程图片总量超过限制。');
  assert(p.tabs === undefined || (Array.isArray(p.tabs) && p.tabs.length <= 7 && p.tabs.includes('image') && new Set(p.tabs).size === p.tabs.length && p.tabs.every(id => ['common', 'sound', ...PASS_IDS].includes(id))), '代码页签无效或重复。');
  assert(p.common === undefined || (typeof p.common === 'string' && p.common.length <= LIMITS.code), 'Common 代码不能超过 100 KB。');
  assert(p.commonGlsl === undefined || (typeof p.commonGlsl === 'string' && p.commonGlsl.length <= LIMITS.code), 'Common GLSL 不能超过 100 KB。');
  assert(Array.isArray(p.passes) && p.passes.length === 5 && PASS_IDS.every(id => p.passes.filter(pass => pass?.id === id).length === 1), '工程需要 Image 和 Buffer A–D，且不能重复。');
  assert(p.sound === undefined || (p.sound !== null && typeof p.sound === 'object'), 'Sound 设置无效。');
  const sound = p.sound ?? createSound();
  assert(sound.id === 'sound' && typeof sound.duration === 'number' && Number.isFinite(sound.duration) && sound.duration >= 1 && sound.duration <= 120, 'Sound WAV 导出时长需为 1–120 秒。');
  assert(typeof sound.volume === 'number' && Number.isFinite(sound.volume) && sound.volume >= 0 && sound.volume <= 1, '音量需为 0–1。');
  for (const pass of [...p.passes, sound]) {
    assert(typeof pass.enabled === 'boolean' && (pass.id !== 'image' || pass.enabled), 'Image 必须启用。');
    assert(typeof pass.code === 'string' && pass.code.length <= LIMITS.code, '单个 Pass 代码不能超过 100 KB。');
    assert(pass.glsl === undefined || (typeof pass.glsl === 'string' && pass.glsl.length <= LIMITS.code), 'Pass GLSL 不能超过 100 KB。');
    assert(Array.isArray(pass.channels) && pass.channels.length === 4, '每个 Pass 必须有四个纹理通道。');
    for (const c of pass.channels) {
      assert(pass.id !== 'sound' || ['none', 'image', 'cubemap', 'builtin'].includes(c?.kind), 'Sound 支持静态图片、内置纹理与 Cubemap；不支持动态 Buffer、视频或键盘输入。');
      assert(c && ['none', 'image', 'cubemap', 'buffer', 'builtin', 'video', 'keyboard'].includes(c.kind), '纹理通道类型无效。');
      if (c.kind === 'builtin') builtinTexture(c.texture);
      if (c.kind === 'image' || c.kind === 'cubemap' || c.kind === 'video') {
        const asset = p.assets.find(a => a.id === c.assetId);
        assert(asset, '纹理通道引用了不存在的图片。');
        assert((asset.kind ?? 'image') === c.kind, '通道类型与纹理资源不一致。');
      }
      if (c.kind === 'buffer') assert(PASS_IDS.includes(c.pass) && c.pass !== ('image' as string) && p.passes.some(b => b.id === c.pass && b.enabled), '通道引用的 Buffer 必须启用。');
    }
  }
  assert(p.preview && ['canvas', 'scene'].includes(p.preview.mode) && ['sphere', 'box', 'torus'].includes(p.preview.mesh) && [0.25, 0.5, 1].includes(p.preview.scale), '预览设置无效。');
  const clean = structuredClone(p);
  clean.common ??= '';
  clean.sound ??= createSound();
  clean.passes.sort((a, b) => PASS_IDS.indexOf(a.id) - PASS_IDS.indexOf(b.id));
  return clean;
}
export function parseProject(text: string): ShaderProject {
  assert(new TextEncoder().encode(text).byteLength <= LIMITS.projectBytes, '工程不能超过 48 MB。');
  return validateProject(JSON.parse(text));
}
export function passOf(project: ShaderProject, id: PassId): ShaderPass;
export function passOf(project: ShaderProject, id: 'sound'): SoundPass;
export function passOf(project: ShaderProject, id: RenderPassId): RenderPass;
export function passOf(project: ShaderProject, id: RenderPassId): RenderPass {
  if (id === 'sound') return project.sound;
  const pass = project.passes.find(p => p.id === id); if (!pass) throw new Error('Pass 不存在。'); return pass;
}
export function codeOf(project: Readonly<ShaderProject>, id: CodeId): string {
  return id === 'common' ? project.common ?? '' : passOf(project as ShaderProject, id).code;
}
/** Shadertoy order: preceding buffers expose this frame; self/forward references expose the previous frame. */
export function usesCurrentFrame(reader: PassId, source: BufferId): boolean { return PASS_IDS.indexOf(source) < PASS_IDS.indexOf(reader); }
