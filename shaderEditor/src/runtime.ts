import { HaiyueEngine, Entity, Camera3D, CartesianTransform3D, SphericalTransform3D, OrbitControl,
  BasicMaterial, Mesh3D, createSphere3D, createBox3D, type Scene } from '@haiyue/engine';
import { createTorus3D } from '@haiyue/engine/geometry';
import { type PassId, type ShaderProject, type ShaderPass, type ShaderDiagnostic, type PreviewMode, type PreviewMesh, LIMITS, CUBE_FACES, usesCurrentFrame, validateProject } from './model.js';
import { resolveChannelBindings, channelDiagnostic } from './channelBindings.js';
import { builtinTexture } from './builtinTextures.js';
import { KeyboardState, keyboardCode } from './keyboardTexture.js';
import { VideoSource } from './videoTexture.js';
import { PRESENT, wrapShader } from './shaders.js';
import { shaderGpuProvider, feedbackFormat } from './gpuPrecision.js';
import { BufferPreviews, type BufferPreview } from './bufferPreviews.js';

type Texture = { texture: GPUTexture; view: GPUTextureView; width: number; height: number };
type CompiledPass = { channelDimensions: ('2d' | 'cube')[]; channelLayout: GPUBindGroupLayout; pass: ShaderPass; pipeline: GPURenderPipeline; uniform: GPUBuffer; group: GPUBindGroup };
export type PreparedShader = { project: ShaderProject; passes: CompiledPass[]; images: Map<string, Texture>; videos: Map<string, VideoSource>; diagnostics: ShaderDiagnostic[]; generation: number };
export class CompileError extends Error { constructor(readonly diagnostics: ShaderDiagnostic[]) { super(diagnostics.map(d => `${d.pass}:${d.line} ${d.message}`).join('\n')); } }

/** All GPU work shares Haiyue's device, surface, lifecycle and scene renderer. */
export class ShaderRuntime {
  readonly engine: HaiyueEngine;
  private scene!: Scene;
  private gpu: GPUDevice | undefined;
  private orbit: OrbitControl | undefined;
  private camera = new SphericalTransform3D({ radius: 3.6, theta: 0.45, phi: 1.25 });
  private material = new BasicMaterial({ blending: 'none' });
  private mesh!: Mesh3D;
  private geometries = { sphere: createSphere3D({ radius: 1, widthSegments: 64, heightSegments: 40 }), box: createBox3D({ width: 1.6, height: 1.6, depth: 1.6 }), torus: createTorus3D({ radius: 0.85, tube: 0.32, radialSegments: 32, tubularSegments: 64 }) };
  private active: PreparedShader | undefined;
  private targets = new Map<PassId, [Texture, Texture]>();
  private current = 0;
  private sampler!: GPUSampler;
  private bufferFormat: 'rgba32float' | 'rgba16float' = 'rgba16float';
  private frameLayout!: GPUBindGroupLayout;
  private emptyLayout!: GPUBindGroupLayout;
  private emptyGroup!: GPUBindGroup;
  private keyboard = new KeyboardState();
  private keyboardTexture!: Texture;
  private fallback!: Texture;
  private fallbackCube!: Texture;
  private presenter!: GPURenderPipeline;
  private presentSize!: GPUBuffer;
  private bufferPreviews: BufferPreviews | undefined;
  private bufferPreviewProject = '';
  private mode: PreviewMode = 'canvas';
  private playing = true;
  private visible = true;
  private dead = false;
  private failed = false;
  private generation = 0;
  private frame = 0;
  private time = 0;
  private delta = 0;
  private width = 0;
  private height = 0;
  private dirty = true;
  private mouse = [0, 0, 0, 0];
  private pressed = false;
  private pointer = -1;
  private lifecycle = new AbortController();
  private errorListener: ((event: GPUUncapturedErrorEvent) => void) | undefined;
  onFrame: ((state: ReturnType<ShaderRuntime['status']>) => void) | undefined;
  onError: ((message: string) => void) | undefined;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.engine = new HaiyueEngine({ ...(navigator.gpu ? { gpu: shaderGpuProvider(navigator.gpu) } : {}), canvas, msaaSamples: 1, devicePixelRatio: 1, recoverDeviceLost: false,
      clearColor: { r: 0.018, g: 0.024, b: 0.032, a: 1 } });
  }
  async initialize() {
    await this.engine.init();
    const device = this.engine.device;
    this.gpu = device;
    this.bufferFormat = feedbackFormat(device.features);
    this.sampler = device.createSampler({ label: 'ShaderEditor.channelSampler', minFilter: 'linear', magFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
    this.frameLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 144 } }] });
    this.emptyLayout = device.createBindGroupLayout({ entries: [] });
    this.emptyGroup = device.createBindGroup({ layout: this.emptyLayout, entries: [] });
    this.keyboardTexture = this.texture(256, 3, 'rgba8unorm', 'keyboard');
    this.fallback = this.texture(1, 1, 'rgba8unorm', 'empty');
    device.queue.writeTexture({ texture: this.fallback.texture }, new Uint8Array([0, 0, 0, 255]), {}, [1, 1]);
    this.fallbackCube = this.texture(1, 1, 'rgba8unorm', 'emptyCube', true);
    for (let layer = 0; layer < 6; layer++) device.queue.writeTexture({ texture: this.fallbackCube.texture, origin: [0, 0, layer] }, new Uint8Array([0, 0, 0, 255]), {}, [1, 1]);
    const module = device.createShaderModule({ label: 'ShaderEditor.present', code: PRESENT });
    this.presenter = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'hy_vertex' }, fragment: { module, entryPoint: 'hy_present', targets: [{ format: this.engine.format }] }, primitive: { topology: 'triangle-list' } });
    this.bufferPreviews = new BufferPreviews(device, this.engine.format, this.presenter, this.sampler);
    this.presentSize = device.createBuffer({ label: 'ShaderEditor.presentSize', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cameraEntity = new Entity('Shader camera').addComponent(this.camera).addComponent(new Camera3D({ near: 0.05, far: 100, fov: Math.PI / 4 }));
    this.scene = this.engine.createScene({ camera: cameraEntity, render3D: true, render2D: false, gui: false, view: { clearColor: this.engine.clearColor } });
    this.mesh = new Mesh3D(this.geometries.sphere, this.material);
    this.scene.add(new Entity('Shader material preview').addComponent(new CartesianTransform3D()).addComponent(this.mesh));
    this.engine.switchScene(null);
    this.bindPointer();
    this.errorListener = event => this.fail(event.error.message);
    device.addEventListener('uncapturederror', this.errorListener);
    this.engine.on('device-lost', () => this.fail('GPU 设备已断开。代码和工程仍保留，请重新加载页面以恢复预览。'));
    this.engine.on('update', ({ detail }) => {
      if (this.dead || this.failed || !this.visible || document.hidden) return;
      try { this.render(detail.delta / 1000); } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
    });
    this.engine.run();
  }
  private fail(message: string) { if (this.dead) return; this.failed = true; this.syncVideos(); this.engine.stop(); this.onError?.(message); }

  async prepare(project: ShaderProject): Promise<PreparedShader> {
    if (this.dead || this.failed) throw new Error('GPU 预览不可用，请重新加载。');
    const snapshot = validateProject(project), generation = ++this.generation;
    const result: PreparedShader = { project: snapshot, passes: [], images: new Map(), videos: new Map(), diagnostics: [], generation };
    const device = this.engine.device;
    try {
      for (const pass of snapshot.passes.filter(p => p.enabled)) {
        if (pass.id !== 'image' && this.bufferFormat === 'rgba16float') result.diagnostics.push({
          pass: pass.id, severity: 'warning', line: 1, column: 1,
          message: '当前 GPU 不支持 32 位浮点纹理过滤，Buffer 已使用 16 位兼容模式。依赖精确相机或位置数据的历史帧效果可能出现拖影。',
        });
        const binding = resolveChannelBindings(pass);
        result.diagnostics.push(...binding.diagnostics);
        if (binding.diagnostics.some(d => d.severity === 'error')) continue;
        const channelLayout = device.createBindGroupLayout({ entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          ...binding.dimensions.map((dimension, index) => ({ binding: index + 1, visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'float' as const, viewDimension: dimension } })),
        ] });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [this.frameLayout, this.emptyLayout, channelLayout] });
        const wrapped = wrapShader(pass);
        device.pushErrorScope('validation');
        const module = device.createShaderModule({ label: `ShaderEditor.${pass.id}`, code: wrapped.code });
        // Pop synchronously so overlapping authoring requests cannot interleave error scopes.
        const scopedError = device.popErrorScope();
        const info = await module.getCompilationInfo();
        const validation = await scopedError;
        result.diagnostics.push(...info.messages.map(m => ({ pass: pass.id, severity: m.type,
          message: channelDiagnostic(m.message, pass), line: Math.max(1, Math.min(wrapped.lines, m.lineNum - wrapped.lineOffset)), column: m.linePos || 1 })));
        if (validation && !info.messages.some(m => m.type === 'error')) result.diagnostics.push({ pass: pass.id, severity: 'error', message: validation.message, line: 1, column: 1 });
        if (validation || info.messages.some(m => m.type === 'error')) continue;
        try {
          const pipeline = await device.createRenderPipelineAsync({ label: `ShaderEditor.${pass.id}`, layout,
            vertex: { module, entryPoint: 'hy_vertex' }, fragment: { module, entryPoint: 'hy_fragment', targets: [{ format: pass.id === 'image' ? 'rgba8unorm' : this.bufferFormat }] }, primitive: { topology: 'triangle-list' } });
          const uniform = device.createBuffer({ label: `ShaderEditor.${pass.id}.uniform`, size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          result.passes.push({ channelDimensions: binding.dimensions, channelLayout, pass, pipeline, uniform, group: device.createBindGroup({ layout: this.frameLayout, entries: [{ binding: 0, resource: { buffer: uniform } }] }) });
        } catch (error) {
          result.diagnostics.push({ pass: pass.id, severity: 'error', message: String(error), line: 1, column: 1 });
        }
      }
      if (result.diagnostics.some(d => d.severity === 'error')) throw new CompileError(result.diagnostics);
      const used = new Set(snapshot.passes.filter(p => p.enabled).flatMap(p => p.channels.flatMap(c => c.kind === 'image' || c.kind === 'cubemap' || c.kind === 'video' ? [c.assetId] : [])));
      let pixels = 0;
      const builtins = new Set(snapshot.passes.filter(p => p.enabled).flatMap(p => p.channels.flatMap(c => c.kind === 'builtin' ? [c.texture] : [])));
      const sources = [...snapshot.assets.filter(a => used.has(a.id)), ...[...builtins].map(id => ({ id: 'builtin:' + id, kind: 'image' as const, dataUrl: builtinTexture(id).url }))];
      for (const asset of sources) {
        if (asset.kind === 'video') {
          const source = await VideoSource.load(await (await fetch(asset.dataUrl)).blob());
          result.videos.set(asset.id, source);
          pixels += source.video.videoWidth * source.video.videoHeight;
          if (pixels > 16_777_216) throw new Error('已使用纹理的总像素最多 1600 万。');
          const texture = this.texture(source.video.videoWidth, source.video.videoHeight, 'rgba8unorm', asset.id);
          result.images.set(asset.id, texture);
          source.video.addEventListener('seeked', () => { if (this.active === result) this.dirty = true; });
          device.queue.copyExternalImageToTexture({ source: source.video }, { texture: texture.texture }, [texture.width, texture.height]);
          continue;
        }
        const cube = asset.kind === 'cubemap';
        const urls = cube ? CUBE_FACES.map(face => asset.faces[face]) : [asset.dataUrl];
        let texture: Texture | undefined;
        for (let layer = 0; layer < urls.length; layer++) {
          const response = await fetch(urls[layer]!);
          if (!response.ok) throw new Error('无法载入纹理：' + asset.id);
          const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
          try {
            pixels += bitmap.width * bitmap.height;
            if (Math.max(bitmap.width, bitmap.height) > LIMITS.dimension || pixels > 16_777_216) throw new Error('纹理尺寸最多 4096，已使用图片的总像素最多 1600 万。');
            if (cube && (bitmap.width !== bitmap.height || (texture && texture.width !== bitmap.width))) throw new Error('立方体贴图的六个面必须是尺寸相同的正方形。');
            if (!texture) {
              texture = this.texture(bitmap.width, bitmap.height, 'rgba8unorm', asset.id, cube);
              result.images.set(asset.id, texture);
            }
            device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: texture.texture, origin: [0, 0, layer] }, [bitmap.width, bitmap.height]);
          } finally { bitmap.close(); }
        }
      }
      if (this.dead || generation !== this.generation) throw new Error('编译已被较新的操作替代。');
      return result;
    } catch (error) { this.releasePrepared(result); throw error; }
  }
  commit(prepared: PreparedShader) {
    if (this.dead || this.failed || prepared.generation !== this.generation) throw new Error('编译结果已过期。');
    const previous = this.active;
    this.active = prepared;
    if (previous) this.releasePrepared(previous);
    this.releaseTargets();
    this.reset();
    this.setMode(prepared.project.preview.mode);
    this.setMesh(prepared.project.preview.mesh);
  }
  releasePrepared(prepared: PreparedShader) {
    prepared.videos.forEach(source => source.dispose());
    this.retire([...prepared.passes.map(p => p.uniform), ...[...prepared.images.values()].map(t => t.texture)]);
  }
  invalidate() { ++this.generation; }
  setMode(mode: PreviewMode) {
    this.mode = mode; this.orbit?.dispose(); this.orbit = undefined;
    this.engine.switchScene(mode === 'scene' ? this.scene : null);
    if (mode === 'scene') this.orbit = new OrbitControl(this.canvas, this.camera, { minRadius: 1.8, maxRadius: 12 });
  }
  setMesh(mesh: PreviewMesh) { this.mesh.geometry = this.geometries[mesh]; }
  resetCamera() { this.camera.set(3.6, 0.45, 1.25).setTarget(0, 0, 0); }
  private syncVideos() { this.active?.videos.forEach(source => source.play(this.playing && this.visible && !document.hidden && !this.failed)); }
  setPlaying(value: boolean) { this.playing = value; this.syncVideos(); }
  setVisible(value: boolean) { this.visible = value; if (!value) { this.keyboard.release(); this.dirty = true; } this.syncVideos(); if (value && !this.failed) this.engine.run(); else this.engine.stop(); }
  setBufferPreviews(projectId: string, previews: readonly BufferPreview[]) { this.bufferPreviewProject = projectId; this.bufferPreviews?.set(previews); }
  reset() { this.keyboard.reset(); this.active?.videos.forEach(source => source.reset()); this.syncVideos(); this.bufferPreviews?.invalidate(); this.time = 0; this.frame = 0; this.delta = 0; this.clearTargets(); this.dirty = true; }
  // Offscreen passes can advance immediately; the surface is presented only inside Haiyue's frame loop.
  step() { this.setPlaying(false); this.active?.videos.forEach(source => source.step(1 / 60)); this.render(1 / 60, true); }
  status() { return { ready: Boolean(this.active) && !this.failed, frame: this.frame, time: this.time, playing: this.playing, width: this.width, height: this.height, mode: this.mode, bufferFormat: this.bufferFormat, camera: { theta: this.camera.theta, phi: this.camera.phi, radius: this.camera.radius } }; }
  private texture(width: number, height: number, format: GPUTextureFormat, label: string, cube = false): Texture {
    const texture = this.engine.device.createTexture({ label: `ShaderEditor.${label}`, size: [width, height, cube ? 6 : 1], format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    return { texture, view: texture.createView({ dimension: cube ? 'cube' : '2d' }), width, height };
  }
  private resize() {
    this.engine.resizeToDisplaySize();
    const scale = this.active!.project.preview.scale;
    const w = Math.max(1, this.engine.width * scale), h = Math.max(1, this.engine.height * scale);
    const cap = Math.min(1, 2048 / Math.max(w, h), Math.sqrt(1_048_576 / (w * h)));
    const width = Math.max(1, Math.floor(w * cap)), height = Math.max(1, Math.floor(h * cap));
    if (width === this.width && height === this.height && this.targets.size) return;
    this.releaseTargets(); this.width = width; this.height = height;
    for (const { pass } of this.active!.passes) {
      const format = pass.id === 'image' ? 'rgba8unorm' : this.bufferFormat;
      this.targets.set(pass.id, [this.texture(width, height, format, `${pass.id}.ping`), this.texture(width, height, format, `${pass.id}.pong`)]);
    }
    this.reset();
  }
  private render(seconds: number, step = false) {
    if (!this.active || this.dead || this.failed) return;
    this.resize();
    const advance = this.playing || step;
    if (advance || this.dirty) {
      this.delta = advance ? Math.min(Math.max(seconds, 0), 0.1) : 0;
      if (this.frame > 0) this.time += this.delta;
      const device = this.engine.device, encoder = device.createCommandEncoder({ label: 'ShaderEditor.frame' });
      device.queue.writeTexture({ texture: this.keyboardTexture.texture }, this.keyboard.pixels(), { bytesPerRow: 256 * 4 }, [256, 3]);
      for (const [id, source] of this.active.videos) {
        if (source.video.readyState >= 2 && !source.video.seeking) {
          const target = this.active.images.get(id)!;
          device.queue.copyExternalImageToTexture({ source: source.video }, { texture: target.texture }, [target.width, target.height]);
        }
      }
      const next = 1 - this.current;
      for (const compiled of this.active.passes) {
        const inputs = compiled.pass.channels.map((c, index) => c.kind === 'keyboard' ? this.keyboardTexture : c.kind === 'builtin' ? this.active!.images.get('builtin:' + c.texture)! : c.kind === 'image' || c.kind === 'cubemap' || c.kind === 'video' ? this.active!.images.get(c.assetId)! : c.kind === 'buffer'
          ? this.targets.get(c.pass)![usesCurrentFrame(compiled.pass.id, c.pass) ? next : this.current]! : compiled.channelDimensions[index] === 'cube' ? this.fallbackCube : this.fallback);
        const data = new Float32Array(36);
        data.set([this.width, this.height, 1, this.time, this.delta, this.frame, this.delta > 0 ? 1 / this.delta : 0, 44100]);
        data.set(this.mouse, 8);
        const date = new Date();
        data.set([date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000], 12);
        inputs.forEach((input, i) => {
          if (compiled.pass.channels[i]!.kind !== 'none') data.set([input.width, input.height, 1, 0], 16 + i * 4);
          const c = compiled.pass.channels[i]!;
          data[32 + i] = c.kind === 'video' ? this.active!.videos.get(c.assetId)!.video.currentTime : c.kind === 'buffer' ? (usesCurrentFrame(compiled.pass.id, c.pass) ? this.time : Math.max(0, this.time - this.delta)) : 0;
        });
        device.queue.writeBuffer(compiled.uniform, 0, data);
        const group = device.createBindGroup({ layout: compiled.channelLayout, entries: [{ binding: 0, resource: this.sampler }, ...inputs.map((input, i) => ({ binding: i + 1, resource: input.view }))] });
        const pass = encoder.beginRenderPass({ label: `ShaderEditor.${compiled.pass.id}`, colorAttachments: [{ view: this.targets.get(compiled.pass.id)![next]!.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
        pass.setPipeline(compiled.pipeline); pass.setBindGroup(0, compiled.group); pass.setBindGroup(1, this.emptyGroup); pass.setBindGroup(2, group); pass.draw(3); pass.end();
      }
      device.queue.submit([encoder.finish()]); this.current = next; this.frame++; this.dirty = this.keyboard.endFrame();
    }
    const output = this.targets.get('image')![this.current]!;
    if (this.mode === 'canvas') { if (!step) this.present(output); }
    else if (this.material.texture !== output.texture) this.material.texture = output.texture;
    if (this.visible && !document.hidden) this.bufferPreviews?.render(
      id => this.active?.project.id === this.bufferPreviewProject ? this.targets.get(id)?.[this.current] : undefined, this.frame, step);
    this.onFrame?.(this.status());
  }
  private present(output: Texture) {
    const device = this.engine.device;
    device.queue.writeBuffer(this.presentSize, 0, new Float32Array([this.engine.width, this.engine.height, 0, 0]));
    const group = device.createBindGroup({ layout: this.presenter.getBindGroupLayout(0), entries: [
      { binding: 0, resource: output.view }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.presentSize } }] });
    const encoder = device.createCommandEncoder({ label: 'ShaderEditor.present' });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.engine.getOutputView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.presenter); pass.setBindGroup(0, group); pass.draw(3); pass.end(); device.queue.submit([encoder.finish()]);
  }
  async readImage(): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    const output = this.targets.get('image')?.[this.current]; if (!output) throw new Error('尚无可读取的渲染结果。');
    const device = this.engine.device, stride = Math.ceil(output.width * 4 / 256) * 256;
    const buffer = device.createBuffer({ label: 'ShaderEditor.readback', size: stride * output.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: output.texture }, { buffer, bytesPerRow: stride }, [output.width, output.height]);
      device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8Array(output.width * output.height * 4);
      for (let y = 0; y < output.height; y++) pixels.set(mapped.subarray(y * stride, y * stride + output.width * 4), y * output.width * 4);
      buffer.unmap(); return { width: output.width, height: output.height, pixels };
    } finally { buffer.destroy(); }
  }
  private clearTargets() {
    if (!this.targets.size) return;
    const encoder = this.engine.device.createCommandEncoder();
    for (const pair of this.targets.values()) for (const target of pair) encoder.beginRenderPass({ colorAttachments: [{ view: target.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
    this.engine.device.queue.submit([encoder.finish()]); this.current = 0;
  }
  private releaseTargets() { this.material.texture = null; this.retire([...this.targets.values()].flatMap(pair => pair.map(t => t.texture))); this.targets.clear(); }
  private retire(resources: (GPUBuffer | GPUTexture)[]) {
    if (!resources.length) return;
    void (this.gpu?.queue.onSubmittedWorkDone() ?? Promise.resolve()).catch(() => {}).then(() => resources.forEach(r => r.destroy()));
  }
  private bindPointer() {
    const options = { signal: this.lifecycle.signal };
    this.canvas.tabIndex = 0;
    const releaseKeys = () => { this.keyboard.release(); this.dirty = true; };
    this.canvas.addEventListener('keydown', event => {
      if (!this.active?.passes.some(p => p.pass.channels.some(c => c.kind === 'keyboard')) || event.ctrlKey || event.metaKey || event.altKey || event.code === 'Tab') return;
      event.preventDefault(); if (this.keyboard.down(keyboardCode(event))) this.dirty = true;
    }, options);
    window.addEventListener('keyup', event => { if (this.keyboard.up(keyboardCode(event))) this.dirty = true; }, options);
    this.canvas.addEventListener('blur', releaseKeys, options); window.addEventListener('blur', releaseKeys, options);
    const move = (event: PointerEvent) => {
      if (!this.pressed || event.pointerId !== this.pointer) return;
      const r = this.canvas.getBoundingClientRect();
      this.mouse[0] = Math.max(0, Math.min(this.width, (event.clientX - r.left) / r.width * this.width));
      this.mouse[1] = Math.max(0, Math.min(this.height, (r.bottom - event.clientY) / r.height * this.height));
    };
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.canvas.focus({ preventScroll: true });
      this.pressed = true; this.pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); move(event);
      this.mouse[2] = Math.max(0.0001, this.mouse[0]!); this.mouse[3] = Math.max(0.0001, this.mouse[1]!);
    }, options);
    this.canvas.addEventListener('pointermove', move, options);
    const up = (event: PointerEvent) => { if (event.pointerId !== this.pointer) return; this.pressed = false; this.mouse[2] = -Math.abs(this.mouse[2]!); this.mouse[3] = -Math.abs(this.mouse[3]!); };
    this.canvas.addEventListener('pointerup', up, options); this.canvas.addEventListener('pointercancel', up, options); this.canvas.addEventListener('lostpointercapture', up, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseKeys(); this.syncVideos(); if (document.hidden) this.engine.stop(); else if (this.visible && !this.failed) this.engine.run(); }, options);
  }
  async dispose() {
    if (this.dead) return; this.dead = true; this.invalidate(); this.engine.stop(); this.lifecycle.abort(); this.orbit?.dispose();
    if (this.errorListener) this.gpu?.removeEventListener('uncapturederror', this.errorListener);
    this.bufferPreviews?.dispose(); this.scene?.destroy(); this.releaseTargets(); if (this.active) this.releasePrepared(this.active);
    await this.gpu?.queue.onSubmittedWorkDone().catch(() => {});
    this.keyboardTexture?.texture.destroy(); this.fallback?.texture.destroy(); this.fallbackCube?.texture.destroy(); this.presentSize?.destroy(); this.engine.destroy();
  }
}
