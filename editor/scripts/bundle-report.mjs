import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeEditorBundle,
  analyzeCapabilityBudgets,
  calculateBudgetHeadroom,
  collectStaticClosureForModules,
  findOptionalRuntimeModulesInStartup,
} from './bundle-report-lib.mjs';

const editorDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(editorDir, 'dist');
const budgetPath = resolve(editorDir, 'bundle-budget.json');
const topologyPath = resolve(editorDir, 'bundle-startup.json');
const graphPath = resolve(distDir, 'bundle-graph.json');
const reportJsonPath = resolve(distDir, 'bundle-report.json');
const reportMdPath = resolve(distDir, 'bundle-report.md');

const budget = JSON.parse(await readFile(budgetPath, 'utf8'));
const topology = JSON.parse(await readFile(topologyPath, 'utf8'));
const graph = JSON.parse(await readFile(graphPath, 'utf8'));
const files = await collectFiles(distDir);
const jsFiles = files.filter(file => file.endsWith('.js'));
const fileEntries = [];

for (const file of jsFiles) {
  const absolute = resolve(distDir, file);
  const content = await readFile(absolute);
  fileEntries.push({
    file,
    bytes: content.byteLength,
    gzipBytes: gzipSync(content).byteLength,
  });
}

const analysis = analyzeEditorBundle(fileEntries, graph, topology);
const { entries, startupFiles, totals } = analysis;
const capabilities = analyzeCapabilityBudgets(
  entries,
  graph,
  budget.capabilities,
);
const unexpectedStartupModules = findOptionalRuntimeModulesInStartup(
  graph,
  startupFiles,
);
const emptyProjectFiles = collectStaticClosureForModules(
  graph,
  ['src/infra/app/mainEditorApp.ts'],
);
const unexpectedEmptyProjectModules = findOptionalRuntimeModulesInStartup(
  graph,
  emptyProjectFiles,
);
const totalGzipHeadroom = {
  ...calculateBudgetHeadroom(totals.totalGzipBytes, budget.maxTotalGzipBytes),
  minimumRatio: budget.minTotalGzipHeadroomRatio,
};
entries.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));

const violations = [
  checkBudget('startup closure JS', totals.startupClosureJsBytes, budget.maxStartupClosureJsBytes),
  checkBudget('startup closure gzip', totals.startupClosureGzipBytes, budget.maxStartupClosureGzipBytes),
  checkBudget('largest async chunk JS', totals.maxAsyncChunkBytes, budget.maxAsyncChunkBytes),
  checkBudget('largest async chunk gzip', totals.maxAsyncChunkGzipBytes, budget.maxAsyncChunkGzipBytes),
  checkBudget('total JS', totals.totalJsBytes, budget.maxTotalJsBytes),
  checkBudget('total gzip', totals.totalGzipBytes, budget.maxTotalGzipBytes),
  checkMinimumHeadroom('total gzip', totalGzipHeadroom),
  ...unexpectedStartupModules.map(
    moduleId => `optional runtime is part of startup closure: ${moduleId}`,
  ),
  ...unexpectedEmptyProjectModules.map(
    moduleId => `optional runtime is part of empty-project closure: ${moduleId}`,
  ),
  ...capabilities.flatMap(capability => [
    checkBudget(
      `${capability.id} static closure gzip`,
      capability.gzipBytes,
      capability.maxStaticClosureGzipBytes,
    ),
    checkBudget(
      `${capability.id} incremental gzip`,
      capability.incrementalGzipBytes,
      capability.maxIncrementalGzipBytes,
    ),
    ...capability.unexpectedOptionalRuntimeModules.map(
      item => `${capability.id} static closure includes foreign optional runtime ${item.capability}: ${item.moduleId}`,
    ),
    ...capability.deferredModules.flatMap(stage => [
      stage.excludedFromStaticClosure
        ? null
        : `${capability.id} deferred stage ${stage.stage} is part of its static closure: ${stage.ownerFiles.join(', ')}`,
      stage.dynamicallyReachable
        ? null
        : `${capability.id} deferred stage ${stage.stage} is not dynamically reachable: ${stage.ownerFiles.join(', ')}`,
    ]),
  ]),
].filter(Boolean);

const report = {
  generatedAt: new Date().toISOString(),
  budget,
  topology,
  startupFiles,
  emptyProjectFiles,
  unexpectedStartupModules,
  unexpectedEmptyProjectModules,
  capabilities,
  totals,
  totalGzipHeadroom,
  entries,
  violations,
};

await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(reportMdPath, renderMarkdown(report));

printSummary(report);

if (violations.length > 0 && process.env.EDITOR_BUNDLE_BUDGET_DISABLED !== '1') {
  for (const violation of violations) console.error(`[bundle-budget] ${violation}`);
  process.exit(1);
}

async function collectFiles(root, prefix = '') {
  const result = [];
  const names = await readdir(resolve(root, prefix));
  for (const name of names) {
    const path = prefix ? `${prefix}/${name}` : name;
    const current = resolve(root, path);
    const stats = await stat(current);
    if (stats.isDirectory()) result.push(...await collectFiles(root, path));
    else result.push(path);
  }
  return result;
}

function checkBudget(label, actual, limit) {
  if (!Number.isFinite(limit) || actual <= limit) return null;
  return `${label} ${formatBytes(actual)} exceeds ${formatBytes(limit)}`;
}

function checkMinimumHeadroom(label, headroom) {
  if (!Number.isFinite(headroom.minimumRatio) || headroom.ratio >= headroom.minimumRatio) return null;
  return `${label} headroom ${(headroom.ratio * 100).toFixed(2)}% is below ${(headroom.minimumRatio * 100).toFixed(2)}%`;
}

function renderMarkdown(report) {
  const lines = [
    '# Editor Bundle Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Totals',
    '',
    '| Metric | Size | Budget |',
    '|---|---:|---:|',
    row('Entry JS', report.totals.entryJsBytes),
    row('Entry gzip', report.totals.entryGzipBytes),
    row('Startup closure JS', report.totals.startupClosureJsBytes, report.budget.maxStartupClosureJsBytes),
    row('Startup closure gzip', report.totals.startupClosureGzipBytes, report.budget.maxStartupClosureGzipBytes),
    row('Largest async chunk JS', report.totals.maxAsyncChunkBytes, report.budget.maxAsyncChunkBytes),
    row('Largest async chunk gzip', report.totals.maxAsyncChunkGzipBytes, report.budget.maxAsyncChunkGzipBytes),
    row('Total JS', report.totals.totalJsBytes, report.budget.maxTotalJsBytes),
    row('Total gzip', report.totals.totalGzipBytes, report.budget.maxTotalGzipBytes),
    ratioRow('Total gzip headroom', report.totalGzipHeadroom.ratio, report.totalGzipHeadroom.minimumRatio),
    '',
    '## Capability Closures',
    '',
    '| Capability | Static gzip | Budget | Incremental gzip | Budget |',
    '|---|---:|---:|---:|---:|',
    ...report.capabilities.map(capability => capabilityRow(capability)),
    '',
    '## Deferred Capability Boundaries',
    '',
    '| Capability | Stage | Owner chunks | Outside static closure | Dynamically reachable |',
    '|---|---|---|---:|---:|',
    ...report.capabilities.flatMap(capability => capability.deferredModules.map(stage => deferredRow(capability.id, stage))),
    '',
    '## Files',
    '',
    '| File | Type | Size | Gzip |',
    '|---|---|---:|---:|',
    ...report.entries.map(entry => `| \`${entry.file}\` | ${entry.type} | ${formatBytes(entry.bytes)} | ${formatBytes(entry.gzipBytes)} |`),
    '',
    '## Startup Closure',
    '',
    ...report.startupFiles.map(file => `- \`${file}\``),
    '',
    '## Empty Project Static Closure',
    '',
    ...report.emptyProjectFiles.map(file => `- \`${file}\``),
    '',
  ];
  if (report.violations.length > 0) {
    lines.push('## Budget Violations', '', ...report.violations.map(item => `- ${item}`), '');
  }
  return `${lines.join('\n')}\n`;
}

function capabilityRow(capability) {
  return `| ${capability.id} | ${formatBytes(capability.gzipBytes)} | ${formatBytes(capability.maxStaticClosureGzipBytes)} | ${formatBytes(capability.incrementalGzipBytes)} | ${capability.maxIncrementalGzipBytes === null ? '—' : formatBytes(capability.maxIncrementalGzipBytes)} |`;
}

function deferredRow(capability, stage) {
  return `| ${capability} | ${stage.stage} | ${stage.ownerFiles.map(file => `\`${file}\``).join('<br>')} | ${stage.excludedFromStaticClosure ? 'yes' : 'no'} | ${stage.dynamicallyReachable ? 'yes' : 'no'} |`;
}

function row(label, actual, limit) {
  return `| ${label} | ${formatBytes(actual)} | ${limit === undefined ? '—' : formatBytes(limit)} |`;
}

function ratioRow(label, actual, limit) {
  return `| ${label} | ${(actual * 100).toFixed(2)}% | ${(limit * 100).toFixed(2)}% minimum |`;
}

function printSummary(report) {
  const largest = report.entries[0];
  console.log(
    `[bundle-report] total ${formatBytes(report.totals.totalJsBytes)} (${formatBytes(report.totals.totalGzipBytes)} gzip), `
    + `entry ${formatBytes(report.totals.entryJsBytes)} (${formatBytes(report.totals.entryGzipBytes)} gzip), `
    + `startup closure ${formatBytes(report.totals.startupClosureJsBytes)} (${formatBytes(report.totals.startupClosureGzipBytes)} gzip)`,
  );
  console.log(
    `[bundle-report] total gzip headroom ${formatBytes(report.totalGzipHeadroom.bytes)} `
    + `(${(report.totalGzipHeadroom.ratio * 100).toFixed(2)}%)`,
  );
  if (largest) console.log(`[bundle-report] largest ${relative(distDir, resolve(distDir, largest.file))}: ${formatBytes(largest.bytes)} (${formatBytes(largest.gzipBytes)} gzip)`);
  console.log(`[bundle-report] wrote ${relative(editorDir, reportJsonPath)} and ${relative(editorDir, reportMdPath)}`);
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}
