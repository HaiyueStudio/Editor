import { PASS_LABELS, type ShaderDiagnostic, type ShaderPass } from './model.js';
import type { ChannelDimension } from './glslChannels.js';

/** Code-owned ABI hints survive copy/paste, shader.code.set and project export.
 * Only standalone directives in the leading comment section are interpreted. */
export function channelRequirements(code: string) {
  const types: (ChannelDimension | null)[] = [null, null, null, null];
  const locations = [1, 1, 1, 1];
  const errors: { line: number; column: number; message: string }[] = [];
  let cursor = 0, line = 1, lineStart = 0;
  const advance = () => { if (code[cursor++] === '\n') { line++; lineStart = cursor; } };
  while (cursor < code.length) {
    if (/\s/.test(code[cursor]!)) { advance(); continue; }
    if (code.startsWith('/*', cursor)) {
      cursor += 2; let depth = 1;
      while (cursor < code.length && depth) {
        if (code.startsWith('/*', cursor)) { depth++; cursor += 2; }
        else if (code.startsWith('*/', cursor)) { depth--; cursor += 2; }
        else advance();
      }
      continue;
    }
    if (!code.startsWith('//', cursor)) break;
    const end = code.indexOf('\n', cursor), text = code.slice(cursor, end < 0 ? code.length : end);
    if (/^\/\/\s*@haiyue-channel\b/.test(text)) {
      const match = /^\/\/\s*@haiyue-channel\s+iChannel([0-3])\s+(2d|cube)\s*$/.exec(text);
      if (!match) errors.push({ line, column: cursor - lineStart + 1, message: '通道类型标记格式应为 // @haiyue-channel iChannel0 cube（或 2d）。' });
      else {
        const index = Number(match[1]), type = match[2] as ChannelDimension;
        if (types[index] && types[index] !== type) errors.push({ line, column: cursor - lineStart + 1, message: `iChannel${index} 的通道类型标记冲突。` });
        else { types[index] = type; locations[index] = line; }
      }
    }
    cursor = end < 0 ? code.length : end;
  }
  return { types, locations, errors };
}
export function cubemapRequirements(types: readonly ChannelDimension[]) {
  return types.flatMap((type, index) => type === 'cube' ? [`// @haiyue-channel iChannel${index} cube\n`] : []).join('');
}
export function resolveChannelBindings(pass: ShaderPass, common = '') {
  const local = channelRequirements(pass.code), shared = channelRequirements(common);
  const required = { types: local.types.map((type, i) => type ?? shared.types[i]), locations: local.locations.map((line, i) => local.types[i] ? line : shared.locations[i]!), errors: local.errors };
  const owner = (i: number) => local.types[i] ? pass.id : 'common' as const;
  const dimensions: ChannelDimension[] = pass.channels.map(c => c.kind === 'cubemap' ? 'cube' : '2d');
  const diagnostics: ShaderDiagnostic[] = required.errors.map(error => ({ ...error, pass: pass.id, severity: 'error' }));
  diagnostics.push(...shared.errors.map(error => ({ ...error, pass: 'common' as const, severity: 'error' as const })));
  required.types.forEach((type, index) => {
    if (local.types[index] && shared.types[index] && local.types[index] !== shared.types[index]) {
      diagnostics.push({ pass: pass.id, severity: 'error', line: local.locations[index]!, column: 1, message: `${PASS_LABELS[pass.id]} 的 iChannel${index} 类型与 Common 中声明的类型冲突。` });
      return;
    }
    if (!type) return;
    const channel = pass.channels[index]!;
    if (channel.kind !== 'none' && dimensions[index] !== type) {
      diagnostics.push({ pass: owner(index), severity: 'error', line: required.locations[index]!, column: 1,
        message: `${PASS_LABELS[pass.id]} 的 iChannel${index} 需要${type === 'cube' ? '立方体贴图（Cubemap）' : '二维纹理'}，当前绑定的是${channel.kind === 'buffer' ? PASS_LABELS[channel.pass] + '（二维 Buffer）' : channel.kind === 'cubemap' ? '立方体贴图' : channel.kind === 'keyboard' ? '键盘纹理' : channel.kind === 'video' ? '视频纹理' : '普通二维图片'}。${type === 'cube' ? '请在该通道选择或上传六面立方体贴图。' : '请选择普通图片或 Buffer。'}` });
    } else {
      dimensions[index] = type;
      if (channel.kind === 'none' && type === 'cube') diagnostics.push({ pass: owner(index), severity: 'warning', line: required.locations[index]!, column: 1,
        message: `${PASS_LABELS[pass.id]} 的 iChannel${index} 尚未绑定立方体贴图（Cubemap），暂用黑色占位。请在该通道选择或上传六面图片后查看环境反射效果。` });
    }
  });
  return { dimensions, diagnostics };
}
/** Old generated WGSL has no ABI hints. Keep its source location but explain
 * the binding problem rather than asking users to truncate reflection vectors. */
export function channelDiagnostic(message: string, pass: ShaderPass) {
  const match = /call to 'channel([0-3])', expected 'vec2<f32>', got 'vec3<f32>'/.exec(message);
  if (!match) return message;
  const index = Number(match[1]), channel = pass.channels[index]!;
  const source = channel.kind === 'none' ? '无纹理' : channel.kind === 'buffer' ? PASS_LABELS[channel.pass] : channel.kind === 'cubemap' ? 'Cubemap' : channel.kind === 'keyboard' ? '键盘纹理' : channel.kind === 'video' ? '视频纹理' : '普通二维图片';
  return `${PASS_LABELS[pass.id]} 的 iChannel${index} 使用 vec3 方向采样，需要立方体贴图（Cubemap），当前来源为“${source}”。请绑定六面立方体贴图，或重新翻译并应用 GLSL 以保留通道类型；不要将反射方向改成 vec2。`;
}
