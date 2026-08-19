import { World } from '@haiyue/engine';
import type { EditorPluginActivationContext } from '@haiyue/editor-plugin-sdk';
import { editorServiceTokens } from '@haiyue/editor-plugin-sdk';
import type { EditorDocumentHost, EditorDocumentHostSnapshot, EditorTaskCoordinator } from '@haiyue/editor-platform';
import type { SerializedEditorScene } from '../../export/runtimeScene';
import { prepareEditorSceneAsync } from '../../domain/scene/editorSceneIO';

export type RayTracingPreviewMode = 'path-tracing' | 'hybrid';
export type RayTracingPreviewEffect = 'full' | 'shadows' | 'reflections' | 'ao';
export type RayTracingPreviewQuality = 'low' | 'medium' | 'high';
export type RayTracingPreviewView = 'denoised' | 'raw' | 'variance' | 'history-age' | 'feature';
export interface RayTracingPreviewSettings { readonly mode: RayTracingPreviewMode; readonly effect: RayTracingPreviewEffect; readonly quality: RayTracingPreviewQuality; readonly view: RayTracingPreviewView }
export interface RayTracingPreviewDiagnostic { readonly code: string; readonly severity: 'info' | 'warning' | 'error'; readonly message: string }
export interface RayTracingPreviewMetrics { readonly sourceSha256: string; readonly width: number; readonly height: number; readonly buildMs: number; readonly gpuTimeNs: number | null; readonly peakBytes: number; readonly liveResourceCount: number; readonly sampleCount: number }
export interface RayTracingPreviewSnapshot { readonly status: 'idle' | 'building' | 'rendering' | 'ready' | 'unsupported' | 'failed' | 'disposed'; readonly progress: number; readonly message: string; readonly settings: RayTracingPreviewSettings; readonly pixels: Uint8Array | null; readonly metrics: RayTracingPreviewMetrics | null; readonly diagnostics: readonly RayTracingPreviewDiagnostic[]; readonly documentRevision: number | null }
interface PreviewCandidate { readonly pixels: Uint8Array; readonly metrics: RayTracingPreviewMetrics; readonly diagnostics: readonly RayTracingPreviewDiagnostic[]; destroy(): void }
type RayModule = typeof import('@haiyue/extensions/ray-tracing');
type PathRenderer = NonNullable<Awaited<ReturnType<RayModule['rayPathTracing']['RayPathTracingRenderer']['create']>>['renderer']>;
type SpatialDenoiser = NonNullable<Awaited<ReturnType<RayModule['rayDenoise']['RaySpatialTemporalDenoiser']['create']>>['denoiser']>;
type ProgressiveRenderer = NonNullable<Awaited<ReturnType<RayModule['raySampling']['RayProgressiveRenderer']['create']>>['renderer']>;

const QUALITY = Object.freeze({ low: Object.freeze({ width: 96, height: 54, samples: 1, bounces: 1 }), medium: Object.freeze({ width: 160, height: 90, samples: 4, bounces: 2 }), high: Object.freeze({ width: 256, height: 144, samples: 8, bounces: 3 }) });
const DEFAULT_SETTINGS: RayTracingPreviewSettings = Object.freeze({ mode: 'path-tracing', effect: 'full', quality: 'medium', view: 'denoised' });

export class RayTracingPreviewOwner {
  private readonly documents: EditorDocumentHost;
  private readonly tasks: EditorTaskCoordinator;
  private readonly listeners = new Set<(snapshot: RayTracingPreviewSnapshot) => void>();
  private readonly documentSubscription: { dispose(): void };
  private candidate: PreviewCandidate | null = null;
  private disposed = false;
  private autoRender = false;
  private renderQueued = false;
  private settings: RayTracingPreviewSettings = DEFAULT_SETTINGS;
  private state: RayTracingPreviewSnapshot = freezeSnapshot({ status: 'idle', progress: 0, message: 'Ray tracing preview is idle.', settings: DEFAULT_SETTINGS, pixels: null, metrics: null, diagnostics: [], documentRevision: null });

  constructor(private readonly context: EditorPluginActivationContext) {
    this.documents = context.services.get(editorServiceTokens.document) as EditorDocumentHost;
    this.tasks = context.services.get(editorServiceTokens.tasks) as EditorTaskCoordinator;
    this.documentSubscription = this.documents.subscribe(snapshot => this.onDocumentChanged(snapshot), true);
  }
  snapshot(): RayTracingPreviewSnapshot { return this.state; }
  subscribe(listener: (snapshot: RayTracingPreviewSnapshot) => void, emitInitial = false): { dispose(): void } {
    this.assertActive(); this.listeners.add(listener); if (emitInitial) listener(this.state); let active = true;
    return Object.freeze({ dispose: () => { if (active) { active = false; this.listeners.delete(listener); } } });
  }
  configure(patch: Partial<RayTracingPreviewSettings>): void {
    this.assertActive(); this.settings = Object.freeze({ ...this.settings, ...patch });
    this.publish({ ...this.state, settings: this.settings, message: 'Preview settings changed; accumulation was reset.' });
    if (this.autoRender) this.queueRender();
  }
  async render(): Promise<void> {
    this.assertActive(); this.autoRender = true;
    const document = this.documents.active();
    if (!document) { this.publishFailure('RAY_EDITOR_DOCUMENT_UNAVAILABLE', 'No active Scene document is available.', 'unsupported'); return; }
    if (this.settings.mode !== 'path-tracing' || this.settings.effect !== 'full') {
      this.releaseCandidate();
      this.publishFailure('RAY_EDITOR_EFFECT_UNSUPPORTED', `The first preview implements full path tracing; ${this.settings.mode}/${this.settings.effect} is classified but not rendered.`, 'unsupported'); return;
    }
    const revision = document.revision; const settings = this.settings;
    this.publish({ ...this.state, status: 'building', progress: 0.03, message: 'Serializing an immutable document snapshot…', settings, documentRevision: revision });
    const result = await this.tasks.run<PreviewCandidate, PreviewCandidate>('scene.ray-tracing-preview', {
      prepare: async task => {
        task.report({ current: 1, total: 5, message: 'Serialize document' });
        const serialized = await document.serialize(task.signal) as SerializedEditorScene; task.assertCurrent();
        const ray = await import('@haiyue/extensions/ray-tracing');
        task.report({ current: 2, total: 5, message: 'Prepare preview world' });
        const prepared = await prepareEditorSceneAsync(serialized, [], { signal: task.signal, reportProgress: (current, total) => this.publishProgress(0.12 + (total === 0 ? 0 : current / total) * 0.18, 'Preparing preview entities…') });
        task.assertCurrent(); const world = new World(`Ray preview: ${serialized.name || document.identity.name}`);
        for (const root of prepared.roots) world.addEntity(root);
        try {
          task.report({ current: 3, total: 5, message: 'Build acceleration' });
          const candidate = await buildCandidate(ray, world, serialized, settings, task.signal, value => this.publishProgress(0.3 + value * 0.68, 'Tracing progressive samples…', 'rendering'));
          task.assertCurrent(); return candidate;
        } catch (error) { world.destroy(); throw error; }
      },
      commit: candidate => { this.releaseCandidate(); this.candidate = candidate; return candidate; },
      rollback: (_reason, candidate) => candidate?.destroy(),
    });
    if (this.disposed || result.status === 'cancelled') return;
    if (result.status === 'failed') {
      const diagnostic = classifyError(result.error); this.context.report({ ...diagnostic, ownerId: this.context.pluginId });
      this.publishFailure(diagnostic.code, diagnostic.message, 'failed'); return;
    }
    const candidate = result.value;
    this.publish({ status: 'ready', progress: 1, message: 'Ray tracing preview is ready.', settings, pixels: candidate.pixels, metrics: candidate.metrics, diagnostics: candidate.diagnostics, documentRevision: revision });
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.autoRender = false; this.tasks.cancel('scene.ray-tracing-preview'); this.documentSubscription.dispose(); this.releaseCandidate();
    this.publish({ ...this.state, status: 'disposed', progress: 0, message: 'Ray tracing preview was unloaded.', pixels: null, metrics: null }); this.listeners.clear();
  }
  private onDocumentChanged(snapshot: EditorDocumentHostSnapshot): void {
    const active = snapshot.documents.find(value => value.active); this.releaseCandidate();
    this.publish({ ...this.state, status: 'idle', progress: 0, message: active ? 'Document changed; preview accumulation was invalidated.' : 'No active Scene document.', pixels: null, metrics: null, diagnostics: [], documentRevision: active?.revision ?? null });
    if (this.autoRender) this.queueRender();
  }
  private queueRender(): void { if (this.renderQueued || this.disposed) return; this.renderQueued = true; queueMicrotask(() => { this.renderQueued = false; if (!this.disposed) void this.render(); }); }
  private publishProgress(progress: number, message: string, status: RayTracingPreviewSnapshot['status'] = 'building'): void { if (!this.disposed) this.publish({ ...this.state, status, progress, message, settings: this.settings }); }
  private publishFailure(code: string, message: string, status: 'unsupported' | 'failed'): void { this.publish({ ...this.state, status, progress: 0, message, settings: this.settings, pixels: null, metrics: null, diagnostics: [Object.freeze({ code, severity: status === 'failed' ? 'error' : 'warning', message })] }); }
  private publish(next: RayTracingPreviewSnapshot): void { this.state = freezeSnapshot(next); for (const listener of [...this.listeners]) listener(this.state); }
  private releaseCandidate(): void { this.candidate?.destroy(); this.candidate = null; }
  private assertActive(): void { if (this.disposed) throw new Error('Ray tracing preview owner is disposed.'); }
}

async function buildCandidate(ray: RayModule, world: World, serialized: SerializedEditorScene, settings: RayTracingPreviewSettings, signal: AbortSignal, progress: (value: number) => void): Promise<PreviewCandidate> {
  signal.throwIfAborted(); const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw codedError('RAY_EDITOR_WEBGPU_UNAVAILABLE', 'WebGPU is unavailable for ray tracing preview.');
  const requiredFeatures: GPUFeatureName[] = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  const device = await adapter.requestDevice({ requiredFeatures }); const builder = new ray.rayAcceleration.RayAccelerationBuilder();
  let base: PathRenderer | null = null;
  let denoiser: SpatialDenoiser | null = null;
  let progressive: ProgressiveRenderer | null = null;
  try {
    const buildStart = performance.now(); const extracted = ray.rayScene.extractRayTracingScene(world);
    if (!extracted.valid) throw codedError('RAY_EDITOR_SCENE_UNSUPPORTED', formatDiagnostics(extracted.diagnostics));
    const update = builder.update(extracted.snapshot); if (!update.snapshot) throw codedError('RAY_EDITOR_ACCELERATION_FAILED', formatDiagnostics(update.diagnostics));
    const materials = ray.rayMaterial.packRayPbrMaterialScene(world, update.snapshot.packed); if (!materials.packed) throw codedError('RAY_EDITOR_MATERIAL_FAILED', formatDiagnostics(materials.diagnostics));
    const facts = ray.rayPathTracing.extractRayPathSceneFacts(world); if (!facts.facts) throw codedError('RAY_EDITOR_CAMERA_OR_LIGHT_UNAVAILABLE', formatDiagnostics(facts.diagnostics));
    const buildMs = performance.now() - buildStart; signal.throwIfAborted();
    const baseResult = await ray.rayPathTracing.RayPathTracingRenderer.create(device, update.snapshot.packed, materials.packed); if (!baseResult.renderer) throw codedError('RAY_EDITOR_PIPELINE_FAILED', formatDiagnostics(baseResult.diagnostics)); base = baseResult.renderer;
    const denoiseResult = await ray.rayDenoise.RaySpatialTemporalDenoiser.create(device); if (!denoiseResult.denoiser) throw codedError('RAY_EDITOR_DENOISE_FAILED', formatDiagnostics(denoiseResult.diagnostics)); denoiser = denoiseResult.denoiser;
    const progressiveResult = await ray.raySampling.RayProgressiveRenderer.create(device, base, denoiser); if (!progressiveResult.renderer) throw codedError('RAY_EDITOR_PROGRESSIVE_FAILED', formatDiagnostics(progressiveResult.diagnostics)); progressive = progressiveResult.renderer;
    const quality = QUALITY[settings.quality]; const frame = Object.freeze({ facts: facts.facts, revision: ray.raySampling.createRayProgressiveFrameRevision(update.snapshot, materials.packed, facts.facts) });
    let rendered: Awaited<ReturnType<typeof progressive.render>> | null = null;
    for (let sample = 1; sample <= quality.samples; sample++) {
      signal.throwIfAborted(); progress(sample / quality.samples);
      rendered = await progressive.render(frame, { width: quality.width, height: quality.height, maxBounces: quality.bounces, baseSeed: 0x52a91d73, qualityRevision: `editor:${settings.quality}`, view: settings.view, readback: sample === quality.samples });
      if (rendered.status !== 'ok') throw codedError('RAY_EDITOR_RENDER_FAILED', formatDiagnostics(rendered.diagnostics));
    }
    if (!rendered?.pixels) throw codedError('RAY_EDITOR_READBACK_MISSING', 'Ray tracing preview did not return pixels.');
    const diagnostics = compactDiagnostics([...extracted.diagnostics, ...update.diagnostics, ...materials.diagnostics, ...facts.diagnostics, ...baseResult.diagnostics, ...denoiseResult.diagnostics, ...progressiveResult.diagnostics, ...rendered.diagnostics]);
    const timed = (...values: readonly (number | null)[]): number | null => values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    const sourceSha256 = `sha256:${await sha256(JSON.stringify(serialized))}`; let destroyed = false;
    return Object.freeze({
      pixels: Uint8Array.from(rendered.pixels),
      metrics: Object.freeze({ sourceSha256, width: quality.width, height: quality.height, buildMs, gpuTimeNs: timed(rendered.timing.samplingNs, rendered.timing.accumulationNs, rendered.timing.denoiseTemporalNs, rendered.timing.denoiseSpatialNs, rendered.timing.presentNs), peakBytes: rendered.memory.peakBytes, liveResourceCount: rendered.memory.liveResourceCount, sampleCount: rendered.statistics.sampleCount }),
      diagnostics,
      destroy() { if (destroyed) return; destroyed = true; progressive?.destroy(); denoiser?.destroy(); base?.destroy(); builder.destroy(); world.destroy(); device.destroy(); progressive = null; denoiser = null; base = null; },
    });
  } catch (error) { progressive?.destroy(); denoiser?.destroy(); base?.destroy(); builder.destroy(); world.destroy(); device.destroy(); throw error; }
}

function compactDiagnostics(values: readonly { readonly code: string; readonly severity: string; readonly message: string }[]): readonly RayTracingPreviewDiagnostic[] {
  const limit = 80; const diagnostics: RayTracingPreviewDiagnostic[] = values.slice(0, limit).map(value => Object.freeze({ code: value.code, severity: value.severity === 'error' || value.severity === 'warning' ? value.severity : 'info', message: value.message }));
  if (values.length > limit) diagnostics.push(Object.freeze({ code: 'RAY_EDITOR_DIAGNOSTICS_TRUNCATED', severity: 'info', message: `${values.length - limit} additional diagnostics were omitted from the panel.` })); return Object.freeze(diagnostics);
}
function freezeSnapshot(value: RayTracingPreviewSnapshot): RayTracingPreviewSnapshot { return Object.freeze({ ...value, settings: Object.freeze({ ...value.settings }), diagnostics: Object.freeze([...value.diagnostics]) }); }
function formatDiagnostics(values: readonly { readonly code: string; readonly message: string }[]): string { return values.length === 0 ? 'No diagnostic details were returned.' : values.slice(0, 8).map(value => `${value.code}: ${value.message}`).join('\n'); }
function codedError(code: string, message: string): Error { const error = new Error(message); error.name = code; return error; }
function classifyError(error: unknown): RayTracingPreviewDiagnostic { if (error instanceof Error && /^RAY_/.test(error.name)) return Object.freeze({ code: error.name, severity: 'error', message: error.message }); return Object.freeze({ code: 'RAY_EDITOR_UNCLASSIFIED_FAILURE', severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
async function sha256(value: string): Promise<string> { const bytes = new TextEncoder().encode(value); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
