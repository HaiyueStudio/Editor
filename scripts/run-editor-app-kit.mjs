import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import {
  assembleEditorApp,
  loadEditorAppDescriptor,
  previewEditorApp,
  validateAssembledEditorApp,
} from '@haiyue/editor-app-kit/node';

const [command] = process.argv.slice(2);
const packageRoot = resolve(process.cwd());
const descriptorPath = resolve(packageRoot, 'app/descriptor.json');

if (command === 'assemble') {
  const result = await assembleEditorApp({ descriptorPath, packageRoot });
  console.log(`[editor-app-kit] ${result.descriptor.id}@${result.descriptor.version}: ${result.files.length} files, ${result.rawBytes}B raw, ${result.gzipBytes}B gzip.`);
} else if (command === 'validate') {
  const result = await validateAssembledEditorApp({ descriptorPath, packageRoot });
  console.log(`[editor-app-kit] ${result.descriptor.id} artifact validated (${result.files.length} files, ${result.manifest.buildHash.slice(0, 16)}).`);
} else if (command === 'preview') {
  const port = positiveInteger(process.env.EDITOR_APP_PORT, 4174);
  const basePath = process.env.EDITOR_APP_BASE ?? '/';
  await previewEditorApp({ descriptorPath, packageRoot, port, basePath });
  console.log(`[editor-app-kit] preview: http://127.0.0.1:${port}${basePath}`);
} else if (command === 'electron-smoke') {
  await smokePackagedElectron({ descriptorPath, packageRoot, outputDirectory: process.argv[3] });
} else if (command === 'electron-pack') {
  await packageElectron({ descriptorPath, packageRoot, directoryOnly: true });
} else if (command === 'electron-dist') {
  await packageElectron({ descriptorPath, packageRoot, directoryOnly: false });
} else {
  throw new Error(`Usage: node scripts/run-editor-app-kit.mjs <assemble|validate|preview|electron-pack|electron-dist|electron-smoke>`);
}

function positiveInteger(raw, fallback) {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function smokePackagedElectron({ descriptorPath, packageRoot, outputDirectory }) {
  if (process.platform !== 'win32') throw new Error('Packaged Electron smoke currently requires the Windows release layout.');
  const descriptor = await loadEditorAppDescriptor(descriptorPath);
  if (!outputDirectory) {
    const pointer = JSON.parse(await readFile(resolve(packageRoot, '.electron-candidate.json'), 'utf8'));
    outputDirectory = pointer.outputDirectory;
  }
  const executable = resolve(packageRoot, outputDirectory, 'win-unpacked', `${descriptor.productName}.exe`);
  if (!existsSync(executable)) throw new Error(`Packaged Electron executable is missing: ${executable}`);
  const result = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(executable, [], {
      cwd: dirname(executable),
      env: { ...process.env, HAIYUE_ELECTRON_SMOKE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal, stdout, stderr }));
    setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 45_000).unref();
  });
  if (result.code !== 0) throw new Error(`Packaged Electron smoke failed (${result.code ?? result.signal}).\n${result.stdout}\n${result.stderr}`);
  console.log(`[editor-app-kit] ${descriptor.id} packaged Electron renderer smoke passed.`);
}

async function packageElectron({ descriptorPath, packageRoot, directoryOnly }) {
  const descriptor = await loadEditorAppDescriptor(descriptorPath);
  const outputDirectory = `release-electron/candidate-${Date.now()}-${process.pid}`;
  const cli = resolve(packageRoot, '../node_modules/electron-builder/out/cli/cli.js');
  const args = [cli];
  if (directoryOnly) args.push('--dir');
  args.push('--config', 'electron-builder.generated.json', `--config.directories.output=${outputDirectory}`);
  const installedRuntime = resolve(packageRoot, '../node_modules/electron/dist');
  if (process.platform === 'win32' && existsSync(installedRuntime)) {
    args.push(`--config.electronDist=${installedRuntime}`);
  }
  const code = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(process.execPath, args, { cwd: packageRoot, stdio: 'inherit', windowsHide: true });
    child.once('error', rejectExit);
    child.once('exit', (exitCode, signal) => {
      if (signal) rejectExit(new Error(`Electron Builder terminated by ${signal}.`));
      else resolveExit(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`Electron Builder exited with code ${code}.`);
  await writeFile(resolve(packageRoot, '.electron-candidate.json'), `${JSON.stringify({
    schemaVersion: 1,
    productId: descriptor.id,
    outputDirectory,
  }, null, 2)}\n`);
  console.log(`[editor-app-kit] ${descriptor.id} Electron candidate: ${outputDirectory}`);
}
