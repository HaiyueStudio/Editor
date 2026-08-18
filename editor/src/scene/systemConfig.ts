import type { SerializedRadialShadowRenderFeature, SerializedSystem } from '../export/runtimeScene';

export function createDefaultSystemConfig(type: SerializedSystem['type']): SerializedSystem {
  if (type === 'Physics2DSystem') {
    return {
      type,
      gravity: [0, 0],
      pixelsPerMeter: 100,
      fixedTimeStep: 1 / 60,
      maxSubSteps: 5,
      velocityIterations: 8,
      positionIterations: 3,
      syncStaticBodiesFromTransform: true,
      priority: 0,
    };
  }
  return {
    type,
    loadOp: 'load',
    priority: 20,
  };
}

export function normalizeSystemConfig(config: Partial<SerializedSystem> & { type?: string }): SerializedSystem | null {
  if (config.type === 'Physics2DSystem') {
    const fallback = createDefaultSystemConfig('Physics2DSystem') as Extract<SerializedSystem, { type: 'Physics2DSystem' }>;
    const source = config as Partial<Extract<SerializedSystem, { type: 'Physics2DSystem' }>>;
    return {
      type: 'Physics2DSystem',
      gravity: [
        Number(source.gravity?.[0] ?? fallback.gravity[0]),
        Number(source.gravity?.[1] ?? fallback.gravity[1]),
      ],
      pixelsPerMeter: Math.max(0.0001, Number(source.pixelsPerMeter ?? fallback.pixelsPerMeter) || fallback.pixelsPerMeter),
      fixedTimeStep: Math.max(0.0001, Number(source.fixedTimeStep ?? fallback.fixedTimeStep) || fallback.fixedTimeStep),
      maxSubSteps: Math.max(1, Math.floor(Number(source.maxSubSteps ?? fallback.maxSubSteps) || fallback.maxSubSteps)),
      velocityIterations: Math.max(1, Math.floor(Number(source.velocityIterations ?? fallback.velocityIterations) || fallback.velocityIterations)),
      positionIterations: Math.max(1, Math.floor(Number(source.positionIterations ?? fallback.positionIterations) || fallback.positionIterations)),
      syncStaticBodiesFromTransform: Boolean(source.syncStaticBodiesFromTransform ?? fallback.syncStaticBodiesFromTransform),
      priority: Number(source.priority ?? fallback.priority) || fallback.priority,
      disabled: Boolean(config.disabled),
    };
  }
  if (config.type === 'RadialShadowRenderFeature') {
    const fallback = createDefaultSystemConfig('RadialShadowRenderFeature') as SerializedRadialShadowRenderFeature;
    const source = config as Partial<SerializedRadialShadowRenderFeature>;
    const priority = Number(source.priority ?? fallback.priority);
    return {
      type: 'RadialShadowRenderFeature',
      loadOp: source.loadOp === 'clear' ? 'clear' : fallback.loadOp,
      priority: Number.isFinite(priority) ? priority : fallback.priority,
      disabled: Boolean(config.disabled),
    };
  }
  return null;
}

export function cloneSystemConfig(config: SerializedSystem): SerializedSystem {
  return structuredClone(config);
}

export function normalizeSystemConfigs(configs?: Array<Partial<SerializedSystem> & { type?: string }>): SerializedSystem[] {
  return (configs ?? [])
    .map(normalizeSystemConfig)
    .filter((config): config is SerializedSystem => config !== null);
}

export interface RenderSystemPanelOptions {
  systemList: HTMLElement | null;
  configs: SerializedSystem[];
  formatNumber: (value: number) => string;
  onChange?: () => void;
}

export function renderSystemPanel(options: RenderSystemPanelOptions): void {
  const { systemList, configs, formatNumber, onChange } = options;
  if (!systemList) return;
  const rerender = () => renderSystemPanel(options);
  const setConfig = (index: number, config: Partial<SerializedSystem> & { type?: string }) => {
    const normalized = normalizeSystemConfig(config);
    if (!normalized) return;
    configs[index] = normalized;
    rerender();
    onChange?.();
  };

  systemList.replaceChildren();
  for (const [index, config] of configs.entries()) {
    const item = document.createElement('li');
    item.className = 'system-card';

    const title = document.createElement('div');
    title.className = 'system-card-title';
    title.textContent = config.type;
    item.append(title);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'system-card-remove';
    remove.title = 'Remove system';
    remove.textContent = 'x';
    remove.addEventListener('click', () => {
      configs.splice(index, 1);
      rerender();
      onChange?.();
    });
    item.append(remove);

    const fields = document.createElement('div');
    fields.className = 'system-card-fields';
    item.append(fields);

    addSystemBooleanField(fields, 'Disabled', Boolean(config.disabled), value => {
      setConfig(index, { ...config, disabled: value });
    });
    addSystemNumberField(fields, 'Priority', config.priority, formatNumber, value => {
      setConfig(index, { ...config, priority: value });
    });

    if (config.type === 'Physics2DSystem') {
      addSystemNumberField(fields, 'Gravity X', config.gravity[0], formatNumber, value => {
        setConfig(index, { ...config, gravity: [value, config.gravity[1]] });
      });
      addSystemNumberField(fields, 'Gravity Y', config.gravity[1], formatNumber, value => {
        setConfig(index, { ...config, gravity: [config.gravity[0], value] });
      });
      addSystemNumberField(fields, 'Pixels/M', config.pixelsPerMeter, formatNumber, value => {
        setConfig(index, { ...config, pixelsPerMeter: value });
      });
      addSystemNumberField(fields, 'Fixed Step', config.fixedTimeStep, formatNumber, value => {
        setConfig(index, { ...config, fixedTimeStep: value });
      });
      addSystemNumberField(fields, 'Sub Steps', config.maxSubSteps, formatNumber, value => {
        setConfig(index, { ...config, maxSubSteps: value });
      });
      addSystemNumberField(fields, 'Velocity It.', config.velocityIterations, formatNumber, value => {
        setConfig(index, { ...config, velocityIterations: value });
      });
      addSystemNumberField(fields, 'Position It.', config.positionIterations, formatNumber, value => {
        setConfig(index, { ...config, positionIterations: value });
      });
      addSystemBooleanField(fields, 'Sync Static', config.syncStaticBodiesFromTransform, value => {
        setConfig(index, { ...config, syncStaticBodiesFromTransform: value });
      });
    } else {
      addSystemSelectField(fields, 'Load Op', config.loadOp, ['load', 'clear'], value => {
        setConfig(index, { ...config, loadOp: value as 'load' | 'clear' });
      });
    }

    systemList.append(item);
  }
}

function addSystemNumberField(
  parent: HTMLElement,
  label: string,
  value: number,
  formatNumber: (value: number) => string,
  onCommit: (value: number) => void,
): void {
  const row = createSystemField(label);
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.value = formatNumber(value);
  input.addEventListener('change', () => onCommit(Number(input.value)));
  row.append(input);
  parent.append(row);
}

function addSystemBooleanField(parent: HTMLElement, label: string, value: boolean, onCommit: (value: boolean) => void): void {
  const row = createSystemField(label);
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onCommit(input.checked));
  row.append(input);
  parent.append(row);
}

function addSystemSelectField(parent: HTMLElement, label: string, value: string, options: string[], onCommit: (value: string) => void): void {
  const row = createSystemField(label);
  const select = document.createElement('select');
  for (const optionValue of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionValue;
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => onCommit(select.value));
  row.append(select);
  parent.append(row);
}

function createSystemField(label: string): HTMLElement {
  const row = document.createElement('label');
  row.className = 'system-card-field';
  const text = document.createElement('span');
  text.textContent = label;
  row.append(text);
  return row;
}
