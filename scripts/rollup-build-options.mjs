import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function parseBuildArguments(args) {
  let config = 'rollup.config.js', heapMb = 2048;
  let hasConfig = false;
  const expectedOutputs = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--heap-mb') {
      const raw=args[++index];heapMb=Number(raw);
      if(!raw||!Number.isInteger(heapMb)||heapMb<128||heapMb>16384)throw new Error('--heap-mb requires an integer from 128 to 16384.');
    } else if (argument === '--expect') {
      const output = args[index + 1];
      if (!output) throw new Error('--expect requires an output path.');
      expectedOutputs.push(output);
      index += 1;
    } else if (argument?.startsWith('--expect=')) {
      expectedOutputs.push(argument.slice('--expect='.length));
    } else if (argument?.startsWith('-')) {
      throw new Error(`Unknown build-rollup-once option ${argument}.`);
    } else {
      if (hasConfig) throw new Error(`Unexpected second Rollup config ${argument}.`);
      config = argument ?? config;
      hasConfig = true;
    }
  }
  if (expectedOutputs.length === 0) {
    expectedOutputs.push(...inferConfigOutputs(config));
  }
  return { config, expectedOutputs, heapMb };
}

function inferConfigOutputs(config) {
  const source = readFileSync(resolve(process.cwd(), config), 'utf8');
  const literalOutput = /^\s*(?:file|dir):\s*(['"])([^'"]+)\1\s*,?\s*$/gm;
  const outputs = [...source.matchAll(literalOutput)].map(match => match[2]);
  if (outputs.length > 0) return [...new Set(outputs)];
  return [config.includes('.test.') ? 'dist-test' : 'dist'];
}

export function environmentDuration(name, fallback, allowZero = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? 'zero or a positive integer' : 'a positive integer'}.`);
  }
  return value;
}
