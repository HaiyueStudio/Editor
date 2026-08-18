import { parseProjectImport } from './projectImport';
import type { ProjectImportWorkerMessage, ProjectImportWorkerRequest } from './projectImportProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<ProjectImportWorkerRequest>) => void) | null;
  postMessage(message: ProjectImportWorkerMessage): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = event => {
  try {
    scope.postMessage({
      type: 'success',
      id: event.data.id,
      result: parseProjectImport(event.data.format, event.data.data),
    });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id: event.data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
