export type EditorAppSupportTier = 'stable' | 'extended' | 'experimental';

export interface EditorAppBudget {
  readonly maxRawBytes: number;
  readonly maxGzipBytes: number;
}

export interface EditorPwaDescriptor {
  readonly enabled: boolean;
  readonly shortName: string;
  readonly description: string;
  readonly themeColor: string;
  readonly backgroundColor: string;
  readonly icons?: readonly Readonly<{ src: string; sizes: string; type: string; purpose?: string }>[];
}

export interface EditorElectronDescriptor {
  readonly enabled: boolean;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly backgroundColor: string;
}

export interface EditorAppDescriptor {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly productName: string;
  readonly appId: string;
  readonly artifactName: string;
  readonly storageNamespace: string;
  readonly supportTier: EditorAppSupportTier;
  readonly entries: readonly string[];
  readonly staticFiles: readonly string[];
  readonly workers: readonly string[];
  readonly distDirectory: string;
  readonly outputDirectory: string;
  readonly electronRendererDirectory: string;
  readonly budget: EditorAppBudget;
  readonly pwa: EditorPwaDescriptor;
  readonly electron: EditorElectronDescriptor;
}

export function validateEditorAppDescriptor(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return Object.freeze(['descriptor must be an object']);
  const descriptor = value as Partial<EditorAppDescriptor>;
  if (descriptor.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  for (const key of ['id', 'version', 'productName', 'appId', 'artifactName', 'storageNamespace'] as const) {
    if (typeof descriptor[key] !== 'string' || !descriptor[key]?.trim()) errors.push(`${key} is required`);
  }
  if (!['stable', 'extended', 'experimental'].includes(descriptor.supportTier ?? '')) errors.push('supportTier is invalid');
  for (const key of ['entries', 'staticFiles', 'workers'] as const) {
    if (!Array.isArray(descriptor[key])) errors.push(`${key} must be an array`);
  }
  for (const key of ['distDirectory', 'outputDirectory', 'electronRendererDirectory'] as const) {
    const path = descriptor[key];
    if (typeof path !== 'string' || !isSafeRelativePath(path)) errors.push(`${key} must be a safe relative path`);
  }
  for (const path of [...(descriptor.entries ?? []), ...(descriptor.staticFiles ?? []), ...(descriptor.workers ?? [])]) {
    if (!isSafeRelativePath(path)) errors.push(`unsafe descriptor path: ${path}`);
  }
  if (!descriptor.budget || !positive(descriptor.budget.maxRawBytes) || !positive(descriptor.budget.maxGzipBytes)) {
    errors.push('budget must contain positive maxRawBytes and maxGzipBytes');
  }
  if (!descriptor.pwa || typeof descriptor.pwa.enabled !== 'boolean') errors.push('pwa descriptor is required');
  if (!descriptor.electron || typeof descriptor.electron.enabled !== 'boolean') errors.push('electron descriptor is required');
  return Object.freeze(errors);
}

export function defineEditorAppDescriptor(descriptor: EditorAppDescriptor): EditorAppDescriptor {
  const errors = validateEditorAppDescriptor(descriptor);
  if (errors.length > 0) throw new TypeError(`Invalid Editor app descriptor:\n- ${errors.join('\n- ')}`);
  return Object.freeze({
    ...descriptor,
    entries: Object.freeze([...descriptor.entries]),
    staticFiles: Object.freeze([...descriptor.staticFiles]),
    workers: Object.freeze([...descriptor.workers]),
    budget: Object.freeze({ ...descriptor.budget }),
    pwa: Object.freeze({ ...descriptor.pwa, icons: Object.freeze([...(descriptor.pwa.icons ?? [])]) }),
    electron: Object.freeze({ ...descriptor.electron }),
  });
}

function isSafeRelativePath(path: string): boolean {
  return Boolean(path) && !path.startsWith('/') && !path.startsWith('\\') && !/^[a-z]:/i.test(path)
    && !path.split(/[\\/]/).includes('..');
}

function positive(value: unknown): boolean { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
