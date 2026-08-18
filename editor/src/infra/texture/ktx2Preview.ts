import type { HaiyueEngine } from '@haiyue/engine';
import { inspectKtx2Texture, uploadKtx2Texture } from '../../engine-adapter/EditorAssetProtocol';
import { getEngineGPUResourceTracker } from '../../engine-adapter/EditorDiagnosticsProtocol';

const KTX2_PREVIEW_MAX_SIZE = 128;

const KTX2_PREVIEW_VERTEX_WGSL = `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  var uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0),
  );
  var out: VertexOut;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}
`;


interface Ktx2PreviewSize {
  width?: number;
  height?: number;
  depth?: number;
}

export async function createKtx2PreviewUrl(
  engine: HaiyueEngine | null | undefined,
  buffer: ArrayBuffer,
  label: string,
): Promise<{ previewUrl?: string; width?: number; height?: number }> {
  const size = readKtx2Size(buffer);
  if (!engine?.device || typeof document === 'undefined') return size;

  const canvasSize = fitPreviewSize(size);
  const device = engine.device;
  const format: GPUTextureFormat = 'rgba8unorm';
  const info = inspectKtx2Texture(buffer, label);

  const texture = await uploadKtx2Texture(
    device,
    buffer.slice(0),
    `${label}.preview`,
    getEngineGPUResourceTracker(engine),
  );
  try {
    const output = device.createTexture({
      label: 'KTX2Preview.output',
      size: [canvasSize.width, canvasSize.height],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    try {
      const isTexture3D = (size.depth ?? 0) > 0;
      const shader = device.createShaderModule({ label: 'KTX2Preview.shader', code: createPreviewShader(isTexture3D, getPreviewMode(info.gpuFormat)) });
      const bindGroupLayout = device.createBindGroupLayout({
        label: 'KTX2Preview.bindGroupLayout',
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'unfilterable-float', viewDimension: isTexture3D ? '3d' : '2d' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: 'non-filtering' },
          },
        ],
      });
      const pipeline = device.createRenderPipeline({
        label: 'KTX2Preview.pipeline',
        layout: device.createPipelineLayout({
          label: 'KTX2Preview.pipelineLayout',
          bindGroupLayouts: [bindGroupLayout],
        }),
        vertex: { module: shader, entryPoint: 'vs' },
        fragment: {
          module: shader,
          entryPoint: 'fs',
          targets: [{ format }],
        },
        primitive: { topology: 'triangle-list' },
      });
      const bindGroup = device.createBindGroup({
        label: 'KTX2Preview.bindGroup',
        layout: bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: isTexture3D
              ? texture.createView({ dimension: '3d', baseMipLevel: 0, mipLevelCount: 1 })
              : texture.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 }),
          },
          {
            binding: 1,
            resource: device.createSampler({
              magFilter: 'nearest',
              minFilter: 'nearest',
              mipmapFilter: 'nearest',
            }),
          },
        ],
      });

      const encoder = device.createCommandEncoder({ label: 'KTX2Preview.encoder' });
      const pass = encoder.beginRenderPass({
        label: 'KTX2Preview.pass',
        colorAttachments: [{
          view: output.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      const paddedBytesPerRow = alignUp(canvasSize.width * 4, 256);
      const readback = device.createBuffer({
        label: 'KTX2Preview.readback',
        size: paddedBytesPerRow * canvasSize.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      encoder.copyTextureToBuffer(
        { texture: output },
        { buffer: readback, bytesPerRow: paddedBytesPerRow, rowsPerImage: canvasSize.height },
        [canvasSize.width, canvasSize.height],
      );
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await readback.mapAsync(GPUMapMode.READ);
      try {
        const mapped = new Uint8Array(readback.getMappedRange());
        const pixels = new Uint8ClampedArray(canvasSize.width * canvasSize.height * 4);
        for (let y = 0; y < canvasSize.height; y++) {
          const srcOffset = y * paddedBytesPerRow;
          const dstOffset = y * canvasSize.width * 4;
          pixels.set(mapped.subarray(srcOffset, srcOffset + canvasSize.width * 4), dstOffset);
        }
        const canvas = document.createElement('canvas');
        canvas.width = canvasSize.width;
        canvas.height = canvasSize.height;
        const context = canvas.getContext('2d');
        if (!context) return size;
        context.putImageData(new ImageData(pixels, canvasSize.width, canvasSize.height), 0, 0);
        return { ...size, previewUrl: canvas.toDataURL('image/png') };
      } finally {
        readback.unmap();
        readback.destroy();
      }
    } finally {
      output.destroy();
    }
  } finally {
    getEngineGPUResourceTracker(engine)?.untrackTexture(texture);
    texture.destroy();
  }
}

function readKtx2Size(buffer: ArrayBuffer): Ktx2PreviewSize {
  if (buffer.byteLength < 28) return {};
  const view = new DataView(buffer);
  const width = view.getUint32(20, true);
  const depth = view.getUint32(28, true);
  return {
    ...(width === 0 ? {} : { width }),
    height: view.getUint32(24, true) || 1,
    ...(depth === 0 ? {} : { depth }),
  };
}

function fitPreviewSize(size: Ktx2PreviewSize): Required<Ktx2PreviewSize> {
  const sourceWidth = Math.max(1, size.width || KTX2_PREVIEW_MAX_SIZE);
  const sourceHeight = Math.max(1, size.height || KTX2_PREVIEW_MAX_SIZE);
  const scale = Math.min(1, KTX2_PREVIEW_MAX_SIZE / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    depth: size.depth ?? 1,
  };
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function getPreviewMode(format: GPUTextureFormat | null): number {
  if (!format) return 0;
  if (
    format.startsWith('bc4-') ||
    format.startsWith('eac-r11') ||
    format.startsWith('r8') ||
    format.startsWith('r16')
  ) {
    return 1;
  }
  if (
    format.startsWith('bc5-') ||
    format.startsWith('eac-rg11') ||
    format.startsWith('rg8') ||
    format.startsWith('rg16')
  ) {
    return 2;
  }
  return 0;
}

function createPreviewShader(isTexture3D: boolean, previewMode: number): string {
  return `${KTX2_PREVIEW_VERTEX_WGSL}
const PREVIEW_MODE: u32 = ${previewMode}u;

@group(0) @binding(0) var previewTexture: texture_${isTexture3D ? '3d' : '2d'}<f32>;
@group(0) @binding(1) var previewSampler: sampler;

fn visualize(raw: vec4f) -> vec4f {
  if (PREVIEW_MODE == 1u) {
    return vec4f(vec3f(raw.r), 1.0);
  }
  if (PREVIEW_MODE == 2u) {
    return vec4f(raw.r, raw.g, 0.5, 1.0);
  }
  let maxRgb = max(max(raw.r, raw.g), raw.b);
  if (maxRgb < 0.015 && raw.a > 0.015) {
    return vec4f(vec3f(raw.a), 1.0);
  }
  return vec4f(raw.rgb, 1.0);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let dimensions = vec${isTexture3D ? '3' : '2'}f(textureDimensions(previewTexture));
  let uv = clamp(in.uv, vec2f(0.0), vec2f(1.0));
  ${isTexture3D
    ? `let z = 0.5 / max(dimensions.z, 1.0) + 0.5 * (dimensions.z - 1.0) / max(dimensions.z, 1.0);
  return visualize(textureSampleLevel(previewTexture, previewSampler, vec3f(uv, z), 0.0));`
    : `return visualize(textureSampleLevel(previewTexture, previewSampler, uv, 0.0));`}
}
`;
}
