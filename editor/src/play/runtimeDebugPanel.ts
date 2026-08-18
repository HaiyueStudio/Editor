import type { RenderDomainDiagnosticsSnapshot } from '../domain/diagnostics/RenderDomainDiagnostics';

export interface RuntimeComponentSnapshot {
  id: number;
  name?: string;
  type?: string;
  disabled?: boolean;
  destroyed?: boolean;
  fields?: RuntimeInspectorFieldSnapshot[];
}

export interface RuntimeEntitySnapshot {
  id: number;
  name?: string;
  disabled?: boolean;
  fields?: RuntimeInspectorFieldSnapshot[];
}

export interface RuntimeInspectorSnapshot {
  entity: RuntimeEntitySnapshot;
  components: RuntimeComponentSnapshot[];
}

export type RuntimeInspectorFieldType = 'boolean' | 'json' | 'number' | 'select' | 'string';

export interface RuntimeInspectorFieldSnapshot {
  path: string;
  label: string;
  type: RuntimeInspectorFieldType;
  value: unknown;
  options?: { label: string; value: string }[];
}

export interface RuntimeInspectorFieldEdit {
  entityId: number;
  componentId?: number;
  path: string;
  value: unknown;
}

export interface RuntimePerformanceSnapshot {
  fps?: number;
  frameMs?: number;
  entityCount?: number;
  systemCount?: number;
  width?: number;
  height?: number;
  dpr?: number;
  breakpointCount?: number;
  diagnostics?: RuntimeDiagnosticSnapshot;
}

export interface RuntimeDiagnosticSnapshot {
  frame?: {
    frame?: number;
    cpuMs?: Record<string, number>;
    counters?: Record<string, number>;
    gpuMs?: number;
    gpu?: {
      frame?: number;
      totalMs?: number;
      truncated?: boolean;
      passes?: Array<{ index?: number; type?: 'render' | 'compute'; label?: string; durationMs?: number }>;
    };
  };
  pipeline?: { passCount?: number; entries?: unknown[]; issues?: unknown[] };
  resources?: { resources?: unknown[]; caches?: Array<{ hits?: number; misses?: number }>; releasedOwnerResiduals?: number };
  assets?: { records?: Array<{ refs?: number; state?: string }> };
  device?: { state?: string; timestampQuery?: boolean; format?: string };
  renderDomains?: RenderDomainDiagnosticsSnapshot;
}

export interface RuntimeDebugPanelElements {
  inspector: HTMLElement | null;
  performance: HTMLElement | null;
  breakpointInput: HTMLTextAreaElement | null;
  breakpointApplyButton: HTMLButtonElement | null;
  breakpointStatus: HTMLElement | null;
  diagnosticExportButton: HTMLButtonElement | null;
}

export class RuntimeDebugPanel {
  private _breakpoints: string[] = [];
  private _onBreakpointsChange: ((breakpoints: string[]) => void) | null = null;
  private _onFieldEdit: ((edit: RuntimeInspectorFieldEdit) => void) | null = null;
  private _lastDiagnostic: RuntimeDiagnosticSnapshot | null = null;

  constructor(private readonly _elements: RuntimeDebugPanelElements) {
    this._elements.breakpointApplyButton?.addEventListener('click', () => this.applyBreakpoints());
    this._elements.breakpointInput?.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        this.applyBreakpoints();
      }
    });
    this._elements.diagnosticExportButton?.addEventListener('click', () => this.exportDiagnosticSnapshot());
    this.clear();
  }

  setBreakpointsChangeHandler(handler: (breakpoints: string[]) => void): void {
    this._onBreakpointsChange = handler;
  }

  setFieldEditHandler(handler: (edit: RuntimeInspectorFieldEdit) => void): void {
    this._onFieldEdit = handler;
  }

  renderBreakpointHit(details: { breakpoint?: string; entity?: { id?: number; name?: string }; script?: { id?: number; name?: string }; lifecycle?: string }): void {
    const target = details.entity?.name ?? details.entity?.id ?? 'entity';
    const script = details.script?.name ?? details.script?.id ?? 'script';
    this._setBreakpointStatus(`Paused at ${details.breakpoint ?? `${script}:${details.lifecycle ?? ''}`} (${target})`);
  }

  get breakpoints(): string[] {
    return this._breakpoints;
  }

  clear(): void {
    this._lastDiagnostic = null;
    this.renderInspector(null);
    this.renderPerformance(null);
    this._setBreakpointStatus(this._breakpoints.length ? `${this._breakpoints.length} breakpoint(s)` : 'No breakpoints');
  }

  applyBreakpoints(): void {
    const input = this._elements.breakpointInput;
    const next = (input?.value ?? '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    this._breakpoints = next;
    this._setBreakpointStatus(next.length ? `${next.length} breakpoint(s) applied` : 'No breakpoints');
    this._onBreakpointsChange?.([...next]);
  }

  renderInspector(snapshot: RuntimeInspectorSnapshot | null): void {
    const container = this._elements.inspector;
    if (!container) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && container.contains(active) && active.dataset.runtimeInspectorField === 'true') return;
    container.replaceChildren();
    if (!snapshot) {
      container.append(createEmpty('No runtime entity selected.'));
      return;
    }

    const entity = document.createElement('div');
    entity.className = 'play-debug-entity';
    const title = document.createElement('strong');
    title.textContent = snapshot.entity.name || 'Entity';
    const meta = document.createElement('small');
    meta.textContent = `id=${snapshot.entity.id}${snapshot.entity.disabled ? ' disabled' : ''}`;
    entity.append(title, meta);
    entity.append(createFields(snapshot.entity.fields ?? [], snapshot.entity.id, undefined, this._onFieldEdit));
    container.append(entity);

    if (!snapshot.components.length) {
      container.append(createEmpty('No components.'));
      return;
    }
    for (const component of snapshot.components) {
      const item = document.createElement('div');
      item.className = `play-debug-component${component.disabled ? ' disabled' : ''}`;
      const name = document.createElement('div');
      name.textContent = component.name || component.type || 'Component';
      const meta = document.createElement('small');
      meta.textContent = [
        `id=${component.id}`,
        component.type ? `type=${component.type}` : '',
        component.disabled ? 'disabled' : '',
        component.destroyed ? 'destroyed' : '',
      ].filter(Boolean).join(' ');
      item.append(name, meta);
      item.append(createFields(component.fields ?? [], snapshot.entity.id, component.id, this._onFieldEdit));
      container.append(item);
    }
  }

  renderPerformance(snapshot: RuntimePerformanceSnapshot | null): void {
    const container = this._elements.performance;
    if (!container) return;
    container.replaceChildren();
    if (!snapshot) {
      container.append(createEmpty('Waiting for runtime metrics.'));
      return;
    }
    this._lastDiagnostic = snapshot.diagnostics ?? null;

    const diagnostic = snapshot.diagnostics;
    const counters = diagnostic?.frame?.counters;
    const cpu = diagnostic?.frame?.cpuMs;
    const resourceCount = diagnostic?.resources?.resources?.length;
    const assetRefs = diagnostic?.assets?.records?.reduce((sum, record) => sum + (record.refs ?? 0), 0);
    const cacheTotals = diagnostic?.resources?.caches?.reduce<{ hits: number; misses: number }>((total, cache) => ({
      hits: total.hits + (cache.hits ?? 0),
      misses: total.misses + (cache.misses ?? 0),
    }), { hits: 0, misses: 0 });
    const slowestGpuPass = diagnostic?.frame?.gpu?.passes?.reduce<{
      label?: string;
      durationMs?: number;
    } | null>((slowest, pass) => (
      slowest === null || (pass.durationMs ?? 0) > (slowest.durationMs ?? 0) ? pass : slowest
    ), null);

    const grid = document.createElement('div');
    grid.className = 'play-debug-metrics';
    grid.append(
      createMetric('FPS', formatNumber(snapshot.fps, 1)),
      createMetric('Frame', `${formatNumber(snapshot.frameMs, 2)} ms`),
      createMetric('Entities', formatInteger(snapshot.entityCount)),
      createMetric('Systems', formatInteger(snapshot.systemCount)),
      createMetric('Canvas', snapshot.width && snapshot.height ? `${snapshot.width} x ${snapshot.height}` : '-'),
      createMetric('DPR', formatNumber(snapshot.dpr, 2)),
      createMetric('Breakpoints', formatInteger(snapshot.breakpointCount)),
      createMetric('Frame ID', formatInteger(diagnostic?.frame?.frame)),
      createMetric('Passes', formatInteger(diagnostic?.pipeline?.passCount)),
      createMetric('Draw / Dispatch', `${formatInteger(counters?.draws)} / ${formatInteger(counters?.dispatches)}`),
      createMetric('Record / Submit', `${formatNumber(cpu?.record, 2)} / ${formatNumber(cpu?.submit, 2)} ms`),
      createMetric('GPU', diagnostic?.frame?.gpuMs === undefined ? 'unsupported' : `${formatNumber(diagnostic.frame.gpuMs, 2)} ms`),
      createMetric(
        'Slowest GPU pass',
        slowestGpuPass
          ? `${slowestGpuPass.label ?? 'pass'} · ${formatNumber(slowestGpuPass.durationMs, 2)} ms`
          : '-',
      ),
      createMetric('Resources', formatInteger(resourceCount)),
      createMetric('Asset refs', formatInteger(assetRefs)),
      createMetric('Cache hit rate', formatRatio(cacheTotals?.hits, cacheTotals?.misses)),
      createMetric('Device', diagnostic?.device?.state ?? '-'),
      createMetric('Pipeline issues', formatInteger(diagnostic?.pipeline?.issues?.length)),
      createMetric('Owner residuals', formatInteger(diagnostic?.resources?.releasedOwnerResiduals)),
    );
    container.append(grid);
    if (diagnostic?.renderDomains) container.append(...createRenderDomainSections(diagnostic.renderDomains));
  }

  exportDiagnosticSnapshot(): void {
    if (!this._lastDiagnostic) return;
    const blob = new Blob([JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      diagnostics: this._lastDiagnostic,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `haiyue-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private _setBreakpointStatus(text: string): void {
    if (this._elements.breakpointStatus) this._elements.breakpointStatus.textContent = text;
  }
}

function createRenderDomainSections(snapshot: RenderDomainDiagnosticsSnapshot): HTMLElement[] {
  const lighting = snapshot.lighting;
  const shadows = snapshot.shadows;
  const ao = snapshot.ambientOcclusion;
  const variants = snapshot.shaderVariants;
  const resources = snapshot.gpuResources;
  return [
    createMetricSection('Lighting', [
      ['Active / authored', `${lighting.active} / ${lighting.total}`],
      ['Forward capacity', `${lighting.capacity}${lighting.clipped ? ` · ${lighting.clipped} clipped` : ''}`],
      ['Types', Object.entries(lighting.byType).map(([type, count]) => `${type}:${count}`).join(' · ') || '-'],
    ]),
    createMetricSection('Shadows', [
      ['Casters / capacity', `${shadows.requestedCasters} / ${shadows.capacity}`],
      ['Passes / GPU', `${shadows.passCount} / ${formatOptionalMs(shadows.gpuMs)}`],
      ['GPU resources', `${shadows.resourceCount} · ${formatBytes(shadows.estimatedBytes)}`],
    ]),
    createMetricSection('Ambient occlusion', [
      ['State', ao.active ? ao.algorithms.join(', ').toUpperCase() || 'active' : 'disabled'],
      ['Passes / GPU', `${ao.passCount} / ${formatOptionalMs(ao.gpuMs)}`],
      ['GPU resources', `${ao.resourceCount} · ${formatBytes(ao.estimatedBytes)}`],
    ]),
    createMetricSection('Shader variants', [
      ['Live pipelines', formatInteger(variants.livePipelines)],
      ['Cache entries', formatInteger(variants.cacheEntries)],
      ['Hit rate / switches', `${(variants.cacheHitRate * 100).toFixed(1)}% / ${variants.frameSwitches}`],
    ]),
    createMetricSection('GPU resources', [
      ['Objects / bytes', `${resources.total} / ${formatBytes(resources.estimatedBytes)}`],
      ['Top owners', resources.topOwners.map(owner => `${owner.label}:${formatBytes(owner.estimatedBytes)}`).join(' · ') || '-'],
      ['Released residuals', formatInteger(resources.releasedOwnerResiduals)],
    ]),
  ];
}

function createMetricSection(title: string, metrics: readonly (readonly [string, string])[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'play-debug-domain';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'play-debug-metrics';
  for (const [label, value] of metrics) grid.append(createMetric(label, value));
  section.append(heading, grid);
  return section;
}

function formatOptionalMs(value: number | undefined): string {
  return value === undefined ? 'unavailable' : `${formatNumber(value, 2)} ms`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function createEmpty(text: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'play-debug-empty';
  empty.textContent = text;
  return empty;
}

function createMetric(label: string, value: string): HTMLElement {
  const metric = document.createElement('div');
  metric.className = 'play-debug-metric';
  const labelElement = document.createElement('small');
  labelElement.textContent = label;
  const valueElement = document.createElement('strong');
  valueElement.textContent = value;
  metric.append(labelElement, valueElement);
  return metric;
}

function createFields(
  fields: RuntimeInspectorFieldSnapshot[],
  entityId: number,
  componentId: number | undefined,
  onEdit: ((edit: RuntimeInspectorFieldEdit) => void) | null,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'play-debug-fields';
  for (const field of fields) {
    const row = document.createElement('label');
    row.className = 'play-debug-field';
    const label = document.createElement('span');
    label.textContent = field.label;
    const input = createFieldInput(field);
    input.dataset.runtimeInspectorField = 'true';
    input.addEventListener('change', () => {
      const parsed = readFieldInputValue(field, input);
      if (parsed.ok) {
        input.classList.remove('invalid');
        onEdit?.({
          entityId,
          ...(componentId === undefined ? {} : { componentId }),
          path: field.path,
          value: parsed.value,
        });
      } else {
        input.classList.add('invalid');
      }
    });
    row.append(label, input);
    list.append(row);
  }
  return list;
}

function createFieldInput(field: RuntimeInspectorFieldSnapshot): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (field.type === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(field.value);
    return input;
  }
  if (field.type === 'select') {
    const select = document.createElement('select');
    for (const option of field.options ?? []) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      select.append(item);
    }
    select.value = String(field.value ?? '');
    return select;
  }
  if (field.type === 'json') {
    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.spellcheck = false;
    textarea.value = JSON.stringify(field.value ?? {}, null, 2);
    return textarea;
  }
  const input = document.createElement('input');
  input.type = field.type === 'number' ? 'number' : 'text';
  if (field.type === 'number') input.step = 'any';
  input.value = field.value == null ? '' : String(field.value);
  return input;
}

function readFieldInputValue(
  field: RuntimeInspectorFieldSnapshot,
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): { ok: true; value: unknown } | { ok: false } {
  if (field.type === 'boolean' && input instanceof HTMLInputElement) return { ok: true, value: input.checked };
  if (field.type === 'number') {
    const value = Number(input.value);
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (field.type === 'json') {
    try {
      return { ok: true, value: JSON.parse(input.value) };
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, value: input.value };
}

function formatNumber(value: number | undefined, fractionDigits: number): string {
  return Number.isFinite(value) ? value!.toFixed(fractionDigits) : '-';
}

function formatRatio(hits: number | undefined, misses: number | undefined): string {
  const total = (hits ?? 0) + (misses ?? 0);
  return total > 0 ? `${(((hits ?? 0) / total) * 100).toFixed(1)}%` : '-';
}

function formatInteger(value: number | undefined): string {
  return Number.isFinite(value) ? String(Math.trunc(value!)) : '-';
}
