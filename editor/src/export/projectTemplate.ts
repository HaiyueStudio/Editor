import type { RuntimeExportResult } from './RuntimeSceneContract';
import { generateScriptRuntimeDeclarations, SCRIPT_CAPABILITIES } from '@haiyue/engine/components';
import { analyzeRuntimeDependencies } from './dependencyGraph';
import { precompileRuntimeScene, utf8ByteLength } from './runtimeDataPrecompile';
import type { TexturePipelineOptions } from './texturePipeline';
import { createRuntimeDeserializationTs, createRuntimePlayerTs } from './RuntimeSourceGenerator';
import {
  createExportZipScript,
  createIndexHtml,
  createMainTs,
  createPackageJson,
  createReadme,
  createStaticPackageJson,
  createTsConfig,
  createViteConfig,
} from './templates/projectFileTemplates';
import type { RuntimeComponentContribution } from '../types';

export type RuntimeProjectMode = 'project' | 'static';

export interface RuntimeProjectOptions {
  mode?: RuntimeProjectMode;
  projectName?: string;
  includeSourceMap?: boolean;
  precompileRuntimeData?: boolean;
  texturePipeline?: TexturePipelineOptions;
  componentContributions?: readonly RuntimeComponentContribution[];
}

export interface RuntimeProjectExecutionContext {
  readonly signal?: AbortSignal;
  readonly onProgress?: (stage: 'precompile' | 'project', current: number, total: number) => void;
}

export interface RuntimeProjectFile {
  path: string;
  content: string | Uint8Array;
  type: 'text' | 'json' | 'binary';
}

export interface RuntimeProjectExport {
  mode: RuntimeProjectMode;
  projectName: string;
  files: RuntimeProjectFile[];
  metrics: RuntimeProjectMetrics;
}

export interface RuntimeProjectMetrics {
  readonly outputBytes: number;
  readonly precompile: import('./runtimeDataPrecompile').RuntimePrecompileMetrics | null;
}

export function generateRuntimeProjectFiles(
  runtimeExport: RuntimeExportResult,
  options: RuntimeProjectOptions = {},
  context: RuntimeProjectExecutionContext = {},
): RuntimeProjectExport {
  context.signal?.throwIfAborted();
  const mode = options.mode ?? 'project';
  const projectName = sanitizeProjectName(options.projectName || runtimeExport.scene.name || 'exported-game');
  const shouldPrecompile = options.precompileRuntimeData ?? true;
  const runtimeSceneJson = `${JSON.stringify(runtimeExport.scene, null, 2)}\n`;
  const precompiled = shouldPrecompile ? precompileRuntimeScene(runtimeExport.scene, {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    sourceJsonBytes: utf8ByteLength(runtimeSceneJson),
    onProgress: (current, total) => context.onProgress?.('precompile', current, total),
  }) : null;
  context.signal?.throwIfAborted();
  context.onProgress?.('project', 0, 1);
  const dependencyGraph = analyzeRuntimeDependencies(runtimeExport.scene, options.componentContributions);
  const manifest = {
    ...runtimeExport.manifest,
    precompile: precompiled?.manifestPatch,
    dependencies: {
      componentTypes: dependencyGraph.componentTypes,
      materialTypes: dependencyGraph.materialTypes,
      engineImports: dependencyGraph.engineImports,
      runtimeImports: dependencyGraph.runtimeImports,
      systems: dependencyGraph.systems,
      features: dependencyGraph.features,
    },
    warnings: [...runtimeExport.manifest.warnings, ...dependencyGraph.warnings],
  };
  const files: RuntimeProjectFile[] = [
    textFile('index.html', createIndexHtml(runtimeExport.scene.name || projectName)),
    textFile('src/main.ts', createMainTs(shouldPrecompile)),
    textFile('src/runtime-player.ts', createRuntimePlayerTs(dependencyGraph)),
    textFile('src/runtime-deserialization.ts', createRuntimeDeserializationTs(dependencyGraph)),
    textFile('src/haiyue-script-runtime.d.ts', generateScriptRuntimeDeclarations(SCRIPT_CAPABILITIES)),
    serializedJsonFile('src/scene.runtime.json', runtimeSceneJson),
    ...(precompiled ? [
      textFile('src/scene.runtime.ts', precompiled.sceneModule),
      ...(precompiled.binaryAsset ? [binaryFile('assets/scene.buffers.bin', precompiled.binaryAsset)] : []),
    ] : []),
    jsonFile('public/export-manifest.json', manifest),
    textFile('scripts/export-zip.mjs', createExportZipScript(projectName)),
    textFile('README.md', createReadme(projectName, mode)),
  ];

  if (mode === 'project') {
    files.push(
      jsonFile('package.json', createPackageJson(projectName)),
      textFile('vite.config.ts', createViteConfig(options.includeSourceMap ?? false)),
      jsonFile('tsconfig.json', createTsConfig()),
    );
  } else {
    files.push(textFile('package.json', JSON.stringify(createStaticPackageJson(projectName), null, 2)));
  }

  context.onProgress?.('project', 1, 1);
  return {
    mode,
    projectName,
    files,
    metrics: {
      outputBytes: files.reduce((total, file) => total + (typeof file.content === 'string' ? utf8ByteLength(file.content) : file.content.byteLength), 0),
      precompile: precompiled?.metrics ?? null,
    },
  };
}

export function serializeRuntimeProjectFiles(files: RuntimeProjectFile[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of files) {
    if (typeof file.content === 'string') result[file.path] = file.content;
  }
  return result;
}

function textFile(path: string, content: string): RuntimeProjectFile {
  return { path, content, type: 'text' };
}

function jsonFile(path: string, value: unknown): RuntimeProjectFile {
  return { path, content: `${JSON.stringify(value, null, 2)}\n`, type: 'json' };
}

function serializedJsonFile(path: string, content: string): RuntimeProjectFile {
  return { path, content, type: 'json' };
}

function binaryFile(path: string, content: Uint8Array): RuntimeProjectFile {
  return { path, content, type: 'binary' };
}

function sanitizeProjectName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'exported-game';
}
