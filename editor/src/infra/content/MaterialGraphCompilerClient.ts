import {
  MATERIAL_GRAPH_WORKER_PROTOCOL,
  type MaterialGraphAuthoringDescription,
  type MaterialGraphCompileResult,
  type MaterialGraphCompilerPort,
  type MaterialGraphDocumentV1,
  type MaterialGraphWorkerRequest,
  type MaterialGraphWorkerResponse,
} from '../../domain/content/MaterialGraphAuthoring';

interface WorkerPort {
  postMessage(value: MaterialGraphWorkerRequest): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<MaterialGraphWorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
}

interface PendingRequest {
  readonly resolve: (value: MaterialGraphAuthoringDescription | MaterialGraphCompileResult) => void;
  readonly reject: (error: Error) => void;
  readonly removeAbort?: () => void;
}

export class MaterialGraphCompilerClient implements MaterialGraphCompilerPort {
  private nextRequestId = 1;
  private disposed = false;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly worker: WorkerPort) {
    worker.addEventListener('message', event => this.handleMessage(event.data));
    worker.addEventListener('error', event => this.failAll(new Error(event.message || 'Material Graph compiler worker failed.')));
  }

  describe(): Promise<MaterialGraphAuthoringDescription> {
    return this.request({ type: 'describe' }) as Promise<MaterialGraphAuthoringDescription>;
  }

  compile(graph: MaterialGraphDocumentV1, signal?: AbortSignal): Promise<MaterialGraphCompileResult> {
    return this.request({ type: 'compile', graph }, signal) as Promise<MaterialGraphCompileResult>;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.failAll(new Error('Material Graph compiler client was disposed.'));
  }

  private request(
    payload: { type: 'describe' } | { type: 'compile'; graph: MaterialGraphDocumentV1 },
    signal?: AbortSignal,
  ): Promise<MaterialGraphAuthoringDescription | MaterialGraphCompileResult> {
    if (this.disposed) return Promise.reject(new Error('Material Graph compiler client is unavailable after dispose.'));
    if (signal?.aborted) return Promise.reject(abortError());
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.pending.delete(requestId);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        ...(signal ? { removeAbort: () => signal.removeEventListener('abort', onAbort) } : {}),
      });
      this.worker.postMessage(Object.freeze({ protocol: MATERIAL_GRAPH_WORKER_PROTOCOL, requestId, ...payload }) as MaterialGraphWorkerRequest);
    });
  }

  private handleMessage(response: MaterialGraphWorkerResponse): void {
    if (response.protocol !== MATERIAL_GRAPH_WORKER_PROTOCOL) return;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    pending.removeAbort?.();
    if (response.ok) pending.resolve(response.value);
    else pending.reject(new Error(response.message));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.removeAbort?.();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function createBrowserMaterialGraphCompilerClient(): MaterialGraphCompilerClient | null {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') return null;
  const url = new URL('./dist/material-graph-worker.js', document.baseURI);
  return new MaterialGraphCompilerClient(new Worker(url, { type: 'module', name: 'haiyue-material-graph-compiler' }));
}

function abortError(): Error {
  return typeof DOMException === 'undefined'
    ? new Error('Material Graph compilation was aborted.')
    : new DOMException('Material Graph compilation was aborted.', 'AbortError');
}
