import type { AnimationEditorProject } from '../../domain/AnimationEditorProject';
import {
  readParticle2DDescriptor,
  type Particle2DAuthoringEdit,
} from '../../domain/ParticleProjectAuthoring';
import type { ParticleColor, ParticlePreviewStatistics, ParticleScalarRange } from '../../domain/ParticleAuthoringTypes';

export interface ParticleInspectorAuthoringAdapterOptions {
  readonly project: () => AnimationEditorProject;
  readonly nodeId: string;
  readonly componentId: string;
  readonly onEdit: (edit: Particle2DAuthoringEdit, label: string) => void;
  readonly onSetTextureResource: (resourceId: string | null, label: string) => void;
}

/** Complete leaf Inspector for the frozen Particle2D payload. */
export class ParticleInspectorAuthoringAdapter {
  private readonly _cleanups: Array<() => void> = [];
  private readonly _statistics = document.createElement('output');
  private readonly _diagnostics = document.createElement('ul');
  private _disposed = false;

  constructor(
    readonly root: HTMLElement,
    private readonly _options: ParticleInspectorAuthoringAdapterOptions,
  ) {
    root.replaceChildren();
    root.classList.add('particle-authoring-inspector');
    const descriptor = readParticle2DDescriptor(_options.project(), _options.nodeId, _options.componentId);
    root.append(
      this._section('发射', [
        this._number('容量', 'maxParticles', descriptor.maxParticles, 1, 1, true),
        this._number('每秒发射', 'emissionRate', descriptor.emissionRate, 0, 1),
        this._number('爆发数量', 'burst', descriptor.burst ?? 0, 0, 1, true),
        this._number('发射时长（秒）', 'duration', descriptor.duration ?? _options.project().composition.duration, 0.001, 0.1),
        this._checkbox('循环', 'loop', descriptor.loop ?? true),
        this._number('随机种子', 'seed', descriptor.seed ?? 1, Number.MIN_SAFE_INTEGER, 1, true),
      ]),
      this._section('生命周期', [
        this._range('寿命（秒）', 'lifetime', descriptor.lifetime, 0.0001),
        this._range('初始尺寸', 'startSize', descriptor.startSize, 0),
        this._range('结束尺寸', 'endSize', descriptor.endSize, 0),
        this._color('初始颜色 / 不透明度', 'startColor', descriptor.startColor),
        this._color('结束颜色 / 不透明度', 'endColor', descriptor.endColor),
        this._checkbox('朝向速度方向', 'radial', descriptor.radial ?? true),
      ]),
      this._section('运动与形状', [
        this._select('形状', 'shape', descriptor.shape ?? 'point', ['point', 'box', 'circle']),
        this._vector('形状尺寸', 'shapeSize', descriptor.shapeSize ?? [0, 0], 0),
        this._number('形状半径', 'shapeRadius', descriptor.shapeRadius ?? 0, 0, 1),
        this._range('速度', 'speed', descriptor.speed, 0),
        this._range('角度（弧度）', 'angle', descriptor.angle),
        this._vector('重力', 'gravity', descriptor.gravity ?? [0, 20]),
      ]),
      this._section('纹理与混合', [
        this._texture(descriptor.resource),
        this._select('混合模式', 'blendMode', descriptor.blendMode ?? 'normal', ['normal', 'additive']),
      ]),
      this._section('Preview 诊断', [this._statistics, this._diagnostics]),
    );
    this._statistics.value = '等待 Preview 统计';
    this._statistics.setAttribute('aria-live', 'polite');
    this._diagnostics.setAttribute('aria-label', 'Particle diagnostics');
  }

  get listenerCount(): number { return this._disposed ? 0 : this._cleanups.length; }

  setStatistics(statistics: ParticlePreviewStatistics): void {
    if (this._disposed) return;
    this._statistics.value = [
      `存活 ${statistics.alive}/${statistics.capacity}`,
      `生成 ${statistics.spawned}`,
      `丢弃 ${statistics.dropped}`,
      `draw ${statistics.drawCalls}`,
      `upload ${statistics.uploadedBytes} B`,
      statistics.renderStatistics === 'gpu-runtime' ? 'GPU 实测' : '引擎状态推算',
    ].join(' · ');
    this._diagnostics.replaceChildren(...statistics.diagnostics.map(diagnostic => {
      const item = document.createElement('li');
      item.dataset.severity = diagnostic.severity;
      item.dataset.code = diagnostic.code;
      item.textContent = `${diagnostic.severity === 'error' ? '错误' : '警告'} ${diagnostic.code}: ${diagnostic.message}`;
      return item;
    }));
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const cleanup of this._cleanups.splice(0)) cleanup();
    this.root.replaceChildren();
    this.root.classList.remove('particle-authoring-inspector');
  }

  private _section(title: string, children: readonly Node[]): HTMLElement {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    fieldset.append(legend, ...children);
    return fieldset;
  }

  private _number(
    label: string,
    property: keyof Particle2DAuthoringEdit,
    value: number,
    minimum?: number,
    step = 0.01,
    integer = false,
  ): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(value);
    input.step = String(step);
    if (minimum !== undefined) input.min = String(minimum);
    return this._control(label, property, input, () => {
      const parsed = integer ? Math.trunc(input.valueAsNumber) : input.valueAsNumber;
      if (Number.isFinite(parsed)) this._commit({ [property]: parsed }, `编辑粒子${label}`);
    });
  }

  private _checkbox(label: string, property: keyof Particle2DAuthoringEdit, value: boolean): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    return this._control(label, property, input, () => this._commit({ [property]: input.checked }, `编辑粒子${label}`));
  }

  private _select(
    label: string,
    property: keyof Particle2DAuthoringEdit,
    value: string,
    values: readonly string[],
  ): HTMLElement {
    const input = document.createElement('select');
    for (const candidate of values) input.add(new Option(candidate, candidate, false, candidate === value));
    return this._control(label, property, input, () => this._commit({ [property]: input.value }, `编辑粒子${label}`));
  }

  private _range(
    label: string,
    property: keyof Particle2DAuthoringEdit,
    value: ParticleScalarRange,
    minimum?: number,
  ): HTMLElement {
    return this._numberTuple(label, property, value, minimum, '最小值', '最大值');
  }

  private _vector(
    label: string,
    property: keyof Particle2DAuthoringEdit,
    value: readonly [number, number],
    minimum?: number,
  ): HTMLElement {
    return this._numberTuple(label, property, value, minimum, 'X', 'Y');
  }

  private _numberTuple(
    label: string,
    property: keyof Particle2DAuthoringEdit,
    value: readonly [number, number],
    minimum: number | undefined,
    firstLabel: string,
    secondLabel: string,
  ): HTMLElement {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    wrapper.dataset.particleField = String(property);
    const inputs = value.map((candidate, index) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(candidate);
      input.step = '0.01';
      input.setAttribute('aria-label', `${label} ${index === 0 ? firstLabel : secondLabel}`);
      if (minimum !== undefined) input.min = String(minimum);
      this._listen(input, 'change', () => {
        const tuple = inputs.map(item => item.valueAsNumber) as [number, number];
        if (tuple.every(Number.isFinite)) this._commit({ [property]: tuple }, `编辑粒子${label}`);
      });
      return input;
    });
    wrapper.append(...inputs);
    return wrapper;
  }

  private _color(label: string, property: 'startColor' | 'endColor', value: ParticleColor): HTMLElement {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    wrapper.dataset.particleField = property;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = colorToHex(value);
    const opacity = document.createElement('input');
    opacity.type = 'number';
    opacity.min = '0';
    opacity.max = '1';
    opacity.step = '0.01';
    opacity.value = String(value[3]);
    opacity.setAttribute('aria-label', `${label} 不透明度`);
    const commit = (): void => {
      const channels = hexToColor(color.value, opacity.valueAsNumber);
      this._commit({ [property]: channels }, `编辑粒子${label}`);
    };
    this._listen(color, 'change', commit);
    this._listen(opacity, 'change', commit);
    wrapper.append(color, opacity);
    return wrapper;
  }

  private _texture(current: string | undefined): HTMLElement {
    const wrapper = document.createElement('label');
    wrapper.textContent = '纹理';
    wrapper.dataset.particleField = 'resource';
    const select = document.createElement('select');
    select.add(new Option('无纹理', '', false, current === undefined));
    for (const asset of this._options.project().assets.filter(candidate => candidate.type === 'image')) {
      select.add(new Option(asset.name, asset.id, false, asset.id === current));
    }
    this._listen(select, 'change', () => this._options.onSetTextureResource(select.value || null, '编辑粒子纹理'));
    wrapper.append(select);
    return wrapper;
  }

  private _control(
    label: string,
    property: keyof Particle2DAuthoringEdit,
    input: HTMLInputElement | HTMLSelectElement,
    commit: () => void,
  ): HTMLElement {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    wrapper.dataset.particleField = String(property);
    this._listen(input, 'change', commit);
    wrapper.append(input);
    return wrapper;
  }

  private _commit(edit: Particle2DAuthoringEdit, label: string): void {
    if (!this._disposed) this._options.onEdit(edit, label);
  }

  private _listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this._cleanups.push(() => target.removeEventListener(type, listener));
  }
}

function colorToHex(color: ParticleColor): string {
  return `#${color.slice(0, 3).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
}

function hexToColor(value: string, opacity: number): ParticleColor {
  const normalized = value.startsWith('#') ? value.slice(1) : value;
  return Object.freeze([
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
    Math.max(0, Math.min(1, opacity)),
  ]);
}
