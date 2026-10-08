import { translateGlsl, type TranslationResult } from './glsl.js';
import { channelTypes, passOf, type CodeId, type ShaderProject, type ShaderDiagnostic } from './model.js';
import type { TranslationOptions } from './glslChannels.js';

export function projectTranslationOptions(project: ShaderProject, pass: CodeId): TranslationOptions {
  if (pass === 'common') return { entryPoint: 'common' };
  return { entryPoint: pass === 'sound' ? 'sound' : 'image',
    ...(project.commonGlsl !== undefined ? { common: project.commonGlsl } : {}),
    channelTypes: channelTypes(passOf(project, pass).channels) };
}
export function translationDiagnostics(result: TranslationResult, pass: CodeId): ShaderDiagnostic[] {
  return result.diagnostics.map(d => ({ pass: d.source === 'common' ? 'common' : pass, line: d.line, column: d.column,
    severity: 'error', message: 'GLSL: ' + d.message }));
}
/** Rebuild linked GLSL modules from saved originals, never from stale generated WGSL. */
export function refreshProjectGlsl(project: ShaderProject): ShaderDiagnostic[] {
  const diagnostics: ShaderDiagnostic[] = [];
  if (project.commonGlsl !== undefined) {
    const common = translateGlsl(project.commonGlsl, { entryPoint: 'common' });
    if (common.code === null) return translationDiagnostics(common, 'common');
    project.common = common.code;
  }
  for (const pass of [...project.passes, project.sound]) {
    if (pass.glsl === undefined) continue;
    const result = translateGlsl(pass.glsl, projectTranslationOptions(project, pass.id));
    if (result.code !== null) pass.code = result.code;
    else if (pass.enabled) diagnostics.push(...translationDiagnostics(result, pass.id));
  }
  return diagnostics;
}
