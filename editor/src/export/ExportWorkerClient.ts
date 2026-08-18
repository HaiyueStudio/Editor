import type { RuntimeExportResult } from './RuntimeSceneContract';
import type { RuntimeProjectExport, RuntimeProjectMetrics, RuntimeProjectOptions } from './projectTemplate';
import type { ExportWorkerProgress, ExportWorkerRequest, ExportWorkerResponse } from './ExportWorkerProtocol';

export interface ExportWorkerLike {
  onmessage: ((event: MessageEvent<ExportWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ExportWorkerRequest): void;
  terminate(): void;
}

export interface ExportWorkerExecutionContext {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExportWorkerProgress) => void;
}

export interface ExportWorkerZipResult {
  readonly buffer: ArrayBuffer;
  readonly projectName: string;
  readonly metrics: RuntimeProjectMetrics & { readonly zipBytes: number; readonly estimatedPeakBytes: number };
}

export class ExportWorkerClient {
  private _nextRequestId = 1;

  constructor(private readonly _createWorker: () => ExportWorkerLike) {}

  buildProject(
    runtimeExport: RuntimeExportResult,
    options: RuntimeProjectOptions,
    context: ExportWorkerExecutionContext = {},
  ): Promise<RuntimeProjectExport> {
    return this._run('project', runtimeExport, options, context);
  }

  buildZip(
    runtimeExport: RuntimeExportResult,
    options: RuntimeProjectOptions,
    context: ExportWorkerExecutionContext = {},
  ): Promise<ExportWorkerZipResult> {
    return this._run('zip', runtimeExport, options, context);
  }

  private _run<T extends RuntimeProjectExport | ExportWorkerZipResult>(
    kind: ExportWorkerRequest['kind'],
    runtimeExport: RuntimeExportResult,
    options: RuntimeProjectOptions,
    context: ExportWorkerExecutionContext,
  ): Promise<T> {
    context.signal?.throwIfAborted();
    const worker = this._createWorker();
    const id = this._nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        context.signal?.removeEventListener('abort', onAbort);
        worker.terminate();
      };
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        action();
      };
      const onAbort = () => settle(() => reject(toAbortError(context.signal?.reason)));
      context.signal?.addEventListener('abort', onAbort, { once: true });
      worker.onerror = event => settle(() => reject(event.error ?? new Error(event.message || 'Export worker failed.')));
      worker.onmessage = event => {
        const message = event.data;
        if (message.id !== id) return;
        if (message.type === 'progress') {
          context.onProgress?.(message.progress);
          return;
        }
        if (message.type === 'error') {
          settle(() => reject(restoreWorkerError(message.error)));
          return;
        }
        if (message.type === 'project') {
          settle(() => resolve(message.project as T));
          return;
        }
        settle(() => resolve({
          buffer: message.bytes,
          projectName: message.projectName,
          metrics: message.metrics,
        } as T));
      };
      try {
        worker.postMessage({ id, kind, runtimeExport, options });
      } catch (error) {
        settle(() => reject(error));
      }
    });
  }
}

export function createBrowserExportWorkerClient(): ExportWorkerClient | null {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') return null;
  const url = new URL('./dist/export-worker.js', document.baseURI);
  return new ExportWorkerClient(() => new Worker(url, { type: 'module', name: 'haiyue-export' }));
}

function restoreWorkerError(value: { name: string; message: string; stack?: string }): Error {
  const error = new Error(value.message);
  error.name = value.name;
  if (value.stack) error.stack = value.stack;
  return error;
}

function toAbortError(reason: unknown): DOMException {
  return reason instanceof DOMException && reason.name === 'AbortError'
    ? reason
    : new DOMException(typeof reason === 'string' ? reason : 'Export cancelled.', 'AbortError');
}
