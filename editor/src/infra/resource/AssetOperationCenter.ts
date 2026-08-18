import type { WorkflowProgress } from '../../domain/workflows/CoreWorkflowCoordinator';

export type AssetOperationKind = 'import' | 'reimport';
export type AssetOperationStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AssetOperationSnapshot {
  readonly id: number;
  readonly kind: AssetOperationKind;
  readonly label: string;
  readonly assetIds: readonly string[];
  readonly status: AssetOperationStatus;
  readonly progress: WorkflowProgress | null;
  readonly error: string | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly canRetry: boolean;
}

interface MutableAssetOperation {
  id: number;
  kind: AssetOperationKind;
  label: string;
  assetIds: string[];
  status: AssetOperationStatus;
  progress: WorkflowProgress | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  retry: (() => void) | null;
  cancel: (() => void) | null;
}

export interface AssetOperationHandle {
  readonly id: number;
  progress(progress: WorkflowProgress): void;
  complete(assetIds?: readonly string[]): void;
  fail(error: unknown): void;
  cancel(): void;
}

export class AssetOperationCenter {
  private readonly _operations: MutableAssetOperation[] = [];
  private readonly _listeners = new Set<(operations: readonly AssetOperationSnapshot[]) => void>();
  private _nextId = 1;

  begin(options: {
    label: string;
    kind?: AssetOperationKind;
    assetIds?: readonly string[];
    retry?: () => void;
    cancel?: () => void;
  }): AssetOperationHandle {
    const operation: MutableAssetOperation = {
      id: this._nextId++,
      kind: options.kind ?? 'import',
      label: options.label,
      assetIds: [...(options.assetIds ?? [])],
      status: 'running',
      progress: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      retry: options.retry ?? null,
      cancel: options.cancel ?? null,
    };
    this._operations.unshift(operation);
    if (this._operations.length > 30) this._operations.length = 30;
    this._emit();
    return {
      id: operation.id,
      progress: progress => this._update(operation, { progress }),
      complete: assetIds => this._finish(operation, 'completed', null, assetIds),
      fail: error => this._finish(operation, 'failed', error),
      cancel: () => {
        operation.cancel?.();
        this._finish(operation, 'cancelled');
      },
    };
  }

  retry(id: number): boolean {
    const operation = this._operations.find(item => item.id === id);
    if (!operation?.retry || operation.status === 'running') return false;
    operation.retry();
    return true;
  }

  cancel(id: number): boolean {
    const operation = this._operations.find(item => item.id === id);
    if (!operation || operation.status !== 'running') return false;
    operation.cancel?.();
    this._finish(operation, 'cancelled');
    return true;
  }

  dismiss(id: number): boolean {
    const index = this._operations.findIndex(item => item.id === id);
    if (index < 0 || this._operations[index]?.status === 'running') return false;
    this._operations.splice(index, 1);
    this._emit();
    return true;
  }

  subscribe(listener: (operations: readonly AssetOperationSnapshot[]) => void): () => void {
    this._listeners.add(listener);
    listener(this.snapshot());
    return () => this._listeners.delete(listener);
  }

  snapshot(): readonly AssetOperationSnapshot[] {
    return this._operations.map(operation => Object.freeze({
      id: operation.id,
      kind: operation.kind,
      label: operation.label,
      assetIds: Object.freeze([...operation.assetIds]),
      status: operation.status,
      progress: operation.progress ? Object.freeze({ ...operation.progress }) : null,
      error: operation.error,
      startedAt: operation.startedAt,
      finishedAt: operation.finishedAt,
      canRetry: operation.retry !== null && operation.status !== 'running',
    }));
  }

  private _update(operation: MutableAssetOperation, patch: Pick<MutableAssetOperation, 'progress'>): void {
    if (operation.status !== 'running') return;
    Object.assign(operation, patch);
    this._emit();
  }

  private _finish(
    operation: MutableAssetOperation,
    status: Exclude<AssetOperationStatus, 'running'>,
    error: unknown = null,
    assetIds?: readonly string[],
  ): void {
    if (operation.status !== 'running') return;
    operation.status = status;
    operation.finishedAt = Date.now();
    operation.error = error == null ? null : error instanceof Error ? error.message : String(error);
    if (assetIds) operation.assetIds = [...assetIds];
    this._emit();
  }

  private _emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this._listeners) listener(snapshot);
  }
}

export class AssetOperationStatusView {
  private readonly _unsubscribe: () => void;

  constructor(private readonly _element: HTMLElement | null, private readonly _center: AssetOperationCenter) {
    this._unsubscribe = _center.subscribe(operations => this._render(operations));
    this._element?.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-operation-action]') : null;
      if (!button) return;
      const id = Number(button.dataset.operationId);
      if (button.dataset.operationAction === 'retry') this._center.retry(id);
      else if (button.dataset.operationAction === 'cancel') this._center.cancel(id);
      else this._center.dismiss(id);
    });
  }

  dispose(): void { this._unsubscribe(); }

  private _render(operations: readonly AssetOperationSnapshot[]): void {
    if (!this._element) return;
    this._element.hidden = operations.length === 0;
    const rows = operations.slice(0, 5).map(operation => {
      const row = document.createElement('div');
      row.className = `asset-operation asset-operation-${operation.status}`;
      const progress = operation.progress;
      const fraction = progress?.total ? Math.round(progress.current / progress.total * 100) : null;
      const text = document.createElement('span');
      text.textContent = `${operation.kind === 'reimport' ? 'Reimport' : 'Import'} · ${operation.label} · ${operation.status}${fraction === null ? '' : ` ${fraction}%`}`;
      text.title = operation.error ?? progress?.message ?? operation.label;
      row.append(text);
      const action = document.createElement('button');
      action.type = 'button';
      action.dataset.operationId = String(operation.id);
      action.dataset.operationAction = operation.status === 'running' ? 'cancel' : operation.canRetry ? 'retry' : 'dismiss';
      action.textContent = operation.status === 'running' ? 'Cancel' : operation.canRetry ? 'Retry' : '×';
      row.append(action);
      return row;
    });
    this._element.replaceChildren(...rows);
  }
}
