import { TranslationError, type Token } from './glslPreprocessor.js';
import type { Expression as Expr } from './glslUpdates.js';
import { builtinChannel, type ChannelDimension } from './glslChannels.js';

export const SAMPLER_2D = 'sampler2D';
export const SAMPLER_CUBE = 'samplerCube';
export const isSampler = (type: string) => type === SAMPLER_2D || type === SAMPLER_CUBE;
export const wgslType = (type: string) => type === SAMPLER_2D ? 'texture_2d<f32>' : type === SAMPLER_CUBE ? 'texture_cube<f32>' : type;
export const TEXTURE_FUNCTIONS = new Set(['texture', 'texture2D', 'textureCube', 'textureLod', 'textureSize', 'texelFetch']);

/** Combined GLSL samplers share the runtime's iSampler. Cubemap coordinates are
 * directions, so only 2D sampling applies the Shadertoy bottom-left UV flip. */
export class Textures {
  usesBias = false;
  constructor(private readonly helpers: Map<string, string>,
    private readonly requireChannel: (token: Token, texture: Expr, dimension: ChannelDimension) => void) {}
  call(token: Token, args: Expr[]): Expr {
    const name = token.value, texture = args[0], uv = args[1], lod = args[2];
    const acceptsBias = ['texture', 'texture2D', 'textureCube'].includes(name);
    const bias = acceptsBias && args.length === 3;
    const arity = ['textureLod', 'texelFetch'].includes(name) ? 3 : 2;
    if (args.length !== arity && !bias) throw new TranslationError(token, `${name} 需要 ${acceptsBias ? '2 或 3' : arity} 个参数。`);
    if (!texture || !isSampler(texture.type)) throw new TranslationError(token, `${name} 的第一个参数必须是 sampler2D / samplerCube 或 iChannel0–3。`);
    if (name !== 'textureSize') {
      const dimension = name === 'textureCube' ? 'cube' : name === 'texture2D' || name === 'texelFetch' ? '2d' : uv?.type === 'vec3f' ? 'cube' : uv?.type === 'vec2f' ? '2d' : null;
      if (dimension) this.requireChannel(token, texture, dimension);
    }
    const cube = texture.type === SAMPLER_CUBE;
    if ((name === 'texture2D' || name === 'texelFetch') && cube) throw new TranslationError(token, `${name} 不支持 samplerCube，请使用 texture 或 textureLod 按三维方向采样。`);
    if (name === 'textureCube' && !cube) throw new TranslationError(token, 'textureCube 需要 samplerCube。');
    if (name === 'textureSize') {
      if (!['i32', 'number'].includes(uv!.type)) throw new TranslationError(token, 'textureSize 的 mip 层级需要 int。');
      return { code: `vec2i(textureDimensions(${texture.code}, ${uv!.code}))`, type: 'vec2i' };
    }
    if (name === 'texelFetch') {
      if (uv?.type !== 'vec2i' || !['i32', 'number'].includes(lod!.type)) throw new TranslationError(token, 'texelFetch 需要 ivec2 像素坐标和 int mip 层级。');
      const helper = 'hy_texel_fetch_2d';
      this.helpers.set(helper, `fn ${helper}(tex: texture_2d<f32>, coord: vec2i, lod: i32) -> vec4f {\n  let size = textureDimensions(tex, lod);\n  return textureLoad(tex, vec2i(coord.x, i32(size.y) - 1 - coord.y), lod);\n}`);
      return { code: `${helper}(${texture.code}, ${uv.code}, ${lod!.code})`, type: 'vec4f' };
    }
    if (uv?.type !== (cube ? 'vec3f' : 'vec2f')) throw new TranslationError(token, `${name} 的${cube ? '采样方向需要 vec3' : '纹理坐标需要 vec2'}。`);
    if (name === 'textureLod' && !['f32', 'number'].includes(lod!.type)) throw new TranslationError(token, 'textureLod 的 mip 层级需要 float。');
    if (bias) {
      if (!['f32', 'number'].includes(lod!.type)) throw new TranslationError(token, `${name} 的第三个参数 bias 需要 float 标量。`);
      this.usesBias = true;
      const helper = `hy_texture_bias_${cube ? 'cube' : '2d'}`;
      // ShaderEditor resources have exactly one mip level. Bias cannot change
      // the sampled level, but must still evaluate once (including side effects).
      // Explicit level zero also works in nonuniform branches and Sound shaders.
      this.helpers.set(helper, `// ShaderEditor currently binds single-mip textures; bias is evaluated, level remains zero.
fn ${helper}(tex: ${wgslType(texture.type)}, uv: ${cube ? 'vec3f' : 'vec2f'}, bias: f32) -> vec4f {
  _ = bias;
  return textureSampleLevel(tex, iSampler, ${cube ? 'uv' : 'vec2f(uv.x, 1.0 - uv.y)'}, 0.0);
}`);
      return { code: `${helper}(${texture.code}, ${uv.code}, ${lod!.code})`, type: 'vec4f' };
    }
    const channel = builtinChannel(texture);
    if (channel !== undefined && name !== 'textureLod') return { code: `channel${channel}(${uv.code})`, type: 'vec4f' };
    const helper = channel !== undefined ? `hy_texture_lod_${channel}` : `hy_texture${name === 'textureLod' ? '_lod' : ''}_${cube ? 'cube' : '2d'}`;
    const params = `${channel === undefined ? 'tex: ' + wgslType(texture.type) + ', ' : ''}uv: ${cube ? 'vec3f' : 'vec2f'}${name === 'textureLod' ? ', lod: f32' : ''}`;
    this.helpers.set(helper, `fn ${helper}(${params}) -> vec4f {\n  return textureSampleLevel(${channel === undefined ? 'tex' : 'iChannel' + channel}, iSampler, ${cube ? 'uv' : 'vec2f(uv.x, 1.0 - uv.y)'}, ${name === 'textureLod' ? 'lod' : '0.0'});\n}`);
    return { code: `${helper}(${[...(channel === undefined ? [texture.code] : []), uv.code, ...(lod ? [lod.code] : [])].join(', ')})`, type: 'vec4f' };
  }
}
