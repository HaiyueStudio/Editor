import type { Live2DClipRecipe } from '../../import/deformable-animation/Live2DImportWorkflow';
import { Live2DImportError, type Live2DSourceFile } from '../../import/deformable-animation/Live2DImportWorkflow';
import { Live2DImportSession, type Live2DClipRecipePatch, type Live2DImportSessionSnapshot } from './Live2DImportSession';

export interface Live2DAuthoringPanelOptions {
  readonly onExport?: (files: ReturnType<Live2DImportSession['exportFiles']>) => void | Promise<void>;
  readonly onSave?: (serialized: string) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
  readonly explicitCoreVersion?: string;
}

/** DOM adapter for the lazy importer contribution. It owns no converter or source runtime. */
export class Live2DAuthoringPanel {
  readonly #abort = new AbortController();
  readonly #onExport: NonNullable<Live2DAuthoringPanelOptions['onExport']>;
  readonly #onSave: NonNullable<Live2DAuthoringPanelOptions['onSave']>;
  readonly #onError: NonNullable<Live2DAuthoringPanelOptions['onError']>;
  readonly #unsubscribe: () => void;
  #reading: AbortController | null = null;
  #lastSnapshot: Live2DImportSessionSnapshot;

  constructor(readonly root: HTMLElement, readonly session: Live2DImportSession, readonly options: Live2DAuthoringPanelOptions = {}) {
    this.#onExport = options.onExport ?? (() => {});
    this.#onSave = options.onSave ?? (() => {});
    this.#onError = options.onError ?? (() => {});
    root.innerHTML = panelMarkup();
    const source = this.#query<HTMLInputElement>('source');
    source.setAttribute('webkitdirectory', '');
    source.addEventListener('change', () => { if (source.files) void this.selectFiles([...source.files]); }, { signal: this.#abort.signal });
    for (const role of ['motion', 'expression', 'physics', 'pose', 'frame-rate', 'tolerance', 'quantization', 'mode'] as const) {
      this.#query<HTMLInputElement | HTMLSelectElement>(role).addEventListener('change', () => void this.#applyRecipe(), { signal: this.#abort.signal });
    }
    this.#bindAction('convert', () => this.session.convert());
    this.#bindAction('reimport', () => this.session.reimport());
    this.#bindAction('cancel', () => { this.session.cancel(); });
    this.#bindAction('retry', () => this.session.retry());
    this.#bindAction('undo', () => this.session.undo());
    this.#bindAction('redo', () => this.session.redo());
    this.#bindAction('save', async () => this.#onSave(this.session.save()));
    this.#bindAction('export', async () => this.#onExport(this.session.exportFiles()));
    this.#lastSnapshot = session.snapshot;
    this.#unsubscribe = session.subscribe(snapshot => { this.#lastSnapshot = snapshot; this.#render(snapshot); });
  }

  get snapshot(): Live2DImportSessionSnapshot { return this.#lastSnapshot; }

  async selectFiles(files: readonly File[]): Promise<Live2DImportSessionSnapshot> {
    this.#reading?.abort('superseded');
    const controller = new AbortController();
    this.#reading = controller;
    try {
      const paths = normalizedBrowserPaths(files);
      const entries = paths.filter(item => item.path.toLowerCase().endsWith('.model3.json'));
      if (entries.length !== 1) throw new Live2DImportError('E_LIVE2D_INVALID_SOURCE', `Select one runtime asset set containing exactly one .model3.json; found ${entries.length}.`);
      const sourceFiles: Live2DSourceFile[] = [];
      for (const item of paths) {
        if (controller.signal.aborted) throw new Live2DImportError('E_LIVE2D_ABORTED', 'Runtime directory read was cancelled.');
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        if (controller.signal.aborted) throw new Live2DImportError('E_LIVE2D_ABORTED', 'Runtime directory read was cancelled.');
        sourceFiles.push({ path: item.path, bytes });
      }
      if (controller.signal.aborted) throw new Live2DImportError('E_LIVE2D_ABORTED', 'Runtime directory read was cancelled.');
      const result = await this.session.selectSource({
        entry: entries[0]!.path,
        files: sourceFiles,
        ...(this.options.explicitCoreVersion ? { coreVersion: this.options.explicitCoreVersion } : {}),
      });
      this.#syncRecipeControls(result);
      return result;
    } catch (error) {
      this.#onError(error);
      throw error;
    } finally {
      if (this.#reading === controller) this.#reading = null;
    }
  }

  async reopen(serialized: string): Promise<Live2DImportSessionSnapshot> {
    await this.session.reopen(serialized);
    return this.session.snapshot;
  }

  async destroy(): Promise<void> {
    this.#abort.abort('panel-destroyed');
    this.#reading?.abort('panel-destroyed');
    this.#reading = null;
    this.#unsubscribe();
    await this.session.close();
    this.root.replaceChildren();
  }

  async #applyRecipe(): Promise<void> {
    const motion = this.#query<HTMLSelectElement>('motion').value;
    const expression = this.#query<HTMLSelectElement>('expression').value;
    const patch: Live2DClipRecipePatch = {
      motion: motion || undefined,
      expression: expression || undefined,
      physics: this.#query<HTMLInputElement>('physics').checked,
      pose: this.#query<HTMLInputElement>('pose').checked,
      frameRate: this.#number('frame-rate'),
      tolerance: this.#number('tolerance'),
      quantizationStep: this.#number('quantization'),
      mode: this.#query<HTMLSelectElement>('mode').value as Live2DClipRecipe['mode'],
    };
    try { await this.session.configureRecipe(patch); }
    catch (error) { this.#onError(error); }
  }

  #bindAction(role: string, action: () => unknown | Promise<unknown>): void {
    this.#query<HTMLButtonElement>(role).addEventListener('click', () => {
      try { void Promise.resolve(action()).catch(this.#onError); }
      catch (error) { this.#onError(error); }
    }, { signal: this.#abort.signal });
  }

  #syncRecipeControls(snapshot: Live2DImportSessionSnapshot): void {
    setOptions(this.#query<HTMLSelectElement>('motion'), snapshot.inspection?.motions ?? [], snapshot.recipe.motion);
    setOptions(this.#query<HTMLSelectElement>('expression'), snapshot.inspection?.expressions ?? [], snapshot.recipe.expression);
    this.#query<HTMLInputElement>('physics').checked = snapshot.recipe.physics ?? false;
    this.#query<HTMLInputElement>('physics').disabled = !snapshot.inspection?.physicsAvailable;
    this.#query<HTMLInputElement>('pose').checked = snapshot.recipe.pose ?? false;
    this.#query<HTMLInputElement>('pose').disabled = !snapshot.inspection?.poseAvailable;
    this.#query<HTMLInputElement>('frame-rate').value = String(snapshot.recipe.frameRate);
    this.#query<HTMLInputElement>('tolerance').value = String(snapshot.recipe.tolerance);
    this.#query<HTMLInputElement>('quantization').value = String(snapshot.recipe.quantizationStep);
    this.#query<HTMLSelectElement>('mode').value = snapshot.recipe.mode;
  }

  #render(snapshot: Live2DImportSessionSnapshot): void {
    this.root.dataset.phase = snapshot.phase;
    this.#query<HTMLElement>('state').textContent = snapshot.phase;
    const progress = snapshot.progress;
    this.#query<HTMLProgressElement>('progress').value = progress ? progress.total > 0 ? progress.completed / progress.total : 0 : 0;
    this.#query<HTMLElement>('progress-label').textContent = progress ? `${progress.stage} · ${progress.completed}/${progress.total}` : '';
    this.#query<HTMLButtonElement>('convert').disabled = !snapshot.canConvert || Boolean(snapshot.asset);
    this.#query<HTMLButtonElement>('reimport').disabled = !snapshot.canReimport;
    this.#query<HTMLButtonElement>('cancel').disabled = !snapshot.canCancel;
    this.#query<HTMLButtonElement>('retry').disabled = snapshot.phase !== 'error';
    this.#query<HTMLButtonElement>('save').disabled = !snapshot.asset;
    this.#query<HTMLButtonElement>('export').disabled = !snapshot.asset;
    this.#query<HTMLElement>('stale').textContent = snapshot.staleReasons.length ? `stale: ${snapshot.staleReasons.join(', ')}` : '';
    this.#query<HTMLElement>('diagnostics').replaceChildren(...snapshot.diagnostics.map(item => {
      const row = document.createElement('li');
      row.dataset.severity = item.severity;
      row.textContent = `${item.code} · ${item.path} · ${item.message}`;
      return row;
    }));
    const provenance = snapshot.asset ? {
      sourceHash: snapshot.asset.sourceHash,
      recipeHash: snapshot.asset.recipeHash,
      adapter: `${snapshot.asset.adapterId}@${snapshot.asset.adapterVersion}`,
      core: snapshot.asset.coreVersion,
      evaluator: snapshot.asset.evaluatorVersion,
    } : snapshot.inspection ? { core: snapshot.inspection.core.version ?? 'unavailable' } : {};
    this.#query<HTMLElement>('provenance').textContent = JSON.stringify(provenance, null, 2);
    if (snapshot.inspection) this.#syncRecipeControls(snapshot);
  }

  #number(role: string): number { return Number(this.#query<HTMLInputElement>(role).value); }
  #query<T extends Element>(role: string): T {
    const value = this.root.querySelector(`[data-live2d-role="${role}"]`);
    if (!value) throw new Error(`Live2D authoring control "${role}" is missing.`);
    return value as T;
  }
}

function normalizedBrowserPaths(files: readonly File[]): readonly Readonly<{ readonly file: File; readonly path: string }>[] {
  const raw = files.map(file => ({ file, path: (file.webkitRelativePath || file.name).replaceAll('\\', '/').replace(/^\.\//u, '') }));
  const roots = new Set(raw.map(item => item.path.split('/')[0]));
  const stripRoot = roots.size === 1 && raw.some(item => item.path.includes('/'));
  return Object.freeze(raw.map(item => Object.freeze({ file: item.file, path: stripRoot ? item.path.split('/').slice(1).join('/') : item.path })));
}

function setOptions(select: HTMLSelectElement, values: readonly string[], selected?: string): void {
  const current = selected ?? '';
  select.replaceChildren(option('', 'None'), ...values.map(value => option(value, value)));
  select.value = values.includes(current) ? current : '';
}
function option(value: string, label: string): HTMLOptionElement { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; }

function panelMarkup(): string {
  return `<section aria-label="Live2D clip-baked import">
    <label>Runtime asset set <input data-live2d-role="source" type="file" multiple></label>
    <label>Motion <select data-live2d-role="motion"></select></label>
    <label>Expression <select data-live2d-role="expression"></select></label>
    <label><input data-live2d-role="physics" type="checkbox"> Physics</label>
    <label><input data-live2d-role="pose" type="checkbox"> Pose</label>
    <label>Frame rate <input data-live2d-role="frame-rate" type="number" min="1" max="240" step="1"></label>
    <label>Tolerance <input data-live2d-role="tolerance" type="number" min="0" max="1" step="0.0001"></label>
    <label>Quantization <input data-live2d-role="quantization" type="number" min="0.000001" max="1" step="0.000001"></label>
    <label>Profile <select data-live2d-role="mode"><option value="normal">Normal</option><option value="strict">Strict</option></select></label>
    <div><button data-live2d-role="convert" type="button">Convert</button><button data-live2d-role="reimport" type="button">Reimport</button>
      <button data-live2d-role="cancel" type="button">Cancel</button><button data-live2d-role="retry" type="button">Retry</button>
      <button data-live2d-role="undo" type="button">Undo</button><button data-live2d-role="redo" type="button">Redo</button>
      <button data-live2d-role="save" type="button">Save derived asset</button><button data-live2d-role="export" type="button">Export HYA package</button></div>
    <div data-live2d-role="state" aria-live="polite"></div><progress data-live2d-role="progress" max="1"></progress>
    <span data-live2d-role="progress-label"></span><div data-live2d-role="stale"></div>
    <ul data-live2d-role="diagnostics"></ul><pre data-live2d-role="provenance"></pre>
  </section>`;
}
