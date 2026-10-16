import type { Module, ModuleInfo } from 'naga-wasm';
import { HEADER } from './shaders.js';
import { passCommon, resolveChannelBindings } from './channelBindings.js';
import { LIMITS, emptyChannels, type Channel, type RenderPass } from './model.js';

export interface WgslTranslationOptions {
  entryPoint?: 'image' | 'sound';
  common?: string;
  channels?: Channel[];
}
export interface WgslTranslationResult {
  code: string | null;
  diagnostics: { line: number; column: number; message: string; source?: 'common' | 'pass' }[];
  warnings: string[];
}
let compiler: Promise<typeof import('naga-wasm')> | undefined;
async function loadCompiler() {
  compiler ??= (async () => {
    const naga = await import('naga-wasm');
    if (typeof window !== 'undefined') {
      const { default: url } = await import('naga-wasm/naga_bg.wasm');
      await naga.init({ module_or_path: url });
    }
    return naga;
  })().catch(error => { compiler = undefined; throw error; });
  return compiler;
}

/** Only identifiers outside WGSL comments are rewritten. Naga handles all syntax
 * and type lowering; these names bridge the product ABI to Shadertoy uniforms. */
function rename(source: string, names: Readonly<Record<string, string>>, maskComments = false) {
  let out = '', at = 0, depth = 0;
  while (at < source.length) {
    if (source.startsWith('//', at) && !depth) {
      const end = source.indexOf('\n', at), next = end < 0 ? source.length : end;
      out += maskComments ? ' '.repeat(next - at) : source.slice(at, next); at = next; continue;
    }
    if (source.startsWith('/*', at)) { depth++; out += maskComments ? '  ' : '/*'; at += 2; continue; }
    if (depth && source.startsWith('*/', at)) { depth--; out += maskComments ? '  ' : '*/'; at += 2; continue; }
    if (depth && maskComments) { out += source[at] === '\n' ? '\n' : ' '; at++; continue; }
    const word = !depth && /^[A-Za-z_]\w*/.exec(source.slice(at));
    if (word) { out += names[word[0]] ?? word[0]; at += word[0].length; }
    else out += source[at++];
  }
  return out;
}
const builtins = ['iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iFrameRate', 'iMouse', 'iDate', 'iSampleRate', 'iChannelResolution', 'iChannelTime'];
const failure = (message: string): WgslTranslationResult => ({ code: null, diagnostics: [{ line: 1, column: 1, message }], warnings: [] });

/** Export authoring WGSL, not arbitrary WebGPU pipelines, as a self-contained
 * Shadertoy pass. Common is linked just as in the renderer. */
export async function translateWgsl(source: string, options: WgslTranslationOptions = {}): Promise<WgslTranslationResult> {
  if (source.length > LIMITS.code || (options.common?.length ?? 0) > LIMITS.code) return failure('代码超过转换长度上限。');
  const sound = options.entryPoint === 'sound';
  const pass: RenderPass = { id: sound ? 'sound' : 'image', code: source, channels: options.channels ?? emptyChannels(), enabled: true, duration: 60, volume: 1 };
  const common = passCommon(pass, options.common ?? '');
  const binding = resolveChannelBindings(pass, common);
  if (binding.diagnostics.some(d => d.severity === 'error')) return { code: null, diagnostics: binding.diagnostics.filter(d => d.severity === 'error').map(d => ({ ...d, source: d.pass === 'common' ? 'common' : 'pass' })), warnings: [] };
  const authored = common + '\n' + source;
  // Host resources and stage entry points have no equivalent in a Shadertoy tab.
  const unsupported = /@\s*(?:group|binding|vertex|fragment|compute|workgroup_size)\b|\bvar\s*<\s*(?:storage|uniform|workgroup)\b/.exec(rename(authored, {}, true));
  if (unsupported) return failure('请转换 Shader Lab 的 mainImage / mainSound 源码。自定义绑定、存储缓冲区及独立 GPU 阶段不能导出到 Shadertoy。');
  let prefix = 'stExport';
  while (authored.includes(prefix)) prefix += 'X';
  const names = Object.fromEntries(builtins.map(name => [name, prefix + name]));
  names.mainImage = prefix + 'Image'; names.mainSound = prefix + 'Sound';
  let header = HEADER.slice(HEADER.indexOf('@group(2)'));
  binding.dimensions.forEach((kind, index) => {
    if (kind !== 'cube') return;
    header = header.replace(`var iChannel${index}: texture_2d<f32>`, `var iChannel${index}: texture_cube<f32>`).replace(
      `fn channel${index}(uv: vec2f) -> vec4f { return textureSampleLevel(iChannel${index}, iSampler, vec2f(uv.x, 1.0 - uv.y), 0.0); }`,
      `fn channel${index}(direction: vec3f) -> vec4f { return textureSampleLevel(iChannel${index}, iSampler, direction, 0.0); }`);
  });
  if (sound) header += `\nvar<private> ${prefix}Sample: i32;\nvar<private> ${prefix}Time: f32;\n`;
  header = rename(header, names);
  const commonPrefix = common ? rename(common, names) + '\n' : '';
  const init = /^\s*(?:\/\/[^\n]*\n)*\/\/ @haiyue-common-library(?:\n|$)/.test(common) ? `hy_common_library_init(${sound ? 'vec2f(0.0)' : 'position.xy'});` : '';
  const entry = `\n@fragment fn ${prefix}Entry(${sound ? '' : '@builtin(position) position: vec4f'}) -> @location(0) ${sound ? 'vec2f' : 'vec4f'} {\n${init}\nreturn ${prefix + (sound ? 'Sound' : 'Image')}(${sound ? prefix + 'Sample, ' + prefix + 'Time' : 'position.xy'});\n}`;
  const wrapped = header + commonPrefix + rename(source, names) + entry;
  let module: Module | undefined, info: ModuleInfo | undefined;
  try {
    const naga = await loadCompiler();
    module = naga.parseWgsl(wrapped); info = naga.validate(module);
    const generated = naga.writeGlsl(module, info, { version: '300 es', stage: 'fragment', entryPoint: prefix + 'Entry', reflect: true, flags: { adjustCoordinateSpace: false } });
    if (/^#extension\b/m.test(generated.code)) throw new Error('此 WGSL 需要 WebGL2 / Shadertoy 不提供的 GLSL 扩展，无法导出。');
    let code = generated.code.replace(/^#version[^\n]*\n|^precision[^\n]*\n/gm, '');
    const output = /layout\(location = 0\) out vec[24] (\w+);/.exec(code);
    if (!output) throw new Error('编译器未生成可识别的颜色输出。');
    code = code.replace(output[0], '');
    const map: Record<string, string> = { [output[1]!]: prefix + 'Color', gl_FragCoord: `vec4(${prefix}Coord, 0.0, 1.0)` };
    for (const [name, item] of Object.entries(generated.reflection.textures)) {
      const index = (item.texture?.binding ?? 0) - 1;
      if (item.texture?.group !== 2 || index < 0 || index > 3) throw new Error('只能导出 iChannel0–3 纹理绑定。');
      code = code.replace(new RegExp(`^uniform\\s+(?:highp\\s+)?\\w+\\s+${name};\\n`, 'm'), '');
      map[name] = 'iChannel' + index;
    }
    // Raw WebGPU samples use a top-left texture origin. Shadertoy textures use
    // bottom-left. Flip raw reads; channelN already flips once in its WGSL body.
    const helpers: string[] = [];
    if (/\btexture(?:Lod)?\s*\(/.test(code)) {
      map.textureLod = prefix + 'TextureLod'; map.texture = prefix + 'Texture';
      helpers.push(`vec4 ${prefix}TextureLod(sampler2D t, vec2 p, float l) { return textureLod(t, vec2(p.x, 1.0-p.y), l); }`,
        `vec4 ${prefix}TextureLod(samplerCube t, vec3 p, float l) { return textureLod(t, p, l); }`,
        `vec4 ${prefix}Texture(sampler2D t, vec2 p) { return texture(t, vec2(p.x, 1.0-p.y)); }`,
        `vec4 ${prefix}Texture(samplerCube t, vec3 p) { return texture(t, p); }`,
        `vec4 ${prefix}Texture(sampler2D t, vec2 p, float b) { return texture(t, vec2(p.x, 1.0-p.y), b); }`,
        `vec4 ${prefix}Texture(samplerCube t, vec3 p, float b) { return texture(t, p, b); }`);
    }
    if (/\btexelFetch\s*\(/.test(code)) {
      map.texelFetch = prefix + 'Texel';
      helpers.push(`vec4 ${prefix}Texel(sampler2D t, ivec2 p, int l) { return texelFetch(t, ivec2(p.x, textureSize(t,l).y-1-p.y), l); }`);
    }
    if (/\btextureGrad\s*\(/.test(code)) {
      map.textureGrad = prefix + 'TextureGrad';
      helpers.push(`vec4 ${prefix}TextureGrad(sampler2D t, vec2 p, vec2 x, vec2 y) { return textureGrad(t, vec2(p.x,1.0-p.y), x*vec2(1,-1), y*vec2(1,-1)); }`,
        `vec4 ${prefix}TextureGrad(samplerCube t, vec3 p, vec3 x, vec3 y) { return textureGrad(t,p,x,y); }`);
    }
    if (/\b(?:texture\w*Offset|textureGather\w*)\s*\(/.test(code)) throw new Error('带 offset 的纹理采样与 textureGather 暂不能导出到 Shadertoy。');
    // Screen-space y derivatives in WGSL point down, GL derivatives point up.
    if (/\bdFdy\s*\(/.test(code)) {
      map.dFdy = prefix + 'Dy';
      for (const type of ['float', 'vec2', 'vec3', 'vec4']) helpers.push(`${type} ${prefix}Dy(${type} p) { return -dFdy(p); }`);
    }
    const initializers = builtins.filter(name => new RegExp(`\\b${names[name]}\\b`).test(code)).map(name => {
      const dest = names[name];
      if (sound) {
        const values: Record<string, string> = { iResolution: 'vec3(1024.0,64.0,1.0)', iTime: prefix + 'TimeInput', iTimeDelta: '(1.0/iSampleRate)', iFrameRate: 'iSampleRate', iFrame: '0', iMouse: 'vec4(0.0)', iDate: 'vec4(0.0)' };
        if (values[name]) return `${dest} = ${values[name]};`;
      }
      if (name === 'iChannelResolution' || name === 'iChannelTime') return `for (int ${prefix}I=0; ${prefix}I<4; ${prefix}I++) { ${dest}[${prefix}I] = ${sound && name === 'iChannelTime' ? '0.0' : name + '[' + prefix + 'I]'}; }`;
      return `${dest} = ${name};`;
    });
    code = rename(code, map);
    const main = /void main\(\)\s*\{/.exec(code);
    if (!main) throw new Error('编译器未生成可识别的入口。');
    let body = code.slice(main.index + main[0].length).trim();
    if (!body.endsWith('}')) throw new Error('编译器入口结构不完整。');
    body = body.slice(0, -1);
    const signature = sound ? `vec2 mainSound(int ${prefix}SampleInput, float ${prefix}TimeInput)` : `void mainImage(out vec4 ${prefix}Color, in vec2 ${prefix}Coord)`;
    if (sound) {
      initializers.unshift(`${prefix}Sample = ${prefix}SampleInput;`, `${prefix}Time = ${prefix}TimeInput;`, `vec2 ${prefix}Color = vec2(0.0);`);
      // Unused sound inputs are removed by the compiler.
      for (const name of ['Sample', 'Time']) if (!new RegExp(`\\b${prefix}${name}\\s*[=;]`).test(code.slice(0, main.index))) initializers.splice(initializers.findIndex(s => s.startsWith(prefix + name + ' =')), 1);
      body = body.replace(/\breturn\s*;/g, `return ${prefix}Color;`);
    }
    code = code.slice(0, main.index) + `${signature} {\n    ${initializers.join('\n    ')}\n${body}\n}\n`;
    // The forward importer reserves hy_ for generated helpers. Make reverse
    // exports reusable there too, with a namespace absent from the original.
    const reserved = Object.fromEntries([...code.matchAll(/\bhy_\w+\b/g)].map(m => [m[0], prefix + m[0]]));
    code = rename(code, reserved);
    return { code: '// Shadertoy GLSL ES 3.00 · Common 已合并到此 Pass\n' + helpers.join('\n') + '\n' + code.trim() + '\n', diagnostics: [], warnings: [
      'Common 已合并到每个 Pass；在 Shadertoy 中请保持 Common 页为空，按对应页签粘贴代码。',
      '请按通道清单设置素材，使用 Linear 过滤、Repeat 寻址和基础 mip 层；Buffer 使用浮点格式。',
      ...binding.diagnostics.filter(d => d.severity === 'warning').map(d => d.message),
    ] };
  } catch (error) {
    const report = error && typeof error === 'object' && 'formatted' in error ? String(error.formatted) : error instanceof Error ? error.message : String(error);
    const location = /wgsl:(\d+):(\d+)/.exec(report);
    const row = Number(location?.[1] ?? 1), headerLines = header.split('\n').length - 1, commonLines = commonPrefix.split('\n').length - 1;
    const inCommon = row > headerLines && row <= headerLines + commonLines;
    return { code: null, diagnostics: [{ line: Math.max(1, row - headerLines - (inCommon ? 0 : commonLines)), column: Number(location?.[2] ?? 1), source: inCommon ? 'common' : 'pass', message: report }], warnings: [] };
  } finally { info?.free(); module?.free(); }
}
