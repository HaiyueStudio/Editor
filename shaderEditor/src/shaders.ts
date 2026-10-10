import type { RenderPass, CodeId } from './model.js';
import { resolveChannelBindings, passCommon } from './channelBindings.js';

// Product-owned runtime shader ABI. These are authoring wrappers, not generated Engine shaders.
export const VERTEX = `
@vertex fn hy_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}`;
export const HEADER = `
struct HyUniforms {
  resolutionTime: vec4f,
  timing: vec4f,
  mouse: vec4f,
  date: vec4f,
  channelResolution: array<vec4f, 4>,
  channelTime: vec4f,
};
@group(0) @binding(0) var<uniform> hy_uniforms: HyUniforms;
@group(2) @binding(0) var iSampler: sampler;
@group(2) @binding(1) var iChannel0: texture_2d<f32>;
@group(2) @binding(2) var iChannel1: texture_2d<f32>;
@group(2) @binding(3) var iChannel2: texture_2d<f32>;
@group(2) @binding(4) var iChannel3: texture_2d<f32>;
var<private> iResolution: vec3f;
var<private> iTime: f32;
var<private> iTimeDelta: f32;
var<private> iFrame: i32;
var<private> iFrameRate: f32;
var<private> iMouse: vec4f;
var<private> iDate: vec4f;
var<private> iSampleRate: f32;
var<private> iChannelResolution: array<vec3f, 4>;
var<private> iChannelTime: array<f32, 4>;
// Shadertoy UVs: bottom-left origin. Explicit LOD also permits nonuniform flow.
fn channel0(uv: vec2f) -> vec4f { return textureSampleLevel(iChannel0, iSampler, vec2f(uv.x, 1.0 - uv.y), 0.0); }
fn channel1(uv: vec2f) -> vec4f { return textureSampleLevel(iChannel1, iSampler, vec2f(uv.x, 1.0 - uv.y), 0.0); }
fn channel2(uv: vec2f) -> vec4f { return textureSampleLevel(iChannel2, iSampler, vec2f(uv.x, 1.0 - uv.y), 0.0); }
fn channel3(uv: vec2f) -> vec4f { return textureSampleLevel(iChannel3, iSampler, vec2f(uv.x, 1.0 - uv.y), 0.0); }
`;
export function wrapShader(pass: RenderPass, common = '') {
  common = passCommon(pass, common);
  const commonInit = /^\s*(?:\/\/[^\n]*\n)*\/\/ @haiyue-common-library(?:\n|$)/.test(common) ? 'hy_common_library_init' : '';
  let header = HEADER;
  resolveChannelBindings(pass, common).dimensions.forEach((dimension, index) => {
    if (dimension !== 'cube') return;
    header = header.replace(`var iChannel${index}: texture_2d<f32>`, `var iChannel${index}: texture_cube<f32>`);
    header = header.replace(
      `fn channel${index}(uv: vec2f) -> vec4f { return textureSampleLevel(iChannel${index}, iSampler, vec2f(uv.x, 1.0 - uv.y), 0.0); }`,
      `fn channel${index}(direction: vec3f) -> vec4f { return textureSampleLevel(iChannel${index}, iSampler, direction, 0.0); }`);
  });
  const prefix = header + VERTEX + '\n';
  const suffix = pass.id === 'sound' ? `
@fragment fn hy_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let base = bitcast<u32>(hy_uniforms.timing.x);
  let index = base + u32(position.y) * 1024u + u32(position.x);
  iSampleRate = 44100.0;
  iTime = hy_uniforms.timing.y + select(0.0, 4294967296.0 / iSampleRate, index < base) + f32(index) / iSampleRate;
  iTimeDelta = 1.0 / iSampleRate;
  iResolution = vec3f(1024.0, 64.0, 1.0);
  iFrameRate = iSampleRate;
  for (var i = 0u; i < 4u; i++) { iChannelResolution[i] = hy_uniforms.channelResolution[i].xyz; }
  ${commonInit ? commonInit + '(vec2f(0.0));' : ''}
  return vec4f(mainSound(i32(index), iTime), 0.0, 1.0);
}` : `
@fragment fn hy_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  iResolution = hy_uniforms.resolutionTime.xyz;
  iTime = hy_uniforms.resolutionTime.w;
  iTimeDelta = hy_uniforms.timing.x;
  iFrame = i32(hy_uniforms.timing.y);
  iFrameRate = hy_uniforms.timing.z;
  iSampleRate = hy_uniforms.timing.w;
  iMouse = hy_uniforms.mouse;
  iDate = hy_uniforms.date;
  for (var i = 0u; i < 4u; i++) {
    iChannelResolution[i] = hy_uniforms.channelResolution[i].xyz;
    iChannelTime[i] = hy_uniforms.channelTime[i];
  }
  ${commonInit ? commonInit + '(vec2f(position.x, iResolution.y - position.y));' : ''}
  return mainImage(vec2f(position.x, iResolution.y - position.y));
}`;
  const commonPrefix = common ? common + '\n' : '';
  const commonOffset = prefix.split('\n').length - 1;
  const commonLines = common ? common.split('\n').length : 0;
  const lineOffset = commonOffset + commonLines, lines = pass.code.split('\n').length;
  return { code: prefix + commonPrefix + pass.code + '\n' + suffix, lineOffset, lines,
    sourceLocation(line: number): { pass: CodeId; line: number } {
      if (common && line > commonOffset && line <= lineOffset) return { pass: 'common', line: line - commonOffset };
      return { pass: pass.id, line: Math.max(1, Math.min(lines, line - lineOffset)) };
    } };

}
export const PRESENT = VERTEX + `
@group(0) @binding(0) var hy_image: texture_2d<f32>;
@group(0) @binding(1) var hy_sampler: sampler;
struct HySize { value: vec4f };
@group(0) @binding(2) var<uniform> hy_size: HySize;
@fragment fn hy_present(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return textureSampleLevel(hy_image, hy_sampler, position.xy / hy_size.value.xy, 0.0);
}`;
