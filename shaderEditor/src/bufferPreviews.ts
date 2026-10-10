import type { PassId } from './model.js';

export type BufferPreview = { pass: Exclude<PassId, 'image'>; canvas: HTMLCanvasElement };
type Source = { view: GPUTextureView; width: number; height: number };
type Surface = BufferPreview & { context: GPUCanvasContext; size: GPUBuffer; source?: GPUTextureView; group?: GPUBindGroup; frame: number };

/** Present existing Buffer outputs on small canvases using Haiyue's device.
 * No readback, additional shader execution, or changes to feedback textures.
 */
export class BufferPreviews {
  private surfaces: Surface[] = [];
  private updatedAt = -Infinity;
  constructor(private readonly device: GPUDevice, private readonly format: GPUTextureFormat,
    private readonly pipeline: GPURenderPipeline, private readonly sampler: GPUSampler) {}

  set(previews: readonly BufferPreview[]) {
    this.dispose();
    for (const preview of previews) {
      const context = preview.canvas.getContext('webgpu');
      if (!context) { preview.canvas.dataset.previewState = 'unavailable'; continue; }
      try {
        // Buffer alpha often stores data; show RGB even when alpha is zero.
        context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
        const size = this.device.createBuffer({ label: 'ShaderEditor.bufferPreview.size', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.surfaces.push({ ...preview, context, size, frame: -1 });
      } catch { context.unconfigure(); preview.canvas.dataset.previewState = 'unavailable'; }
    }
  }
  invalidate() { this.updatedAt = -Infinity; for (const surface of this.surfaces) surface.frame = -1; }
  render(sourceFor: (pass: BufferPreview['pass']) => Source | undefined, frame: number, force = false) {
    const now = performance.now();
    if (!this.surfaces.length || !force && now - this.updatedAt < 125) return;
    this.updatedAt = now;
    let encoder: GPUCommandEncoder | undefined;
    for (const surface of this.surfaces) {
      const { canvas, context } = surface, source = sourceFor(surface.pass);
      if (!source) { canvas.dataset.previewState = 'waiting'; surface.frame = -1; continue; }
      const box = canvas.parentElement;
      if (!canvas.isConnected || !box || box.clientWidth <= 8 || box.clientHeight <= 8) continue;
      const fit = Math.min((box.clientWidth - 8) / source.width, (box.clientHeight - 8) / source.height);
      const displayWidth = source.width * fit, displayHeight = source.height * fit;
      const density = Math.min(window.devicePixelRatio || 1, 2, 256 / Math.max(displayWidth, displayHeight));
      const width = Math.max(1, Math.round(displayWidth * density)), height = Math.max(1, Math.round(displayHeight * density));
      const resized = canvas.width !== width || canvas.height !== height;
      canvas.style.width = `${displayWidth}px`; canvas.style.height = `${displayHeight}px`;
      if (resized) { canvas.width = width; canvas.height = height; }
      if (!resized && surface.frame === frame && surface.source === source.view) continue;
      this.device.queue.writeBuffer(surface.size, 0, new Float32Array([width, height, 0, 0]));
      if (!surface.group || surface.source !== source.view) {
        surface.source = source.view;
        surface.group = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: source.view }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: surface.size } },
        ] });
      }
      encoder ??= this.device.createCommandEncoder({ label: 'ShaderEditor.bufferPreviews' });
      const pass = encoder.beginRenderPass({ label: `ShaderEditor.preview.${surface.pass}`, colorAttachments: [{
        view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1],
      }] });
      pass.setPipeline(this.pipeline); pass.setBindGroup(0, surface.group); pass.draw(3); pass.end();
      surface.frame = frame;
      canvas.dataset.previewState = 'ready'; canvas.dataset.previewFrame = String(frame);
    }
    if (encoder) this.device.queue.submit([encoder.finish()]);
  }
  dispose() {
    const previous = this.surfaces; this.surfaces = []; this.updatedAt = -Infinity;
    for (const surface of previous) surface.context.unconfigure();
    if (previous.length) void this.device.queue.onSubmittedWorkDone().catch(() => {}).then(() => previous.forEach(surface => surface.size.destroy()));
  }
}
