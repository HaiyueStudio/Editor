import {
  compileMaterialGraphDocumentV1,
  getMaterialGraphAuthoringCatalogV1,
  getMaterialGraphSurfaceSlotsV1,
} from '@haiyue/shader-language/material-graph';
import {
  MATERIAL_GRAPH_WORKER_PROTOCOL,
  type MaterialGraphWorkerRequest,
  type MaterialGraphWorkerResponse,
} from '../../domain/content/MaterialGraphAuthoring';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MaterialGraphWorkerRequest>) => void) | null;
  postMessage(value: MaterialGraphWorkerResponse): void;
};

workerScope.onmessage = event => {
  const request = event.data;
  if (request?.protocol !== MATERIAL_GRAPH_WORKER_PROTOCOL) return;
  try {
    const value = request.type === 'describe'
      ? Object.freeze({ catalog: getMaterialGraphAuthoringCatalogV1(), surfaceSlots: getMaterialGraphSurfaceSlotsV1() })
      : compileMaterialGraphDocumentV1(request.graph);
    workerScope.postMessage(Object.freeze({
      protocol: MATERIAL_GRAPH_WORKER_PROTOCOL,
      requestId: request.requestId,
      ok: true,
      value,
    }));
  } catch (error) {
    workerScope.postMessage(Object.freeze({
      protocol: MATERIAL_GRAPH_WORKER_PROTOCOL,
      requestId: request.requestId,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
  }
};
