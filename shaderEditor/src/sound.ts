import { wrapShader } from './shaders.js';
import { resolveChannelBindings } from './channelBindings.js';
import type { ShaderProject, ShaderDiagnostic } from './model.js';

export const SOUND_RATE = 44100;
export const SOUND_BLOCK = 1024 * 64;
export interface SoundRenderer {
  diagnostics: ShaderDiagnostic[];
  render(start: number, count: number, current?: () => boolean, progress?: (fraction: number) => void): Promise<StereoSound>;
  dispose(): void;
}
export interface StereoSound { left: Float32Array; right: Float32Array; sampleRate: number }
export interface SoundTexture { view: GPUTextureView; width: number; height: number }
export class SoundCompileError extends Error {
  constructor(readonly diagnostics: ShaderDiagnostic[]) { super('Sound 编译失败。'); }
}
export function cleanSample(value: number) { return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0; }

/** Render bounded chunks on the engine's GPU device; each fragment is one stereo sample. */
export async function createSoundRenderer(device: GPUDevice, project: ShaderProject, inputs: SoundTexture[], sampler: GPUSampler): Promise<SoundRenderer> {
  const pass = project.sound, binding = resolveChannelBindings(pass, project.common);
  if (binding.diagnostics.some(d => d.severity === 'error')) throw new SoundCompileError(binding.diagnostics);
  const wrapped = wrapShader(pass, project.common);
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ label: 'ShaderEditor.Sound', code: wrapped.code });
  const scope = device.popErrorScope();
  const info = await module.getCompilationInfo(), validation = await scope;
  const diagnostics: ShaderDiagnostic[] = [...binding.diagnostics, ...info.messages.map(m => ({
    ...wrapped.sourceLocation(m.lineNum), severity: m.type, message: m.message, column: m.linePos || 1,
  }))];
  if (validation && !info.messages.some(m => m.type === 'error')) diagnostics.push({ pass: 'sound', severity: 'error', line: 1, column: 1, message: validation.message });
  if (diagnostics.some(d => d.severity === 'error')) throw new SoundCompileError(diagnostics);
  const frameLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 144 } }] });
  const emptyLayout = device.createBindGroupLayout({ entries: [] });
  const channels = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ...binding.dimensions.map((viewDimension, i) => ({ binding: i + 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' as const, viewDimension } })),
  ] });
  let pipeline: GPURenderPipeline;
  try {
    pipeline = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, emptyLayout, channels] }),
      vertex: { module, entryPoint: 'hy_vertex' }, fragment: { module, entryPoint: 'hy_fragment', targets: [{ format: 'rgba32float' }] }, primitive: { topology: 'triangle-list' } });
  } catch (error) { throw new SoundCompileError([{ pass: 'sound', severity: 'error', line: 1, column: 1, message: String(error) }]); }
  let disposed = false;
  return { diagnostics, dispose() { disposed = true; }, async render(start, count, current = () => true, progress) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1 || count > SOUND_RATE * 120) throw new Error('无效的音频采样范围。');
  const valid = () => !disposed && current();
  if (!valid()) throw new Error('Sound 合成已取消。');
  const width = 1024, height = 64, block = SOUND_BLOCK, bytes = block * 16;
  const uniform = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const frame = device.createBindGroup({ layout: frameLayout, entries: [{ binding: 0, resource: { buffer: uniform } }] });
    const empty = device.createBindGroup({ layout: emptyLayout, entries: [] });
    const group = device.createBindGroup({ layout: channels, entries: [{ binding: 0, resource: sampler }, ...inputs.map((t, i) => ({ binding: i + 1, resource: t.view }))] });
    const left = new Float32Array(count), right = new Float32Array(count);
    const data = new Float32Array(36); data[7] = SOUND_RATE;
    inputs.forEach((t, i) => { if (pass.channels[i]!.kind !== 'none') data.set([t.width, t.height, 1, 0], 16 + i * 4); });
    for (let offset = 0; offset < count; offset += block) {
      if (!valid()) throw new Error('Sound 合成已取消。');
      // Carry sample bits as u32, avoiding f32 integer rounding after 380 s.
      new Uint32Array(data.buffer)[4] = (start + offset) >>> 0;
      data[5] = Math.floor((start + offset) / 4294967296) * (4294967296 / SOUND_RATE); device.queue.writeBuffer(uniform, 0, data);
      const encoder = device.createCommandEncoder({ label: 'ShaderEditor.Sound.chunk' });
      const render = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      render.setPipeline(pipeline); render.setBindGroup(0, frame); render.setBindGroup(1, empty); render.setBindGroup(2, group); render.draw(3); render.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: width * 16 }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(readback.getMappedRange());
      for (let i = 0, n = Math.min(block, count - offset); i < n; i++) { left[offset + i] = cleanSample(values[i * 4]!); right[offset + i] = cleanSample(values[i * 4 + 1]!); }
      readback.unmap(); progress?.(Math.min(1, (offset + block) / count));
    }
    if (!valid()) throw new Error('Sound 合成已取消。');
    return { left, right, sampleRate: SOUND_RATE };
  } finally { readback.destroy(); target.destroy(); uniform.destroy(); }
  } };
}
export function encodeWave(audio: StereoSound): Uint8Array<ArrayBuffer> {
  const count = audio.left.length;
  if (audio.right.length !== count) throw new Error('左右声道长度不一致。');
  const bytes = new Uint8Array(44 + count * 4), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 4, true);
  for (let i = 0; i < count; i++) for (let ch = 0; ch < 2; ch++) {
    const sample = cleanSample((ch ? audio.right : audio.left)[i]!);
    view.setInt16(44 + i * 4 + ch * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
