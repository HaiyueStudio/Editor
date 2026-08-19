import type {
  RayTracingPreviewEffect,
  RayTracingPreviewMode,
  RayTracingPreviewOwner,
  RayTracingPreviewQuality,
  RayTracingPreviewSnapshot,
  RayTracingPreviewView,
} from './RayTracingPreviewOwner';

export interface RayTracingPanelMountOptions {
  readonly owner: RayTracingPreviewOwner;
  readonly host?: HTMLElement;
  readonly onDisable: () => void | Promise<void>;
}

export interface RayTracingPanelHandle { dispose(): void }

export function mountRayTracingPanel(options: RayTracingPanelMountOptions): RayTracingPanelHandle {
  const existing = document.getElementById('ray-tracing-preview-panel');
  existing?.remove();
  const panel = document.createElement('section');
  panel.id = 'ray-tracing-preview-panel';
  panel.dataset.rayTracingPanel = 'active';
  panel.style.cssText = 'position:fixed;right:16px;top:56px;z-index:90;width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 72px);display:grid;grid-template-rows:auto auto auto minmax(140px,1fr) auto;gap:10px;padding:12px;border:1px solid #40506a;border-radius:8px;background:#121925ee;color:#dce7f8;box-shadow:0 16px 48px #0009;font:12px system-ui;';
  panel.innerHTML = `
    <header style="display:flex;align-items:center;gap:8px"><strong style="font-size:14px">Ray Tracing Preview</strong><span data-ray-status style="margin-left:auto;color:#8fb4e8">idle</span><button data-ray-disable type="button">Unload</button></header>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">
      ${select('mode', [['path-tracing', 'Path tracing'], ['hybrid', 'Hybrid']])}
      ${select('effect', [['full', 'Full'], ['shadows', 'Shadows'], ['reflections', 'Reflections'], ['ao', 'AO']])}
      ${select('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
      ${select('view', [['denoised', 'Denoised'], ['raw', 'Raw'], ['variance', 'Variance'], ['history-age', 'History age'], ['feature', 'Feature']])}
    </div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center"><progress data-ray-progress max="1" value="0" style="width:100%"></progress><button data-ray-render type="button">Render</button><span data-ray-message style="grid-column:1/-1;color:#aebbd0"></span></div>
    <div style="display:grid;place-items:center;min-height:140px;overflow:auto;background:#070b12;border:1px solid #273348;border-radius:4px"><canvas data-ray-canvas style="width:100%;height:auto;image-rendering:auto"></canvas></div>
    <div><div data-ray-metrics style="white-space:pre-wrap;color:#9eb4d0"></div><details><summary>Diagnostics</summary><pre data-ray-diagnostics style="max-height:150px;overflow:auto;white-space:pre-wrap;color:#f1c27d"></pre></details></div>`;
  const query = <T extends Element>(selector: string): T => panel.querySelector<T>(selector)!;
  const mode = query<HTMLSelectElement>('[data-ray-control="mode"]');
  const effect = query<HTMLSelectElement>('[data-ray-control="effect"]');
  const quality = query<HTMLSelectElement>('[data-ray-control="quality"]');
  const view = query<HTMLSelectElement>('[data-ray-control="view"]');
  const render = query<HTMLButtonElement>('[data-ray-render]');
  const disable = query<HTMLButtonElement>('[data-ray-disable]');
  const subscription = options.owner.subscribe(snapshot => update(panel, snapshot), true);
  const configure = () => options.owner.configure({ mode: mode.value as RayTracingPreviewMode, effect: effect.value as RayTracingPreviewEffect, quality: quality.value as RayTracingPreviewQuality, view: view.value as RayTracingPreviewView });
  mode.addEventListener('change', configure); effect.addEventListener('change', configure); quality.addEventListener('change', configure); view.addEventListener('change', configure);
  render.addEventListener('click', () => { void options.owner.render(); });
  disable.addEventListener('click', () => { void options.onDisable(); });
  (options.host ?? document.body).append(panel);
  void options.owner.render();
  let active = true;
  return Object.freeze({ dispose() { if (!active) return; active = false; subscription.dispose(); panel.remove(); } });
}

function select(name: string, options: readonly (readonly [string, string])[]): string {
  return `<label style="display:grid;gap:3px;color:#8fa7c8">${name}<select data-ray-control="${name}" style="min-width:0;background:#172235;color:#dce7f8;border:1px solid #34445d;padding:4px">${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>`;
}

function update(panel: HTMLElement, snapshot: RayTracingPreviewSnapshot): void {
  const text = (selector: string, value: string) => { const node = panel.querySelector<HTMLElement>(selector); if (node) node.textContent = value; };
  panel.dataset.rayTracingStatus = snapshot.status;
  text('[data-ray-status]', snapshot.status);
  text('[data-ray-message]', snapshot.message);
  const progress = panel.querySelector<HTMLProgressElement>('[data-ray-progress]'); if (progress) progress.value = snapshot.progress;
  const button = panel.querySelector<HTMLButtonElement>('[data-ray-render]'); if (button) button.disabled = snapshot.status === 'building' || snapshot.status === 'rendering';
  const metrics = snapshot.metrics;
  text('[data-ray-metrics]', metrics ? `source ${metrics.sourceSha256.slice(0, 22)}…  ${metrics.width}×${metrics.height}\nbuild ${metrics.buildMs.toFixed(1)} ms  GPU ${metrics.gpuTimeNs === null ? 'unavailable' : `${(metrics.gpuTimeNs / 1e6).toFixed(2)} ms`}  peak ${(metrics.peakBytes / 1048576).toFixed(2)} MiB  resources ${metrics.liveResourceCount}  samples ${metrics.sampleCount}` : 'No candidate metrics.');
  text('[data-ray-diagnostics]', snapshot.diagnostics.map(value => `${value.severity.toUpperCase()} ${value.code}\n${value.message}`).join('\n\n') || 'No diagnostics.');
  if (!snapshot.pixels || !metrics) return;
  const canvas = panel.querySelector<HTMLCanvasElement>('[data-ray-canvas]'); if (!canvas) return;
  canvas.width = metrics.width; canvas.height = metrics.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(snapshot.pixels), metrics.width, metrics.height), 0, 0);
}
