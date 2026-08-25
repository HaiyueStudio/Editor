import { parseAnimation, type ParsedAnimation } from '@haiyue/animation-spec';
import type { OfflineConversionDiagnostic } from '@haiyue/animation-spec/conversion';
import { createDeformableMesh2DFormatRegistry } from '@haiyue/animation-spec/deformable2d';
import type { CubismClipBakedRecipe } from '@haiyue/animation-spec/live2d/clip-baked';
import type { CompositionDiagnostic } from '../../domain/ReusableComposition';

export interface Live2DClipRecipe extends Pick<CubismClipBakedRecipe, 'id' | 'motion' | 'expression' | 'physics' | 'pose' | 'start' | 'duration' | 'runtimeInputs'> {
  readonly frameRate: number;
  readonly tolerance: number;
  readonly quantizationStep: number;
  readonly mode: 'normal' | 'strict';
}

export interface Live2DSourceFile { readonly path: string; readonly bytes: Uint8Array; }

export interface Live2DSourceDependency {
  readonly path: string;
  readonly kind: 'model' | 'texture' | 'motion' | 'expression' | 'physics' | 'pose' | 'metadata' | 'other';
  readonly status: 'available' | 'missing' | 'moved';
  readonly resolvedPath?: string;
}

export interface Live2DSourceInspection {
  readonly modelName: string;
  readonly core: Readonly<{ readonly available: boolean; readonly version?: string; readonly message?: string }>;
  readonly motions: readonly string[];
  readonly expressions: readonly string[];
  readonly physicsAvailable: boolean;
  readonly poseAvailable: boolean;
  readonly dependencies: readonly Live2DSourceDependency[];
  readonly diagnostics: readonly OfflineConversionDiagnostic[];
}

export interface Live2DImportLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxSidecars: number;
  readonly maxOutputBytes: number;
}

export const DEFAULT_LIVE2D_IMPORT_LIMITS: Live2DImportLimits = Object.freeze({
  maxFiles: 4096,
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxSidecars: 4096,
  maxOutputBytes: 1024 * 1024 * 1024,
});

export interface Live2DImportRequest {
  readonly assetId?: string;
  readonly entry: string;
  readonly files: readonly Live2DSourceFile[];
  readonly recipe: Live2DClipRecipe;
  readonly coreVersion: string;
  readonly signal?: AbortSignal;
}

export interface Live2DConversionOutput {
  readonly hya: Uint8Array;
  readonly sidecars: readonly Readonly<{ readonly path: string; readonly bytes: Uint8Array; readonly mimeType: string }>[];
  readonly diagnostics: readonly OfflineConversionDiagnostic[];
  readonly sourceVersion: string;
  readonly evaluatorVersion: string;
}

export interface Live2DConversionPort {
  readonly id: string;
  readonly version: string;
  inspect?(
    request: Readonly<{ readonly entry: string; readonly files: readonly Live2DSourceFile[] }>,
    context: Readonly<{ readonly signal: AbortSignal }>,
  ): Promise<Live2DSourceInspection>;
  convert(
    request: Readonly<{ readonly entry: string; readonly files: readonly Live2DSourceFile[]; readonly recipe: Live2DClipRecipe; readonly coreVersion: string }>,
    context: Readonly<{ readonly signal: AbortSignal; readonly progress: (completed: number, total: number, stage: string) => void }>,
  ): Promise<Live2DConversionOutput>;
}

export interface Live2DDerivedAsset {
  readonly id: string;
  readonly kind: 'live2d-clip-baked-hya';
  readonly entry: string;
  readonly recipe: Live2DClipRecipe;
  readonly sourceHash: string;
  readonly recipeHash: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly coreVersion: string;
  readonly sourceVersion: string;
  readonly evaluatorVersion: string;
  readonly hya: Uint8Array;
  readonly sidecars: readonly Readonly<{ readonly path: string; readonly bytes: Uint8Array; readonly mimeType: string }>[];
  readonly diagnostics: readonly CompositionDiagnostic[];
  readonly preview: ParsedAnimation;
}

export interface Live2DImportProgress { readonly generation: number; readonly completed: number; readonly total: number; readonly stage: string; }

export class Live2DImportError extends Error {
  readonly name = 'Live2DImportError';
  constructor(
    readonly code:
      | 'E_LIVE2D_ABORTED'
      | 'E_LIVE2D_INVALID_SOURCE'
      | 'E_LIVE2D_DEPENDENCY_MISSING'
      | 'E_LIVE2D_CORE_UNAVAILABLE'
      | 'E_LIVE2D_PARAMETERIZED_UNSUPPORTED'
      | 'E_LIVE2D_STRICT_DIAGNOSTIC'
      | 'E_LIVE2D_CONVERSION_FAILED'
      | 'E_LIVE2D_INVALID_OUTPUT',
    message: string,
    readonly diagnostics: readonly CompositionDiagnostic[] = [],
  ) { super(message); }
}

/** Latest-wins owner. Conversion is injected, so Core and source parsing remain outside Editor's default closure. */
export class Live2DImportWorkflow {
  #generation = 0;
  #active: AbortController | null = null;
  #closed = false;
  readonly #progressListeners = new Set<(progress: Live2DImportProgress) => void>();

  constructor(
    private readonly converter: Live2DConversionPort,
    onProgress?: (progress: Live2DImportProgress) => void,
    private readonly limits: Live2DImportLimits = DEFAULT_LIVE2D_IMPORT_LIMITS,
  ) { if (onProgress) this.#progressListeners.add(onProgress); }

  get adapter(): Readonly<Pick<Live2DConversionPort, 'id' | 'version'>> {
    return Object.freeze({ id: this.converter.id, version: this.converter.version });
  }

  subscribeProgress(listener: (progress: Live2DImportProgress) => void): () => void {
    if (this.#closed) throw aborted('Live2D import workflow is closed.');
    this.#progressListeners.add(listener);
    return () => this.#progressListeners.delete(listener);
  }

  async inspect(entry: string, files: readonly Live2DSourceFile[], signal?: AbortSignal): Promise<Live2DSourceInspection | null> {
    if (this.#closed) throw aborted('Live2D import workflow is closed.');
    validateSourceSet(entry, files, this.limits);
    if (!this.converter.inspect) return null;
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const inspection = await this.converter.inspect({ entry, files }, { signal: controller.signal });
      throwIfAborted(controller.signal);
      return validateInspection(inspection);
    } catch (error) {
      if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') throw aborted('Live2D source inspection was cancelled.');
      if (error instanceof Live2DImportError) throw error;
      throw new Live2DImportError('E_LIVE2D_CONVERSION_FAILED', error instanceof Error ? error.message : 'Live2D source inspection failed.');
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  async convert(request: Live2DImportRequest, commit?: (asset: Live2DDerivedAsset) => void): Promise<Live2DDerivedAsset> {
    if (this.#closed) throw aborted('Live2D import workflow is closed.');
    this.cancel();
    validateRequest(request, this.limits);
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#active = controller;
    const abortFromCaller = (): void => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) abortFromCaller();
    else request.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const sourceHash = await hashSourceSet(request.files, controller.signal);
      const recipeHash = await sha256(new TextEncoder().encode(stableJson(request.recipe)));
      throwIfAborted(controller.signal);
      this.#emitProgress({ generation, completed: 0, total: 1, stage: 'convert' });
      const output = await this.converter.convert({ entry: request.entry, files: request.files, recipe: request.recipe, coreVersion: request.coreVersion }, {
        signal: controller.signal,
        progress: (completed, total, stage) => {
          if (!controller.signal.aborted && this.#active === controller) this.#emitProgress({ generation, completed, total, stage });
        },
      });
      throwIfAborted(controller.signal);
      if (this.#active !== controller || generation !== this.#generation) throw aborted('A newer Live2D import superseded this result.');
      validateConversionOutput(output, this.limits);
      const diagnostics = Object.freeze(output.diagnostics.map(item => Object.freeze({
        ...item,
        risk: (/UNSUPPORTED|UNBAKED|MISSING/iu.test(item.code) ? 'unsupported' : 'fidelity') as 'unsupported' | 'fidelity',
        ...(request.assetId ? { sourceId: request.assetId } : {}),
      })));
      if (diagnostics.some(item => item.severity === 'error')) throw new Live2DImportError('E_LIVE2D_CONVERSION_FAILED', 'Live2D conversion reported an error diagnostic.', diagnostics);
      if (request.recipe.mode === 'strict' && diagnostics.length > 0) throw new Live2DImportError('E_LIVE2D_STRICT_DIAGNOSTIC', 'Strict Live2D import rejected conversion diagnostics.', diagnostics);
      const hya = new Uint8Array(output.hya);
      let preview: ParsedAnimation;
      try { preview = parseAnimation(exactBuffer(hya), { extensions: createDeformableMesh2DFormatRegistry() }); }
      catch (error) { throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', error instanceof Error ? error.message : 'Converter returned invalid HYA.'); }
      validateOutputSidecars(preview, output.sidecars);
      const id = request.assetId?.trim() || `live2d:${sourceHash.slice('sha256-'.length, 23)}`;
      const asset: Live2DDerivedAsset = deepFreeze({
        id, kind: 'live2d-clip-baked-hya', entry: request.entry, recipe: structuredClone(request.recipe), sourceHash, recipeHash,
        adapterId: this.converter.id, adapterVersion: this.converter.version, coreVersion: request.coreVersion,
        sourceVersion: output.sourceVersion, evaluatorVersion: output.evaluatorVersion, hya,
        sidecars: output.sidecars.map(sidecar => ({ ...sidecar, bytes: new Uint8Array(sidecar.bytes) })), diagnostics, preview,
      });
      commit?.(asset);
      this.#emitProgress({ generation, completed: 1, total: 1, stage: 'complete' });
      return asset;
    } catch (error) {
      if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') throw aborted('Live2D import was cancelled.');
      if (error instanceof Live2DImportError) throw error;
      throw new Live2DImportError('E_LIVE2D_CONVERSION_FAILED', error instanceof Error ? error.message : 'Live2D conversion failed.');
    } finally {
      request.signal?.removeEventListener('abort', abortFromCaller);
      if (this.#active === controller) this.#active = null;
    }
  }

  cancel(): void { this.#active?.abort('cancelled'); this.#active = null; }
  close(): void { this.#closed = true; this.cancel(); this.#progressListeners.clear(); }
  #emitProgress(progress: Live2DImportProgress): void { for (const listener of this.#progressListeners) listener(Object.freeze(progress)); }
}

export async function inspectLive2DAssetStaleness(asset: Live2DDerivedAsset, request: Live2DImportRequest, converter: Pick<Live2DConversionPort, 'id' | 'version'>): Promise<Readonly<{ readonly stale: boolean; readonly reasons: readonly string[] }>> {
  validateRequest(request, DEFAULT_LIVE2D_IMPORT_LIMITS);
  const [sourceHash, recipeHash] = await Promise.all([hashSourceSet(request.files), sha256(new TextEncoder().encode(stableJson(request.recipe)))]);
  const reasons = [
    ...(asset.sourceHash === sourceHash ? [] : ['source-hash']),
    ...(asset.recipeHash === recipeHash ? [] : ['recipe']),
    ...(asset.adapterId === converter.id && asset.adapterVersion === converter.version ? [] : ['adapter-version']),
    ...(asset.coreVersion === request.coreVersion ? [] : ['core-version']),
  ];
  return Object.freeze({ stale: reasons.length > 0, reasons: Object.freeze(reasons) });
}

export function createLive2DDeliveryFiles(asset: Live2DDerivedAsset): readonly Readonly<{ readonly path: string; readonly bytes: Uint8Array; readonly mimeType: string }>[] {
  const files = [
    { path: 'model.hya', bytes: new Uint8Array(asset.hya), mimeType: 'application/vnd.haiyue.animation' },
    ...[...asset.sidecars].sort((left, right) => left.path.localeCompare(right.path)).map(sidecar => ({ ...sidecar, bytes: new Uint8Array(sidecar.bytes) })),
  ];
  for (const file of files) {
    validateDeliveryPath(file.path, file.mimeType);
  }
  return Object.freeze(files);
}

export function serializeLive2DDerivedAsset(asset: Live2DDerivedAsset): string {
  return `${stableJson({
    format: 'haiyue-live2d-derived-asset@1', version: 1, id: asset.id, kind: asset.kind, entry: asset.entry,
    recipe: asset.recipe, sourceHash: asset.sourceHash, recipeHash: asset.recipeHash, adapterId: asset.adapterId,
    adapterVersion: asset.adapterVersion, coreVersion: asset.coreVersion, sourceVersion: asset.sourceVersion,
    evaluatorVersion: asset.evaluatorVersion, hya: base64Encode(asset.hya), diagnostics: asset.diagnostics,
    sidecars: asset.sidecars.map(sidecar => ({ path: sidecar.path, mimeType: sidecar.mimeType, bytes: base64Encode(sidecar.bytes) })),
  })}\n`;
}

export function parseLive2DDerivedAsset(source: string): Live2DDerivedAsset {
  let value: Record<string, unknown>;
  try { value = JSON.parse(source) as Record<string, unknown>; }
  catch (error) { throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', error instanceof Error ? error.message : 'Invalid derived asset JSON.'); }
  if (value.format !== 'haiyue-live2d-derived-asset@1' || value.version !== 1 || value.kind !== 'live2d-clip-baked-hya'
    || typeof value.id !== 'string' || typeof value.entry !== 'string' || typeof value.hya !== 'string' || !Array.isArray(value.sidecars)
    || !Array.isArray(value.diagnostics) || !value.recipe || typeof value.recipe !== 'object') {
    throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'Derived Live2D asset record is invalid.');
  }
  const hya = base64Decode(value.hya);
  let preview: ParsedAnimation;
  try { preview = parseAnimation(exactBuffer(hya), { extensions: createDeformableMesh2DFormatRegistry() }); }
  catch (error) { throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', error instanceof Error ? error.message : 'Saved HYA is invalid.'); }
  const text = (key: string): string => typeof value[key] === 'string' ? value[key] as string : '';
  if (['sourceHash', 'recipeHash', 'adapterId', 'adapterVersion', 'coreVersion', 'sourceVersion', 'evaluatorVersion'].some(key => !text(key))) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'Derived asset provenance is incomplete.');
  if (!value.id.trim()) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'Derived asset identity is empty.');
  const recipe = structuredClone(value.recipe) as unknown as Live2DClipRecipe;
  try {
    normalizeRelativePath(value.entry, 'saved entry');
    validateRecipe(recipe);
  } catch (error) {
    throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', error instanceof Error ? error.message : 'Saved recipe or entry is invalid.');
  }
  const diagnostics = value.diagnostics.map((diagnostic, index) => {
    if (!diagnostic || typeof diagnostic !== 'object') throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Invalid diagnostic at index ${index}.`);
    const record = diagnostic as Record<string, unknown>;
    if (!['info', 'warning', 'error'].includes(String(record.severity)) || typeof record.code !== 'string' || !record.code
      || typeof record.path !== 'string' || typeof record.message !== 'string') {
      throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Invalid diagnostic at index ${index}.`);
    }
    return structuredClone(diagnostic) as CompositionDiagnostic;
  });
  const sidecars = value.sidecars.map((sidecar, index) => {
    if (!sidecar || typeof sidecar !== 'object') throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Invalid sidecar at index ${index}.`);
    const record = sidecar as Record<string, unknown>;
    if (typeof record.path !== 'string' || typeof record.mimeType !== 'string' || typeof record.bytes !== 'string') throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Invalid sidecar at index ${index}.`);
    const decoded = { path: record.path, mimeType: record.mimeType, bytes: base64Decode(record.bytes) };
    validateDeliveryPath(decoded.path, decoded.mimeType);
    return decoded;
  });
  validateConversionOutput({
    hya, sidecars, diagnostics: [], sourceVersion: text('sourceVersion'), evaluatorVersion: text('evaluatorVersion'),
  }, DEFAULT_LIVE2D_IMPORT_LIMITS);
  validateOutputSidecars(preview, sidecars);
  return deepFreeze({
    id: value.id, kind: value.kind, entry: value.entry, recipe,
    sourceHash: text('sourceHash'), recipeHash: text('recipeHash'), adapterId: text('adapterId'), adapterVersion: text('adapterVersion'),
    coreVersion: text('coreVersion'), sourceVersion: text('sourceVersion'), evaluatorVersion: text('evaluatorVersion'), hya, preview,
    diagnostics,
    sidecars,
  });
}

export class Live2DAssetHistory {
  #current: Live2DDerivedAsset | null;
  #undo: Array<Live2DDerivedAsset | null> = [];
  #redo: Array<Live2DDerivedAsset | null> = [];
  constructor(initial: Live2DDerivedAsset | null = null) { this.#current = initial; }
  get current(): Live2DDerivedAsset | null { return this.#current; }
  commit(next: Live2DDerivedAsset): void { this.#undo.push(this.#current); this.#redo = []; this.#current = next; }
  undo(): Live2DDerivedAsset | null { if (this.#undo.length === 0) return this.#current; this.#redo.push(this.#current); this.#current = this.#undo.pop() ?? null; return this.#current; }
  redo(): Live2DDerivedAsset | null { if (this.#redo.length === 0) return this.#current; this.#undo.push(this.#current); this.#current = this.#redo.pop() ?? null; return this.#current; }
}

function validateRequest(request: Live2DImportRequest, limits: Live2DImportLimits): void {
  validateSourceSet(request.entry, request.files, limits);
  const lower = request.entry.toLowerCase();
  if (lower.endsWith('.wpk') || lower.endsWith('.cmo3')) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'WPK/authoring containers are not canonical inputs; select an authorized runtime asset set.');
  if (!lower.endsWith('.model3.json') || request.files.length === 0) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'A model3.json entry and runtime files are required.');
  if (!request.coreVersion.trim()) throw new Live2DImportError('E_LIVE2D_CORE_UNAVAILABLE', 'A licensed Cubism Core version is required.');
  validateRecipe(request.recipe);
}

function validateSourceSet(entry: string, files: readonly Live2DSourceFile[], limits: Live2DImportLimits): void {
  const normalizedEntry = normalizeRelativePath(entry, 'entry');
  if (!Array.isArray(files) || files.length === 0 || files.length > limits.maxFiles) {
    throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Runtime asset set must contain 1-${limits.maxFiles} files.`);
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    const path = normalizeRelativePath(file.path, 'runtime asset');
    if (paths.has(path)) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Duplicate runtime path "${file.path}".`);
    if (!(file.bytes instanceof Uint8Array)) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Runtime asset "${file.path}" is not a byte array.`);
    if (file.bytes.byteLength > limits.maxFileBytes) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Runtime asset "${file.path}" exceeds ${limits.maxFileBytes} bytes.`);
    totalBytes += file.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Runtime asset set exceeds ${limits.maxTotalBytes} bytes.`);
    paths.add(path);
  }
  if (!paths.has(normalizedEntry)) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'Entry is missing from the selected runtime asset set.');
}

function validateRecipe(recipe: Live2DClipRecipe): void {
  if (!recipe || typeof recipe !== 'object' || !recipe.id?.trim()) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'Clip recipe id is required.');
  for (const [key, value, minimum, maximum] of [
    ['frameRate', recipe.frameRate, Number.EPSILON, 240],
    ['tolerance', recipe.tolerance, 0, 1],
    ['quantizationStep', recipe.quantizationStep, Number.EPSILON, 1],
    ['start', recipe.start ?? 0, 0, Number.MAX_SAFE_INTEGER],
    ['duration', recipe.duration ?? Number.EPSILON, Number.EPSILON, Number.MAX_SAFE_INTEGER],
  ] as const) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Clip recipe ${key} is outside [${minimum}, ${maximum}].`);
  }
  if (recipe.mode !== 'normal' && recipe.mode !== 'strict') throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'Clip recipe mode must be normal or strict.');
  for (const [key, value] of [['motion', recipe.motion], ['expression', recipe.expression]] as const) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Clip recipe ${key} must be a non-empty id when present.`);
  }
  if (recipe.physics !== undefined && typeof recipe.physics !== 'boolean') throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'Clip recipe physics must be boolean.');
  if (recipe.pose !== undefined && typeof recipe.pose !== 'boolean') throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'Clip recipe pose must be boolean.');
  if (recipe.runtimeInputs && recipe.runtimeInputs.length > 0) {
    throw new Live2DImportError('E_LIVE2D_PARAMETERIZED_UNSUPPORTED', 'Runtime parameter inputs are not supported by the clip-baked profile.');
  }
}

function validateInspection(inspection: Live2DSourceInspection): Live2DSourceInspection {
  if (!inspection || typeof inspection !== 'object' || !inspection.modelName?.trim() || !inspection.core || typeof inspection.core.available !== 'boolean') {
    throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'Converter returned an invalid source inspection.');
  }
  const dependencies = inspection.dependencies.map(dependency => {
    const path = normalizeRelativePath(dependency.path, 'dependency');
    if (!['model', 'texture', 'motion', 'expression', 'physics', 'pose', 'metadata', 'other'].includes(dependency.kind)
      || !['available', 'missing', 'moved'].includes(dependency.status)) {
      throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Dependency inspection is invalid at "${path}".`);
    }
    return Object.freeze({ ...dependency, path });
  });
  const unique = new Set(dependencies.map(dependency => dependency.path));
  if (unique.size !== dependencies.length) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'Dependency inspection contains duplicate paths.');
  return deepFreeze({
    modelName: inspection.modelName,
    core: { ...inspection.core },
    motions: [...inspection.motions],
    expressions: [...inspection.expressions],
    physicsAvailable: inspection.physicsAvailable,
    poseAvailable: inspection.poseAvailable,
    dependencies,
    diagnostics: inspection.diagnostics.map(item => ({ ...item })),
  });
}

function validateConversionOutput(output: Live2DConversionOutput, limits: Live2DImportLimits): void {
  if (!output || !(output.hya instanceof Uint8Array) || output.hya.byteLength === 0 || output.hya.byteLength > limits.maxOutputBytes) {
    throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Converter HYA must contain 1-${limits.maxOutputBytes} bytes.`);
  }
  if (!Array.isArray(output.sidecars) || output.sidecars.length > limits.maxSidecars || !Array.isArray(output.diagnostics)) {
    throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'Converter sidecars or diagnostics are invalid.');
  }
  if (!output.sourceVersion?.trim() || !output.evaluatorVersion?.trim()) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'Converter provenance is incomplete.');
  let totalBytes = output.hya.byteLength;
  const paths = new Set<string>();
  for (const sidecar of output.sidecars) {
    const path = normalizeRelativePath(sidecar.path, 'sidecar');
    if (paths.has(path) || !(sidecar.bytes instanceof Uint8Array) || !sidecar.mimeType?.trim()) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Converter sidecar "${sidecar.path}" is invalid or duplicated.`);
    totalBytes += sidecar.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxOutputBytes) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Converted package exceeds ${limits.maxOutputBytes} bytes.`);
    validateDeliveryPath(path, sidecar.mimeType);
    paths.add(path);
  }
}

function validateOutputSidecars(preview: ParsedAnimation, sidecars: Live2DConversionOutput['sidecars']): void {
  const resources = new Set(preview.resources.map(resource => normalizeRelativePath(resource.uri, 'HYA resource')));
  const paths = new Set(sidecars.map(sidecar => normalizeRelativePath(sidecar.path, 'sidecar')));
  const missing = [...resources].filter(path => !paths.has(path));
  const unreferenced = [...paths].filter(path => !resources.has(path));
  if (missing.length > 0) throw new Live2DImportError('E_LIVE2D_DEPENDENCY_MISSING', `Converted package is missing HYA resources: ${missing.join(', ')}.`);
  if (unreferenced.length > 0) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Converted package contains unreferenced sidecars: ${unreferenced.join(', ')}.`);
}

function validateDeliveryPath(path: string, mimeType: string): void {
  const normalized = normalizeRelativePath(path, 'delivery');
  const lower = normalized.toLowerCase();
  const allowed = lower === 'model.hya' || ['.hydm', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.ktx2'].some(extension => lower.endsWith(extension));
  if (!allowed || lower.includes('live2dcubismcore') || /(?:^|\/)(?:core|source)(?:\/|$)/u.test(lower)
    || /(?:\.moc3|\.model3\.json|\.motion3\.json|\.exp3\.json|\.physics3\.json|\.pose3\.json|\.cdi3\.json|\.wpk|\.cmo3|\.js|\.mjs|\.wasm)$/u.test(lower)) {
    throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Source/Core or unsupported file "${path}" is forbidden in delivery.`);
  }
  if (!mimeType.trim()) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Delivery file "${path}" has no MIME type.`);
}

function normalizeRelativePath(path: string, label: string): string {
  const normalized = typeof path === 'string' ? path.replaceAll('\\', '/').replace(/^\.\//u, '') : '';
  if (!normalized || normalized.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(normalized) || normalized.split('/').some(part => !part || part === '..')) {
    throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Unsafe ${label} path "${String(path)}".`);
  }
  return normalized;
}

async function hashSourceSet(files: readonly Live2DSourceFile[], signal?: AbortSignal): Promise<string> {
  const encoded = [...files].sort((a, b) => a.path.localeCompare(b.path)).map(file => ({ file, path: new TextEncoder().encode(file.path.replaceAll('\\', '/')) }));
  const total = encoded.reduce((sum, item) => sum + item.path.length + item.file.bytes.length + 2, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const item of encoded) {
    throwIfAborted(signal);
    joined.set(item.path, offset); offset += item.path.length; joined[offset++] = 0;
    joined.set(item.file.bytes, offset); offset += item.file.bytes.length; joined[offset++] = 0xff;
  }
  return sha256(joined);
}
async function sha256(bytes: Uint8Array): Promise<string> { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', exactBuffer(bytes))); return `sha256-${[...digest].map(value => value.toString(16).padStart(2, '0')).join('')}`; }
function exactBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
function stableJson(value: unknown): string { const normalize = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(normalize) : entry && typeof entry === 'object' ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])) : entry; return JSON.stringify(normalize(value)); }
function base64Encode(bytes: Uint8Array): string { let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8192, bytes.length))); return btoa(binary); }
function base64Decode(value: string): Uint8Array { try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); } catch { throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'Derived asset contains invalid base64 bytes.'); } }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw aborted('Live2D import was cancelled.'); }
function aborted(message: string): Live2DImportError { return new Live2DImportError('E_LIVE2D_ABORTED', message); }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
