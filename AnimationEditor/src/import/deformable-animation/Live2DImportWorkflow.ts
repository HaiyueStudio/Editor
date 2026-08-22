import { parseAnimation, type ParsedAnimation } from '@haiyue/animation-spec';
import type { OfflineConversionDiagnostic } from '@haiyue/animation-spec/conversion';
import { createDeformableMesh2DFormatRegistry } from '@haiyue/animation-spec/deformable2d';
import type { CubismClipBakedRecipe } from '@haiyue/animation-spec/live2d/clip-baked';
import type { CompositionDiagnostic } from '../../domain/ReusableComposition';

export interface Live2DClipRecipe extends Pick<CubismClipBakedRecipe, 'id' | 'motion' | 'expression' | 'physics' | 'pose' | 'start' | 'duration'> {
  readonly frameRate: number;
  readonly tolerance: number;
  readonly quantizationStep: number;
  readonly mode: 'normal' | 'strict';
}

export interface Live2DSourceFile { readonly path: string; readonly bytes: Uint8Array; }

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
    readonly code: 'E_LIVE2D_ABORTED' | 'E_LIVE2D_INVALID_SOURCE' | 'E_LIVE2D_STRICT_DIAGNOSTIC' | 'E_LIVE2D_INVALID_OUTPUT',
    message: string,
    readonly diagnostics: readonly CompositionDiagnostic[] = [],
  ) { super(message); }
}

/** Latest-wins owner. Conversion is injected, so Core and source parsing remain outside Editor's default closure. */
export class Live2DImportWorkflow {
  #generation = 0;
  #active: AbortController | null = null;
  #closed = false;

  constructor(private readonly converter: Live2DConversionPort, private readonly onProgress?: (progress: Live2DImportProgress) => void) {}

  async convert(request: Live2DImportRequest, commit?: (asset: Live2DDerivedAsset) => void): Promise<Live2DDerivedAsset> {
    if (this.#closed) throw aborted('Live2D import workflow is closed.');
    this.cancel();
    validateRequest(request);
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
      this.onProgress?.({ generation, completed: 0, total: 1, stage: 'convert' });
      const output = await this.converter.convert({ entry: request.entry, files: request.files, recipe: request.recipe, coreVersion: request.coreVersion }, {
        signal: controller.signal,
        progress: (completed, total, stage) => {
          if (!controller.signal.aborted && this.#active === controller) this.onProgress?.({ generation, completed, total, stage });
        },
      });
      throwIfAborted(controller.signal);
      if (this.#active !== controller || generation !== this.#generation) throw aborted('A newer Live2D import superseded this result.');
      const diagnostics = Object.freeze(output.diagnostics.map(item => Object.freeze({
        ...item,
        risk: (/UNSUPPORTED|UNBAKED|MISSING/iu.test(item.code) ? 'unsupported' : 'fidelity') as 'unsupported' | 'fidelity',
        ...(request.assetId ? { sourceId: request.assetId } : {}),
      })));
      if (request.recipe.mode === 'strict' && diagnostics.length > 0) throw new Live2DImportError('E_LIVE2D_STRICT_DIAGNOSTIC', 'Strict Live2D import rejected conversion diagnostics.', diagnostics);
      const hya = new Uint8Array(output.hya);
      let preview: ParsedAnimation;
      try { preview = parseAnimation(exactBuffer(hya), { extensions: createDeformableMesh2DFormatRegistry() }); }
      catch (error) { throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', error instanceof Error ? error.message : 'Converter returned invalid HYA.'); }
      const id = request.assetId?.trim() || `live2d:${sourceHash.slice('sha256-'.length, 23)}`;
      const asset: Live2DDerivedAsset = deepFreeze({
        id, kind: 'live2d-clip-baked-hya', entry: request.entry, recipe: structuredClone(request.recipe), sourceHash, recipeHash,
        adapterId: this.converter.id, adapterVersion: this.converter.version, coreVersion: request.coreVersion,
        sourceVersion: output.sourceVersion, evaluatorVersion: output.evaluatorVersion, hya,
        sidecars: output.sidecars.map(sidecar => ({ ...sidecar, bytes: new Uint8Array(sidecar.bytes) })), diagnostics, preview,
      });
      commit?.(asset);
      this.onProgress?.({ generation, completed: 1, total: 1, stage: 'complete' });
      return asset;
    } catch (error) {
      if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') throw aborted('Live2D import was cancelled.');
      throw error;
    } finally {
      request.signal?.removeEventListener('abort', abortFromCaller);
      if (this.#active === controller) this.#active = null;
    }
  }

  cancel(): void { this.#active?.abort('cancelled'); this.#active = null; }
  close(): void { this.#closed = true; this.cancel(); }
}

export async function inspectLive2DAssetStaleness(asset: Live2DDerivedAsset, request: Live2DImportRequest, converter: Pick<Live2DConversionPort, 'id' | 'version'>): Promise<Readonly<{ readonly stale: boolean; readonly reasons: readonly string[] }>> {
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
  const files = [{ path: 'model.hya', bytes: new Uint8Array(asset.hya), mimeType: 'application/vnd.haiyue.animation' }, ...asset.sidecars.map(sidecar => ({ ...sidecar, bytes: new Uint8Array(sidecar.bytes) }))];
  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (lower.endsWith('.moc3') || lower.endsWith('.model3.json') || lower.endsWith('.wpk') || lower.includes('live2dcubismcore')) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Source/Core file "${file.path}" is forbidden in delivery.`);
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
  return deepFreeze({
    id: value.id, kind: value.kind, entry: value.entry, recipe: structuredClone(value.recipe) as unknown as Live2DClipRecipe,
    sourceHash: text('sourceHash'), recipeHash: text('recipeHash'), adapterId: text('adapterId'), adapterVersion: text('adapterVersion'),
    coreVersion: text('coreVersion'), sourceVersion: text('sourceVersion'), evaluatorVersion: text('evaluatorVersion'), hya, preview,
    diagnostics: structuredClone(value.diagnostics) as unknown as CompositionDiagnostic[],
    sidecars: value.sidecars.map((sidecar, index) => {
      if (!sidecar || typeof sidecar !== 'object') throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Invalid sidecar at index ${index}.`);
      const record = sidecar as Record<string, unknown>;
      if (typeof record.path !== 'string' || typeof record.mimeType !== 'string' || typeof record.bytes !== 'string') throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', `Invalid sidecar at index ${index}.`);
      return { path: record.path, mimeType: record.mimeType, bytes: base64Decode(record.bytes) };
    }),
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

function validateRequest(request: Live2DImportRequest): void {
  const lower = request.entry.toLowerCase();
  if (lower.endsWith('.wpk') || lower.endsWith('.cmo3')) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'WPK/authoring containers are not canonical inputs; select an authorized runtime asset set.');
  if (!lower.endsWith('.model3.json') || request.files.length === 0 || !request.coreVersion.trim()) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'A model3.json entry, runtime files and Core version are required.');
  const paths = new Set<string>();
  for (const file of request.files) {
    const path = file.path.replaceAll('\\', '/');
    if (!path || path.startsWith('/') || path.split('/').includes('..') || paths.has(path)) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Unsafe or duplicate runtime path "${file.path}".`);
    paths.add(path);
  }
  if (!paths.has(request.entry.replaceAll('\\', '/'))) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'Entry is missing from the selected runtime asset set.');
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
