import { builtinTexture, type BuiltinTextureId } from './builtinTextures.js';

export const PASS_IDS = ['buffer-a', 'buffer-b', 'buffer-c', 'buffer-d', 'image'] as const;
export type PassId = typeof PASS_IDS[number];
export type BufferId = Exclude<PassId, 'image'>;
export const CUBE_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;
export type CubeFace = typeof CUBE_FACES[number];
export const CUBE_FACE_LABELS: Record<CubeFace, string> = { px: '+X 右', nx: '−X 左', py: '+Y 上', ny: '−Y 下', pz: '+Z 前', nz: '−Z 后' };
export type Channel = { kind: 'none' } | { kind: 'image'; assetId: string } | { kind: 'cubemap'; assetId: string } | { kind: 'buffer'; pass: BufferId } | { kind: 'builtin'; texture: BuiltinTextureId } | { kind: 'video'; assetId: string } | { kind: 'keyboard' };
export type PreviewMode = 'canvas' | 'scene';
export type PreviewMesh = 'sphere' | 'box' | 'torus';
export interface ShaderPass { id: PassId; enabled: boolean; code: string; channels: Channel[] }
export interface ImageAsset { id: string; name: string; kind?: 'image'; dataUrl: string }
export interface CubeAsset { id: string; name: string; kind: 'cubemap'; faces: Record<CubeFace, string> }
export interface VideoAsset { id: string; name: string; kind: 'video'; dataUrl: string }
export type TextureAsset = ImageAsset | CubeAsset | VideoAsset;
export const channelTypes = (channels: readonly Channel[]) => channels.map(c => c.kind === 'none' ? null : c.kind === 'cubemap' ? 'cube' as const : '2d' as const);
export interface ShaderProject {
  format: 'haiyue-shader'; version: 1; id: string; name: string; description: string;
  updatedAt: string; passes: ShaderPass[]; assets: TextureAsset[];
  preview: { mode: PreviewMode; mesh: PreviewMesh; scale: number };
}
export interface ShaderDiagnostic { pass: PassId; severity: 'error' | 'warning' | 'info'; message: string; line: number; column: number }
export const LIMITS = { code: 100_000, imageBytes: 8 * 1024 * 1024, videoBytes: 24 * 1024 * 1024, projectBytes: 48 * 1024 * 1024, assets: 16, dimension: 4096 } as const;
export const PASS_LABELS: Record<PassId, string> = { image: 'Image', 'buffer-a': 'Buffer A', 'buffer-b': 'Buffer B', 'buffer-c': 'Buffer C', 'buffer-d': 'Buffer D' };
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
export function emptyChannels(): Channel[] { return Array.from({ length: 4 }, () => ({ kind: 'none' })); }
export function createProject(name = 'Untitled shader'): ShaderProject {
  return { format: 'haiyue-shader', version: 1, id: crypto.randomUUID(), name, description: '', updatedAt: new Date().toISOString(),
    passes: PASS_IDS.map(id => ({ id, enabled: id === 'image', code: id === 'image' ? DEFAULT_CODE : BUFFER_CODE, channels: emptyChannels() })),
    assets: [], preview: { mode: 'canvas', mesh: 'sphere', scale: 1 } };
}
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
  assert(Array.isArray(p.passes) && p.passes.length === 5 && PASS_IDS.every(id => p.passes.filter(pass => pass?.id === id).length === 1), '工程需要 Image 和 Buffer A–D，且不能重复。');
  for (const pass of p.passes) {
    assert(typeof pass.enabled === 'boolean' && (pass.id !== 'image' || pass.enabled), 'Image 必须启用。');
    assert(typeof pass.code === 'string' && pass.code.length <= LIMITS.code, '单个 Pass 代码不能超过 100 KB。');
    assert(Array.isArray(pass.channels) && pass.channels.length === 4, '每个 Pass 必须有四个纹理通道。');
    for (const c of pass.channels) {
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
  clean.passes.sort((a, b) => PASS_IDS.indexOf(a.id) - PASS_IDS.indexOf(b.id));
  return clean;
}
export function parseProject(text: string): ShaderProject {
  assert(new TextEncoder().encode(text).byteLength <= LIMITS.projectBytes, '工程不能超过 48 MB。');
  return validateProject(JSON.parse(text));
}
export function passOf(project: ShaderProject, id: PassId): ShaderPass {
  const pass = project.passes.find(p => p.id === id); if (!pass) throw new Error('Pass 不存在。'); return pass;
}
/** Shadertoy order: preceding buffers expose this frame; self/forward references expose the previous frame. */
export function usesCurrentFrame(reader: PassId, source: BufferId): boolean { return PASS_IDS.indexOf(source) < PASS_IDS.indexOf(reader); }
