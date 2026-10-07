import assert from 'node:assert/strict';

export function operationClient(platform, documentId) {
  let counter = 0;
  return async (operation, params = {}, overrides = {}) => {
    const doc = documentId ? platform.documents.get(documentId) : null;
    const result = await platform.operations.execute({ apiVersion: '1', requestId: `loop-${++counter}`, operation,
      ...(doc ? { documentId, expectedRevision: doc.revision } : {}), params, ...overrides });
    assert.equal(result.status, 'completed', JSON.stringify(result));
    return result.value;
  };
}
export function textResource(platform, text) { return platform.resources.put(new TextEncoder().encode(text)).resourceId; }
export function readText(platform, result) { return new TextDecoder().decode(platform.resources.read(result.resourceId)); }
