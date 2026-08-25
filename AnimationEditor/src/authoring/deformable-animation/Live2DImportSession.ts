import type { OfflineConversionDiagnostic } from '@haiyue/animation-spec/conversion';
import {
  createLive2DDeliveryFiles,
  inspectLive2DAssetStaleness,
  Live2DAssetHistory,
  Live2DImportError,
  type Live2DClipRecipe,
  type Live2DConversionPort,
  type Live2DDerivedAsset,
  type Live2DImportProgress,
  type Live2DImportRequest,
  type Live2DImportWorkflow,
  type Live2DSourceFile,
  type Live2DSourceInspection,
  parseLive2DDerivedAsset,
  serializeLive2DDerivedAsset,
} from '../../import/deformable-animation/Live2DImportWorkflow';

export type Live2DImportSessionPhase =
  | 'idle' | 'inspecting' | 'configuring' | 'converting' | 'ready' | 'stale' | 'blocked' | 'error' | 'closed';

export interface Live2DSourceSelection {
  readonly entry: string;
  readonly files: readonly Live2DSourceFile[];
  /** Used only when the injected converter has no inspection port. */
  readonly coreVersion?: string;
}

export interface Live2DExactPreviewPort {
  /** Must leave the previous preview active if the replacement fails. */
  replace(asset: Live2DDerivedAsset, signal?: AbortSignal): Promise<void>;
  clear(): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface Live2DSessionDiagnostic extends OfflineConversionDiagnostic {
  readonly owner: 'inspection' | 'conversion' | 'session';
}

export interface Live2DImportSessionSnapshot {
  readonly phase: Live2DImportSessionPhase;
  readonly selection: Live2DSourceSelection | null;
  readonly inspection: Live2DSourceInspection | null;
  readonly recipe: Live2DClipRecipe;
  readonly asset: Live2DDerivedAsset | null;
  readonly progress: Live2DImportProgress | null;
  readonly diagnostics: readonly Live2DSessionDiagnostic[];
  readonly staleReasons: readonly string[];
  readonly error: Readonly<{ readonly code: string; readonly message: string }> | null;
  readonly canConvert: boolean;
  readonly canReimport: boolean;
  readonly canCancel: boolean;
}

export interface Live2DImportSessionOptions {
  readonly converter: Live2DConversionPort;
  readonly workflow: Live2DImportWorkflow;
  readonly preview?: Live2DExactPreviewPort;
  readonly initialRecipe?: Partial<Live2DClipRecipe>;
}

export type Live2DClipRecipePatch = { readonly [Key in keyof Live2DClipRecipe]?: Live2DClipRecipe[Key] | undefined };

type Listener = (snapshot: Live2DImportSessionSnapshot) => void;

const DEFAULT_RECIPE: Live2DClipRecipe = Object.freeze({
  id: 'idle', start: 0, duration: 1, frameRate: 30, tolerance: 0.01, quantizationStep: 1 / 1024, mode: 'normal',
});

/** Product-neutral owner for the lazy Live2D importer and its atomic derived asset. */
export class Live2DImportSession {
  readonly #converter: Live2DConversionPort;
  readonly #workflow: Live2DImportWorkflow;
  readonly #preview: Live2DExactPreviewPort | undefined;
  readonly #listeners = new Set<Listener>();
  readonly #unsubscribeProgress: () => void;
  #history = new Live2DAssetHistory();
  #selection: Live2DSourceSelection | null = null;
  #inspection: Live2DSourceInspection | null = null;
  #recipe: Live2DClipRecipe;
  #phase: Live2DImportSessionPhase = 'idle';
  #progress: Live2DImportProgress | null = null;
  #diagnostics: readonly Live2DSessionDiagnostic[] = Object.freeze([]);
  #staleReasons: readonly string[] = Object.freeze([]);
  #error: Readonly<{ readonly code: string; readonly message: string }> | null = null;
  #operation: AbortController | null = null;
  #generation = 0;
  #lastIntent: 'convert' | 'reimport' | null = null;

  constructor(options: Live2DImportSessionOptions) {
    const adapter = options.workflow.adapter;
    if (adapter.id !== options.converter.id || adapter.version !== options.converter.version) {
      throw new Live2DImportError(
        'E_LIVE2D_INVALID_SOURCE',
        `Live2D workflow adapter ${adapter.id}@${adapter.version} does not match session converter ${options.converter.id}@${options.converter.version}.`,
      );
    }
    this.#converter = options.converter;
    this.#workflow = options.workflow;
    this.#preview = options.preview;
    this.#recipe = freezeRecipe({ ...DEFAULT_RECIPE, ...options.initialRecipe });
    this.#unsubscribeProgress = this.#workflow.subscribeProgress(progress => {
      if (this.#phase !== 'converting') return;
      this.#progress = progress;
      this.#emit();
    });
  }

  get snapshot(): Live2DImportSessionSnapshot { return this.#snapshot(); }

  subscribe(listener: Listener): () => void {
    this.#assertOpen();
    this.#listeners.add(listener);
    listener(this.#snapshot());
    return () => this.#listeners.delete(listener);
  }

  async selectSource(selection: Live2DSourceSelection): Promise<Live2DImportSessionSnapshot> {
    this.#assertOpen();
    this.cancel();
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#operation = controller;
    this.#selection = cloneSelection(selection);
    this.#phase = 'inspecting';
    this.#inspection = null;
    this.#progress = null;
    this.#error = null;
    this.#diagnostics = Object.freeze([]);
    this.#emit();
    try {
      const inspection = await this.#workflow.inspect(this.#selection.entry, this.#selection.files, controller.signal);
      this.#assertCurrent(generation, controller);
      this.#inspection = inspection;
      if (inspection) {
        const compatibleRecipe = { ...this.#recipe } as Record<string, unknown>;
        if (!this.#recipe.motion || !inspection.motions.includes(this.#recipe.motion)) {
          if (inspection.motions[0]) compatibleRecipe.motion = inspection.motions[0];
          else delete compatibleRecipe.motion;
        }
        if (this.#recipe.expression && !inspection.expressions.includes(this.#recipe.expression)) delete compatibleRecipe.expression;
        if (!inspection.physicsAvailable) compatibleRecipe.physics = false;
        if (!inspection.poseAvailable) compatibleRecipe.pose = false;
        this.#recipe = freezeRecipe(compatibleRecipe as unknown as Live2DClipRecipe);
      }
      this.#diagnostics = Object.freeze((inspection?.diagnostics ?? []).map(item => Object.freeze({ ...item, owner: 'inspection' as const })));
      const blocker = this.#sourceBlocker();
      this.#phase = blocker ? 'blocked' : 'configuring';
      if (blocker) this.#staleReasons = Object.freeze([]);
      else await this.#refreshStaleness();
      if (!blocker && this.#history.current) this.#phase = this.#staleReasons.length ? 'stale' : 'ready';
      this.#emit();
      return this.#snapshot();
    } catch (error) {
      if (this.#isSuperseded(generation, controller)) throw abortedSession();
      throw this.#setError(error);
    } finally {
      if (this.#operation === controller) this.#operation = null;
    }
  }

  async configureRecipe(patch: Live2DClipRecipePatch): Promise<Live2DImportSessionSnapshot> {
    this.#assertOpen();
    const next = { ...this.#recipe } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    this.#recipe = freezeRecipe(next as unknown as Live2DClipRecipe);
    this.#error = null;
    await this.#refreshStaleness();
    if (this.#phase !== 'blocked') this.#phase = this.#history.current && this.#staleReasons.length === 0 ? 'ready' : this.#history.current ? 'stale' : 'configuring';
    this.#emit();
    return this.#snapshot();
  }

  convert(): Promise<Live2DDerivedAsset> { this.#lastIntent = 'convert'; return this.#runConversion(false); }
  reimport(): Promise<Live2DDerivedAsset> { this.#lastIntent = 'reimport'; return this.#runConversion(true); }

  retry(): Promise<Live2DDerivedAsset> {
    this.#assertOpen();
    if (!this.#lastIntent) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'There is no failed Live2D conversion to retry.');
    return this.#runConversion(this.#lastIntent === 'reimport');
  }

  cancel(): void {
    this.#operation?.abort('cancelled');
    this.#operation = null;
    this.#workflow.cancel();
    if (this.#phase === 'converting' || this.#phase === 'inspecting') {
      this.#phase = this.#history.current ? (this.#staleReasons.length ? 'stale' : 'ready') : this.#selection ? 'configuring' : 'idle';
      this.#progress = null;
      this.#emit();
    }
  }

  async undo(): Promise<Live2DDerivedAsset | null> { return this.#restoreHistory('undo'); }
  async redo(): Promise<Live2DDerivedAsset | null> { return this.#restoreHistory('redo'); }

  save(): string { this.#assertOpen(); return serializeLive2DDerivedAsset(this.#requireAsset()); }

  async reopen(serialized: string): Promise<Live2DDerivedAsset> {
    this.#assertOpen();
    this.cancel();
    const asset = parseLive2DDerivedAsset(serialized);
    await this.#preview?.replace(asset);
    this.#history = new Live2DAssetHistory(asset);
    this.#recipe = freezeRecipe(asset.recipe);
    this.#diagnostics = Object.freeze(asset.diagnostics.map(item => Object.freeze({ ...item, owner: 'conversion' as const })));
    this.#staleReasons = Object.freeze([]);
    this.#phase = 'ready';
    this.#error = null;
    this.#emit();
    return asset;
  }

  exportFiles(): ReturnType<typeof createLive2DDeliveryFiles> { this.#assertOpen(); return createLive2DDeliveryFiles(this.#requireAsset()); }

  async close(): Promise<void> {
    if (this.#phase === 'closed') return;
    this.cancel();
    this.#phase = 'closed';
    this.#listeners.clear();
    this.#unsubscribeProgress();
    this.#workflow.close();
    await this.#preview?.close();
  }

  async #runConversion(reimport: boolean): Promise<Live2DDerivedAsset> {
    this.#assertOpen();
    const selection = this.#selection;
    if (!selection) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'Select a Live2D runtime asset set before converting.');
    const blocker = this.#sourceBlocker();
    if (blocker) { this.#setError(blocker); throw blocker; }
    if (reimport && !this.#history.current) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', 'Reimport requires an existing derived asset.');
    this.cancel();
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#operation = controller;
    this.#phase = 'converting';
    this.#progress = Object.freeze({ generation, completed: 0, total: 1, stage: 'queued' });
    this.#error = null;
    this.#emit();
    const assetId = reimport ? this.#history.current!.id : this.#history.current?.id;
    const request: Live2DImportRequest = {
      ...(assetId ? { assetId } : {}),
      entry: selection.entry,
      files: selection.files,
      recipe: this.#recipe,
      coreVersion: this.#inspection?.core.version ?? selection.coreVersion ?? '',
      signal: controller.signal,
    };
    try {
      const asset = await this.#workflow.convert(request);
      this.#assertCurrent(generation, controller);
      await this.#preview?.replace(asset, controller.signal);
      this.#assertCurrent(generation, controller);
      this.#history.commit(asset);
      this.#diagnostics = Object.freeze(asset.diagnostics.map(item => Object.freeze({ ...item, owner: 'conversion' as const })));
      this.#staleReasons = Object.freeze([]);
      this.#phase = 'ready';
      this.#progress = Object.freeze({ generation, completed: 1, total: 1, stage: 'complete' });
      this.#error = null;
      this.#emit();
      return asset;
    } catch (error) {
      if (this.#isSuperseded(generation, controller)) throw abortedSession();
      throw this.#setError(error);
    } finally {
      if (this.#operation === controller) this.#operation = null;
    }
  }

  async #restoreHistory(kind: 'undo' | 'redo'): Promise<Live2DDerivedAsset | null> {
    this.#assertOpen();
    this.cancel();
    const previous = this.#history.current;
    const next = this.#history[kind]();
    try {
      if (next) await this.#preview?.replace(next);
      else await this.#preview?.clear();
    } catch (error) {
      if (kind === 'undo') this.#history.redo(); else this.#history.undo();
      if (previous) await this.#preview?.replace(previous);
      throw this.#setError(error);
    }
    if (next) this.#recipe = freezeRecipe(next.recipe);
    await this.#refreshStaleness();
    this.#phase = next ? (this.#staleReasons.length ? 'stale' : 'ready') : this.#selection ? 'configuring' : 'idle';
    this.#error = null;
    this.#emit();
    return next;
  }

  async #refreshStaleness(): Promise<void> {
    const asset = this.#history.current;
    const selection = this.#selection;
    if (!asset || !selection) { this.#staleReasons = Object.freeze([]); return; }
    const request: Live2DImportRequest = {
      assetId: asset.id, entry: selection.entry, files: selection.files, recipe: this.#recipe,
      coreVersion: this.#inspection?.core.version ?? selection.coreVersion ?? '',
    };
    this.#staleReasons = (await inspectLive2DAssetStaleness(asset, request, this.#converter)).reasons;
  }

  #sourceBlocker(): Live2DImportError | null {
    const inspection = this.#inspection;
    if (inspection && !inspection.core.available) return new Live2DImportError('E_LIVE2D_CORE_UNAVAILABLE', inspection.core.message ?? 'Licensed Cubism Core is unavailable.');
    if (!inspection && !this.#selection?.coreVersion?.trim()) return new Live2DImportError('E_LIVE2D_CORE_UNAVAILABLE', 'Converter inspection or an explicit Core version is required.');
    const unavailable = inspection?.dependencies.filter(dependency => dependency.status !== 'available') ?? [];
    if (unavailable.length) return new Live2DImportError('E_LIVE2D_DEPENDENCY_MISSING', `Missing or moved Live2D dependencies: ${unavailable.map(item => item.path).join(', ')}.`);
    return null;
  }

  #setError(error: unknown): Live2DImportError {
    const normalized = error instanceof Live2DImportError ? error : new Live2DImportError('E_LIVE2D_CONVERSION_FAILED', error instanceof Error ? error.message : String(error));
    this.#error = Object.freeze({ code: normalized.code, message: normalized.message });
    this.#diagnostics = Object.freeze([
      ...this.#diagnostics,
      ...normalized.diagnostics.map(item => Object.freeze({ ...item, owner: 'conversion' as const })),
      Object.freeze({ severity: 'error' as const, code: normalized.code, path: '$.import', message: normalized.message, owner: 'session' as const }),
    ]);
    this.#phase = normalized.code === 'E_LIVE2D_CORE_UNAVAILABLE' || normalized.code === 'E_LIVE2D_DEPENDENCY_MISSING' ? 'blocked' : 'error';
    this.#progress = null;
    this.#emit();
    return normalized;
  }

  #assertCurrent(generation: number, controller: AbortController): void {
    if (controller.signal.aborted || generation !== this.#generation || this.#operation !== controller) throw abortedSession();
  }
  #isSuperseded(generation: number, controller: AbortController): boolean { return controller.signal.aborted || generation !== this.#generation || this.#operation !== controller; }
  #requireAsset(): Live2DDerivedAsset { const asset = this.#history.current; if (!asset) throw new Live2DImportError('E_LIVE2D_INVALID_OUTPUT', 'No converted Live2D asset is available.'); return asset; }
  #assertOpen(): void { if (this.#phase === 'closed') throw new Live2DImportError('E_LIVE2D_ABORTED', 'Live2D import session is closed.'); }

  #snapshot(): Live2DImportSessionSnapshot {
    const blocker = this.#phase === 'closed' ? true : this.#sourceBlocker();
    return Object.freeze({
      phase: this.#phase, selection: this.#selection, inspection: this.#inspection, recipe: this.#recipe,
      asset: this.#history.current, progress: this.#progress, diagnostics: this.#diagnostics,
      staleReasons: this.#staleReasons, error: this.#error,
      canConvert: Boolean(this.#selection) && !blocker && !['inspecting', 'converting', 'closed'].includes(this.#phase),
      canReimport: Boolean(this.#history.current) && !blocker && !['inspecting', 'converting', 'closed'].includes(this.#phase),
      canCancel: this.#phase === 'inspecting' || this.#phase === 'converting',
    });
  }
  #emit(): void { const snapshot = this.#snapshot(); for (const listener of this.#listeners) listener(snapshot); }
}

function cloneSelection(selection: Live2DSourceSelection): Live2DSourceSelection {
  return Object.freeze({
    entry: selection.entry.replaceAll('\\', '/'),
    files: Object.freeze(selection.files.map(file => Object.freeze({ path: file.path.replaceAll('\\', '/'), bytes: new Uint8Array(file.bytes) }))),
    ...(selection.coreVersion ? { coreVersion: selection.coreVersion } : {}),
  });
}
function freezeRecipe(recipe: Live2DClipRecipe): Live2DClipRecipe { return Object.freeze({ ...recipe, ...(recipe.runtimeInputs ? { runtimeInputs: Object.freeze([...recipe.runtimeInputs]) } : {}) }); }
function abortedSession(): Live2DImportError { return new Live2DImportError('E_LIVE2D_ABORTED', 'Live2D import operation was cancelled or superseded.'); }
