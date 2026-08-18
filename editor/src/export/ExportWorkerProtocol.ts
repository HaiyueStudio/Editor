import type { RuntimeExportResult } from './RuntimeSceneContract';
import type { RuntimeProjectExport, RuntimeProjectMetrics, RuntimeProjectOptions } from './projectTemplate';

export type ExportWorkerStage = 'textures' | 'precompile' | 'project' | 'zip';

export interface ExportWorkerProgress {
  readonly stage: ExportWorkerStage;
  readonly current: number;
  readonly total: number;
  readonly message?: string;
}

export interface ExportWorkerRequest {
  readonly id: number;
  readonly kind: 'project' | 'zip';
  readonly runtimeExport: RuntimeExportResult;
  readonly options: RuntimeProjectOptions;
}

export type ExportWorkerResponse =
  | Readonly<{ id: number; type: 'progress'; progress: ExportWorkerProgress }>
  | Readonly<{ id: number; type: 'project'; project: RuntimeProjectExport }>
  | Readonly<{
      id: number;
      type: 'zip';
      bytes: ArrayBuffer;
      projectName: string;
      metrics: RuntimeProjectMetrics & { readonly zipBytes: number; readonly estimatedPeakBytes: number };
    }>
  | Readonly<{ id: number; type: 'error'; error: ExportWorkerError }>;

export interface ExportWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}
