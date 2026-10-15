import { codeOf, passOf, type CodeId, type ShaderProject, type ShaderLanguage } from './model.js';

/** Ignore comments and require unambiguous language-specific syntax. */
export function detectShaderLanguage(source: string): ShaderLanguage | null {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const wgsl = /\bfn\s+\w+\s*\(|\b(?:var|let|const)(?:\s*<[^>]+>\s*|\s+)\w+\s*:|\b(?:var|let)\s+\w+\s*=|@(?:fragment|vertex|group|binding)\b|\bvec[234][fiu]\s*\(|\b(?:vec[234]|mat[234]x[234]|array|ptr|atomic)\s*<|\balias\s+\w+\s*=|\bstruct\s+\w+\s*\{\s*(?:@\w+\s*(?:\([^)]*\))?\s*)*\w+\s*:/.test(text);
  const glsl = /^\s*#\s*(?:define|version|if|ifdef|ifndef)\b/m.test(text) || /\b(?:void|float|int|uint|bool|[biu]?vec[234]|mat[234](?:x[234])?|sampler2D|samplerCube)\s+\w+\s*(?:\(|=|;|\[|,)|\bprecision\s+(?:highp|mediump|lowp)\b/.test(text);
  return wgsl === glsl ? null : wgsl ? 'wgsl' : 'glsl';
}
export function languageOf(project: Readonly<ShaderProject>, pass: CodeId): ShaderLanguage {
  return project.editorLanguages?.[pass] ?? ((pass === 'common' ? project.commonGlsl : passOf(project as ShaderProject, pass).glsl) !== undefined ? 'glsl' : 'wgsl');
}
export function sourceOf(project: Readonly<ShaderProject>, pass: CodeId): string {
  return languageOf(project, pass) === 'wgsl' ? codeOf(project, pass) : (pass === 'common' ? project.commonGlsl : passOf(project as ShaderProject, pass).glsl) ?? '';
}
export function defaultGlsl(pass: CodeId) {
  if (pass === 'common') return '';
  if (pass === 'sound') return 'vec2 mainSound(int sampleIndex, float time) {\n  return vec2(0.2 * sin(6.2831853 * 440.0 * time));\n}\n';
  return 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n  vec3 color = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0.0, 2.0, 4.0));\n  fragColor = vec4(color, 1.0);\n}\n';
}
