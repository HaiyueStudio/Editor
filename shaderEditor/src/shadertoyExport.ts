import { translateWgsl, type WgslTranslationResult } from './wgsl.js';
import { translateGlsl } from './glsl.js';
import { projectTranslationOptions } from './glslProject.js';
import { languageOf, sourceOf } from './sourceLanguage.js';
import { builtinTexture } from './builtinTextures.js';
import { passOf, PASS_LABELS, type Channel, type RenderPassId, type ShaderProject } from './model.js';

export interface ShadertoyPassExport extends WgslTranslationResult {
  pass: RenderPassId;
  label: string;
  channels: { index: number; kind: Channel['kind']; source: string }[];
}
/** Resolve the active Common draft for both the UI and API. Never export stale
 * generated Common after its GLSL original has been edited. */
export async function translateProjectWgsl(project: Readonly<ShaderProject>, code: string, id: RenderPassId = 'image'): Promise<WgslTranslationResult> {
  let common = project.common;
  if (languageOf(project, 'common') === 'glsl') {
    const result = translateGlsl(sourceOf(project, 'common'), { entryPoint: 'common' });
    if (result.code === null) return { ...result, diagnostics: result.diagnostics.map(d => ({ ...d, source: 'common' })) };
    common = result.code;
  }
  return translateWgsl(code, { entryPoint: id === 'sound' ? 'sound' : 'image', common, channels: passOf(project as ShaderProject, id).channels });
}
export async function exportShadertoyPass(project: Readonly<ShaderProject>, id: RenderPassId): Promise<ShadertoyPassExport> {
  const pass = passOf(project as ShaderProject, id);
  const channels = pass.channels.map((channel, index) => ({ index, kind: channel.kind, source:
    channel.kind === 'none' ? '无纹理' : channel.kind === 'buffer' ? PASS_LABELS[channel.pass] : channel.kind === 'keyboard' ? 'Keyboard · 256 × 3' : channel.kind === 'builtin' ? builtinTexture(channel.texture).name : project.assets.find(a => a.id === channel.assetId)?.name ?? channel.assetId,
  }));
  const meta = { pass: id, label: PASS_LABELS[id], channels };
  const commonGlsl = languageOf(project, 'common') === 'glsl';
  if (languageOf(project, id) === 'glsl' && (commonGlsl || !project.common.trim())) {
    // The authored Shadertoy source is the most faithful export: keep macros,
    // comments and original names instead of compiling it through two languages.
    return { ...meta, code: (commonGlsl ? sourceOf(project, 'common') + '\n' : '') + sourceOf(project, id), diagnostics: [], warnings: ['导出当前 GLSL 原始源码；Common 已合并，请保持 Shadertoy Common 页为空。', '按下方清单配置相同通道、过滤与寻址方式。'] };
  }
  let code = pass.code;
  if (languageOf(project, id) === 'glsl') {
    const result = translateGlsl(sourceOf(project, id), projectTranslationOptions(project as ShaderProject, id));
    if (result.code === null) return { ...meta, ...result };
    code = result.code;
  }
  return { ...meta, ...await translateProjectWgsl(project, code, id) };
}
export async function exportShadertoy(project: Readonly<ShaderProject>) {
  // Snapshot before awaiting the lazy compiler, so edits cannot mix revisions.
  const snapshot = structuredClone(project);
  const passes: ShadertoyPassExport[] = [];
  for (const pass of [...snapshot.passes, snapshot.sound].filter(p => p.enabled)) passes.push(await exportShadertoyPass(snapshot, pass.id));
  return { format: 'haiyue-shadertoy-export', version: 1, name: snapshot.name, common: '', passes,
    instructions: '将每段 code 粘贴到对应 Shadertoy 页签，Common 保持为空。手动配置 channels；自定义图片、视频与 Cubemap 素材需另行提供。' };
}
