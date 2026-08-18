import { optionalRuntimeCapability } from './bundle-chunk-policy.mjs';

export function calculateBudgetHeadroom(actual, limit) {
  if (!Number.isFinite(actual) || actual < 0 || !Number.isFinite(limit) || limit <= 0) {
    throw new RangeError('Bundle headroom requires a non-negative actual size and positive limit.');
  }
  const bytes = limit - actual;
  return Object.freeze({ bytes, ratio: bytes / limit });
}

export function analyzeEditorBundle(entries, graph, topology) {
  validateGraph(graph);
  validateTopology(topology);
  const chunksByFile = new Map(graph.chunks.map(chunk => [chunk.fileName, chunk]));
  const startupRoots = new Set(topology.initialEntries);

  for (const moduleId of topology.eagerDynamicModules) {
    const owner = graph.chunks.find(chunk => chunk.moduleIds.includes(moduleId));
    if (!owner) throw new Error(`Startup module is absent from the emitted bundle graph: ${moduleId}`);
    startupRoots.add(owner.fileName);
  }

  const startupFiles = collectStaticClosure(startupRoots, chunksByFile);
  const secondaryFiles = new Set(topology.secondaryEntries);
  const analyzedEntries = entries.map(entry => ({
    ...entry,
    type: startupFiles.has(entry.file)
      ? topology.initialEntries.includes(entry.file) ? 'initial-entry' : 'startup-dependency'
      : secondaryFiles.has(entry.file) ? 'secondary-entry' : 'chunk',
    startup: startupFiles.has(entry.file),
  }));
  const startupEntries = analyzedEntries.filter(entry => entry.startup);
  const initialEntryFiles = new Set(topology.initialEntries);
  const initialEntryEntries = analyzedEntries.filter(entry => initialEntryFiles.has(entry.file));
  const secondaryEntries = analyzedEntries.filter(entry => entry.type === 'secondary-entry');
  const asyncChunks = analyzedEntries.filter(entry => entry.type === 'chunk');

  return {
    entries: analyzedEntries,
    startupFiles: [...startupFiles].sort(),
    totals: {
      entryJsBytes: sum(initialEntryEntries, 'bytes'),
      entryGzipBytes: sum(initialEntryEntries, 'gzipBytes'),
      startupClosureJsBytes: sum(startupEntries, 'bytes'),
      startupClosureGzipBytes: sum(startupEntries, 'gzipBytes'),
      secondaryJsBytes: sum(secondaryEntries, 'bytes'),
      secondaryGzipBytes: sum(secondaryEntries, 'gzipBytes'),
      asyncJsBytes: sum(asyncChunks, 'bytes'),
      asyncGzipBytes: sum(asyncChunks, 'gzipBytes'),
      totalJsBytes: sum(analyzedEntries, 'bytes'),
      totalGzipBytes: sum(analyzedEntries, 'gzipBytes'),
      maxAsyncChunkBytes: Math.max(0, ...asyncChunks.map(entry => entry.bytes)),
      maxAsyncChunkGzipBytes: Math.max(0, ...asyncChunks.map(entry => entry.gzipBytes)),
    },
  };
}

export const OPTIONAL_EDITOR_RUNTIME_MODULE_SUFFIXES = Object.freeze([
  'extensions/src/gltf/GltfModelSystem.ts',
  'extensions/src/gltf/gltfLoader.ts',
  'extensions/src/spine/Spine2DRenderSystem.ts',
  'extensions/src/spine/Spine2DRuntime.ts',
  'extensions/src/tilemap/Tilemap2DRenderSystem.ts',
  'extensions/src/tween/Tween2DSystem.ts',
]);

export function findOptionalRuntimeModulesInStartup(
  graph,
  startupFiles,
  suffixes,
) {
  const startup = new Set(startupFiles);
  const matches = new Set();
  for (const chunk of graph.chunks) {
    if (!startup.has(chunk.fileName)) continue;
    for (const moduleId of chunk.moduleIds) {
      if (suffixes
        ? suffixes.some(suffix => moduleId.endsWith(suffix))
        : optionalRuntimeCapability(moduleId)) {
        matches.add(moduleId);
      }
    }
  }
  return [...matches].sort();
}

export function analyzeCapabilityBudgets(entries, graph, policies) {
  validateGraph(graph);
  validateCapabilityPolicies(policies);
  const entriesByFile = new Map(entries.map(entry => [entry.file, entry]));
  const chunksByFile = new Map(graph.chunks.map(chunk => [chunk.fileName, chunk]));
  const closures = new Map();
  for (const [id, policy] of Object.entries(policies)) {
    closures.set(id, new Set(collectStaticClosureForModules(graph, policy.rootModules)));
  }
  return Object.entries(policies).map(([id, policy]) => {
    const files = [...closures.get(id)].sort();
    const baseline = policy.incrementalFrom
      ? closures.get(policy.incrementalFrom)
      : null;
    if (policy.incrementalFrom && !baseline) {
      throw new Error(`Capability ${id} references unknown incremental baseline: ${policy.incrementalFrom}`);
    }
    const incrementalFiles = baseline
      ? files.filter(file => !baseline.has(file))
      : [...files];
    const allowed = new Set(policy.allowedOptionalRuntimes);
    const rootFiles = findModuleOwnerFiles(graph, policy.rootModules);
    const dynamicallyReachableFiles = collectDynamicallyReachableFiles(rootFiles, chunksByFile);
    const deferredModules = Object.entries(policy.deferredModules ?? {}).map(([stage, moduleIds]) => {
      const ownerFiles = findModuleOwnerFiles(graph, moduleIds);
      return {
        stage,
        moduleIds: [...moduleIds],
        ownerFiles,
        excludedFromStaticClosure: ownerFiles.every(file => !files.includes(file)),
        dynamicallyReachable: ownerFiles.every(file => dynamicallyReachableFiles.has(file)),
      };
    });
    const unexpectedOptionalRuntimeModules = [];
    for (const chunk of graph.chunks) {
      if (!files.includes(chunk.fileName)) continue;
      for (const moduleId of chunk.moduleIds) {
        const owner = optionalRuntimeCapability(moduleId);
        if (owner && !allowed.has(owner)) {
          unexpectedOptionalRuntimeModules.push({ capability: owner, moduleId });
        }
      }
    }
    return {
      id,
      rootModules: [...policy.rootModules],
      allowedOptionalRuntimes: [...policy.allowedOptionalRuntimes],
      files,
      incrementalFrom: policy.incrementalFrom ?? null,
      incrementalFiles,
      jsBytes: sumFiles(files, entriesByFile, 'bytes'),
      gzipBytes: sumFiles(files, entriesByFile, 'gzipBytes'),
      incrementalJsBytes: sumFiles(incrementalFiles, entriesByFile, 'bytes'),
      incrementalGzipBytes: sumFiles(incrementalFiles, entriesByFile, 'gzipBytes'),
      maxStaticClosureGzipBytes: policy.maxStaticClosureGzipBytes,
      maxIncrementalGzipBytes: policy.maxIncrementalGzipBytes ?? null,
      deferredModules,
      unexpectedOptionalRuntimeModules: unexpectedOptionalRuntimeModules
        .sort((a, b) => a.moduleId.localeCompare(b.moduleId)),
    };
  });
}

export function collectStaticClosureForModules(graph, moduleIds) {
  validateGraph(graph);
  const chunksByFile = new Map(graph.chunks.map(chunk => [chunk.fileName, chunk]));
  const roots = new Set(findModuleOwnerFiles(graph, moduleIds));
  return [...collectStaticClosure(roots, chunksByFile)].sort();
}

function findModuleOwnerFiles(graph, moduleIds) {
  const roots = new Set();
  for (const moduleId of moduleIds) {
    const owner = graph.chunks.find(chunk => chunk.moduleIds.includes(moduleId));
    if (!owner) throw new Error(`Bundle graph is missing module: ${moduleId}`);
    roots.add(owner.fileName);
  }
  return [...roots].sort();
}

function collectDynamicallyReachableFiles(roots, chunksByFile) {
  const dynamicFiles = new Set();
  const visited = new Set();
  const pending = roots.map(file => ({ file, dynamic: false }));
  while (pending.length > 0) {
    const current = pending.pop();
    const key = `${current.dynamic ? 'dynamic' : 'static'}:${current.file}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const chunk = chunksByFile.get(current.file);
    if (!chunk) throw new Error(`Bundle graph is missing capability chunk: ${current.file}`);
    if (current.dynamic) dynamicFiles.add(current.file);
    for (const dependency of chunk.imports) pending.push({ file: dependency, dynamic: current.dynamic });
    for (const dependency of chunk.dynamicImports) pending.push({ file: dependency, dynamic: true });
  }
  return dynamicFiles;
}

function collectStaticClosure(roots, chunksByFile) {
  const closure = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop();
    if (closure.has(file)) continue;
    const chunk = chunksByFile.get(file);
    if (!chunk) throw new Error(`Bundle graph is missing startup chunk: ${file}`);
    closure.add(file);
    for (const dependency of chunk.imports) pending.push(dependency);
  }
  return closure;
}

function validateGraph(graph) {
  if (graph?.schemaVersion !== 1 || !Array.isArray(graph.chunks)) {
    throw new Error('Editor bundle graph must use schemaVersion 1 and contain chunks.');
  }
  for (const chunk of graph.chunks) {
    if (typeof chunk.fileName !== 'string'
      || !Array.isArray(chunk.imports)
      || !Array.isArray(chunk.moduleIds)) {
      throw new Error('Editor bundle graph contains an invalid chunk.');
    }
  }
}

function validateTopology(topology) {
  if (topology?.schemaVersion !== 1
    || !Array.isArray(topology.initialEntries)
    || topology.initialEntries.length === 0
    || !Array.isArray(topology.secondaryEntries)
    || !Array.isArray(topology.eagerDynamicModules)) {
    throw new Error('Editor startup topology must use schemaVersion 1 and define entry/module arrays.');
  }
}

function validateCapabilityPolicies(policies) {
  if (typeof policies !== 'object' || policies === null || Array.isArray(policies)) {
    throw new Error('Editor capability budgets must be an object.');
  }
  for (const [id, policy] of Object.entries(policies)) {
    if (!Array.isArray(policy?.rootModules) || policy.rootModules.length === 0
      || !policy.rootModules.every(moduleId => typeof moduleId === 'string')
      || !Array.isArray(policy.allowedOptionalRuntimes)
      || !policy.allowedOptionalRuntimes.every(capability => typeof capability === 'string')
      || (policy.deferredModules !== undefined
        && (typeof policy.deferredModules !== 'object'
          || policy.deferredModules === null
          || Array.isArray(policy.deferredModules)
          || !Object.values(policy.deferredModules).every(moduleIds => Array.isArray(moduleIds)
            && moduleIds.length > 0
            && moduleIds.every(moduleId => typeof moduleId === 'string'))))
      || !Number.isFinite(policy.maxStaticClosureGzipBytes)
      || (policy.maxIncrementalGzipBytes !== undefined
        && !Number.isFinite(policy.maxIncrementalGzipBytes))) {
      throw new Error(`Editor capability budget is invalid: ${id}`);
    }
  }
}

function sumFiles(files, entriesByFile, key) {
  let total = 0;
  for (const file of files) {
    const entry = entriesByFile.get(file);
    if (!entry) throw new Error(`Bundle size entry is missing for capability chunk: ${file}`);
    total += entry[key];
  }
  return total;
}

function sum(entries, key) {
  return entries.reduce((total, entry) => total + entry[key], 0);
}
