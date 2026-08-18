import type { ExportWorkerProgress, ExportWorkerRequest, ExportWorkerResponse } from './ExportWorkerProtocol';
import type { RuntimeProjectExport } from './projectTemplate';

interface ExportWorkerScope {
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null;
  postMessage(message: ExportWorkerResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as ExportWorkerScope;

scope.onmessage = event => { void runRequest(event.data); };

async function runRequest(request: ExportWorkerRequest): Promise<void> {
  try {
    postProgress(request.id, { stage: 'textures', current: 0, total: 1 });
    const { optimizeRuntimeTextures } = await import('./texturePipeline');
    const optimized = await optimizeRuntimeTextures(request.runtimeExport, request.options.texturePipeline, {
      mutateInput: true,
      onProgress: (current, total, message) => postProgress(request.id, {
        stage: 'textures', current, total: Math.max(1, total), ...(message === undefined ? {} : { message }),
      }),
    });
    postProgress(request.id, { stage: 'textures', current: 1, total: 1 });
    const { generateRuntimeProjectFiles } = await import('./projectTemplate');
    const project = generateRuntimeProjectFiles(optimized, request.options, {
      onProgress: (stage, current, total) => postProgress(request.id, { stage, current, total: Math.max(1, total) }),
    });

    if (request.kind === 'project') {
      const transfers = collectProjectTransfers(project);
      scope.postMessage({ id: request.id, type: 'project', project }, transfers);
      return;
    }

    postProgress(request.id, { stage: 'zip', current: 0, total: 100 });
    const { createRuntimeProjectZipBytes } = await import('./projectZip');
    const bytes = await createRuntimeProjectZipBytes(project, {
      onProgress: (current, currentFile) => postProgress(request.id, {
        stage: 'zip', current, total: 100, ...(currentFile === undefined ? {} : { message: currentFile }),
      }),
    });
    const resultBuffer = toTransferableBuffer(bytes);
    scope.postMessage({
      id: request.id,
      type: 'zip',
      bytes: resultBuffer,
      projectName: project.projectName,
      metrics: {
        ...project.metrics,
        zipBytes: bytes.byteLength,
        estimatedPeakBytes: project.metrics.outputBytes + bytes.byteLength + (project.metrics.precompile?.peakWorkingBytes ?? 0),
      },
    }, [resultBuffer]);
  } catch (error) {
    scope.postMessage({ id: request.id, type: 'error', error: serializeError(error) });
  }
}

function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

function postProgress(id: number, progress: ExportWorkerProgress): void {
  scope.postMessage({ id, type: 'progress', progress });
}

function collectProjectTransfers(project: RuntimeProjectExport): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const file of project.files) {
    if (typeof file.content === 'string' || !(file.content.buffer instanceof ArrayBuffer)) continue;
    buffers.add(file.content.buffer);
  }
  return [...buffers];
}

function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) };
  }
  return { name: 'Error', message: String(error) };
}
