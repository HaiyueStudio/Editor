import {parseBuildArguments,environmentDuration} from './rollup-build-options.mjs';
import { runRollupOnce } from './shared-rollup-runner.mjs';

const { config, expectedOutputs, heapMb } = parseBuildArguments(process.argv.slice(2));

try {
  await runRollupOnce({
    config,
    expectedOutputs,
    heapMb,
    timeoutMs: environmentDuration('ROLLUP_BUILD_TIMEOUT_MS', 120_000),
    exitGraceMs: environmentDuration('ROLLUP_EXIT_GRACE_MS', 1_500, true),
    terminateGraceMs: environmentDuration('ROLLUP_TERM_GRACE_MS', 1_000),
    killGraceMs: environmentDuration('ROLLUP_KILL_GRACE_MS', 1_000),
    label: config,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
