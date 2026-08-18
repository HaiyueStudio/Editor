export const HIERARCHY_TRANSACTION_MEASURE_PREFIX = 'editor.hierarchy.';

export type HierarchyTransactionStage =
  | 'reparent'
  | 'index-update'
  | 'serialization'
  | 'dirty-notification'
  | 'tree-rebuild'
  | 'viewport-inspector-sync'
  | 'transaction';

let hierarchyTransactionDepth = 0;

export function runHierarchyTransaction<T>(operation: () => T): T {
  hierarchyTransactionDepth++;
  try {
    return measureHierarchyStage('transaction', operation);
  } finally {
    hierarchyTransactionDepth--;
  }
}

export function isHierarchyTransactionActive(): boolean {
  return hierarchyTransactionDepth > 0;
}

export function measureHierarchyStage<T>(stage: HierarchyTransactionStage, operation: () => T): T {
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    recordHierarchyStage(stage, startedAt, performance.now());
  }
}

export function recordHierarchyStage(
  stage: HierarchyTransactionStage,
  startedAt: number,
  endedAt: number,
): void {
  const name = `${HIERARCHY_TRANSACTION_MEASURE_PREFIX}${stage}`;
  performance.clearMeasures(name);
  performance.measure(name, { start: startedAt, end: endedAt });
}

export function readHierarchyTransactionMetrics(): Readonly<Record<HierarchyTransactionStage, number>> {
  const result: Record<HierarchyTransactionStage, number> = {
    reparent: 0,
    'index-update': 0,
    serialization: 0,
    'dirty-notification': 0,
    'tree-rebuild': 0,
    'viewport-inspector-sync': 0,
    transaction: 0,
  };
  for (const stage of Object.keys(result) as HierarchyTransactionStage[]) {
    result[stage] = performance.getEntriesByName(
      `${HIERARCHY_TRANSACTION_MEASURE_PREFIX}${stage}`,
      'measure',
    ).at(-1)?.duration ?? 0;
  }
  return Object.freeze(result);
}
